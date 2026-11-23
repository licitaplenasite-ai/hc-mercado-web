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

const VERSOES = [
  { id: 3, base: 'SINAPI', abrangencia: 'BR', data_base: '2026-10-01', versao: '2026-10', situacao: 'precos', coletado_em: '2026-11-16T12:00:00Z' },
  { id: 2, base: 'SINAPI', abrangencia: 'BR', data_base: '2026-09-01', versao: '2026-09 Retificação 01', situacao: 'precos', coletado_em: '2026-10-16T12:00:00Z' },
  { id: 1, base: 'SINAPI', abrangencia: 'BR', data_base: '2025-10-01', versao: '2025-10', situacao: 'zerada', coletado_em: '2025-11-16T12:00:00Z' },
  { id: 9, base: 'SINAPI', abrangencia: 'BR', data_base: '2025-01-01', versao: '2025-01', situacao: 'precos', coletado_em: '2025-02-16T12:00:00Z' },
];

test('escolherReferencia: data-base do edital no histórico, mais nova, zerada, fora do guardado e futura', () => {
  assert.deepEqual(UI.escolherReferencia('2026-10', VERSOES), { versao: null, maisNova: '2026-10', aviso: null });
  assert.deepEqual(UI.escolherReferencia('', VERSOES), { versao: null, maisNova: '2026-10', aviso: null });
  const antiga = UI.escolherReferencia('2026-09', VERSOES);
  assert.equal(antiga.versao.id, 2);
  assert.match(antiga.aviso, /Existe referência mais nova: 2026-10/);
  const zerada = UI.escolherReferencia('2025-10', VERSOES);
  assert.equal(zerada.versao, null);
  assert.equal(zerada.nivel, 'erro');
  assert.match(zerada.aviso, /sem preço/);
  assert.match(UI.escolherReferencia('2023-09', VERSOES).aviso, /não está guardado no sistema \(há de 2025-01 a 2026-10\)/);
  assert.match(UI.escolherReferencia('2027-01', VERSOES).aviso, /ainda não publicou/);
  assert.deepEqual(UI.escolherReferencia('2023-09', []), { versao: null, maisNova: null, aviso: null }, 'sem histórico: como na fase 1');
});

test('baseDoHistorico monta a mesma base do SINAPI vigente: regime, analítico com descrição', () => {
  const precos = { 'composicao|97622': [55.1, 53.2], 'insumo|88309': [24.71, null] };
  const analitico = { 97622: [['insumo', '88309', 0.3541]] };
  const descricoes = { 'composicao|97622': ['DEMOLIÇÃO', 'M2'], 'insumo|88309': ['PEDREIRO', 'H'] };
  const cd = UI.baseDoHistorico(precos, analitico, descricoes, true, 'AM', '2026-09-01');
  assert.deepEqual(cd.precos, { 'composicao|97622': 53.2 });
  assert.equal(cd.referencia, '2026-09');
  assert.deepEqual(cd.composicoes['97622'], { descricao: 'DEMOLIÇÃO', unidade: 'M2', itens: [{ tipo: 'insumo', codigo: '88309', descricao: 'PEDREIRO', unidade: 'H', coeficiente: 0.3541 }] });
  assert.deepEqual(UI.baseDoHistorico(precos, {}, {}, false, 'AM', '2026-09-01').precos, { 'composicao|97622': 55.1, 'insumo|88309': 24.71 });
});

test('textoBases: a mais nova de cada base, SICRO da UF da obra, catálogo explicado, zerada fora', () => {
  const v = [...VERSOES, { base: 'SICRO', abrangencia: 'AM', data_base: '2026-07-01', versao: '07/2026', situacao: 'precos', coletado_em: '2026-09-29T12:00:00Z' },
    { base: 'SICRO', abrangencia: 'PA', data_base: '2026-07-01', versao: '07/2026', situacao: 'precos', coletado_em: '2026-09-29T12:00:00Z' },
    { base: 'ORSE', abrangencia: 'SE', data_base: '2026-08-01', versao: '2026-08', situacao: 'catalogo', coletado_em: '2026-11-17T12:00:00Z' }];
  assert.equal(UI.textoBases(v, 'AM'), 'Bases no sistema: SINAPI 2026-10 (atualizada em 16/11/2026) · SICRO AM 07/2026 (atualizada em 29/09/2026) · ORSE SE 2026-08 (só o mês: preço digitado).');
  assert.equal(UI.textoBases([], 'AM'), '');
});

test('rascunho: volta o que foi salvo; texto estragado ou de outra versão é ignorado', () => {
  const estado = { nomeArquivo: 'edital', abas: [{ nome: 'Orç', linhas: [['1']] }], leitura: { itens: [] }, cpu: null, crono: null, manuais: { '1.1': { preco: 10 } }, cotacoes: {} };
  const r = UI.lerRascunho(UI.montarRascunho(estado, { 'l-uf': 'AM', 'm-simples': true }, new Date('2026-11-22T10:00:00Z')));
  assert.equal(r.nomeArquivo, 'edital');
  assert.deepEqual(r.manuais, { '1.1': { preco: 10 } });
  assert.deepEqual(r.campos, { 'l-uf': 'AM', 'm-simples': true });
  assert.equal(r.salvoEm, '2026-11-22T10:00:00.000Z');
  assert.equal(UI.lerRascunho('{quebrado'), null);
  assert.equal(UI.lerRascunho(JSON.stringify({ versao: 99, leitura: {}, abas: [], campos: {} })), null);
  assert.equal(UI.lerRascunho(null), null);
});

test('rascunho guarda só a aba lida e se já foi montado (planilha+CPU grandes cabem no navegador)', () => {
  const estado = { nomeArquivo: 'e', abas: [{ nome: 'Orç', linhas: [['1']] }, { nome: 'Cronograma', linhas: [['x']] }], leitura: { aba: 'Orç', itens: [] }, montado: true, manuais: {}, cotacoes: {} };
  const r = UI.lerRascunho(UI.montarRascunho(estado, {}));
  assert.deepEqual(r.abas, [{ nome: 'Orç', linhas: [['1']] }]);
  assert.equal(r.montado, true);
  assert.equal(UI.lerRascunho(UI.montarRascunho({ ...estado, montado: undefined }, {})).montado, false);
});
