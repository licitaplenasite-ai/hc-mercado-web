const test = require('node:test');
const assert = require('node:assert/strict');
const { lerAba, situacaoPrazo, proximosPassos } = require('./processo-abas.js');

test('lerAba: só abas conhecidas voltam da URL', () => {
  assert.equal(lerAba('#aba=itens'), 'itens');
  assert.equal(lerAba('#x=1&aba=agenda'), 'agenda');
  assert.equal(lerAba('#aba=nada'), null);
  assert.equal(lerAba(''), null);
  assert.equal(lerAba(undefined), null);
});

test('situacaoPrazo: em dia, atenção, hoje, passou e sem data (dia de Brasília)', () => {
  const agora = Date.parse('2026-11-23T12:00:00-03:00');
  assert.equal(situacaoPrazo('2026-11-30T10:00:00-03:00', agora).situacao, 'em-dia');
  assert.match(situacaoPrazo('2026-11-30T10:00:00-03:00', agora).texto, /faltam 7 dias/);
  const amanha = situacaoPrazo('2026-11-24T09:00:00-03:00', agora);
  assert.deepEqual([amanha.situacao, /falta 1 dia$/.test(amanha.texto)], ['atencao', true]);
  assert.equal(situacaoPrazo('2026-11-23T22:30:00-03:00', agora).situacao, 'atrasado');
  assert.match(situacaoPrazo('2026-11-23T22:30:00-03:00', agora).texto, /^Sessão hoje, 22:30/);
  assert.match(situacaoPrazo('2026-11-20T10:00:00-03:00', agora).texto, /^Sessão foi em/);
  assert.equal(situacaoPrazo('', agora), null);
  assert.equal(situacaoPrazo('não é data', agora), null);
});

test('proximosPassos: ordem do trabalho e só o que falta', () => {
  assert.deepEqual(proximosPassos({}).map((p) => p.texto), []);
  assert.deepEqual(proximosPassos({ itens: { total: 0 } }).map((p) => p.texto), ['importar os itens do edital']);
  assert.deepEqual(proximosPassos({ itens: { total: 200, marcados: 0 } }).map((p) => p.aba), ['itens']);
  assert.deepEqual(proximosPassos({ itens: { total: 200, marcados: 12, semPreco: 1 }, documentos: { propostas: 0 } }).map((p) => p.texto),
    ['preencher o preço de 1 item', 'gerar e conferir a proposta']);
  assert.deepEqual(proximosPassos({ itens: { total: 200, marcados: 12, semPreco: 0 }, documentos: { propostas: 1, propostaConferida: false } }).map((p) => p.texto),
    ['conferir a prévia da proposta']);
  assert.deepEqual(proximosPassos({ itens: { total: 2, marcados: 2, semPreco: 0 }, documentos: { propostas: 1, propostaConferida: true } }), []);
});
