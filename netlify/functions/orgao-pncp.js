// Ficha do órgão ao vivo do PNCP (orgao.html), para quando o banco local tem pouco do órgão.
//   POST {acao:"ficha", cnpj}  -> cadastro do órgão + licitações abertas + contratos dos últimos 12 meses + atas dos
//                                 últimos 12 meses, no mesmo formato da RPC ficha_orgao (a tela mescla sem duplicar).
//   POST {acao:"buscar", q}    -> órgãos pelo nome no PNCP (só quando o catálogo local não achou nada).
// Login com cadastro aprovado, cota diária e teto por minuto (_auth.js). Dado público, guardado por fonte e por CNPJ
// em _cache_publico.js: a segunda pessoa que abre a mesma ficha não vai ao PNCP.
// Por que a API de consulta (api/consulta/v1) e não a busca do site: ela filtra pelo CNPJ do órgão de verdade (a busca
// casa o número como texto e traz outros órgãos). Medido em 24/11/2026: 9-30 s por chamada (contratos ~43 s), por isso
// as 4 chamadas saem juntas, cada uma com prazo próprio, e a que não responder vira aviso, não erro.
// Subrequisições no Cloudflare: login/cadastro 2 + cota 2-3 + 4 PNCP + cache ~8 = ~17 (teto 50).
const { cabecalhosPadrao, exigirUsuarioAprovado, verificarLimiteDiario } = require("./_auth");
const { comCache } = require("./_cache_publico");
const { UA } = require("./_licitacao_anterior");

const PNCP = "https://pncp.gov.br";
// Contratos é a mais lenta (medido ~43 s); as outras respondem em 1-30 s.
const PRAZO_MS = 25000;
const PRAZO_CONTRATOS_MS = 50000;
const ITENS_POR_FONTE = 50;
// Abrir a ficha é navegação comum (dezenas por dia); buscar nome é autocompletar de reserva.
const LIMITE_DIARIO = 150;
const LIMITE_DIARIO_BUSCA = 300;
const CACHE = { frescoS: 6 * 3600, guardaS: 3 * 86400, prazoMs: 4000 };
const CNPJ = /^\d{14}$/;

const dataPncp = (ms) => new Date(ms - 3 * 36e5).toISOString().slice(0, 10).replace(/-/g, ""); // dia de Brasília (UTC-3)
const dia = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const numero = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const texto = (v, max = 600) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const doOrgao = (controle, cnpj) => typeof controle === "string" && controle.startsWith(cnpj + "-");

async function pncpJson(url, fetchImpl, prazoMs = PRAZO_MS) {
  const r = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: globalThis.AbortSignal.timeout(prazoMs) });
  if (r.status === 204) return null; // a API de consulta responde 204 quando não há nada
  if (!r.ok) throw new Error(`PNCP HTTP ${r.status}`);
  return r.json();
}
const pagina = (json) => ({ lista: Array.isArray(json?.data) ? json.data : [], total: Number.isSafeInteger(json?.totalRegistros) ? json.totalRegistros : 0 });

// Cada fonte vira o formato da ficha_orgao (supabase/crm_orgao_linha_tempo.sql).
function abertasDe(json, cnpj) {
  const { lista, total } = pagina(json);
  return { total, itens: lista.filter((i) => doOrgao(i.numeroControlePNCP, cnpj)).map((i) => ({
    numero_controle_pncp: i.numeroControlePNCP, objeto: texto(i.objetoCompra) || "", publicacao: dia(i.dataPublicacaoPncp),
    encerramento: dia(i.dataEncerramentoProposta), modalidade: texto(i.modalidadeNome, 80), valor: numero(i.valorTotalEstimado),
    uf: texto(i.unidadeOrgao?.ufSigla, 2), municipio: texto(i.unidadeOrgao?.municipioNome, 120) })) };
}
function contratosDe(json, cnpj) {
  const { lista, total } = pagina(json);
  return { total, itens: lista.filter((c) => doOrgao(c.numeroControlePNCP, cnpj)).map((c) => ({
    numero_controle_pncp: c.numeroControlePNCP, objeto: texto(c.objetoContrato) || "", data_assinatura: dia(c.dataAssinatura),
    // LGPD: fornecedor pessoa física não aparece pelo nome (mesma regra do robô: só CNPJ).
    fornecedor: c.tipoPessoa === "PF" || /^\d{11}$/.test(String(c.niFornecedor || "").replace(/\D/g, "")) ? "Pessoa física" : texto(c.nomeRazaoSocialFornecedor, 200),
    valor: numero(c.valorGlobal) ?? numero(c.valorInicial),
    uf: texto(c.unidadeOrgao?.ufSigla, 2), municipio: texto(c.unidadeOrgao?.municipioNome, 120) })) };
}
function atasDe(json, cnpj) {
  const { lista, total } = pagina(json);
  return { total, itens: lista.filter((a) => doOrgao(a.numeroControlePNCPAta, cnpj)).map((a) => ({
    numero_controle_pncp_ata: a.numeroControlePNCPAta, objeto: texto(a.objetoContratacao) || "", data_assinatura: dia(a.dataAssinatura),
    vigencia_fim: dia(a.vigenciaFim), cancelado: a.cancelado === true })) };
}
function orgaoDe(json, cnpj) {
  if (!json || json.cnpj !== cnpj) return null;
  return { nome: texto(json.razaoSocial, 300), esfera: /^[A-Z]$/.test(json.esferaId || "") ? json.esferaId : null };
}

const FONTES = {
  orgao: (cnpj) => [`${PNCP}/api/pncp/v1/orgaos/${cnpj}`, orgaoDe],
  abertas: (cnpj, hoje) => [`${PNCP}/api/consulta/v1/contratacoes/proposta?dataFinal=${dataPncp(hoje + 365 * 864e5)}&cnpj=${cnpj}&pagina=1&tamanhoPagina=${ITENS_POR_FONTE}`, abertasDe],
  contratos: (cnpj, hoje) => [`${PNCP}/api/consulta/v1/contratos?dataInicial=${dataPncp(hoje - 364 * 864e5)}&dataFinal=${dataPncp(hoje)}&cnpjOrgao=${cnpj}&pagina=1&tamanhoPagina=${ITENS_POR_FONTE}`, contratosDe],
  // A API recusa período maior que 365 dias (422).
  atas: (cnpj, hoje) => [`${PNCP}/api/consulta/v1/atas?dataInicial=${dataPncp(hoje - 364 * 864e5)}&dataFinal=${dataPncp(hoje)}&cnpj=${cnpj}&pagina=1&tamanhoPagina=${ITENS_POR_FONTE}`, atasDe],
};

// { orgao, abertas, contratos, atas, totais, falharam: [fontes], origem: "ao-vivo"|"cache"|"guardado", guardadoEm }.
async function coletarFicha(cnpj, { fetchImpl = fetch, agora = Date.now, waitUntil } = {}) {
  const hoje = agora();
  const nomes = Object.keys(FONTES);
  const resultados = await Promise.allSettled(nomes.map((nome) => {
    const [url, converter] = FONTES[nome](cnpj, hoje);
    // 204 (nada) vira lista vazia e também é guardado: "o PNCP não tem" é resposta válida.
    return comCache(`orgao-pncp|${nome}|${cnpj}`, async () => converter(await pncpJson(url, fetchImpl, nome === "contratos" ? PRAZO_CONTRATOS_MS : PRAZO_MS), cnpj) ?? { vazio: true }, { ...CACHE, agora, waitUntil });
  }));
  const saida = { orgao: null, abertas: [], contratos: [], atas: [], totais: {}, falharam: [], origem: "cache", guardadoEm: null };
  resultados.forEach((r, i) => {
    const nome = nomes[i];
    if (r.status === "rejected") { saida.falharam.push(nome); return; }
    const { valor, origem, guardadoEm } = r.value;
    if (nome === "orgao") saida.orgao = valor?.vazio ? null : valor;
    else { saida[nome] = valor?.itens || []; saida.totais[nome] = valor?.total || 0; }
    if (origem === "ao-vivo" && saida.origem === "cache") saida.origem = "ao-vivo";
    if (origem === "guardado") saida.origem = "guardado";
    if (!saida.guardadoEm || guardadoEm < saida.guardadoEm) saida.guardadoEm = guardadoEm;
  });
  return saida;
}

async function buscarNoPncp(q, fetchImpl = fetch) {
  const r = await fetchImpl(`${PNCP}/api/search/suggest?tipos_documento=edital&campo=orgaos&q=${encodeURIComponent(q)}&tam_pagina=10`,
    { headers: { Accept: "application/json", "User-Agent": UA }, signal: globalThis.AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`PNCP HTTP ${r.status}`);
  const corpo = await r.text();
  const itens = corpo.trim() ? JSON.parse(corpo).items || [] : []; // o PNCP às vezes responde 200 sem corpo
  const vistos = new Map();
  for (const o of itens) if (CNPJ.test(String(o.cnpj || "")) && !vistos.has(o.cnpj)) vistos.set(o.cnpj, { cnpj: o.cnpj, nome: texto(o.nome, 300), total: Number(o.total) || 0 });
  return [...vistos.values()].filter((o) => o.nome);
}

// Pedido -> { acao, cnpj, q } ou { erro }. Tudo validado antes do login e de qualquer chamada ao PNCP.
function lerPedido(corpo) {
  if (String(corpo || "").length > 500) return { status: 413, erro: "Pedido muito grande." };
  let dados;
  try { dados = JSON.parse(corpo || "{}"); } catch { return { status: 400, erro: "Pedido inválido." }; }
  const acao = dados?.acao;
  const cnpj = String(dados?.cnpj || "").replace(/\D/g, "");
  const q = String(dados?.q || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (acao === "ficha") return CNPJ.test(cnpj) ? { acao, cnpj } : { status: 400, erro: "CNPJ do órgão inválido." };
  if (acao === "buscar") return q.length >= 3 ? { acao, q: q.toLocaleLowerCase("pt-BR") } : { status: 400, erro: "Digite pelo menos 3 letras." };
  return { status: 400, erro: "Ação inválida." };
}
const ERRO_PNCP = "O PNCP não respondeu agora. Tente de novo em alguns minutos.";

exports.handler = async (event, contexto = {}) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store" };
  const responder = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return responder(204, {});
  if (event.httpMethod !== "POST") return responder(405, { erro: "Método não permitido." });
  const pedido = lerPedido(event.body);
  if (pedido.erro) return responder(pedido.status, { erro: pedido.erro });
  const usuario = await exigirUsuarioAprovado(event);
  if (!usuario.ok) return responder(usuario.status, { erro: usuario.erro });
  const ficha = pedido.acao === "ficha";
  const cota = await verificarLimiteDiario(usuario.userId, ficha ? "orgao-pncp" : "orgao-pncp-buscar", ficha ? LIMITE_DIARIO : LIMITE_DIARIO_BUSCA);
  if (!cota.ok) return responder(cota.status || 429, { erro: cota.erro || "Limite diário de consultas ao PNCP atingido. Tente amanhã." });
  try {
    if (!ficha) {
      const r = await comCache(`orgao-pncp-buscar|${pedido.q}`, () => buscarNoPncp(pedido.q), { frescoS: 86400, guardar: (v) => v.length > 0, waitUntil: contexto.waitUntil });
      return responder(200, { orgaos: r.valor });
    }
    const r = await coletarFicha(pedido.cnpj, { waitUntil: contexto.waitUntil });
    return r.falharam.length === Object.keys(FONTES).length ? responder(502, { erro: ERRO_PNCP }) : responder(200, r);
  } catch (e) {
    console.warn(`[orgao-pncp] ${String(e?.message || e).slice(0, 200)}`);
    return responder(502, { erro: ERRO_PNCP });
  }
};

module.exports.coletarFicha = coletarFicha;
module.exports.buscarNoPncp = buscarNoPncp;
