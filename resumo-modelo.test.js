/* global Buffer */
const test = require("node:test");
const assert = require("node:assert/strict");
const { texto } = require("./resumo-modelo.js");

// Monta o texto quebrado byte a byte (UTF-8 lido como Latin-1), como chega de alguns cadastros do portal.
const quebrado = (s) => Buffer.from(s, "utf8").toString("latin1");

test("texto: conserta acento quebrado vindo do portal e não mexe em texto certo", () => {
  assert.equal(texto(quebrado("POLICLÍNICA ANTONIO ALEIXO")), "POLICLÍNICA ANTONIO ALEIXO");
  assert.equal(texto(quebrado("SECRETARIA DE SAÚDE")), "SECRETARIA DE SAÚDE");
  assert.equal(texto("Ação de Saúde"), "Ação de Saúde");
  assert.equal(texto("ÃREA"), "ÃREA"); // sem par quebrado válido: fica como veio
});
