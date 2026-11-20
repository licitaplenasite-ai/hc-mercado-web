// Pagômetro (BETA): "este ente costuma pagar em dia?". Indicador com base no RREO Anexo 7 (Restos a Pagar)
// que o próprio ente declara ao Tesouro (SICONFI, API pública sem chave). Conta em _pagometro.js.
//   GET /api/pagometro?ente=1302603   (7 dígitos = município IBGE; 2 dígitos = estado/DF)
// Só cadastro aprovado. Cache compartilhado de 15 dias por ente em pagometro_entes (dado muda 1x/ano, com
// retificações): quem pergunta de novo não gasta fonte nem cota.
//   GET /api/pagometro?prazo=F:160001 | M:3509502  -> prazo médio de pagamento em dias (24 e 36 meses), tabela
// pagometro_prazos. Pesado demais para uma requisição (até 39 meses do TCE-SP ou ~150 chamadas ao Portal da
// Transparência): a função só abre o pedido na fila e o robô scripts/coletar_pagometro_prazos.js calcula.
// Ente sem fonte pública de datas de pagamento responde situacao "sem_fonte", sem tocar no banco. Sem chave de serviço (ambiente local sem
// banco) calcula e devolve sem guardar. Orçamento Cloudflare: login 2 + cache 1 + cota 1 + SICONFI 2 + grava 1.
const { cabecalhosPadrao, exigirUsuarioAprovado, verificarLimiteDiario } = require("./_auth");
const P = require("./_pagometro");

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const VALIDADE_MS = 15 * 24 * 3600 * 1000;
const LIMITE_DIARIO = 60;
const VALIDADE_PRAZO_MS = 30 * 24 * 3600 * 1000;
const MAX_FILA_PRAZOS = 200;

async function rest(caminho, opcoes = {}) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { ...opcoes, signal: globalThis.AbortSignal.timeout(10000),
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json", ...(opcoes.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${caminho.split("?")[0]} HTTP ${r.status}`);
  return r;
}

// Último ano fechado (6º bimestre). Até o fim de janeiro o ano anterior ainda não foi entregue: cai um ano.
async function coletar(idEnte, { fetchImpl = (...a) => fetch(...a), agora = Date.now() } = {}) {
  const anoAtual = new Date(agora - 3 * 36e5).getUTCFullYear();
  for (const ano of [anoAtual - 1, anoAtual - 2]) {
    const fonte = P.urlRreo(idEnte, ano);
    const r = await fetchImpl(fonte, { headers: { Accept: "application/json" }, signal: globalThis.AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`SICONFI HTTP ${r.status}`);
    const calculo = P.calcular((await r.json())?.items, { idEnte, ano, fonte });
    if (calculo) return calculo;
  }
  return null;
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "private, max-age=3600" };
  const responder = (statusCode, body) => ({ statusCode, headers: statusCode === 200 ? headers : { ...headers, "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return responder(204, {});
  if (event.httpMethod !== "GET") return responder(405, { erro: "Método não permitido." });
  const chavePrazo = event.queryStringParameters?.prazo;
  if (chavePrazo !== undefined) return prazo(event, String(chavePrazo), responder);
  const idEnte = String(event.queryStringParameters?.ente || "");
  if (!P.esferaDoEnte(idEnte)) return responder(400, { erro: "Informe o código IBGE do município (7 dígitos) ou do estado (2 dígitos)." });
  const usuario = await exigirUsuarioAprovado(event);
  if (!usuario.ok) return responder(usuario.status, { erro: usuario.erro });
  const comBanco = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const [guardado] = comBanco ? await (await rest(`pagometro_entes?id_ente=eq.${idEnte}&select=*`)).json() : [];
    if (guardado && Date.now() - Date.parse(guardado.coletado_em) < VALIDADE_MS) return responder(200, { ...guardado, guardado: true });
    const cota = await verificarLimiteDiario(usuario.userId, "pagometro", LIMITE_DIARIO);
    if (!cota.ok) return guardado ? responder(200, { ...guardado, guardado: true, vencido: true }) : responder(429, { erro: cota.erro || "Limite diário de consultas atingido. Tente amanhã." });
    let calculo;
    try { calculo = await coletar(idEnte); } catch (e) {
      console.warn("pagometro SICONFI:", e.message);
      return guardado ? responder(200, { ...guardado, guardado: true, vencido: true }) : responder(502, { erro: "O Tesouro (SICONFI) não respondeu agora. Tente de novo em instantes." });
    }
    // Ente sem RREO do 6º bimestre nos dois últimos anos: registra para não perguntar de novo por 15 dias.
    const linha = { ...(calculo || { id_ente: idEnte, esfera: P.esferaDoEnte(idEnte), semaforo: "sem_dados", indicadores: {}, fonte: P.urlRreo(idEnte, new Date().getUTCFullYear() - 1) }), coletado_em: new Date().toISOString() };
    if (comBanco) await rest("pagometro_entes?on_conflict=id_ente", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([linha]) });
    return responder(200, { ...linha, guardado: false });
  } catch (e) {
    console.error("pagometro:", e.message);
    return responder(502, { erro: "Não foi possível consultar o Pagômetro agora. Tente de novo em instantes." });
  }
};

async function prazo(event, chave, responder, agora = Date.now()) {
  if (!/^(F:\d{6}|M:\d{7})$/.test(chave)) return responder(400, { erro: "Prazo: informe F:<UG de 6 dígitos> ou M:<IBGE do município>." });
  const fonte = P.fontePrazo(chave);
  if (!fonte) return responder(200, { chave, situacao: "sem_fonte" });
  const usuario = await exigirUsuarioAprovado(event);
  if (!usuario.ok) return responder(usuario.status, { erro: usuario.erro });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return responder(503, { erro: "Prazo de pagamento indisponível neste ambiente." });
  try {
    const [linha] = await (await rest(`pagometro_prazos?chave=eq.${encodeURIComponent(chave)}&select=*`)).json();
    const recente = linha && (linha.situacao === "pendente" || agora - Date.parse(linha.coletado_em || 0) < VALIDADE_PRAZO_MS);
    if (recente) return responder(200, linha);
    const r = await rest("pagometro_prazos?situacao=eq.pendente&select=chave", { headers: { Prefer: "count=exact", Range: "0-0" } });
    if (Number((r.headers.get("content-range") || "").split("/")[1]) >= MAX_FILA_PRAZOS) return responder(200, linha || { chave, situacao: "fila_cheia" });
    const cota = await verificarLimiteDiario(usuario.userId, "pagometro", LIMITE_DIARIO);
    if (!cota.ok) return linha ? responder(200, linha) : responder(429, { erro: cota.erro || "Limite diário de consultas atingido. Tente amanhã." });
    // Vencido: mantém os dias antigos na tela enquanto o robô refaz (situação volta a pendente).
    const pedido = { ...(linha || {}), chave, fonte, situacao: "pendente", pedido_em: new Date(agora).toISOString(), erro: null };
    await rest("pagometro_prazos?on_conflict=chave", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([pedido]) });
    return responder(200, pedido);
  } catch (e) {
    console.error("pagometro prazo:", e.message);
    return responder(502, { erro: "Não foi possível consultar o prazo de pagamento agora." });
  }
}

exports.coletar = coletar;
exports.prazo = prazo;
