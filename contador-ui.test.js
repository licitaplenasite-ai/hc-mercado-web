const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('./contador-ui.js');
const C = require('./contador-tributario.js');

const item = { id: 'i1', identificador: '3', descricao: 'Café torrado 500 g', quantidade: '5.000', custoUnitario: '200.00', precoReferencia: '320.0000' };

test('tela → conta: campos em texto viram BigInt; custo sai do cálculo das premissas sem o frete (que vai na planilha)', () => {
  const calc = { base: 20500n, freteUnidade: 500n };
  const m = U.entradaDaTela({ tipo: 'bem', regime: 'real', ano: '2027', frete: '25,00', garantia: '1', icms: '18', origemUf: 'am', destinoUf: 'AM', taxa: '1,00', dias: '60', vencedor: '300,00' },
    item, calc, { margem: '20.000', margemMinima: '8.000' });
  assert.equal(m.erro, undefined);
  const e = m.entrada;
  assert.equal(e.custoUnitarioCentavos, 20000n); assert.equal(e.quantidade, 5000n); assert.equal(e.custosItem.frete, 2500n);
  assert.equal(e.pctPreco.garantia, 1000n); assert.equal(e.aliquotas.icms, 18000n); assert.equal(e.origemUf, 'AM');
  assert.deepEqual(e.dinheiro, { taxaMensal: 1000n, dias: 60 }); assert.equal(e.margem, 20000n); assert.equal(e.margemMinima, 8000n);
  assert.equal(e.referencias.vencedor, 30000n);
  assert.equal(C.formarPreco(e).ok, true);
});

test('tela → conta: campo mal digitado vira mensagem, sem custo pede o custo', () => {
  assert.match(U.entradaDaTela({ frete: '1.500,00' }, item, null, null).erro, /Frete/);
  assert.match(U.entradaDaTela({ comissao: 'abc' }, item, null, null).erro, /Percentual/);
  assert.match(U.entradaDaTela({}, { ...item, custoUnitario: null }, null, null).erro, /custo unitário/);
  assert.equal(U.entradaDaTela({ tipo: 'bem' }, item, null, null).entrada.custoUnitarioCentavos, 20000n);
});

test('referências automáticas: vencedor pelo número ou pela descrição; mercado pela mediana do item', () => {
  const venc = { processoId: 'p', itens: [{ numero: 9, descricao: 'Café torrado 500 G', homologado: 17.5 }, { numero: 3, descricao: 'Outro', homologado: 18 }] };
  assert.equal(U.vencedorDoItem(item, venc), 1800n);
  assert.equal(U.vencedorDoItem({ ...item, identificador: 'x' }, venc), 1750n);
  assert.equal(U.vencedorDoItem(item, null), null);
  assert.equal(U.centavosDaReferencia('320.0000'), 32000n);
  assert.equal(U.centavosDaReferencia('1.2345'), 123n);
  assert.equal(U.centavosDaReferencia(null), null);
});

test('edital do PNCP: só o endereço oficial vira consulta do órgão', () => {
  assert.deepEqual(U.compraPncp('https://pncp.gov.br/app/editais/12345678000190/2026/15'), { cnpj: '12345678000190', ano: '2026', sequencial: '15' });
  for (const ruim of ['http://pncp.gov.br/app/editais/12345678000190/2026/15', 'https://pncp.gov.br.evil.com/app/editais/12345678000190/2026/15', '', null]) assert.equal(U.compraPncp(ruim), null);
});

test('resumo salvo no item: texto canônico, aviso fixo e só chaves conhecidas (as mesmas que o servidor aceita)', () => {
  const tabela = [{ codigo: '000001', descricao: 'Tributação integral', nomenclatura: 'NBS ou NCM', reducaoCbs: 0, reducaoIbsUf: 0, tipoAliquota: 'Padrão' }];
  const classe = C.classificacaoDe(tabela, '000001', 'bem');
  const r = C.formarPreco({ tipo: 'bem', regime: 'real', ano: 2027, origemUf: 'SP', destinoUf: 'AM', aliquotas: { icmsDestino: 20000n }, custoUnitarioCentavos: 20000n, quantidade: 5000n,
    custosItem: { frete: 10000n }, dinheiro: { taxaMensal: 1000n, dias: 60 }, classe, referencias: { vencedor: 30000n } });
  const s = U.resumoParaSalvar(r, { tipo: 'bem', codigo: '84713012', classe }, { estado: 'CALCULO_SIMULADO', versaoDb: 'V0073' });
  assert.equal(s.precoMinimo, '305.85'); assert.equal(s.precoFinal, '305.85'); assert.equal(s.custoUnidade, '224.40'); assert.equal(s.cbs, '25.13');
  assert.equal(s.custos.dinheiro, '22.00'); assert.equal(s.aviso, 'Estimativa para formar preço. Confirme com o seu contador.');
  assert.match(s.valeAPena[0], /^Não vale/);
  const permitidas = ['versao', 'salvoEm', 'ano', 'regime', 'tipo', 'codigo', 'cClassTrib', 'classificacao', 'baseLegal', 'fonteOficial', 'custoUnidade', 'precoMinimo', 'precoAlvo', 'precoFinal', 'cbs', 'ibs', 'lucroUnidade', 'margem', 'tributos', 'custos', 'valeAPena', 'aviso'];
  assert.deepEqual(Object.keys(s).filter((k) => !permitidas.includes(k)), []);
  assert.ok(JSON.stringify(s).length < 8000);
});
