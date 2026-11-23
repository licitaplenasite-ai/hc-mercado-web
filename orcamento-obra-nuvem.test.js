'use strict';
// Nuvem do Orçamento de obra: o que fazer ao abrir a página e as mensagens de erro (o resto é tela, provado no e2e).
const test = require('node:test');
const assert = require('node:assert');
const N = require('./orcamento-obra-nuvem.js');

test('ao abrir: sem documento nada; rascunho de antes da nuvem sobe; versão mais nova na nuvem abre ou vira conflito', () => {
  assert.equal(N.decidirAoAbrir({ id: 'a', versao: 1 }, { versao: 5 }, false), 'nada');
  assert.equal(N.decidirAoAbrir(null, null, true), 'salvar', 'v1 sem meta');
  assert.equal(N.decidirAoAbrir({ id: null, pendente: true }, null, true), 'salvar', 'planilha nova ainda não salva');
  assert.equal(N.decidirAoAbrir({ id: null, pendente: false }, null, true), 'nada', 'apagado na nuvem e ninguém mexeu');
  assert.equal(N.decidirAoAbrir({ id: 'a', versao: 3, pendente: false }, null, true), 'apagado');
  assert.equal(N.decidirAoAbrir({ id: 'a', versao: 3, pendente: false }, { versao: 4 }, true), 'abrir_nuvem');
  assert.equal(N.decidirAoAbrir({ id: 'a', versao: 3, pendente: true }, { versao: 4 }, true), 'conflito', 'não sobrescreve o que outro gravou');
  assert.equal(N.decidirAoAbrir({ id: 'a', versao: 3, pendente: true }, { versao: 3 }, true), 'salvar', 'sem rede antes: sobe agora');
  assert.equal(N.decidirAoAbrir({ id: 'a', versao: 3, pendente: false }, { versao: 3 }, true), 'nada');
});

test('mensagens de erro em português simples; só falha de rede tenta de novo sozinha', () => {
  const rede = N.mensagemErro({ message: 'TypeError: Failed to fetch' });
  assert.equal(rede.rede, true);
  assert.match(rede.texto, /guardado neste navegador/);
  const leitura = N.mensagemErro({ code: '42501', message: 'new row violates row-level security policy' });
  assert.equal(leitura.rede, false);
  assert.match(leitura.texto, /só de leitura/);
  assert.match(N.mensagemErro({ code: 'P0001', message: 'Limite de 200 orçamentos por empresa atingido' }).texto, /200 orçamentos/);
  assert.match(N.mensagemErro({ code: '23514', message: 'check' }).texto, /6 MB/);
  for (const e of [rede, leitura, N.mensagemErro({ code: 'XX000', message: 'internal' })]) assert.doesNotMatch(e.texto, /fetch|policy|internal/i);
});

test('igualdade sem a hora: reabrir sem mudar não cria versão nova', () => {
  assert.equal(N.semData({ a: 1, salvoEm: '2026-11-23T10:00:00Z' }), N.semData({ a: 1, salvoEm: '2026-11-23T11:00:00Z' }));
  assert.notEqual(N.semData({ a: 1 }), N.semData({ a: 2 }));
  // jsonb devolve as chaves em outra ordem: abrir da nuvem não pode contar como mudança.
  assert.equal(N.semData({ b: { y: [1, { q: 1, p: 2 }], x: 2 }, a: 1 }), N.semData({ a: 1, b: { x: 2, y: [1, { p: 2, q: 1 }] } }));
  assert.notEqual(N.semData({ l: [1, 2] }), N.semData({ l: [2, 1] }), 'ordem da lista importa');
});
