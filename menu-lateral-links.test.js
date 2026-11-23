'use strict';
// Todas as páginas com menu lateral precisam trazer os mesmos itens, na mesma ordem (Prospecção, BDI, SINAPI, Hoje,
// Processos, Calendário, Licitação anterior, Extensão, Mão de obra e Consultoria incluídos).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const paginas = ['painel', 'sistema', 'operacao', 'processos', 'prospeccao', 'bdi', 'sinapi', 'quadros', 'mao-de-obra', 'orcamento-obra'];

for (const p of paginas) {
  test(`menu lateral de ${p}.html tem Prospecção e Calculadora de BDI`, () => {
    const html = fs.readFileSync(`${p}.html`, 'utf8');
    const nav = html.match(/<nav id="menu-principal"[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /<a href="prospeccao\.html"[^>]*>[\s\S]*?Prospecção/);
    assert.match(nav, /<a href="bdi\.html"[^>]*>[\s\S]*?Calculadora de BDI/);
    assert.match(nav, /<a href="sinapi\.html"[^>]*>[\s\S]*?Preços SINAPI/);
    assert.ok(nav.indexOf('Calculadora de BDI') < nav.indexOf('Preços SINAPI'), 'SINAPI logo após BDI');
    assert.ok(nav.indexOf('Inteligência de Mercado') < nav.indexOf('Prospecção'), 'Prospecção logo após Inteligência de Mercado');
    assert.match(nav, /<a href="mao-de-obra\.html"[^>]*>[\s\S]*?Mão de obra/);
    assert.ok(nav.indexOf('Preços SINAPI') < nav.indexOf('Mão de obra'), 'Mão de obra logo após SINAPI');
    // Orçamento de obra logo após SINAPI; no Essencial a própria tela mostra o aviso da trava (main data-recurso).
    assert.match(nav, /<a href="orcamento-obra\.html"[^>]*>[\s\S]*?ph-toolbox[\s\S]*?Orçamento de obra/);
    assert.ok(nav.indexOf('Preços SINAPI') < nav.indexOf('Orçamento de obra') && nav.indexOf('Orçamento de obra') < nav.indexOf('Mão de obra'), 'Orçamento de obra entre SINAPI e Mão de obra');
    // Consultoria abre o site da HC em nova aba: hc.html enquanto LICITAPLENA_HC_SITE estiver vazia (ajuda-ui.js troca o href).
    assert.ok(nav.includes('<a href="hc.html" target="_blank" rel="noopener" data-hc-site title="Consultoria">'), 'Consultoria');
    assert.match(html, /<script src="supabase-config\.js"><\/script>/);
    assert.match(html, /<script src="ajuda-ui\.js"/);
    const ativos = { prospeccao: 'prospeccao.html', bdi: 'bdi.html', sinapi: 'sinapi.html', 'mao-de-obra': 'mao-de-obra.html' };
    if (ativos[p]) assert.match(nav, new RegExp(`<a href="${ativos[p]}" class="ativo"`));
    else assert.doesNotMatch(nav, /href="(prospeccao|bdi|sinapi|mao-de-obra)\.html" class="ativo"/);
  });
}

const rotulos = (p) => {
  const nav = fs.readFileSync(`${p}.html`, 'utf8').match(/<nav id="menu-principal"[\s\S]*?<\/nav>/)[0];
  return [...nav.matchAll(/<span class="nav-label">([^<]+)<\/span>/g)].map((m) => m[1]).filter((r) => r !== 'Recolher');
};

test('todas as páginas têm o mesmo conjunto e ordem de itens no menu (o painel só soma o Dashboard)', () => {
  const referencia = rotulos('sistema');
  for (const item of ['Hoje', 'Calendário', 'Licitação anterior', 'Processos', 'Extensão', 'Mão de obra', 'Consultoria']) assert.ok(referencia.includes(item), item);
  for (const p of paginas) {
    const lista = rotulos(p).filter((r) => r !== 'Dashboard');
    // Status das Ferramentas é controle interno desde 23/11: fica só na aba Saúde do sistema do admin.
    assert.ok(!lista.some((r) => /^Status/.test(r)), `${p}: menu do cliente sem Status`);
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
  for (const id of ['ph-calendar', 'ph-clock-counter-clockwise', 'ph-puzzle-piece', 'ph-clipboard-text', 'ph-handshake', 'ph-toolbox']) {
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
