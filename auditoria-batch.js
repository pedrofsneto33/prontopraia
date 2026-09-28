const fs = require('fs');
const { chromium } = require('playwright');

const CSV_PATH = 'C:\\Users\\User\\Desktop\\prontopraia\\resultados_auditoria.csv';

// ⚠️ Troque a URL da Amazon por uma que exista (a B09B8V1LZ3 foi descontinuada)
const urls = [
  'https://www.nike.com/t/air-force-1-07-mens-shoes-jBrhbr/CW2288-111',
  'https://www.amazon.com.br/dp/B09B8V1LZ3',
  'https://www.magazineluiza.com.br/smartphone-samsung-galaxy-a15-128gb-azul-4gb-ram-50mp/p/jf12345678/'
];

async function fetchHtml(page, url) {
  try {
    const resp = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    await page.waitForTimeout(2000);
    const html = await page.content();
    return { statusCode: resp ? resp.status() : 0, body: html, error: null };
  } catch (e) {
    return { statusCode: 0, body: '', error: e.message.substring(0, 120) };
  }
}

// Detecta páginas de bloqueio (WAF/anti-bot) que devolvem HTTP 200 mas com página de erro
function isBlockedPage(html, statusCode) {
  if (!html) return false;
  const smallPage = html.length < 5000;
  const patterns = [
    /não é possível acessar a página/i,
    /just a moment/i,
    /checking your browser/i,
    /cf-chl-/i,
    /error-code[^>]*>\s*40[0-9]/i,
    /error-code[^>]*>\s*5[0-9]{2}/i,
    /access denied/i,
    /attention required/i,
    /you have been blocked/i,
    /enable javascript and cookies/i
  ];
  // Se a página é pequena E tem um dos padrões, é bloqueio
  if (smallPage && patterns.some(re => re.test(html))) return true;
  // Páginas < 1KB geralmente são redirecionamentos para challenge
  if (html.length < 1000 && statusCode === 200) return true;
  return false;
}

function auditar(url, resp) {
  const statusCode = resp.statusCode || 0;
  const html = resp.body || '';
  const erroHttp = statusCode >= 400 ? String(statusCode) : (resp.error || null);

  // 1) BLOQUEIO (WAF/anti-bot) — checar antes de tudo
  if (isBlockedPage(html, statusCode)) {
    return {
      url,
      nota: 0,
      status: 'Bloqueado',
      faltando: 'WAF/anti-bot bloqueou o acesso (não auditável sem proxy residencial)',
      json_ld_sugerido: ''
    };
  }

  // 2) ERRO HTTP real (403, 404, 500…)
  if (!html || html.trim() === '' || statusCode >= 400) {
    return {
      url,
      nota: 0,
      status: 'Crítico',
      faltando: erroHttp
        ? 'erro-http: ' + String(erroHttp).substring(0, 80)
        : 'html-vazio (bloqueio/timeout?)',
      json_ld_sugerido: ''
    };
  }

  // 3) AUDITORIA NORMAL
  let nota = 0;
  const faltando = [];
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const headHtml = headMatch ? headMatch[1] : html;

  if (/<title[^>]*>[\s\S]+?<\/title>/i.test(headHtml)) nota += 25; else faltando.push('title');
  if (/<meta[^>]+property=["']og:image["'][^>]*>/i.test(html)) nota += 25; else faltando.push('og:image');
  if (/<meta[^>]+property=["']og:price:amount["'][^>]*>/i.test(html)) nota += 25; else faltando.push('og:price:amount');
  if (/<script[^>]+type=["']application\/ld\+json["'][^>]*>/i.test(html)) nota += 25; else faltando.push('json-ld');

  let status = 'Crítico';
  if (nota >= 75) status = 'Pronto';
  else if (nota >= 50) status = 'Básico';

  let prodName = 'Produto exemplo';
  let prodImage = 'https://exemplo.com/imagem.jpg';
  const mTitle = headHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (mTitle && mTitle[1]) prodName = mTitle[1].trim().substring(0, 150);
  const mImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (mImg && mImg[1]) prodImage = mImg[1];

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Product',
    'name': prodName, 'image': prodImage,
    'description': 'Descricao do produto em ' + url,
    'brand': { '@type': 'Brand', 'name': 'Marca do produto' },
    'offers': {
      '@type': 'Offer', 'url': url, 'priceCurrency': 'BRL',
      'price': '0.00', 'availability': 'https://schema.org/InStock'
    }
  };

  return {
    url,
    nota,
    status,
    faltando: faltando.join(', '),
    json_ld_sugerido: JSON.stringify(jsonLd)
  };
}

function csvEscape(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/["\n,]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

(async () => {
  console.log('Iniciando navegador...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: {
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const page = await context.newPage();

  const header = 'url,nota,status,faltando,json_ld_sugerido\n';
  if (!fs.existsSync(CSV_PATH)) fs.writeFileSync(CSV_PATH, header);
  const linhas = [];

  for (const url of urls) {
    console.log('Auditando:', url);
    const resp = await fetchHtml(page, url);
    const r = auditar(url, resp);
    console.log('  -> HTTP:', resp.statusCode, '| HTML:', resp.body.length, 'chars | Status:', r.status, '| Nota:', r.nota);
    linhas.push([r.url, r.nota, r.status, r.faltando, r.json_ld_sugerido].map(csvEscape).join(','));
  }

  fs.appendFileSync(CSV_PATH, linhas.join('\n') + '\n');
  await browser.close();
  console.log('OK - ' + linhas.length + ' URLs auditadas');
  console.log('CSV: ' + CSV_PATH);
})();