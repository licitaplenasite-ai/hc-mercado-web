// Pagômetro: prazo médio de pagamento em dias (24 e 36 meses). Completa a fila pagometro_prazos que a função
// /api/pagometro abre quando um licitante abre o resumo de um edital. Contas em netlify/functions/_pagometro.js;
// metodologia em _historico/pagometro-metodologia-20261120.md.
//   node scripts/coletar_pagometro_prazos.js
//   - Município de SP (fonte "tce-sp"): API aberta do TCE-SP, sem chave. Lê os últimos MESES_PAGOMETRO + 3 meses
//     (as 3 a mais trazem a liquidação de quem foi pago no começo da janela). Todos os pagamentos a CNPJ.
//   - Órgão federal (fonte "transparencia"): API do Portal da Transparência com TRANSPARENCIA_TOKEN. Amostra: um
//     dia útil por mês (dia 15 ou o útil seguinte), até AMOSTRA_DIA_PAGOMETRO pagamentos a CNPJ por dia e, de cada
//     um, os documentos relacionados (a liquidação). Sem token, a linha fica pendente e o robô avisa.
// Env: SUPABASE_SERVICE_ROLE_KEY (obrigatória), TRANSPARENCIA_TOKEN, LOTE_PAGOMETRO (5 por rodada),
// MESES_PAGOMETRO (36), AMOSTRA_DIA_PAGOMETRO (3), PAUSA_MS_PAGOMETRO (700: o Portal aceita 90 chamadas/min de dia),
// LIMITE_MINUTOS (20).
const fs = require("node:fs");
const path = require("node:path");
const P = require("../netlify/functions/_pagometro");
const { restFetch } = require("./supabase_dados");

const LOTE = Math.max(1, Number(process.env.LOTE_PAGOMETRO || 5));
const MESES = Math.max(1, Number(process.env.MESES_PAGOMETRO || 36));
const AMOSTRA_DIA = Math.max(1, Number(process.env.AMOSTRA_DIA_PAGOMETRO || 3));
const PAUSA_MS = Math.max(0, Number(process.env.PAUSA_MS_PAGOMETRO || 700));
const LIMITE_MS = Math.max(1, Number(process.env.LIMITE_MINUTOS || 20)) * 60000;
const TCE = "https://transparencia.tce.sp.gov.br/api/json";
const PORTAL = "https://api.portaldatransparencia.gov.br/api-de-dados";
// Falha volta para a fila depois de 1 dia (a função refaz pedido de linha com mais de 30 dias).
const REPETIR_FALHA_MS = 29 * 864e5;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url, headers = {}) {
  await esperar(PAUSA_MS);
  const r = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: globalThis.AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url.split("?")[0]}`);
  return r.json();
}

// Meses fechados, do mais antigo ao mais recente: [{ano, mes}].
function mesesAte(agora, quantos) {
  const lista = [];
  const d = new Date(Date.UTC(new Date(agora).getUTCFullYear(), new Date(agora).getUTCMonth(), 1));
  for (let i = quantos; i >= 1; i--) { const m = new Date(d); m.setUTCMonth(m.getUTCMonth() - i); lista.push({ ano: m.getUTCFullYear(), mes: m.getUTCMonth() + 1 }); }
  return lista;
}

async function municipioTceSp(ibge) {
  const capag = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/capag-municipios.json"), "utf8"));
  const m = capag.municipios.find((x) => x.ibge === ibge);
  if (!m) throw new Error("município não está na base IBGE local");
  const lista = await json(`${TCE}/municipios`);
  const achado = lista.find((x) => P.slugTceSp(x.municipio_extenso) === P.slugTceSp(m.municipio));
  if (!achado) throw new Error("município não encontrado na API do TCE-SP");
  return { slug: achado.municipio, nome: `${m.municipio} (SP) - todos os órgãos municipais` };
}

async function coletarTceSp(ibge, agora) {
  const { slug, nome } = await municipioTceSp(ibge);
  const eventos = [];
  for (const { ano, mes } of mesesAte(agora, MESES + 3)) eventos.push(...P.eventosTceSp(await json(`${TCE}/despesas/${slug}/${ano}/${mes}`)));
  return { nome, ...P.prazosDePagamento(eventos, agora) };
}

function diaUtil15(ano, mes) {
  const d = new Date(Date.UTC(ano, mes - 1, 15));
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
}

async function coletarFederal(ug, agora, token) {
  const h = { "chave-api-dados": token };
  const eventos = [];
  let nome = null;
  for (const { ano, mes } of mesesAte(agora, MESES)) {
    const docs = await json(`${PORTAL}/despesas/documentos?${new URLSearchParams({ unidadeGestora: ug, dataEmissao: diaUtil15(ano, mes), fase: "3", pagina: "1" })}`, h);
    for (const pg of (Array.isArray(docs) ? docs : []).filter((d) => /^\d{14}$/.test(String(d.codigoFavorecido || ""))).slice(0, AMOSTRA_DIA)) {
      nome ||= pg.ug || null;
      const rel = await json(`${PORTAL}/despesas/documentos-relacionados?${new URLSearchParams({ codigoDocumento: pg.documento, fase: "3" })}`, h);
      eventos.push(...P.eventosFederal(pg, rel));
    }
  }
  return { nome: nome ? `${nome} (UG ${ug})` : `UG ${ug}`, ...P.prazosDePagamento(eventos, agora) };
}

async function gravar(chave, campos) {
  await restFetch(`pagometro_prazos?chave=eq.${encodeURIComponent(chave)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(campos) });
}

async function main() {
  const inicio = Date.now();
  const token = process.env.TRANSPARENCIA_TOKEN || "";
  const fila = await (await restFetch(`pagometro_prazos?situacao=eq.pendente&select=chave,fonte&order=pedido_em&limit=${LOTE}`)).json();
  console.log(`Pagômetro prazos: ${fila.length} pendente(s).`);
  for (const { chave, fonte } of fila) {
    if (Date.now() - inicio > LIMITE_MS) { console.log("Tempo da rodada esgotado; o resto fica para a próxima."); break; }
    if (fonte === "transparencia" && !token) { console.warn(`${chave}: sem TRANSPARENCIA_TOKEN, fica pendente.`); continue; }
    const agora = Date.now();
    try {
      const r = fonte === "tce-sp" ? await coletarTceSp(chave.slice(2), agora) : await coletarFederal(chave.slice(2), agora, token);
      await gravar(chave, { ...r, situacao: "pronto", erro: null, coletado_em: new Date(agora).toISOString() });
      console.log(`${chave}: 24m ${r.dias_24m ?? "-"} dias (${r.amostra_24m}), 36m ${r.dias_36m ?? "-"} dias (${r.amostra_36m}).`);
    } catch (e) {
      console.warn(`${chave}: falhou: ${e.message}`);
      await gravar(chave, { situacao: "falhou", erro: e.message.slice(0, 300), coletado_em: new Date(agora - REPETIR_FALHA_MS).toISOString() });
    }
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { mesesAte, diaUtil15 };
