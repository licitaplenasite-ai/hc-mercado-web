/* global Response */
const test = require("node:test");
const assert = require("node:assert/strict");

// Proxies do governo exigem login desde 20/11: as páginas mandam o token que o supabase-js guarda no navegador.
test("fetchComSessao manda o token da sessão guardada e não inventa token sem sessão", async () => {
  const anteriores = { url: globalThis.SUPABASE_URL, ls: globalThis.localStorage, fetch: globalThis.fetch };
  const chamadas = [];
  const guardado = {};
  globalThis.SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
  globalThis.localStorage = { getItem: (k) => guardado[k] ?? null };
  globalThis.fetch = async (url, op) => { chamadas.push({ url, op }); return new Response("{}"); };
  try {
    const { fetchComSessao } = require("./fetch-sessao.js");
    await fetchComSessao("/api/pncp-itens?x=1");
    assert.equal(chamadas[0].op.headers.Authorization, undefined);
    guardado["sb-lsqjamqvmrcyrvowndiu-auth-token"] = JSON.stringify({ access_token: "tok-1" });
    await fetchComSessao("/api/pncp-proxy", { headers: { Accept: "application/json" }, method: "GET" });
    assert.deepEqual(chamadas[1].op.headers, { Accept: "application/json", Authorization: "Bearer tok-1" });
    assert.equal(chamadas[1].op.method, "GET");
    guardado["sb-lsqjamqvmrcyrvowndiu-auth-token"] = "{json quebrado";
    await fetchComSessao("/api/pncp-proxy");
    assert.equal(chamadas[2].op.headers.Authorization, undefined);
  } finally {
    globalThis.SUPABASE_URL = anteriores.url; globalThis.localStorage = anteriores.ls; globalThis.fetch = anteriores.fetch;
  }
});
