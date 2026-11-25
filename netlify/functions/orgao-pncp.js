// Ficha do órgão ao vivo do PNCP (orgao.html).
//   POST {acao:"ficha", cnpj}  -> lê do PNCP o cadastro, as licitações abertas, as atas de 12 meses e os contratos dos
//                                 últimos 12 meses e GRAVA no banco (orgaos_pncp_cache, supabase/crm_orgao_linha_tempo.sql).
//                                 A tela relê a ficha_orgao, que junta isso ao que o robô coletou, sem duplicar.
//   POST {acao:"buscar", q}    -> órgãos pelo nome no PNCP (só quando o catálogo local não achou nada).
// Login com cadastro aprovado, cota diária e teto por minuto (_auth.js). Dado público.
// Por que a API de consulta (api/consulta/v1) e não a busca do site: ela filtra pelo CNPJ do órgão de verdade (a busca
// casa o número como texto e traz outros órgãos).
// Contratos por trimestre (24/11/2026, ficha completa): os 12 meses numa chamada só passavam de 50 s (medido: 67 s para o
// Comando da Aeronáutica, 1.663 contratos) e a tela ficava sem contratos. Um trimestre leva 19-24 s. Mês a mês (12
// chamadas, 23 s no total) foi descartado: o PNCP aceita ~20 chamadas por minuto por origem (atualizar_dados.js, 23/11)
// e tomou 429 a partir da segunda ficha. Trimestre de calendário = chave fixa: trimestre fechado e consultado há menos de
// 30 dias não é buscado de novo (a tela manda a lista em "pular"). A tela recebe o que chegou em PRAZO_RESPOSTA_MS; o resto
// continua (waitUntil no Cloudflare) e é gravado quando chega: na releitura automática da tela os dados completos aparecem.
// O banco é o cache: a próxima pessoa que abre a ficha não vai ao PNCP (a tela só chama aqui com dado velho ou faltando).
// Subrequisições no Cloudflare (teto 50): login/cadastro 2 + cota 2-3 + PNCP 4-12 + gravação 2 = ~20. Com 429 em muitas
// chamadas as novas tentativas podem passar do teto: o Cloudflare recusa as últimas, que viram "o PNCP não respondeu".
const { SUPABASE_URL, cabecalhosPadrao, exigirUsuarioAprovado, verificarLimiteDiario } = require("./_auth");
const { comCache } = require("./_cache_publico");
const { UA } = require("./_licitacao_anterior");
const { semCpf } = require("./_cpf");

const PNCP = "https://pncp.gov.br";
// Prazo de cada chamada ao PNCP (segue depois da resposta à tela) e de quanto a tela espera.
const PRAZO_PAGINA_MS = 45000;
const PRAZO_RESPOSTA_MS = 22000;
const MESES_CONTRATOS = 12;
const CONTRATOS_POR_PAGINA = 500; // máximo da API
const PAGINAS_CONTRATOS = 3; // trimestre com mais de 1.500 contratos fica marcado (total > itens)
const ABERTAS_POR_PAGINA = 50; // máximo do endpoint de propostas (500 dá 400)
const PAGINAS_ABERTAS = 3;
const ATAS_ITENS = 50; // só as mais recentes: o Comando da Aeronáutica tem ~20 mil atas em 12 meses (500 levou 51 s)
// Abrir a ficha é navegação comum (dezenas por dia); buscar nome é autocompletar de reserva.
const LIMITE_DIARIO = 150;
const LIMITE_DIARIO_BUSCA = 300;
const CNPJ = /^\d{14}$/;

const diaBrasilia = (ms) => new Date(ms - 3 * 36e5).toISOString().slice(0, 10); // UTC-3, sem horário de verão
const dataPncp = (ms) => diaBrasilia(ms).replace(/-/g, "");
const dia = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const numero = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const texto = (v, max = 600) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const doOrgao = (controle, cnpj) => typeof controle === "string" && controle.startsWith(cnpj + "-");
const uasg = (v) => (/^\d{1,8}$/.test(String(v ?? "")) ? String(v) : null);
// LGPD: pessoa física não aparece pelo nome (mesma regra do robô); o CPF que a razão social de MEI traz no fim sai.
const fornecedor = (c) => (c.tipoPessoa === "PF" || /^\d{11}$/.test(String(c.niFornecedor || "").replace(/\D/g, ""))
  ? "Pessoa física" : texto(semCpf(c.nomeRazaoSocialFornecedor, "").replace(/\s+/g, " "), 200));

// No máximo SIMULTANEAS chamadas ao PNCP por ficha, e 429 tenta de novo até 2 vezes: medido em 24/11, 15 chamadas juntas
// depois de algumas fichas seguidas levaram 429 em todos os meses de contratos.
const SIMULTANEAS = 6;
const ESPERA_429_MS = 1500;
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
function limitador(maximo) {
  let ativas = 0;
  const fila = [];
  const proxima = () => { if (ativas < maximo && fila.length) { ativas += 1; fila.shift()(); } };
  return async (fn) => {
    await new Promise((ok) => { fila.push(ok); proxima(); });
    try { return await fn(); } finally { ativas -= 1; proxima(); }
  };
}
async function pncpJson(url, fetchImpl, vez = 0) {
  const r = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: globalThis.AbortSignal.timeout(PRAZO_PAGINA_MS) });
  if (r.status === 204) return null; // a API de consulta responde 204 quando não há nada
  if (r.status === 429 && vez < 2) {
    const pedido = Number(r.headers.get("Retry-After"));
    await esperar(Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido * 1000, 5000) : ESPERA_429_MS * (vez + 1));
    return pncpJson(url, fetchImpl, vez + 1);
  }
  if (!r.ok) throw new Error(`PNCP HTTP ${r.status}`);
  return r.json();
}
const pagina = (json) => ({ lista: Array.isArray(json?.data) ? json.data : [], total: Number.isSafeInteger(json?.totalRegistros) ? json.totalRegistros : 0,
  paginas: Number.isSafeInteger(json?.totalPaginas) ? json.totalPaginas : 1 });

// Cada fonte vira o formato que a ficha_orgao lê de orgaos_pncp_cache (supabase/crm_orgao_linha_tempo.sql).
const aberta = (i) => ({ numero_controle_pncp: i.numeroControlePNCP, objeto: texto(i.objetoCompra, 400) || "", publicacao: dia(i.dataPublicacaoPncp),
  encerramento: dia(i.dataEncerramentoProposta), modalidade: texto(i.modalidadeNome, 80), valor: numero(i.valorTotalEstimado),
  uasg: uasg(i.unidadeOrgao?.codigoUnidade), unidade: texto(i.unidadeOrgao?.nomeUnidade, 200),
  uf: texto(i.unidadeOrgao?.ufSigla, 2), municipio: texto(i.unidadeOrgao?.municipioNome, 120) });
const contrato = (c) => ({ numero_controle_pncp: c.numeroControlePNCP, objeto: texto(c.objetoContrato, 300) || "", data_assinatura: dia(c.dataAssinatura),
  fornecedor: fornecedor(c), valor: numero(c.valorGlobal) ?? numero(c.valorInicial),
  uasg: uasg(c.unidadeOrgao?.codigoUnidade), unidade: texto(c.unidadeOrgao?.nomeUnidade, 200), categoria: texto(c.categoriaProcesso?.nome, 80) });
const ata = (a) => ({ numero_controle_pncp_ata: a.numeroControlePNCPAta, objeto: texto(a.objetoContratacao, 400) || "", data_assinatura: dia(a.dataAssinatura),
  vigencia_fim: dia(a.vigenciaFim), cancelado: a.cancelado === true, uasg: uasg(a.codigoUnidadeOrgao), unidade: texto(a.nomeUnidadeOrgao, 200) });

// Trimestres de calendário (Brasília) que cobrem o mês corrente e os 11 anteriores; o atual vai até hoje. periodo = AAAAMM
// do 1º mês do trimestre (202610 = out-dez/2026). O mais antigo vem inteiro (até 14 meses no total).
function trimestresContratos(agoraMs) {
  const hoje = diaBrasilia(agoraMs);
  const ano = Number(hoje.slice(0, 4)), mes = Number(hoje.slice(5, 7));
  const trimestres = [];
  for (let m = ano * 12 + (mes - 1) - (MESES_CONTRATOS - 1); m <= ano * 12 + (mes - 1); m += 1) {
    const a = Math.floor(m / 12), inicioMes = Math.floor((m % 12) / 3) * 3 + 1;
    const periodo = `${a}${String(inicioMes).padStart(2, "0")}`;
    if (trimestres.some((t) => t.periodo === periodo)) continue;
    const fim = new Date(Date.UTC(a, inicioMes + 2, 0)).toISOString().slice(0, 10);
    trimestres.push({ periodo, inicio: `${periodo}01`, fim: (fim < hoje ? fim : hoje).replace(/-/g, "") });
  }
  return trimestres.reverse();
}

// Lotes a buscar: { fonte, periodo, buscar() -> { fonte, periodo, total, itens } }.
function tarefas(cnpj, agoraMs, fetchImpl, pular = []) {
  const vez = limitador(SIMULTANEAS);
  const consulta = (caminho) => vez(() => pncpJson(`${PNCP}/api/consulta/v1/${caminho}`, fetchImpl));
  const lote = (fonte, periodo, total, itens) => ({ fonte, periodo, total, itens });
  return [
    { fonte: "orgao", periodo: "", buscar: async () => {
      const j = await pncpJson(`${PNCP}/api/pncp/v1/orgaos/${cnpj}`, fetchImpl);
      const ok = j && j.cnpj === cnpj;
      return lote("orgao", "", ok ? 1 : 0, ok ? [{ nome: texto(j.razaoSocial, 300), esfera: /^[A-Z]$/.test(j.esferaId || "") ? j.esferaId : null }] : []);
    } },
    { fonte: "abertas", periodo: "", buscar: async () => {
      const url = (p) => `contratacoes/proposta?dataFinal=${dataPncp(agoraMs + 365 * 864e5)}&cnpj=${cnpj}&pagina=${p}&tamanhoPagina=${ABERTAS_POR_PAGINA}`;
      const primeira = pagina(await consulta(url(1)));
      const lista = [...primeira.lista];
      for (let p = 2; p <= Math.min(primeira.paginas, PAGINAS_ABERTAS); p++) lista.push(...pagina(await consulta(url(p))).lista);
      return lote("abertas", "", primeira.total, lista.filter((i) => doOrgao(i.numeroControlePNCP, cnpj)).map(aberta));
    } },
    // A API recusa período maior que 365 dias (422).
    { fonte: "atas", periodo: "", buscar: async () => {
      const r = pagina(await consulta(`atas?dataInicial=${dataPncp(agoraMs - 364 * 864e5)}&dataFinal=${dataPncp(agoraMs)}&cnpj=${cnpj}&pagina=1&tamanhoPagina=${ATAS_ITENS}`));
      return lote("atas", "", r.total, r.lista.filter((a) => doOrgao(a.numeroControlePNCPAta, cnpj)).map(ata));
    } },
    ...trimestresContratos(agoraMs).map((t) => ({ fonte: "contratos", periodo: t.periodo, buscar: async () => {
      const url = (p) => `contratos?dataInicial=${t.inicio}&dataFinal=${t.fim}&cnpjOrgao=${cnpj}&pagina=${p}&tamanhoPagina=${CONTRATOS_POR_PAGINA}`;
      const primeira = pagina(await consulta(url(1)));
      const lista = [...primeira.lista];
      for (let p = 2; p <= Math.min(primeira.paginas, PAGINAS_CONTRATOS); p++) lista.push(...pagina(await consulta(url(p))).lista);
      return lote("contratos", t.periodo, primeira.total, lista.filter((c) => doOrgao(c.numeroControlePNCP, cnpj)).map(contrato));
    } })),
  ].filter((t) => !pular.includes(t.fonte === "orgao" ? "orgao" : t.periodo));
}

// Grava os lotes pela gravar_pncp_orgao (service_role). Sem a chave (ambiente sem segredo): não grava, a tela avisa.
async function gravarNoBanco(cnpj, lotes, fetchImpl = fetch) {
  if (!lotes.length) return true;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) return false;
  try {
    const r = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/gravar_pncp_orgao`, { method: "POST",
      headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_cnpj: cnpj, p_lotes: lotes }), signal: globalThis.AbortSignal.timeout(10000) });
    if (!r.ok) console.warn(`[orgao-pncp] gravar HTTP ${r.status}`);
    return r.ok;
  } catch (e) {
    console.warn(`[orgao-pncp] gravar: ${String(e?.message || e).slice(0, 200)}`);
    return false;
  }
}

// pular: o que a tela já tem fresco no banco ("orgao" e periodos de trimestres fechados).
// -> { orgao, totais, falharam: [fontes], pendentes, gravado, origem: "ao-vivo" }.
// pendentes: lotes que ainda não chegaram na hora da resposta (seguem e são gravados depois, com waitUntil).
async function coletarFicha(cnpj, { fetchImpl = fetch, agora = Date.now, waitUntil, gravar = gravarNoBanco, prazoRespostaMs = PRAZO_RESPOSTA_MS, pular = [] } = {}) {
  const lista = tarefas(cnpj, agora(), fetchImpl, pular);
  const prontos = [], falhas = [];
  const todas = Promise.all(lista.map((t) => t.buscar().then((l) => { prontos.push(l); }, (e) => {
    falhas.push(t);
    console.warn(`[orgao-pncp] ${t.fonte}${t.periodo ? " " + t.periodo : ""}: ${String(e?.message || e).slice(0, 120)}`);
  })));
  let relogio;
  await Promise.race([todas, new Promise((ok) => { relogio = setTimeout(ok, prazoRespostaMs); })]);
  clearTimeout(relogio);
  const agoraProntos = [...prontos];
  const gravado = await gravar(cnpj, agoraProntos, fetchImpl);
  const pendentes = lista.length - prontos.length - falhas.length;
  if (pendentes) {
    const resto = todas.then(() => gravar(cnpj, prontos.filter((l) => !agoraProntos.includes(l)), fetchImpl)).catch(() => {});
    if (typeof waitUntil === "function") waitUntil(resto);
  }
  const orgao = agoraProntos.find((l) => l.fonte === "orgao")?.itens[0] || null;
  const totais = {};
  for (const l of agoraProntos) if (l.fonte !== "orgao") totais[l.fonte] = (totais[l.fonte] || 0) + l.total;
  return { orgao, totais, falharam: [...new Set(falhas.map((t) => t.fonte))], pendentes, gravado, origem: "ao-vivo" };
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
  const pular = Array.isArray(dados?.pular) ? dados.pular.filter((x) => typeof x === "string" && /^(orgao|\d{6})$/.test(x)).slice(0, 8) : [];
  if (acao === "ficha") return CNPJ.test(cnpj) ? { acao, cnpj, pular } : { status: 400, erro: "CNPJ do órgão inválido." };
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
    const r = await coletarFicha(pedido.cnpj, { waitUntil: contexto.waitUntil, pular: pedido.pular });
    // Nada chegou e nada segue em segundo plano: o PNCP está fora.
    const nada = r.falharam.length && !r.pendentes && !r.orgao && !Object.keys(r.totais).length;
    return nada ? responder(502, { erro: ERRO_PNCP }) : responder(200, r);
  } catch (e) {
    console.warn(`[orgao-pncp] ${String(e?.message || e).slice(0, 200)}`);
    return responder(502, { erro: ERRO_PNCP });
  }
};

module.exports.coletarFicha = coletarFicha;
module.exports.buscarNoPncp = buscarNoPncp;
module.exports.trimestresContratos = trimestresContratos;
