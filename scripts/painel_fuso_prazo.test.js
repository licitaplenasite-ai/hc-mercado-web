// Regressão (24/11/2026): o prazo gravado no banco ("...+00:00") aparecia no cartão do Funil com a hora UTC
// ("21:00" para 18h de Brasília). Extrai as funções reais do painel.html e roda em fusos diferentes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const funcao = (nome) => { const i = html.indexOf(`  function ${nome}(`); return html.slice(i, html.indexOf("\n  }", i) + 4); };
const codigo = funcao("formatarPrazoPropostas") + funcao("dataOperacional");

function carregar(tz) {
  const anterior = process.env.TZ;
  process.env.TZ = tz;
  try { const c = vm.createContext({}); vm.runInContext(codigo, c); return c; } finally {
    if (anterior === undefined) delete process.env.TZ; else process.env.TZ = anterior;
  }
}

for (const tz of ["UTC", "America/Sao_Paulo", "America/Manaus"]) {
  test(`prazo com fuso sai no horário de Brasília (navegador em ${tz})`, () => {
    const { formatarPrazoPropostas: f } = carregar(tz);
    assert.equal(f("2026-12-02T21:00:00+00:00"), "02/12/2026 18:00 (horário de Brasília)");
    assert.equal(f("2026-12-02T21:00:00Z"), "02/12/2026 18:00 (horário de Brasília)");
    assert.equal(f("2026-12-03T01:30:00+00:00"), "02/12/2026 22:30 (horário de Brasília)", "vira o dia em UTC, não em Brasília");
    assert.equal(f("2026-12-02T18:00:00-03:00"), "02/12/2026 18:00 (horário de Brasília)");
    // Sem fuso (PNCP) continua literal; só a data também.
    assert.equal(f("2026-12-02T18:00:00"), "02/12/2026 18:00 (horário de Brasília)");
    assert.equal(f("2026-12-02"), "02/12/2026");
    assert.equal(f(null), "Não informado");
  });
  test(`data do PNCP sem fuso grava o instante de Brasília (navegador em ${tz})`, () => {
    const { dataOperacional: d } = carregar(tz);
    assert.equal(d("2026-12-02T18:00:00", true), "2026-12-02T21:00:00.000Z");
    assert.equal(d("2026-12-02 18:00", true), "2026-12-02T21:00:00.000Z");
    assert.equal(d("2026-12-02T21:00:00Z", true), "2026-12-02T21:00:00.000Z");
    assert.equal(d("2026-12-02", false), "2026-12-02");
    assert.equal(d("2026-12-02T23:30:00", false), "2026-12-02", "23h30 de Brasília ainda é o mesmo dia");
    assert.equal(d("lixo", true), null);
  });
}
