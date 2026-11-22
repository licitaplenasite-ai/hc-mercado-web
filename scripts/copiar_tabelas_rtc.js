// Robô da tabela oficial de classificação tributária (cClassTrib) da Reforma, usada pelo agente "Contador".
// Copia, da Calculadora de Tributos oficial (Receita Federal, API pública sem chave), três GETs por dia:
//   dados-abertos/versao, dados-abertos/classificacoes-tributarias/cbs-ibs e dados-abertos/fundamentacoes-legais.
// Grava um blob só em dados_robo (chave RTC_CHAVE): ~170 linhas com redução de CBS/IBS, tipo (NCM/NBS) e base legal.
// Incremental: se a versão da base oficial (versaoDb) não mudou, não regrava. Nada vai para o git.
//
// Uso: node scripts/copiar_tabelas_rtc.js
// Variável obrigatória: SUPABASE_SERVICE_ROLE_KEY
// Opcionais:
//   RTC_BASE=https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api/calculadora  -> endereço da API oficial
//   RTC_DATA=<1º de janeiro do ano seguinte>   -> data de vigência consultada (AAAA-MM-DD)
//   RTC_PAUSA_MS=3000                          -> pausa entre os GETs (o firewall da Receita bloqueia rajadas)
//   RTC_FORCAR=1                               -> regrava mesmo com a mesma versão
const { buscarBlob, salvarBlob } = require("./supabase_dados");

const RTC_BASE = process.env.RTC_BASE || "https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api/calculadora";
const RTC_DATA = process.env.RTC_DATA || `${new Date().getUTCFullYear() + 1}-01-01`;
const RTC_PAUSA_MS = parseInt(process.env.RTC_PAUSA_MS || "3000", 10);
const RTC_CHAVE = "rtc_classificacoes";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Junta a tabela de cClassTrib com a fundamentação legal (texto curto, ex.: "Art. 125"). Puro: testado.
function montarTabela(classificacoes, fundamentacoes, versao) {
  if (!Array.isArray(classificacoes) || classificacoes.length < 50) throw new Error(`Tabela oficial veio incompleta (${Array.isArray(classificacoes) ? classificacoes.length : "sem lista"} linhas).`);
  const legal = new Map();
  for (const f of Array.isArray(fundamentacoes) ? fundamentacoes : []) {
    const c = String(f?.codigoClassificacaoTributaria || "");
    if (/^\d{6}$/.test(c) && f.textoCurto && !legal.has(c)) legal.set(c, String(f.textoCurto).slice(0, 120));
  }
  const linhas = classificacoes.filter((c) => /^\d{6}$/.test(String(c?.codigo || ""))).map((c) => ({
    codigo: c.codigo, descricao: String(c.descricao || "").slice(0, 300), nomenclatura: String(c.nomenclatura || ""),
    reducaoCbs: num(c.percentualReducaoCbs), reducaoIbsUf: num(c.percentualReducaoIbsUf), reducaoIbsMun: num(c.percentualReducaoIbsMun),
    tipoAliquota: String(c.tipoAliquota || ""), creditoCbs: c.indicaApropriacaoCreditoAdquirenteCbs !== false, baseLegal: legal.get(c.codigo) || null,
  }));
  return { versaoDb: String(versao?.versaoDb || ""), dataVersaoDb: versao?.dataVersaoDb || null, descricao: String(versao?.descricaoVersaoDb || "").slice(0, 300),
    vigencia: RTC_DATA, copiadoEm: new Date().toISOString(), fonte: RTC_BASE, linhas };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function obter(caminho) {
  const r = await fetch(`${RTC_BASE}/${caminho}`, { headers: { Accept: "application/json" }, signal: globalThis.AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Calculadora oficial ${caminho.split("?")[0]} -> HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const versao = await obter("dados-abertos/versao");
  const atual = await buscarBlob("dados_robo", RTC_CHAVE).catch(() => null);
  if (atual?.versaoDb === versao.versaoDb && process.env.RTC_FORCAR !== "1") {
    console.log(`Tabela oficial sem mudança (${versao.versaoDb}). Nada a gravar.`);
    return;
  }
  await esperar(RTC_PAUSA_MS);
  const classificacoes = await obter(`dados-abertos/classificacoes-tributarias/cbs-ibs?data=${RTC_DATA}`);
  await esperar(RTC_PAUSA_MS);
  const fundamentacoes = await obter(`dados-abertos/fundamentacoes-legais?data=${RTC_DATA}`).catch((e) => { console.warn(`Base legal indisponível: ${e.message}`); return []; });
  const tabela = montarTabela(classificacoes, fundamentacoes, versao);
  await salvarBlob("dados_robo", RTC_CHAVE, tabela);
  console.log(`Tabela oficial ${tabela.versaoDb} gravada: ${tabela.linhas.length} classificações, ${tabela.linhas.filter((l) => l.baseLegal).length} com base legal.`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { montarTabela, RTC_CHAVE };
