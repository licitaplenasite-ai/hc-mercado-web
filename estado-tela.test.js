'use strict';
// 24/11 (dono: "trocar de tela tem que continuar do jeito que tá"): estado guardado por tela nesta aba. O que pode
// quebrar: mostrar o resultado de outra conta/empresa, guardar acima do limite, nunca conferir de novo o que envelheceu.
const test = require('node:test');
const assert = require('node:assert');

function armazenamento(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), mapa: m };
}
const token = (id) => JSON.stringify({ access_token: 'a', user: { id } });
globalThis.localStorage = armazenamento({ 'sb-x-auth-token': token('u1'), licitaplena_empresa_operacional_id: 'e1' });
globalThis.sessionStorage = armazenamento();
const E = require('./estado-tela.js');
const localStorage = globalThis.localStorage;

test('guarda e lê o resultado da tela; novo até 15 min, velho depois', () => {
  const t = 1_000_000_000_000;
  assert.ok(E.guardar('mercado', { termo: 'notebook' }, t));
  assert.deepEqual(E.ler('mercado', t + 60_000), { dado: { termo: 'notebook' }, em: t, velho: false });
  assert.equal(E.ler('mercado', t + 16 * 60_000).velho, true);
  assert.equal(E.ler('mercado', t + 13 * 3600_000), null, 'passou de 12 h: some');
});

test('outra conta ou outra empresa não vê o que foi guardado', () => {
  E.guardar('precos', { termo: 'papel' });
  localStorage.setItem('licitaplena_empresa_operacional_id', 'e2');
  assert.equal(E.ler('precos'), null);
  localStorage.setItem('licitaplena_empresa_operacional_id', 'e1');
  localStorage.setItem('sb-x-auth-token', token('u2'));
  assert.equal(E.ler('precos'), null);
  localStorage.setItem('sb-x-auth-token', token('u1'));
  assert.deepEqual(E.ler('precos').dado, { termo: 'papel' });
});

test('sem login guardado nada é gravado', () => {
  const antes = localStorage.getItem('sb-x-auth-token');
  localStorage.removeItem('sb-x-auth-token');
  assert.equal(E.guardar('x', 1), false);
  assert.equal(E.ler('x'), null);
  localStorage.setItem('sb-x-auth-token', antes);
});

test('acima do limite não guarda e apaga o guardado antigo da mesma tela', () => {
  E.guardar('grande', 'pequeno');
  assert.equal(E.guardar('grande', 'x'.repeat(E.LIMITE)), false);
  assert.equal(E.ler('grande'), null);
});

test('armazenamento cheio: apaga as outras telas guardadas e tenta de novo', () => {
  E.guardar('a', 1); E.guardar('b', 2);
  const s = globalThis.sessionStorage, original = s.setItem;
  let falhas = 1;
  s.setItem = (k, v) => { if (falhas-- > 0) throw new Error('QuotaExceededError'); original(k, v); };
  assert.ok(E.guardar('c', 3));
  s.setItem = original;
  assert.equal(E.ler('a'), null);
  assert.equal(E.ler('c').dado, 3);
});
