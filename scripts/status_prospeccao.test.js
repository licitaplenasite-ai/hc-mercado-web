// Status das Ferramentas (painel.html): o cartão da Prospecção mostra a cobertura real por UF e tipo.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicio = html.indexOf("  function resumoProspeccao(");
const ctx = vm.createContext({});
vm.runInContext(html.slice(inicio, html.indexOf("\n  }", inicio) + 4), ctx);

test("resumoProspeccao: conta UFs com coleta completa nos últimos 3 dias e lista as que faltam", () => {
  const agora = Date.parse("2026-11-25T12:00:00Z");
  const ufs = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");
  const etapas = {};
  for (const uf of ufs) for (const t of ["contrato", "ata"]) etapas[`${uf}:${t}`] = { concluidaEm: "2026-11-24T10:00:00Z" };
  etapas["AM:pca"] = { concluidaEm: "2026-11-25T08:00:00Z" };
  etapas["SP:pca"] = { concluidaEm: "2026-11-20T08:00:00Z" }; // velho: não conta
  etapas.irp = { concluidaEm: "2026-11-25T09:00:00Z" };
  const r = ctx.resumoProspeccao([{ dado: { atualizadoEm: "2026-11-25T09:00:00Z", etapas } }, { dado: { atualizadoEm: "2026-11-25T11:00:00Z", etapas: {} } }], agora);
  assert.equal(r.atualizadoEm, "2026-11-25T11:00:00Z");
  assert.equal(r.detalhe, "Coleta completa nos últimos 3 dias: planos de compras em 1 de 27 UFs, atas em 27 de 27 UFs, contratos em 27 de 27 UFs; IRP em dia.");
  assert.equal(r.pendentes.length, 26);
  assert.ok(!r.pendentes.includes("AM") && r.pendentes.includes("SP"));
  assert.equal(ctx.resumoProspeccao([], agora).pendentes.length, 27);
});
