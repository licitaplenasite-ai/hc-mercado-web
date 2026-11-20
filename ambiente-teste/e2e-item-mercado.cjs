/* global document, window -- usados só dentro de p.evaluate (rodam no navegador) */
// E2E local do "Ver mercado deste item" (item-mercado-ui.js). Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8897 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8897 node ambiente-teste/e2e-item-mercado.cjs
// Usa PNCP e Compras.gov de verdade (dados abertos). O item de teste do CRM é criado e apagado aqui.
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-item-mercado';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
// Pregão real do Compras.gov com CATMAT nos itens (item 1 = papel A4, CATMAT 461828).
const NUMERO = '03567753000171-1-000025/2026';
const ID_TESTE = 'E2E-MERCADO-1';
const fim = (p) => p.waitForFunction((sel) => /compra\(s\) encontradas|Nenhuma compra|não respondeu|curta demais/.test(document.querySelector(sel)?.textContent || ''), '.item-mercado [role="status"], .itens-mercado [role="status"]', { timeout: 120000 });

(async () => {
  const { ids } = seed;
  psql(`delete from operacao_itens_resultado where identificador='${ID_TESTE}';
    insert into operacao_itens_resultado (organizacao_id, processo_id, identificador, descricao, quantidade, unidade, codigo_catalogo)
    select organizacao_id, id, '${ID_TESTE}', '(ID461828) PAPEL PARA IMPRESSÃO FORMATADO, TIPO: SULFITE, TAMANHO: A4', 500, 'Embalagem', '461828' from operacao_processos where id='${ids.procA}';`);
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  await p.setViewportSize({ width: 1280, height: 900 });
  try {
    await passo('CRM: Ver mercado deste item pelo CATMAT, 4 abas e Usar preço', p, async () => {
      await p.goto(`${SITE}/sistema?empresa=${ids.empA1}&processo=${ids.procA}`);
      const li = p.locator('#itens-processo [data-item-lista] li', { hasText: ID_TESTE });
      await li.waitFor({ timeout: 30000 });
      await li.getByRole('button', { name: 'Ver mercado deste item' }).click();
      await fim(p);
      const status = await li.locator('.itens-mercado [role="status"]').last().innerText();
      exigir(/CATMAT 461828/.test(status), `não usou o CATMAT: ${status}`);
      const abas = await li.getByRole('tab').allInnerTexts();
      exigir(abas.join('|') === 'Histórico|Concorrência|Marcas relevantes|Preços praticados', `abas: ${abas.join('|')}`);
      const historico = await li.locator('[role="tabpanel"]:not([hidden]) tbody tr').count();
      exigir(historico >= 5, `histórico com ${historico} linhas`);
      await li.getByRole('tab', { name: 'Concorrência' }).click();
      const analisar = await li.getByRole('button', { name: 'Analisar concorrente' }).count();
      exigir(analisar >= 1, 'sem botão Analisar concorrente');
      const cnpjs = await li.locator('[role="tabpanel"]:not([hidden]) td[data-rotulo="Empresa"] .mercado-desc').allInnerTexts();
      exigir(cnpjs.some((c) => /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(c)), 'vencedor sem CNPJ');
      await li.locator('.itens-mercado').last().screenshot({ path: path.join(PRINTS, 'crm-concorrencia-1280.png') });
      await li.getByRole('tab', { name: 'Marcas relevantes' }).click();
      const marcas = await li.locator('[role="tabpanel"]:not([hidden]) td[data-rotulo="Marca"]').allInnerTexts();
      await li.getByRole('tab', { name: 'Preços praticados' }).click();
      await li.locator('.itens-mercado').last().screenshot({ path: path.join(PRINTS, 'crm-precos-1280.png') });
      const usar = li.getByRole('button', { name: /^Usar preço/ });
      const rotulo = await usar.innerText();
      await usar.click();
      const valor = await p.locator('#itens-processo form [name=valorUnitario]').inputValue();
      const esperado = /R\$ ([\d.]+),(\d{2})/.exec(rotulo);
      exigir(esperado && valor === `${esperado[1].replace(/\./g, '')}.${esperado[2]}`, `valor unitário "${valor}" ≠ ${rotulo}`);
      await p.locator('#itens-processo form').getByRole('button', { name: /Cancelar/ }).click().catch(() => {});
      return `${status} | histórico ${historico} linhas | ${analisar} concorrente(s) | marcas: ${marcas.slice(0, 5).join(', ')} | ${rotulo} -> valor unitário ${valor}`;
    });
    await passo('CRM em 375 sem rolagem horizontal', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 });
      await p.waitForTimeout(500);
      const li = p.locator('#itens-processo [data-item-lista] li', { hasText: ID_TESTE });
      await li.getByRole('tab', { name: 'Concorrência' }).click();
      const { largura, janela } = await p.evaluate(() => ({ largura: document.documentElement.scrollWidth, janela: window.innerWidth }));
      await li.locator('.itens-mercado').last().screenshot({ path: path.join(PRINTS, 'crm-concorrencia-375.png') });
      exigir(largura <= janela, `rolagem horizontal: ${largura} > ${janela}`);
      return `scrollWidth ${largura} / innerWidth ${janela}`;
    });

    await p.setViewportSize({ width: 1280, height: 900 });
    const futuro = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    await p.route('**/api/pncp-proxy**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 1, items: [{ numero_controle_pncp: NUMERO,
      description: 'Material de expediente (e2e item mercado)', title: 'Material de expediente (e2e item mercado)', uf: 'SP', municipio_nome: 'São Paulo', orgao_nome: 'Órgão do pregão real',
      data_fim_vigencia: `${futuro}T17:00:00`, data_publicacao_pncp: '2026-11-18T10:00:00', modalidade_licitacao_nome: 'Pregão - Eletrônico', usuario_nome: 'COMPRASNET - SIASG' }] }) }));
    await passo('Painel: Ver Itens do PNCP traz o botão e abre o mercado pelo CATMAT', p, async () => {
      await p.goto(SITE + '/painel.html');
      await p.locator('nav button[data-alvo="oportunidades"]').dispatchEvent('click');
      await p.waitForSelector('#op-palavras', { state: 'visible' });
      await p.evaluate(() => { document.querySelector('#op-uf').querySelectorAll('option').forEach((o) => { o.selected = false; }); });
      await p.fill('#op-palavras', 'expediente'); await p.click('#op-buscar');
      const card = p.locator('#op-resultado .boletim-card').first();
      await card.waitFor({ timeout: 20000 });
      await card.locator('summary', { hasText: 'Ver detalhes do edital' }).click();
      await card.getByRole('button', { name: /Ver Itens/ }).click();
      const item1 = card.locator('.item-licitacao').first();
      await item1.getByRole('button', { name: 'Ver mercado deste item' }).waitFor({ timeout: 60000 });
      await item1.getByRole('button', { name: 'Ver mercado deste item' }).click();
      await fim(p);
      const status = await item1.locator('.item-mercado [role="status"]').innerText();
      exigir(/CATMAT 461828/.test(status), `não usou o CATMAT do PNCP: ${status}`);
      exigir(!(await item1.getByRole('button', { name: /^Usar preço/ }).count()), 'no painel não há item do CRM para receber o preço');
      await item1.getByRole('tab', { name: 'Preços praticados' }).click();
      await item1.screenshot({ path: path.join(PRINTS, 'painel-itens-precos-1280.png') });
      await item1.getByRole('tab', { name: 'Concorrência' }).click();
      await item1.screenshot({ path: path.join(PRINTS, 'painel-itens-concorrencia-1280.png') });
      await p.setViewportSize({ width: 375, height: 812 }); await p.waitForTimeout(500);
      const { largura, janela } = await p.evaluate(() => ({ largura: document.documentElement.scrollWidth, janela: window.innerWidth }));
      await item1.screenshot({ path: path.join(PRINTS, 'painel-itens-concorrencia-375.png') });
      await p.setViewportSize({ width: 1280, height: 900 });
      exigir(largura <= janela, `rolagem horizontal em 375: ${largura} > ${janela}`);
      return `${status} | 375: ${largura}/${janela}`;
    });
    await passo('Painel: Analisar concorrente abre a análise por CNPJ', p, async () => {
      const b = p.locator('.item-mercado [role="tabpanel"]:not([hidden])').getByRole('button', { name: 'Analisar concorrente' }).first();
      await b.click();
      await p.waitForSelector('#empresa.ativa', { timeout: 10000 });
      const cnpj = await p.inputValue('#emp-cnpj');
      exigir(/^\d{14}$/.test(cnpj), `CNPJ não foi para a análise: "${cnpj}"`);
      return `CNPJ ${cnpj} na tela Analisar concorrente`;
    });
    await passo('Resumo do Edital: botão em cada item da lista', p, async () => {
      await p.locator('nav button[data-alvo="oportunidades"]').dispatchEvent('click');
      const card = p.locator('#op-resultado .boletim-card').first();
      await card.getByRole('button', { name: /Resumir edital/ }).click();
      await p.waitForSelector('#modal-ia-fundo.aberto', { timeout: 15000 });
      const secao = p.locator('[data-resumo-secao="Consultar itens da oportunidade"]');
      await secao.waitFor({ timeout: 30000 });
      if (!(await secao.evaluate((d) => d.open))) await secao.locator('summary').click();
      const botoes = secao.getByRole('button', { name: 'Ver mercado deste item' });
      await botoes.first().waitFor({ timeout: 30000 });
      const n = await botoes.count();
      await botoes.first().click();
      await fim(p);
      await secao.screenshot({ path: path.join(PRINTS, 'resumo-itens-1280.png') });
      return `${n} botão(ões) na lista de itens do resumo`;
    });
    await passo('erros de página', null, async () => {
      const graves = p.erros.filter((e) => /pageerror/.test(e));
      exigir(!graves.length, graves.join(' | '));
      return `${p.erros.length} aviso(s) de rede/console (não fatais)`;
    });
  } finally {
    psql(`delete from operacao_itens_resultado where identificador='${ID_TESTE}';`);
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.map((f) => f.nome).join('; ')}` : 'OK');
  process.exit(falhas.length ? 1 : 0);
})();
