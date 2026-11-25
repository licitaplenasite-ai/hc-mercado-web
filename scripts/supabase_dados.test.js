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

// 24/11: hidratação de contratos por offset estourou o statement timeout (57014).
function tabelaFalsa(total, { timeoutAcimaDe = Infinity } = {}) {
  const chaves = Array.from({ length: total }, (_, i) => `00000000000191-2-${String(i).padStart(6, "0")}/2025`);
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const q = new URL(url).searchParams;
    const limite = Number(q.get("limit"));
    if (limite > timeoutAcimaDe) return { ok: false, status: 500, text: async () => '{"code":"57014","message":"canceling statement due to statement timeout"}' };
    const depois = q.get("numero_controle_pncp");
    const resto = depois ? chaves.filter((c) => c > depois.slice(3)) : chaves;
    return { ok: true, json: async () => resto.slice(0, limite).map((c) => ({ numero_controle_pncp: c, dado: { id: c } })) };
  };
  return { chaves, urls, fetch };
}

test("hidratação pagina pela chave primária, sem offset, e traz cada linha uma vez", async () => {
  const t = tabelaFalsa(2500);
  const linhas = await carregar(t.fetch).baixarTodasAsLinhas("contratos", "dado", "numero_controle_pncp");
  assert.deepEqual(Array.from(linhas, (l) => l.dado.id), t.chaves);
  assert.equal(t.urls.length, 3);
  for (const url of t.urls) {
    assert.match(url, /select=dado%2Cnumero_controle_pncp&order=numero_controle_pncp\.asc&limit=1000/);
    assert.doesNotMatch(url, /offset/);
  }
  assert.doesNotMatch(t.urls[0], /gt\./);
  assert.ok(new URL(t.urls[1]).searchParams.get("numero_controle_pncp") === `gt.${t.chaves[999]}`, "chave com / vai codificada e intacta");
});

test("hidratação com página múltipla exata termina na página vazia", async () => {
  const t = tabelaFalsa(2000);
  assert.equal((await carregar(t.fetch).baixarTodasAsLinhas("contratos", "dado", "numero_controle_pncp")).length, 2000);
  assert.equal(t.urls.length, 3);
});

test("timeout numa página de leitura repete pela metade em vez de derrubar o robô", async () => {
  const t = tabelaFalsa(700, { timeoutAcimaDe: 300 });
  const linhas = await carregar(t.fetch).baixarTodasAsLinhas("contratos", "dado", "numero_controle_pncp");
  assert.deepEqual(Array.from(linhas, (l) => l.dado.id), t.chaves);
  const negado = carregar(async () => ({ ok: false, status: 401, text: async () => "JWT expired" }));
  await assert.rejects(negado.baixarTodasAsLinhas("contratos", "dado", "numero_controle_pncp"), /HTTP 401/);
  const sempre = tabelaFalsa(10, { timeoutAcimaDe: 0 });
  await assert.rejects(carregar(sempre.fetch).baixarTodasAsLinhas("contratos", "dado", "numero_controle_pncp"), /57014/);
});
