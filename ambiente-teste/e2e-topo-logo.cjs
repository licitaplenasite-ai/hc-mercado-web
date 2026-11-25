/* global document, localStorage, getComputedStyle -- usados só dentro de p.evaluate (navegador) */
// E2E 25/11 (dono): topo do celular numa linha só (ícone de menu, logo, botão da conta com ajuda/celular/tema/sino/Sair)
// e a mesma logo do site público em todos os topos internos. Mede altura do topo e se algo quebrou linha, em 320, 375,
// 390, 430 e 1366 px, claro e escuro, nas telas abertas sozinhas (link do e-mail) e na casca. Prints em PRINTS.
//   SITE_TESTE=http://127.0.0.1:8861 node ambiente-teste/e2e-topo-logo.cjs
const path = require('node:path'), fs = require('node:fs');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-topo-logo';
const { passo, exigir, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const pw = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const TELAS = ['prospeccao', 'painel', 'sistema', 'orgao', 'quadros', 'orcamento-obra'];
const LARGURAS = [320, 375, 390, 430, 1366];

// Topo visível: altura, quantas "linhas" (tops distintos dos itens visíveis) e a logo (tamanho e peso do nome).
const medirTopo = (alvo) => alvo.evaluate(() => {
  const h = document.querySelector('header');
  const vis = [...h.querySelectorAll('button, a, select, .header-badge')].filter((el) => {
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.topo-conta-menu, #header-user-dropdown');
  });
  const linhas = new Set(vis.map((el) => { const r = el.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2 / 12); }));
  const img = h.querySelector('img[src*="logo"]');
  const nome = img && img.closest('a');
  // Logo de fato à vista: o nome não pode estar espremido nem coberto pelo botão da conta.
  const nomeR = img && img.closest('a') ? img.closest('a').getBoundingClientRect() : { width: 0, right: 0 };
  const contaEl = [...h.querySelectorAll('#topo-conta-btn, #header-user-btn')].find((el) => el.getBoundingClientRect().width > 0);
  const contaR = contaEl ? contaEl.getBoundingClientRect() : { left: 1e9 };
  return { altura: Math.round(h.getBoundingClientRect().height), linhas: linhas.size, nomeLargura: Math.round(nomeR.width), sobrepoe: nomeR.right > contaR.left + 1, logo: img ? Math.round(img.getBoundingClientRect().width) : 0,
    peso: nome ? getComputedStyle(nome.querySelector('.header-nome') || nome).fontWeight : '', larguraDoc: document.documentElement.scrollWidth, janela: document.documentElement.clientWidth };
});

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const nav = await pw.chromium.launch({ channel: 'msedge', headless: process.env.VER !== '1' });
  const tabela = [];
  try {
    for (const tema of ['claro', 'escuro']) {
      for (const w of LARGURAS) {
        const ctx = await nav.newContext({ viewport: { width: w, height: w < 800 ? 760 : 820 }, isMobile: w < 800, hasTouch: w < 800, locale: 'pt-BR' });
        const p = await ctx.newPage();
        await p.goto(SITE + '/login.html');
        await p.evaluate((t) => localStorage.setItem('licitaplena_tema', t === 'escuro' ? 'escuro' : 'claro'), tema);
        await p.fill('#email', seed.usuarios.gestor.email); await p.fill('#senha', seed.usuarios.gestor.senha);
        await p.click('#btn-entrar');
        await p.waitForURL((u) => !/login/.test(u.pathname), { timeout: 30000 });
        for (const t of TELAS) {
          await passo(`${t} sozinha ${w}px ${tema}: topo numa linha, logo igual à do site`, p, async () => {
            await p.goto(SITE + '/' + t + '.html');
            await p.waitForFunction(() => document.documentElement.style.visibility !== 'hidden' && document.querySelector('header'), null, { timeout: 30000 });
            await p.waitForTimeout(1200); // ajuda e celular entram no topo depois (defer)
            const m = await medirTopo(p);
            tabela.push({ tela: t, onde: 'sozinha', largura: w, tema, ...m });
            await p.screenshot({ path: path.join(PRINTS, `${t}-${w}-${tema}.png`), clip: { x: 0, y: 0, width: w, height: Math.min(260, m.altura + 200) } });
            exigir(m.logo === 28 && m.nomeLargura >= 110 && !m.sobrepoe, 'logo ' + JSON.stringify(m));
            exigir(m.larguraDoc <= m.janela + 1, `página mais larga que a tela: ${m.larguraDoc} > ${m.janela}`);
            if (w <= 430) {
              exigir(m.linhas === 1 && m.altura <= 64, JSON.stringify(m));
              // Menu da conta abre com as ações (no painel: o menu da conta dele).
              const botao = t === 'painel' ? '#header-user-btn' : '#topo-conta-btn';
              await p.click(botao);
              const lista = t === 'painel' ? '#header-user-dropdown' : '#topo-conta-menu';
              await p.waitForSelector(lista, { state: 'visible', timeout: 5000 });
              await p.screenshot({ path: path.join(PRINTS, `${t}-${w}-${tema}-conta.png`) });
              const itens = await p.$$eval(`${lista} > *`, (els) => els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => (e.textContent.trim() || e.getAttribute('data-rotulo') || e.getAttribute('aria-label') || e.id).slice(0, 30)));
              await p.keyboard.press('Escape'); await p.mouse.click(5, 300);
              return JSON.stringify(m) + ' conta: ' + itens.join(' / ');
            }
            exigir(m.altura === 57, 'topo do computador com altura diferente do painel (57): ' + m.altura); // na casca o conteúdo não pula entre telas
            return JSON.stringify(m);
          });
        }
        if (w === 375 || w === 1366) {
          await passo(`casca ${w}px ${tema}: topo da tela e menu da casca`, p, async () => {
            await p.goto(SITE + '/app#/prospeccao');
            const f = await (await p.waitForSelector('.casca-tela.ativa')).contentFrame();
            await f.waitForFunction(() => document.documentElement.style.visibility !== 'hidden', null, { timeout: 30000 });
            await p.waitForTimeout(1200);
            const m = await medirTopo(f);
            tabela.push({ tela: 'prospeccao', onde: 'casca', largura: w, tema, ...m });
            await p.screenshot({ path: path.join(PRINTS, `casca-${w}-${tema}.png`) });
            if (w === 375) {
              exigir(m.linhas === 1 && m.altura <= 64, JSON.stringify(m));
              await f.click('#nav-gaveta-btn'); await p.waitForSelector('#casca-menu.gaveta-aberta');
              await p.screenshot({ path: path.join(PRINTS, `casca-${w}-${tema}-gaveta.png`) });
              await p.click('#casca-gaveta-fundo', { position: { x: w - 20, y: 400 } });
            }
            return JSON.stringify(m);
          });
        }
        await ctx.close();
      }
    }
    // Referência: o topo do site público (mesma logo).
    const ctx = await nav.newContext({ viewport: { width: 375, height: 760 } });
    const p = await ctx.newPage();
    await p.goto(SITE + '/index.html');
    await p.screenshot({ path: path.join(PRINTS, 'site-publico-375-referencia.png'), clip: { x: 0, y: 0, width: 375, height: 120 } });
    await ctx.close();
  } finally {
    await nav.close();
  }
  fs.writeFileSync(path.join(PRINTS, 'medicoes-topo.json'), JSON.stringify(tabela, null, 1));
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(falhas ? `${falhas} passo(s) com falha` : 'tudo certo');
  process.exitCode = falhas ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
