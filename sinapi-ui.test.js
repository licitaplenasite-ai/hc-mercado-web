const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('./sinapi-ui.js');
const I = require('./itens-processo-ui.js');

test('filtroBusca: só dígitos é código; texto vira palavras sem acento e sem curinga do ILIKE', () => {
  assert.deepEqual(UI.filtroBusca(' 104658 '), { codigo: '104658' });
  assert.deepEqual(UI.filtroBusca('Alvenaria  de BLOCO cerâmico'), { palavras: ['alvenaria', 'de', 'bloco', 'ceramico'] });
  assert.deepEqual(UI.filtroBusca('areia%_*,(x)'), { palavras: ['areia'] });
  assert.ok(UI.filtroBusca('').erro);
  assert.ok(UI.filtroBusca('a % ,').erro);
  assert.equal(UI.filtroBusca('um dois tres quatro cinco seis sete').palavras.length, 6);
});

test('linhaHtml escapa texto vindo do banco', () => {
  const h = UI.linhaHtml({ codigo: '1', descricao: '<img src=x onerror=alert(1)>', unidade: 'M2', preco: '10.5', grupo: null, origem: 'CR' }, 0);
  assert.ok(!h.includes('<img'));
  assert.match(h, /R\$\s?10,50/);
  assert.match(h, /data-usar="0"/);
});

test('o que sinapi.html guarda é aceito pelo formulário do item (mesmo contrato)', () => {
  const l = { uf: 'AM', tipo: 'composicao', desonerado: false, codigo: '104658', preco: 228.76, referencia: '2026-10-01' };
  assert.deepEqual(I.precoSinapi(UI.guardado(l)), { preco: '228.76', rotulo: 'Preço SINAPI copiado: composição 104658 AM 10/2026, R$ 228,76.' });
  assert.equal(I.precoSinapi(UI.guardado({ ...l, preco: '7' })).preco, '7.00');
});

test('linhaPreco: pega o preço do regime escolhido e a UF/data-base do custo', () => {
  const item = { tipo: 'composicao', codigo: '104658', descricao: 'PISO', unidade: 'M2', grupo: 'Acessibilidade', origem: null, referencia: '2026-10-01',
    sinapi_custos: [{ uf: 'PB', preco_sd: '153.17', preco_cd: '150.40', referencia: '2026-10-01' }] };
  assert.equal(UI.linhaPreco(item, false).preco, '153.17');
  const cd = UI.linhaPreco(item, true);
  assert.deepEqual([cd.preco, cd.uf, cd.desonerado, cd.referencia], ['150.40', 'PB', true, '2026-10-01']);
  assert.match(UI.linhaHtml(cd, 3), /data-itens="3"/);
  assert.doesNotMatch(UI.linhaHtml({ ...cd, tipo: 'insumo' }, 3), /data-itens/);
});

test('analiticoHtml: custo parcial = coeficiente × preço; item sem preço na UF fica fora da soma e é avisado', () => {
  const itens = [
    { item_tipo: 'composicao', item_codigo: '88316', descricao: 'SERVENTE', unidade: 'H', coeficiente: '1.279' },
    { item_tipo: 'insumo', item_codigo: '34357', descricao: 'REJUNTE <b>', unidade: 'KG', coeficiente: '0.24' },
    { item_tipo: 'insumo', item_codigo: '88316', descricao: 'MESMO CÓDIGO, OUTRO TIPO', unidade: 'UN', coeficiente: '2' },
  ];
  const precos = [{ tipo: 'composicao', codigo: '88316', preco_sd: '20.00', preco_cd: '18.00' }, { tipo: 'insumo', codigo: '34357', preco_sd: '5.00', preco_cd: '5.00' }];
  const h = UI.analiticoHtml(itens, precos, false);
  assert.match(h, /R\$\s?25,58/); // 1,279 × 20 = 25,58
  assert.match(h, /Soma dos itens: <b>R\$\s?26,78<\/b>/); // 25,58 + 1,20
  assert.match(h, /1 item\(ns\) sem preço/);
  assert.ok(!h.includes('<b>REJUNTE'));
  assert.match(UI.analiticoHtml(itens, precos, true), /Soma dos itens: <b>R\$\s?24,22<\/b>/); // 23,02 + 1,20
  assert.match(UI.analiticoHtml([], [], false), /não publicou/);
});

test('centavos: arredonda produto para 2 casas', () => {
  assert.equal(UI.centavos(1.005), 1.01);
  assert.equal(UI.centavos(25.579999999), 25.58);
  assert.equal(UI.centavos(0.1 + 0.2), 0.3);
});

test('lista: não duplica, quantidade × preço em centavos, BDI por linha e total', () => {
  const base = { tipo: 'insumo', codigo: '1', descricao: 'A', unidade: 'KG', uf: 'AM', desonerado: false, referencia: '2026-10-01', preco: '10.05' };
  let l = UI.adicionarLista([], base);
  l = UI.adicionarLista(l, base);
  assert.equal(l.length, 1);
  l = UI.adicionarLista(l, { ...base, desonerado: true }); // outro regime = outra linha
  assert.equal(l.length, 2);
  l[0].qtd = 3.333;
  const r = UI.calcularLista(l, '10,5');
  assert.equal(r.linhas[0].total, 33.5); // 10,05 × 3,333 = 33,49665
  assert.equal(r.linhas[0].totalBdi, 37.02); // 33,50 × 1,105 = 37,0175
  assert.equal(r.semBdi, 43.55); // 33,50 + 10,05
  assert.equal(r.comBdi, 48.13); // 37,02 + 11,11 (10,05 × 1,105 = 11,10525)
  assert.equal(UI.calcularLista(l, '').comBdi, r.semBdi);
  assert.equal(UI.calcularLista(l, 'abc').bdi, 0);
});

test('qtdNum e bdiNum: vírgula decimal, rejeita zero, negativo e lixo', () => {
  assert.equal(UI.qtdNum('2,5'), 2.5);
  for (const v of ['0', '-1', 'x', '', null, '1e12']) assert.equal(UI.qtdNum(v), 0);
  assert.equal(UI.bdiNum('24,5'), 24.5);
  assert.equal(UI.bdiNum('5000'), 0);
});

test('lerLista ignora lixo do navegador', () => {
  assert.deepEqual(UI.lerLista('{quebrado'), []);
  assert.deepEqual(UI.lerLista('{"a":1}'), []);
  const ok = UI.lerLista(JSON.stringify([{ id: 'x', codigo: '1', preco: '5', qtd: 'abc' }, { id: 'y' }, null]));
  assert.deepEqual(ok.map((x) => [x.codigo, x.preco, x.qtd]), [['1', 5, 1]]);
});

test('CSV: BOM, ";" e vírgula decimal; descrição com ; e aspas é protegida; fórmula neutralizada', () => {
  const l = { codigo: '1', descricao: '=SOMA(A1); "x"', unidade: 'M2', tipo: 'composicao', uf: 'AM', desonerado: false, preco: '1234.5', referencia: '2026-10-01' };
  const c = UI.csvResultados([l]);
  assert.ok(c.startsWith('\uFEFFCódigo;Descrição;Unidade;Tipo;UF;Regime;Preço (R$);Data-base;Fonte\r\n'));
  assert.ok(c.includes('1;"\'=SOMA(A1); ""x""";M2;Composição;AM;Não desonerado;1234,50;10/2026;SINAPI/CAIXA'));
});

test('csvAnalitico: parcial, soma e aviso de item sem preço', () => {
  const itens = [{ item_tipo: 'insumo', item_codigo: '9', descricao: 'X', unidade: 'H', coeficiente: '1.279' }, { item_tipo: 'insumo', item_codigo: '8', descricao: 'Y', unidade: 'H', coeficiente: '2' }];
  const c = UI.csvAnalitico({ codigo: '5', descricao: 'COMP', uf: 'AM', desonerado: false, referencia: '2026-10-01' }, itens, [{ tipo: 'insumo', codigo: '9', preco_sd: '20', preco_cd: '1' }]);
  assert.match(c, /Insumo;9;X;H;1,279;20,00;25,58/);
  assert.match(c, /Insumo;8;Y;H;2;sem preço;\r\n/);
  assert.match(c, /Soma dos itens \(R\$\);25,58/);
  assert.match(c, /1 item\(ns\) sem preço/);
});

test('csvLista: totais sem e com BDI batem com calcularLista', () => {
  const l = UI.adicionarLista([], { tipo: 'insumo', codigo: '1', descricao: 'A', unidade: 'KG', uf: 'AM', desonerado: false, referencia: '2026-10-01', preco: 10 });
  l[0].qtd = 2;
  const c = UI.csvLista(l, '10');
  assert.match(c, /Total com BDI 10% \(R\$\)/);
  assert.match(c, /1;1;A;KG;Insumo;AM;Não desonerado;10\/2026;2;10,00;20,00;22,00;SINAPI\/CAIXA/);
  assert.match(c, /Total geral;20,00;22,00/);
});

test('centavos: meio-centavo sobe como no Excel, mesmo com ruído binário', () => {
  assert.equal(UI.centavos(13.5 * 2.55), 34.43); // 34,425 em decimal
  assert.equal(UI.centavos(1.255), 1.26);
  assert.equal(UI.centavos(0), 0);
});
