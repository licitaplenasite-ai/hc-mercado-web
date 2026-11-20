const test = require('node:test');
const assert = require('node:assert/strict');
const IM = require('./item-mercado-ui.js');

const compra = (o) => ({ marca: 'BIC', fornecedor: 'A LTDA', documentoFornecedor: '11222333000144', unidade: 'UN', valorUnitarioCentavos: 100, dataResultado: '2026-10-01', codigoPdm: 1, ...o });
const resposta = (j, ok = true) => ({ ok, json: async () => j });

test('consultaDoItem usa o CATMAT só quando é número e limpa o termo', () => {
  assert.deepEqual(IM.consultaDoItem({ descricao: '(ID1) CANETA ESFEROGRÁFICA, AZUL', codigoCatalogo: '622254' }), { termo: 'CANETA ESFEROGRÁFICA', catmat: '622254' });
  assert.equal(IM.consultaDoItem({ descricao: 'Caneta', codigoCatalogo: 'x1' }).catmat, '');
  assert.equal(IM.consultaDoItem({ descricao: 'Caneta', codigoCatalogo: null }).catmat, '');
});

test('carregar com CATMAT faz uma chamada só', async () => {
  const urls = [];
  const r = await IM.carregar({ descricao: 'Caneta', codigoCatalogo: '622254' }, async (u) => { urls.push(u); return resposta({ ok: true, itens: [compra()] }); });
  assert.equal(r.origem, 'catmat');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /codigoItem=622254/);
});

test('CATMAT sem compras cai no termo: catálogo + 200 compras do produto principal', async () => {
  const urls = [];
  const r = await IM.carregar({ descricao: 'Caneta', codigoCatalogo: '9' }, async (u) => {
    urls.push(u);
    if (/codigoItem/.test(u)) return resposta({ ok: true, itens: [] });
    if (/codigoPdm/.test(u)) return resposta({ ok: true, itens: [compra(), compra()] });
    return resposta({ ok: true, catalogos: [{ codigo: 1, descricao: 'Caneta' }], itens: [compra()] });
  });
  assert.equal(r.origem, 'termo');
  assert.equal(r.itens.length, 2);
  assert.equal(urls.length, 3);
});

test('termo: página falhou fica a amostra marcada como parcial; fonte fora devolve erro', async () => {
  const r = await IM.carregar({ descricao: 'Caneta' }, async (u) => (/codigoPdm/.test(u) ? resposta({ ok: false }, false) : resposta({ ok: true, catalogos: [{ codigo: 1 }], itens: [compra(), compra({ codigoPdm: 2 })] })));
  assert.equal(r.itens.length, 1);
  assert.equal(r.parcial, true);
  const e = await IM.carregar({ descricao: 'Caneta' }, async () => resposta({ ok: false, erro: 'fora' }, false));
  assert.deepEqual([e.itens.length, e.erro], [0, 'fora']);
});

test('abas: preços só na unidade mais comprada, vencedores com CNPJ e marcas', () => {
  const a = IM.abas([compra({ valorUnitarioCentavos: 100 }), compra({ valorUnitarioCentavos: 300, dataResultado: '2026-11-01' }), compra({ unidade: 'CX', valorUnitarioCentavos: 5000, documentoFornecedor: '99888777000166', fornecedor: 'B', marca: 'FABER' })]);
  assert.deepEqual([a.precos.unidade, a.precos.resumo.mediana, a.precos.unidades, a.precos.ultimo.valorUnitarioCentavos], ['UN', 200, 2, 300]);
  assert.equal(a.historico[0].dataResultado, '2026-11-01');
  assert.equal(a.concorrencia[0].nome, 'A LTDA');
  assert.equal(a.concorrencia[0].quantidade, 2);
  assert.deepEqual(a.marcas.map((m) => m.nome), ['BIC', 'FABER']);
  assert.equal(IM.abas([]).precos.resumo.mediana, null);
});
