/* global document -- usado só dentro de p.evaluate (roda no navegador) */
// E2E da exportação SINAPI: baixar planilha dos resultados e da composição, "minha lista" com quantidade e BDI.
//   PORTA_TESTE=8796 node ambiente-teste/servidor.cjs   e depois   PORTA_TESTE=8796 node ambiente-teste/e2e-sinapi-planilha.cjs
// Grava dados fictícios (códigos 9901xx) e apaga no fim.
const fs = require('node:fs');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-sinapi-v2';
const { passo, exigir, novaPagina, entrar, seed, chaves, PRINTS, SITE } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
async function sv(m, c, corpo) {
  const r = await fetch(chaves.API_URL + c, { method: m, body: corpo === undefined ? undefined : JSON.stringify(corpo), headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=minimal' } });
  if (!r.ok) throw new Error(`${m} ${c}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
const R = '2026-10-01';
(async () => {
  const nav = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    await sv('POST', '/rest/v1/sinapi_itens', [
      { tipo: 'composicao', codigo: '990101', descricao: 'ALVENARIA DE BLOCO CERAMICO (FICTICIO)', unidade: 'M2', referencia: R, busca: 'alvenaria de bloco ceramico ficticio' },
      { tipo: 'insumo', codigo: '990102', descricao: 'BLOCO CERAMICO; 9X19X39 "FICTICIO"', unidade: 'UN', referencia: R, busca: 'bloco ceramico ficticio' },
      { tipo: 'insumo', codigo: '990103', descricao: 'PEDREIRO', unidade: 'H', referencia: R, busca: 'pedreiro ficticio' }]);
    await sv('POST', '/rest/v1/sinapi_custos', [
      { uf: 'AM', tipo: 'composicao', codigo: '990101', preco_sd: 88.1, preco_cd: 85.4, referencia: R },
      { uf: 'AM', tipo: 'insumo', codigo: '990102', preco_sd: 2.55, preco_cd: 2.55, referencia: R },
      { uf: 'AM', tipo: 'insumo', codigo: '990103', preco_sd: 22.33, preco_cd: 18.1, referencia: R }]);
    await sv('POST', '/rest/v1/sinapi_composicao_itens', [
      { composicao: '990101', item_tipo: 'insumo', item_codigo: '990102', descricao: 'BLOCO CERAMICO', unidade: 'UN', coeficiente: 13.5, referencia: R },
      { composicao: '990101', item_tipo: 'insumo', item_codigo: '990103', descricao: 'PEDREIRO', unidade: 'H', coeficiente: 0.8, referencia: R },
      { composicao: '990101', item_tipo: 'insumo', item_codigo: '990104', descricao: 'ITEM SEM PRECO', unidade: 'KG', coeficiente: 2, referencia: R }]);
    const p = await novaPagina(nav); await entrar(p, seed.usuarios.gestor);
    await passo('topo diz Atualizado todo mês · referência 10/2026', p, async () => {
      await p.goto(SITE + '/sinapi.html'); await p.waitForFunction(() => /\d\d\/\d{4}/.test(document.getElementById('data-base').innerText), null, { timeout: 15000 });
      const t = (await p.innerText('.fonte')).replace(/\s+/g, ' '); exigir(/Atualizado todo mês · referência 10\/2026/.test(t), t); return t;
    });
    await passo('baixar planilha dos resultados (CSV BR)', p, async () => {
      await p.selectOption('#f-uf', 'AM'); await p.selectOption('#f-tipo', 'insumo'); await p.fill('#f-busca', 'ficticio'); await p.click('#form-busca button[type=submit]');
      await p.waitForSelector('#btn-baixar:not([hidden])'); const [d] = await Promise.all([p.waitForEvent('download'), p.click('#btn-baixar')]);
      const txt = fs.readFileSync(await d.path(), 'utf8'); fs.writeFileSync(PRINTS + '/resultados.csv', txt);
      exigir(txt.startsWith('\uFEFFCódigo;Descrição'), 'sem BOM/cabeçalho'); exigir(txt.includes('990102;"BLOCO CERAMICO; 9X19X39 ""FICTICIO""";UN;Insumo;AM;Não desonerado;2,55;10/2026;SINAPI/CAIXA'), txt);
      return d.suggestedFilename();
    });
    await passo('composição aberta: baixar planilha com soma e aviso', p, async () => {
      await p.selectOption('#f-tipo', 'composicao'); await p.fill('#f-busca', '990101'); await p.click('#form-busca button[type=submit]');
      await p.waitForSelector('[data-itens]'); await p.click('[data-itens]'); await p.waitForSelector('[data-baixar-analitico]');
      await p.screenshot({ path: PRINTS + '/composicao.png', fullPage: true });
      const [d] = await Promise.all([p.waitForEvent('download'), p.click('[data-baixar-analitico]')]);
      const txt = fs.readFileSync(await d.path(), 'utf8'); fs.writeFileSync(PRINTS + '/composicao.csv', txt);
      exigir(txt.includes('Insumo;990102;BLOCO CERAMICO;UN;13,5;2,55;34,43'), txt); exigir(txt.includes('Soma dos itens (R$);52,29'), txt); exigir(/sem preço/.test(txt), 'sem aviso');
      return d.suggestedFilename();
    });
    await passo('minha lista: adicionar, quantidade, BDI, baixar, persiste por conta', p, async () => {
      await p.click('[data-lista]'); await p.selectOption('#f-tipo', 'insumo'); await p.fill('#f-busca', '990103'); await p.click('#form-busca button[type=submit]');
      await p.waitForSelector('[data-lista]'); await p.click('[data-lista]'); await p.click('[data-lista]');
      exigir(await p.locator('#lista-corpo tr').count() === 2, 'não deveria duplicar');
      await p.fill('[data-qtd="0"]', '10,5'); await p.press('[data-qtd="0"]', 'Tab'); await p.fill('[data-qtd="1"]', '3'); await p.press('[data-qtd="1"]', 'Tab'); await p.fill('#l-bdi', '24,5');
      const t = (await p.innerText('#lista-totais')).replace(/\s+/g, ' ');
      // 88,10×10,5=925,05 ; 22,33×3=66,99 ; sem BDI 992,04 ; com BDI 925,05×1,245=1151,68 + 66,99×1,245=83,40 = 1235,09
      exigir(/992,04/.test(t) && /1\.235,09/.test(t), t);
      await p.screenshot({ path: PRINTS + '/lista.png', fullPage: true });
      const [d] = await Promise.all([p.waitForEvent('download'), p.click('#btn-baixar-lista')]);
      const txt = fs.readFileSync(await d.path(), 'utf8'); fs.writeFileSync(PRINTS + '/lista.csv', txt);
      exigir(txt.includes('Total geral;992,04;1235,09'), txt);
      await p.reload(); await p.waitForSelector('#lista:not([hidden])'); exigir(await p.locator('#lista-corpo tr').count() === 2, 'não persistiu');
      const out = await novaPagina(nav); await entrar(out, seed.usuarios.outra_org); await out.goto(SITE + '/sinapi.html'); await out.waitForTimeout(1500);
      exigir(await out.locator('#lista-corpo tr').count() === 0, 'lista vazou para outra conta');
      return t;
    });
    await p.setViewportSize({ width: 390, height: 800 }); await p.screenshot({ path: PRINTS + '/lista-celular.png', fullPage: true });
  } finally {
    await sv('DELETE', '/rest/v1/sinapi_composicao_itens?composicao=like.9901*').catch((e) => console.log(e.message));
    for (const t of ['sinapi_custos', 'sinapi_itens']) await sv('DELETE', `/rest/v1/${t}?codigo=like.9901*`).catch((e) => console.log(e.message));
    await nav.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
