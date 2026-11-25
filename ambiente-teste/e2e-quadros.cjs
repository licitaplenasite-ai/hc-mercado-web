/* global document, localStorage */
// E2E local de Quadros (quadros.html + supabase/funil_quadros.sql): criar/renomear/excluir quadro e colunas,
// cartão ligado a processo, arrastar e soltar, coluna com cartão protegida, filtro por empresa e RLS. Prints 1280 e 375.
//   PORTA_TESTE=8893 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8893 node ambiente-teste/e2e-quadros.cjs
// Banco LOCAL com supabase/funil_quadros.sql aplicado. Só mexe em quadros com nome "E2E …" e apaga no fim.
const path = require('node:path'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-quadros';
const { passo, exigir, novaPagina, comoUsuario, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const EMP = seed.ids.empA1, EMP2 = seed.ids.empA2, PROC = seed.ids.procA;
const limpar = () => psql(`delete from operacao_quadros where nome like 'E2E %';`);
const colunas = (p) => p.locator('#quadro .q-coluna h3').allInnerTexts();
async function print(p, nome) { await p.screenshot({ path: path.join(PRINTS, nome), fullPage: false }); }
async function nomear(p, texto) {
  const dlg = p.locator('#dlg-nome');
  await dlg.waitFor({ state: 'visible' });
  await p.fill('#dlg-nome-campo', texto);
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await dlg.waitFor({ state: 'hidden' });
}

(async () => {
  require('node:fs').mkdirSync(PRINTS, { recursive: true });
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  p.on('dialog', (d) => d.accept()); // confirm() de excluir
  limpar();
  let quadroId;
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await passo('menu leva a Quadros com a empresa ativa', p, async () => {
      await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), EMP);
      await p.goto(SITE + '/processos.html');
      // Casca única (25/11): o menu de uma tela aberta sozinha entra na casca (app.html#/quadros) já em Quadros.
      await p.locator('#menu-principal a[href="quadros.html"]').click();
      await p.waitForURL(/\/app(\.html)?#\/quadros/);
      const tela = p.frameLocator('.casca-tela.ativa');
      await tela.locator('#empresa-atual').waitFor({ state: 'attached', timeout: 30000 });
      await p.waitForFunction((id) => document.querySelector('.casca-tela.ativa')?.contentDocument.getElementById('empresa-atual')?.value === id, EMP, { timeout: 30000 });
      // O resto do roteiro testa a tela em si: segue com ela aberta direto.
      await p.goto(SITE + '/quadros.html');
      await p.waitForFunction((id) => document.getElementById('empresa-atual')?.value === id, EMP, { timeout: 30000 });
    });
    await passo('criar quadro traz 3 colunas padrão', p, async () => {
      await p.click('#btn-novo-quadro');
      await nomear(p, 'E2E Rotina da semana');
      await p.waitForFunction(() => document.querySelectorAll('#quadro .q-coluna').length === 3);
      exigir(JSON.stringify(await colunas(p)) === JSON.stringify(['A fazer', 'Fazendo', 'Feito']), 'colunas padrão: ' + await colunas(p));
      quadroId = psql(`select id from operacao_quadros where nome='E2E Rotina da semana' and empresa_id='${EMP}'`);
      exigir(quadroId, 'quadro não foi para o banco da empresa ativa');
    });
    await passo('coluna nova, renomear e reordenar', p, async () => {
      await p.click('#btn-nova-coluna');
      await nomear(p, 'Revisão');
      await p.waitForFunction(() => document.querySelectorAll('#quadro .q-coluna').length === 4);
      await p.locator('[aria-label="Renomear coluna A fazer"]').click();
      await nomear(p, 'Pendente');
      await p.locator('[aria-label="Mover coluna Revisão para a esquerda"]').click();
      await p.waitForFunction(() => [...document.querySelectorAll('#quadro .q-coluna h3')].map((h) => h.textContent).join('|') === 'Pendente|Fazendo|Revisão|Feito');
      const banco = psql(`select string_agg(nome, '|' order by ordem) from operacao_quadros_colunas where quadro_id='${quadroId}'`);
      exigir(banco === 'Pendente|Fazendo|Revisão|Feito', 'ordem no banco: ' + banco);
    });
    await passo('cartão com processo ligado e prazo', p, async () => {
      await p.locator('.q-coluna:has(h3:text-is("Pendente")) [data-novo-cartao]').click();
      await p.fill('#c-titulo', 'Cotar papel A4 com 3 fornecedores');
      await p.fill('#c-descricao', 'Pedir proposta por e-mail e anexar no processo.');
      await p.fill('#c-prazo', '2026-11-25');
      await p.selectOption('#c-processo', PROC);
      await p.locator('#dlg-cartao').getByRole('button', { name: 'Salvar' }).click();
      const cartao = p.locator('.q-cartao', { hasText: 'Cotar papel A4' });
      await cartao.waitFor();
      exigir(await cartao.locator(`a[href="processos.html?processo=${PROC}"]`).count() === 1, 'sem link para o processo');
      exigir(psql(`select processo_id from operacao_quadros_cartoes where quadro_id='${quadroId}'`) === PROC, 'processo não gravado');
      await print(p, '01-quadro-1280.png');
    });
    await passo('arrastar o cartão para Feito grava a coluna', p, async () => {
      // Mouse real em vez de dragTo: o dragTo rola o quadro no meio do arraste e o Chromium cancela o drag.
      await p.evaluate(() => { document.getElementById('quadro').scrollLeft = 0; });
      const de = await p.locator('.q-cartao', { hasText: 'Cotar papel A4' }).boundingBox();
      const para = await p.locator('.q-coluna:has(h3:text-is("Feito")) .q-lista').boundingBox();
      await p.mouse.move(de.x + de.width / 2, de.y + de.height / 2);
      await p.mouse.down();
      await p.mouse.move(para.x + 30, para.y + para.height / 2, { steps: 10 });
      await p.mouse.up();
      await p.locator('.q-coluna:has(h3:text-is("Feito")) .q-cartao').waitFor();
      const col = psql(`select c.nome from operacao_quadros_cartoes k join operacao_quadros_colunas c on c.id=k.coluna_id where k.quadro_id='${quadroId}'`);
      exigir(col === 'Feito', 'banco ficou em ' + col);
    });
    await passo('coluna com cartão não é excluída; vazia é', p, async () => {
      await p.locator('[aria-label="Excluir coluna Feito"]').click();
      await p.locator('#aviso.erro', { hasText: 'Mova ou apague os cartões' }).waitFor();
      await p.locator('[aria-label="Excluir coluna Revisão"]').click();
      await p.waitForFunction(() => document.querySelectorAll('#quadro .q-coluna').length === 3);
    });
    await passo('editar cartão pelo diálogo muda de coluna (sem arrastar)', p, async () => {
      await p.locator('[data-editar-cartao]').click();
      await p.selectOption('#c-coluna', { label: 'Fazendo' });
      await p.locator('#dlg-cartao').getByRole('button', { name: 'Salvar' }).click();
      await p.locator('.q-coluna:has(h3:text-is("Fazendo")) .q-cartao').waitFor();
    });
    await passo('renomear o quadro', p, async () => {
      await p.click('#btn-renomear-quadro');
      await nomear(p, 'E2E Rotina de cotações');
      await p.waitForFunction(() => document.querySelector('#quadro-atual option:checked')?.textContent === 'E2E Rotina de cotações');
    });
    await passo('outra empresa não mostra o quadro (filtro por CNPJ)', p, async () => {
      await p.selectOption('#empresa-atual', EMP2);
      await p.locator('[data-novo-quadro]').waitFor();
      exigir(await p.evaluate(() => localStorage.getItem('licitaplena_empresa_operacional_id')) === EMP2, 'filtro não ficou salvo');
      await p.selectOption('#empresa-atual', EMP);
      await p.locator('.q-cartao').waitFor();
    });
    await passo('RLS: outra organização não lê; operador da empresa lê', null, async () => {
      const fora = await comoUsuario(seed.usuarios.outra_org, `/rest/v1/operacao_quadros_cartoes?quadro_id=eq.${quadroId}&select=id`);
      exigir(fora.status === 200 && fora.corpo === '[]', 'outra org leu: ' + fora.corpo);
      const op = await comoUsuario(seed.usuarios.operador, `/rest/v1/operacao_quadros?id=eq.${quadroId}&select=nome`);
      exigir(/E2E Rotina de cotações/.test(op.corpo), 'operador da empresa não leu: ' + op.corpo);
      const leitura = await comoUsuario(seed.usuarios.leitura, `/rest/v1/operacao_quadros?id=eq.${quadroId}`, { method: 'PATCH', body: JSON.stringify({ nome: 'E2E invadido' }), headers: { Prefer: 'return=representation' } });
      exigir(leitura.corpo === '[]', 'papel leitura renomeou: ' + leitura.corpo);
    });
    await passo('celular 375: colunas roláveis e diálogo cabe', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 });
      await p.reload();
      await p.locator('.q-cartao').waitFor({ timeout: 30000 });
      exigir(await p.evaluate(() => document.documentElement.scrollWidth <= 375), 'rolagem lateral na página');
      await print(p, '02-quadro-375.png');
      await p.locator('[data-editar-cartao]').click();
      await print(p, '03-cartao-375.png');
      await p.locator('#dlg-cartao').getByRole('button', { name: 'Cancelar' }).click();
      await p.setViewportSize({ width: 1280, height: 900 });
    });
    await passo('excluir o quadro leva colunas e cartões', p, async () => {
      await p.click('#btn-apagar-quadro');
      await p.locator('[data-novo-quadro]').waitFor();
      exigir(psql(`select count(*) from operacao_quadros_cartoes where quadro_id='${quadroId}'`) === '0', 'cartões ficaram');
      exigir(psql(`select count(*) from operacao_processos where id='${PROC}'`) === '1', 'processo ligado foi apagado');
    });
    exigir(!p.erros.some((e) => /pageerror/.test(e)), 'erros de página: ' + p.erros.join(' | '));
  } finally {
    limpar();
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} passos ok`);
  if (p.erros.length) console.log('Avisos da página:', [...new Set(p.erros)].slice(0, 10).join(' | '));
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
