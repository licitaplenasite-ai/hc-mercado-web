const test = require('node:test');
const assert = require('node:assert/strict');
const { fatiar } = require('./paginacao-ui.js');

const lista = Array.from({ length: 23 }, (_, i) => i + 1);

test('fatiar: 10 por página, última página parcial', () => {
  const f = fatiar(lista, 3, 10);
  assert.deepEqual([f.pagina, f.paginas, f.inicio, f.fim, f.itens], [3, 3, 20, 23, [21, 22, 23]]);
});

test('fatiar: página fora do intervalo volta para o limite; tamanho inválido vira 10', () => {
  assert.equal(fatiar(lista, 99, 10).pagina, 3);
  assert.equal(fatiar(lista, 0, 10).pagina, 1);
  assert.equal(fatiar(lista, 'abc', 10).pagina, 1);
  assert.equal(fatiar(lista, 1, 7).tamanho, 10);
  assert.equal(fatiar(lista, 1, 25).paginas, 1);
});

test('fatiar: lista vazia tem 1 página e nenhum item', () => {
  const f = fatiar([], 5, 50);
  assert.deepEqual([f.pagina, f.paginas, f.total, f.itens.length], [1, 1, 0, 0]);
});
