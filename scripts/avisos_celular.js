// Aviso no celular (Web Push) a partir das fontes de aviso que já existem. Roda depois do monitor dos processos
// (.github/workflows/monitor-processos.yml) e dos lembretes (.github/workflows/lembretes-licitacoes.yml).
//   node scripts/avisos_celular.js
// Fontes (só para quem tem aparelho inscrito em avisos_celular_inscricoes e o tipo ligado nas preferências):
//   edital     operacao_monitor_mudancas com alerta (menos chat), das últimas AVISO_MUDANCA_MAX_HORAS -> quem cadastrou o processo
//   pregoeiro  operacao_monitor_mudancas tipo "chat" (mensagem gravada pela extensão)              -> quem cadastrou o processo
//   prazo      lembretes (mesma conta do e-mail: dia do prazo - dias_antes, na hora_aviso) e
//              operacao_prazos_processo abertos que vencem em PRAZO_HORAS                          -> dono do lembrete / quem cadastrou
//   certidao   operacao_documentos que vencem em CERTIDAO_DIAS                                     -> gestores/operadores da organização
//   boletim    logs_boletim "enviado" (scripts/boletim_editais.py) das últimas BOLETIM_MAX_HORAS    -> o cliente do boletim
// Cada aviso é reservado em avisos_celular_enviados (chave primária usuario+chave) ANTES de enviar: rodadas
// simultâneas dos dois workflows não repetem aviso. Envio falhou em todos os aparelhos: a reserva volta.
// Inscrição que o serviço de push dá como morta (404/410) é apagada.
// Env: SUPABASE_SERVICE_ROLE_KEY, VAPID_CHAVE_PUBLICA, VAPID_CHAVE_PRIVADA (obrigatórias; sem VAPID sai sem erro).
//   VAPID_CONTATO (padrão mailto:licitaplena@licitaplena.com.br), SITE_URL (padrão https://licitaplena.com.br),
//   AVISO_MUDANCA_MAX_HORAS (72), PRAZO_HORAS (24), CERTIDAO_DIAS (7), BOLETIM_MAX_HORAS (12).
//   AVISO_TESTE_USUARIO=<uuid>: só manda um aviso de teste aos aparelhos desse usuário (não reserva nada).
const { restFetch } = require("./supabase_dados");
const { enviarPush } = require("./web_push");

const SITE_URL = process.env.SITE_URL || "https://licitaplena.com.br";
const MUDANCA_MAX_HORAS = Number(process.env.AVISO_MUDANCA_MAX_HORAS || 72);
const PRAZO_HORAS = Number(process.env.PRAZO_HORAS || 24);
const CERTIDAO_DIAS = Number(process.env.CERTIDAO_DIAS || 7);
const BOLETIM_MAX_HORAS = Number(process.env.BOLETIM_MAX_HORAS || 12);
const RETENCAO_ENVIADOS_DIAS = 60;
const BRASILIA_MS = 3 * 3600 * 1000; // UTC-3, sem horário de verão
const HORA = 3600 * 1000;

const ler = async (caminho) => (await restFetch(caminho)).json();
const lista = (ids) => `(${[...ids].map(encodeURIComponent).join(",")})`;
const curto = (t, n) => (String(t || "").length > n ? `${String(t).slice(0, n - 1)}…` : String(t || ""));
const linkProcesso = (empresa, processo) => `${SITE_URL}/sistema?empresa=${encodeURIComponent(empresa || "")}&processo=${encodeURIComponent(processo || "")}`;

// Mesma conta de lembretes_licitacoes.py (momento_do_aviso): dia do prazo em Brasília - dias_antes, na hora_aviso.
function momentoDoLembrete(l) {
  const prazo = Date.parse(l.data_final_proposta);
  if (Number.isNaN(prazo)) return null;
  const dia = new Date(prazo - BRASILIA_MS);
  return Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate() - (l.dias_antes || 0), l.hora_aviso ?? 8) + BRASILIA_MS;
}

// Avisos de mudança no edital e mensagens do pregoeiro (o robô do monitor já grava as duas).
function avisosDeMudancas(mudancas) {
  return mudancas.filter((m) => m.operacao_processos?.criado_por).map((m) => {
    const chat = m.tipo === "chat";
    return { usuario: m.operacao_processos.criado_por, chave: `mud:${m.id}`, tipo: chat ? "pregoeiro" : "edital",
      titulo: chat ? "Mensagem do pregoeiro" : "Mudou algo no edital", tag: `proc:${m.processo_id}`,
      corpo: `${curto(m.operacao_processos.objeto, 70)}: ${curto(m.resumo, 160)}`, url: linkProcesso(m.empresa_id, m.processo_id) };
  });
}

function avisosDeLembretes(lembretes, agora) {
  return lembretes.flatMap((l) => {
    const momento = momentoDoLembrete(l);
    const prazo = Date.parse(l.data_final_proposta);
    if (momento === null || agora < momento || agora >= prazo || agora - momento > PRAZO_HORAS * HORA) return [];
    const quando = new Date(prazo - BRASILIA_MS).toISOString().slice(0, 16).replace("T", " às ").replace(/^(\d{4})-(\d\d)-(\d\d)/, "$3/$2/$1");
    return [{ usuario: l.cliente_id, chave: `lem:${l.id}:${momento}`, tipo: "prazo", titulo: "Prazo de proposta se aproxima", tag: `lem:${l.id}`,
      corpo: `${curto(l.objeto_resumo || "Licitação", 90)}. Prazo: ${quando} (Brasília).`, url: `${SITE_URL}/painel.html#calendario` }];
  });
}

function avisosDePrazosProcesso(prazos) {
  return prazos.filter((p) => p.operacao_processos?.criado_por).map((p) => ({ usuario: p.operacao_processos.criado_por, chave: `prz:${p.id}:${p.vencimento}`,
    tipo: "prazo", titulo: "Prazo vencendo", tag: `prz:${p.id}`, corpo: `${curto(p.titulo, 80)} (${curto(p.operacao_processos.objeto, 60)})`,
    url: linkProcesso(p.operacao_processos.empresa_id, p.processo_id) }));
}

function avisosDeCertidoes(documentos, membros) {
  return documentos.flatMap((d) => membros.filter((m) => m.organizacao_id === d.organizacao_id && (!m.empresa_id || m.empresa_id === d.empresa_id))
    .map((m) => ({ usuario: m.usuario_id, chave: `doc:${d.id}:${d.vencimento}`, tipo: "certidao", titulo: "Certidão vencendo", tag: `doc:${d.id}`,
      corpo: `${curto(d.titulo || d.tipo, 70)} de ${curto(d.operacao_empresas?.razao_social, 50)} vence em ${d.vencimento.split("-").reverse().join("/")}.`,
      url: `${SITE_URL}/operacao.html` })));
}

// Boletim com oportunidade nova: o robô do e-mail grava uma linha "enviado" por cliente e rodada (3 por dia útil).
function avisosDeBoletim(logs) {
  return logs.filter((l) => l.cliente_id && Number(l.quantidade_editais) > 0 && l.executado_em).map((l) => {
    const n = Number(l.quantidade_editais);
    return { usuario: l.cliente_id, chave: `bol:${l.executado_em}`, tipo: "boletim", titulo: "Oportunidade nova no boletim", tag: "boletim",
      corpo: `O boletim chegou com ${n} licitaç${n > 1 ? "ões" : "ão"} no seu filtro. Toque para ver.`, url: `${SITE_URL}/painel.html#boletim` };
  });
}

function filtrarPorPreferencia(avisos, preferencias) {
  const prefs = new Map(preferencias.map((p) => [p.usuario_id, p]));
  return avisos.filter((a) => prefs.get(a.usuario)?.[a.tipo] !== false);
}

async function coletarAvisos(usuarios, agora) {
  const u = lista(usuarios);
  const desde = new Date(agora - MUDANCA_MAX_HORAS * HORA).toISOString();
  const ate = new Date(agora + PRAZO_HORAS * HORA).toISOString();
  const hoje = new Date(agora - BRASILIA_MS).toISOString().slice(0, 10);
  const limiteDoc = new Date(agora - BRASILIA_MS + CERTIDAO_DIAS * 24 * HORA).toISOString().slice(0, 10);
  const desdeBoletim = new Date(agora - BOLETIM_MAX_HORAS * HORA).toISOString();
  const [mudancas, lembretes, prazos, membros, boletins] = await Promise.all([
    ler(`operacao_monitor_mudancas?alerta=eq.true&detectado_em=gte.${desde}&order=detectado_em.asc&limit=500&select=id,processo_id,empresa_id,tipo,resumo,operacao_processos!inner(objeto,criado_por)&operacao_processos.criado_por=in.${u}`),
    ler(`lembretes?cliente_id=in.${u}&data_final_proposta=gt.${new Date(agora).toISOString()}&select=id,cliente_id,objeto_resumo,data_final_proposta,dias_antes,hora_aviso`),
    ler(`operacao_prazos_processo?concluido_em=is.null&vencimento=gt.${new Date(agora).toISOString()}&vencimento=lte.${ate}&limit=500&select=id,processo_id,titulo,vencimento,operacao_processos!operacao_prazos_processo_processo_id_fkey!inner(objeto,empresa_id,criado_por)&operacao_processos.criado_por=in.${u}`),
    ler(`operacao_membros?usuario_id=in.${u}&papel=in.(gestor,operador)&select=organizacao_id,usuario_id,empresa_id`),
    // Falha nesta fonte (tabela de log fora do ar) não derruba os outros avisos.
    ler(`logs_boletim?status=eq.enviado&executado_em=gte.${desdeBoletim}&cliente_id=in.${u}&order=executado_em.asc&limit=500&select=cliente_id,quantidade_editais,executado_em`).catch(() => []),
  ]);
  const orgs = new Set(membros.map((m) => m.organizacao_id));
  const documentos = orgs.size ? await ler(`operacao_documentos?organizacao_id=in.${lista(orgs)}&vencimento=gte.${hoje}&vencimento=lte.${limiteDoc}&limit=500&select=id,organizacao_id,empresa_id,tipo,titulo,vencimento,operacao_empresas!operacao_documentos_empresa_id_fkey(razao_social)`) : [];
  return [...avisosDeMudancas(mudancas), ...avisosDeLembretes(lembretes, agora), ...avisosDePrazosProcesso(prazos), ...avisosDeCertidoes(documentos, membros), ...avisosDeBoletim(Array.isArray(boletins) ? boletins : [])];
}

// Reserva: só voltam as linhas que esta rodada inseriu (as já existentes são ignoradas pelo on_conflict).
async function reservar(avisos) {
  if (!avisos.length) return new Set();
  const r = await restFetch("avisos_celular_enviados?on_conflict=usuario_id,chave&select=usuario_id,chave", { method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(avisos.map((a) => ({ usuario_id: a.usuario, chave: a.chave }))) });
  return new Set((await r.json()).map((x) => `${x.usuario_id}|${x.chave}`));
}

async function entregar(aviso, aparelhos, vapid) {
  let entregues = 0;
  for (const ap of aparelhos) {
    try {
      const status = await enviarPush(ap, { titulo: aviso.titulo, corpo: aviso.corpo, url: aviso.url, tag: aviso.tag }, vapid);
      if (status === 404 || status === 410) await restFetch(`avisos_celular_inscricoes?id=eq.${ap.id}`, { method: "DELETE" });
      else if (status >= 200 && status < 300) entregues++;
      else console.log(`Serviço de push respondeu HTTP ${status} (aparelho ${ap.id}).`);
    } catch (e) {
      console.log(`Falha ao enviar para o aparelho ${ap.id}: ${e.message}`);
    }
  }
  return entregues;
}

async function main() {
  const vapid = { publica: process.env.VAPID_CHAVE_PUBLICA, privada: process.env.VAPID_CHAVE_PRIVADA,
    contato: process.env.VAPID_CONTATO || "mailto:licitaplena@licitaplena.com.br" };
  if (!vapid.publica || !vapid.privada) {
    console.log("Avisos no celular desligados: faltam VAPID_CHAVE_PUBLICA/VAPID_CHAVE_PRIVADA nos Secrets do GitHub.");
    return;
  }
  const inscricoes = await ler("avisos_celular_inscricoes?select=id,usuario_id,endpoint,p256dh,auth&limit=5000");
  const porUsuario = new Map();
  for (const i of inscricoes) porUsuario.set(i.usuario_id, [...(porUsuario.get(i.usuario_id) || []), i]);
  const teste = process.env.AVISO_TESTE_USUARIO;
  if (teste) {
    const n = await entregar({ titulo: "Aviso de teste", corpo: "Os avisos do LicitaPlena estão chegando neste aparelho.", url: `${SITE_URL}/sistema`, tag: "teste" },
      porUsuario.get(teste) || [], vapid);
    console.log(`Aviso de teste entregue a ${n} aparelho(s).`);
    return;
  }
  if (!porUsuario.size) { console.log("Nenhum aparelho inscrito."); return; }
  const agora = Date.now();
  const preferencias = await ler(`avisos_celular_preferencias?usuario_id=in.${lista(porUsuario.keys())}&select=usuario_id,edital,prazo,pregoeiro,certidao,boletim`);
  const avisos = filtrarPorPreferencia(await coletarAvisos(porUsuario.keys(), agora), preferencias);
  const ganhos = await reservar(avisos);
  let enviados = 0;
  for (const a of avisos.filter((x) => ganhos.has(`${x.usuario}|${x.chave}`))) {
    if (await entregar(a, porUsuario.get(a.usuario), vapid)) enviados++;
    else await restFetch(`avisos_celular_enviados?usuario_id=eq.${a.usuario}&chave=eq.${encodeURIComponent(a.chave)}`, { method: "DELETE" });
  }
  await restFetch(`avisos_celular_enviados?enviado_em=lt.${new Date(agora - RETENCAO_ENVIADOS_DIAS * 24 * HORA).toISOString()}`, { method: "DELETE" });
  console.log(`Avisos no celular: ${avisos.length} candidato(s), ${ganhos.size} novo(s), ${enviados} entregue(s).`);
}

if (require.main === module) {
  main().catch((e) => { console.error(`ERRO nos avisos no celular: ${e.message}`); process.exitCode = 1; });
}

module.exports = { momentoDoLembrete, avisosDeMudancas, avisosDeLembretes, avisosDePrazosProcesso, avisosDeCertidoes, avisosDeBoletim, filtrarPorPreferencia };
