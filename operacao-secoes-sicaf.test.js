// Quadro "Regularidade": nomes antigos e variações caem na seção certa (sem mudar o que está gravado).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { secaoDoTipo } = require('./operacao-secoes-sicaf.js');

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
