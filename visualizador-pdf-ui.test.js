const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./visualizador-pdf-ui.js");

test("Ler aqui: só o proxy do próprio site, sempre com ver=1", () => {
  assert.equal(V.linkParaVer("/api/pncp-baixar?cnpj=1&ano=2026&sequencial=2&documento=3&nome=edital"), "/api/pncp-baixar?cnpj=1&ano=2026&sequencial=2&documento=3&nome=edital&ver=1");
  assert.equal(V.linkParaVer("/api/pncp-baixar?cnpj=1&ver=1"), "/api/pncp-baixar?cnpj=1&ver=1");
  for (const fora of ["https://evil.com/x.pdf", "//evil.com/api/pncp-baixar?x", "javascript:alert(1)", "/api/outra?x", "", null]) assert.equal(V.linkParaVer(fora), null, String(fora));
});

test("arquivo que já diz outro formato não ganha Ler aqui", () => {
  assert.equal(V.pareceNaoPdf("Planilha.xlsx"), true);
  assert.equal(V.pareceNaoPdf("anexos.ZIP"), true);
  assert.equal(V.pareceNaoPdf("Edital"), false);
  assert.equal(V.pareceNaoPdf("edital.pdf"), false);
});
