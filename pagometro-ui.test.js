const test = require('node:test');
const assert = require('node:assert/strict');
const { enteDoEdital, linhas } = require('./pagometro-ui.js');

const base = { municipios: [{ ibge: '1302603', municipio: 'Manaus', uf: 'AM' }, { ibge: '3550308', municipio: 'São Paulo', uf: 'SP' }, { ibge: '9999901', municipio: 'Bom Jesus', uf: 'PI' }, { ibge: '9999902', municipio: 'Bom Jesus', uf: 'PI' }] };

test('município pela base CAPAG (nome sem acento, UF) ou pelo código IBGE do PNCP', () => {
  assert.equal(enteDoEdital({ esferaId: 'M', municipio: 'Sao Paulo', uf: 'sp' }, base).id, '3550308');
  assert.equal(enteDoEdital({ esferaId: 'M', municipio: 'x', uf: 'AM', codigoMunicipioIbge: '1302603' }, base).id, '1302603');
  assert.equal(enteDoEdital({ orgao: 'Prefeitura Municipal de Manaus', municipio: 'Manaus', uf: 'AM' }, base).id, '1302603');
});

test('estado e DF pelo código da UF; federal e ambíguo ficam de fora com motivo', () => {
  assert.equal(enteDoEdital({ esferaId: 'E', uf: 'RJ' }).id, '33');
  assert.equal(enteDoEdital({ esferaId: 'D', uf: 'DF' }).id, '53');
  assert.match(enteDoEdital({ esferaId: 'F', uf: 'DF' }).motivo, /federal/);
  assert.match(enteDoEdital({ esferaId: 'M', municipio: 'Bom Jesus', uf: 'PI' }, base).motivo, /inequívoca/);
  assert.match(enteDoEdital({ esferaId: 'M', municipio: 'Manaus', uf: 'AM' }, null).motivo, /inequívoca/);
  assert.match(enteDoEdital({ orgao: 'Universidade X', uf: 'AM' }).motivo, /municipal ou estadual/);
  assert.match(enteDoEdital({ esferaId: 'E', uf: 'XX' }).motivo, /Estado/);
});

test('frases do painel por situação', () => {
  const [pago, cancelado, antigo] = linhas({ semaforo: 'amarelo', exercicio: 2025, indicadores: { devido: 1000, pago: 800, taxaPago: 0.8, taxaCancelado: 0.02, taxaAntigo: 0.3 } });
  assert.match(pago, /^Pagou 80% .* em 2025 \(R\$\s?800 de R\$\s?1\.000\)\.$/);
  assert.match(cancelado, /^Cancelou 2%/);
  assert.match(antigo, /^30% .* antes de 2024\.$/);
  assert.match(linhas({ semaforo: 'verde', exercicio: 2025, indicadores: { devido: 0 } })[0], /não ficaram contas/);
  assert.match(linhas({ semaforo: 'sem_dados', indicadores: {} })[0], /não prova de atraso/);
});

const { linhaPrazo } = require('./pagometro-ui.js');

test('chave do prazo: federal pela UASG, município pelo IBGE, estado sem chave', () => {
  assert.equal(enteDoEdital({ esferaId: 'F', uf: 'DF', codigoUnidade: '160001' }).prazo, 'F:160001');
  assert.equal(enteDoEdital({ esferaId: 'F', uf: 'DF', codigoUnidade: '1600' }).prazo, null);
  assert.equal(enteDoEdital({ esferaId: 'M', municipio: 'Manaus', uf: 'AM' }, base).prazo, 'M:1302603');
  assert.equal(enteDoEdital({ esferaId: 'E', uf: 'SP' }).prazo, undefined);
});

test('frase do prazo: número, amostra pequena, calculando, falha e sem fonte (nunca inventa)', () => {
  const pronto = { situacao: 'pronto', coletado_em: '2026-11-20T10:00:00Z', dias_24m: 31, amostra_24m: 40, dias_36m: 29, amostra_36m: 60 };
  assert.match(linhaPrazo(pronto), /em 24 meses, 31 dias \(40 pagamentos\); em 36 meses, 29 dias \(60 pagamentos\)\.$/);
  assert.match(linhaPrazo({ ...pronto, dias_24m: null, amostra_24m: 4 }), /amostra pequena \(4 pagamentos\), sem média/);
  assert.match(linhaPrazo({ ...pronto, situacao: 'pendente' }), /Atualizando\.$/);
  assert.match(linhaPrazo({ situacao: 'pendente', amostra_24m: 0, amostra_36m: 0 }), /calculando/);
  assert.match(linhaPrazo({ situacao: 'falhou', coletado_em: null }), /não respondeu/);
  assert.match(linhaPrazo({ situacao: 'sem_fonte' }), /sem dado público/);
  assert.match(linhaPrazo(null), /sem dado público/);
  assert.match(linhaPrazo({ situacao: 'fila_cheia' }), /fila/);
});
