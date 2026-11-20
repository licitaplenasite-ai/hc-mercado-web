// Utilitário compartilhado pelas Netlify Functions que custam dinheiro por chamada
// (ia-edital, despesas-fornecedor, sancoes) ou consultam dado sensível.
//
// Por quê isso existe: até agora, essas funções aceitavam chamada de qualquer lugar
// (Access-Control-Allow-Origin: "*") sem checar se quem chamou é um usuário logado do
// LicitaPlena — ou seja, qualquer pessoa que descobrisse o endereço da função podia chamá-la
// direto, sem estar logada e sem ser assinante, e isso soma na conta (cota da Groq, cota do
// token do Portal da Transparência). Ver Achado #3 do Diagnóstico Técnico Crítico.
//
// SUPABASE_URL/SUPABASE_ANON_KEY são as mesmas usadas no site (supabase-config.js) — a chave
// anon é pública por design, não é segredo. O que É segredo é SUPABASE_SERVICE_ROLE_KEY,
// usada só aqui, do lado do servidor, para gravar o contador de uso diário ignorando RLS.

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb";

// Origens permitidas a chamar essas funções. Ajuste aqui se o domínio mudar ou se for
// necessário liberar um ambiente de testes.
const ORIGENS_PERMITIDAS = [
  "https://licitaplena.com.br",
  "https://www.licitaplena.com.br",
  "https://licitaplena.pages.dev",
];

function origemPermitida(event) {
  const origem = event.headers?.origin || event.headers?.Origin || "";
  return ORIGENS_PERMITIDAS.includes(origem) ? origem : ORIGENS_PERMITIDAS[0];
}

function cabecalhosPadrao(event) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origemPermitida(event),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

// Confere se a requisição tem um token de sessão válido do Supabase (usuário realmente
// logado no LicitaPlena). Espera o token no cabeçalho Authorization: Bearer <token>, que o
// front-end já tem disponível via `(await sb.auth.getSession()).data.session.access_token`.
async function exigirUsuarioLogado(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, status: 401, erro: "É preciso estar logado pra usar esta ferramenta." };
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      if (resp.status !== 401 && resp.status !== 403) {
        console.warn(`auth: validação indisponível HTTP ${resp.status}`);
        return { ok: false, status: 503, erro: "A validação da sessão está temporariamente indisponível. Tente novamente em instantes." };
      }
      return { ok: false, status: 401, erro: "Sessão expirada ou inválida — faça login de novo." };
    }
    const user = await resp.json();
    if (!user || !user.id) {
      return { ok: false, status: 401, erro: "Sessão inválida." };
    }
    return { ok: true, userId: user.id, email: user.email };
  } catch (e) {
    return { ok: false, status: 503, erro: "Não foi possível validar sua sessão agora. Tenta de novo em instantes." };
  }
}

function recursoForaDoPlano(plano) {
  return {
    ok: false,
    status: 403,
    erro: `O plano ${plano.plano || "atual"} não inclui ${plano.nome_recurso || "este recurso"}. Fale com a gente para mudar de plano.`,
  };
}
// Resposta de consumir_uso_plano, ou null se a função não existe/não respondeu (o chamador usa o contador antigo).
async function consumirUsoPlano(opcoes) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consumir_uso_plano`, opcoes);
    const corpo = r.ok ? await r.json() : null;
    return corpo && typeof corpo === "object" && typeof corpo.permitido === "boolean" ? corpo : null;
  } catch {
    return null;
  }
}

// Limite diário de uso por usuário e por função (ex: 30 resumos de edital/dia). Guardado no
// Supabase via consumir_uso_plano (planos_e_recursos.sql), com incrementar_uso de reserva. A
// IA só prossegue com contagem válida. Os demais consumidores mantêm o comportamento
// anterior de contingência para não alterar envios e consultas fora deste fluxo.
async function verificarLimiteDiario(userId, nomeFuncao, limite) {
  const ehIA = nomeFuncao === "ia-edital" || nomeFuncao === "monte-busca-ia" || nomeFuncao === "fornecedor-ia" || nomeFuncao === "chat-ia";
  const indisponivel = ehIA ? { ok: false, status: 503, erro: "Não foi possível verificar o limite de uso da IA agora. Tente novamente em instantes." } : { ok: true };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return indisponivel;
  }
  // Antes da cota diária: pedido barrado pelo ritmo não gasta a cota do dia.
  const ritmo = await limitarContaPorMinuto(userId, nomeFuncao);
  if (!ritmo.ok) return ritmo;
  try {
    const opcoes = (corpo) => ({
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      ...(ehIA ? { signal: globalThis.AbortSignal.timeout(5000) } : {}),
    });
    // Plano da conta (supabase/planos_e_recursos.sql): recurso incluso? Limite do plano ou o desta rota.
    const plano = await consumirUsoPlano(opcoes({ p_usuario_id: userId, p_funcao: nomeFuncao, p_limite_padrao: limite }));
    if (plano?.motivo === "plano") return recursoForaDoPlano(plano);
    let resultado;
    if (plano) {
      limite = plano.limite;
      resultado = plano.contagem;
    } else {
      // Sem a função no banco (SQL ainda não aplicado): contador antigo, como antes.
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/incrementar_uso`, opcoes({ p_usuario_id: userId, p_funcao: nomeFuncao }));
      if (!resp.ok) {
        return indisponivel;
      }
      resultado = await resp.json();
    }
    const contagem = resultado;
    if (ehIA && (!Number.isSafeInteger(contagem) || contagem < 1)) return indisponivel;
    if (typeof contagem === "number" && contagem > limite) {
      return {
        ok: false,
        status: 429,
        erro: `Limite diário de uso desta ferramenta atingido (${limite}/dia). Volta amanhã ou fala com a gente pra ajustar seu plano.`,
      };
    }
    // usadas/limite: a tela mostra "N de X hoje" (contador de perguntas da IA).
    return typeof contagem === "number" ? { ok: true, usadas: contagem, limite } : { ok: true };
  } catch (e) {
    return indisponivel;
  }
}

// Cadastro aprovado (clientes.status), como login.html e criar-processo.js: conta suspensa ou pendente com JWT
// ainda válido não usa ferramenta nem grava na base compartilhada. Lê com o token do próprio usuário (a RLS de
// clientes só mostra a própria linha), então não depende da chave de serviço e falha fechado.
async function exigirClienteAprovado(event, userId) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${encodeURIComponent(userId)}&select=status`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth }, signal: globalThis.AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { ok: false, status: 503, erro: "Não foi possível conferir seu cadastro agora. Tente novamente em instantes." };
    const linhas = await resp.json();
    if (!Array.isArray(linhas) || linhas[0]?.status !== "aprovado") return { ok: false, status: 403, erro: "Acesso não autorizado." };
    return { ok: true };
  } catch {
    return { ok: false, status: 503, erro: "Não foi possível conferir seu cadastro agora. Tente novamente em instantes." };
  }
}

// Login + cadastro aprovado numa chamada só (o que todo endpoint de ferramenta precisa).
async function exigirUsuarioAprovado(event) {
  const usuario = await exigirUsuarioLogado(event);
  if (!usuario.ok) return usuario;
  const cadastro = await exigirClienteAprovado(event, usuario.userId);
  return cadastro.ok ? usuario : cadastro;
}

// Teto por IP das rotas sem login (teste de ataque 19/11, M5: script anônimo esgotava a cota do Cloudflare ou fazia
// o PNCP/Compras.gov bloquear nosso IP de saída). Desde 20/11 os proxies pncp-*/comprasgov-* exigem login aprovado
// (exigirAprovadoComLimite, que mantém este teto diário por IP); sem login, só com o teto por IP, ficam pncp-baixar
// (link aberto pelo navegador, sem cabeçalho de token), busca-publica e convenios-publico (landing).
// IP: só o cabeçalho que a própria plataforma define (mesma regra de portal-cliente.js): cf-connecting-ip no runtime
// do Workers, x-nf-client-connection-ip fora dele. O banco recebe HMAC-SHA256(chave de serviço, IP), nunca o IP.
// Sem IP confiável (ambiente local) ou sem chave de serviço não limita; falha do contador também não bloqueia
// (fail-open, como verificarLimiteDiario fora da IA): o teto protege contra abuso, não é controle de acesso.
const LIMITE_PROXY_POR_IP = 3000;
const ERRO_POR_MINUTO = "Muitos pedidos em pouco tempo. Espere 1 minuto e tente de novo.";
function ipConfiavel(event) {
  const h = event.headers || {};
  const ip = globalThis.navigator?.userAgent === "Cloudflare-Workers" ? h["cf-connecting-ip"] : h["x-nf-client-connection-ip"];
  return typeof ip === "string" && ip.trim() ? ip.trim() : null;
}
// Contador compartilhado entre as instâncias do Cloudflare (memória não serve: cada isolate conta sozinho).
// Reaproveita incrementar_uso_ip (uso_ip_diario, que apaga sozinho o que passou de ontem): a janela de 1 minuto
// vai no nome da função ("chat-ia@2026-11-20T12:34"), então cada minuto é uma linha nova. Devolve a contagem ou
// null (sem chave, rede ou resposta inválida); quem chama decide, e todos aqui liberam no null (fail-open).
async function contarUso(identidade, funcao) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  try {
    const chave = require("node:crypto").createHmac("sha256", serviceKey).update(identidade).digest("hex");
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/incrementar_uso_ip`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_chave: chave, p_funcao: funcao }),
      signal: globalThis.AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    const contagem = await resp.json();
    return Number.isSafeInteger(contagem) ? contagem : null;
  } catch {
    return null;
  }
}
const funcaoDoMinuto = (nomeFuncao) => `${nomeFuncao}@${new Date().toISOString().slice(0, 16)}`;

// porMinuto > 0 soma um teto curto por IP (páginas e links sem login, como pncp-baixar e a busca da landing).
async function limitarPorIp(event, nomeFuncao, limite = LIMITE_PROXY_POR_IP, porMinuto = 0) {
  const ip = ipConfiavel(event);
  if (!ip || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: true };
  if (porMinuto > 0 && (await contarUso(`ip:${ip}`, funcaoDoMinuto(nomeFuncao))) > porMinuto) {
    return { ok: false, status: 429, erro: ERRO_POR_MINUTO };
  }
  if ((await contarUso(`ip:${ip}`, nomeFuncao)) > limite) {
    return { ok: false, status: 429, erro: "Muitas consultas a partir desta rede hoje. Tente de novo amanhã." };
  }
  return { ok: true };
}

// Teto por minuto por conta nas rotas caras (IA, buscas no governo), além da cota diária: a cota de 40/dia não
// impede gastar tudo em 1 minuto e ocupar o limite por minuto da IA gratuita, que é de todos os clientes.
const LIMITE_POR_MINUTO_CONTA = {
  "ia-edital": 3, "chat-ia": 4, "fornecedor-ia": 3, "monte-busca-ia": 3,
  "analise-cnpj": 5, "analise-cnpj-buscar": 10, "analise-cnpj-cadastro": 5,
  "licitacao-anterior": 5, "licitacao-anterior-orgaos": 10, "sancoes": 20, "despesas-fornecedor": 10,
  "pagometro": 10, "conferir-cbs-ibs": 10,
};
// Proxies do PNCP/Compras.gov: a busca do painel abre 1 página por UF e por termo ao mesmo tempo (27 UFs x 5 termos
// = 135 pedidos num clique), por isso o teto é bem maior que o das rotas de IA.
const LIMITE_PROXY_POR_MINUTO_CONTA = 300;
async function limitarContaPorMinuto(userId, nomeFuncao, limite = LIMITE_POR_MINUTO_CONTA[nomeFuncao]) {
  if (!userId || !(limite > 0)) return { ok: true };
  const contagem = await contarUso(`conta:${userId}`, funcaoDoMinuto(nomeFuncao));
  return contagem > limite ? { ok: false, status: 429, erro: ERRO_POR_MINUTO } : { ok: true };
}

// Login aprovado + teto por minuto da conta + o teto diário por IP que já existia: o que os proxies do governo
// exigem desde 20/11 (antes eram públicos).
async function exigirAprovadoComLimite(event, nomeFuncao) {
  const usuario = await exigirUsuarioAprovado(event);
  if (!usuario.ok) return usuario;
  const ritmo = await limitarContaPorMinuto(usuario.userId, nomeFuncao, LIMITE_PROXY_POR_MINUTO_CONTA);
  if (!ritmo.ok) return ritmo;
  const rede = await limitarPorIp(event, nomeFuncao);
  return rede.ok ? usuario : rede;
}

// Fila de dossiês: o robô gera ~60 por dia para todos; sem teto por pessoa, uma conta ocupava o dia inteiro.
const LIMITE_FILA_DOSSIES_POR_CONTA = 10;
async function limitarFilaDossies(userId) {
  if (!userId) return { ok: true };
  const contagem = await contarUso(`conta:${userId}`, "fila-dossies");
  return contagem > LIMITE_FILA_DOSSIES_POR_CONTA
    ? { ok: false, status: 429, erro: `Você já pediu ${LIMITE_FILA_DOSSIES_POR_CONTA} leituras completas de edital hoje. Tente de novo amanhã.` }
    : { ok: true };
}


module.exports = { cabecalhosPadrao, exigirUsuarioLogado, exigirClienteAprovado, exigirUsuarioAprovado, verificarLimiteDiario, origemPermitida, limitarPorIp, limitarContaPorMinuto, exigirAprovadoComLimite, limitarFilaDossies };
