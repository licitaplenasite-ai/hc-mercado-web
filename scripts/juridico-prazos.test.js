const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../juridico-prazos.js');
const Funil = require('../funil-tarefas-ui.js');

const ultimo = (evento, dia, codigo) => P.calcular(evento, dia).find((p) => p.codigo === codigo).ultimoDia;

// Casos conferidos à mão no calendário (art. 183: exclui o dia do evento; só dia útil conta).
test('impugnação e esclarecimento: 3 dias úteis antes da abertura, pulando feriado nacional', () => {
  // Sessão sexta 27/11/2026: qui 26 (1), qua 25 (2), ter 24 (3).
  assert.equal(ultimo('abertura', '2026-11-27', 'impugnacao'), '2026-11-24');
  assert.equal(ultimo('abertura', '2026-11-27', 'esclarecimento'), '2026-11-24');
  assert.equal(ultimo('abertura', '2026-11-27', 'resposta'), '2026-11-26');
  // Sessão segunda 23/11/2026: sex 20 é Consciência Negra; qui 19 (1), qua 18 (2), ter 17 (3).
  assert.equal(ultimo('abertura', '2026-11-23', 'impugnacao'), '2026-11-17');
  assert.equal(ultimo('abertura', '2026-11-23', 'resposta'), '2026-11-19');
});

test('prazo "antes": Carnaval e Corpus Christi não contam (o último dia sai mais cedo)', () => {
  // Sessão qui 11/02/2027: qua 10 (1), ter 9 e seg 8 Carnaval, sex 5 (2), qui 4 (3).
  assert.equal(ultimo('abertura', '2027-02-11', 'impugnacao'), '2027-02-04');
  // Sessão seg 08/06/2026: sex 5 (1), qui 4 Corpus Christi, qua 3 (2), ter 2 (3).
  assert.equal(ultimo('abertura', '2026-06-08', 'impugnacao'), '2026-06-02');
});

test('recurso e contrarrazões: 3 dias úteis depois, com Natal, Ano-Novo e Sexta-feira Santa', () => {
  // Ata qua 23/12/2026: qui 24 (1), sex 25 Natal, seg 28 (2), ter 29 (3).
  assert.equal(ultimo('ata', '2026-12-23', 'recurso'), '2026-12-29');
  // Contrarrazão estimada: +3 depois do fim do recurso: qua 30, qui 31, sex 1º/1 feriado, seg 04/01/2027.
  assert.equal(ultimo('ata', '2026-12-23', 'contrarrazao-estimada'), '2027-01-04');
  // Ata qui 02/04/2026: sex 3 Sexta-feira Santa, seg 6 (1), ter 7 (2), qua 8 (3).
  assert.equal(ultimo('ata', '2026-04-02', 'recurso'), '2026-04-08');
  // Ata no sábado 28/11/2026: seg 30 (1), ter 1º/12 (2), qua 2 (3).
  assert.equal(ultimo('ata', '2026-11-28', 'recurso'), '2026-12-02');
  assert.equal(ultimo('recurso', '2026-11-23', 'contrarrazao'), '2026-11-26');
});

test('prazo "depois": Carnaval conta como dia útil (o último dia também sai mais cedo)', () => {
  // Ata sex 05/02/2027: seg 8 (1), ter 9 (2), qua 10 (3).
  assert.equal(ultimo('ata', '2027-02-05', 'recurso'), '2027-02-10');
});

test('sanção: 15 dias úteis para defesa, recurso e reconsideração', () => {
  // Intimação seg 23/11/2026 → seg 14/12/2026 (sem feriado no meio).
  assert.equal(ultimo('sancao_defesa', '2026-11-23', 'defesa-sancao'), '2026-12-14');
  assert.equal(ultimo('sancao_decisao', '2026-11-23', 'recurso-sancao'), '2026-12-14');
  assert.equal(ultimo('sancao_decisao', '2026-11-23', 'reconsideracao-inidoneidade'), '2026-12-14');
});

test('publicação: prazo mínimo do art. 55 até a sessão', () => {
  // Publicação seg 23/11/2026: +8 úteis = qui 03/12; +10 úteis = seg 07/12.
  assert.equal(ultimo('publicacao', '2026-11-23', 'sessao-8'), '2026-12-03');
  assert.equal(ultimo('publicacao', '2026-11-23', 'sessao-10'), '2026-12-07');
});

test('entrada inválida devolve null; texto traz data e dia da semana; toda linha cita a Lei 14.133', () => {
  assert.equal(P.calcular('abertura', ''), null);
  assert.equal(P.calcular('abertura', '27/11/2026'), null);
  assert.equal(P.calcular('inexistente', '2026-11-27'), null);
  assert.equal(P.calcular('abertura', '2026-11-27')[0].texto, '24/11/2026 (terça-feira)');
  for (const e of Object.keys(P.EVENTOS)) for (const p of P.calcular(e, '2026-11-23')) {
    assert.match(p.base.dispositivo, /^arts?\. \d+/, `${e}:${p.codigo}`);
    assert.match(p.base.url, /^https:\/\/www\.planalto\.gov\.br\//);
  }
});

test('feriados nacionais iguais aos do Funil (mesma regra em dois módulos)', () => {
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2029, 0, 1); t += 864e5) {
    const dia = new Date(t).toISOString().slice(0, 10);
    assert.equal(P.feriadoNacional(dia), Funil.feriado(dia), dia);
  }
});
