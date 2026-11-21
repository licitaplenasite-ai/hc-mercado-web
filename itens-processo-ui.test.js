const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('./itens-processo-ui');

test('editar item: valor ofertado abaixo do preço mínimo gravado é recusado antes de enviar', () => {
  const item = { valorUnitarioMinimo: '36.15' };
  assert.equal(I.abaixoDoMinimo(item, '35.90'), 'O valor ofertado R$ 35,90 está abaixo do seu preço mínimo R$ 36,15. Ajuste o valor ou o mínimo.');
  assert.equal(I.abaixoDoMinimo(item, '36.15'), null);
  assert.equal(I.abaixoDoMinimo({ valorUnitarioMinimo: null }, '1.00'), null);
  assert.equal(I.abaixoDoMinimo(undefined, '1.00'), null);
  assert.equal(I.abaixoDoMinimo({ valorUnitarioMinimo: '1234.50' }, '999.99'), 'O valor ofertado R$ 999,99 está abaixo do seu preço mínimo R$ 1.234,50. Ajuste o valor ou o mínimo.');
});

test('CBS/IBS da Reforma: desligado não muda nada; ligado mostra valores sobre o preço-alvo', () => {
  assert.equal(I.linhaReforma(100000n, { ligado: false, ano: 2027 }), '');
  assert.equal(I.linhaReforma(100000n, undefined), '');
  const l = I.linhaReforma(100000n, { ligado: true, ano: 2027, regime: 'real', reducao: 0 });
  assert.match(l, /CBS R\$ 112,00 \(11,2%\) \+ IBS R\$ 1,00 \(0,1%\) = R\$ 113,00/);
  assert.match(l, /provisórias até o Senado definir/);
  assert.match(I.linhaReforma(100000n, { ligado: true, ano: 2026, regime: 'presumido', reducao: 60 }), /redução de 60%.*CBS R\$ 3,60/);
  assert.match(I.linhaReforma(100000n, { ligado: true, ano: 2027, regime: 'simples', reducao: 0 }), /DAS/);
  assert.match(I.linhaReforma(undefined, { ligado: true, ano: 2027, regime: 'real', reducao: 0 }), /informe custo e margem/);
});

test('preço vindo da busca SINAPI: só valor canônico de 2 casas e código numérico viram botão', () => {
  const ok = I.precoSinapi(JSON.stringify({ codigo: '104658', preco: '269.08', uf: 'AM', referencia: '2026-10-01', tipo: 'composicao', desonerado: false }));
  assert.deepEqual(ok, { preco: '269.08', rotulo: 'Preço SINAPI copiado: composição 104658 AM 10/2026, R$ 269,08.' });
  assert.equal(I.precoSinapi(JSON.stringify({ codigo: '412', preco: '1.02', tipo: 'insumo', desonerado: true })).rotulo, 'Preço SINAPI copiado: insumo 412 desonerado, R$ 1,02.');
  for (const ruim of [null, '', '{', '[]', JSON.stringify({ codigo: '1', preco: '1,02' }), JSON.stringify({ codigo: '1', preco: '0.00' }), JSON.stringify({ codigo: '<b>', preco: '1.00' }), JSON.stringify({ codigo: '1', preco: 1.5 })]) {
    assert.equal(I.precoSinapi(ruim), null, String(ruim));
  }
});

test('cenários de margem: 10/15/30% e margem própria, com tributos e frete da regra do preço-alvo', () => {
  const calc = I.calcularPrecos([{ id: 'a', custoUnitario: '100.00', quantidade: '10.000' }], { tributos: '10.000', garantia: '0', margem: '20', margemMinima: '5' }).get('a');
  const c = I.cenariosMargem(calc, '10.000', '12,5');
  assert.deepEqual(c.map((k) => [k.margem, k.preco, k.lucroUnidade, k.lucroTotal, k.propria]), [
    ['10%', 'R$ 125,00', 'R$ 12,50', 'R$ 125,00', false],
    ['15%', 'R$ 133,34', 'R$ 20,01', 'R$ 200,06', false],
    ['30%', 'R$ 166,67', 'R$ 50,00', 'R$ 500,03', false],
    ['12,5%', 'R$ 129,04', 'R$ 16,14', 'R$ 161,36', true],
  ]);
  assert.equal(c[1].precoCentavos, 13334n);
  // Frete rateado entra na base: 2 unidades, frete R$ 10,00 → +R$ 5,00 por unidade.
  const f = I.calcularPrecos([{ id: 'b', custoUnitario: '95.00', quantidade: '2.000' }], { tributos: '0', garantia: '0', frete: '10.00', margem: '10', margemMinima: '0' }).get('b');
  assert.equal(I.cenariosMargem(f, '2.000')[0].preco, 'R$ 111,12');
});

test('cenários de margem: sem custo, margem própria inválida e soma de percentuais ≥ 100%', () => {
  assert.deepEqual(I.cenariosMargem({ semCusto: true }, '1.000'), []);
  assert.deepEqual(I.cenariosMargem(undefined, '1.000'), []);
  const calc = I.calcularPrecos([{ id: 'a', custoUnitario: '10.00', quantidade: '1.000' }], { tributos: '75', garantia: '0', margem: '1', margemMinima: '1' }).get('a');
  const c = I.cenariosMargem(calc, null, 'abc');
  assert.equal(c[0].lucroTotal, null); // sem quantidade válida, sem lucro total
  assert.match(c[2].erro, /menor que 100%/);
  assert.match(c[3].erro, /Margem própria/);
});

test('simulador de lance: margem arredonda como o lucro (caso do e2e: custo 30, tributos 8% + garantia 1%, lance 33,50)', () => {
  const calc = I.calcularPrecos([{ id: 'a', custoUnitario: '30.00', quantidade: '27.000' }], { tributos: '8', garantia: '1', margem: '20', margemMinima: '8' }).get('a');
  const r = I.simularLance('33,50', calc, '27.000');
  // lucro = 33,50 − 9% de 33,50 − 30 = 0,485 → R$ 0,49; margem = 0,485 ÷ 33,50 = 1,4477% → 1,45%
  assert.equal(r.lucroUnidade, 'R$ 0,49');
  assert.equal(r.lucroTotal, 'R$ 13,10');
  assert.equal(r.margem, '1,45%');
});
