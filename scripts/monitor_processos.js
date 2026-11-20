// Robô "Mudou algo no edital?": para cada processo acompanhado no CRM (operacao_processos com número de controle do
// PNCP ou compra do Compras.gov), confere o que mudou e grava em operacao_monitor_mudancas, em linguagem simples.
// Tabelas: supabase/operacao_monitor_edital.sql. E-mail: scripts/lembretes_licitacoes.py (reserva antes de enviar).
// Uso: node scripts/monitor_processos.js
// Env obrigatória: SUPABASE_SERVICE_ROLE_KEY.
// Env opcionais: LOTE_MONITOR (15 processos por rodada), INTERVALO_MINUTOS_MONITOR (60 entre verificações do mesmo
// processo), PAUSA_MONITOR_MS (1500 entre requisições), LIMITE_MINUTOS_MONITOR (8).
//
// Fontes, todas grátis, públicas e sem captcha:
//   PNCP consulta  /api/consulta/v1/orgaos/{cnpj}/compras/{ano}/{seq}   situação, abertura, encerramento, resultado,
//                  dataAtualizacaoGlobal (é o "cache": sem mudança aqui, a rodada gasta 1 requisição no processo).
//   PNCP histórico /api/pncp/v1/orgaos/.../historico                    o próprio log do PNCP: arquivo incluído,
//                  trocado ou retirado, itens retificados, retificação da contratação com a justificativa do órgão.
//   PNCP itens     /api/pncp/v1/orgaos/.../itens                        situação de cada item (cancelado, homologado).
//                  Só quando o histórico mostra mudança em item.
//   Compras.gov dados abertos (modulo-contratacoes 1.1)                 só para achar o número do PNCP de um processo
//                  que tem apenas a compra do Compras.gov (17 dígitos).
//   pregoes_gravados_mensagens (banco)                                  mensagens do chat que a extensão "Acompanhar
//                  chat" gravou (com "gravar" ligado): viram aviso no processo. Nenhuma requisição ao portal.
// Fora de propósito: o quadro informativo do Compras.gov novo (avisos/esclarecimentos/impugnações) fica atrás de
// hCaptcha invisível; o robô não abre. ComprasNet antigo (_comprasnet_antigo.js) só tem pregões até 2023, já
// encerrados: não entra no monitor. PNCP não publica robots.txt (o caminho devolve a página do app).
// Primeira verificação de um processo: grava o histórico que já existia com alerta=false (sem e-mail nem "Hoje").
// Regra fixa: nunca grava em operacao_processos.
const crypto = require("node:crypto");
const { restFetch } = require("./supabase_dados");

const LOTE = Math.max(1, Number(process.env.LOTE_MONITOR || 15));
const INTERVALO_MS = Math.max(5, Number(process.env.INTERVALO_MINUTOS_MONITOR || 60)) * 60000;
const PAUSA_MS = Math.max(1000, Number(process.env.PAUSA_MONITOR_MS ?? 1500));
const LIMITE_MS = Math.max(1, Number(process.env.LIMITE_MINUTOS_MONITOR || 8)) * 60000;
const ESPERA_SEM_PNCP_MS = 24 * 3600000;
const HISTORICO_PAGINA = 100, HISTORICO_PAGINAS = 5, ITENS_PAGINA = 500, ITENS_PAGINAS = 2;
const STATUS_FORA = "perdido,arquivado,contratado";
const PNCP = "https://pncp.gov.br/api/pncp/v1/orgaos";
const CONSULTA = "https://pncp.gov.br/api/consulta/v1/orgaos";
const DADOS_ABERTOS = "https://dadosabertos.compras.gov.br/modulo-contratacoes/1.1_consultarContratacoes_PNCP_14133_Id";
// Alguns endpoints do PNCP derrubam a conexão sem User-Agent de navegador (ver netlify/functions/pncp-arquivos.js).
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const RE_PNCP = /^(\d{14})-\d-(\d{6})\/(\d{4})$/;

const iso = (ms) => new Date(ms).toISOString();
const q = encodeURIComponent;
const curto = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ---------- regras (puras, testadas em monitor_processos.test.js) ----------

// Processo -> { numero (PNCP), idCompra (Compras.gov) } ou null quando não há como acompanhar.
function referenciaDoProcesso(p) {
  const origem = String(p?.origem_externa_id || "").trim(), url = String(p?.url_origem || "");
  let numero = RE_PNCP.test(origem) ? origem : null;
  const app = /pncp\.gov\.br\/app\/editais\/(\d{14})\/(\d{4})\/(\d{1,6})(?!\d)/.exec(url);
  if (!numero && app) numero = `${app[1]}-1-${app[3].padStart(6, "0")}/${app[2]}`;
  const idCompra = /^\d{17}$/.test(origem) ? origem : idCompraDoLink(url);
  return numero || idCompra ? { numero, idCompra } : null;
}
const idCompraDoLink = (link) => /[?&]compra=(\d{17})(?!\d)/.exec(String(link || ""))?.[1] || null;
function partesPncp(numero) {
  const m = RE_PNCP.exec(numero || "");
  return m ? { cnpj: m[1], seq: Number(m[2]), ano: m[3] } : null;
}
// Datas do PNCP vêm no horário de Brasília sem fuso.
const dataPncp = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? new Date(`${v.slice(0, 19)}-03:00`).toISOString() : null);
function dataBr(v) {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "sem data";
}
// Texto do órgão que fala de impugnação, esclarecimento ou aviso conta naquele contador.
function classificarTexto(t) {
  const s = String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/impugna/.test(s)) return "impugnacao";
  if (/esclarec|pedido de informac|resposta a questionamento|questionamento/.test(s)) return "esclarecimento";
  if (/\baviso\b|errata|comunicado|adendo/.test(s)) return "aviso";
  return null;
}
const ROTULO = { impugnacao: "impugnação", esclarecimento: "esclarecimento", aviso: "aviso" };
const listaNumeros = (ns) => { const v = [...new Set(ns)].sort((a, b) => a - b); return v.length > 12 ? `${v.slice(0, 12).join(", ")}…` : v.join(", "); };
const hash = (s) => crypto.createHash("md5").update(s).digest("hex").slice(0, 12);

// Evento do histórico do PNCP -> mudança. Itens retificados no mesmo minuto viram uma linha só.
function mudancaDoEvento(h) {
  const cat = Number(h.categoriaLogManutencao), tipo = Number(h.tipoLogManutencao);
  const quando = String(h.logManutencaoDataInclusao || "");
  const just = curto(h.justificativa, 300);
  const doc = [curto(h.documentoTipo, 80), h.documentoTitulo && `(${curto(h.documentoTitulo, 120)})`].filter(Boolean).join(" ") || "documento";
  const base = { ocorrido_em: dataPncp(quando), detalhe: { categoria: curto(h.categoriaLogManutencaoNome, 60), acao: curto(h.tipoLogManutencaoNome, 30), justificativa: just || null } };
  const chave = `h|${cat}|${tipo}|${quando}|${h.documentoSequencial ?? ""}|${h.itemNumero ?? ""}|${h.itemResultadoNumero ?? ""}`;
  if (cat === 1 && tipo === 0) return { ...base, chave, tipo: "outro", resumo: "Licitação publicada no PNCP." };
  if (cat === 1 && tipo === 2) return { ...base, chave, tipo: "situacao", resumo: "A licitação foi excluída do PNCP." };
  if (cat === 1) {
    const t = classificarTexto(just);
    return { ...base, chave, tipo: t || "retificacao", resumo: `O órgão alterou a licitação${t ? ` (${ROTULO[t]})` : ""}${just ? `. Motivo informado: "${just}"` : "."}` };
  }
  if (cat === 6) {
    const t = classificarTexto(`${h.documentoTipo || ""} ${h.documentoTitulo || ""}`);
    if (tipo === 0) return { ...base, chave, tipo: t || "arquivo_novo", resumo: `Novo arquivo publicado${t ? ` (${ROTULO[t]})` : ""}: ${doc}.` };
    if (tipo === 2 && !/novo arquivo/i.test(just)) return { ...base, chave, tipo: "arquivo_removido", resumo: `Arquivo retirado: ${doc}.${just ? ` Motivo: "${just}"` : ""}` };
    return { ...base, chave, tipo: "arquivo_retificado", resumo: `O arquivo ${doc} foi trocado por uma nova versão.` };
  }
  if (cat === 4 && h.itemNumero != null) {
    const acao = tipo === 2 ? "retirados" : tipo === 0 ? "incluídos" : "alterados";
    return { ...base, chave: `h|4|${tipo}|${quando.slice(0, 16)}`, tipo: tipo === 2 ? "item_cancelado" : "item_alterado", itens: [Number(h.itemNumero)], acao };
  }
  if (/resultado/i.test(h.categoriaLogManutencaoNome || "")) {
    const n = h.itemResultadoNumero ?? h.itemNumero;
    return { ...base, chave, tipo: "resultado", resumo: `Saiu ou mudou o resultado${n != null ? ` do item ${n}` : ""}.` };
  }
  return { ...base, chave, tipo: "outro", resumo: `${curto(h.categoriaLogManutencaoNome, 60) || "Registro"}: ${curto(h.tipoLogManutencaoNome, 30) || "alteração"}.` };
}
function mudancasDoHistorico(eventos) {
  const porChave = new Map();
  for (const h of Array.isArray(eventos) ? eventos : []) {
    const m = mudancaDoEvento(h);
    const ja = porChave.get(m.chave);
    if (ja?.itens) { ja.itens.push(...m.itens); continue; }
    if (!ja) porChave.set(m.chave, m);
  }
  return [...porChave.values()].map(({ itens, acao, ...m }) => (itens
    ? { ...m, detalhe: { ...m.detalhe, itens: [...new Set(itens)].sort((a, b) => a - b) },
      resumo: itens.length > 1 ? `${new Set(itens).size} itens foram ${acao} pelo órgão (itens ${listaNumeros(itens)}).` : `O item ${itens[0]} foi ${acao.replace(/s$/, "")} pelo órgão.` }
    : m));
}

// Consulta da compra -> retrato pequeno usado na próxima comparação.
const retratoDaCompra = (c) => ({ situacao: curto(c?.situacaoCompraNome, 120) || null, abertura: dataPncp(c?.dataAberturaProposta),
  encerramento: dataPncp(c?.dataEncerramentoProposta), existeResultado: Boolean(c?.existeResultado),
  atualizacao: c?.dataAtualizacaoGlobal || c?.dataAtualizacao || null });
function mudancasDaCompra(antes, agora) {
  const out = [];
  if (!antes) return out;
  const ocorrido_em = dataPncp(agora.atualizacao);
  if (antes.situacao && agora.situacao && antes.situacao !== agora.situacao) {
    out.push({ chave: `situacao|${agora.situacao}|${agora.atualizacao || ""}`, tipo: "situacao", ocorrido_em, detalhe: { de: antes.situacao, para: agora.situacao },
      resumo: `A situação da licitação mudou de "${antes.situacao}" para "${agora.situacao}".` });
  }
  for (const [campo, nome] of [["abertura", "A abertura das propostas"], ["encerramento", "O prazo final das propostas (data da sessão)"]]) {
    if (antes[campo] && agora[campo] && antes[campo] !== agora[campo]) {
      out.push({ chave: `data|${campo}|${agora[campo]}`, tipo: "data", ocorrido_em, detalhe: { campo, de: antes[campo], para: agora[campo] },
        resumo: `${nome} mudou de ${dataBr(antes[campo])} para ${dataBr(agora[campo])}.` });
    }
  }
  if (!antes.existeResultado && agora.existeResultado) out.push({ chave: "resultado|compra", tipo: "resultado", ocorrido_em, detalhe: {}, resumo: "O órgão publicou resultado no PNCP." });
  return out;
}

// Itens do PNCP -> { numero: situação }. Mudança de situação agrupada por situação nova.
const retratoDosItens = (itens) => Object.fromEntries((itens || []).filter((i) => Number.isInteger(i?.numeroItem)).map((i) => [i.numeroItem, curto(i.situacaoCompraItemNome, 80)]));
function mudancasDosItens(antes, agora) {
  if (!antes) return [];
  const porSituacao = new Map();
  for (const [n, sit] of Object.entries(agora)) {
    if (antes[n] === undefined || antes[n] === sit || !sit) continue;
    if (!porSituacao.has(sit)) porSituacao.set(sit, []);
    porSituacao.get(sit).push(Number(n));
  }
  return [...porSituacao].map(([sit, ns]) => {
    const tipo = /cancel|revog|anul|desert|fracass/i.test(sit) ? "item_cancelado" : /homolog/i.test(sit) ? "resultado" : "item_alterado";
    const quem = ns.length > 1 ? `Os itens ${listaNumeros(ns)} mudaram` : `O item ${ns[0]} mudou`;
    return { chave: `itens|${hash(`${sit}|${ns.join(",")}`)}`, tipo, ocorrido_em: null, detalhe: { itens: ns, situacao: sit }, resumo: `${quem} para "${sit}".` };
  });
}

// O pregoeiro citou a empresa? Mensagem dirigida ao CNPJ (fornecedor_chave) ou CNPJ escrito no texto, com ou sem pontuação.
function citaCnpj(m, cnpj) {
  if (!/^\d{14}$/.test(cnpj || "")) return false;
  return m.fornecedor_chave === cnpj || String(m.texto || "").replace(/(\d)[./\s-]+(?=\d)/g, "$1").includes(cnpj);
}
const cnpjFormatado = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

// Mensagens gravadas pela extensão (texto já sem CPF: o servidor mascara e o banco tem CHECK).
// cnpj: CNPJ da empresa do processo (citação vira aviso próprio, sempre com alerta).
function mudancasDoChat(mensagens, cnpj = null) {
  return (mensagens || []).map((m) => {
    const citou = citaCnpj(m, cnpj);
    const onde = m.numero_item ? ` (item ${m.numero_item})` : "";
    return {
      chave: `chat|${m.chave}`, tipo: "chat", fonte: "extensao", ocorrido_em: m.data_hora ? new Date(`${String(m.data_hora).slice(0, 19)}-03:00`).toISOString() : null,
      detalhe: { item: m.numero_item || null, categoria: m.tipo || null, ...(citou ? { cita_cnpj: true } : {}) },
      resumo: citou ? `O pregoeiro citou a sua empresa (CNPJ ${cnpjFormatado(cnpj)}) no chat${onde}: "${curto(m.texto, 260)}"`
        : `Mensagem no chat do pregão${onde}: "${curto(m.texto, 280)}"`,
    };
  });
}

// Alerta da mudança: a primeira verificação e "outro" não alertam; citação do CNPJ sempre alerta; com itens escolhidos
// no cartão (monitor_itens, até 10), mudança ou mensagem de OUTRO item fica só no histórico.
function comAlerta(m, inicial, itens) {
  if (m.detalhe?.cita_cnpj) return true;
  if (inicial || m.tipo === "outro") return false;
  const doItem = [m.detalhe?.item, ...(m.detalhe?.itens || [])].filter((n) => Number.isInteger(n) && n > 0);
  return !(itens?.length && doItem.length && !doItem.some((n) => itens.includes(n)));
}

// ---------- rede ----------

function criarLeitor({ fetchImpl = (...a) => fetch(...a), esperar = (ms) => new Promise((r) => setTimeout(r, ms)), agora = Date.now } = {}) {
  let ultimo = null, usadas = 0;
  return {
    get usadas() { return usadas; },
    async json(url) {
      if (ultimo !== null) { const falta = PAUSA_MS - (agora() - ultimo); if (falta > 0) await esperar(falta); }
      ultimo = agora(); usadas += 1;
      const r = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": UA }, redirect: "error", signal: globalThis.AbortSignal.timeout(20000) });
      // 400 = o PNCP recusa o número (processo fictício ou digitado errado): tratado como "não encontrada", sem retentar de hora em hora.
      if (r.status === 204 || r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);
      const t = await r.text();
      return t ? JSON.parse(t) : null;
    },
  };
}

async function numeroPeloComprasGov(leitor, idCompra) {
  const d = await leitor.json(`${DADOS_ABERTOS}?tipo=idCompra&codigo=${idCompra}`);
  const n = d?.resultado?.[0]?.numeroControlePNCP;
  return RE_PNCP.test(n || "") ? n : null;
}
async function lerHistorico(leitor, p) {
  const todos = [];
  for (let pagina = 1; pagina <= HISTORICO_PAGINAS; pagina++) {
    const lote = await leitor.json(`${PNCP}/${p.cnpj}/compras/${p.ano}/${p.seq}/historico?pagina=${pagina}&tamanhoPagina=${HISTORICO_PAGINA}`);
    if (!Array.isArray(lote)) break;
    todos.push(...lote);
    if (lote.length < HISTORICO_PAGINA) break;
  }
  return todos;
}
async function lerItens(leitor, p) {
  const todos = [];
  for (let pagina = 1; pagina <= ITENS_PAGINAS; pagina++) {
    const lote = await leitor.json(`${PNCP}/${p.cnpj}/compras/${p.ano}/${p.seq}/itens?pagina=${pagina}&tamanhoPagina=${ITENS_PAGINA}`);
    if (!Array.isArray(lote)) break;
    todos.push(...lote);
    if (lote.length < ITENS_PAGINA) break;
  }
  return todos;
}

// Um processo: devolve { patch, mudancas } sem gravar (testável com leitor e rest falsos).
async function verificarProcesso(linha, { leitor, rest, agora }) {
  const retrato = linha.retrato || {};
  const inicial = !linha.verificado_em;
  let numero = linha.numero_controle_pncp, idCompra = linha.id_compra;
  if (!numero && idCompra) numero = await numeroPeloComprasGov(leitor, idCompra);
  const partes = partesPncp(numero);
  if (!partes) return { patch: { erro: "Sem número de controle do PNCP: o robô não tem onde conferir.", proximo_em: iso(agora + ESPERA_SEM_PNCP_MS) }, mudancas: [] };
  const compra = await leitor.json(`${CONSULTA}/${partes.cnpj}/compras/${partes.ano}/${partes.seq}`);
  if (!compra) return { patch: { numero_controle_pncp: numero, erro: "Licitação não encontrada no PNCP.", proximo_em: iso(agora + ESPERA_SEM_PNCP_MS) }, mudancas: [] };
  idCompra = idCompra || idCompraDoLink(compra.linkSistemaOrigem);
  const atual = retratoDaCompra(compra);
  const mudancas = inicial ? [] : mudancasDaCompra(retrato.compra, atual);
  const novo = { ...retrato, compra: atual };
  // Cache: o histórico só é relido quando a compra mudou no PNCP (ou 1 vez por dia, por segurança).
  const historicoVelho = !retrato.historico_em || agora - Date.parse(retrato.historico_em) > 24 * 3600000;
  if (inicial || historicoVelho || atual.atualizacao !== retrato.compra?.atualizacao) {
    const eventos = await lerHistorico(leitor, partes);
    mudancas.push(...mudancasDoHistorico(eventos));
    novo.historico_em = iso(agora);
    const mexeuItem = eventos.some((h) => (Number(h.categoriaLogManutencao) === 4 || /resultado/i.test(h.categoriaLogManutencaoNome || ""))
      && (!retrato.historico_ate || String(h.logManutencaoDataInclusao) > retrato.historico_ate));
    novo.historico_ate = eventos.reduce((m, h) => (String(h.logManutencaoDataInclusao || "") > m ? String(h.logManutencaoDataInclusao) : m), retrato.historico_ate || "");
    if (inicial || mexeuItem) {
      const itens = retratoDosItens(await lerItens(leitor, partes));
      if (!inicial) mudancas.push(...mudancasDosItens(retrato.itens, itens));
      novo.itens = itens;
    }
  }
  if (idCompra) {
    const desde = retrato.chat_ate || linha.criado_em || iso(0);
    const msgs = await (await rest(`pregoes_gravados_mensagens?id_compra=eq.${idCompra}&gravado_em=gt.${q(desde)}` +
      "&select=chave,numero_item,fornecedor_chave,data_hora,texto,tipo,gravado_em&order=gravado_em.asc&limit=50")).json();
    mudancas.push(...mudancasDoChat(msgs, linha.cnpj_empresa));
    if (msgs.length) novo.chat_ate = msgs.at(-1).gravado_em;
  }
  return {
    patch: { numero_controle_pncp: numero, id_compra: idCompra || null, situacao: atual.situacao, abertura_propostas: atual.abertura,
      encerramento_propostas: atual.encerramento, retrato: novo, verificado_em: iso(agora), proximo_em: iso(agora + INTERVALO_MS - 5 * 60000), erro: null },
    // Primeira verificação = histórico anterior ao monitor: entra sem alerta. "outro" nunca alerta.
    mudancas: mudancas.map((m) => ({ ...m, fonte: m.fonte || "pncp", alerta: comAlerta(m, inicial, linha.monitor_itens) })),
  };
}

// ---------- rodada ----------

// Cadastra no monitor todo processo ativo com referência (idempotente: ignora quem já está).
async function cadastrarProcessos(rest) {
  const procs = await (await rest(`operacao_processos?status=not.in.(${STATUS_FORA})&select=id,organizacao_id,empresa_id,origem_externa_id,url_origem&limit=5000`)).json();
  const linhas = procs.map((p) => ({ p, ref: referenciaDoProcesso(p) })).filter((x) => x.ref)
    .map(({ p, ref }) => ({ processo_id: p.id, organizacao_id: p.organizacao_id, empresa_id: p.empresa_id, numero_controle_pncp: ref.numero, id_compra: ref.idCompra }));
  if (linhas.length) {
    await rest("operacao_monitor_processos?on_conflict=processo_id", { method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(linhas) });
  }
  return new Set(linhas.map((l) => l.processo_id));
}

// CNPJ da empresa e itens escolhidos no cartão (funil_v3.sql). Sem a coluna nova, segue só com o CNPJ.
async function comContextoDaEmpresa(rest, fila) {
  if (!fila.length) return fila;
  const ids = fila.map((l) => l.processo_id).join(",");
  let linhas;
  try {
    linhas = await (await rest(`operacao_processos?id=in.(${ids})&select=id,monitor_itens,operacao_empresas(cnpj)`)).json();
  } catch {
    linhas = await (await rest(`operacao_processos?id=in.(${ids})&select=id,operacao_empresas(cnpj)`)).json();
  }
  const porId = new Map((Array.isArray(linhas) ? linhas : []).map((p) => [p.id, p]));
  return fila.map((l) => {
    const p = porId.get(l.processo_id);
    const cnpj = String(p?.operacao_empresas?.cnpj || "").replace(/\D/g, "");
    return { ...l, cnpj_empresa: cnpj.length === 14 ? cnpj : null, monitor_itens: Array.isArray(p?.monitor_itens) ? p.monitor_itens : [] };
  });
}

async function rodar({ rest = restFetch, leitor = criarLeitor(), agora = Date.now, lote = LOTE } = {}) {
  const inicio = agora();
  const ativos = await cadastrarProcessos(rest);
  const vencidos = await (await rest(`operacao_monitor_processos?proximo_em=lte.${q(iso(agora()))}&order=proximo_em.asc&limit=500` +
    "&select=processo_id,organizacao_id,empresa_id,numero_controle_pncp,id_compra,retrato,verificado_em,criado_em")).json();
  const fila = await comContextoDaEmpresa(rest, vencidos.filter((l) => ativos.has(l.processo_id)).slice(0, lote));
  const contagem = { verificados: 0, mudancas: 0, falhas: 0 };
  for (const linha of fila) {
    if (agora() - inicio > LIMITE_MS) break;
    let patch;
    try {
      const r = await verificarProcesso(linha, { leitor, rest, agora: agora() });
      let novas = [];
      if (r.mudancas.length) {
        // Representação = só as linhas realmente novas (a mesma chave já gravada é ignorada pelo banco).
        novas = await (await rest("operacao_monitor_mudancas?on_conflict=processo_id,chave&select=alerta", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify(r.mudancas.map((m) => ({ organizacao_id: linha.organizacao_id, empresa_id: linha.empresa_id, processo_id: linha.processo_id,
            chave: m.chave.slice(0, 200), tipo: m.tipo, resumo: curto(m.resumo, 600), detalhe: m.detalhe || {}, fonte: m.fonte, ocorrido_em: m.ocorrido_em, alerta: m.alerta }))) })).json();
      }
      patch = r.patch;
      contagem.verificados += 1; contagem.mudancas += novas.filter((m) => m.alerta).length;
    } catch (erro) {
      // Erro curto e sem corpo de resposta; tenta de novo na próxima hora.
      patch = { erro: curto(erro?.message || erro, 300), proximo_em: iso(agora() + INTERVALO_MS) };
      contagem.falhas += 1;
    }
    await rest(`operacao_monitor_processos?processo_id=eq.${linha.processo_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  }
  console.log(`[monitor] ${ativos.size} acompanhado(s), ${fila.length} na rodada, ${leitor.usadas} requisição(ões) externas: ${JSON.stringify(contagem)}`);
  return contagem;
}

if (require.main === module) {
  rodar().catch((erro) => { console.error(`[monitor] ${curto(erro?.message || erro, 300)}`); process.exitCode = 1; });
}

module.exports = { rodar, verificarProcesso, referenciaDoProcesso, idCompraDoLink, partesPncp, classificarTexto, mudancasDoHistorico,
  mudancasDaCompra, retratoDaCompra, mudancasDosItens, retratoDosItens, mudancasDoChat, citaCnpj, comAlerta, criarLeitor, dataPncp };
