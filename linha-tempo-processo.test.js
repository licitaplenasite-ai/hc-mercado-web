'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const LT = require('./linha-tempo-processo.js');

const ROTULO = { triagem: 'Triagem', preparacao: 'Preparação', perdido: 'Perdido', sessao: 'Sessão' };
const rotuloStatus = (s) => ROTULO[s] || s;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const AGORA = Date.parse('2026-11-24T15:00:00Z');
const P = {
  id: 'p1', criado_em: '2026-11-01T13:00:00Z', origem_externa_id: '12345678000190-1-000083/2026', status: 'perdido',
  etapa_desde: '2026-11-20T18:00:00Z', data_sessao: '2026-11-18T13:00:00Z', data_resultado: '2026-11-21', situacao_resultado: 'sem_vitoria',
  motivo_perda: 'Preço acima do vencedor', atualizado_em: '2026-11-21T20:00:00Z',
  tarefas_card: { secoes: [{ nome: 'Documentos', tarefas: [{ titulo: 'Certidão FGTS', feita_em: '2026-11-10T14:00:00Z', responsavel: 'Ana' }, { titulo: 'Balanço' }] }] },
};

test('junta tudo em ordem do mais recente ao mais antigo, com situação em texto', () => {
  const ev = LT.montarEventos(P, {
    rotuloStatus,
    historico: [
      { status_anterior: null, status_novo: 'triagem', etapa_nome: null, mudou_em: '2026-11-01T13:00:00Z' },
      { status_anterior: 'triagem', status_novo: 'preparacao', etapa_nome: 'Montando proposta', mudou_em: '2026-11-05T12:00:00Z' },
      { status_anterior: 'preparacao', status_novo: 'perdido', etapa_nome: null, mudou_em: '2026-11-20T18:00:00Z' },
    ],
    prazos: [
      { processo_id: 'p1', titulo: 'Impugnação', vencimento: '2026-11-12T20:00:00Z', concluido_em: '2026-11-11T12:00:00Z' },
      { processo_id: 'p1', titulo: 'Recurso', vencimento: '2026-11-23T20:00:00Z' },
      { processo_id: 'p1', titulo: 'Contrarrazão', vencimento: '2026-11-30T20:00:00Z', responsavel: 'Bia' },
      { processo_id: 'outro', titulo: 'De outro processo', vencimento: '2026-11-15T20:00:00Z' },
    ],
    ocorrencias: [{ processo_id: 'p1', categoria: 'chat', descricao: 'Pregoeiro pediu amostra', ocorrido_em: '2026-11-18T14:30:00Z' }],
    anexos: [{ processo_id: 'p1', tipo: 'proposta', titulo: 'Proposta final', criado_em: '2026-11-17T10:00:00Z' }],
  }, AGORA);
  assert.deepEqual(ev.map((e) => e.titulo), [
    'Prazo: Contrarrazão',
    'Prazo vencido sem conclusão: Recurso',
    'Resultado: Participou sem vencer',
    'Mudou para Perdido',
    'Mensagem do chat',
    'Sessão / abertura',
    'Documento anexado: Proposta',
    'Prazo cumprido: Impugnação',
    'Tarefa concluída: Certidão FGTS',
    'Mudou para Montando proposta',
    'Processo criado a partir do Boletim / Funil',
  ]);
  assert.deepEqual(ev.slice(0, 2).map((e) => e.situacao), ['futuro', 'atrasado']);
  assert.equal(ev[2].detalhe, 'Motivo da perda: Preço acima do vencedor');
  assert.equal(ev[2].soData, true);
  assert.equal(ev[9].detalhe, 'Antes: Triagem');
  assert.equal(ev.at(-1).detalhe, 'Etapa inicial: Triagem');
  assert.equal(ev[8].detalhe, 'Documentos · por Ana');
});

test('sem histórico gravado (antes do SQL): só "entrou na etapa atual", sem inventar o passado', () => {
  const ev = LT.montarEventos({ ...P, tarefas_card: null, data_resultado: null, situacao_resultado: 'nao_apurado', data_sessao: null }, { rotuloStatus }, AGORA);
  assert.deepEqual(ev.map((e) => e.titulo), ['Entrou na etapa atual: Perdido', 'Resultado: Perdido', 'Processo criado a partir do Boletim / Funil']);
  assert.equal(ev[1].quando, Date.parse(P.etapa_desde), 'perda datada pela entrada na etapa');
  assert.match(ev[0].detalhe, /não foram registradas/);
  const mesmo = LT.montarEventos({ id: 'p2', criado_em: '2026-11-01T13:00:00Z', etapa_desde: '2026-11-01T13:00:20Z', status: 'triagem' }, {}, AGORA);
  assert.equal(mesmo.length, 1, 'etapa_desde igual à criação não duplica');
});

test('vitória mostra o valor homologado; sessão futura é "Próximo"; data inválida é ignorada', () => {
  const ev = LT.montarEventos({ id: 'p3', criado_em: 'lixo', status: 'homologado', situacao_resultado: 'vitoria_total', valor_homologado: 1234.5,
    data_resultado: '2026-11-22', data_sessao: '2026-12-01T13:00:00Z' }, {}, AGORA);
  assert.deepEqual(ev.map((e) => [e.titulo, e.situacao]), [['Sessão marcada', 'futuro'], ['Resultado: Vitória total', null]]);
  assert.match(ev[1].detalhe, /R\$\s?1\.234,50/);
  assert.equal(ev[1].icone, 'resultado');
});

test('horário de Brasília no texto e HTML escapado, com "mostrar tudo"', () => {
  assert.equal(LT.quandoTexto({ quando: Date.parse('2026-11-18T14:30:00Z'), soData: false }), '18/11/2026 às 11:30');
  assert.equal(LT.quandoTexto({ quando: LT.instante('2026-11-21'), soData: true }), '21/11/2026');
  const ev = Array.from({ length: 10 }, (_, i) => ({ tipo: 'ocorrencia', icone: 'ocorrencia', titulo: `<b>${i}</b>`, detalhe: '', situacao: i ? null : 'atrasado', quando: AGORA - i * 1000, soData: false }));
  const h = LT.html(ev, { esc, limite: 8 });
  assert.equal((h.match(/<li /g) || []).length, 8);
  assert.match(h, /Mostrar tudo \(10\)/);
  assert.match(h, /lt-atrasado[\s\S]*Atrasado/, 'situação também em texto');
  assert.doesNotMatch(h, /<b>0<\/b>/);
  assert.equal((LT.html(ev, { esc, todos: true }).match(/<li /g) || []).length, 10);
  assert.match(LT.html([], { esc }), /Nada registrado ainda/);
});
