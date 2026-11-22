'use strict';
// Tela do Orçamento de obra: o que vem do Supabase vira base do Orçamentista; cotações e números digitados.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const UI = require('./orcamento-obra-ui.js');

test('linhas do SINAPI no Supabase viram base no regime escolhido, com a referência mais nova', () => {
  const custos = [{ tipo: 'composicao', codigo: '97622', preco_sd: 55.1, preco_cd: 53.2, referencia: '2026-10-01' },
    { tipo: 'composicao', codigo: '88309', preco_sd: null, preco_cd: 24.71, referencia: '2026-10-01' },
    { tipo: 'insumo', codigo: '4813', preco_sd: 250, preco_cd: null, referencia: '2026-09-01' }];
  const itens = [{ composicao: '97622', item_tipo: 'composicao', item_codigo: '88309', descricao: 'Pedreiro', unidade: 'H', coeficiente: '0.3541' }];
  const cd = UI.baseDoSupabase(custos, itens, true, 'AM');
  assert.deepEqual(cd.precos, { 'composicao|97622': 53.2, 'composicao|88309': 24.71 });
  assert.equal(cd.referencia, '2026-10');
  assert.deepEqual(cd.composicoes['97622'].itens, [{ tipo: 'composicao', codigo: '88309', descricao: 'Pedreiro', unidade: 'H', coeficiente: 0.3541 }]);
  assert.deepEqual(UI.baseDoSupabase(custos, [], false, 'AM').precos, { 'composicao|97622': 55.1, 'insumo|4813': 250 });
});

test('cotações digitadas: só as com valor; nome padrão; números em pt-BR', () => {
  assert.deepEqual(UI.lerCotacoes([{ fornecedor: ' Loja A ', valor: '1.234,50' }, { fornecedor: '', valor: '99' }, { fornecedor: 'Sem valor', valor: '' }, { valor: 'abc' }]),
    [{ fornecedor: 'Loja A', valor: 1234.5 }, { fornecedor: 'Fornecedor 2', valor: 99 }]);
  assert.deepEqual(['17', '17,5', 'R$ 1.000,00', '', 'x', '1234.56'].map(UI.numero), [17, 17.5, 1000, null, null, 1234.56]);
});

test('palavras da busca de parecido: sem acento, sem palavra vazia, as mais longas primeiro', () => {
  assert.deepEqual(UI.palavrasBusca('Pintura de demarcação de quadra com tinta acrílica, inclusive fornecimento'), ['demarcacao', 'acrilica', 'pintura', 'quadra']);
  assert.deepEqual(UI.palavrasBusca('PISO PORCELANATO 60X60', 2), ['porcelanato', 'piso']);
  assert.deepEqual(UI.palavrasBusca(''), []);
});

test('a página traz o aviso fixo do engenheiro, o rótulo do agente e a trava do plano', () => {
  const html = fs.readFileSync('orcamento-obra.html', 'utf8');
  assert.match(html, /<p class="engenheiro" role="note">Revisão e assinatura de engenheiro ou arquiteto responsável são obrigatórias\.<\/p>/);
  assert.match(html, /<span class="rotulo-agente">Orçamentista<\/span> Orçamento de obra/);
  assert.match(html, /<main data-recurso="orcamento_obra">/);
  // Ordem dos scripts: cada agente usa os anteriores.
  const ordem = ['bdi-calculadora', 'orcamento-obra-regras', 'orcamento-obra-calculo', 'orcamento-obra-leitor', 'orcamento-obra-auditor', 'orcamento-obra-montador', 'orcamento-obra-ui'].map((n) => html.indexOf(`<script src="${n}.js">`));
  assert.ok(ordem.every((p, i) => p > 0 && (i === 0 || p > ordem[i - 1])), `ordem dos scripts: ${ordem}`);
  assert.match(fs.readFileSync('sinapi.html', 'utf8'), /<a href="orcamento-obra\.html">/);
});
