const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../juridico-base.js');

test('base tem 40+ respostas, todas com artigo e link oficial, categoria conhecida e ids únicos', () => {
  assert.ok(J.PERGUNTAS.length >= 40);
  assert.equal(new Set(J.PERGUNTAS.map((p) => p.id)).size, J.PERGUNTAS.length);
  for (const p of J.PERGUNTAS) {
    assert.ok(J.CATEGORIAS[p.categoria], p.id);
    assert.ok(p.pergunta.endsWith('?') && p.resposta.length > 40, p.id);
    assert.ok(p.bases.length > 0, p.id);
    for (const b of p.bases) {
      assert.match(b.url, /^https:\/\/www\.(planalto\.gov\.br|gov\.br)\//, p.id);
      assert.match(b.dispositivo, /art/, p.id);
    }
  }
  assert.equal(J.REVISAO_JURIDICA, 'pendente');
});

test('prazos centrais batem com os arts. 164 e 165 da Lei 14.133', () => {
  const r = (id) => J.PERGUNTAS.find((p) => p.id === id);
  assert.match(r('prazo-impugnacao').resposta, /3 dias úteis antes/);
  assert.match(r('prazo-recurso').resposta, /^3 dias úteis/);
  assert.match(r('prazo-contrarrazao').bases[0].dispositivo, /165, § 4º/);
});

test('busca ignora acento e maiúscula, exige todas as palavras e filtra por categoria', () => {
  const contrarrazao = J.buscarPerguntas('CONTRARRAZOES prazo');
  assert.ok(contrarrazao.some((p) => p.id === 'prazo-contrarrazao'));
  assert.ok(contrarrazao.every((p) => /contrarraz/i.test(J.normalizar(`${p.pergunta} ${p.resposta}`))));
  assert.equal(J.buscarPerguntas('', 'srp').every((p) => p.categoria === 'srp'), true);
  assert.equal(J.buscarPerguntas('palavrainexistentexyz').length, 0);
  assert.equal(J.buscarPerguntas('').length, J.PERGUNTAS.length);
});

test('modelos: 10 peças, campo vazio vira [PREENCHER], valor não injeta variável e não há CPF', () => {
  assert.deepEqual(J.MODELOS.map((m) => m.codigo), ['esclarecimento', 'impugnacao', 'intencao_recurso', 'recurso', 'contrarrazao', 'reequilibrio',
    'prorrogacao_entrega', 'diligencia', 'exequibilidade', 'declaracoes']);
  for (const m of J.MODELOS) {
    assert.equal(m.revisaoJuridica, 'pendente');
    assert.ok(!/cpf/i.test(m.texto), m.codigo);
    // Toda variável do texto é um campo do formulário (nada fica sem como preencher).
    for (const [, nome] of m.texto.matchAll(/\{\{([a-z_]+)\}\}/g)) assert.ok(m.campos.includes(nome), `${m.codigo}:${nome}`);
  }
  const recurso = J.obterModelo('recurso');
  const vazio = J.preencherModelo(recurso, {});
  assert.match(vazio.texto, /\[PREENCHER: decisão recorrida\]/);
  assert.ok(vazio.faltando.includes('razao_social'));
  const cheio = J.preencherModelo(recurso, { razao_social: 'Empresa {{cnpj}} Ltda', decisao: 'Linha 1\nLinha 2' });
  assert.match(cheio.texto, /Empresa\s+cnpj\s+Ltda/);
  assert.match(cheio.texto, /Linha 1\nLinha 2/);
  assert.equal(J.obterModelo('inexistente'), null);
});
