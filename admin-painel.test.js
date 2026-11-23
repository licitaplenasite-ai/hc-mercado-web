const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./admin-painel.js");

const AGORA = Date.parse("2026-11-22T12:00:00Z");
const ha = (horas) => new Date(AGORA - horas * 3600000).toISOString();

test("robô diário: em dia até 30 h, atenção até 48 h, parado depois", () => {
  assert.equal(A.classificarRobo(ha(23), 24, AGORA).nivel, "ok");
  assert.equal(A.classificarRobo(ha(30), 24, AGORA).nivel, "ok");
  assert.equal(A.classificarRobo(ha(31), 24, AGORA).nivel, "atencao");
  assert.equal(A.classificarRobo(ha(48), 24, AGORA).nivel, "atencao");
  assert.equal(A.classificarRobo(ha(49), 24, AGORA).nivel, "parado");
  assert.match(A.classificarRobo(ha(49), 24, AGORA).texto, /há 2 dias/);
});

test("robô de hora em hora tem no mínimo 24 h de folga antes de parado; semanal só para depois de 2 semanas", () => {
  assert.equal(A.classificarRobo(ha(7), 2, AGORA).nivel, "ok");
  assert.equal(A.classificarRobo(ha(20), 2, AGORA).nivel, "atencao");
  assert.equal(A.classificarRobo(ha(27), 2, AGORA).nivel, "parado");
  assert.equal(A.classificarRobo(ha(170), 168, AGORA).nivel, "ok");
  assert.equal(A.classificarRobo(ha(300), 168, AGORA).nivel, "atencao");
  assert.equal(A.classificarRobo(ha(400), 168, AGORA).nivel, "parado");
});

test("sem registro não vira 'parado' e explica quando aparece", () => {
  for (const v of [null, undefined, "", "lixo"]) assert.equal(A.classificarRobo(v, 24, AGORA).nivel, "sem_registro");
});

test("todos os robôs pedidos estão no catálogo, com nome e frase em português", () => {
  assert.deepEqual(A.ROBOS.map((r) => r.codigo), ["pncp", "ufs", "mercado", "prospeccao", "sancoes", "boletim", "lembretes", "cobranca", "bases_obra", "vigia_normas"]);
  for (const r of A.ROBOS) { assert.ok(r.nome && r.faz && r.prazoHoras > 0); assert.doesNotMatch(r.nome, /\bUF|base\b/); }
});

test("cobertura dos estados: conta os pendentes e ignora lixo", () => {
  assert.equal(A.coberturaEstados([]).texto, "Editais em dia dos 27 estados.");
  const c = A.coberturaEstados(["AC", "RR", "xx", 3]);
  assert.equal(c.emDia, 25);
  assert.deepEqual(c.pendentes, ["AC", "RR"]);
  assert.match(c.texto, /25 dos 27 estados\. Faltam: AC, RR/);
  assert.equal(A.coberturaEstados(undefined).emDia, 27);
  assert.match(A.coberturaEstados(null).texto, /ainda sem registro/);
});

test("motivo da falha do boletim em português", () => {
  assert.match(A.motivoFalhaBoletim("timed out"), /demorou demais/);
  assert.match(A.motivoFalhaBoletim("(535, b'5.7.8 Username and Password not accepted')"), /senha do e-mail/);
  assert.match(A.motivoFalhaBoletim("(550, b'5.1.1 The email account that you tried to reach does not exist')"), /não existe/);
  assert.match(A.motivoFalhaBoletim("HTTP Error 400: remetente recusado pelo ZeptoMail: confirme x"), /ZeptoMail/);
  assert.match(A.motivoFalhaBoletim("Daily user sending limit exceeded"), /limite diário/);
  assert.match(A.motivoFalhaBoletim("[Errno -3] Temporary failure in name resolution: getaddrinfo"), /conexão/);
  assert.equal(A.motivoFalhaBoletim(""), "Erro sem detalhe.");
  assert.equal(A.motivoFalhaBoletim("algo estranho"), "Erro no envio: algo estranho");
});
