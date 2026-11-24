'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('./funil-exemplos-ui.js');

const ORG = '00000000-0000-4000-8000-000000000001', EMP = '00000000-0000-4000-8000-000000000011';
const AGORA = Date.parse('2026-11-24T15:00:00Z');

// Cliente falso do Supabase: guarda cada chamada (tabela, operação, linhas e filtros).
function sbFalso(resposta = {}) {
  const chamadas = [];
  const from = (tabela) => {
    const c = { tabela, filtros: [] };
    chamadas.push(c);
    const q = {
      insert(linhas) { c.op = 'insert'; c.linhas = linhas; return q; },
      delete() { c.op = 'delete'; return q; },
      select() { return q; },
      eq(col, v) { c.filtros.push([col, v]); return q; },
      then(ok, falha) {
        const r = resposta[tabela + ':' + c.op] || (c.op === 'insert' && tabela === 'operacao_processos'
          ? { data: c.linhas.map((l, i) => ({ id: 'id-' + i, origem_externa_id: l.origem_externa_id })), error: null } : { error: null });
        return Promise.resolve(r).then(ok, falha);
      },
    };
    return q;
  };
  return { from, chamadas };
}

test('exemplos: todos marcados, com prefixo, ID próprio (nunca do PNCP) e prazos no futuro quando em aberto', () => {
  const itens = X.montar(ORG, EMP, AGORA);
  assert.equal(itens.length, 4);
  for (const { processo } of itens) {
    assert.equal(processo.exemplo, true);
    assert.ok(processo.objeto.startsWith('[Exemplo] ') && processo.orgao.startsWith('[Exemplo] '));
    assert.match(processo.origem_externa_id, /^exemplo-\d$/);
    assert.equal(processo.organizacao_id, ORG);
    assert.equal(processo.empresa_id, EMP);
  }
  assert.equal(new Set(itens.map((i) => i.processo.origem_externa_id)).size, 4);
  for (const i of itens.filter((x) => x.prazoProposta)) assert.ok(Date.parse(i.prazoProposta) > AGORA);
  const tarefa = itens[0].processo.tarefas_card.secoes[0].tarefas[0];
  assert.match(tarefa.quando, /^2026-11-26T10:00$/);
  assert.ok(tarefa.titulo.startsWith('[Exemplo] '));
  assert.equal(itens[3].processo.data_resultado, '2026-11-22');
});

test('criar grava processos e o prazo de propostas de cada exemplo aberto', async () => {
  const sb = sbFalso();
  assert.equal(await X.criar(sb, ORG, EMP, AGORA), 4);
  const [proc, prazos] = sb.chamadas;
  assert.equal(proc.tabela, 'operacao_processos');
  assert.equal(prazos.tabela, 'operacao_prazos_processo');
  assert.equal(prazos.linhas.length, 2);
  assert.ok(prazos.linhas.every((p) => p.titulo === 'Prazo de propostas (Boletim)' && p.categoria === 'proposta' && /^id-\d$/.test(p.processo_id)));
});

test('criar repassa o erro do banco (ex.: teto de exemplos)', async () => {
  const sb = sbFalso({ 'operacao_processos:insert': { data: null, error: new Error('Esta conta já tem os exemplos') } });
  await assert.rejects(X.criar(sb, ORG, EMP, AGORA), /já tem os exemplos/);
  assert.equal(sb.chamadas.length, 1);
});

test('apagar só apaga linhas com exemplo = true da empresa', async () => {
  const sb = sbFalso();
  await X.apagar(sb, ORG, EMP);
  assert.equal(sb.chamadas[0].op, 'delete');
  assert.deepEqual(sb.chamadas[0].filtros, [['organizacao_id', ORG], ['empresa_id', EMP], ['exemplo', true]]);
});

test('faixa: convite só com o Funil vazio; "Apagar exemplos" enquanto houver exemplo; nada com processo real', () => {
  assert.equal(X.htmlFaixa(null), '');
  assert.match(X.htmlFaixa({ total: 0, exemplos: 0 }), /data-fx="criar"[^>]*>Ver o sistema com exemplos/);
  assert.match(X.htmlFaixa({ total: 5, exemplos: 4 }), /data-fx="apagar"[^>]*>Apagar exemplos/);
  assert.equal(X.htmlFaixa({ total: 2, exemplos: 0 }), '');
});
