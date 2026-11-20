/* global document, window */
// E2E da Análise por CNPJ, parte 3 (valor disputado x vencido, sazonalidade, materiais, marcas, motivos com fonte e
// exportação), com dado REAL e público de 2 fornecedores do governo: Positivo Tecnologia (81.243.735/0001-48) e
// MAX Distribuidora (33.442.649/0001-11). Só o banco local é alterado.
//   PORTA_TESTE=8898 node ambiente-teste/servidor.cjs   (outro terminal; antes: npm run build:cloudflare)
//   SITE_TESTE=http://127.0.0.1:8898 PRINTS=<pasta> node ambiente-teste/e2e-analise-cnpj-v3.cjs
// As marcas vêm do robô (scripts/analise_cnpj.js, etapa "marcas e motivos"), rodado antes contra o banco local.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { banco, passo, exigir, novaPagina, seed, SITE, PRINTS, resultados, AdmZip } = require('./e2e.cjs');

const CNPJS = [['positivo', '81243735000148'], ['max', '33442649000111']];

async function analisar(p, cnpj) {
  await p.goto(SITE + '/painel.html');
  await p.click('nav button[data-alvo="empresa"]');
  await p.fill('#emp-cnpj', cnpj);
  await p.click('#emp-buscar');
  await p.waitForSelector('#emp-analise-cnpj .acn-motivos', { timeout: 240000 });
}

async function imprimir(p, nome) {
  await p.addStyleTag({ content: 'header { position: static !important; }' });
  try {
    for (const largura of [1280, 375]) {
      await p.setViewportSize({ width: largura, height: 900 });
      await p.waitForTimeout(300);
      await p.locator('#emp-analise-cnpj').screenshot({ path: path.join(PRINTS, `${nome}-${largura}.png`) });
      const larga = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      exigir(!larga, `rolagem horizontal da página em ${largura}px`);
    }
  } finally { await p.setViewportSize({ width: 1366, height: 900 }); }
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await novaPagina(navegador, seed.usuarios.gestor);
  try {
    for (const [nome, cnpj] of CNPJS) {
      await passo(`${nome}: tela mostra valor disputado x vencido, sazonalidade, materiais, marcas e motivos com fonte (prints 1280 e 375)`, null, async () => {
        await analisar(p, cnpj);
        const texto = await p.locator('#emp-analise-cnpj').innerText();
        for (const t of ['Valor disputado', 'Valor vencido', 'Por modalidade', 'Sazonalidade', 'Onde ela ganha', 'Marcas que ela usa', 'Motivos de desclassificação', 'Baixar planilha', 'Imprimir / Gerar PDF']) {
          exigir(texto.includes(t), `faltou "${t}"`);
        }
        const colunas = await p.locator('#emp-analise-cnpj .acn-sazonalidade .mini-grafico-coluna').count();
        exigir(colunas === 12, `sazonalidade com ${colunas} colunas`);
        const marcasBanco = await banco(`historico_participacoes?fornecedor_ni=eq.${cnpj}&marca=not.is.null&select=marca&limit=1`);
        const marcasTela = await p.locator('#emp-analise-cnpj .acn-materiais table').count();
        exigir(!marcasBanco.length || marcasTela === 2, 'marca gravada pelo robô não apareceu na tela');
        await imprimir(p, `analise-empresa-v3-${nome}`);
        return texto.split('\n').filter((l) => /^(Disputas|Vencidas|Valor disputado|Valor vencido|% de vitória)/.test(l)).slice(0, 5).join(' | ').slice(0, 400) || 'ok';
      });
      await passo(`${nome}: planilha .xlsx com as 9 abas e PDF pela impressão`, null, async () => {
        const [baixa] = await Promise.all([p.waitForEvent('download'), p.click('#emp-analise-cnpj .acn-exportar button:first-child')]);
        const arquivo = path.join(PRINTS, `relatorio-${nome}.xlsx`);
        await baixa.saveAs(arquivo);
        const zip = new AdmZip(arquivo);
        const abas = [...zip.readAsText('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
        exigir(abas.length === 9 && abas.includes('Motivos') && abas.includes('Sazonalidade'), `abas: ${abas.join(', ')}`);
        await p.emulateMedia({ media: 'print' });
        await p.pdf({ path: path.join(PRINTS, `relatorio-${nome}.pdf`), format: 'A4', printBackground: true });
        await p.emulateMedia({ media: 'screen' });
        return `${baixa.suggestedFilename()} · abas: ${abas.join(', ')} · PDF gerado`;
      });
    }
  } finally {
    fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify({ quando: new Date().toISOString(), resultados, errosPagina: p.erros }, null, 2));
    await navegador.close();
  }
}
if (require.main === module) main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
