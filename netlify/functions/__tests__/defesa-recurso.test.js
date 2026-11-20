const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnosticarAnalise, prepararContexto } = require('../_defesa_contexto');
const { executarDefesa } = require('../_defesa_handler');

const base = { edital: { numeroControlePNCP: '45279635000108-1-000923/2026' }, hashFonte: 'a'.repeat(64), questionamento: 'A inabilitação por falta de documentos de qualificação está correta?', objetivo: 'Reformar a decisão.' };
const sessao = { ok: true, userId: 'teste' };

test('recurso e contrarrazão exigem o texto da decisão (fase posterior) antes de qualquer custo', async () => {
  for (const tipo of ['recurso', 'contrarrazao']) {
    let cotas = 0;
    const r = await executarDefesa({ ...base, tipo, fase: 'questionamento' }, { sessao, env: {}, autorizar: async () => { cotas++; return { ok: true }; } });
    assert.equal(r.statusCode, 400);
    const semTexto = await executarDefesa({ ...base, tipo, fase: 'resposta_orgao', respostaOrgao: '' }, { sessao, env: {} });
    assert.equal(semTexto.statusCode, 400);
    // Com o texto, passa da validação e para no mesmo portão de IA dos outros tipos (sem chave = 503, nenhuma cota).
    const ok = await executarDefesa({ ...base, tipo, fase: 'resposta_orgao', respostaOrgao: 'Decisão: inabilitada por falta de atestado.' }, { sessao, env: {} });
    assert.equal(ok.statusCode, 503);
    assert.equal(cotas, 0);
  }
  assert.equal((await executarDefesa({ ...base, tipo: 'outro', fase: 'resposta_orgao', respostaOrgao: 'x' }, { sessao, env: {} })).statusCode, 400);
});

test('R1 do recurso é rotulado como decisão recorrida e a minuta traz o prazo do art. 165', () => {
  const dossie = { versao: 17, fonteLida: true, textoEdital: 'Pregão eletrônico. Lei 14.133. 11.1. O licitante deverá apresentar atestado de capacidade técnica.', estrutura: { identificacao: { modalidade: 'Pregão' } } };
  const ctx = prepararContexto(dossie, { ...base, tipo: 'recurso', fase: 'resposta_orgao', respostaOrgao: 'Inabilitada por ausência de atestado.' });
  assert.match(ctx.fontes.find((f) => f.id === 'R1').documento, /Decisão recorrida/);
  const ctxC = prepararContexto(dossie, { ...base, tipo: 'contrarrazao', fase: 'resposta_orgao', respostaOrgao: 'Razões da recorrente.' });
  assert.match(ctxC.fontes.find((f) => f.id === 'R1').documento, /recurso da outra empresa/);

  const c = { fontes: [
    { id: 'F1', numero: '11.1', documento: 'Termo', pagina: '3', texto: '11.1. Se necessária a verificação, serão apresentados os documentos de qualificação.' },
    { id: 'R1', declarada: true, documento: 'Decisão recorrida fornecida pelo usuário — não autenticada', pagina: '', texto: 'Decisão SIMULADA: inabilitada por falta dos documentos de qualificação.' },
  ], normas: [], pendencias: [], dispensa: true };
  const ponto = (tipo, ...fontes) => ({ tipo, fontes, fundamentos: [] });
  const dados = JSON.stringify({ pontos: [ponto('especificar_documentos', 'F1')], resposta: ponto('analisar_resposta_incompleta', 'R1', 'F1') });
  const recurso = diagnosticarAnalise(dados, c, { ...base, tipo: 'recurso', fase: 'resposta_orgao' });
  assert.equal(recurso.motivo, null);
  assert.match(recurso.analise.minutaTexto, /^Rascunho de razões de recurso/);
  assert.match(recurso.analise.minutaTexto, /art\. 165, I e § 1º, I/);
  const contra = diagnosticarAnalise(dados, c, { ...base, tipo: 'contrarrazao', fase: 'resposta_orgao' });
  assert.match(contra.analise.minutaTexto, /^Rascunho de contrarrazões[\s\S]*art\. 165, § 4º/);
});
