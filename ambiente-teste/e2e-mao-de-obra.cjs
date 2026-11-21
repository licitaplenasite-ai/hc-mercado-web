// E2E da planilha de custos de mão de obra (mao-de-obra.html) e dos itens novos do menu (Mão de obra, Consultoria).
//   PORTA_TESTE=8802 node ambiente-teste/servidor.cjs   e depois   PORTA_TESTE=8802 node ambiente-teste/e2e-mao-de-obra.cjs
// Não grava nada no banco: o rascunho fica no navegador, por conta.
const fs = require('node:fs');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-mao-de-obra';
const { passo, exigir, novaPagina, entrar, seed, PRINTS, SITE } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

(async () => {
  const nav = await chromium.launch({ channel: 'msedge', headless: true });
  let falhas = 0;
  const ok = (v) => { if (!v) falhas += 1; };
  try {
    const p = await novaPagina(nav); await entrar(p, seed.usuarios.gestor);
    ok(await passo('menu: Mão de obra ativo e Consultoria abre hc.html em nova aba', p, async () => {
      await p.goto(SITE + '/mao-de-obra.html'); await p.waitForSelector('#f-salarioBase');
      const ativo = await p.getAttribute('#menu-principal a.ativo', 'href'); exigir(ativo === 'mao-de-obra.html', ativo);
      const c = p.locator('#menu-principal a[data-hc-site]');
      exigir(await c.getAttribute('href') === 'hc.html' && await c.getAttribute('target') === '_blank', 'Consultoria');
      return 'ok';
    }));
    ok(await passo('caso conferido à mão: servente 44h, 1.800,00 + insalubridade 20% do mínimo, 3 postos', p, async () => {
      for (const [k, v] of [['salarioBase', '1.800,00'], ['insalubridadePct', '20'], ['vtValorPassagem', '5'], ['vaValorDia', '25'], ['uniformes', '50'], ['postos', '3']]) await p.fill('#f-' + k, v);
      await p.waitForSelector('#resultado:not([hidden])');
      const t = (await p.innerText('#totais')).replace(/\s+/g, ' ');
      exigir(/5\.188,75/.test(t) && /15\.566,25/.test(t) && /186\.795,00/.test(t), t);
      const tab = await p.innerText('#tabela-corpo');
      exigir(/324,20/.test(tab) && /2\.124,20/.test(tab) && /868,56/.test(tab), 'linhas');
      return t;
    }));
    ok(await passo('baixar planilha CSV no layout do Anexo VII-D', p, async () => {
      const [d] = await Promise.all([p.waitForEvent('download'), p.click('#btn-csv')]);
      const txt = fs.readFileSync(await d.path(), 'utf8'); fs.writeFileSync(PRINTS + '/planilha.csv', txt);
      exigir(txt.startsWith('\uFEFFPlanilha de Custos e Formação de Preços – Anexo VII-D'), 'BOM/título');
      exigir(txt.includes('C;Adicional de insalubridade (sobre o salário mínimo);20%;324,20'), 'insalubridade');
      exigir(txt.includes(';Valor total do contrato (12 meses);;186.795,00'), 'total');
      return d.suggestedFilename();
    }));
    ok(await passo('rascunho persiste na conta e não vaza para outra conta', p, async () => {
      await p.reload(); await p.waitForSelector('#resultado:not([hidden])');
      exigir(await p.inputValue('#f-salarioBase') === '1.800,00', 'não persistiu');
      const out = await novaPagina(nav); await entrar(out, seed.usuarios.outra_org);
      await out.goto(SITE + '/mao-de-obra.html'); await out.waitForSelector('#f-salarioBase'); await out.waitForTimeout(1000);
      exigir(await out.inputValue('#f-salarioBase') === '0', 'vazou: ' + await out.inputValue('#f-salarioBase'));
      await out.context().close();
      return 'ok';
    }));
    ok(await passo('12x36 noturna: 2 empregados por posto, adicional noturno aparece', p, async () => {
      await p.selectOption('#f-escala', '12x36-noturno');
      exigir(await p.inputValue('#f-empregadosPorPosto') === '2' && await p.inputValue('#f-diasMes') === '15,21', 'padrões da escala');
      const t = await p.innerText('#tabela-corpo'); exigir(/Adicional noturno\s+20%/.test(t), 'sem adicional noturno');
      return (await p.innerText('#totais')).replace(/\s+/g, ' ');
    }));
    ok(await passo('Simples Nacional em portaria: aviso de vedação e terceiros zerados', p, async () => {
      await p.selectOption('#f-servico', 'portaria'); await p.selectOption('#f-regime', 'simples');
      exigir(await p.inputValue('#f-sesc') === '0' && await p.inputValue('#f-simplesPct') === '4,5', 'padrões do Simples');
      const a = await p.innerText('#avisos'); exigir(/art\. 17, XII/.test(a), a);
      return a.slice(0, 120);
    }));
    ok(await passo('valor inválido mostra erro e esconde o resultado', p, async () => {
      await p.fill('#f-ciPct', 'abc');
      exigir(await p.isHidden('#resultado') && /Custos indiretos/.test(await p.innerText('#aviso')), await p.innerText('#aviso'));
      await p.fill('#f-ciPct', '3');
      return 'ok';
    }));
    ok(await passo('menu novo em outra página (painel)', p, async () => {
      await p.goto(SITE + '/painel.html'); await p.waitForSelector('#menu-principal a[href="mao-de-obra.html"]', { state: 'attached' });
      exigir(await p.locator('#menu-principal a[data-hc-site][target="_blank"]').count() === 1, 'Consultoria no painel');
      return 'ok';
    }));
    await p.goto(SITE + '/mao-de-obra.html'); await p.waitForSelector('#resultado:not([hidden])');
    await p.screenshot({ path: PRINTS + '/planilha-computador.png', fullPage: true });
    await p.setViewportSize({ width: 390, height: 800 }); await p.screenshot({ path: PRINTS + '/planilha-celular.png', fullPage: true });
    const erros = p.erros.filter((e) => !/favicon/.test(e));
    if (erros.length) { console.log('Erros da página:', erros.join(' | ')); falhas += 1; }
  } finally { await nav.close(); }
  console.log(falhas ? `FALHAS: ${falhas}` : 'TUDO OK');
  if (falhas) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
