'use strict';
// 24/11 (dono, falha grave): a calculadora de BDI abria sem login e era linkada pelo site público. Regras que este teste
// garante: (1) toda tela do sistema carrega trava-sessao.js no <head>, depois do supabase-js e do supabase-config.js;
// (2) nenhuma página pública linka para tela interna (quem quiser ver o sistema faz cadastro e usa o teste de 14 dias).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const INTERNAS = ['painel', 'sistema', 'processos', 'operacao', 'quadros', 'prospeccao', 'orcamento-obra', 'sinapi',
  'mao-de-obra', 'bdi', 'normas-obra', 'resumo-processo', 'assinar', 'ajuda'];

for (const p of INTERNAS) {
  test(`${p}.html tem a trava de sessão no head, depois do Supabase`, () => {
    const html = fs.readFileSync(`${p}.html`, 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const umd = head.indexOf('supabase-js@'), cfg = head.indexOf('supabase-config.js'), trava = head.indexOf('trava-sessao.js');
    assert.ok(umd > -1 && cfg > umd && trava > cfg, `${p}: ordem supabase-js -> supabase-config -> trava-sessao`);
    assert.doesNotMatch(head.slice(trava - 40, trava + 60), /defer|async/, `${p}: trava sem defer/async`);
    assert.match(head, /name="robots" content="noindex/, `${p}: noindex`);
  });
}

test('assinar.html exige só sessão (conta ainda não aprovada paga)', () => {
  assert.match(fs.readFileSync('assinar.html', 'utf8'), /<script src="trava-sessao\.js" data-exige="sessao"><\/script>/);
});

test('nenhuma página pública linka para tela interna', () => {
  const publicas = ['index.html', 'sobre.html', 'contato.html', 'glossario.html', '404.html', 'cadastro.html', 'extensao.html',
    'termos-de-uso.html', 'politica-privacidade.html', 'politica-cookies.html', 'assessoria-hc.html'];
  for (const pasta of ['blog', 'blog/categoria', 'ferramentas', 'para']) {
    if (fs.existsSync(pasta)) for (const f of fs.readdirSync(pasta)) if (f.endsWith('.html')) publicas.push(path.join(pasta, f));
  }
  const interna = new RegExp(`href="/?(${INTERNAS.concat(['admin', 'cliente', 'responder-oportunidade']).join('|')})(\\.html)?(["#?/])`);
  for (const f of publicas.filter((x) => fs.existsSync(x))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), interna, `${f} linka tela interna`);
  }
});

test('sitemap não lista telas internas e robots bloqueia /bdi', () => {
  const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
  for (const p of INTERNAS) assert.doesNotMatch(sitemap, new RegExp(`/${p}<`), `sitemap com /${p}`);
  assert.match(fs.readFileSync('robots.txt', 'utf8'), /Disallow: \/bdi/);
});
