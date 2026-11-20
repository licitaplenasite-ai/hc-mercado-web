/* global document, window -- usados só dentro de p.evaluate/p.waitForFunction (rodam no navegador) */
// E2E local da Inteligência de Mercado (20/11/2026, modelo Siga Pregão): uma busca e as 7 abas do Siga, na mesma ordem —
// Correspondências, Catálogo, Estados, Órgãos, Empresas, Marcas e Contratação futura (PCA) —, com contagem no título,
// filtro por marca/código, planilha CSV, mais as abas Baixa concorrência e Licitação anterior.
// Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8792 node ambiente-teste/servidor.cjs
//   PORTA_TESTE=8792 SITE_TESTE=http://127.0.0.1:8792 node ambiente-teste/e2e-mercado-v2.cjs
// Contratos, resultados homologados, uma ata (com marca) e um item de PCA FICTÍCIOS (termo "GRAMPO E2EMK") são gravados
// no banco LOCAL e apagados no fim. A Pesquisa de Preços ao vivo vai ao Compras.gov de verdade (dados abertos); nos
// passos com o termo fictício ela é trocada por resposta vazia.
const path = require('node:path');
const fs = require('node:fs');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-mercado-v3';
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
    const dado = { compra: { id: `E2EMK${n}`, numeroControlePncp: '', uf: 'AM' }, item: { id: `E2EMKI${n}`, descricao: 'GRAMPO E2EMK 26/6, GALVANIZADO', unidadeMedida: 'CX', catalogoCodigo: 150399 },
      fornecedor: { documento: f.cnpj, nome: f.nome }, resultado: { data: dia(dias), valorUnitarioHomologado: unit, quantidadeHomologada: 10, valorTotalHomologado: unit * 10 } };
    return { chave: `E2EMK-R${n}`, id_compra_item: `E2EMKI${n}`, id_compra: `E2EMK${n}`, descricao_item: dado.item.descricao, uf: 'AM', cnpj_fornecedor: f.cnpj, data_resultado: dado.resultado.data, dado };
  };
  await servico('POST', '/rest/v1/comprasgov_resultados', [resultado(1, ALFA, 10, 15), resultado(2, ALFA, 14, 45), resultado(3, BETA, 12, 100)]);
  const ata = { numeroControlePNCPAta: 'E2EMK-A1', numeroControlePNCPCompra: null, objeto: 'Registro de preço de GRAMPO E2EMK', orgao: 'HOSPITAL FICTICIO E2E', ufOrgao: 'AM',
    dataAssinatura: dia(60), enriquecida: true, itens: [{ numeroItem: 1, descricao: 'GRAMPO E2EMK 26/6', vencedores: [{ cnpj: BETA.cnpj, nome: BETA.nome, valorUnitario: 11, quantidade: 100, valorTotal: 1100, data: dia(60), marca: 'GRAMPOLINE' }] }] };
  await servico('POST', '/rest/v1/mercado_atas', [{ numero_controle_pncp_ata: ata.numeroControlePNCPAta, objeto: ata.objeto, uf_orgao: 'AM', data_assinatura: ata.dataAssinatura, enriquecida: true, dado: ata }]);
  // Contratação futura: item do PCA planejado para daqui a 90 dias (a tela pede /api/prospeccao?tipo=pca).
  await servico('POST', '/rest/v1/prospeccao_itens', [{ id: 'pca:E2EMK-1', tipo: 'pca', fonte: 'pncp', plataforma: 'PNCP', uf: 'AM', orgao_nome: 'SECRETARIA FICTICIA E2E',
    descricao: 'GRAMPO E2EMK 26/6 PLANEJADO', quantidade: 500, valor_total: 6000, data_ref: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    link: 'https://pncp.gov.br/app/pca/00000000000000/2027', busca: 'grampo e2emk 26 6 planejado', busca_nome: 'grampo e2emk 26 6 planejado' }]);
}
async function limpar() {
  await servico('DELETE', '/rest/v1/contratos?numero_controle_pncp=like.E2EMK-*');
  await servico('DELETE', '/rest/v1/comprasgov_resultados?chave=like.E2EMK-*');
  await servico('DELETE', '/rest/v1/mercado_atas?numero_controle_pncp_ata=like.E2EMK-*');
  await servico('DELETE', '/rest/v1/prospeccao_itens?id=like.pca:E2EMK-*');
}

const texto = (p, sel) => p.locator(sel).innerText().then((t) => t.replace(/\s+/g, ' '));
const errosJs = (p) => p.erros.filter((e) => e.startsWith('pageerror') || e.startsWith('console'));
const ABAS = ['correspondencias', 'catalogo', 'estados', 'orgaos', 'empresas', 'marcas', 'futura'];
const NOMES = ['Correspondências', 'Catálogo', 'Estados', 'Órgãos', 'Empresas', 'Marcas', 'Contratação futura'];

async function pesquisar(p, termo, uf = '') {
  await p.fill('#mk-termo', termo);
  await p.selectOption('#mk-uf', uf);
  await p.click('#mk-buscar');
  await p.waitForFunction(() => !document.querySelector('#mk-resultado > .carregando'), null, { timeout: 60000 });
}
// A Contratação futura carrega depois das outras abas: espera o título sair do "…".
const esperarFutura = (p) => p.waitForFunction(() => !/Contratação futura \(…\)/.test(document.querySelector('#mk-angulos')?.innerText || ''), null, { timeout: 30000 });
async function abrirAba(p, id) {
  await p.click(`#mk-angulos [data-mk-aba="${id}"]`);
  await p.waitForFunction((a) => document.querySelector('#mk-aba-conteudo')?.dataset.aba === a, id, { timeout: 10000 });
}
const linhas = (p) => p.locator('#mk-aba-conteudo tbody tr').count();

async function main() {
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  try {
    await semear();
    const p = await novaPagina(navegador, seed.usuarios.gestor);
    await p.setViewportSize({ width: 1280, height: 900 });

    await passo('tela: uma busca e três abas, sem filtros laterais antigos', p, async () => {
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

    await passo('pesquisa: 7 abas na ordem do Siga, com contagem no título', p, async () => {
      await pesquisar(p, 'grampo e2emk', 'AM');
      await esperarFutura(p);
      const titulos = (await p.locator('#mk-angulos .btn-subaba').allInnerTexts()).map((t) => t.trim());
      exigir(titulos.length === 7 && titulos.every((t, i) => t.startsWith(NOMES[i] + ' (')), 'abas: ' + titulos.join(' | '));
      const esperado = ['Correspondências (7)', 'Catálogo (1)', 'Estados (1)', 'Órgãos (2)', 'Empresas (2)', 'Marcas (1)', 'Contratação futura (1)'];
      exigir(JSON.stringify(titulos) === JSON.stringify(esperado), 'contagens: ' + titulos.join(' | '));
      const barras = await p.locator('.mk-grafico .mk-barra').count();
      exigir(barras >= 3, 'gráfico por mês com poucas barras: ' + barras);
      const cartoes = await texto(p, '.mk-cartoes');
      exigir(/Empresas que ganharam 2/.test(cartoes) && /Marcas 1/.test(cartoes), 'cartões: ' + cartoes);
      const js = errosJs(p); exigir(!js.length, 'erros de console: ' + js.join(' | '));
      return titulos.join(' · ');
    });

    await passo('Correspondências: descrição, órgão, UF, data, quantidade, unidade, preço, marca, vencedor e fonte', p, async () => {
      await abrirAba(p, 'correspondencias');
      const cab = await texto(p, '#mk-aba-conteudo thead');
      for (const c of ['Descrição', 'Órgão', 'UF', 'Data', 'Qtd.', 'Unid.', 'Preço unit.', 'Marca', 'Vencedor', 'Fonte']) exigir(cab.includes(c), 'coluna faltando: ' + c);
      const ata = await texto(p, '#mk-aba-conteudo tbody tr:has-text("GRAMPOLINE")');
      exigir(/HOSPITAL FICTICIO E2E/.test(ata) && /R\$\s?11,00/.test(ata) && /GRAMPOS BETA/.test(ata) && /\b100\b/.test(ata), 'linha da ata: ' + ata);
      return ata;
    });

    await passo('Catálogo: código CATMAT com compras e preço médio; clicar filtra as Correspondências', p, async () => {
      await abrirAba(p, 'catalogo');
      const linha = await texto(p, '#mk-aba-conteudo tr[data-mk-valor="150399"]');
      exigir(/\b3\b/.test(linha) && /R\$\s?12,00/.test(linha), 'catálogo: ' + linha);
      const cx = await texto(p, '#mk-quanto-paga tbody tr:has-text("CX")');
      exigir(/R\$\s?12,00/.test(cx) && /R\$\s?10,00/.test(cx) && /R\$\s?14,00/.test(cx), 'preço médio/menor/maior da caixa: ' + cx);
      await p.click('#mk-aba-conteudo tr[data-mk-valor="150399"] button');
      await p.waitForFunction(() => document.querySelector('#mk-aba-conteudo')?.dataset.aba === 'correspondencias', null, { timeout: 10000 });
      const n = await linhas(p);
      exigir(n === 3, 'filtro por código deveria deixar 3 compras: ' + n);
      await p.click('[data-mk-limpar]');
      exigir(await linhas(p) === 7, 'limpar filtro não voltou às 7');
      return `${linha} | filtro: 3 compras`;
    });

    await passo('Estados, Órgãos e Empresas', p, async () => {
      await abrirAba(p, 'estados');
      const uf = await texto(p, '#mk-aba-conteudo tbody');
      exigir(/AM/.test(uf) && await p.locator('.mk-barra-uf').count() === 1, 'estados: ' + uf);
      await abrirAba(p, 'orgaos');
      const compra = await texto(p, '#mk-quem-compra tbody');
      exigir(/HOSPITAL FICTICIO E2E/.test(compra) && /PREFEITURA FICTICIA E2E MERCADO/.test(compra), 'órgãos: ' + compra);
      await abrirAba(p, 'empresas');
      const primeira = await texto(p, '#mk-quem-ganha tbody tr:first-child');
      exigir(/GRAMPOS ALFA FICTICIA/.test(primeira) && /\b4\b/.test(primeira) && /57,1%/.test(primeira), 'Alfa (2 contratos + 2 itens, 4 de 7) deveria liderar: ' + primeira);
      return `${uf} | ${primeira}`;
    });

    await passo('Marcas: marca vencedora, vezes, preço e órgãos que aceitaram; clicar filtra', p, async () => {
      await abrirAba(p, 'marcas');
      const linha = await texto(p, '#mk-aba-conteudo tr[data-mk-filtro="marca"]');
      exigir(/GRAMPOLINE/.test(linha) && /R\$\s?11,00/.test(linha) && /HOSPITAL FICTICIO E2E/.test(linha), 'marca: ' + linha);
      await p.click('#mk-aba-conteudo tr[data-mk-filtro="marca"] button');
      await p.waitForFunction(() => document.querySelector('#mk-aba-conteudo')?.dataset.aba === 'correspondencias', null, { timeout: 10000 });
      exigir(await linhas(p) === 1, 'filtro por marca deveria deixar 1 compra');
      await p.click('[data-mk-limpar]');
      return linha;
    });

    await passo('Contratação futura: item do PCA com o termo', p, async () => {
      await abrirAba(p, 'futura');
      const linha = await texto(p, '#mk-aba-conteudo tbody');
      exigir(/GRAMPO E2EMK 26\/6 PLANEJADO/.test(linha) && /SECRETARIA FICTICIA E2E/.test(linha) && /R\$\s?6\.000,00/.test(linha), 'PCA: ' + linha);
      return linha;
    });

    await passo('Baixar planilha (CSV) da aba aberta', p, async () => {
      await abrirAba(p, 'marcas');
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#mk-csv')]);
      const csv = fs.readFileSync(await dl.path(), 'utf8');
      exigir(dl.suggestedFilename().startsWith('mercado-marcas-') && /^\ufeffMarca;Vezes que ganhou/.test(csv) && /GRAMPOLINE;1;11/.test(csv), 'csv: ' + dl.suggestedFilename() + ' ' + csv.slice(0, 160));
      return dl.suggestedFilename();
    });

    await passo('"Analisar empresa" abre a análise do concorrente com o CNPJ', p, async () => {
      await abrirAba(p, 'empresas');
      await p.click(`#mk-quem-ganha [data-mk-cnpj="${ALFA.cnpj}"]`);
      await p.waitForFunction(() => document.querySelector('#empresa')?.classList.contains('ativa'), null, { timeout: 10000 });
      const cnpj = await p.inputValue('#emp-cnpj');
      exigir(cnpj === ALFA.cnpj, 'CNPJ na análise: ' + cnpj);
      return 'Analisar concorrente aberto com ' + cnpj;
    });

    await passo('volta à aba: a última pesquisa reaparece sozinha', p, async () => {
      await p.goto(SITE + '/painel.html');
      await p.locator('nav button[data-alvo="diagnostico"]').dispatchEvent('click');
      await p.waitForSelector('#mk-angulos .btn-subaba', { timeout: 30000 });
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

    await passo('celular (390 px): sem rolagem lateral em nenhuma das 7 abas', p, async () => {
      await p.click('#dg-subabas [data-subaba="pesquisa"]');
      await p.setViewportSize({ width: 390, height: 844 });
      await pesquisar(p, 'grampo e2emk', 'AM');
      await esperarFutura(p);
      for (const id of ABAS) {
        await abrirAba(p, id);
        const sobra = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        exigir(sobra <= 1, `aba ${id}: página ${sobra}px mais larga que a tela`);
      }
      await abrirAba(p, 'marcas');
      await p.screenshot({ path: path.join(PRINTS, 'celular-390-marcas.png'), fullPage: true });
      await p.setViewportSize({ width: 1280, height: 900 });
      return 'largura ok nas 7 abas';
    });

    // Retrato real para comparar com o Siga (papel no Siga): base local + Pesquisa de Preços do Compras.gov ao vivo.
    await passo('termo real "papel A4" (Compras.gov ao vivo): print de cada uma das 7 abas', p, async () => {
      await p.unroute('**/api/comprasgov-marcas-produto*', aoVivoVazio);
      await pesquisar(p, 'papel A4');
      // A 1ª consulta ao Compras.gov às vezes passa dos 20 s da tela (fonte fria); a 2ª já vem do cache de 10 min.
      if (!(await p.locator('#mk-angulos .btn-subaba').count())) await pesquisar(p, 'papel A4');
      await esperarFutura(p);
      const titulos = (await p.locator('#mk-angulos .btn-subaba').allInnerTexts()).map((t) => t.trim());
      // Página inteira com 200 compras passa de 30 mil px: o print é a tela a partir das abas.
      await p.setViewportSize({ width: 1280, height: 1500 });
      for (const [i, id] of ABAS.entries()) {
        await abrirAba(p, id);
        await p.evaluate(() => document.getElementById('mk-angulos-caixa').scrollIntoView({ block: 'start' }));
        await p.screenshot({ path: path.join(PRINTS, `papel-a4-${i + 1}-${id}.png`) });
      }
      await p.setViewportSize({ width: 1280, height: 900 });
      const js = errosJs(p); exigir(!js.length, 'erros de console: ' + js.join(' | '));
      exigir(!/Marcas \(0\)/.test(titulos.join(' ')), 'papel A4 sem marca: ' + titulos.join(' | '));
      return `${titulos.join(' · ')}; avisos: ${(await p.locator('#mk-resultado .aviso').allInnerTexts()).join(' / ').slice(0, 200) || 'nenhum'}`;
    });
  } finally {
    await limpar().catch((e) => console.log('limpeza:', e.message));
    await navegador.close();
  }
  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 1));
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : `E2E MERCADO 7 ABAS OK (${resultados.length}/${resultados.length})`);
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
