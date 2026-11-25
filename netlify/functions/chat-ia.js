// Plena, a IA do LicitaPlena (botão "Plena" no canto de baixo à direita, antes "IA · BETA"; equivalente ao "B2G Talk").
//   POST /api/chat-ia  (Authorization: Bearer <sessão>)
//     {acao:"perguntar", pergunta, historico?:[{papel,texto}], empresaId?, salvar?, conversaId?, contexto?:{tela,titulo,secao,edital?}}
//       -> {resposta, fontes:[{tipo,titulo,detalhe,url?}], naoSei, modo:"ia"|"base", aviso, salvo}  (sem contagem de uso: IA com uso justo, 21/11)
//     {acao:"historico"} -> {mensagens:[...]}      {acao:"apagar"} -> {apagado:true}
//     {acao:"perguntas"|"salvar_pergunta"(texto)|"apagar_pergunta"(id)} -> {perguntas:[{id,texto}]}  (sem cota de IA)
//   Perguntas ao edital (trechos literais com página) vão direto a /api/ia-edital modo "pergunta"; aqui não.
//   Nesta fase a Plena só lê e responde: nenhuma ação grava nada no lugar da pessoa (fase 3).
// Regras:
//   - Dúvida de licitação: responde só com a base jurídica (juridico-base.js) e os tutoriais (ajuda-ui.js), citando a
//     fonte; sem base, "não sei" (_chat_ia.js).
//   - Dados da conta: lidos por contextos-operacao com o TOKEN DO USUÁRIO (RLS), nunca com a chave de serviço;
//     empresa ativa (empresaId) só restringe, e só vale se estiver entre as empresas que a RLS devolveu.
//   - Cota: verificarLimiteDiario("chat-ia") = recurso "ia" do plano (ia_conversas.sql inclui a função no recurso).
//   - CPF sai da pergunta e do histórico antes da IA e do banco. Histórico salvo só com salvar:true (tabela
//     ia_conversas, RLS: cada um lê e apaga só o seu).
//   - Sem chave de IA ou com os provedores fora, responde direto da base (modo "base").
// Custo: 3 chamadas de auth/cota + até 11 leituras do Supabase (só se a pergunta é sobre a conta) + 1 a 3 de IA.
const { cabecalhosPadrao, exigirUsuarioAprovado, verificarLimiteDiario } = require("./_auth");
const { responderComFallback, haProvedorConfigurado } = require("./_ia_provedores");
const contextosOperacao = require("./contextos-operacao");
const Chat = require("./_chat_ia");

const URL_SB = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const ANON = "sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb";
const LIMITE_DIARIO = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// REST do Supabase com o token do usuário (a RLS decide o que ele vê e grava).
function supabase(fetchFn, authorization) {
  return async (caminho, op = {}) => {
    const r = await fetchFn(`${URL_SB}/rest/v1/${caminho}`, { ...op, signal: globalThis.AbortSignal.timeout(8000),
      headers: { apikey: ANON, Authorization: authorization, Accept: "application/json", "Content-Type": "application/json", ...(op.headers || {}) } });
    // corpo (curto) do erro do PostgREST: separa o teto de 50 do CHECK de CPF nas perguntas salvas.
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, corpo: (await r.text().catch(() => "")).slice(0, 500) });
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
}

async function lerDadosDaConta(event, deps, ler) {
  const r = await (deps.contextos || contextosOperacao.handler)({ httpMethod: "GET", headers: { authorization: event.headers?.authorization || event.headers?.Authorization, origin: event.headers?.origin } });
  if (r?.statusCode !== 200) return null;
  const ctx = JSON.parse(r.body);
  const ids = (ctx.empresas || []).map((e) => e.empresaId).filter((id) => UUID.test(id));
  let boletins = [];
  if (ids.length) {
    try { boletins = await ler(`boletim_filtros_empresa?empresa_id=in.(${ids.join(",")})&select=empresa_id,filtro`) || []; } catch { boletins = []; }
  }
  return { ctx, boletins: Array.isArray(boletins) ? boletins : [] };
}

// Sem base nenhuma não chama a IA (economiza cota e evita resposta inventada). null = cair no modo base.
// Prazo total de 22 s para a cadeia inteira (antes até 48 s): a tela corta em 30 s e oferece Cancelar.
async function responderPelaIA(deps, { pergunta, historico, fontes, dados, tela, economico }) {
  const env = deps.env || process.env;
  if (!(fontes.juridico.length || fontes.ajuda.length || dados) || !haProvedorConfigurado(env)) return null;
  const r = await (deps.responder || responderComFallback)(Chat.montarMensagens({ pergunta, historico, fontes, dados, tela }), { maxTokens: 900, timeoutMs: 10000, orcamentoMs: 22000, json: true, economico }, { env });
  const ids = new Set([...fontes.juridico, ...fontes.ajuda].map((f) => f.id).concat(dados ? ["D"] : []));
  return r?.ok ? Chat.lerRespostaIA(r.texto, ids) : null;
}

async function perguntar(corpo, event, deps, ler, auth) {
  const { pergunta, historico } = Chat.lerPedido(corpo);
  if (pergunta.length < 2) return [400, { erro: "Escreva sua pergunta." }];
  const limite = await (deps.limitar || verificarLimiteDiario)(auth.userId, "chat-ia", LIMITE_DIARIO);
  if (!limite.ok) return [limite.status, { erro: limite.erro }];

  const pedirDados = Chat.querDados(pergunta);
  const lidos = pedirDados ? await lerDadosDaConta(event, deps, ler).catch(() => null) : null;
  const empresaAtiva = typeof corpo.empresaId === "string" && UUID.test(corpo.empresaId) ? corpo.empresaId : null;
  const dados = lidos ? Chat.resumirDados(lidos.ctx, empresaAtiva, lidos.boletins, pergunta) : null;
  const tela = Chat.lerContextoTela(corpo.contexto);
  // "Onde fica isso aqui?": o nome da tela entra na busca dos tutoriais.
  const daTela = tela?.titulo && /\baqui\b|\b(nesta|nessa|esta|essa) (tela|p[aá]gina)\b/i.test(pergunta) ? ` ${tela.titulo}` : "";
  const fontes = Chat.recuperarFontes(pergunta + daTela);

  const daIA = await responderPelaIA(deps, { pergunta, historico, fontes, dados, tela, economico: limite.economico === true });
  let saida = daIA || Chat.respostaSemIA(fontes, dados, pedirDados);
  if (pedirDados && !lidos && saida.naoSei) saida = { ...saida, resposta: "Não consegui ler os dados da sua conta agora. Tente de novo em instantes." };

  const resposta = { resposta: saida.resposta, fontes: Chat.citacoes(saida.ids, fontes, dados), naoSei: saida.naoSei, modo: daIA ? "ia" : "base", aviso: Chat.AVISO_IA, salvo: false };
  if (corpo.salvar === true) resposta.salvo = await salvar(ler, { corpo, pergunta, resposta, empresaAtiva: dados?.empresaAtiva ? empresaAtiva : null });
  return [200, resposta];
}

// Histórico opcional: grava com o token do usuário (policy de insert confere dono e empresa). Falha não derruba a resposta.
async function salvar(ler, { corpo, pergunta, resposta, empresaAtiva }) {
  const conversaId = typeof corpo.conversaId === "string" && UUID.test(corpo.conversaId) ? corpo.conversaId : globalThis.crypto.randomUUID();
  try {
    await ler("ia_conversas", { method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ conversa_id: conversaId, empresa_id: empresaAtiva, pergunta, resposta: resposta.resposta.slice(0, 4000), fontes: resposta.fontes }) });
    return true;
  } catch (e) {
    console.warn("chat-ia: histórico não salvo", e.status || e.message);
    return false;
  }
}

async function executarAcao(corpo, event, deps, ler, auth) {
  if (corpo.acao === "historico") {
    const mensagens = await ler("ia_conversas?select=id,conversa_id,pergunta,resposta,fontes,criado_em&order=criado_em.desc&limit=50");
    return [200, { mensagens: Array.isArray(mensagens) ? mensagens : [] }];
  }
  if (corpo.acao === "apagar") {
    await ler(`ia_conversas?usuario_id=eq.${encodeURIComponent(auth.userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return [200, { apagado: true }];
  }
  if (corpo.acao === "perguntas" || corpo.acao === "salvar_pergunta" || corpo.acao === "apagar_pergunta") return perguntasSalvas(corpo, ler);
  return perguntar(corpo, event, deps, ler, auth);
}

// Perguntas salvas da Plena (ia_perguntas_salvas.sql): token do usuário, a RLS só deixa ler e mexer nas próprias.
// Não gastam cota de IA. Tabela ausente (SQL ainda não aplicado) = lista vazia, para a tela mostrar só as prontas.
async function perguntasSalvas(corpo, ler) {
  const listar = async () => {
    try { return [200, { perguntas: (await ler("ia_perguntas_salvas?select=id,texto&order=criado_em.asc&limit=50")) || [] }]; } catch (e) {
      if (e.status === 404) return [200, { perguntas: [], indisponivel: true }];
      throw e;
    }
  };
  if (corpo.acao === "salvar_pergunta") {
    const texto = Chat.lerPerguntaSalva(corpo.texto);
    if (!texto) return [400, { erro: "Escreva a pergunta que quer salvar." }];
    try {
      await ler("ia_perguntas_salvas?on_conflict=usuario_id,texto", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ texto }) });
    } catch (e) {
      if (e.status === 404) return [503, { erro: "Perguntas salvas ainda não estão disponíveis." }];
      const recusa = Chat.motivoRecusaPergunta(e.status, e.corpo);
      if (recusa === "repetida") return listar();
      if (recusa) return [400, { erro: recusa }];
      throw e;
    }
    return listar();
  }
  if (corpo.acao === "apagar_pergunta") {
    if (typeof corpo.id !== "string" || !UUID.test(corpo.id)) return [400, { erro: "Pergunta inválida." }];
    await ler(`ia_perguntas_salvas?id=eq.${corpo.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return listar();
  }
  return listar();
}

exports.handler = async (event, deps = {}) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store" };
  const resposta = (status, body) => ({ statusCode: status, headers, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return resposta(204, {});
  if (event.httpMethod !== "POST") return resposta(405, { erro: "Método não permitido." });
  if (String(event.body || "").length > 8000) return resposta(413, { erro: "Pedido muito grande." });
  const auth = await (deps.autenticar || exigirUsuarioAprovado)(event);
  if (!auth.ok) return resposta(auth.status, { erro: auth.erro });
  let corpo;
  try { corpo = JSON.parse(event.body || "{}"); } catch { return resposta(400, { erro: "Pedido inválido." }); }
  if (!corpo || typeof corpo !== "object") return resposta(400, { erro: "Pedido inválido." });
  const ler = supabase(deps.fetch || fetch, event.headers?.authorization || event.headers?.Authorization);
  try {
    const [status, body] = await executarAcao(corpo, event, deps, ler, auth);
    return resposta(status, body);
  } catch (e) {
    console.warn("chat-ia: falha", e.status || e.message);
    return resposta(503, { erro: "O chat não está disponível agora. Tente de novo em instantes." });
  }
};
