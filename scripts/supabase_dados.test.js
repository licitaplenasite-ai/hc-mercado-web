const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const codigo = fs.readFileSync(path.join(__dirname, "supabase_dados.js"), "utf8");

function carregar(fetch) {
  const ambiente = vm.createContext({ fetch, console: { warn() {} }, AbortSignal: globalThis.AbortSignal, process: { env: { SUPABASE_SERVICE_ROLE_KEY: "somente-teste" } }, module: { exports: {} } });
  vm.runInContext(codigo, ambiente);
  return ambiente.module.exports;
}

test("falha no segundo lote não apaga base; repetição faz upsert idempotente", async () => {
  const base = new Map([["anterior", { chave: "anterior" }]]);
  let chamadas = 0;
  let falhar = true;
  const api = carregar(async (_url, opcoes) => {
    assert.equal(opcoes.method, "POST");
    assert.match(opcoes.headers.Prefer, /merge-duplicates/);
    chamadas++;
    if (falhar && chamadas === 2) throw new Error("timeout simulado");
    for (const linha of JSON.parse(opcoes.body)) base.set(linha.chave, linha);
    return { ok: true };
  });
  const linhas = [{ chave: "a" }, { chave: "b" }, { chave: "c" }];
  await assert.rejects(api.upsertEmLotes("teste", linhas, "chave", 2), /timeout simulado/);
  assert.deepEqual([...base.keys()], ["anterior", "a", "b"]);
  falhar = false;
  assert.equal(await api.upsertEmLotes("teste", linhas, "chave", 2), 3);
  assert.deepEqual([...base.keys()], ["anterior", "a", "b", "c"]);
});

test("statement timeout (57014) divide o lote ao meio em vez de derrubar o robô", async () => {
  const tamanhos = [];
  const api = carregar(async (_url, opcoes) => {
    const n = JSON.parse(opcoes.body).length;
    tamanhos.push(n);
    if (n > 100) return { ok: false, status: 500, text: async () => '{"code":"57014","message":"canceling statement due to statement timeout"}' };
    return { ok: true };
  });
  const linhas = Array.from({ length: 300 }, (_, i) => ({ chave: String(i) }));
  assert.equal(await api.upsertEmLotes("contratos", linhas, "chave", 300), 300);
  assert.deepEqual(tamanhos, [300, 150, 75, 75, 150, 75, 75]);
  // Erro que não é timeout (ex.: 401) não é mascarado por reenvio.
  const negado = carregar(async () => ({ ok: false, status: 401, text: async () => "JWT expired" }));
  await assert.rejects(negado.upsertEmLotes("contratos", linhas, "chave", 300), /HTTP 401/);
});

test("REST usa prazo finito também para upsert", async () => {
  const api = carregar(async (_url, opcoes) => {
    assert.ok(opcoes.signal instanceof globalThis.AbortSignal);
    assert.equal(opcoes.signal.aborted, false);
    return { ok: true };
  });
  await api.upsertEmLotes("teste", [{ chave: "a" }], "chave");
});
