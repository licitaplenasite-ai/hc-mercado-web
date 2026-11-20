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
