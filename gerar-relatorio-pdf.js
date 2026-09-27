/**
 * ProntoPraIA - Gerador de Relatorio PDF
 * Le resultados_auditoria.csv e gera Relatorio_Auditoria_ProntoPraIA.pdf com pdfmake.
 * Uso: node gerar-relatorio-pdf.js
 */
const fs = require('fs');
const path = require('path');
const csv = require('csvtojson');
const PdfPrinter = require('pdfmake');

const CSV_PATH = path.join(__dirname, 'resultados_auditoria.csv');
const PDF_PATH = path.join(__dirname, 'Relatorio_Auditoria_ProntoPraIA.pdf');

const LIME = '#b6f542';
const CYAN = '#2ed6e6';
const DARK = '#0f172a';
const MUTED = '#64748b';
const ALERT = '#d97706'; // laranja/amarelo p/ alertas de erro HTTP

// --- Helpers de erro HTTP (apenas exibicao; nao alteram nota) ---
// Detecta o codigo HTTP (403/404/500/...) dentro do campo "faltando" do CSV.
function detectHttpCode(faltando) {
  const s = String(faltando || '');
  const m = s.match(/erro-http:\s*(\d{3})/i) || s.match(/\b(40[0-9]|4[0-3][0-9]|5[0-9]{2})\b/);
  return m ? m[1] : null;
}

function isBlocked403(faltando) {
  const s = String(faltando || '').toLowerCase();
  return s.includes('erro-http: 403') || s.includes('bloqueio de segurança');
}

// Recomendacao consultiva por codigo de erro (argumento de venda).
function recomendacaoPorErro(code) {
  if (code === '403') return 'Configurar exceções no firewall para bots legítimos de IA (GPTBot, Google-Extended, PerplexityBot).';
  if (code === '404') return 'URL quebrada ou produto removido. Verificar se o link está correto.';
  if (code && code.startsWith('5')) return 'Erro interno do servidor. Contatar a equipe técnica do e-commerce.';
  if (code) return 'Falha HTTP ' + code + '. Verificar URL, robots.txt e regras do firewall.';
  return 'HTML vazio ou sem dados. Verificar bloqueio anti-bot, timeout ou URL inválida.';
}

// Texto consultivo exibido na tabela p/ erro 403 (em vez do cru "erro-http: 403").
function faltandoDisplay(faltando) {
  if (isBlocked403(faltando)) return '⚠️ Bloqueio de Segurança Detectado (HTTP 403)';
  return faltando;
}

const NOTA_403 = 'O servidor está recusando conexões de agentes automatizados. Isso pode indicar que o firewall (ex: Cloudflare) está bloqueando não apenas bots maliciosos, mas também rastreadores legítimos do Google, ChatGPT e Gemini. Ajustes nas regras de robots.txt e cabeçalhos de segurança são recomendados.';

// pdfmake (Node) com as 14 fontes padrao do PDF - sem arquivos .ttf externos.
const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  },
  Courier: {
    normal: 'Courier',
    bold: 'Courier-Bold',
    italics: 'Courier-Oblique',
    bolditalics: 'Courier-BoldOblique'
  }
};

function normKey(k) {
  return String(k || '').trim().toLowerCase().replace(/["'\s]/g, '');
}

function normalizeRow(raw) {
  const map = {};
  for (const k of Object.keys(raw)) map[normKey(k)] = raw[k];
  const get = (...names) => {
    for (const n of names) {
      const v = map[normKey(n)];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const notaNum = parseFloat(get('nota').replace(',', '.'));
  return {
    url: get('url'),
    nota: Number.isFinite(notaNum) ? Math.max(0, Math.min(100, Math.round(notaNum))) : 0,
    status: get('status') || '—',
    faltando: get('faltando', 'missing', 'faltantes') || '—',
    jsonLd: get('json_ld_sugerido', 'json_ld', 'jsonld', 'json-ld')
  };
}

function statusColor(status) {
  const s = String(status).toLowerCase();
  if (s.includes('pronto')) return '#16a34a';
  if (s.includes('básico') || s.includes('basico')) return '#d97706';
  return '#dc2626';
}

function statusGeral(media, total) {
  if (total === 0) return 'Sem dados';
  if (media >= 75) return 'Pronto';
  if (media >= 50) return 'Básico';
  return 'Crítico';
}

function prettyJsonLd(raw) {
  if (!raw) return '// Nenhum JSON-LD sugerido no CSV.';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch (e1) {
    const unq = raw.replace(/^"+|"+$/g, '').replace(/""/g, '"');
    try {
      return JSON.stringify(JSON.parse(unq), null, 2);
    } catch (e2) {
      return raw;
    }
  }
}

async function main() {
  let rows = [];
  if (fs.existsSync(CSV_PATH)) {
    try {
      const parsed = await csv().fromFile(CSV_PATH);
      rows = parsed.map(normalizeRow).filter(r => r.url || r.jsonLd);
    } catch (err) {
      console.error('AVISO: falha ao ler CSV, gerando PDF com aviso:', err.message);
      rows = [];
    }
  }

  const total = rows.length;
  const media = total > 0 ? Math.round(rows.reduce((a, r) => a + r.nota, 0) / total) : 0;
  const geral = statusGeral(media, total);
  const dataStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const tableBody = [
    [
      { text: 'URL', style: 'th' },
      { text: 'Nota', style: 'th', alignment: 'center' },
      { text: 'Status', style: 'th', alignment: 'center' },
      { text: 'Faltando', style: 'th' }
    ]
  ];
  for (const r of rows) {
    const code = detectHttpCode(r.faltando);
    if (isBlocked403(r.faltando)) {
      // Linha principal do produto com alerta consultivo (laranja) ...
      tableBody.push([
        { text: r.url || '—', style: 'tdUrl' },
        { text: String(r.nota), style: 'tdCenter', color: statusColor(r.status), bold: true },
        { text: r.status, style: 'tdCenter' },
        { text: faltandoDisplay(r.faltando), style: 'tdAlert', color: ALERT, bold: true }
      ]);
      // ... + linha de nota explicativa ocupando as 4 colunas.
      tableBody.push([
        { text: NOTA_403, colSpan: 4, style: 'tdNote', color: '#92400e' },
        {}, {}, {}
      ]);
    } else if (code) {
      // Outros erros HTTP: destaca o codigo sem a nota longa do 403.
      tableBody.push([
        { text: r.url || '—', style: 'tdUrl' },
        { text: String(r.nota), style: 'tdCenter', color: statusColor(r.status), bold: true },
        { text: r.status, style: 'tdCenter' },
        { text: '⚠️ Erro HTTP ' + code + ' — ' + r.faltando, style: 'td', color: ALERT }
      ]);
    } else {
      tableBody.push([
        { text: r.url || '—', style: 'tdUrl' },
        { text: String(r.nota), style: 'tdCenter', color: statusColor(r.status), bold: true },
        { text: r.status, style: 'tdCenter' },
        { text: r.faltando, style: 'td' }
      ]);
    }
  }
  if (total === 0) {
    tableBody.push([
      { text: 'Nenhum dado em resultados_auditoria.csv - rode o workflow n8n primeiro.', colSpan: 4, style: 'tdEmpty', alignment: 'center' },
      {}, {}, {}
    ]);
  }

  const exemploJsonLd = total > 0
    ? prettyJsonLd(rows[0].jsonLd)
    : '// Rode o workflow do n8n para gerar resultados_auditoria.csv primeiro.';

  // --- Secao "Notas Tecnicas e Recomendacoes" (antes do apendice) ---
  // Lista todos os produtos com erro HTTP + recomendacao consultiva por codigo.
  const errosHttp = rows
    .map(r => ({ url: r.url, code: detectHttpCode(r.faltando), raw: r.faltando }))
    .filter(e => e.code);
  const notasContent = errosHttp.length === 0
    ? [
        { text: 'Notas Técnicas e Recomendações', style: 'h2' },
        { text: 'Nenhum erro HTTP detectado nesta auditoria. Todos os produtos responderam normalmente.', fontSize: 9, color: MUTED, margin: [0, 0, 0, 12] }
      ]
    : [
        { text: 'Notas Técnicas e Recomendações', style: 'h2' },
        {
          text: 'Os produtos abaixo recusaram a conexao automatizada. Longe de ser apenas um problema tecnico, isso e um sinal de alerta comercial: se o firewall bloqueia nossa auditoria, ele provavelmente tambem bloqueia os rastreadores do Google, ChatGPT e Gemini — e seus produtos ficam invisiveis para a IA.',
          fontSize: 9,
          color: '#334155',
          margin: [0, 0, 0, 6]
        },
        {
          ul: errosHttp.map(e => ([
            { text: '⚠️ ' + (e.url || 'URL desconhecida') + ' — Erro ' + e.code + '\n', bold: true, color: ALERT },
            { text: recomendacaoPorErro(e.code) + '\n', color: '#334155' }
          ])),
          fontSize: 9,
          margin: [0, 0, 0, 12]
        }
      ];

//__PART3__
  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 100, 40, 50],
    defaultStyle: { font: 'Helvetica', fontSize: 10, color: '#1e293b' },
    header: {
      margin: [0, 0, 0, 0],
      stack: [
        { canvas: [{ type: 'rect', x: 0, y: 0, w: 595.28, h: 72, color: DARK }] },
        {
          columns: [
            {
              margin: [40, -58, 0, 0],
              stack: [
                { text: 'ProntoPraIA', fontSize: 20, bold: true, color: LIME },
                { text: 'Relatório de Prontidão para Agentes de IA', fontSize: 10, color: '#e2e8f0' }
              ]
            },
            {
              margin: [0, -50, 40, 0],
              alignment: 'right',
              stack: [
                { text: dataStr, fontSize: 10, color: CYAN, bold: true },
                { text: total + ' produto(s) auditado(s)', fontSize: 8, color: '#94a3b8' }
              ]
            }
          ]
        },
        {
          canvas: [
            { type: 'line', x1: 0, y1: 4, x2: 200, y2: 4, lineWidth: 3, lineColor: LIME },
            { type: 'line', x1: 200, y1: 4, x2: 400, y2: 4, lineWidth: 3, lineColor: CYAN }
          ],
          margin: [0, 6, 0, 0]
        }
      ]
    },
    footer: function (currentPage, pageCount) {
      return {
        margin: [40, 10, 40, 0],
        columns: [
          { text: 'ProntoPraIA - prontopraia', fontSize: 8, color: MUTED },
          { text: 'Página ' + currentPage + ' de ' + pageCount, fontSize: 8, color: MUTED, alignment: 'right' }
        ]
      };
    },
    content: [
      { text: 'Resumo Executivo', style: 'h2' },
      {
        columns: [
          {
            width: '50%',
            stack: [
              { canvas: [{ type: 'rect', x: 0, y: 0, w: 235, h: 90, r: 8, color: '#f1f5f9' }] },
              {
                margin: [0, -78, 0, 0],
                alignment: 'center',
                stack: [
                  { text: 'NOTA MÉDIA', fontSize: 9, bold: true, color: MUTED },
                  { text: media + '/100', fontSize: 30, bold: true, color: DARK },
                  { text: 'Status geral: ' + geral, fontSize: 10, bold: true, color: statusColor(geral) }
                ]
              }
            ]
          },
          {
            width: '50%',
            margin: [10, 0, 0, 0],
            stack: [
              { text: 'O que isso significa', fontSize: 11, bold: true, color: DARK, margin: [0, 0, 0, 4] },
              {
                ul: [
                  '75-100 (Pronto): o ChatGPT e as buscas com IA conseguem recomendar seus produtos.',
                  '50-74 (Básico): faltam dados importantes - voce perde vendas para concorrentes.',
                  '0-49 (Crítico): produtos praticamente invisíveis para os agentes de IA.'
                ],
                fontSize: 9,
                color: '#334155'
              }
            ]
          }
        ],
        margin: [0, 0, 0, 12]
      },
      { text: 'Detalhe por Produto', style: 'h2' },
      {
        table: { headerRows: 1, widths: ['*', 40, 70, '*'], body: tableBody },
        layout: {
          fillColor: function (row) { return row === 0 ? DARK : null; },
          hLineColor: function () { return '#e2e8f0'; },
          vLineColor: function () { return '#e2e8f0'; }
        },
        margin: [0, 0, 0, 12]
      },
      ...notasContent,
      { text: 'Apêndice - Exemplo de JSON-LD Sugerido', style: 'h2' },
      {
        text: 'Cole este bloco na página do produto (dentro de script application/ld+json) para ajudar as IAs a entenderem preco, imagem e disponibilidade.',
        fontSize: 9,
        color: MUTED,
        margin: [0, 0, 0, 6]
      },
      { text: exemploJsonLd, font: 'Courier', fontSize: 8, color: '#0f172a', background: '#f8fafc', margin: [0, 0, 0, 8] }
    ],
    styles: {
      h2: { fontSize: 14, bold: true, color: DARK, margin: [0, 6, 0, 8] },
      th: { fontSize: 9, bold: true, color: '#ffffff' },
      td: { fontSize: 8.5, color: '#334155' },
      tdUrl: { fontSize: 8, color: '#0369a1' },
      tdCenter: { fontSize: 9, alignment: 'center' },
      tdEmpty: { fontSize: 9, italics: true, color: MUTED },
      tdAlert: { fontSize: 8.5, color: '#92400e' },
      tdNote: { fontSize: 7.5, italics: true, color: '#92400e' }
    }
  };

  const printer = new PdfPrinter(fonts);
  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(PDF_PATH);
    pdfDoc.pipe(stream);
    pdfDoc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  const size = fs.statSync(PDF_PATH).size;
  console.log('PDF gerado: ' + PDF_PATH + ' (' + size + ' bytes, ' + total + ' produto(s), media ' + media + '/100)');
}

main().catch(err => {
  console.error('ERRO ao gerar o PDF:', err);
  process.exit(1);
});


