const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./mercado-comprasgov.js');
const C = require('./catalogo-produtos.js');

const item = (c, extra = {}) => ({ valorUnitarioCentavos: c, codigoPdm: 99, produtoCatalogo: 'Caneta esferográfica', unidade: 'UN', marca: 'BIC', ...extra });

test('resumoPrecos: mínimo, mediana, média e máximo em centavos inteiros', () => {
  assert.deepEqual(M.resumoPrecos([item(50), item(49), item(48)]), { quantidade: 3, minimo: 48, mediana: 49, media: 49, maximo: 50 });
  // Par: mediana = média dos dois do meio, meio centavo para cima; média 50,5 -> 51.
  assert.deepEqual(M.resumoPrecos([item(49), item(50), item(51), item(52)]), { quantidade: 4, minimo: 49, mediana: 51, media: 51, maximo: 52 });
  assert.equal(M.resumoPrecos([item(1), item(2)]).mediana, 2);
  // Valor fora do contrato (float, zero, nulo, texto) não entra na conta.
  assert.deepEqual(M.resumoPrecos([item(0.5), item(0), item(null), item('10'), item(100)]), { quantidade: 1, minimo: 100, mediana: 100, media: 100, maximo: 100 });
  assert.deepEqual(M.resumoPrecos([]), { quantidade: 0, minimo: null, mediana: null, media: null, maximo: null });
  // Soma grande sem perder centavo (BigInt).
  const grande = Number.MAX_SAFE_INTEGER - 1;
  assert.equal(M.resumoPrecos([item(grande), item(grande)]).media, grande);
});

test('filtrar e marcasDe: unidade separa preço e marca agrupa sem diferença de maiúscula', () => {
  const lista = [item(50, { marca: 'bic' }), item(49), item(49), item(4300, { unidade: 'CX', marca: 'sm' }), item(30, { codigoPdm: 1, marca: 'Faber' })];
  assert.equal(M.filtrar(lista, { produto: '99', unidade: 'UN' }).length, 3);
  assert.deepEqual(M.marcasDe(M.filtrar(lista, { produto: '99', unidade: 'UN' })), [{ chave: 'bic', nome: 'BIC', quantidade: 3 }]);
  assert.equal(M.filtrar(lista, { marca: 'bic' }).length, 3);
  assert.equal(M.resumoPrecos(M.filtrar(lista, { produto: '99', unidade: 'CX' })).mediana, 4300);
});

test('termoDoItem: nome curto da descrição do edital', () => {
  assert.equal(M.termoDoItem('CANETA ESFEROGRÁFICA, MATERIAL: PLÁSTICO, COR AZUL'), 'CANETA ESFEROGRÁFICA');
  assert.equal(M.termoDoItem('Papel A4 75g/m² - caixa com 10 resmas'), 'Papel A4 75g/m²');
  assert.equal(M.termoDoItem('Detergente líquido neutro 500 ml frasco plástico biodegradável'), 'Detergente líquido neutro 500 ml frasco');
  assert.equal(M.termoDoItem(null), '');
  assert.equal(M.termoDoItem('(ID126662) FONTE, Potencia: 400W'), 'FONTE');
  assert.equal(M.termoDoItem(' [123](ID9) Caneta azul; ponta fina'), 'Caneta azul');
  assert.ok(M.termoDoItem('x'.repeat(300)).length <= 100);
});

test('brl formata centavos sem float', () => {
  assert.equal(M.brl(123456789), 'R$ 1.234.567,89');
  assert.equal(M.brl(5), 'R$ 0,05');
  assert.equal(M.brl(null), '—');
});

test('produtoParaCatalogo: mediana vira preço de referência com fonte e data; custo fica de fora', () => {
  const r = M.resumoPrecos([item(49), item(50), item(51)]);
  const p = M.produtoParaCatalogo({ produtoCatalogo: 'Caneta esferográfica', descricaoItem: 'CANETA ESFEROGRÁFICA, AZUL', marca: 'BIC', modelo: 'Cristal', fabricante: null, unidade: 'UN', unidadeNome: 'UNIDADE' }, { ...r, marca: 'BIC' }, '2026-11-18');
  assert.equal(p.nome, 'Caneta esferográfica');
  assert.equal(p.preco_referencia, '0.50');
  assert.equal(p.referencia_em, '2026-11-18');
  assert.match(p.referencia_fonte, /mediana de 3 compra\(s\) por UN, marca BIC/);
  assert.equal('custo_unitario' in p, false);
  assert.equal(p.unidade, 'UNIDADE');
  const semPreco = M.produtoParaCatalogo({ produtoCatalogo: 'X', marca: 'Y' }, M.resumoPrecos([]));
  assert.equal(semPreco.preco_referencia, null);
  assert.equal(semPreco.referencia_fonte, null);
});

test('validarReferencia: só aceita preço positivo com fonte curta e data ISO', () => {
  const ok = { preco_referencia: '0.50', referencia_fonte: 'Compras.gov (Pesquisa de Preços): mediana de 3 compra(s)', referencia_em: '2026-11-18' };
  assert.deepEqual(C.validarReferencia(ok), ok);
  assert.equal(C.validarReferencia({ ...ok, preco_referencia: '0' }), null);
  assert.equal(C.validarReferencia({ ...ok, preco_referencia: '1.234' }), null);
  assert.equal(C.validarReferencia({ ...ok, referencia_fonte: '' }), null);
  assert.equal(C.validarReferencia({ ...ok, referencia_fonte: 'x'.repeat(301) }), null);
  assert.equal(C.validarReferencia({ ...ok, referencia_fonte: 'a\nb' }), null);
  assert.equal(C.validarReferencia({ ...ok, referencia_em: '18/11/2026' }), null);
  assert.equal(C.validarReferencia({ preco_referencia: null }), null);
});

test('marcasDe: normaliza caixa, acento e espaço; compra sem marca vai para "Marca não informada" no fim', () => {
  const lista = [item(81, { marca: 'bic' }), item(80, { marca: 'Bic ' }), item(82), item(90, { marca: null }), item(85, { marca: 'Ypê' }), item(86, { marca: 'YPE' }), item(70, { marca: 'REPORT / SUZANO' }), item(71, { marca: 'Report/Suzano' })];
  const m = M.marcasDe(lista);
  assert.deepEqual(m.map((x) => [x.nome, x.quantidade]), [['BIC', 3], ['REPORT / SUZANO', 2], ['YPÊ', 2], ['Marca não informada', 1]]);
  assert.equal(m.at(-1).chave, M.SEM_MARCA);
  assert.equal(M.filtrar(lista, { marca: M.SEM_MARCA }).length, 1);
});

test('foraDaCurva: mais de 3× ou menos de 1/3 da mediana, em BigInt', () => {
  assert.equal(M.foraDaCurva(4500, 81), 'acima');
  assert.equal(M.foraDaCurva(243, 81), null); // exatamente 3× ainda é da curva
  assert.equal(M.foraDaCurva(244, 81), 'acima');
  assert.equal(M.foraDaCurva(27, 81), null);
  assert.equal(M.foraDaCurva(26, 81), 'abaixo');
  assert.equal(M.foraDaCurva(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1), null);
  assert.equal(M.foraDaCurva(81, null), null);
  assert.equal(M.foraDaCurva(0.5, 81), null);
});

test('porEspecificacao: só as que conferem entram nas contas; nenhuma confere = valem todas', () => {
  const a4 = item(2190, { especificacao: true }), couche = item(23500, { especificacao: false });
  assert.deepEqual(M.porEspecificacao([a4, couche]), { base: [a4], diferente: [couche] });
  assert.deepEqual(M.porEspecificacao([couche]), { base: [couche], diferente: [] });
  const semAtributo = item(10, { especificacao: null });
  assert.deepEqual(M.porEspecificacao([semAtributo]), { base: [semAtributo], diferente: [] });
});

test('resumoMarcas: vitórias, mediana na unidade dominante, faixa, últimos órgãos e data; mediana resiste ao outlier', () => {
  const lista = [
    item(81, { dataResultado: '2026-10-01', orgao: 'UFBA', uf: 'BA' }), item(80, { dataResultado: '2026-11-01', orgao: 'TRE', uf: 'SE' }),
    item(4500, { dataResultado: '2026-09-01', orgao: 'PM', uf: 'AM' }), item(900, { unidade: 'CX', dataResultado: '2026-11-10' }),
    item(85, { marca: 'Faber', dataResultado: '2026-08-01' }),
  ];
  const [bic, faber] = M.resumoMarcas(lista);
  assert.equal(bic.nome, 'BIC');
  assert.equal(bic.quantidade, 4);
  assert.equal(bic.unidade, 'UN');
  assert.deepEqual([bic.resumo.quantidade, bic.resumo.mediana, bic.resumo.minimo, bic.resumo.maximo], [3, 81, 80, 4500]);
  assert.ok(bic.resumo.media > 1000); // a média é puxada pelo R$ 45; a mediana não
  assert.equal(bic.ultimaData, '2026-11-10');
  assert.deepEqual(bic.locais, ['TRE/SE', 'UFBA/BA']);
  assert.equal(bic.representante.valorUnitarioCentavos, 80);
  assert.equal(faber.quantidade, 1);
  // Linha da marca no catálogo: mediana da marca vira a referência.
  const p = M.produtoParaCatalogo({ ...bic.representante, marca: bic.nome, modelo: null }, { ...bic.resumo, marca: bic.nome }, '2026-11-18');
  assert.equal(p.preco_referencia, '0.81');
  assert.match(p.referencia_fonte, /mediana de 3 compra\(s\) por UN, marca BIC/);
});

test('mensagemBusca: zero compras com consulta que falhou pede para tentar de novo, não "nenhuma compra"', () => {
  assert.match(M.mensagemBusca(0, 0, 1), /não respondeu agora/);
  assert.match(M.mensagemBusca(0, 0, 0), /^Nenhuma compra para este termo/);
  assert.equal(M.mensagemBusca(5, 3, 0), '5 compra(s) encontradas, 3 com marca declarada.');
  assert.match(M.mensagemBusca(5, 3, 2), /resultado parcial/);
  // Fonte fora do ar: o servidor devolveu o guardado e a tela diz de quando é.
  assert.match(M.mensagemBusca(5, 3, 0, '2026-11-20T15:00:00Z'), /não respondeu agora: mostrando dados guardados de 20\/11\./);
  assert.equal(M.mensagemBusca(5, 3, 0, 'data-ruim'), '5 compra(s) encontradas, 3 com marca declarada.');
  // Pré-consulta da madrugada: resposta na hora, com a data e a hora em que o robô consultou.
  assert.match(M.mensagemBusca(5, 3, 0, '2026-11-24T07:17:00-03:00', 'pre-consulta'), /3 com marca declarada\. Atualizado em 24\/11 às \d{2}:\d{2}\.$/);
});

test('marcaModelo: número depois da 1ª palavra vira modelo; marca de várias palavras e "/" ficam inteiras', () => {
  assert.deepEqual([M.marcaModelo(item(1, { marca: 'VAIO FE16' }))].map((i) => [i.marca, i.modelo]), [['VAIO', 'FE16']]);
  assert.equal(M.marcaModelo(item(1, { marca: 'THINKPAD P16V GEN2' })).modelo, 'P16V GEN2');
  assert.deepEqual([M.marcaModelo(item(1, { marca: 'Melitta do Brasil' }))].map((i) => [i.marca, i.modelo]), [['Melitta do Brasil', undefined]]);
  assert.equal(M.marcaModelo(item(1, { marca: 'REPORT / SUZANO 75' })).marca, 'REPORT / SUZANO 75');
  assert.equal(M.marcaModelo(item(1, { marca: 'BIC', modelo: 'Cristal' })).modelo, 'Cristal'); // rotulado pela fonte prevalece
  assert.equal(M.marcaModelo(item(1, { marca: null })).marca, null);
});

test('filtrarCompras: período em meses a partir de hoje, esfera e faixa de quantidade', () => {
  const lista = [item(1, { dataResultado: '2026-11-01', esfera: 'F', quantidade: 5 }), item(2, { dataResultado: '2025-12-01', esfera: 'M', quantidade: 50 }), item(3, { dataResultado: '2024-06-01', esfera: 'E', quantidade: 500 })];
  const hoje = '2026-11-19';
  assert.equal(M.filtrarCompras(lista, {}, hoje).length, 3);
  assert.deepEqual(M.filtrarCompras(lista, { meses: '12' }, hoje).map((i) => i.valorUnitarioCentavos), [1, 2]);
  assert.deepEqual(M.filtrarCompras(lista, { meses: '24' }, hoje).map((i) => i.valorUnitarioCentavos), [1, 2]);
  assert.equal(M.filtrarCompras(lista, { meses: '12' }, '2026-12-02').length, 1); // 01/12/2025 saiu da janela
  assert.deepEqual(M.filtrarCompras(lista, { esfera: 'M' }, hoje).map((i) => i.valorUnitarioCentavos), [2]);
  assert.deepEqual(M.filtrarCompras(lista, { qtdMin: '10', qtdMax: '100' }, hoje).map((i) => i.valorUnitarioCentavos), [2]);
  assert.equal(M.filtrarCompras(lista, { qtdMin: 'abc' }, hoje).length, 3); // valor inválido não filtra
});

test('resumoModelos e resumoFornecedores: agrupam sem diferença de caixa, por CNPJ, com último preço', () => {
  const lista = [
    item(500000, { marca: 'Dell', modelo: 'Latitude 3440', documentoFornecedor: '11222333000181', fornecedor: 'ALFA LTDA', dataResultado: '2026-10-01' }),
    item(520000, { marca: 'DELL', modelo: 'latitude 3440', documentoFornecedor: '11222333000181', fornecedor: 'Alfa Ltda.', dataResultado: '2026-11-01' }),
    item(400000, { marca: 'Lenovo', modelo: null, documentoFornecedor: '99888777000100', fornecedor: 'BETA', dataResultado: '2026-09-01' }),
  ];
  const [mod] = M.resumoModelos(lista);
  assert.equal(M.resumoModelos(lista).length, 1); // Lenovo sem modelo não entra
  assert.deepEqual([mod.quantidade, mod.resumo.mediana, mod.ultimo.valorUnitarioCentavos], [2, 510000, 520000]);
  const [alfa, beta] = M.resumoFornecedores(lista);
  assert.deepEqual([alfa.quantidade, alfa.marcas, beta.quantidade], [2, ['DELL'], 1]);
});

test('totalCentavos e linhasPlanilha: total sem float, valores em reais e célula com fórmula neutralizada', () => {
  assert.equal(M.totalCentavos(item(397280, { quantidade: 5 })), 1986400);
  assert.equal(M.totalCentavos(item(1050, { quantidade: 2.5 })), 2625);
  assert.equal(M.totalCentavos(item(100, { quantidade: null })), null);
  assert.equal(M.totalCentavos(item(Number.MAX_SAFE_INTEGER, { quantidade: 3 })), null);
  const [cab, linha] = M.linhasPlanilha([item(397280, { quantidade: 5, dataResultado: '2026-11-17', esfera: 'F', fornecedor: '=HYPERLINK("x")', documentoFornecedor: '62958500000198' })]);
  assert.equal(cab.length, linha.length);
  assert.equal(linha[0], '17/11/2026');
  assert.equal(linha[4], 'Federal');
  assert.equal(linha[9], "'=HYPERLINK(\"x\")");
  assert.equal(linha[10], '62.958.500/0001-98');
  assert.deepEqual([linha[13], linha[14]], [3972.8, 19864]);
});

test("participação no mercado: % das compras e % do valor (unitário × quantidade, sem float)", () => {
  const c = (centavos, quantidade) => ({ valorUnitarioCentavos: centavos, quantidade });
  const base = [c(100, 10), c(100, 10), c(200, 30), c(null, 5)];
  assert.deepEqual(M.fatiaDoMercado(base.slice(0, 2), base), { compras: 50, valor: 25 });
  assert.deepEqual(M.fatiaDoMercado([base[2]], base), { compras: 25, valor: 75 });
  assert.deepEqual(M.fatiaDoMercado([base[3]], base), { compras: 25, valor: 0 }, "compra sem preço não soma valor");
  assert.deepEqual(M.fatiaDoMercado([], []), { compras: null, valor: null });
  assert.equal(M.fatiaDoMercado([c(1, 1)], [c(1, 1), c(1, 1), c(1, 1)]).compras, 33.3, "arredonda para 1 casa");
});
