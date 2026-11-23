// Status das Ferramentas (status-ferramentas.js, aba Saúde do sistema do admin.html): o cartão da Prospecção mostra a
// cobertura real por UF e tipo. Saiu do painel do cliente em 23/11.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ctx = require("../status-ferramentas.js");

const ler = (nome) => fs.readFileSync(path.join(__dirname, "..", nome), "utf8");

test("Status das Ferramentas mora no admin, não no painel do cliente", () => {
  const painel = ler("painel.html"), admin = ler("admin.html");
  assert.doesNotMatch(painel, /id="status"|status-cartoes|Status das Ferramentas/);
  assert.match(admin, /<script src="status-ferramentas\.js"><\/script>/);
  assert.match(admin, /id="secao-saude"[\s\S]*id="status-cartoes"[\s\S]*id="secao-boletim"/);
  assert.doesNotMatch(admin, /painel\.html#status/);
  const sprite = ler("menu-icones.svg");
  for (const f of ctx.FONTES_STATUS) assert.match(sprite, new RegExp(`<symbol id="${f.icone}"`), f.icone);
});

test("classificarFonte: em dia, atrasado, sem leitura e PNCP parcial", () => {
  const h = (horas) => new Date(Date.now() - horas * 36e5).toISOString();
  assert.equal(ctx.classificarFonte({ ok: true, atualizadoEm: h(2) }).cor, "var(--verde)");
  assert.match(ctx.classificarFonte({ ok: true, atualizadoEm: h(100) }).texto, /^Atrasado/);
  assert.equal(ctx.classificarFonte({ ok: false }).marca, "○");
  const parcial = ctx.classificarFonte({ ok: true, atualizadoEm: h(1), ufsComFalha: ["AM", "PA"] });
  assert.equal(parcial.texto, "Atualização parcial — 2 estado(s) pendente(s)");
  assert.equal(parcial.detalhe, "Estados pendentes: AM, PA.");
});

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
