/* global document, window -- usados só dentro de p.evaluate (rodam no navegador) */
// E2E local da Pesquisa de Preços v2 (uma caixa de busca). Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8850 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8850 node ambiente-teste/e2e-pesquisa-precos.cjs
// Usa o Compras.gov de verdade (dados abertos, sem login): "notebook" tem de mostrar notebooks com marcas reais, não telas.
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-pesquisa-precos-v2';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const linhas = (p) => p.locator('#pp-mercado .mercado-compras-tabela tbody tr');
async function abrirEBuscar(p, termo) {
  await p.goto(SITE + '/painel.html');
  await p.locator('nav button[data-alvo="precos"]').dispatchEvent('click');
  await p.waitForSelector('#pp-mercado input[type="search"]', { state: 'visible' });
  await p.fill('#pp-mercado input[type="search"]', termo);
  await p.click('#pp-mercado button[type="submit"]');
  // Termina quando a carga das páginas acaba (mensagem final no status) ou a fonte falha.
  await p.waitForFunction(() => /compra\(s\) encontradas|não respondeu|Nenhuma compra/.test(document.querySelector('#pp-mercado [role="status"]')?.textContent || ''), null, { timeout: 150000 });
}

(async () => {
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  await p.setViewportSize({ width: 1280, height: 900 });
  try {
    await passo('notebook mostra notebooks com marcas reais (1280)', p, async () => {
      await abrirEBuscar(p, 'notebook');
      const chip = (await p.locator('#pp-mercado .mercado-chip[aria-pressed="true"]').innerText()).trim();
      exigir(/^Notebook ·/.test(chip), `produto escolhido devia ser Notebook, veio "${chip}"`);
      const descricoes = await p.locator('#pp-mercado .mercado-compras-tabela td[data-rotulo="Marca e modelo"] .mercado-desc').allInnerTexts();
      exigir(descricoes.length >= 20, `poucas compras: ${descricoes.length}`);
      const naoNotebook = descricoes.filter((d) => !/^NOTEBOOK/i.test(d.trim()));
      exigir(!naoNotebook.length, `compras que não são notebook: ${naoNotebook.slice(0, 3).join(' | ')}`);
      const marcas = (await p.locator('#pp-mercado .mercado-marca-nome').allInnerTexts()).map((m) => m.trim());
      const conhecidas = marcas.filter((m) => /^(DELL|LENOVO|POSITIVO|ACER|ASUS|VAIO|SAMSUNG|APPLE|HP|AVELL)/.test(m));
      exigir(conhecidas.length >= 3, `marcas reais esperadas, vieram: ${marcas.join(', ')}`);
      const vencedores = await p.locator('#pp-mercado .mercado-compras-tabela td[data-rotulo="Vencedor"]').allInnerTexts();
      exigir(vencedores.filter((v) => /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(v)).length >= 10, 'vencedor sem CNPJ');
      const modelos = await p.locator('#pp-mercado h3', { hasText: 'Modelos mais vendidos' }).count();
      await p.locator('#precos').screenshot({ path: path.join(PRINTS, 'secao-notebook-1280.png') });
      return `chip "${chip}"; ${descricoes.length} compras na tela; marcas: ${marcas.slice(0, 8).join(', ')}; tabela de modelos: ${modelos ? 'sim' : 'não'}`;
    });
    await passo('trocar para Bateria notebook muda as compras', p, async () => {
      const bateria = p.locator('#pp-mercado .mercado-chip', { hasText: 'Bateria notebook' });
      exigir(await bateria.count(), 'chip Bateria notebook ausente');
      await bateria.click();
      await p.waitForFunction(() => /compra\(s\) encontradas|não respondeu/.test(document.querySelector('#pp-mercado [role="status"]')?.textContent || '')
        && document.querySelector('#pp-mercado .mercado-chip[aria-pressed="true"]')?.textContent.startsWith('Bateria'), null, { timeout: 90000 });
      const d = await p.locator('#pp-mercado .mercado-compras-tabela td[data-rotulo="Marca e modelo"] .mercado-desc').first().innerText();
      exigir(/^BATERIA/i.test(d.trim()), `esperava bateria, veio ${d.slice(0, 60)}`);
      await p.locator('#pp-mercado .mercado-chip', { hasText: /^Notebook ·/ }).click();
      await p.waitForFunction(() => document.querySelector('#pp-mercado .mercado-chip[aria-pressed="true"]')?.textContent.startsWith('Notebook')
        && /compra\(s\) encontradas|não respondeu/.test(document.querySelector('#pp-mercado [role="status"]')?.textContent || ''), null, { timeout: 90000 });
    });
    await passo('filtro de esfera e quantidade e planilha Excel', p, async () => {
      const antes = await linhas(p).count();
      await p.selectOption('#pp-mercado select[data-filtro="esfera"]', 'F');
      const federais = await p.locator('#pp-mercado .mercado-compras-tabela td[data-rotulo="Órgão"]').allInnerTexts();
      exigir(federais.every((t) => /Federal/.test(t)), 'filtro de esfera deixou passar não federal');
      await p.fill('#pp-mercado input[data-filtro="qtdMin"]', '10');
      await p.locator('#pp-mercado input[data-filtro="qtdMin"]').dispatchEvent('change');
      const [download] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#pp-mercado [data-mercado-planilha]')]);
      exigir(/\.xlsx$/.test(download.suggestedFilename()), `planilha: ${download.suggestedFilename()}`);
      await p.selectOption('#pp-mercado select[data-filtro="esfera"]', '');
      await p.fill('#pp-mercado input[data-filtro="qtdMin"]', '');
      await p.locator('#pp-mercado input[data-filtro="qtdMin"]').dispatchEvent('change');
      return `linhas antes ${antes}; arquivo ${download.suggestedFilename()}`;
    });
    await passo('celular 375 sem rolagem horizontal', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 });
      await p.waitForTimeout(500);
      const { largura, janela } = await p.evaluate(() => ({ largura: document.documentElement.scrollWidth, janela: window.innerWidth }));
      exigir(largura <= janela, `rolagem horizontal: ${largura} > ${janela}`);
      await p.locator('#precos').screenshot({ path: path.join(PRINTS, 'secao-notebook-375.png') });
      return `scrollWidth ${largura} / innerWidth ${janela}`;
    });
    await passo('erros de página', null, async () => {
      const graves = p.erros.filter((e) => !/favicon|404 GET \/api\/(chat|notificacoes)/.test(e));
      exigir(!graves.some((e) => /pageerror/.test(e)), graves.join(' | '));
      return graves.slice(0, 5).join(' | ') || 'nenhum';
    });
  } finally {
    await nav.close();
    const falhas = resultados.filter((r) => !r.ok).length;
    console.log(`\n${resultados.length - falhas}/${resultados.length} passos ok. Prints em ${path.resolve(PRINTS)}`);
    process.exitCode = falhas ? 1 : 0;
  }
})();
