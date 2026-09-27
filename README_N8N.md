# Guia n8n — ProntoPraIA: Auditoria de Produto

Workflow: `workflow-prontopraia.json`
Saída: `resultados_auditoria.csv` (colunas: URL, Nota, Status, Faltando, JSON_LD_Sugerido)

Fluxo (4 nós):
1. **Manual Trigger** — já vem com 3 URLs de exemplo fixadas (pinData): Nike, Amazon, Magalu.
2. **Buscar HTML Produto** (HTTP Request, GET `={{ $json.url }}`) — retorna o HTML como texto (`data`).
3. **Auditoria ProntoPraIA** (Code) — calcula nota 0–100, status e JSON-LD sugerido.
4. **Salvar CSV** (Spreadsheet File, operação Write) — grava `resultados_auditoria.csv`.

## 1. Como importar no n8n (passo a passo)

1. Abra sua instância do n8n (ex: `http://localhost:5678`).
2. No menu superior esquerdo (⋯) ou em **Workflows**, clique em **Import from File**.
3. Selecione o arquivo `workflow-prontopraia.json` deste projeto.
4. O workflow **"ProntoPraIA - Auditoria de Produto"** vai abrir no canvas com os 4 nós já conectados.
5. (Importante) As 3 URLs de teste vêm via **pinData** no nó Manual Trigger. Para ver/editar:
   clique no nó **Manual Trigger** → aba de dados fixados (pinned) → edite o array `url` se quiser trocar os produtos.
6. Clique em **Execute Workflow** (ou **Test workflow**) para rodar.
7. Verifique o arquivo `resultados_auditoria.csv` gerado onde o n8n roda
   (se o n8n roda em Docker, o arquivo fica **dentro do container** — veja item 4 abaixo).

## 2. Como funciona a auditoria (nó Code)

| Checagem no HTML | Pontos |
|---|---|
| `<title>` | +25 |
| `<meta property="og:image"` | +25 |
| `<meta property="og:price:amount"` | +25 |
| `<script type="application/ld+json"` | +25 |

- **Nota** = soma (máx 100).
- **Status**: `Crítico` (0–49) · `Básico` (50–74) · `Pronto` (75–100).
- **Faltando** = string separada por vírgula, ex: `og:price:amount, json-ld`.
- **json_ld_sugerido** = objeto `@type: Product` (Schema.org) com nome/imagem extraídos do HTML quando possível + `offers` em BRL. Sai como string JSON pronta para colar no CSV.

## 3. Migrando para Google Sheets no futuro

### 3.1. Trocar o Nó 1 (Manual Trigger → Google Sheets Trigger ou Read)

**Opção A — Ler planilha (mais simples, mantém teste manual):**
1. Adicione um nó **Google Sheets** → operação **Read** (ou **Get Rows**).
2. Conecte sua credencial (ver 3.3).
3. Configure: **Document** (sua planilha) + **Sheet** (ex: `URLs`, coluna `url`).
4. Delete a conexão Manual Trigger → HTTP Request e ligue Google Sheets → **Buscar HTML Produto**.
5. Garanta que cada linha saia como `{ "url": "https://..." }` (o HTTP Request espera `{{ $json.url }}`).

**Opção B — Gatilho automático:**
1. Use o nó **Google Sheets Trigger** (dispara quando linha é adicionada/atualizada).
2. Ligue a saída dele no **Buscar HTML Produto**. O resto do fluxo não muda.

### 3.2. Trocar o Nó 4 (Salvar CSV → Escrever no Google Sheets)

1. Adicione um nó **Google Sheets** → operação **Append** (ou **Update**).
2. Conecte a mesma credencial.
3. Mapeie as colunas:
   - `URL` ← `{{ $json.url }}`
   - `Nota` ← `{{ $json.nota }}`
   - `Status` ← `{{ $json.status }}`
   - `Faltando` ← `{{ $json.faltando }}`
   - `JSON_LD_Sugerido` ← `{{ $json.json_ld_sugerido }}`
4. Delete ou desative o nó **Salvar CSV** e ligue **Auditoria ProntoPraIA** → Google Sheets.

### 3.3. Configurar credencial Google no n8n

1. No n8n: **Credentials** → **New** → **Google Sheets OAuth2 API**.
2. No [Google Cloud Console](https://console.cloud.google.com/):
   - Crie um projeto → ative **Google Sheets API** (e **Google Drive API** se for criar arquivos).
   - **APIs & Services → Credentials → Create Credentials → OAuth client ID** (tipo Web/Desktop).
   - Adicione a **Redirect URL** que o n8n mostra na tela da credencial.
3. Copie **Client ID** e **Client Secret** para o n8n → **Connect** → autorize com sua conta Google.
4. Teste: rode o nó Google Sheets com **Execute Step**.

## 4. Atenção: onde fica o CSV?

- O nó **Spreadsheet File (Write)** salva no **sistema de arquivos do processo do n8n**.
- **n8n local (npm):** `resultados_auditoria.csv` cai na pasta onde você iniciou o n8n. Para salvar na raiz do projeto, use caminho absoluto em **File Name**, ex: `c:\Users\User\Desktop\prontopraia\resultados_auditoria.csv` — ou copie o arquivo depois.
- **n8n em Docker:** o arquivo fica dentro do container. Monte um volume (ex: `-v C:/Users/User/Desktop/prontopraia:/files`) e ajuste o **File Name** para `/files/resultados_auditoria.csv`, ou troque pelo Google Sheets (item 3.2).

## 5. Solução de problemas

| Sintoma | Causa provável / solução |
|---|---|
| HTTP Request retorna 403/bloqueio | Site com anti-bot (Amazon/Nike bloqueiam às vezes). Troque por outra URL de produto ou adicione retry/header. O nó já envia um `User-Agent` de navegador. |
| `url` vazio no HTTP Request | O pinData foi perdido na importação. Re-fixe os dados no Manual Trigger (cole o array de `pinData` do JSON) ou substitua pelo Google Sheets Read. |
| CSV com colunas erradas | O Spreadsheet File usa as chaves `url, nota, status, faltando, json_ld_sugerido`. Não renomeie as chaves no nó Code sem ajustar o cabeçalho. |
| Erro de importação do JSON | Versão antiga do n8n. Atualize o n8n (`npm i -g n8n` ou nova imagem Docker) e importe de novo. |

## 6. Geração Automática de PDF

O workflow termina com o nó **Gerar PDF** (`Execute Command`), que roda `node gerar-relatorio-pdf.js` após o **Salvar CSV** gerar o `resultados_auditoria.csv`. O script lê o CSV e gera o `Relatorio_Auditoria_ProntoPraIA.pdf` (cabeçalho ProntoPraIA, resumo executivo com nota média, tabela por produto e apêndice com exemplo de JSON-LD).

**Pré-requisito (obrigatório antes de usar o n8n):** rode na pasta do projeto:

```powershell
npm install
```

Isso instala `pdfmake` (gera o PDF sem navegador headless) e `csvtojson` (lê o CSV do n8n), conforme o `package.json`.

**Atenção Docker:** o comando `node gerar-relatorio-pdf.js` precisa rodar **na mesma máquina onde estão o CSV e o `node_modules`**. Se o n8n roda em Docker, o `Execute Command` executa **dentro do container** (sem acesso ao seu projeto). Opções:
1. Rodar o n8n local via `npx n8n` na pasta do projeto (recomendado para teste).
2. Ou gerar o PDF manualmente: `npm install` + `node gerar-relatorio-pdf.js` na raiz do projeto.
3. Ou montar o projeto como volume no container e instalar as dependências lá dentro.
