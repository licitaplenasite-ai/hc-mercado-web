const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./meu-dia.js');
const JuridicoPrazos = require('./juridico-prazos.js');

// Terça, 24/11/2026, meio-dia em Brasília.
const AGORA = Date.parse('2026-11-24T12:00:00-03:00');
const EA = 'aaaaaaaa-0000-4000-8000-000000000001', EB = 'bbbbbbbb-0000-4000-8000-000000000001';
const PA = 'aaaaaaaa-0000-4000-8000-000000000011', PB = 'bbbbbbbb-0000-4000-8000-000000000011';
const ctx = (processoId, empresaId, prazo) => ({ processoId, empresaId, processoRotulo: 'Processo 10/2026', objeto: 'Papel A4', prazo });
const montar = (dados) => M.agrupar(M.montarItens(dados, AGORA, JuridicoPrazos));
const chaves = (g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((i) => i.chave)]));

test('agrupa em Atrasado, Hoje, Próximos 7 dias e Mais adiante, em ordem de data', () => {
  const g = montar({
    contextos: [ctx(PA, EA, '2026-11-24T13:00:00Z')],
    prazos: [
      { id: 'p1', empresaId: EA, processoId: PA, categoria: 'diligencia', titulo: 'Diligência', vencimento: '2026-11-19T02:59:00Z', dias: -6 },
      { id: 'p2', empresaId: EA, processoId: PA, categoria: 'proposta', titulo: 'Proposta', vencimento: '2026-11-27T13:00:00Z', dias: 3 },
      { id: 'p3', empresaId: EA, processoId: PA, categoria: 'entrega', titulo: 'Entrega', vencimento: '2026-11-25T13:00:00Z', dias: 1 },
    ],
    certidoes: [{ empresaId: EA, tipo: 'FGTS', titulo: '', vencimento: '2026-12-20', dias: 26, situacao: 'vencendo' },
      { empresaId: EA, tipo: 'CND', titulo: '', vencimento: '2026-11-24', dias: 0, situacao: 'vencendo' }],
    parados: [{ empresaId: EA, processoId: PA, dias: 9, limite: 7, aproximada: false }],
  });
  assert.deepEqual(chaves(g), {
    atrasado: ['parado:' + PA, 'prazo:p1'],
    hoje: ['certidao:' + EA + ':CND:2026-11-24', 'sessao:' + PA],
    proximos: ['prazo:p3', 'prazo:p2'],
    depois: ['certidao:' + EA + ':FGTS:2026-12-20'],
  });
  assert.equal(M.selo(-6), 'Atrasado há 6 dias');
  assert.deepEqual([0, 1, 3].map(M.selo), ['Hoje', 'Amanhã', 'Em 3 dias']);
  const parado = g.atrasado[0];
  assert.equal(parado.seloTexto, 'Parado há 9 dias');
  assert.match(parado.detalhes[0], /limite da etapa \(7 dias\)\. Defina o próximo passo/);
  assert.equal(parado.acao.href, 'painel.html#kanban');
});

test('prazo legal mostra a base da lei, que o edital prevalece e o link para corrigir; agenda sem processo vai para a agenda', () => {
  const ID = 'cccccccc-0000-4000-8000-000000000001';
  const [legal, agenda] = M.montarItens({ contextos: [ctx(PA, EA, '')], prazos: [
    { id: ID, empresaId: EA, processoId: PA, categoria: 'impugnacao', titulo: 'Impugnação', vencimento: '2026-11-26T02:59:00Z', dias: 1 },
    { id: 'a1', empresaId: null, processoId: null, categoria: 'renovacao', titulo: 'Renovar alvará', vencimento: '2026-11-25T12:00:00Z', dias: 1 },
  ] }, AGORA, JuridicoPrazos);
  assert.equal(legal.rotuloTipo, 'Prazo legal');
  assert.ok(legal.detalhes.includes('Lei 14.133, art. 164 · o prazo do edital prevalece'));
  assert.ok(legal.detalhes.includes('25/11 às 23:59 (horário de Brasília)'), 'hora e dia de Brasília');
  assert.equal(legal.corrigir, `processos.html?empresa=${EA}&prazo=${ID}`, 'abre a empresa certa e o formulário do prazo');
  assert.deepEqual(legal.acao, { tipo: 'processo', empresaId: EA, processoId: PA, texto: 'Abrir processo' });
  assert.equal(agenda.corrigir, null);
  assert.deepEqual(agenda.acao, { tipo: 'link', href: 'operacao.html?aba=agenda', texto: 'Ver agenda' });
});

test('sessão: intenção de recurso na hora e razões em 3 dias úteis (fim de semana, feriado e virada de ano)', () => {
  const razoes = (prazo) => M.montarItens({ contextos: [ctx(PA, EA, prazo)] }, AGORA, JuridicoPrazos)[0].detalhes[0];
  // Sexta 27/11 -> segunda, terça, quarta = 02/12.
  assert.match(razoes('2026-11-27T12:00:00Z'), /^Intenção de recurso: na hora, durante a sessão.*art\. 165, § 1º, I\)\. Se manifestar, as razões vão até 02\/12 /);
  // Sessão num sábado (28/11): conta a partir da segunda: 30/11, 01/12, 02/12.
  assert.match(razoes('2026-11-28T12:00:00Z'), /até 02\/12 /);
  // Quarta 30/12: 31/12, (01/01 feriado, fim de semana), 04/01, 05/01. Fora da janela de 7 dias? 36 dias: não aparece.
  assert.equal(M.montarItens({ contextos: [ctx(PA, EA, '2026-12-30T12:00:00Z')] }, AGORA, JuridicoPrazos).length, 0);
  assert.equal(M.montarItens({ contextos: [ctx(PA, EA, '2026-12-30T12:00:00Z')] }, Date.parse('2026-12-29T12:00:00-03:00'), JuridicoPrazos)[0].detalhes[0].includes('até 05/01'), true);
  // Sessão que já passou não entra (o prazo das razões vem da tarefa do Funil, com a data da ata).
  assert.equal(M.montarItens({ contextos: [ctx(PA, EA, '2026-11-23T12:00:00Z')] }, AGORA, JuridicoPrazos).length, 0);
});

test('o prazo "Sessão" do processo não repete a sessão; tarefa do Funil abre o Funil', () => {
  const itens = M.montarItens({ contextos: [ctx(PA, EA, '2026-11-25T13:00:00Z')],
    prazos: [{ id: 's1', empresaId: EA, processoId: PA, categoria: 'sessao', titulo: 'Sessão: Papel', vencimento: '2026-11-25T13:00:00Z', dias: 1 }],
    tarefas: [{ id: PA + ':amostra', empresaId: EA, processoId: PA, titulo: 'Levar amostra', inicio: '2026-11-26T10:00', dias: 2, responsavel: 'Ana' },
      { id: 'x', empresaId: EA, processoId: PA, titulo: 'Sem data', inicio: 'ontem', dias: 0 }] }, AGORA, JuridicoPrazos);
  assert.deepEqual(itens.map((i) => i.tipo), ['sessao', 'tarefa']);
  assert.deepEqual(itens[1].detalhes, ['Processo 10/2026 · Papel A4', '26/11 às 10:00 (horário de Brasília)', 'Responsável: Ana']);
  assert.equal(itens[1].acao.href, 'painel.html#kanban');
});

test('filtro por empresa (Assessoria): a empresa escolhida mais a agenda da organização inteira', () => {
  const itens = M.montarItens({ contextos: [ctx(PA, EA, '2026-11-25T13:00:00Z'), ctx(PB, EB, '2026-11-26T13:00:00Z')],
    prazos: [{ id: 'a1', empresaId: null, processoId: null, categoria: 'outro', titulo: 'Reunião', vencimento: '2026-11-25T12:00:00Z', dias: 1 }] }, AGORA, JuridicoPrazos);
  assert.deepEqual(M.filtrar(itens, EB).map((i) => i.chave), ['sessao:' + PB, 'prazo:a1']);
  assert.equal(M.filtrar(itens, '').length, 3);
});

test('bloco que o servidor não leu (null) entra no aviso; ausente (SQL não aplicado) não', () => {
  assert.deepEqual(M.blocosComFalha({ prazos: null, certidoes: [], tarefas: undefined, parados: null }), ['prazos', 'cartões parados']);
  assert.deepEqual(M.montarItens({ prazos: null, certidoes: null }, AGORA, JuridicoPrazos), []);
});

// DOM mínimo: só o que renderizar usa.
function dom() {
  const no = (tag) => ({ tag, filhos: [], dataset: {}, attrs: {}, hidden: true, textContent: '', className: '',
    append(...n) { this.filhos.push(...n); }, replaceChildren(...n) { this.filhos = n; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.ouvinte = f; } });
  return { createElement: (tag) => no(tag), no };
}
const textos = (n) => [n.textContent, ...(n.filhos || []).flatMap(textos)].filter(Boolean);
const achar = (n, f) => (f(n) ? n : (n.filhos || []).map((x) => achar(x, f)).find(Boolean));

test('tela: vazio amigável, número de hoje em destaque e seletor de empresa só com mais de uma', () => {
  const doc = dom(), alvo = doc.no('div');
  M.renderizar({ doc, alvo, dados: { contextos: [], prazos: [], certidoes: [] }, empresas: [{ empresaId: EA, rotulo: 'A' }], agora: AGORA, calc: JuridicoPrazos, agendaIcs: null });
  assert.equal(alvo.hidden, false);
  const t = textos(alvo);
  assert.ok(t.includes('Tudo em dia.'));
  assert.ok(t.includes('0') && t.includes(' itens pedem atenção hoje'));
  assert.equal(achar(alvo, (n) => n.tag === 'select'), undefined);

  const escolhas = [];
  M.renderizar({ doc, alvo, dados: { contextos: [ctx(PA, EA, '2026-11-24T13:00:00Z')], certidoes: [{ empresaId: EB, tipo: '<b>CND</b>', vencimento: '2026-11-20', dias: -4 }] },
    empresas: [{ empresaId: EA, rotulo: 'A' }, { empresaId: EB, rotulo: 'B' }], filtro: EB, aoFiltrar: (v) => escolhas.push(v), agora: AGORA, calc: JuridicoPrazos, agendaIcs: null });
  const t2 = textos(alvo);
  assert.ok(t2.includes('<b>CND</b>'), 'texto do banco vai como texto');
  assert.ok(t2.includes('Atrasado há 4 dias') && t2.includes('B'));
  assert.equal(t2.includes('Sessão de disputa'), false, 'a sessão da empresa A some com o filtro na B');
  const sel = achar(alvo, (n) => n.tag === 'select');
  sel.value = EA;
  sel.ouvinte();
  assert.deepEqual(escolhas, [EA]);
  assert.equal(achar(alvo, (n) => n.tag === 'a').href, 'operacao.html?aba=documentos&empresa=' + EB);
});

test('esclarecimento e impugnação vencidos somem (são direitos, não obrigações); outros prazos vencidos ficam', () => {
  const itens = M.montarItens({ contextos: [ctx(PA, EA, '2026-12-10T13:00:00Z')], prazos: [
    { id: 'i', empresaId: EA, processoId: PA, categoria: 'impugnacao', titulo: 'Impugnação', vencimento: '2026-11-20T02:59:00Z', dias: -5 },
    { id: 'e', empresaId: EA, processoId: PA, categoria: 'esclarecimento', titulo: 'Esclarecimento', vencimento: '2026-11-20T02:59:00Z', dias: -5 },
    { id: 'r', empresaId: EA, processoId: PA, categoria: 'recurso', titulo: 'Razões', vencimento: '2026-11-20T20:00:00Z', dias: -4 },
  ] }, AGORA, JuridicoPrazos);
  assert.deepEqual(itens.map((i) => i.chave), ['prazo:r']);
});

test('processo perdido, contratado ou arquivado some do Meu dia (sessão, prazo, tarefa e parado)', () => {
  for (const status of ['perdido', 'contratado', 'arquivado']) {
    const itens = M.montarItens({ contextos: [{ ...ctx(PA, EA, '2026-11-25T13:00:00Z'), status }],
      prazos: [{ id: 'x', empresaId: EA, processoId: PA, categoria: 'entrega', titulo: 'Entrega', vencimento: '2026-11-25T13:00:00Z', dias: 1 }],
      tarefas: [{ id: 't', empresaId: EA, processoId: PA, titulo: 'T', inicio: '2026-11-25T10:00', dias: 1 }],
      parados: [{ empresaId: EA, processoId: PA, dias: 9, limite: 7, aproximada: false }] }, AGORA, JuridicoPrazos);
    assert.deepEqual(itens, [], status);
  }
});

test('cartão parado com conta aproximada (sem etapa_desde) não entra', () => {
  assert.deepEqual(M.montarItens({ contextos: [ctx(PA, EA, '')], parados: [{ empresaId: EA, processoId: PA, dias: 30, limite: 7, aproximada: true }] }, AGORA, JuridicoPrazos), []);
});

test('prazo corrigido à mão que ficou depois da sessão avisa para conferir', () => {
  const [sessao, prazo] = M.montarItens({ contextos: [ctx(PA, EA, '2026-11-26T13:00:00Z')], prazos: [
    { id: 'i', empresaId: EA, processoId: PA, categoria: 'impugnacao', titulo: 'Impugnação', vencimento: '2026-11-28T02:59:00Z', dias: 3 }] }, AGORA, JuridicoPrazos);
  assert.equal(sessao.tipo, 'sessao');
  assert.equal(prazo.detalhes[0], 'Confira esta data: a sessão mudou e este prazo ficou depois dela');
  assert.equal(prazo.situacao, 'atencao');
});
