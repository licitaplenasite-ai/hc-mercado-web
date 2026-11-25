/* global document, window */
// E2E da ficha completa do órgão (24/11/2026) com órgãos REAIS e o PNCP ao vivo de verdade (nada simulado):
// a ficha aberta pela filial do Comando da Aeronáutica (00.394.429/0179-33, o caso do print do dono) soma o órgão inteiro,
// o seletor de unidade filtra, os contratos dos 12 meses chegam do PNCP mês a mês e ficam guardados no banco
// (orgaos_pncp_cache): a segunda visita não chama o PNCP. Prints 1366 de 6 órgãos + unidade + celular 375.
//   PORTA_TESTE=8911 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8911 node ambiente-teste/e2e-ficha-completa.cjs
// Banco LOCAL com crm_orgao_linha_tempo.sql aplicado. O PCA vem do que estiver em prospeccao_itens (robô da Prospecção).
// LIMPAR_CACHE=1 apaga o cache local do PNCP destes órgãos antes (mede a primeira visita).
const path = require('node:path'), fs = require('node:fs'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-ficha-completa';
const { passo, exigir, novaPagina, entrar, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const ORGAOS = [
  ['comando-aeronautica-pela-filial', '00394429017933'], ['municipio-de-manaus', '04365326000173'], ['ufam', '04378626000197'],
  ['estado-do-amazonas', '04312369000190'], ['municipio-de-parintins', '04329736000169'], ['tjam', '04812509000190'],
];
const semRolagemLateral = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
// Espera o PNCP ao vivo terminar (caixa sem "carregando" e sem "ainda está chegando"): até 90 s.
const esperarPncp = (p) => p.waitForFunction(() => { const c = document.getElementById('fo-pncp'); return c && !c.classList.contains('carregando') && !/ainda está chegando/.test(c.textContent); }, null, { timeout: 90000 });
const kpis = (p) => p.$$eval('.fo-kpi', (xs) => Object.fromEntries(xs.map((x) => [x.querySelector('span').textContent, x.querySelector('b').textContent])));

(async () => {
  fs.mkdirSync(PRINTS, { recursive: true });
  if (process.env.LIMPAR_CACHE === '1') psql(`delete from orgaos_pncp_cache where left(cnpj, 8) in (${ORGAOS.map(([, c]) => `'${c.slice(0, 8)}'`).join(',')});`);
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge' });
  let p;
  try {
    p = await novaPagina(navegador); await entrar(p, seed.usuarios.gestor);
    let i = 0;
    for (const [nome, cnpj] of ORGAOS) {
      i += 1;
      // O PNCP aceita ~20 chamadas por minuto por origem e cada ficha nova faz 8 a 12: PAUSA_ENTRE_S=60 para os prints.
      if (i > 1 && process.env.PAUSA_ENTRE_S) await p.waitForTimeout(Number(process.env.PAUSA_ENTRE_S) * 1000);
      await passo(`ficha ${nome}`, null, async () => {
        const chamadas = [];
        p.on('request', (r) => { if (r.url().includes('/api/orgao-pncp')) chamadas.push(r.url()); });
        const t0 = Date.now();
        await p.goto(`${SITE}/orgao.html?cnpj=${cnpj}`);
        await p.waitForSelector('.fo-kpis', { timeout: 30000 });
        await esperarPncp(p);
        const k = await kpis(p);
        const pncp = await p.textContent('#fo-pncp');
        exigir(await semRolagemLateral(p), 'página rola de lado');
        await p.screenshot({ path: path.join(PRINTS, `${String(i).padStart(2, '0')}-${nome}-1366.png`), fullPage: true });
        if (cnpj === '00394429017933') {
          exigir(Number(k['Contratos publicados pelo órgão'].replace(/\D/g, '')) > 100, 'Aeronáutica pela filial devia somar o órgão inteiro: ' + JSON.stringify(k));
          exigir(await p.isVisible('text=a ficha mostra o órgão inteiro'), 'aviso de que abriu por uma unidade');
          exigir(await p.isVisible('#fo-unidade'), 'seletor de unidade');
        }
        return `${Math.round((Date.now() - t0) / 1000)} s · PNCP chamado ${chamadas.length}x · ${JSON.stringify(k)} · ${pncp.trim().slice(0, 140)}`;
      });
    }
    await passo('aeronautica uma unidade (Grupamento de Apoio dos Afonsos)', null, async () => {
      await p.goto(`${SITE}/orgao.html?cnpj=00394429017933`);
      await p.waitForSelector('#fo-unidade', { timeout: 30000 });
      const valor = await p.$eval('#fo-unidade', (s) => ([...s.options].find((o) => /AFONSOS/.test(o.text)) || s.options[1]).value);
      await p.selectOption('#fo-unidade', valor);
      await p.waitForFunction((v) => new URL(location.href).searchParams.get('uasg') === v && document.querySelector('#fo-unidade')?.value === v, valor, { timeout: 30000 });
      await p.waitForSelector('text=Só desta unidade');
      const k = await kpis(p);
      await p.screenshot({ path: path.join(PRINTS, '07-comando-aeronautica-uma-unidade-1366.png'), fullPage: true });
      return `UASG ${valor}: ${JSON.stringify(k)}`;
    });
    await passo('segunda visita nao chama o PNCP (vem do banco)', null, async () => {
      const chamadas = [];
      p.on('request', (r) => { if (r.url().includes('/api/orgao-pncp')) chamadas.push(r.url()); });
      const t0 = Date.now();
      await p.goto(`${SITE}/orgao.html?cnpj=00394429000100`);
      await p.waitForSelector('.fo-kpis', { timeout: 30000 });
      await p.waitForTimeout(1500);
      exigir(!chamadas.length, 'chamou o PNCP de novo: ' + chamadas.length);
      exigir(/guardado para a sua equipe/.test(await p.textContent('#fo-pncp')), 'selo do PNCP guardado');
      return `abriu em ${Date.now() - t0} ms sem ir ao PNCP`;
    });
    const erros = p.erros.filter((e) => !/favicon|chat-ia|ia-conversas|404 GET \/api\//.test(e));
    await passo('console sem erro', null, async () => { exigir(!erros.length, erros.join(' | ')); });
    await p.context().close();

    const cel = await navegador.newContext({ viewport: { width: 375, height: 812 }, locale: 'pt-BR', isMobile: true, hasTouch: true });
    p = await cel.newPage(); p.erros = [];
    await entrar(p, seed.usuarios.gestor);
    await passo('celular 375 aeronautica', null, async () => {
      await p.goto(`${SITE}/orgao.html?cnpj=00394429000100`);
      await p.waitForSelector('.fo-kpis', { timeout: 30000 });
      await esperarPncp(p);
      exigir(await semRolagemLateral(p), 'página rola de lado no celular');
      await p.screenshot({ path: path.join(PRINTS, '08-celular-375-comando-aeronautica.png'), fullPage: true });
    });
    await cel.close();
  } finally {
    await navegador.close();
    fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 2));
    const falhas = resultados.filter((r) => !r.ok).length;
    console.log(falhas ? `${falhas} passo(s) falharam` : 'TUDO OK');
    process.exitCode = falhas ? 1 : 0;
  }
})();
