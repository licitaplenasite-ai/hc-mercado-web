/* global document -- usado só dentro de p.waitForFunction (roda no navegador) */
// E2E local da Pesquisa de Preços com o dicionário de sinônimos (25/11, dono: "geladeira" voltava "Nenhuma compra").
//   PORTA_TESTE=8851 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8851 node ambiente-teste/e2e-precos-sinonimos.cjs
// Usa o Compras.gov de verdade (dados abertos). Cada termo popular tem de achar o produto do catálogo certo.
// Passo com erro deixa a saída do processo em 1.
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-precos';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright');

const FIM_DA_BUSCA = /compra\(s\) encontradas|não respondeu|Nenhuma compra/;
async function buscar(p, termo, uf = '') {
  await p.fill('#pp-mercado input[type="search"]', termo);
  await p.selectOption('#pp-mercado select[aria-label="Estado (UF)"]', uf);
  await p.click('#pp-mercado button[type="submit"]');
  await p.waitForFunction((fim) => new RegExp(fim).test(document.querySelector('#pp-mercado [role="status"]')?.textContent || ''), FIM_DA_BUSCA.source, { timeout: 150000 });
}
// Chip escolhido = nome exato do produto, com " · nº de compras" ou sem ele (produto que a fonte ainda não respondeu
// aparece sem total). "Peças e acessórios aparelho ar condicionado" não passa.
const nomeExato = (nome) => new RegExp('^' + nome + '( · [0-9.]+)?$');

(async () => {
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.goto(SITE + '/painel.html');
  await p.locator('nav button[data-alvo="precos"]').dispatchEvent('click');
  await p.waitForSelector('#pp-mercado input[type="search"]', { state: 'visible' });
  // [termo, UF, produto do catálogo, o que a descrição das compras na tela tem de ter, arquivo do print]
  const casos = [
    ['geladeira', '', nomeExato('Refrigerador doméstico'), /REFRIGERADOR|GELADEIRA/i, 'geladeira'],
    ['geladeira', 'AM', nomeExato('Refrigerador doméstico'), /REFRIGERADOR|GELADEIRA/i, 'geladeira-AM'],
    ['ar condicionado', '', nomeExato('Aparelho ar condicionado'), /AR.?CONDICIONADO|SPLIT|CONDICIONADOR/i, 'ar-condicionado'],
    ['televisão', '', nomeExato('Televisor'), /TELEVISOR|TELEVIS[ÃA]O|\bTV\b|SMART/i, 'televisao'],
    ['micro-ondas', '', nomeExato('Forno microondas'), /MICRO.?ONDAS?/i, 'micro-ondas'],
  ];
  try {
    for (const [termo, uf, produto, descricaoDoProduto, arquivo] of casos) {
      await passo(`"${termo}"${uf ? ` em ${uf}` : ''} acha o produto do catálogo`, p, async () => {
        await buscar(p, termo, uf);
        const status = await p.locator('#pp-mercado [role="status"]').innerText();
        // "Parte da fonte não respondeu: resultado parcial" é estado normal (produto secundário pendente); vazio não é.
        exigir(/compra\(s\) encontradas/.test(status), `sem compras: ${status}`);
        const escolhido = (await p.locator('#pp-mercado .mercado-chip[aria-pressed="true"]').innerText()).trim();
        exigir(produto.test(escolhido), `produto escolhido: "${escolhido}"`);
        const aviso = await p.locator('#pp-mercado .mercado-sugestoes').innerText();
        exigir(/nome no catálogo do governo/.test(aviso), `sem o aviso do nome do catálogo: ${aviso}`);
        const descricoes = await p.locator('#pp-mercado .mercado-compras-tabela td[data-rotulo="Marca e modelo"] .mercado-desc').allInnerTexts();
        exigir(descricoes.length >= 10, `poucas compras na tela: ${descricoes.length}`);
        const outras = descricoes.filter((d) => !descricaoDoProduto.test(d));
        exigir(outras.length <= descricoes.length / 10, `compras de outro produto: ${outras.slice(0, 3).join(' | ')}`);
        const ufs = new Set((await p.locator('#pp-mercado .mercado-compras-tabela td[data-rotulo="Órgão"]').allInnerTexts()).map((t) => (/\/([A-Z]{2})\b/.exec(t) || [])[1]).filter(Boolean));
        if (uf) exigir([...ufs].every((u) => u === uf), `filtro ${uf} deixou passar: ${[...ufs].join(',')}`);
        else exigir(ufs.size >= 5, `poucos estados sem filtro: ${[...ufs].join(',')}`);
        // Topo da seção (busca, aviso do catálogo, resumo e marcas): a seção inteira passa de 10 mil px.
        const caixa = await p.locator('#precos').boundingBox();
        await p.screenshot({ path: path.join(PRINTS, `precos-${arquivo}-1280.png`), fullPage: true, clip: { x: caixa.x, y: caixa.y, width: caixa.width, height: Math.min(caixa.height, 1100) } });
        return `${status.split('.')[0]}; produto "${escolhido}"; ${descricoes.length - outras.length}/${descricoes.length} descrições do produto; UFs: ${[...ufs].sort().join(', ')}`;
      });
    }
    await passo('"Você quis dizer": o botão Freezer busca o freezer', p, async () => {
      await buscar(p, 'geladeira');
      await p.locator('#pp-mercado [data-mercado-sugestao="freezer"]').click();
      await p.waitForFunction((fim) => document.querySelector('#pp-mercado input[type="search"]').value === 'freezer'
        && new RegExp(fim).test(document.querySelector('#pp-mercado [role="status"]')?.textContent || ''), FIM_DA_BUSCA.source, { timeout: 150000 });
      const escolhido = (await p.locator('#pp-mercado .mercado-chip[aria-pressed="true"]').innerText()).trim();
      exigir(/^Freezer/.test(escolhido), `produto escolhido: "${escolhido}"`);
      return escolhido;
    });
  } finally {
    await nav.close();
  }
  if (resultados.some((r) => !r.ok)) process.exitCode = 1;
})();
