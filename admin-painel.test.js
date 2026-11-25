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
  assert.deepEqual(A.ROBOS.map((r) => r.codigo), ["pncp", "ufs", "mercado", "prospeccao", "sancoes", "boletim", "lembretes", "cobranca", "bases_obra", "vigia_normas", "precos", "fontes_extras"]);
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

// Incidente 23/11: fila de pedidos de cliente parada e coleta com alarme não apareciam em lugar nenhum.
test("alarmes da Saúde: pedido de processo há mais de 1 h e coleta do PNCP atrasada", () => {
  assert.deepEqual(A.alarmesSaude({}, AGORA), []);
  assert.deepEqual(A.alarmesSaude({ dossies_interesse_atrasados: { esperando: 0, mais_antigo: null }, coleta_alarme: { oportunidades: [], contratos: [] } }, AGORA), []);
  const um = A.alarmesSaude({ dossies_interesse_atrasados: { esperando: 1, mais_antigo: ha(5) } }, AGORA);
  assert.equal(um.length, 1);
  assert.match(um[0], /^1 processo de cliente espera .*há 5 horas/);
  const varios = A.alarmesSaude({ dossies_interesse_atrasados: { esperando: 3, mais_antigo: ha(2) },
    coleta_alarme: { oportunidades: ["cobertura de oportunidades há mais de 120 h: MG, PI"], contratos: ["contratos: scan nacional sem concluir desde 20261115"] } }, AGORA);
  assert.equal(varios.length, 3);
  assert.match(varios[0], /^3 processos de clientes esperam/);
  assert.match(varios[1], /^Busca de editais atrasada: .*MG, PI/);
  assert.match(varios[2], /^Contratos assinados atrasada: /);
});

test('resumoPreConsulta: última rodada, cobertura, 429 e próxima em português; sem registro avisa', () => {
  const { resumoPreConsulta } = require('./admin-painel');
  const agora = new Date('2026-11-25T12:00:00Z').getTime();
  assert.match(resumoPreConsulta(null, agora), /ainda sem registro/);
  const t = resumoPreConsulta({ em: '2026-11-25T07:00:00Z', proxima: '2026-11-26T05:41:00Z', consultas: 200, completos: 157, ufs: ['AM'], bloqueios429: 17, falhas: 4, paraProxima: 43, parouCedo: '429' }, agora);
  assert.match(t, /há 5 horas, 157 de 200 buscas prontas \(79%\), incluindo as de AM; 17 pedido\(s\) de calma \(429\), 4 falha\(s\), 43 para a próxima rodada\./);
  assert.match(t, /pediu calma/);
  assert.match(t, /Próxima rodada a partir de/);
});

test('resumoFontesExtras: portais que responderam, editais abertos e quem falhou', () => {
  const { resumoFontesExtras } = require('./admin-painel');
  const agora = new Date('2026-11-25T12:00:00Z').getTime();
  assert.match(resumoFontesExtras(null, agora), /ainda sem registro/);
  assert.equal(resumoFontesExtras({ em: '2026-11-25T10:00:00Z', fontes: { aadc: { ok: true, abertas: 3 }, bll: { ok: false, erro: 'x' } } }, agora),
    'Editais fora do PNCP: última rodada há 2 horas, 1 de 2 portais responderam, 3 edital(is) aberto(s). Sem resposta: bll.');
});
