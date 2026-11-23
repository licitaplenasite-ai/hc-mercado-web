const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./itens-escolha-ui.js');
const ui = require('./itens-processo-ui.js');

test('valor com vírgula e ponto de milhar vira texto do servidor; ponto decimal antigo continua valendo', () => {
  assert.equal(E.normalizarDecimal('52,00', 2), '52.00');
  assert.equal(E.normalizarDecimal(' R$ 1.500,50 ', 2), '1500.50');
  assert.equal(E.normalizarDecimal('10.400,00', 2), '10400.00');
  assert.equal(E.normalizarDecimal('1.500', 2), '1500');
  assert.equal(E.normalizarDecimal('1.10', 2), '1.10');
  assert.equal(E.normalizarDecimal('0,5', 2), '0.5');
  assert.equal(E.normalizarDecimal('2,5', 3), '2.5');
  assert.equal(E.normalizarDecimal('2.500', 3), '2.500'); // quantidade: ponto segue decimal (2,5)
  assert.equal(E.normalizarDecimal('1.5,00', 2), '1.5.00'); // fora do formato: a validação recusa
  assert.equal(E.campoReais('10400.00'), '10.400,00');
  assert.equal(E.campoReais('52'), '52,00');
  assert.equal(E.campoReais(null), '');
});

test('formulário do item aceita vírgula e os totais saem com ponto de milhar', () => {
  const v = ui.validarItemCampos({ identificador: '1', descricao: 'x', quantidade: '200', valorUnitario: '52,00' });
  assert.equal(v.ok, true);
  assert.equal(v.dados.valorUnitario, '52.00');
  assert.equal(ui.reais(ui.totalCentavos(v.dados.quantidade, v.dados.valorUnitario)), 'R$ 10.400,00');
  assert.equal(ui.reais(123456789n), 'R$ 1.234.567,89');
  assert.equal(ui.reais(5n), 'R$ 0,05');
  assert.equal(ui.linhaQuantidade({ quantidade: '200.000', valorUnitario: '1500.00' }, 30000000n), 'Quantidade: 200 · Unitário: R$ 1.500,00 · Total: R$ 300.000,00');
  assert.equal(ui.validarItemCampos({ identificador: '1', descricao: 'x', quantidade: '2', valorUnitario: '1.5,00' }).ok, false);
  assert.equal(ui.validarItemCampos({ identificador: '1', descricao: 'x', quantidade: '2,5', valorUnitario: '0,00' }).ok, false);
});

test('"Só quero os itens: 3, 7, 10-15" vira o conjunto certo; pedaço estranho é apontado', () => {
  const f = E.lerFaixas('3, 7, 10-15');
  assert.equal(f.ok, true);
  assert.deepEqual([...f.numeros], ['3', '7', '10', '11', '12', '13', '14', '15']);
  assert.deepEqual([...E.lerFaixas('5 a 7; 2 até 3 ; 9–8').numeros], ['5', '6', '7', '2', '3', '8', '9']);
  const ruim = E.lerFaixas('3, abc, 0-2');
  assert.equal(ruim.ok, false);
  assert.deepEqual(ruim.erros, ['abc', '0-2']);
  assert.equal(E.lerFaixas('').ok, false);
  assert.equal(E.lerFaixas('1-20000').ok, false);
  assert.equal(E.chaveNumero('007'), '7');
});

const itens = [
  { id: 'a', identificador: '1', descricao: 'Papel A4 sulfite', tipoBeneficio: 1, participar: false },
  { id: 'b', identificador: '2', descricao: 'Caneta azul', tipoBeneficio: 4, participar: true },
  { id: 'c', identificador: '3', descricao: 'Grampeador', tipoBeneficio: 3, participar: false },
  { id: 'd', identificador: '12', descricao: 'Lápis', tipoBeneficio: null, participar: false, marca: 'Faber' },
];
test('filtros: exclusivo, cota, ampla, selecionados, busca por número exato e por texto sem acento', () => {
  const ids = (o) => E.filtrarItens(itens, o).map((i) => i.id);
  assert.deepEqual(ids({ filtro: 'exclusivo' }), ['a']);
  assert.deepEqual(ids({ filtro: 'cota' }), ['c']);
  assert.deepEqual(ids({ filtro: 'ampla' }), ['b', 'd']);
  assert.deepEqual(ids({ filtro: 'selecionados' }), ['b']);
  assert.deepEqual(ids({ filtro: 'nao_selecionados' }), ['a', 'c', 'd']);
  assert.deepEqual(ids({ busca: '1' }), ['a']); // número: item 1, não o 12
  assert.deepEqual(E.filtrarItens([{ id: 'x', identificador: '7', descricao: 'Copo 12 cm' }, { id: 'y', identificador: '12', descricao: 'Copo' }], { busca: '12' }).map((i) => i.id), ['y', 'x']);
  assert.deepEqual(ids({ busca: 'lapis' }), ['d']);
  assert.deepEqual(ids({ busca: 'faber', filtro: 'ampla' }), ['d']);
});

test('ME/EPP: exclusivo e cota reservada pedem confirmação só para quem não é ME/EPP', () => {
  assert.equal(E.bloqueadosParaPorte(itens, 'me').length, 0);
  assert.equal(E.bloqueadosParaPorte(itens, 'epp').length, 0);
  assert.equal(E.bloqueadosParaPorte(itens, 'mei').length, 0);
  assert.deepEqual(E.bloqueadosParaPorte(itens, 'demais').map((i) => i.id), ['a', 'c']);
  assert.deepEqual(E.bloqueadosParaPorte(itens, null).map((i) => i.id), ['a', 'c']);
  assert.match(E.textoConfirmacao(2, 'demais'), /não é ME\/EPP.*2 itens são exclusivos/);
  assert.match(E.textoConfirmacao(1, null), /porte da empresa não está informado/);
  assert.equal(E.textoPorte('epp').situacao, 'ok');
  assert.equal(E.textoPorte('demais').situacao, 'atrasado');
  assert.equal(E.textoPorte(null).situacao, 'atencao');
});
