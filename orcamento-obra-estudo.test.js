'use strict';
// "O que costuma acontecer": recorte do mais específico ao mais geral e a frase da tela.
const test = require('node:test');
const assert = require('node:assert');
const E = require('./orcamento-obra-estudo.js');

test('recortesCandidatos vai de UF+tipo+faixa até o Brasil, sem repetir', () => {
  assert.deepEqual(E.recortesCandidatos('AM', 'reforma', '1a5mi'), ['uf:AM|reforma|1a5mi', 'uf:AM|reforma|*', 'uf:AM|*|*', 'regiao:N|reforma|*', 'regiao:N|*|*', 'BR|reforma|1a5mi', 'BR|reforma|*', 'BR|*|*']);
  assert.deepEqual(E.recortesCandidatos(null, null, null), ['BR|*|*']);
});

const est = {
  'uf:AM|reforma|1a5mi': { n: 4, dados: { desconto_mediana: 30 } }, // amostra pequena: pula
  'uf:AM|reforma|*': { n: 10, dados: { desconto_mediana: 18.73, desconto_p25: 13.55, desconto_p75: 25, pct_com_recusa_mais_barata: 60, recusa_por_faixa: { '25a30': { propostas: 40, pct_recusadas: 54 } } } },
  'BR|*|*': { n: 1466, dados: { desconto_mediana: 18.42, desconto_p25: 9.13, desconto_p75: 25.01, pct_com_recusa_mais_barata: 53.27 } },
};

test('fraseDoEstudo usa o primeiro recorte com 10 ou mais disputas e fala em português simples', () => {
  const r = E.fraseDoEstudo(est, 'AM', 'reforma', '1a5mi');
  assert.equal(r.recorte, 'uf:AM|reforma|*');
  assert.equal(r.frase, 'Em obras de reforma no AM (10 concorrências concluídas), o vencedor deu em geral 18,7% de desconto (metade ficou entre 13,6% e 25,0%) e em 60,0% delas ao menos uma proposta mais barata caiu antes dele. Entre 25% e 30% de desconto, 54,0% das propostas foram recusadas.');
  assert.equal(E.fraseDoEstudo(est, 'SP', 'eletrica', 'ate_1mi').recorte, 'BR|*|*');
  assert.match(E.fraseDoEstudo(est, 'SP', 'eletrica', 'ate_1mi').frase, /^Em obras no Brasil \(1466 concorrências/);
  assert.equal(E.fraseDoEstudo({}, 'AM', 'reforma', 'ate_1mi'), null);
});

test('tipo e faixa iguais aos do robô', () => {
  assert.equal(E.tipoDeObra('Reforma e ampliação da UBS'), 'reforma');
  assert.equal(E.faixaDeValor(849986.63), 'ate_1mi');
  assert.equal(E.regiaoDe('PA'), 'N');
});
