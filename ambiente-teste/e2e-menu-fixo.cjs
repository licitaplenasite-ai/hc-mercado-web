/* global document, window, requestAnimationFrame, MutationObserver, getComputedStyle -- usados só dentro de p.evaluate (navegador) */
// E2E 25/11 (menu único da casca, dono: "menu lateral é FIXO, parado, igual ao Effecti"): percorre as 16 opções do menu
// várias vezes e mede que o menu e cada item ficam no MESMO lugar (getBoundingClientRect, diferença 0 px, inclusive durante
// as trocas, amostrado a cada quadro), que o item ativo é o certo, que nada no menu é redesenhado, que voltar/avançar
// seguem a ordem das telas, em 1366 e 375 px, claro/escuro e recolhido. Grava vídeo.
//   PORTA_TESTE=8861 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8861 node ambiente-teste/e2e-menu-fixo.cjs
const path = require('node:path'), fs = require('node:fs');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/video-velocidade/menu-fixo';
const { passo, exigir, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const pw = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const ROTAS = ['sistema', 'painel#dashboard', 'painel#boletim', 'painel#oportunidades', 'painel#diagnostico', 'prospeccao', 'painel#empresa',
  'orgao', 'painel#transparencia', 'painel#precos', 'orcamento-obra', 'painel#kanban', 'quadros', 'processos', 'operacao', 'painel#juridico'];
const medidas = {};

const naRota = (p, rota) => p.waitForFunction((rota) => {
  try {
    const [tela, secao] = rota.split('#');
    const fr = document.querySelector('.casca-tela.ativa');
    const w = fr && fr.contentWindow, d = fr && fr.contentDocument;
    if (!w || !d || !d.body || w.location.pathname.replace(/\.html$/, '') !== '/' + tela || d.documentElement.style.visibility === 'hidden') return false;
    return !secao || !!d.querySelector(`main section#${secao}.ativa`);
  } catch { return false; }
}, rota, { timeout: 45000 });

// Posição do menu, rolagem dele e caixa de cada item, em px inteiros da página.
const medir = (p) => p.evaluate(() => {
  const nav = document.getElementById('casca-menu');
  const caixa = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100); };
  return { nav: caixa(nav), rolagem: nav.scrollTop, itens: [...nav.querySelectorAll('a,button')].map(caixa), ativo: nav.querySelector('a.ativo')?.dataset.rota || null };
});
const diferenca = (a, b) => {
  let d = Math.abs(a.rolagem - b.rolagem);
  [a.nav, ...a.itens].forEach((c, i) => c.forEach((v, j) => { d = Math.max(d, Math.abs(v - [b.nav, ...b.itens][i][j])); }));
  return d;
};
// Vigia a cada quadro: qualquer mudança de lugar do menu/itens ou nó novo no menu durante o teste fica registrada.
const vigiar = (p) => p.evaluate(() => {
  const nav = document.getElementById('casca-menu');
  const foto = () => [nav.scrollTop, ...[nav, ...nav.querySelectorAll('a,button')].map((el) => { const r = el.getBoundingClientRect(); return r.left + ',' + r.top + ',' + r.width + ',' + r.height; })].join('|');
  window.__vigia = { base: foto(), quadros: 0, mexeu: 0, nos: 0 };
  new MutationObserver((ms) => { window.__vigia.nos += ms.filter((m) => m.type === 'childList').length; }).observe(nav, { childList: true, subtree: true });
  const laco = () => { window.__vigia.quadros++; if (foto() !== window.__vigia.base) window.__vigia.mexeu++; window.__vigiaLaco = requestAnimationFrame(laco); };
  laco();
});
const vigia = (p) => p.evaluate(() => window.__vigia);
const pararVigia = (p) => p.evaluate(() => { window.cancelAnimationFrame(window.__vigiaLaco); });

async function percorrer(p, voltas, rotulo, celular) {
  // No celular a base é a gaveta aberta (fechada ela fica fora da tela).
  let base = celular ? null : await medir(p);
  let pior = 0, n = 0;
  for (let v = 0; v < voltas; v++) {
    for (const rota of ROTAS) {
      if (await p.isVisible('#casca-aviso')) await p.click('#casca-aviso-fechar');
      if (celular) {
        await (await (await p.waitForSelector('.casca-tela.ativa')).contentFrame()).click('#nav-gaveta-btn');
        await p.waitForSelector('#casca-menu.gaveta-aberta');
        const aberta = await medir(p);
        if (!base) base = aberta;
        pior = Math.max(pior, diferenca(aberta, base));
      }
      await p.click(`#casca-menu a[data-rota="${rota}"]:not(.casca-marca)`);
      await naRota(p, rota);
      if (celular) {
        await p.waitForSelector('#casca-menu:not(.gaveta-aberta)', { state: 'attached' });
        exigir(await p.evaluate(() => document.getElementById('casca-gaveta-fundo').hidden), 'gaveta não fechou');
      } else {
        const m = await medir(p);
        pior = Math.max(pior, diferenca(m, base));
        exigir(m.ativo === rota, `ativo ${m.ativo} em ${rota}`);
      }
      const ativo = await p.evaluate(() => document.querySelector('#casca-menu a.ativo')?.dataset.rota);
      exigir(ativo === rota, `ativo ${ativo} em ${rota}`);
      // A tela dentro da casca não mostra o próprio menu e ocupa a área à direita do menu da casca.
      const tela = await p.evaluate(() => {
        const fr = document.querySelector('.casca-tela.ativa'), d = fr.contentDocument;
        const proprio = d.getElementById('menu-principal');
        const main = d.querySelector('main');
        // Sem a margem do menu antigo: o conteúdo começa na borda da tela ou fica centrado nela (telas com largura máxima).
        const r = main ? main.getBoundingClientRect() : { left: 0, right: fr.clientWidth };
        return { proprio: proprio ? getComputedStyle(proprio).display : 'sem', esquerda: fr.getBoundingClientRect().left, larguraMenu: document.getElementById('casca-menu').getBoundingClientRect().width, sobraEsq: Math.round(r.left), sobraDir: Math.round(d.documentElement.clientWidth - r.right) };
      });
      exigir(tela.proprio === 'none' || tela.proprio === 'sem', `${rota}: menu da tela aparece (${tela.proprio})`);
      if (!celular) exigir(Math.abs(tela.esquerda - tela.larguraMenu) < 1.01 && (tela.sobraEsq < 2 || Math.abs(tela.sobraEsq - tela.sobraDir) < 24), `${rota}: área da tela ${JSON.stringify(tela)}`);
      n++;
    }
  }
  medidas[rotulo] = { trocas: n, piorDiferencaPx: pior, menu: base.nav, itens: base.itens.length };
  exigir(pior === 0, `${rotulo}: o menu mexeu ${pior} px`);
  return `${n} trocas, maior diferença ${pior} px, menu ${base.nav.join('x')}`;
}

async function sequenciaVoltar(p) {
  // Seção para seção do painel no meio (Analisar concorrente -> Boletim -> Funil): antes o voltar pulava a seção.
  const seq = ['orgao', 'prospeccao', 'painel#empresa', 'painel#boletim', 'painel#kanban', 'quadros', 'painel#precos'];
  for (const r of seq) { await p.click(`#casca-menu a[data-rota="${r}"]:not(.casca-marca)`); await naRota(p, r); }
  const visto = [];
  for (let i = seq.length - 2; i >= 0; i--) {
    await p.goBack(); await naRota(p, seq[i]);
    const ativo = await p.evaluate(() => document.querySelector('#casca-menu a.ativo')?.dataset.rota);
    exigir(ativo === seq[i], `voltar: ativo ${ativo}, esperado ${seq[i]}`);
    visto.push(seq[i]);
  }
  for (let i = 1; i < 4; i++) { await p.goForward(); await naRota(p, seq[i]); visto.push('>' + seq[i]); }
  await p.goBack(); await naRota(p, seq[2]); await p.goBack(); await naRota(p, seq[1]);
  exigir(/#\/prospeccao$/.test(p.url()), p.url());
  return visto.join(' ');
}

async function entrar(p) {
  const u = seed.usuarios.gestor;
  await p.goto(SITE + '/app#/orgao');
  await p.waitForURL(/\/login/, { timeout: 20000 });
  await p.fill('#email', u.email); await p.fill('#senha', u.senha);
  await p.click('#btn-entrar');
  await p.waitForURL(/\/app(\.html)?#\/orgao/, { timeout: 30000 });
  await naRota(p, 'orgao');
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const nav = await pw.chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const erros = [];
  try {
    const ctx = await nav.newContext({ viewport: { width: 1366, height: 768 }, locale: 'pt-BR', recordVideo: { dir: PRINTS, size: { width: 1366, height: 768 } } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push(e.message));
    await passo('1366: entra pelo endereço direto (/app#/orgao) e Órgãos fica ativo', p, async () => {
      await entrar(p);
      const m = await medir(p);
      exigir(m.ativo === 'orgao', 'ativo ' + m.ativo);
      return JSON.stringify(m.nav);
    });
    await vigiar(p);
    await passo('1366 claro: 16 opções x 3 voltas, menu e itens no mesmo lugar e item ativo certo', p, () => percorrer(p, 3, '1366-claro'));
    await p.screenshot({ path: path.join(PRINTS, '1366-claro.png') });
    await passo('voltar/avançar: Órgãos -> Prospecção -> Analisar concorrente -> Boletim -> Quadros -> Preços e de volta', p, () => sequenciaVoltar(p));
    await passo('"← Voltar" da tela de Órgãos volta à tela de onde se veio (Analisar concorrente -> Prospecção -> Órgãos -> Voltar)', p, async () => {
      for (const r of ['painel#empresa', 'prospeccao', 'orgao']) { await p.click(`#casca-menu a[data-rota="${r}"]:not(.casca-marca)`); await naRota(p, r); }
      const f = await (await p.waitForSelector('.casca-tela.ativa')).contentFrame();
      await f.click('#fo-voltar');
      await naRota(p, 'prospeccao');
      exigir(await p.evaluate(() => document.querySelector('#casca-menu a.ativo')?.dataset.rota) === 'prospeccao', 'ativo errado');
      await p.goBack(); await naRota(p, 'painel#empresa');
      return p.url().replace(SITE, '') + ' depois do Voltar e do voltar do navegador';
    });
    await passo('tema escuro: 16 opções, menu parado', p, async () => {
      const f = await (await p.waitForSelector('.casca-tela.ativa')).contentFrame();
      await f.click('#header-tema-btn, #btn-tema, #tema');
      await p.waitForTimeout(300);
      exigir(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'casca não ficou escura');
      const r = await percorrer(p, 1, '1366-escuro');
      await p.screenshot({ path: path.join(PRINTS, '1366-escuro.png') });
      return r;
    });
    await passo('vigia a cada quadro: menu nunca mexeu e nenhum item foi redesenhado durante as trocas', p, async () => {
      const v = await vigia(p);
      exigir(v.mexeu === 0 && v.nos === 0, JSON.stringify(v));
      return JSON.stringify(v);
    });
    await passo('recolhido: 16 opções, trilho de ícones parado; lembrado ao recarregar', p, async () => {
      await p.click('#casca-recolher');
      await pararVigia(p); await vigiar(p); // recolher é a única mudança de largura, pedida pela pessoa
      const r = await percorrer(p, 1, '1366-recolhido');
      await p.screenshot({ path: path.join(PRINTS, '1366-recolhido.png') });
      await p.reload(); await naRota(p, 'painel#juridico');
      exigir(await p.evaluate(() => document.documentElement.classList.contains('menu-recolhido') && document.getElementById('casca-menu').getBoundingClientRect().width === 64), 'não lembrou');
      await p.click('#casca-recolher');
      return r;
    });
    const video1 = p.video();
    await ctx.close();
    fs.renameSync(await video1.path(), path.join(PRINTS, 'menu-fixo-1366.webm'));

    const ctx2 = await nav.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'pt-BR', recordVideo: { dir: PRINTS, size: { width: 375, height: 812 } } });
    const c = await ctx2.newPage();
    c.on('pageerror', (e) => erros.push(e.message));
    await passo('375: gaveta da casca aberta pelo botão Menu da tela, 16 opções, gaveta sempre no mesmo lugar', c, async () => {
      await entrar(c);
      const f = await (await c.waitForSelector('.casca-tela.ativa')).contentFrame();
      await f.click('#nav-gaveta-btn');
      await c.waitForSelector('#casca-menu.gaveta-aberta');
      await c.screenshot({ path: path.join(PRINTS, '375-gaveta.png') });
      await c.click('#casca-gaveta-fundo', { position: { x: 360, y: 400 } }); // fora da gaveta (o centro do fundo fica sob ela)
      await c.waitForSelector('#casca-menu:not(.gaveta-aberta)', { state: 'attached' });
      return percorrer(c, 2, '375', true);
    });
    await passo('375: voltar depois de escolher na gaveta volta à tela anterior (a gaveta não desfaz a troca)', c, async () => {
      await c.goBack(); await naRota(c, ROTAS[ROTAS.length - 2]);
      await c.goBack(); await naRota(c, ROTAS[ROTAS.length - 3]);
      return c.url().replace(SITE, '');
    });
    await passo('375: voltar com a gaveta aberta só fecha a gaveta', c, async () => {
      const f = await (await c.waitForSelector('.casca-tela.ativa')).contentFrame();
      await f.click('#nav-gaveta-btn');
      await c.waitForSelector('#casca-menu.gaveta-aberta');
      const antes = c.url();
      await c.goBack();
      await c.waitForSelector('#casca-menu:not(.gaveta-aberta)', { state: 'attached' });
      await naRota(c, ROTAS[ROTAS.length - 3]);
      exigir(c.url() === antes, c.url());
      return 'ok';
    });
    const video2 = c.video();
    await ctx2.close();
    fs.renameSync(await video2.path(), path.join(PRINTS, 'menu-fixo-375.webm'));
    await passo('sem erro de JavaScript', null, async () => { exigir(!erros.length, erros.join(' | ')); });
  } finally {
    await nav.close();
  }
  fs.writeFileSync(path.join(PRINTS, 'medicoes.json'), JSON.stringify(medidas, null, 2));
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(JSON.stringify(medidas));
  console.log(falhas ? `${falhas} passo(s) com falha` : 'tudo certo');
  process.exitCode = falhas ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
