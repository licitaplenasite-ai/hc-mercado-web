// Aviso no celular (Web Push): inscrição do aparelho e preferências por tipo de aviso da conta.
//   GET                                                   -> {ok, chavePublica, preferencias}
//   POST {acao:"inscrever", inscricao:{endpoint, keys:{p256dh, auth}}, aparelho?} -> {ok}
//   POST {acao:"cancelar", endpoint}                      -> {ok}
//   POST {acao:"preferencias", preferencias:{edital, prazo, pregoeiro, certidao}} -> {ok, preferencias}
// Login e cadastro aprovado obrigatórios. O envio é do robô (scripts/avisos_celular.js), não daqui: a chave
// privada VAPID fica só no GitHub; o site só conhece a pública (VAPID_CHAVE_PUBLICA).
// O endpoint vira destino de POST do robô: só serviços de push conhecidos (sem isso, qualquer URL viraria SSRF
// a partir do GitHub Actions). Tabelas em supabase/avisos_celular.sql.
const { cabecalhosPadrao, exigirUsuarioAprovado, verificarLimiteDiario } = require("./_auth");

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const LIMITE_DIARIO = 60;
const MAX_INSCRICOES = 10; // aparelhos por conta; o mais antigo sai quando passa
const TIPOS = ["edital", "prazo", "pregoeiro", "certidao"];
// Chrome/Edge Android (FCM), Firefox (Mozilla), Safari/iPhone (Apple), Edge Windows (WNS).
const HOSTS_PUSH = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

function validarInscricao(i) {
  if (!i || typeof i !== "object" || typeof i.endpoint !== "string" || i.endpoint.length > 1000) return null;
  let u;
  try { u = new URL(i.endpoint); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !HOSTS_PUSH.some((r) => r.test(u.hostname))) return null;
  const p256dh = i.keys?.p256dh, auth = i.keys?.auth;
  if (typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{86,88}={0,2}$/.test(p256dh)) return null;
  if (typeof auth !== "string" || !/^[A-Za-z0-9_-]{22,24}={0,2}$/.test(auth)) return null;
  return { endpoint: u.href, p256dh: p256dh.replace(/=+$/, ""), auth: auth.replace(/=+$/, "") };
}

function validarPreferencias(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const saida = {};
  for (const t of TIPOS) {
    if (typeof p[t] !== "boolean") return null;
    saida[t] = p[t];
  }
  return saida;
}

async function rest(caminho, opcoes = {}) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { ...opcoes, signal: globalThis.AbortSignal.timeout(10000),
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json", ...(opcoes.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${caminho.split("?")[0]} HTTP ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function inscrever(usuario, inscricao, aparelho) {
  // Mesmo endpoint de outra conta (aparelho trocou de login): passa a ser desta, que provou ter o aparelho.
  await rest("avisos_celular_inscricoes?on_conflict=endpoint", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ usuario_id: usuario, ...inscricao, aparelho, criado_em: new Date().toISOString() }) });
  const minhas = await rest(`avisos_celular_inscricoes?usuario_id=eq.${usuario}&select=id&order=criado_em.desc`);
  const sobra = (minhas || []).slice(MAX_INSCRICOES).map((x) => x.id);
  if (sobra.length) await rest(`avisos_celular_inscricoes?id=in.(${sobra.join(",")})`, { method: "DELETE" });
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store" };
  const responder = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return responder(204, {});
  if (!["GET", "POST"].includes(event.httpMethod)) return responder(405, { erro: "Método não permitido." });
  const auth = await exigirUsuarioAprovado(event);
  if (!auth.ok) return responder(auth.status, { erro: auth.erro });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return responder(503, { erro: "Avisos no celular indisponíveis neste ambiente." });
  const usuario = encodeURIComponent(auth.userId);

  try {
    if (event.httpMethod === "GET") {
      const [linha] = (await rest(`avisos_celular_preferencias?usuario_id=eq.${usuario}&select=${TIPOS.join(",")}`)) || [];
      return responder(200, { ok: true, chavePublica: process.env.VAPID_CHAVE_PUBLICA || null,
        preferencias: Object.fromEntries(TIPOS.map((t) => [t, linha ? linha[t] : true])) });
    }
    if (String(event.body || "").length > 4000) return responder(413, { erro: "Pedido grande demais." });
    let corpo;
    try { corpo = JSON.parse(event.body || ""); } catch { return responder(400, { erro: "JSON inválido." }); }
    const limite = await verificarLimiteDiario(auth.userId, "avisos-celular", LIMITE_DIARIO);
    if (!limite.ok) return responder(limite.status, { erro: limite.erro });

    if (corpo?.acao === "inscrever") {
      const inscricao = validarInscricao(corpo.inscricao);
      if (!inscricao) return responder(400, { erro: "Inscrição do aparelho inválida." });
      const aparelho = typeof corpo.aparelho === "string" ? corpo.aparelho.replace(/[^\w .,;()/-]/g, "").slice(0, 120) : null;
      await inscrever(auth.userId, inscricao, aparelho);
      return responder(200, { ok: true });
    }
    if (corpo?.acao === "cancelar") {
      if (typeof corpo.endpoint !== "string" || corpo.endpoint.length > 1000) return responder(400, { erro: "Endpoint inválido." });
      await rest(`avisos_celular_inscricoes?usuario_id=eq.${usuario}&endpoint=eq.${encodeURIComponent(corpo.endpoint)}`, { method: "DELETE" });
      return responder(200, { ok: true });
    }
    if (corpo?.acao === "preferencias") {
      const preferencias = validarPreferencias(corpo.preferencias);
      if (!preferencias) return responder(400, { erro: "Preferências inválidas." });
      await rest("avisos_celular_preferencias?on_conflict=usuario_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ usuario_id: auth.userId, ...preferencias, atualizado_em: new Date().toISOString() }) });
      return responder(200, { ok: true, preferencias });
    }
    return responder(400, { erro: "Ação inválida." });
  } catch (e) {
    console.error("avisos-celular:", e.message);
    return responder(502, { erro: "Não foi possível salvar agora. Tente novamente." });
  }
};

exports.validarInscricao = validarInscricao;
exports.validarPreferencias = validarPreferencias;
