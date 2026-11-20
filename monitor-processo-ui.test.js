const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("./monitor-processo-ui.js");

test("contadores: arquivos novos somam novos e trocados; tipos sem contador não entram", () => {
  const c = M.contar([{ tipo: "aviso" }, { tipo: "esclarecimento" }, { tipo: "esclarecimento" }, { tipo: "arquivo_novo" }, { tipo: "arquivo_retificado" },
    { tipo: "data" }, { tipo: "outro" }, { tipo: "chat" }]);
  assert.deepEqual(Object.fromEntries(c.map((x) => [x.chave, x.total])), { aviso: 1, esclarecimento: 2, impugnacao: 0, arquivo: 2, data: 1, chat: 1 });
  assert.equal(M.contar(null).every((x) => x.total === 0), true);
});

test("novo = com alerta e detectado nos últimos 7 dias", () => {
  const agora = Date.parse("2026-11-19T12:00:00Z");
  assert.equal(M.recente({ alerta: true, detectado_em: "2026-11-13T12:00:00Z" }, agora), true);
  assert.equal(M.recente({ alerta: true, detectado_em: "2026-11-11T12:00:00Z" }, agora), false);
  assert.equal(M.recente({ alerta: false, detectado_em: "2026-11-19T11:00:00Z" }, agora), false);
});

test("selo do Funil e links oficiais", () => {
  assert.deepEqual(M.seloFunil(true, 3), { classe: "perto", texto: "Mudou o edital (3)" });
  assert.deepEqual(M.seloFunil(true, 0), { classe: "ok", texto: "Monitorado" });
  assert.equal(M.seloFunil(false, 0), null);
  assert.equal(M.linkPncp("07237373000120-1-000084/2025"), "https://pncp.gov.br/app/editais/07237373000120/2025/84");
  assert.equal(M.linkPncp("javascript:x"), null);
  assert.equal(M.linkQuadro("17908505901022025"), "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing?destino=quadro-informativo&compra=17908505901022025");
  assert.equal(M.linkQuadro("1\"><x"), null);
});
