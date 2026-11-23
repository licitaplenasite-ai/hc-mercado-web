/* global document */
// E2E das 4 ideias trazidas do PrecificaJá (20/11): cenários de margem por item, arquivo para importar no portal,
// andamento do item ganho e catálogo em PDF. Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8800 node ambiente-teste/servidor.cjs
//   PORTA_TESTE=8800 node ambiente-teste/e2e-proposta-ideias.cjs
// Processo, itens e produto fictícios criados aqui são apagados no fim.
const fs = require('node:fs'), path = require('node:path');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-proposta-ideias';
const { passo, exigir, novaPagina, entrar, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

async function servico(metodo, caminho, corpo) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const lerDownload = async (d) => fs.readFileSync(await d.path());

async function main() {
  const { usuarios: U, ids } = seed;
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const ctx = {};
  try {
    const p = await novaPagina(navegador);
    await entrar(p, U.gestor);
    ctx.proc = (await servico('POST', '/rest/v1/operacao_processos', { organizacao_id: ids.orgA, empresa_id: ids.empA1, objeto: 'Processo fictício e2e proposta-ideias', numero: 'E2E-IDEIAS' }))[0];
    ctx.itens = await servico('POST', '/rest/v1/operacao_itens_resultado', [
      { organizacao_id: ids.orgA, processo_id: ctx.proc.id, identificador: '1', tipo: 'item', situacao: 'pendente', descricao: 'Caneta esferográfica azul; ponta média', quantidade: 10, unidade: 'UN', marca: 'Bic', modelo: 'Cristal', custo_unitario: 100, valor_unitario_proposta: 140 },
      { organizacao_id: ids.orgA, processo_id: ctx.proc.id, identificador: '2', tipo: 'item', situacao: 'pendente', descricao: 'Papel A4', quantidade: 2.5, unidade: 'CX', marca: null, modelo: null, custo_unitario: null, valor_unitario_proposta: 0.33 }]);
    const urlSistema = `${SITE}/sistema?empresa=${ids.empA1}&processo=${ctx.proc.id}#aba=itens`;

    await passo('cenários de margem 10/15/30% + margem própria e "Usar este preço"', p, async () => {
      await p.goto(urlSistema);
      await p.waitForSelector('#itens-processo [data-premissas]:not([hidden])', { timeout: 30000 });
      for (const [id, v] of [['tributos', '10'], ['garantia', '0']]) { await p.fill('#itens-premissa-' + id, v); await p.press('#itens-premissa-' + id, 'Tab'); await p.waitForTimeout(800); }
      const item1 = ctx.itens.find((i) => i.identificador === '1').id;
      await p.locator(`[data-item-mais-ferramentas="${item1}"] > summary`).click(); // ferramentas de preço fechadas por item
      const caixa = p.locator(`[data-cenarios="${item1}"]`);
      await caixa.locator('li').nth(2).waitFor({ timeout: 15000 });
      await p.fill(`[data-margem-propria="${item1}"]`, '12,5');
      await caixa.locator('li').nth(3).waitFor({ timeout: 5000 });
      const linhas = (await caixa.locator('li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
      exigir(/Margem 10%: preço unitário mínimo R\$ 125,00 · lucro por unidade R\$ 12,50 · lucro total R\$ 125,00/.test(linhas[0]), '10%: ' + linhas[0]);
      exigir(/Margem 15%: preço unitário mínimo R\$ 133,34/.test(linhas[1]) && /Margem 30%: preço unitário mínimo R\$ 166,67/.test(linhas[2]), linhas.join(' | '));
      exigir(/Margem própria 12,5%: preço unitário mínimo R\$ 129,04/.test(linhas[3]), 'própria: ' + linhas[3]);
      await caixa.locator('li').nth(1).getByRole('button', { name: 'Usar este preço' }).click();
      const valor = await p.locator('#itens-processo form[data-item-form] [name=valorUnitario]').inputValue();
      exigir(valor === '133.34', 'valor unitário no formulário: ' + valor);
      await caixa.scrollIntoViewIfNeeded();
      return `${linhas.join(' | ')} → formulário ${valor} (não salvo)`;
    });

    await passo('arquivo para importar no portal (CSV genérico)', p, async () => {
      await p.click('#itens-processo [data-item-cancelar]').catch(() => {});
      const [d] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#itens-processo [data-portal-baixar]')]);
      const texto = (await lerDownload(d)).toString('utf8');
      exigir(texto.startsWith('\uFEFFitem;descricao;marca;modelo;unidade;quantidade;valor_unitario;valor_total\r\n'), 'cabeçalho: ' + texto.slice(0, 120));
      exigir(texto.includes('1;"Caneta esferográfica azul; ponta média";Bic;Cristal;UN;10;140,00;1400,00'), 'linha 1: ' + texto);
      exigir(texto.includes('2;Papel A4;;;CX;2,5;0,33;0,83'), 'linha 2: ' + texto);
      fs.writeFileSync(path.join(PRINTS, d.suggestedFilename()), texto);
      return `${d.suggestedFilename()} · ${(await p.innerText('#itens-processo [data-planilha-estado]'))}`;
    });

    await passo('andamento do item ganho e contador no resumo do processo', p, async () => {
      const item1 = ctx.itens.find((i) => i.identificador === '1').id;
      await servico('PATCH', `/rest/v1/operacao_itens_resultado?id=eq.${item1}`, { situacao: 'ganho', valor_unitario_homologado: 130, valor_homologado: 1300 });
      await p.goto(`${SITE}/processos.html?empresa=${ids.empA1}&processo=${ctx.proc.id}`);
      await p.waitForSelector(`[data-andamento-item="${item1}"]`, { timeout: 30000 });
      const antes = (await p.innerText('[data-contador-andamento]')).replace(/\s+/g, ' ');
      exigir(/0 de 1 entregues/.test(antes) && /1 aguardando compra/.test(antes), 'contador antes: ' + antes);
      await p.selectOption(`[data-andamento-passo="${item1}"]`, 'enviado');
      await p.fill(`[data-andamento-rastreio="${item1}"]`, 'https://rastreio.exemplo/BR123');
      await p.click(`[data-salvar-andamento="${item1}"]`);
      await p.waitForFunction(() => /1 enviados/.test(document.querySelector('[data-contador-andamento]')?.innerText || ''), null, { timeout: 15000 });
      const [banco] = await servico('GET', `/rest/v1/operacao_itens_resultado?id=eq.${item1}&select=entrega_situacao,comprado_em,enviado_em,entregue_em,rastreio`);
      const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
      exigir(banco.entrega_situacao === 'enviado' && banco.comprado_em === hoje && banco.enviado_em === hoje && banco.entregue_em === null && banco.rastreio === 'https://rastreio.exemplo/BR123', 'banco: ' + JSON.stringify(banco));
      await p.locator(`[data-andamento-item="${item1}"]`).scrollIntoViewIfNeeded();
      return `${(await p.innerText(`[data-andamento-item="${item1}"] small`)).replace(/\s+/g, ' ')} · ${(await p.innerText('[data-contador-andamento]')).replace(/\s+/g, ' ')}`;
    });

    await passo('catálogo em PDF dos selecionados (sem custo nem fornecedor)', p, async () => {
      ctx.produto = (await servico('POST', '/rest/v1/operacao_catalogo_produtos', { organizacao_id: ids.orgA, empresa_id: ids.empA1, nome: 'Produto e2e catálogo PDF', marca: 'MarcaE2E', modelo: 'M-1',
        unidade: 'UN', descricao: 'Descrição fictícia para o cliente', custo_unitario: 7.77, fornecedor_nome: 'Fornecedor secreto' }))[0];
      await p.goto(`${SITE}/operacao.html?aba=catalogo`);
      await p.waitForSelector('#empresa-atual', { timeout: 20000 });
      await p.selectOption('#empresa-atual', ids.empA1);
      await p.waitForSelector(`[data-selecionar="${ctx.produto.id}"]`, { timeout: 20000 });
      await p.check(`[data-selecionar="${ctx.produto.id}"]`);
      const rotulo = await p.innerText('#catalogo-produtos [data-acao="pdf"]');
      exigir(/1 selecionado/.test(rotulo), 'botão: ' + rotulo);
      const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#catalogo-produtos [data-acao="pdf"]')]);
      const bytes = await lerDownload(d);
      exigir(bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length > 800, `PDF inválido (${bytes.length} bytes)`);
      fs.writeFileSync(path.join(PRINTS, 'catalogo-produtos.pdf'), bytes);
      // pdf-parse em processo separado: o pdf.js dele falha dentro do mesmo processo do Playwright.
      const leitura = require('node:child_process').spawnSync(process.execPath, ['-e',
        "require('pdf-parse/lib/pdf-parse.js')(require('fs').readFileSync(process.argv[1])).then((r) => process.stdout.write(r.text))", path.join(PRINTS, 'catalogo-produtos.pdf')],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
      const texto = leitura.stdout || '';
      exigir(/Produto e2e catálogo PDF/.test(texto) && /MarcaE2E \/ M-1/.test(texto) && /Unidade: UN/.test(texto), 'texto do PDF: ' + texto.slice(0, 300));
      exigir(!/7,77|7\.77|Fornecedor secreto/.test(texto), 'PDF vazou custo/fornecedor');
      return `${d.suggestedFilename()} ${bytes.length} bytes · ${await p.innerText('#catalogo-produtos .catalogo-pdf-status')}`;
    });

    await passo('celular 375px: cenários e andamento cabem na tela', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 });
      await p.goto(`${SITE}/processos.html?empresa=${ids.empA1}&processo=${ctx.proc.id}`);
      const item1 = ctx.itens.find((i) => i.identificador === '1').id;
      await p.waitForSelector(`[data-andamento-item="${item1}"]`, { timeout: 30000 });
      await p.locator(`[data-andamento-item="${item1}"]`).scrollIntoViewIfNeeded();
      const largura = await p.evaluate(() => document.documentElement.scrollWidth);
      await p.screenshot({ path: path.join(PRINTS, '375-andamento.png') });
      await p.goto(urlSistema);
      await p.locator(`[data-item-mais-ferramentas="${item1}"] > summary`).click();
      await p.locator(`[data-cenarios="${item1}"] li`).nth(2).waitFor({ timeout: 30000 });
      await p.locator(`[data-cenarios="${item1}"]`).scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(PRINTS, '375-cenarios.png') });
      const largura2 = await p.evaluate(() => document.documentElement.scrollWidth);
      await p.setViewportSize({ width: 1366, height: 900 });
      exigir(largura <= 380 && largura2 <= 380, `rolagem lateral: processos ${largura}px, sistema ${largura2}px`);
      return `sem rolagem lateral (processos ${largura}px, sistema ${largura2}px)`;
    });
    const js = p.erros.filter((e) => e.startsWith('pageerror'));
    await passo('sem erro de página', null, async () => { exigir(!js.length, js.join(' | ')); return 'nenhum pageerror'; });
  } finally {
    if (ctx.proc) await servico('DELETE', `/rest/v1/operacao_processos?id=eq.${ctx.proc.id}`).catch((e) => console.log('limpeza processo:', e.message));
    if (ctx.produto) await servico('DELETE', `/rest/v1/operacao_catalogo_produtos?id=eq.${ctx.produto.id}`).catch((e) => console.log('limpeza produto:', e.message));
    await navegador.close();
  }
  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 1));
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : `E2E PROPOSTA-IDEIAS OK (${resultados.length}/${resultados.length})`);
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
