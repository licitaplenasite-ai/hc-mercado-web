const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./operacao-acompanhamento');

test('andamento: avançar grava hoje só nos passos sem data; voltar apaga os seguintes', () => {
  assert.deepEqual(A.andamentoItem({}, 'enviado', '2026-11-20', ' BR123 ').dados,
    { entrega_situacao: 'enviado', rastreio: 'BR123', comprado_em: '2026-11-20', enviado_em: '2026-11-20', entregue_em: null });
  const item = { comprado_em: '2026-11-01', enviado_em: '2026-11-05', entregue_em: null };
  assert.deepEqual(A.andamentoItem(item, 'entregue', '2026-11-20', '').dados,
    { entrega_situacao: 'entregue', rastreio: null, comprado_em: '2026-11-01', enviado_em: '2026-11-05', entregue_em: '2026-11-20' });
  assert.deepEqual(A.andamentoItem({ ...item, entregue_em: '2026-11-20' }, 'aguardando_compra', '2026-11-21').dados,
    { entrega_situacao: 'aguardando_compra', rastreio: null, comprado_em: null, enviado_em: null, entregue_em: null });
});

test('andamento: passo, data e rastreio inválidos são recusados', () => {
  assert.ok(A.andamentoItem({}, 'perdido', '2026-11-20').erro);
  assert.ok(A.andamentoItem({}, 'comprado', '20/11/2026').erro);
  assert.ok(A.andamentoItem({}, 'comprado', '2026-11-20', 'x'.repeat(501)).erro);
});

test('contador do resumo: só itens ganhos; sem passo conta como aguardando compra', () => {
  assert.deepEqual(A.contarAndamento([
    { situacao: 'ganho' }, { situacao: 'ganho', entrega_situacao: 'entregue' }, { situacao: 'ganho', entrega_situacao: 'comprado' },
    { situacao: 'perdido', entrega_situacao: 'entregue' }, { situacao: 'ganho', entrega_situacao: 'xyz' },
  ]), { aguardando_compra: 2, comprado: 1, enviado: 0, entregue: 1, total: 4 });
  assert.deepEqual(A.contarAndamento(null), { aguardando_compra: 0, comprado: 0, enviado: 0, entregue: 0, total: 0 });
});
