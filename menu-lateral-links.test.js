'use strict';
// Todas as páginas com menu lateral precisam trazer os mesmos itens, na mesma ordem (Prospecção, BDI, SINAPI, Hoje,
// Processos, Calendário, Licitação anterior e Extensão incluídos).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const paginas = ['painel', 'sistema', 'operacao', 'processos', 'prospeccao', 'bdi', 'sinapi'];

for (const p of paginas) {
  test(`menu lateral de ${p}.html tem Prospecção e Calculadora de BDI`, () => {
    const html = fs.readFileSync(`${p}.html`, 'utf8');
    const nav = html.match(/<nav id="menu-principal"[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /<a href="prospeccao\.html"[^>]*>[\s\S]*?Prospecção/);
    assert.match(nav, /<a href="bdi\.html"[^>]*>[\s\S]*?Calculadora de BDI/);
    assert.match(nav, /<a href="sinapi\.html"[^>]*>[\s\S]*?Preços SINAPI/);
    assert.ok(nav.indexOf('Calculadora de BDI') < nav.indexOf('Preços SINAPI'), 'SINAPI logo após BDI');
    assert.ok(nav.indexOf('Inteligência de Mercado') < nav.indexOf('Prospecção'), 'Prospecção logo após Inteligência de Mercado');
    const ativos = { prospeccao: 'prospeccao.html', bdi: 'bdi.html', sinapi: 'sinapi.html' };
    if (ativos[p]) assert.match(nav, new RegExp(`<a href="${ativos[p]}" class="ativo"`));
    else assert.doesNotMatch(nav, /href="(prospeccao|bdi|sinapi)\.html" class="ativo"/);
  });
}

const rotulos = (p) => {
  const nav = fs.readFileSync(`${p}.html`, 'utf8').match(/<nav id="menu-principal"[\s\S]*?<\/nav>/)[0];
  return [...nav.matchAll(/<span class="nav-label">([^<]+)<\/span>/g)].map((m) => m[1]).filter((r) => r !== 'Recolher');
};

test('todas as páginas têm o mesmo conjunto e ordem de itens no menu (o painel só soma o Dashboard)', () => {
  const referencia = rotulos('sistema');
  for (const item of ['Hoje', 'Calendário', 'Licitação anterior', 'Processos', 'Extensão']) assert.ok(referencia.includes(item), item);
  for (const p of paginas) {
    const lista = rotulos(p).filter((r) => r !== 'Dashboard').map((r) => (r === 'Status das Ferramentas' ? 'Status' : r));
    assert.deepEqual(lista, referencia, p);
  }
});

test('painel leva Hoje, Processos e Extensão para as páginas certas e Calendário/Licitação anterior para atalhos do próprio painel', () => {
  const nav = fs.readFileSync('painel.html', 'utf8').match(/<nav id="menu-principal"[\s\S]*?<\/nav>/)[0];
  for (const [href, rotulo] of [['/sistema', 'Hoje'], ['processos.html', 'Processos'], ['extensao.html', 'Extensão'], ['#calendario', 'Calendário'], ['#licitacao-anterior', 'Licitação anterior']]) {
    assert.ok(nav.includes(`<a href="${href}" title="${rotulo}">`), rotulo);
  }
  const html = fs.readFileSync('painel.html', 'utf8');
  assert.match(html, /ATALHOS_DO_HASH = \{ calendario: "boletim", "licitacao-anterior": "diagnostico" \}/);
  assert.match(html, /data-subaba="licitacao-anterior"/);
  assert.match(html, /id="bol-calendario"/);
});

test('ícones novos do menu existem nos dois sprites', () => {
  const sprite = fs.readFileSync('menu-icones.svg', 'utf8');
  const painel = fs.readFileSync('painel.html', 'utf8');
  for (const id of ['ph-calendar', 'ph-clock-counter-clockwise', 'ph-puzzle-piece']) {
    assert.match(sprite, new RegExp(`<symbol id="${id}"`), id);
    assert.match(painel, new RegExp(`<symbol id="${id}"`), id);
  }
});

test('extensao.html baixa o pacote da versão atual do manifesto', () => {
  const { version } = JSON.parse(fs.readFileSync('extensao-leitura/manifest.json', 'utf8'));
  const html = fs.readFileSync('extensao.html', 'utf8');
  assert.ok(html.includes(`<a class="btn-baixar" href="extensao/licitaplena-extensao-${version}.zip" download>Baixar a extensão (versão ${version})</a>`));
  assert.doesNotMatch(html, /Receba da equipe/);
  assert.match(fs.readFileSync('_headers', 'utf8'), /\/extensao\/\*\r?\n {2}Content-Type: application\/zip\r?\n {2}Content-Disposition: attachment/);
});
