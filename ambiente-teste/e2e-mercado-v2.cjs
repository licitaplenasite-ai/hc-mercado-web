/* global document, window -- usados só dentro de p.evaluate/p.waitForFunction (rodam no navegador) */
// E2E local da Inteligência de Mercado refeita (20/11/2026, modelo Siga Pregão): uma busca e quatro respostas —
// quem ganha, quanto se paga, quem compra e compras por mês — mais as abas Baixa concorrência e Licitação anterior.
// Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8792 node ambiente-teste/servidor.cjs
//   PORTA_TESTE=8792 SITE_TESTE=http://127.0.0.1:8792 node ambiente-teste/e2e-mercado-v2.cjs
// Contratos, resultados homologados e uma ata FICTÍCIOS (termo "GRAMPO E2EMK") são gravados no banco LOCAL e apagados
// no fim. A Pesquisa de Preços ao vivo vai ao Compras.gov de verdade (dados abertos); para o termo fictício volta vazia.
const path = require('node:path');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-mercado-v2';
const { passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

async function servico(metodo, caminho, corpo) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=minimal' } });
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${(await r.text()).slice(0, 300)}`);
}
const dia = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const ALFA = { cnpj: '11222333000181', nome: 'GRAMPOS ALFA FICTICIA LTDA' };
const BETA = { cnpj: '11444777000161', nome: 'GRAMPOS BETA FICTICIA LTDA' };
const ORGAO = 'PREFEITURA FICTICIA E2E MERCADO';

async function semear() {
  await limpar();
  const contrato = (n, f, valor, dias) => {
    const dado = { numeroControlePNCP: `E2EMK-C${n}`, objeto: `Aquisição de GRAMPO E2EMK 26/6 lote ${n}`, orgao: ORGAO, uf: 'AM', cnpjFornecedor: f.cnpj, nomeFornecedor: f.nome, valor, dataAssinatura: dia(dias) };
    return { numero_controle_pncp: dado.numeroControlePNCP, objeto: dado.objeto, uf: 'AM', cnpj_fornecedor: f.cnpj, data_assinatura: dado.dataAssinatura, dado };
  };
  await servico('POST', '/rest/v1/contratos', [contrato(1, ALFA, 5000, 20), contrato(2, ALFA, 3000, 80), contrato(3, BETA, 1000, 140)]);
  const resultado = (n, f, unit, dias) => {
    const dado = { compra: { id: `E2EMK${n}`, numeroControlePncp: '', uf: 'AM' }, item: { id: `E2EMKI${n}`, descricao: 'GRAMPO E2EMK 26/6, GALVANIZADO', unidadeMedida: 'CX' },
      fornecedor: { documento: f.cnpj, nome: f.nome }, resultado: { data: dia(dias), valorUnitarioHomologado: unit, quantidadeHomologada: 10, valorTotalHomologado: unit * 10 } };
    return { chave: `E2EMK-R${n}`, id_compra_item: `E2EMKI${n}`, id_compra: `E2EMK${n}`, descricao_item: dado.item.descricao, uf: 'AM', cnpj_fornecedor: f.cnpj, data_resultado: dado.resultado.data, dado };
  };
  await servico('POST', '/rest/v1/comprasgov_resultados', [resultado(1, ALFA, 10, 15), resultado(2, ALFA, 14, 45), resultado(3, BETA, 12, 100)]);
  const ata = { numeroControlePNCPAta: 'E2EMK-A1', numeroControlePNCPCompra: null, objeto: 'Registro de preço de GRAMPO E2EMK', orgao: 'HOSPITAL FICTICIO E2E', ufOrgao: 'AM',
    dataAssinatura: dia(60), enriquecida: true, itens: [{ numeroItem: 1, descricao: 'GRAMPO E2EMK 26/6', vencedores: [{ cnpj: BETA.cnpj, nome: BETA.nome, valorUnitario: 11, quantidade: 100, valorTotal: 1100, data: dia(60) }] }] };
  await servico('POST', '/rest/v1/mercado_atas', [{ numero_controle_pncp_ata: ata.numeroControlePNCPAta, objeto: ata.objeto, uf_orgao: 'AM', data_assinatura: ata.dataAssinatura, enriquecida: true, dado: ata }]);
}
async function limpar() {
  await servico('DELETE', '/rest/v1/contratos?numero_controle_pncp=like.E2EMK-*');
  await servico('DELETE', '/rest/v1/comprasgov_resultados?chave=like.E2EMK-*');
  await servico('DELETE', '/rest/v1/mercado_atas?numero_controle_pncp_ata=like.E2EMK-*');
}

const texto = (p, sel) => p.locator(sel).innerText().then((t) => t.replace(/\s+/g, ' '));
const errosJs = (p) => p.erros.filter((e) => e.startsWith('pageerror') || e.startsWith('console'));

async function pesquisar(p, termo, uf = '') {
  await p.fill('#mk-termo', termo);
  await p.selectOption('#mk-uf', uf);
  await p.click('#mk-buscar');
  await p.waitForFunction(() => !document.querySelector('#mk-resultado .carregando'), null, { timeout: 60000 });
}

async function main() {
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  try {
    await semear();
    const p = await novaPagina(navegador, seed.usuarios.gestor);
    await p.setViewportSize({ width: 1280, height: 900 });

    await passo('tela nova: uma busca e três abas, sem filtros laterais antigos', p, async () => {
      await p.goto(SITE + '/painel.html#diagnostico');
      await p.waitForSelector('#mk-termo', { state: 'visible', timeout: 20000 });
      const abas = (await p.locator('#dg-subabas .btn-subaba').allInnerTexts()).map((t) => t.trim());
      exigir(JSON.stringify(abas) === JSON.stringify(['Pesquisa de mercado', 'Baixa concorrência', 'Licitação anterior']), 'abas: ' + abas.join(' | '));
      exigir(!(await p.locator('#dg-segmento, #hc-objeto, #dg-filtros-lateral').count()), 'sobrou campo da tela antiga');
      return abas.join(' · ');
    });

    // O catálogo do Compras.gov acha "grampo" de verdade: nos passos com dado fictício a consulta ao vivo volta vazia.
    const aoVivoVazio = (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, itens: [] }) });
    await p.route('**/api/comprasgov-marcas-produto*', aoVivoVazio);

    await passo('pesquisa: quem ganha, quanto se paga, quem compra e gráfico por mês', p, async () => {
      await pesquisar(p, 'grampo e2emk', 'AM');
      const ganha = await texto(p, '#mk-quem-ganha tbody');
      const paga = await texto(p, '#mk-quanto-paga tbody');
      const compra = await texto(p, '#mk-quem-compra tbody');
      const primeiraGanha = await texto(p, '#mk-quem-ganha tbody tr:first-child');
      exigir(/GRAMPOS ALFA FICTICIA/.test(primeiraGanha) && /\b4\b/.test(primeiraGanha), 'Alfa (2 contratos + 2 itens) deveria liderar: ' + primeiraGanha);
      exigir(/GRAMPOS BETA FICTICIA/.test(ganha), 'Beta sumiu: ' + ganha);
      const cx = await texto(p, '#mk-quanto-paga tbody tr:has-text("CX")');
      exigir(/R\$\s?12,00/.test(cx) && /R\$\s?10,00/.test(cx) && /R\$\s?14,00/.test(cx), 'preço médio/menor/maior da caixa: ' + cx);
      exigir(/R\$\s?11,00/.test(paga), 'preço da ata fora do quanto se paga: ' + paga);
      exigir(/HOSPITAL FICTICIO E2E/.test(compra), 'ata (Hospital) fora do quem compra: ' + compra);
      exigir(/PREFEITURA FICTICIA E2E MERCADO/.test(compra), 'prefeitura fora do quem compra: ' + compra);
      const barras = await p.locator('.mk-grafico .mk-barra').count();
      exigir(barras >= 3, 'gráfico por mês com poucas barras: ' + barras);
      const cartoes = await texto(p, '.mk-cartoes');
      exigir(/Empresas que ganharam 2/.test(cartoes), 'cartões: ' + cartoes);
      const js = errosJs(p); exigir(!js.length, 'erros de console: ' + js.join(' | '));
      await p.screenshot({ path: path.join(PRINTS, 'mercado-v2-resultado-1280.png'), fullPage: true });
      return `${cartoes} | ganha: ${primeiraGanha} | caixa: ${cx} | ${barras} mês(es)`;
    });

    await passo('"Analisar empresa" abre a análise do concorrente com o CNPJ', p, async () => {
      await p.click(`#mk-quem-ganha [data-mk-cnpj="${ALFA.cnpj}"]`);
      await p.waitForFunction(() => document.querySelector('#empresa')?.classList.contains('ativa'), null, { timeout: 10000 });
      const cnpj = await p.inputValue('#emp-cnpj');
      exigir(cnpj === ALFA.cnpj, 'CNPJ na análise: ' + cnpj);
      return 'Analisar concorrente aberto com ' + cnpj;
    });

    await passo('volta à aba: a última pesquisa reaparece sozinha', p, async () => {
      await p.goto(SITE + '/painel.html');
      await p.locator('nav button[data-alvo="diagnostico"]').dispatchEvent('click');
      await p.waitForSelector('#mk-quem-ganha', { timeout: 30000 });
      exigir(await p.inputValue('#mk-termo') === 'grampo e2emk', 'termo não voltou');
      return 'termo e resultado restaurados';
    });

    await passo('termo sem compras: mensagem simples, sem erro', p, async () => {
      await pesquisar(p, 'zzqx inexistente e2e');
      const t = await texto(p, '#mk-resultado');
      exigir(/Nenhuma compra encontrada/.test(t), 'texto: ' + t.slice(0, 200));
      return t.slice(0, 160);
    });

    await passo('abas Baixa concorrência e Licitação anterior continuam funcionando', p, async () => {
      await p.fill('#mk-termo', 'grampo e2emk');
      await p.click('#dg-subabas [data-subaba="baixa-concorrencia"]');
      await p.waitForSelector('#dg-bc-licitantes h2', { timeout: 15000 });
      const bc = await texto(p, '#dg-bc-licitantes');
      await p.click('#dg-subabas [data-subaba="licitacao-anterior"]');
      await p.waitForSelector('#dg-licitacao-anterior [name=orgao]', { timeout: 30000 });
      return `baixa concorrência: ${bc.slice(0, 120)} | licitação anterior: formulário visível`;
    });

    await passo('celular (390 px): sem rolagem lateral', p, async () => {
      await p.click('#dg-subabas [data-subaba="pesquisa"]');
      await p.setViewportSize({ width: 390, height: 844 });
      await pesquisar(p, 'grampo e2emk', 'AM');
      const sobra = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await p.screenshot({ path: path.join(PRINTS, 'mercado-v2-resultado-390.png'), fullPage: true });
      exigir(sobra <= 1, `página ${sobra}px mais larga que a tela`);
      await p.setViewportSize({ width: 1280, height: 900 });
      return 'largura ok';
    });

    // Retrato real para comparar com o Siga (papel no Siga): base local + Pesquisa de Preços do Compras.gov ao vivo.
    await passo('termo real "papel A4" (Compras.gov ao vivo) para o print lado a lado', p, async () => {
      await p.unroute('**/api/comprasgov-marcas-produto*', aoVivoVazio);
      await pesquisar(p, 'papel A4');
      await p.screenshot({ path: path.join(PRINTS, 'mercado-v2-papel-a4-1280.png'), fullPage: true });
      const js = errosJs(p); exigir(!js.length, 'erros de console: ' + js.join(' | '));
      const linhas = await p.locator('#mk-quanto-paga tbody tr').count();
      return `${linhas} linha(s) de preço; avisos: ${(await p.locator('#mk-resultado .aviso').allInnerTexts()).join(' / ').slice(0, 200) || 'nenhum'}`;
    });
  } finally {
    await limpar().catch((e) => console.log('limpeza:', e.message));
    await navegador.close();
  }
  require('node:fs').writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 1));
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : `E2E MERCADO V2 OK (${resultados.length}/${resultados.length})`);
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
