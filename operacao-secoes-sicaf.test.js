// Quadro "Regularidade": nomes antigos e variações caem na seção certa (sem mudar o que está gravado).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { secaoDoTipo, mesmoTipo } = require('./operacao-secoes-sicaf.js');

test('mesmoTipo: nome exato ou apelido contam; outro tipo não', () => {
  assert.equal(mesmoTipo('FGTS (CRF)', 'FGTS'), true);
  assert.equal(mesmoTipo('CND Federal', 'Certidão Federal'), true);
  assert.equal(mesmoTipo('Contrato social', 'Contrato social'), true);
  assert.equal(mesmoTipo('Contrato Social', 'Contrato social'), true);
  assert.equal(mesmoTipo('CND Estadual', 'Certidão Federal'), false);
  assert.equal(mesmoTipo('Contrato social', 'FGTS'), false);
  assert.equal(mesmoTipo(null, null), false);
  assert.equal(mesmoTipo('Atestado', null), false);
});

test('tipos atuais do formulário caem na própria seção', () => {
  for (const t of ['SICAF', 'Certidão Federal', 'FGTS', 'CNDT', 'Certidão Estadual', 'Certidão Municipal', 'Certidão de falência', 'Balanço patrimonial']) assert.equal(secaoDoTipo(t), t);
});

test('nomes antigos e variações são reconhecidos', () => {
  const casos = {
    'FGTS (CRF)': 'FGTS', 'CRF - Caixa': 'FGTS', 'Certificado de Regularidade do FGTS': 'FGTS',
    'Certidão Trabalhista (CNDT)': 'CNDT', 'Certidão Negativa de Débitos Trabalhistas': 'CNDT',
    'CND Federal': 'Certidão Federal', 'CND': 'Certidão Federal', 'Certidão conjunta Receita/PGFN': 'Certidão Federal', 'Dívida Ativa da União': 'Certidão Federal',
    'CND Estadual': 'Certidão Estadual', 'Certidão SEFAZ/AM': 'Certidão Estadual', 'Dívida ativa estadual': 'Certidão Estadual',
    'CND Municipal': 'Certidão Municipal', 'Certidão da Prefeitura': 'Certidão Municipal', 'ISS': 'Certidão Municipal',
    'Certidão Negativa de Falência': 'Certidão de falência', 'Falência e recuperação judicial': 'Certidão de falência',
    'Balanço': 'Balanço patrimonial', 'Demonstrações contábeis 2025': 'Balanço patrimonial',
    'Comprovante SICAF': 'SICAF', '  fgts  ': 'FGTS',
  };
  for (const [tipo, secao] of Object.entries(casos)) assert.equal(secaoDoTipo(tipo), secao, tipo);
});

test('documentos fora das seções e vazios ficam de fora', () => {
  for (const t of ['Contrato social', 'Atestado de capacidade técnica', 'Alvará / licença', '', null, undefined]) assert.equal(secaoDoTipo(t), null, String(t));
});
