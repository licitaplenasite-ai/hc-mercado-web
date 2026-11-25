'use strict';
// Casca única (25/11): rotas da casca, destino das navegações de dentro das telas e descarte da tela mais antiga.
/* global URL -- global do Node */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('./casca.js');

const O = 'https://licitaplena.com.br';
const url = (h) => new URL(h, O);

test('telaDe: caminho limpo, .html e raiz; pasta não é tela', () => {
  assert.equal(C.telaDe('/painel'), 'painel');
  assert.equal(C.telaDe('/orcamento-obra.html'), 'orcamento-obra');
  assert.equal(C.telaDe('/'), 'index');
  assert.equal(C.telaDe('/blog/x'), '');
});

test('rota da casca guarda parâmetros e seção da tela', () => {
  assert.equal(C.rotaDe(url('/painel.html?edicao=2026-11-24&filtro=principal#boletim')), 'painel?edicao=2026-11-24&filtro=principal#boletim');
  const u = C.urlDaRota('painel?empresa=1&processo=2#kanban', O);
  assert.equal(u.pathname + u.search + u.hash, '/painel?empresa=1&processo=2#kanban');
  assert.equal(C.urlDaRota('#/processos', O).pathname, '/processos');
});

test('rota nunca vira outro site nem página fora do sistema', () => {
  assert.equal(C.urlDaRota('//outro.site/painel', O), null);
  assert.equal(C.urlDaRota('/\\outro.site', O), null);
  assert.equal(C.urlDaRota('login', O), null);
  assert.equal(C.urlDaRota('termos-de-uso', O), null);
  assert.equal(C.urlDaRota('', O), null);
});

test('destino: outra tela vai para a casca; mesma tela, arquivo e /api seguem no iframe; resto sai', () => {
  assert.equal(C.destinoDe(url('/orgao.html?cnpj=1'), 'processos', O), 'tela');
  assert.equal(C.destinoDe(url('/orgao.html?cnpj=1'), 'orgao', O), null);
  assert.equal(C.destinoDe(url('/api/pncp-baixar?x=1'), 'painel', O), null);
  assert.equal(C.destinoDe(url('/extensao/lp.zip'), 'painel', O), null);
  assert.equal(C.destinoDe(url('/login.html'), 'painel', O), 'sair');
  assert.equal(C.destinoDe(url('/termos-de-uso.html'), 'painel', O), 'sair');
  assert.equal(C.destinoDe(new URL('https://pncp.gov.br/x'), 'painel', O), 'sair');
  assert.equal(C.destinoDe(new URL('mailto:a@b.c'), 'painel', O), null);
});

test('saída para o login volta para a mesma tela dentro da casca', () => {
  const s = new URL(C.saidaDe(url('/login.html?voltar=%2Fpainel.html%3Fedicao%3D1%23boletim'), O));
  assert.equal(s.searchParams.get('voltar'), '/app#/painel?edicao=1#boletim');
  assert.equal(new URL(C.saidaDe(url('/login.html?voltar=//mal.site'), O)).searchParams.get('voltar'), '//mal.site'); // o login recusa
  assert.equal(C.saidaDe(url('/termos-de-uso.html'), O), O + '/termos-de-uso.html');
});

test('descarta a tela usada há mais tempo, nunca a visível nem a pedida', () => {
  const a = { usadaEm: 1 }, b = { usadaEm: 2 }, c = { usadaEm: 3 };
  assert.equal(C.maisAntiga([a, b, c], []), a);
  assert.equal(C.maisAntiga([a, b, c], [a]), b);
  assert.equal(C.maisAntiga([a], [a]), null);
  assert.equal(C.MAX_VIVAS, 8);
});

test('tela com alteração não salva nunca é descartada (a casca passa de 8 se preciso)', () => {
  const a = { usadaEm: 1, sujo: true }, b = { usadaEm: 2 }, c = { usadaEm: 3, sujo: true };
  const sujo = (t) => t.sujo === true;
  assert.equal(C.maisAntiga([a, b, c], [], sujo), b);
  assert.equal(C.maisAntiga([a, b, c], [b], sujo), null);
  assert.equal(C.maisAntiga([a, c], [], sujo), null);
});

test('app.html carrega a trava e a casca, e o _headers só libera moldura do mesmo site para as telas', () => {
  const html = fs.readFileSync('app.html', 'utf8');
  assert.match(html, /<script src="trava-sessao\.js"><\/script>/);
  assert.match(html, /<script src="casca\.js"><\/script>/);
  const h = fs.readFileSync('_headers', 'utf8').replace(/\r/g, '');
  for (const t of C.TELAS) {
    const bloco = h.split(/\n(?=\S)/).find((b) => b.startsWith(`/${t}*\n`));
    assert.ok(bloco, t);
    assert.match(bloco, /X-Frame-Options: SAMEORIGIN/);
    assert.match(bloco, /frame-ancestors 'self'$/m);
  }
  assert.doesNotMatch(h, /frame-ancestors \*|ALLOW-FROM/);
  assert.ok(!h.split(/\n(?=\S)/).some((b) => /^\/(app|index|login)/.test(b)), 'casca e públicas continuam DENY');
});
