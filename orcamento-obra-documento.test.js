'use strict';
// Documento do orçamento (v2): estado da tela <-> JSON guardado no navegador e na nuvem; migração do rascunho v1.
const test = require('node:test');
const assert = require('node:assert');
const D = require('./orcamento-obra-documento.js');
const UI = require('./orcamento-obra-ui.js');

const estado = () => ({ nomeArquivo: 'edital', abas: [{ nome: 'Orç', linhas: [['1']] }, { nome: 'Cronograma', linhas: [['x']] }],
  leitura: { aba: 'Orç', cabecalho: { objeto: 'Reforma da escola' }, itens: [{ item: '1', tipo: 'etapa' }, { item: '1.1', tipo: 'servico' }] },
  cpu: { bases: {} }, crono: null, manuais: { '1.1': { preco: 10 } }, cotacoes: {}, montado: true });

test('documento v2: só a aba lida, ids nos itens, ida e volta igual', () => {
  const d = D.documentoDoEstado(estado(), { 'l-uf': 'AM' }, new Date('2026-11-23T10:00:00Z'));
  assert.equal(d.versao, 2);
  assert.equal(d.salvoEm, '2026-11-23T10:00:00.000Z');
  assert.deepEqual(d.abas, [{ nome: 'Orç', linhas: [['1']] }]);
  assert.deepEqual(d.leitura.itens.map((i) => i.id), ['i1', 'i2']);
  const volta = D.lerDocumento(JSON.stringify(d));
  assert.deepEqual(volta, d, 'texto -> documento sem perda');
  assert.deepEqual(D.lerDocumento(d), d, 'objeto (jsonb) também serve');
  const e = D.estadoDoDocumento(volta);
  assert.deepEqual(e.manuais, { '1.1': { preco: 10 } });
  assert.equal(e.montado, true);
  assert.equal(e.orc, null);
});

test('id do item não muda ao salvar de novo; item novo ganha o próximo número livre', () => {
  const d = D.documentoDoEstado(estado(), {});
  const comNovo = { ...estado(), leitura: { ...d.leitura, itens: [d.leitura.itens[1], { item: '1.2', tipo: 'servico' }, d.leitura.itens[0]] } };
  const d2 = D.documentoDoEstado(comNovo, {});
  assert.deepEqual(d2.leitura.itens.map((i) => [i.item, i.id]), [['1.1', 'i2'], ['1.2', 'i3'], ['1', 'i1']]);
  assert.equal(estado().leitura.itens[0].id, undefined, 'não mexe no estado original');
});

test('rascunho v1 do navegador (antes da nuvem) vira v2 com ids e os mesmos dados', () => {
  const v1 = UI.montarRascunho(estado(), { 'b-iss': '2' }, new Date('2026-11-22T10:00:00Z'));
  const v1obj = JSON.parse(v1);
  delete v1obj.leitura.itens[0].id; delete v1obj.leitura.itens[1].id; v1obj.versao = 1; // como gravava o e0dfdf3
  const d = D.lerDocumento(JSON.stringify(v1obj));
  assert.equal(d.versao, 2);
  assert.deepEqual(d.leitura.itens.map((i) => i.id), ['i1', 'i2']);
  assert.deepEqual(d.campos, { 'b-iss': '2' });
  assert.equal(d.salvoEm, '2026-11-22T10:00:00.000Z');
  assert.equal(d.montado, true);
});

test('estragado, de versão desconhecida ou sem leitura: null', () => {
  for (const x of [null, '', '{quebrado', '[]', JSON.stringify({ versao: 3, leitura: { itens: [] }, abas: [], campos: {} }),
    { versao: 2, abas: [], campos: {} }, { versao: 2, leitura: { itens: 'x' }, abas: [], campos: {} }, { versao: 2, leitura: { itens: [] }, abas: [], campos: null }]) {
    assert.equal(D.lerDocumento(x), null, JSON.stringify(x));
  }
});

test('título da lista: arquivo, senão objeto, senão "sem nome"; até 200 letras', () => {
  assert.equal(D.tituloDoDocumento({ nomeArquivo: ' Planilha  SAI ' }), 'Planilha SAI');
  assert.equal(D.tituloDoDocumento({ leitura: { cabecalho: { objeto: 'Reforma' } } }), 'Reforma');
  assert.equal(D.tituloDoDocumento({}), 'Orçamento sem nome');
  assert.equal(D.tituloDoDocumento({ nomeArquivo: 'x'.repeat(300) }).length, 200);
  assert.equal(D.bytes({ a: 'ç' }), 10);
});
