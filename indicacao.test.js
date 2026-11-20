'use strict';
// Regras do navegador do "Indique e ganhe" (indicacao.js): primeiro clique vale, código vencido é trocado,
// somas da tela e saque mínimo. As regras de dinheiro ficam no banco (supabase/testar_indicacoes.sql).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const I = require('./indicacao.js');

const DIA = 86400000, agora = Date.parse('2026-11-20T12:00:00Z');

test('primeiro clique vale: outro código depois não troca o guardado', () => {
  const g = I.escolherIndicacao(null, 'ab12cd34', agora);
  assert.deepEqual(g, { codigo: 'AB12CD34', em: '2026-11-20T12:00:00.000Z' });
  assert.strictEqual(I.escolherIndicacao(g, 'ZZZZ9999', agora + 10 * DIA), g);
});

test('código guardado vencido é trocado pelo novo clique; sem clique novo, some', () => {
  const velho = { codigo: 'AB12CD34', em: new Date(agora - (I.DIAS_LINK + 1) * DIA).toISOString() };
  assert.deepEqual(I.escolherIndicacao(velho, 'NOVO1234', agora), { codigo: 'NOVO1234', em: new Date(agora).toISOString() });
  assert.strictEqual(I.escolherIndicacao(velho, null, agora), null);
});

test('código inválido na URL é ignorado (tamanho, símbolos, vazio)', () => {
  for (const c of ['', 'abc', 'AB12CD34EF567', 'AB12<script>', 'AB 12CD']) assert.strictEqual(I.escolherIndicacao(null, c, agora), null, c);
  assert.strictEqual(I.escolherIndicacao({ codigo: 'AB12CD34', em: 'lixo' }, null, agora), null);
});

test('link e convite do WhatsApp', () => {
  assert.strictEqual(I.linkIndicacao('ab12cd34'), 'https://licitaplena.com.br/?ind=AB12CD34');
  assert.match(I.textoConvite('L', 10, 1), /ganhe 10% de desconto na 1ª mensalidade: L$/);
  assert.match(I.textoConvite('L', 12.5, 3), /12,5% de desconto nas 3 primeiras mensalidades/);
  assert.doesNotMatch(I.textoConvite('L', 0, 1), /desconto/);
  assert.strictEqual(I.linkWhatsApp('a b&c'), 'https://wa.me/?text=a%20b%26c');
});

test('resumo das comissões e saque mínimo', () => {
  const lista = [
    { situacao: 'pendente', valor_centavos: 4470 }, { situacao: 'liberada', valor_centavos: 3000 },
    { situacao: 'liberada', valor_centavos: 2000, saque_pedido_em: '2026-11-19' }, { situacao: 'paga', valor_centavos: 100 },
    { situacao: 'cancelada', valor_centavos: 999 },
  ];
  const t = I.resumirComissoes(lista, 5000);
  assert.deepEqual([t.pendente, t.liberada, t.paga, t.liberadaSemPedido, t.podePedirSaque], [4470, 5000, 100, 3000, false]);
  assert.strictEqual(I.resumirComissoes(lista, 3000).podePedirSaque, true);
  assert.strictEqual(I.resumirComissoes([], 0).podePedirSaque, false);
});

test('cadastro e página inicial carregam a captura; cadastro manda o código no metadado e limpa depois', () => {
  for (const p of ['index.html', 'cadastro.html']) assert.match(fs.readFileSync(p, 'utf8'), /<script src="indicacao\.js"><\/script>/, p);
  const cad = fs.readFileSync('cadastro.html', 'utf8');
  assert.match(cad, /\.\.\.LicitaPlenaIndicacao\.dadosParaCadastro\(Date\.now\(\)\)/);
  assert.match(cad, /LicitaPlenaIndicacao\.esquecer\(\)/);
});
