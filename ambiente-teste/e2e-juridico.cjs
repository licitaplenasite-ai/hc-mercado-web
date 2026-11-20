/* global document */
// E2E da seção Jurídico & Dúvidas (juridico-ui.js): perguntas e respostas, modelo-base preenchido e banco de peças.
//   PORTA_TESTE=8870 node ambiente-teste/servidor.cjs   (outro terminal; antes: npm run build:cloudflare e supabase/pecas_juridicas.sql)
//   SITE_TESTE=http://127.0.0.1:8870 PRINTS=<pasta> node ambiente-teste/e2e-juridico.cjs
// Só lê: nenhuma peça é enviada, o Word é gerado localmente pelo /api/gerar-checklist do ambiente de teste.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');

async function imprimir(p, nome) {
  await p.addStyleTag({ content: 'header { position: static !important; }' });
  for (const largura of [1280, 375]) {
    await p.setViewportSize({ width: largura, height: 900 });
    await p.waitForTimeout(300);
    const larguraDoc = await p.evaluate(() => document.documentElement.scrollWidth);
    exigir(larguraDoc <= largura, `${nome}: sem rolagem horizontal em ${largura}px (scrollWidth ${larguraDoc})`);
    await p.locator('#juridico').screenshot({ path: path.join(PRINTS, `${nome}-${largura}.png`) });
  }
  await p.setViewportSize({ width: 1366, height: 900 });
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await novaPagina(navegador, seed.usuarios.gestor);
  try {
    await p.goto(SITE + '/painel.html#juridico');
    await p.waitForSelector('#juridico-central .jur-item');
    await passo('perguntas: 40+ respostas, busca e categoria', null, async () => {
      exigir(Number((await p.textContent('.jur-contagem')).match(/\d+/)[0]) >= 40, 'menos de 40 respostas');
      await p.fill('#jur-busca', 'contrarrazões');
      await p.waitForTimeout(200);
      exigir(/prazo para apresentar contrarrazões/i.test(await p.textContent('#jur-painel-perguntas')), 'busca não achou contrarrazões');
      await p.fill('#jur-busca', '');
      await p.click('.jur-chip:has-text("Prazos")');
      await p.click('.jur-item summary >> nth=0');
      await imprimir(p, 'juridico-perguntas');
    });
    await passo('modelos: recurso com dados da empresa, [PREENCHER] bloqueia exportação', null, async () => {
      await p.click('#jur-aba-modelos');
      await p.selectOption('#jur-modelo', 'recurso');
      exigir((await p.inputValue('#jur-texto')).includes('[PREENCHER: decisão recorrida]'), 'marcador ausente');
      exigir(await p.isDisabled('#jur-painel-modelos .jur-primario'), 'Word liberado com campo vazio');
      await p.fill('#jur-campo-decisao', 'Inabilitação da recorrente por suposta falta de atestado (exemplo).');
      await imprimir(p, 'juridico-modelos');
    });
    await passo('banco de peças: busca com destaque e filtro só 14.133', null, async () => {
      await p.click('#jur-aba-banco');
      await p.fill('#jur-banco-palavras', 'atestado');
      await p.click('#jur-painel-banco .jur-primario');
      await p.waitForSelector('#jur-painel-banco .jur-peca', { timeout: 15000 });
      exigir(await p.locator('#jur-painel-banco mark').count() > 0, 'sem destaque');
      await imprimir(p, 'juridico-banco');
      await p.check('#jur-banco-14133');
      await p.click('#jur-painel-banco .jur-primario');
      await p.waitForTimeout(800);
      const topos = await p.locator('#jur-painel-banco .jur-peca .jur-ajuda').allTextContents();
      exigir(topos.length > 0 && topos.every((t) => /Lei 14133/.test(t)), 'filtro 14.133 falhou');
    });
    await passo('tema escuro: banco de peças', null, async () => {
      await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.classList.remove('tema-claro'); });
      await imprimir(p, 'juridico-banco-escuro');
    });
  } finally {
    await navegador.close();
    console.log(JSON.stringify(resultados, null, 1));
  }
}

main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
