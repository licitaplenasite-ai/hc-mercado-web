const test = require("node:test");
const assert = require("node:assert/strict");
const { handler, sanitizar } = require("../planilha-ia");

const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const evento = (corpo, metodo = "POST") => ({ httpMethod: metodo, headers: { origin: "https://licitaplena.com.br" }, body: JSON.stringify(corpo) });
const ok = { autenticar: async () => ({ ok: true, userId: "u1" }), limitar: async () => ({ ok: true }), env: { GEMINI_API_KEY: "g" } };
const RESPOSTA = JSON.stringify({
  linhas: [{ item: "1.1", codigo: "97622", descricao: " DEMOLIÇÃO   DE ALVENARIA ", unidade: "m³", quantidade: "18,07", precoUnitario: "53,20", total: "961,32" }, { item: "TOTAL", total: "1,00" }, { item: "1", descricao: "ETAPA", total: "961,32" }],
  rodape: { custoDireto: "961,32", bdi: "28,35%", global: null, globalOfertado: "1.000,00", lixo: "x" },
  textos: ["OBRA: REFORMA"],
});

test("lê a página com o Gemini e devolve só o formato combinado, com a imagem e a instrução de não calcular", async () => {
  let enviado;
  const r = await handler(evento({ imagem: IMG }), { ...ok, chamar: async (prov, modelo, mensagens) => { enviado = { prov, mensagens }; return "```json\n" + RESPOSTA + "\n```"; } });
  assert.equal(r.statusCode, 200);
  const corpo = JSON.parse(r.body);
  assert.deepEqual(corpo.linhas.map((l) => l.item), ["1.1", "1"]);
  assert.equal(corpo.linhas[0].descricao, "DEMOLIÇÃO DE ALVENARIA");
  assert.deepEqual(corpo.rodape, { custoDireto: "961,32", bdi: "28,35%", global: null, globalOfertado: "1.000,00" });
  assert.equal(enviado.prov.nome, "gemini");
  assert.equal(enviado.mensagens[1].content[1].image_url.url, IMG);
  assert.match(enviado.mensagens[0].content, /NUNCA calcule/);
});

test("sem login, método errado, imagem inválida e sem Gemini não chamam a IA nem gastam cota", async () => {
  const falha = { chamar: async () => assert.fail("IA chamada"), limitar: async () => assert.fail("cota gasta") };
  assert.equal((await handler(evento({ imagem: IMG }), { ...ok, ...falha, autenticar: async () => ({ ok: false, status: 401, erro: "x" }) })).statusCode, 401);
  assert.equal((await handler(evento({ imagem: IMG }, "GET"), { ...ok, ...falha })).statusCode, 405);
  assert.equal((await handler(evento({ imagem: "data:text/html;base64,PHNjcmlwdD4=" }), { ...ok, ...falha })).statusCode, 400);
  assert.equal((await handler(evento({ imagem: IMG }), { ...ok, ...falha, env: { GROQ_API_KEY: "so-groq" } })).statusCode, 503, "Groq não lê imagem");
  assert.equal((await handler({ ...evento({}), body: "x".repeat(1536 * 1024 + 500) }, { ...ok, ...falha })).statusCode, 413);
});

test("limite diário vira 429; IA fora do ar ou resposta sem tabela dá 502", async () => {
  assert.equal((await handler(evento({ imagem: IMG }), { ...ok, limitar: async () => ({ ok: false, status: 429, erro: "Limite" }), chamar: async () => assert.fail("IA chamada") })).statusCode, 429);
  assert.equal((await handler(evento({ imagem: IMG }), { ...ok, chamar: async () => null })).statusCode, 502);
  assert.equal((await handler(evento({ imagem: IMG }), { ...ok, chamar: async () => "não consegui ler" })).statusCode, 502);
  assert.equal(sanitizar('{"linhas":"x"}'), null);
});
