/* global document, window, location, localStorage, getComputedStyle -- usados só dentro de p.evaluate (navegador) */
// E2E 25/11 (casca única, app.html): troca de tela pelo menu sem recarregar e voltando igual, links internos, endereço
// direto, voltar/avançar, tema, menu recolhido, aviso de dados de outra tela, impressão, título, sair e limite de telas.
//   PORTA_TESTE=8831 node ambiente-teste/servidor.cjs   (opcional: proxy que imita o Pages na frente, ex. :8832)
//   SITE_TESTE=http://127.0.0.1:8831 node ambiente-teste/e2e-casca.cjs        (NAVEGADOR=webkit: perfil do iPhone 13)
const path = require('node:path');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-casca';
const { passo, exigir, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const pw = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const IPHONE = process.env.NAVEGADOR === 'webkit';

const ativo = async (p) => (await p.waitForSelector('.casca-tela.ativa', { state: 'attached', timeout: 30000 })).contentFrame();
// Espera a casca mostrar a tela (e a seção do painel), com a página dela já liberada pela trava.
const naTela = (p, tela, secao) => p.waitForFunction(([tela, secao]) => {
  // Durante a troca o iframe pode estar entre documentos (sem documentElement/body ainda): conta como "ainda não".
  try {
    const fr = document.querySelector('.casca-tela.ativa');
    const w = fr && fr.contentWindow, d = fr && fr.contentDocument;
    if (!w || !d || !d.documentElement || !d.body || w.location.pathname.replace(/\.html$/, '') !== '/' + tela || d.documentElement.style.visibility === 'hidden') return false;
    return !secao || !!d.querySelector(`main section#${secao}.ativa`);
  } catch { return false; }
}, [tela, secao || null], { timeout: 30000 });
async function menu(p, titulo, tela, secao) {
  if (await p.isVisible('#casca-aviso')) await p.click('#casca-aviso-fechar'); // aviso legítimo de passo anterior (ex.: Abrir no Funil trocou a empresa)
  // Menu único (25/11): o menu é o da casca, fixo; no celular a gaveta dela abre pelo botão Menu do topo da tela.
  if (IPHONE) { await (await ativo(p)).click('#nav-gaveta-btn'); await p.waitForSelector('#casca-menu.gaveta-aberta'); }
  await p.locator(`#casca-menu a[title^="${titulo}"]:not(.casca-marca)`).first().click();
  await naTela(p, tela, secao);
}
// Pedidos de rede de verdade (fora do cache) durante fn, pela CDP no Chromium; no WebKit conta todos os pedidos.
async function contarRede(p, fn) {
  let n = 0;
  if (IPHONE) { const ouvir = (r) => { if (!/favicon/.test(r.url())) n++; }; p.on('request', ouvir); await fn(); await p.waitForTimeout(400); p.off('request', ouvir); return n; }
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Network.enable');
  const ids = new Map();
  cdp.on('Network.requestWillBeSent', (e) => { if (!/^data:|favicon/.test(e.request.url)) ids.set(e.requestId, e.request.url); });
  cdp.on('Network.requestServedFromCache', (e) => ids.delete(e.requestId));
  await fn();
  await p.waitForTimeout(400);
  await cdp.detach();
  n = ids.size;
  if (n && process.env.DEPURAR) console.log([...ids.values()]);
  return n;
}

async function main() {
  const u = seed.usuarios.gestor;
  const nav = IPHONE ? await pw.webkit.launch({ headless: process.env.VER !== '1' }) : await pw.chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const ctx = await nav.newContext({ ...(IPHONE ? pw.devices['iPhone 13'] : { viewport: { width: 1366, height: 900 } }), locale: 'pt-BR' });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  try {
    await passo('sem sessão, /app vai ao login guardando a tela; depois do login volta para a casca na tela', p, async () => {
      await p.goto(SITE + '/app#/processos');
      await p.waitForURL(/\/login/, { timeout: 20000 });
      const voltar = new URL(p.url()).searchParams.get('voltar');
      exigir(voltar === '/app#/processos', 'voltar: ' + voltar);
      await p.fill('#email', u.email); await p.fill('#senha', u.senha);
      await p.click('#btn-entrar');
      await p.waitForURL(/\/app(\.html)?#\/processos/, { timeout: 30000 });
      await naTela(p, 'processos');
      return voltar;
    });

    let rolagem = 0;
    await passo('Processos: filtro, aba e rolagem ficam iguais depois de ir a outra tela e voltar, sem pedidos', p, async () => {
      const f = await ativo(p);
      await f.waitForSelector('#busca');
      await p.waitForTimeout(2500); // a 1ª carga da lista ainda redesenha (e reancora a rolagem): espera assentar
      await f.fill('#busca', 'casca-e2e');
      await f.click('.aba[data-aba="prazos"]');
      await f.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 150); }); // lista curta no banco de teste: garante rolagem
      rolagem = await f.evaluate(() => window.scrollY);
      await menu(p, 'Órgãos', 'orgao');
      const o = await ativo(p);
      await o.waitForSelector('#fo-busca-termo');
      await o.fill('#fo-busca-termo', 'prefeitura');
      await p.waitForTimeout(1500); // a busca de órgãos espera a pessoa parar de digitar: deixa terminar antes de medir
      await menu(p, 'Processos', 'processos');
      await menu(p, 'Órgãos', 'orgao'); // 1ª vez aquecida
      const pedidos = await contarRede(p, () => menu(p, 'Processos', 'processos'));
      const g = await ativo(p);
      const estado = await g.evaluate(() => ({ busca: document.getElementById('busca').value, aba: document.querySelector('.aba.ativa')?.dataset.aba, y: window.scrollY }));
      exigir(estado.busca === 'casca-e2e' && estado.aba === 'prazos', 'estado: ' + JSON.stringify(estado));
      exigir(rolagem > 0 && Math.abs(estado.y - rolagem) < 5, `rolagem ${rolagem} -> ${estado.y}`);
      exigir(pedidos <= 1, 'pedidos na troca: ' + pedidos);
      await menu(p, 'Órgãos', 'orgao');
      exigir(await (await ativo(p)).inputValue('#fo-busca-termo') === 'prefeitura', 'Órgãos perdeu a busca');
      return `pedidos na volta: ${pedidos}; ${JSON.stringify(estado)}`;
    });

    await passo('painel: seção pelo menu, busca da Inteligência fica igual; título e anúncio acompanham', p, async () => {
      await menu(p, 'Inteligência de Mercado', 'painel', 'diagnostico');
      const f = await ativo(p);
      const campo = f.locator('#diagnostico input:not([type=hidden]):not([type=checkbox]):not([type=radio])').first();
      await campo.fill('cimento casca');
      await menu(p, 'Quadros', 'quadros');
      await menu(p, 'Inteligência de Mercado', 'painel', 'diagnostico');
      exigir(await (await ativo(p)).locator('#diagnostico input:not([type=hidden]):not([type=checkbox]):not([type=radio])').first().inputValue() === 'cimento casca', 'termo sumiu');
      const t = await p.evaluate(() => ({ titulo: document.title, anuncio: document.getElementById('casca-anuncio').textContent, hash: location.hash }));
      exigir(t.hash === '#/painel#diagnostico', 'hash: ' + t.hash);
      exigir(/LicitaPlena/.test(t.titulo) && /Painel/.test(t.anuncio), JSON.stringify(t));
      return JSON.stringify(t);
    });

    await passo('voltar e avançar do navegador trocam de tela pela casca', p, async () => {
      await p.goBack(); await naTela(p, 'quadros');
      await p.goBack(); await naTela(p, 'painel', 'diagnostico');
      await p.goForward(); await naTela(p, 'quadros');
      exigir(/#\/quadros/.test(p.url()), p.url());
      return p.url().replace(SITE, '');
    });

    await passo('voltar fecha o modal do painel sem trocar de tela', p, async () => {
      await menu(p, 'Funil', 'painel', 'kanban');
      const f = await ativo(p);
      await f.evaluate(() => document.getElementById('modal-lembrete-fundo').classList.add('aberto'));
      await p.waitForTimeout(100);
      await p.goBack();
      await f.waitForSelector('#modal-lembrete-fundo:not(.aberto)', { state: 'attached', timeout: 5000 });
      await naTela(p, 'painel', 'kanban');
      // fechar pelo ✕ (aqui: tirar a classe) desfaz a entrada, sem voltar uma tela da casca
      await f.evaluate(() => document.getElementById('modal-lembrete-fundo').classList.add('aberto'));
      await p.waitForTimeout(100);
      await f.evaluate(() => document.getElementById('modal-lembrete-fundo').classList.remove('aberto'));
      await p.waitForTimeout(400);
      await naTela(p, 'painel', 'kanban');
      return p.url().replace(SITE, '');
    });

    await passo('links internos: ficha do órgão, Abrir no Funil e navegação por script abrem a tela certa na casca', p, async () => {
      const casca0 = await p.evaluate(() => window.__casca === window.__casca && performance.timeOrigin);
      let f = await ativo(p);
      await f.evaluate(() => { const a = document.createElement('a'); a.href = 'orgao.html?cnpj=00394452000103'; a.id = 'lnk-e2e'; a.textContent = 'x'; document.body.append(a); });
      await f.click('#lnk-e2e');
      await naTela(p, 'orgao');
      exigir(/#\/orgao\?cnpj=00394452000103/.test(p.url()), 'ficha: ' + p.url());
      f = await ativo(p);
      await f.evaluate((e) => { const a = document.createElement('a'); a.href = `painel.html?empresa=${e}&processo=00000000-0000-4000-8000-000000000000#kanban`; a.id = 'lnk-e2e2'; a.textContent = 'y'; document.body.append(a); }, seed.ids.empA1);
      await f.click('#lnk-e2e2');
      await naTela(p, 'painel', 'kanban');
      exigir(/#\/painel\?empresa=.+#kanban/.test(p.url()), 'funil: ' + p.url());
      f = await ativo(p);
      await f.evaluate(() => { location.href = 'processos?origem=teste'; });
      await naTela(p, 'processos');
      exigir(/#\/processos\?origem=teste/.test(p.url()), 'script: ' + p.url());
      exigir(await p.evaluate(() => performance.timeOrigin) === casca0, 'a casca recarregou');
      return 'ok sem recarregar a casca';
    });

    await passo('tema escuro numa tela vale para as outras telas vivas e para a casca', p, async () => {
      const f = await ativo(p);
      // No celular o tema fica no menu da conta do topo (topo numa linha, 25/11).
      if (IPHONE) { await f.click('#topo-conta-btn'); await f.waitForSelector('#topo-conta-menu:not([hidden])'); }
      await f.click('#btn-tema');
      await p.waitForTimeout(300);
      const temas = await p.evaluate(() => [...document.querySelectorAll('.casca-tela')].map((fr) => fr.contentDocument.documentElement.dataset.theme));
      await menu(p, 'Quadros', 'quadros');
      exigir(temas.every((t) => t === 'dark'), 'temas: ' + temas);
      if (IPHONE) { await (await ativo(p)).click('#topo-conta-btn'); await (await ativo(p)).waitForSelector('#topo-conta-menu:not([hidden])'); }
      await (await ativo(p)).click('#btn-tema'); await p.waitForTimeout(300);
      const depois = await p.evaluate(() => [...document.querySelectorAll('.casca-tela')].map((fr) => fr.contentDocument.documentElement.dataset.theme));
      exigir(depois.every((t) => t !== 'dark'), 'claro: ' + depois);
      return temas.join(',');
    });

    if (!IPHONE) await passo('recolher o menu da casca: trilho de ícones, telas ocupam o resto, lembrado', p, async () => {
      await p.click('#casca-recolher'); await p.waitForTimeout(100);
      const r = await p.evaluate(() => ({ menu: document.getElementById('casca-menu').getBoundingClientRect().width, tela: document.querySelector('.casca-tela.ativa').getBoundingClientRect().left, chave: localStorage.getItem('hc_sidebar_colapsada') }));
      await p.click('#casca-recolher'); await p.waitForTimeout(100);
      exigir(r.menu === 64 && r.tela === 64 && r.chave === '1', JSON.stringify(r));
      return JSON.stringify(r);
    });

    await passo('gravação numa tela: ao mostrar outra tela viva aparece o aviso com Atualizar (sem recarregar sozinha)', p, async () => {
      const f = await ativo(p);
      await f.evaluate(() => fetch('http://127.0.0.1:1/rest/v1/tabela_e2e', { method: 'POST' }).catch(() => null));
      const t0 = await p.evaluate(() => document.querySelector('.casca-tela[title="Processos"]').contentWindow.performance.timeOrigin);
      await menu(p, 'Processos', 'processos');
      await p.waitForSelector('#casca-aviso:not([hidden])', { timeout: 3000 });
      exigir(await p.evaluate(() => document.querySelector('.casca-tela.ativa').contentWindow.performance.timeOrigin) === t0, 'recarregou sozinha');
      await p.click('#casca-aviso-atualizar');
      await naTela(p, 'processos');
      exigir(await p.isHidden('#casca-aviso'), 'aviso continuou');
      return await p.innerText('#casca-aviso-texto');
    });

    await passo('empresa ativa trocada numa tela: a outra avisa ao aparecer', p, async () => {
      const f = await ativo(p);
      await f.evaluate(([a, b]) => { localStorage.setItem('licitaplena_empresa_operacional_id', a); localStorage.setItem('licitaplena_empresa_operacional_id', b); }, [seed.ids.empA1, seed.ids.empA2]);
      await menu(p, 'Quadros', 'quadros');
      await p.waitForSelector('#casca-aviso:not([hidden])', { timeout: 3000 });
      const txt = await p.innerText('#casca-aviso-texto');
      exigir(/empresa ativa/.test(txt), txt);
      await p.click('#casca-aviso-fechar');
      await (await ativo(p)).evaluate((e) => localStorage.setItem('licitaplena_empresa_operacional_id', e), seed.ids.empA1);
      return txt;
    });

    if (!IPHONE) await passo('Ctrl+P imprime só a tela visível', p, async () => {
      await p.evaluate(() => { window.__imp = 0; for (const fr of document.querySelectorAll('.casca-tela')) fr.contentWindow.print = () => { window.__imp = fr.title; }; });
      await p.keyboard.press('Control+P');
      const onde = await p.evaluate(() => window.__imp);
      exigir(onde === 'Quadros', 'imprimiu: ' + onde);
      return onde;
    });

    await passo('no máximo 8 telas vivas', p, async () => {
      for (const [t, tela] of [['Hoje', 'sistema'], ['Prospecção', 'prospeccao'], ['Orçamento de obra', 'orcamento-obra'], ['Minhas empresas', 'operacao'], ['Dashboard', 'painel']]) await menu(p, t, tela);
      await (await ativo(p)).evaluate(() => { location.href = 'sinapi.html'; });
      await naTela(p, 'sinapi');
      const n = await p.evaluate(() => document.querySelectorAll('.casca-tela').length);
      exigir(n <= 8, 'telas vivas: ' + n);
      return n + ' iframes';
    });

    await passo('tela com alteração não salva nunca é descartada (passa de 8 se preciso)', p, async () => {
      // Todas as telas vivas fingem ter alteração (como operacao.html com Dados da empresa editados): nenhuma pode sair.
      await p.evaluate(() => { for (const fr of document.querySelectorAll('.casca-tela')) fr.contentWindow.__lpTemAlteracoes = () => true; });
      const antes = await p.evaluate(() => [...document.querySelectorAll('.casca-tela')].map((f) => f.title));
      await (await ativo(p)).evaluate(() => { location.href = 'bdi.html'; });
      await naTela(p, 'bdi');
      const depois = await p.evaluate(() => [...document.querySelectorAll('.casca-tela')].map((f) => f.title));
      exigir(antes.every((t) => depois.includes(t)) && depois.length === antes.length + 1, `antes ${antes} / depois ${depois}`);
      await p.evaluate(() => { for (const fr of document.querySelectorAll('.casca-tela')) fr.contentWindow.__lpTemAlteracoes = () => false; });
      return depois.length + ' iframes, nenhuma tela com alteração descartada';
    });

    await passo('link direto fora da casca continua sozinho; o menu dele entra na casca', p, async () => {
      await p.goto(SITE + '/painel.html#precos');
      await p.waitForSelector('#precos.ativa', { timeout: 30000 });
      exigir(!/\/app/.test(p.url()), p.url());
      if (IPHONE) { await p.click('#nav-gaveta-btn'); await p.waitForSelector('#menu-principal.gaveta-aberta'); }
      await p.locator('#menu-principal a[title="Processos"]').click();
      await p.waitForURL(/\/app(\.html)?#\/processos/, { timeout: 20000 });
      await naTela(p, 'processos');
      return p.url().replace(SITE, '');
    });

    await passo('Sair dentro da casca sai da aba inteira para o login', p, async () => {
      const f = await ativo(p);
      // No celular o Sair do topo fica escondido por CSS nestas telas: aciona o mesmo botão pelo DOM.
      if (IPHONE) await f.evaluate(() => document.querySelector('.header-sair').click()); else await f.locator('.header-sair').first().click();
      await p.waitForURL(/\/login/, { timeout: 20000 });
      exigir(await p.evaluate(() => !document.querySelector('.casca-tela')), 'login dentro da casca');
      return p.url().replace(SITE, '');
    });
    await passo('voltar depois de Sair não mostra a casca com os dados de quem saiu', p, async () => {
      await p.goBack().catch(() => null);
      await p.waitForTimeout(1500);
      const r = await p.evaluate(() => ({ url: location.pathname, visivel: getComputedStyle(document.documentElement).visibility !== 'hidden' && !!document.querySelector('.casca-tela.ativa') }));
      exigir(!r.visivel, 'casca visível depois de sair: ' + JSON.stringify(r));
      return JSON.stringify(r);
    });
    await p.screenshot({ path: path.join(PRINTS, 'fim.png') });
    await passo('sem erro de JavaScript', null, async () => { exigir(!erros.length, erros.join(' | ')); });
  } finally {
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(falhas ? `${falhas} passo(s) com falha` : 'tudo certo');
  process.exitCode = falhas ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
