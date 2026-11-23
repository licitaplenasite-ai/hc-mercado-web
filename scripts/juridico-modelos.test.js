// Modelos e artigos do Jurídico: base legal, "o que não pode faltar", preenchimento com dados do processo e exportação em Word.
const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const J = require('../juridico-base.js');
const A = require('../juridico-artigos.js');
const UI = require('../juridico-ui.js');
const { handler, __test } = require('../netlify/functions/gerar-checklist');

const DADOS = { razao_social: 'Empresa Exemplo Ltda', cnpj: '12.345.678/0001-90', endereco: 'Rua A, 1, Manaus/AM', representante: 'Representante',
  cargo: 'Sócio-administrador', cidade: 'Manaus', data: '22/11/2026', orgao: 'Prefeitura de Exemplo', autoridade: 'Pregoeira', numero_edital: '90012/2026',
  objeto: 'Aquisição de material de limpeza' };
const completar = (m) => Object.fromEntries(m.campos.map((c) => [c, DADOS[c] || `valor de ${c}`]));

async function exportar(minuta) {
  const anterior = global.fetch;
  global.fetch = async (url) => new Response(JSON.stringify(String(url).includes('/rest/v1/clientes?') ? [{ status: 'aprovado' }] : { id: 'usuario-teste' }));
  try { return await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer teste' }, body: JSON.stringify({ minuta }) }); }
  finally { global.fetch = anterior; }
}

test('todo modelo tem base da Lei 14.133 com artigo, prazo, lista do que não pode faltar e só usa campos do formulário', () => {
  for (const m of J.MODELOS) {
    assert.equal(m.lei, '14133', m.codigo);
    assert.ok(m.bases.some((b) => b.norma === 'Lei 14.133/2021' && /^arts?\. \d+/.test(b.dispositivo)), m.codigo);
    assert.ok(m.prazo.length > 20, m.codigo);
    assert.ok(m.naoPodeFaltar.length >= 3, m.codigo);
    for (const [, nome] of m.texto.matchAll(/\{\{([a-z_]+)\}\}/g)) assert.ok(m.campos.includes(nome) && J.ROTULOS[nome], `${m.codigo}:${nome}`);
  }
  // Prazos centrais nos modelos certos.
  assert.match(J.obterModelo('intencao_recurso').prazo, /165, § 1º, I/);
  assert.match(J.obterModelo('exequibilidade').texto, /art\. 59, § 4º/);
  assert.match(J.obterModelo('exequibilidade').texto, /Acórdão 465\/2024-Plenário/);
});

test('preencher com os dados do processo não deixa [PREENCHER]; intenção de recurso é texto curto, sem fecho', () => {
  for (const m of J.MODELOS) {
    const { texto, faltando } = J.preencherModelo(m, completar(m));
    assert.deepEqual(faltando, [], m.codigo);
    assert.ok(!texto.includes('[PREENCHER:'), m.codigo);
    if (!m.curto) assert.ok(texto.includes('Empresa Exemplo Ltda') && texto.includes('90012/2026') && texto.includes('Prefeitura de Exemplo'), m.codigo);
  }
  const curto = J.preencherModelo(J.obterModelo('intencao_recurso'), { item: 'item 3', decisao: 'a aceitação da proposta da empresa X', motivo: 'o atestado não comprova 50% da parcela relevante' });
  assert.ok(curto.texto.length < 400);
  assert.doesNotMatch(curto.texto, /pede deferimento/);
});

test('exportação: todo modelo da tela é aceito pelo /api/gerar-checklist e o Word sai com o texto preenchido', async () => {
  assert.deepEqual([...J.MODELOS.map((m) => m.codigo)].sort(), [...__test.TIPOS_MINUTA].sort());
  for (const m of J.MODELOS) {
    const { texto } = J.preencherModelo(m, completar(m));
    const r = await exportar({ tipo: m.codigo, revisado: true, texto });
    assert.equal(r.statusCode, 200, m.codigo);
    const xml = new AdmZip(Buffer.from(r.body, 'base64')).readAsText('word/document.xml');
    assert.ok(xml.includes(m.curto ? 'item' : 'Empresa Exemplo Ltda'), m.codigo);
  }
  assert.equal((await exportar({ tipo: 'recurso', revisado: false, texto: 'x' })).statusCode, 422);
});

test('artigos: 12 a 15, autor Equipe LicitaPlena, fonte oficial com link e modelo que existe', () => {
  assert.ok(A.ARTIGOS.length >= 12 && A.ARTIGOS.length <= 15);
  assert.equal(new Set(A.ARTIGOS.map((x) => x.id)).size, A.ARTIGOS.length);
  for (const x of A.ARTIGOS) {
    assert.equal(x.autor, 'Equipe LicitaPlena', x.id);
    assert.ok(x.fontes.length > 0 && x.fontes.every((f) => /^https:\/\/(www\.planalto\.gov\.br|www\.gov\.br|licitacoesecontratos\.tcu\.gov\.br|pesquisa\.apps\.tcu\.gov\.br)\//.test(f.url)), x.id);
    assert.ok(x.corpo.length >= 3 && x.resumo.length > 40, x.id);
    assert.ok(/art\. \d+/.test(x.corpo.join(' ')), x.id);
    if (x.modelo) assert.ok(J.obterModelo(x.modelo), `${x.id}:${x.modelo}`);
  }
  assert.ok(!/harreson/i.test(JSON.stringify(A.ARTIGOS)));
});

test('busca e filtro por lei: artigos e perguntas', () => {
  assert.ok(A.buscarArtigos('atestado').some((x) => x.id === 'atestados'));
  assert.deepEqual(A.buscarArtigos('', '8666').map((x) => x.id), ['lei-antiga']);
  assert.ok(A.buscarArtigos('', '14133').every((x) => x.leis.includes('14133')));
  assert.equal(A.buscarArtigos('palavrainexistentexyz').length, 0);
  assert.equal(J.leiDaPergunta(J.PERGUNTAS.find((q) => q.id === 'prazo-antigo-10024')), '10520');
  assert.equal(J.leiDaPergunta(J.PERGUNTAS.find((q) => q.id === 'prazo-recurso')), '14133');
});

test('link para abrir o modelo: só modelo conhecido e processo com UUID', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  assert.deepEqual(UI.pedidoDoEndereco(`?juridico=recurso&processo=${id}`, J), { modelo: 'recurso', processoId: id });
  assert.deepEqual(UI.pedidoDoEndereco('?juridico=contrarrazao&processo=x', J), { modelo: 'contrarrazao', processoId: null });
  assert.equal(UI.pedidoDoEndereco('?juridico=protocolo', J), null);
  assert.equal(UI.pedidoDoEndereco('', J), null);
});

test('aviso fixo e advogado da HC', () => {
  assert.equal(J.AVISO, 'Conteúdo informativo. Confira com um advogado antes de protocolar.');
  assert.equal(J.ADVOGADO.url, 'https://www.hclicitacoes.com');
});
