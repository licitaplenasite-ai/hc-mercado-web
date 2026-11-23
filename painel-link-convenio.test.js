// Regressão 23/11: o ícone "Publicação" dos convênios abria /convenios/<id da API> e o Portal
// da Transparência respondia "Página não encontrada". A página pública usa o número do convênio.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("./painel.html"), "utf8");
const inicio = html.indexOf("  function linkConvenio(");
const fim = html.indexOf("  function formatarDataIso(", inicio);
assert.ok(inicio > 0 && fim > inicio);
const ctx = { siglaUf: (v) => ({ PARANÁ: "PR", AM: "AM" }[v] || String(v || "").toUpperCase()) };
vm.runInNewContext(`${html.slice(inicio, fim)}\nthis.linkConvenio = linkConvenio;`, ctx);

test("usa o número do convênio, nunca o id interno da API", () => {
  assert.equal(ctx.linkConvenio({ id: 348959633, numero: "945123", numeroProcesso: "x" }), "https://portaldatransparencia.gov.br/convenios/945123");
});

test("registro antigo sem número cai na consulta pelo processo + UF", () => {
  assert.equal(
    ctx.linkConvenio({ id: 348959633, numeroProcesso: "08012003615202365   ", uf: "PARANÁ" }),
    "https://portaldatransparencia.gov.br/convenios/consulta?numeroProcesso=08012003615202365&uf=PR"
  );
  assert.equal(ctx.linkConvenio({ id: 1, numeroProcesso: "251132024", uf: "" }), "https://portaldatransparencia.gov.br/convenios/consulta?numeroProcesso=251132024");
});

test("sem número nem processo não mostra link", () => {
  assert.equal(ctx.linkConvenio({ id: 348959633 }), null);
  assert.equal(ctx.linkConvenio(null), null);
});
