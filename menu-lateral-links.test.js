'use strict';
// Todas as páginas com menu lateral precisam trazer os mesmos itens, na mesma ordem (Prospecção, Orçamento de obra, Hoje,
// Processos, Calendário, Licitação anterior, Extensão e Consultoria incluídos).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const paginas = ['painel', 'sistema', 'operacao', 'processos', 'prospeccao', 'bdi', 'sinapi', 'quadros', 'mao-de-obra', 'orcamento-obra'];

for (const p of paginas) {
  test(`menu lateral de ${p}.html tem Prospecção e Orçamento de obra (sem SINAPI, BDI e Mão de obra)`, () => {
    const html = fs.readFileSync(`${p}.html`, 'utf8');
    const nav = html.match(/<nav id="menu-principal"[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /<a href="prospeccao\.html"[^>]*>[\s\S]*?Prospecção/);
    // 23/11 (dono): SINAPI, BDI e Mão de obra saem do menu lateral e ficam dentro da tela do Orçamento de obra (obra-abas.css).
    assert.match(nav, /<a href="orcamento-obra\.html"[^>]*>[\s\S]*?ph-toolbox[\s\S]*?Orçamento de obra/);
    assert.doesNotMatch(nav, /nav-sub|href="(sinapi|bdi|mao-de-obra)\.html"/, 'SINAPI, BDI e Mão de obra fora do menu lateral');
    assert.ok(nav.indexOf('Inteligência de Mercado') < nav.indexOf('Prospecção'), 'Prospecção logo após Inteligência de Mercado');
    // Consultoria abre o site da HC em nova aba: hc.html enquanto LICITAPLENA_HC_SITE estiver vazia (ajuda-ui.js troca o href).
    assert.ok(nav.includes('<a href="hc.html" target="_blank" rel="noopener" data-hc-site title="Consultoria">'), 'Consultoria');
    assert.match(html, /<script src="supabase-config\.js"><\/script>/);
    assert.match(html, /<script src="ajuda-ui\.js"/);
    // As ferramentas de obra (e a própria tela) marcam o Orçamento de obra como item ativo.
    const ativos = { prospeccao: 'prospeccao.html', bdi: 'orcamento-obra.html', sinapi: 'orcamento-obra.html', 'mao-de-obra': 'orcamento-obra.html', 'orcamento-obra': 'orcamento-obra.html' };
    if (ativos[p]) assert.ok(nav.includes(`<a href="${ativos[p]}" class="ativo" aria-current="page"`), `${p}: ${ativos[p]} ativo`);
    else assert.doesNotMatch(nav, /href="(prospeccao|orcamento-obra)\.html" class="ativo"/);
    if (['bdi', 'sinapi', 'mao-de-obra', 'orcamento-obra'].includes(p)) {
      const barra = html.match(/<nav class="abas-obra"[\s\S]*?<\/nav>/)?.[0] || '';
      for (const h of ['sinapi.html', 'bdi.html', 'mao-de-obra.html']) assert.ok(barra.includes(`<a href="${h}"`), `${p}: atalho ${h} na barra do Orçamento de obra`);
      if (p !== 'orcamento-obra') {
        assert.ok(barra.includes('<a href="orcamento-obra.html">Montar meu orçamento</a>') && barra.includes('<a href="orcamento-obra.html#concorrente">Analisar concorrente</a>'), `${p}: volta ao Orçamento de obra`);
        assert.ok(barra.includes(`<a href="${p}.html" aria-current="page">`), `${p}: ferramenta atual marcada`);
      }
      assert.match(html, /<link rel="stylesheet" href="obra-abas\.css">/);
    }
  });
}

const rotulos = (p) => {
  const nav = fs.readFileSync(`${p}.html`, 'utf8').match(/<nav id="menu-principal"[\s\S]*?<\/nav>/)[0];
  return [...nav.matchAll(/<span class="nav-label">([^<]+)<\/span>/g)].map((m) => m[1]).filter((r) => r !== 'Recolher');
};

test('todas as páginas têm o mesmo conjunto e ordem de itens no menu (o painel só soma o Dashboard)', () => {
  const referencia = rotulos('sistema');
  for (const item of ['Hoje', 'Licitação anterior', 'Processos', 'Extensão', 'Orçamento de obra', 'Consultoria']) assert.ok(referencia.includes(item), item);
  // 23/11 (dono): Calendário abria a mesma tela do Boletim; sai do menu (o link antigo painel.html#calendario continua abrindo o Boletim).
  assert.ok(!referencia.includes('Calendário'), 'menu sem Calendário duplicado');
  for (const p of paginas) {
    const lista = rotulos(p).filter((r) => r !== 'Dashboard');
    // Status das Ferramentas é controle interno desde 23/11: fica só na aba Saúde do sistema do admin.
    assert.ok(!lista.some((r) => /^Status/.test(r)), `${p}: menu do cliente sem Status`);
    assert.deepEqual(lista, referencia, p);
  }
});

test('painel leva Hoje, Processos e Extensão para as páginas certas e Calendário/Licitação anterior para atalhos do próprio painel', () => {
  const nav = fs.readFileSync('painel.html', 'utf8').match(/<nav id="menu-principal"[\s\S]*?<\/nav>/)[0];
  for (const [href, rotulo] of [['/sistema', 'Hoje'], ['processos.html', 'Processos'], ['extensao.html', 'Extensão'], ['#licitacao-anterior', 'Licitação anterior']]) {
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
