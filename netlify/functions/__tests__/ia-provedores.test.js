const test = require("node:test");
const assert = require("node:assert/strict");
const { responderComFallback, haProvedorConfigurado, montarProvedoresCompat } = require("../_ia_provedores");

const MENSAGENS = [{ role: "user", content: "oi" }];
const OPCOES = { maxTokens: 100 };
const resp = (status, corpo = {}) => ({ ok: status < 300, status, json: async () => corpo, text: async () => "" });
const ok = (texto) => resp(200, { choices: [{ message: { content: texto }, finish_reason: "stop" }] });

function fetchPorHost(regras, chamadas = []) {
  return async (url, opcoes) => {
    const host = new URL(url).host;
    const modelo = JSON.parse(opcoes.body).model;
    chamadas.push(`${host.split(".")[0]}/${modelo}`);
    const r = regras[host];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(modelo) : r;
  };
}
const HOST_GEMINI = "generativelanguage.googleapis.com";
const HOST_OR = "openrouter.ai";
const HOST_CF = "api.cloudflare.com";
const groqFalha = async () => ({ ok: false, erro: "limite da Groq" });

test('Groq com espaços e compatível truncado não contam como sucesso', async () => {
  const r = await responderComFallback(MENSAGENS, OPCOES, { env: { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' },
    groq: async () => ({ ok: true, texto: '   ' }),
    fetchFn: async () => resp(200, { choices: [{ message: { content: 'Resposta truncada' }, finish_reason: 'length' }] }) });
  assert.equal(r.ok, false);
  assert.ok(r.erro?.trim());
});

test("Gemini vem primeiro: responde e a Groq nem é chamada", async () => {
  const chamadas = [];
  const r = await responderComFallback(MENSAGENS, OPCOES, {
    env: { GROQ_API_KEY: "g", GEMINI_API_KEY: "k" }, groq: async () => assert.fail("Groq só entra depois das outras"),
    fetchFn: fetchPorHost({ [HOST_GEMINI]: ok("resposta gemini") }, chamadas),
  });
  assert.deepEqual([r.ok, r.texto, r.provedor, r.modelo], [true, "resposta gemini", "gemini", "gemini-3.8-flash"]);
  assert.deepEqual(chamadas, ["generativelanguage/gemini-3.8-flash"]);
});

test("Groq é a última reserva: só responde depois de Gemini, OpenRouter e Cloudflare falharem", async () => {
  const ordem = [];
  const r = await responderComFallback(MENSAGENS, OPCOES, {
    env: { GROQ_API_KEY: "g", GEMINI_API_KEY: "k", OPENROUTER_API_KEY: "o", OPENROUTER_MODELOS: "m1", CLOUDFLARE_ACCOUNT_ID: "c", CLOUDFLARE_AI_TOKEN: "t" },
    groq: async () => { ordem.push("groq"); return { ok: true, texto: "da groq" }; },
    fetchFn: fetchPorHost({ [HOST_GEMINI]: resp(429), [HOST_OR]: resp(503), [HOST_CF]: resp(500) }, ordem),
  });
  assert.deepEqual([r.ok, r.provedor, r.texto], [true, "groq", "da groq"]);
  assert.deepEqual(ordem, ["generativelanguage/gemini-3.8-flash", "openrouter/m1", "api/@cf/openai/gpt-oss-120b", "groq"]);
});

test("pula provedores sem chave e segue modelo a modelo até o sucesso", async () => {
  const chamadas = [];
  const r = await responderComFallback(MENSAGENS, OPCOES, {
    env: { GEMINI_API_KEY: "k", OPENROUTER_API_KEY: "o", OPENROUTER_MODELOS: "m1,m2", CLOUDFLARE_AI_TOKEN: "sem-conta" },
    groq: async () => assert.fail("Groq sem chave não deve ser chamada"),
    fetchFn: fetchPorHost({ [HOST_GEMINI]: resp(503), [HOST_OR]: (m) => (m === "m1" ? resp(429) : ok("do openrouter")) }, chamadas),
  });
  assert.equal(r.provedor, "openrouter");
  assert.deepEqual(chamadas, ["generativelanguage/gemini-3.8-flash", "openrouter/m1", "openrouter/m2"]);
});

test("timeout, resposta vazia e 401 passam ao Cloudflare (sem Groq configurada)", async () => {
  const chamadas = [];
  const r = await responderComFallback(MENSAGENS, OPCOES, {
    env: { GEMINI_API_KEY: "k", GEMINI_MODELOS_PERGUNTA: "g1", OPENROUTER_API_KEY: "o", OPENROUTER_MODELOS: "m1", CLOUDFLARE_ACCOUNT_ID: "c", CLOUDFLARE_AI_TOKEN: "t" },
    fetchFn: fetchPorHost({ [HOST_GEMINI]: Object.assign(new Error("x"), { name: "AbortError" }), [HOST_OR]: ok("   "), [HOST_CF]: ok("do cloudflare") }, chamadas),
  });
  assert.deepEqual([r.provedor, r.modelo], ["cloudflare", "@cf/openai/gpt-oss-120b"]);
  assert.deepEqual(chamadas, ["generativelanguage/g1", "openrouter/m1", "api/@cf/openai/gpt-oss-120b"]);
});

test("todos falham: devolve o erro da Groq; sem Groq, mensagem genérica", async () => {
  const falha = { [HOST_GEMINI]: resp(429) };
  const comGroq = await responderComFallback(MENSAGENS, OPCOES, { env: { GROQ_API_KEY: "g", GEMINI_API_KEY: "k" }, groq: groqFalha, fetchFn: fetchPorHost(falha) });
  assert.deepEqual([comGroq.ok, comGroq.erro], [false, "limite da Groq"]);
  const semGroq = await responderComFallback(MENSAGENS, OPCOES, { env: { GEMINI_API_KEY: "k" }, fetchFn: fetchPorHost(falha) });
  assert.equal(semGroq.ok, false);
  assert.match(semGroq.erro, /indisponíveis/);
});

test("não inicia novo provedor depois do orçamento total de tempo", async () => {
  let relogio = 0;
  const chamadas = [];
  const fetchFn = async (url, opcoes) => { chamadas.push(JSON.parse(opcoes.body).model); relogio += 46000; return resp(503); };
  const r = await responderComFallback(MENSAGENS, OPCOES, { env: { GEMINI_API_KEY: "k" }, fetchFn, agora: () => relogio });
  assert.equal(r.ok, false);
  assert.equal(chamadas.length, 1);
});

test("haProvedorConfigurado e Cloudflare exigem as variáveis certas", () => {
  assert.equal(haProvedorConfigurado({}), false);
  assert.equal(haProvedorConfigurado({ GROQ_API_KEY: "g" }), true);
  assert.equal(haProvedorConfigurado({ CLOUDFLARE_AI_TOKEN: "t" }), false);
  assert.deepEqual(montarProvedoresCompat({ CLOUDFLARE_ACCOUNT_ID: "c", CLOUDFLARE_AI_TOKEN: "t", CLOUDFLARE_AI_MODELO: "@cf/x" })[0].modelos, ["@cf/x"]);
});

test("Gemini, OpenRouter e Cloudflare lentos (timeout) ainda deixam tempo para a Groq", async () => {
  let relogio = 0;
  const prazosGroq = [];
  const prazos = [];
  const chamadas = [];
  // Cada provedor lento consome o prazo inteiro que recebeu e então expira.
  const groq = async (_chave, _mensagens, opcoes) => { prazosGroq.push(opcoes.timeoutMs); return { ok: true, texto: "da groq" }; };
  const fetchFn = async (url, opcoes) => {
    const host = new URL(url).host;
    chamadas.push(host.split(".")[0]);
    const prazo = 12000;
    prazos.push(prazo);
    relogio += prazo;
    throw Object.assign(new Error("x"), { name: "AbortError" });
  };
  const r = await responderComFallback(MENSAGENS, { ...OPCOES, timeoutMs: 20000 }, {
    env: { GROQ_API_KEY: "g", GEMINI_API_KEY: "k", OPENROUTER_API_KEY: "o", OPENROUTER_MODELOS: "m1", CLOUDFLARE_ACCOUNT_ID: "c", CLOUDFLARE_AI_TOKEN: "t" },
    groq, fetchFn, agora: () => relogio,
  });
  assert.deepEqual(chamadas, ["generativelanguage", "openrouter", "api"]);
  assert.deepEqual(prazos, [12000, 12000, 12000]);
  // 48 s de orçamento - 36 s gastos = 12 s para a Groq.
  assert.deepEqual(prazosGroq, [12000]);
  assert.deepEqual([r.ok, r.provedor], [true, "groq"]);
});

test("corpoExtra (contrato estruturado) vai no corpo do provedor compatível", async () => {
  const { chamarCompat } = require("../_ia_provedores");
  let corpo;
  const texto = await chamarCompat({ nome: "gemini", url: "https://generativelanguage.googleapis.com/x", apiKey: "k" }, "g1", MENSAGENS,
    { maxTokens: 50, corpoExtra: { response_format: { type: "json_object" }, reasoning_effort: "low" } },
    async (_url, opcoes) => { corpo = JSON.parse(opcoes.body); return ok("{}"); }, 1000);
  assert.equal(texto, "{}");
  assert.deepEqual([corpo.model, corpo.response_format, corpo.reasoning_effort, corpo.max_tokens], ["g1", { type: "json_object" }, "low", 50]);
});

// Uso justo (21/11): passou da IA do mês, as opções baratas vêm antes e o Gemini fica de última reserva.
test("modo econômico: OpenRouter e Groq antes do Gemini; só com Gemini ele ainda responde", async () => {
  const chamadas = [];
  const env = { GROQ_API_KEY: "g", GEMINI_API_KEY: "k", OPENROUTER_API_KEY: "o", OPENROUTER_MODELOS: "barato" };
  let r = await responderComFallback(MENSAGENS, { ...OPCOES, economico: true }, {
    env, groq: groqFalha, fetchFn: fetchPorHost({ [HOST_OR]: resp(429), [HOST_GEMINI]: ok("gemini no fim") }, chamadas) });
  assert.deepEqual([r.ok, r.provedor], [true, "gemini"]);
  assert.deepEqual(chamadas, ["openrouter/barato", "generativelanguage/gemini-3.8-flash"]);
  r = await responderComFallback(MENSAGENS, { ...OPCOES, economico: true }, {
    env, groq: async () => ({ ok: true, texto: "groq barata" }), fetchFn: fetchPorHost({ [HOST_OR]: resp(500), [HOST_GEMINI]: () => assert.fail("Gemini não entra antes da Groq") }) });
  assert.deepEqual([r.ok, r.provedor], [true, "groq"]);
  r = await responderComFallback(MENSAGENS, { ...OPCOES, economico: true }, { env: { GEMINI_API_KEY: "k" }, fetchFn: fetchPorHost({ [HOST_GEMINI]: ok("só gemini") }) });
  assert.deepEqual([r.ok, r.texto], [true, "só gemini"]);
});
