// Resumo de 1 linha do filtro no topo do Boletim (24/11): conta estados/palavras, pega a data e o aviso do texto longo.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicio = html.indexOf("  function resumoMetaBoletim(");
assert.ok(inicio >= 0, "resumoMetaBoletim deve existir");
const contexto = vm.createContext({ normalizarUfs: (v) => (Array.isArray(v) ? v : v ? [v] : []) });
vm.runInContext(html.slice(inicio, html.indexOf("\n  }", inicio) + 4), contexto);
const resumo = contexto.resumoMetaBoletim;

test("filtro com estados, palavras e data vira uma linha curta", () => {
  const texto = "Boletim · estados: AM, RR · expediente, limpeza · publicações recentes e oportunidades abertas · lista atualizada em 23/11/2026, 17:00:12";
  assert.equal(resumo(texto, { ufs: ["AM", "RR"], palavrasRaw: "expediente, limpeza, " }), "Filtro: 2 estados · 2 palavras · atualizado 23/11 17:00");
});

test("singular, todos os estados e avisos de atualização", () => {
  assert.equal(resumo("Boletim · estados: todos · papel · buscando editais novos", { ufs: [], palavrasRaw: "papel" }),
    "Filtro: todos os estados · 1 palavra · buscando editais novos");
  assert.match(resumo('Boletim · estados: AM · x · Pode haver editais mais novos: clique em "Atualizar boletim"', { ufs: ["AM"], palavrasRaw: "x" }), /1 estado · 1 palavra · pode haver editais mais novos$/);
  assert.match(resumo("Boletim · estados: AM · x · não foi possível atualizar agora; mantendo a última edição disponível", { uf: "AM", palavrasRaw: "x" }), /mantendo a última edição$/);
});

test("textos curtos (sem filtro, edição de outro dia) não são resumidos", () => {
  assert.equal(resumo("Edição de 23/11/2026 · Empresa · filtro: principal", { ufs: ["AM"], palavrasRaw: "x" }), null);
  assert.equal(resumo("Boletim · estados: AM · x", null), null);
});
