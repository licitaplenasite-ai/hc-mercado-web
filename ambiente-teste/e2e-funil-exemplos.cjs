/* global document, localStorage */
// E2E local: exemplos do primeiro acesso no Funil (funil-exemplos-ui.js + supabase/funil_exemplos.sql) e o link
// "Abrir no Funil" do Meu dia (painel.html?empresa=<id>&processo=<id>#kanban). Prints 1280 e 375, claro e escuro.
//   PORTA_TESTE=8897 node ambiente-teste/servidor.cjs
//   PORTA_TESTE=8897 node ambiente-teste/e2e-funil-exemplos.cjs
// Banco LOCAL com planos_e_recursos.sql e funil_exemplos.sql aplicados. Cria uma empresa fictícia vazia e apaga no fim.
const path = require('node:path'), fs = require('node:fs'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-fase2-exemplos';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => {
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
const ORG = seed.ids.orgA, OUTRA = seed.ids.empA1, EMP = '9e000000-0000-4000-8000-0000000000e1';
const limpar = () => psql(`delete from operacao_empresas where id='${EMP}';`);
const contar = (onde) => Number(psql(`select count(*) from operacao_processos where empresa_id='${EMP}' and ${onde}`));
const card = (p, id) => p.locator(`#kanban-quadro .kanban-card[data-id="${id}"]`);
const print = (p, nome) => p.screenshot({ path: path.join(PRINTS, nome), fullPage: false });

(async () => {
  fs.mkdirSync(PRINTS, { recursive: true });
  limpar();
  psql(`insert into operacao_empresas(id,organizacao_id,razao_social,cnpj,responsavel) values ('${EMP}','${ORG}','Empresa Nova Exemplo Teste LTDA','11222333000262','Gestora Teste');`);
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  p.on('dialog', (d) => d.accept());
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await passo('Funil vazio mostra o convite e não cria nada sozinho', p, async () => {
      await p.goto(SITE + '/painel.html#kanban');
      await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), EMP);
      await p.reload();
      await p.waitForSelector('#funil-exemplos [data-fx="criar"]', { timeout: 30000 });
      exigir(contar('true') === 0, 'criou processo sem clique');
      await print(p, '01-convite-1280.png');
    });
    await passo('"Ver o sistema com exemplos" cria 4 cartões [Exemplo] com prazos e tarefas', p, async () => {
      await p.click('#funil-exemplos [data-fx="criar"]');
      await p.waitForSelector('#funil-exemplos [data-fx="apagar"]', { timeout: 20000 });
      exigir(await p.locator('#kanban-quadro .kanban-card[data-id^="exemplo-"]').count() === 4, 'esperava 4 cartões');
      exigir(/^\[Exemplo\] /.test(await card(p, 'exemplo-1').locator('.kanban-card-objeto').innerText()), 'cartão sem [Exemplo]');
      exigir(contar('exemplo') === 4, 'banco sem 4 exemplos');
      const prazos = Number(psql(`select count(*) from operacao_prazos_processo z join operacao_processos p on p.id=z.processo_id where p.empresa_id='${EMP}'`));
      exigir(prazos >= 2, 'prazos de exemplo ausentes: ' + prazos);
      const uso = psql(`select count(*) from operacao_processos where organizacao_id='${ORG}' and status<>'arquivado' and not exemplo`);
      await print(p, '02-exemplos-criados-1280.png');
      return `prazos ligados aos exemplos: ${prazos}; processos que contam no plano da org: ${uso}`;
    });
    const idProc = psql(`select id from operacao_processos where empresa_id='${EMP}' and origem_externa_id='exemplo-2'`);
    await passo('link do Meu dia troca a empresa, rola e destaca o cartão certo', p, async () => {
      await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), OUTRA);
      await p.goto(`${SITE}/painel.html?empresa=${EMP}&processo=${idProc}#kanban`);
      await p.waitForSelector('#kanban-quadro .kanban-card.fx-aberto[data-id="exemplo-2"]', { timeout: 30000 });
      exigir(await p.evaluate(() => document.activeElement?.dataset?.id) === 'exemplo-2', 'foco não ficou no cartão');
      exigir(await p.locator('.kanban-card.fx-aberto').count() === 1, 'mais de um cartão destacado');
      await print(p, '03-link-cartao-1280.png');
    });
    await passo('no sistema.html, "Abrir no Funil" do Meu dia leva ao cartão', p, async () => {
      await p.goto(SITE + '/sistema.html');
      const link = p.locator(`a[href*="processo="][href$="#kanban"]`).filter({ hasText: 'Abrir no Funil' }).first();
      await link.waitFor({ timeout: 30000 });
      const href = await link.getAttribute('href');
      exigir(/painel\.html\?empresa=[0-9a-f-]{36}&processo=[0-9a-f-]{36}#kanban$/.test(href), 'link fora do formato: ' + href);
      await print(p, '04-meu-dia-link-1280.png');
      await Promise.all([p.waitForURL(/painel\.html\?empresa=/), link.click()]);
      await p.waitForSelector('#kanban-quadro .kanban-card.fx-aberto', { timeout: 30000 });
      return href;
    });
    await passo('celular 375: convite/faixa e cartão aberto sem rolar a página de lado', p, async () => {
      await p.setViewportSize({ width: 375, height: 800 });
      await p.goto(`${SITE}/painel.html?empresa=${EMP}&processo=${idProc}#kanban`);
      await p.waitForSelector('#kanban-quadro .kanban-card.fx-aberto', { timeout: 30000 });
      const largura = await p.evaluate(() => document.documentElement.scrollWidth);
      exigir(largura <= 376, 'página rola de lado: ' + largura);
      await print(p, '05-link-cartao-375.png');
      await p.locator('#funil-exemplos').scrollIntoViewIfNeeded();
      await print(p, '06-faixa-apagar-375.png');
    });
    await passo('tema escuro: faixa e cartão aberto legíveis', p, async () => {
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.evaluate(() => localStorage.setItem('licitaplena_tema', 'escuro'));
      await p.reload(); // mesmo endereço com #: goto não recarregaria
      await p.waitForSelector('#kanban-quadro .kanban-card.fx-aberto', { timeout: 30000 });
      await p.locator('#funil-exemplos').scrollIntoViewIfNeeded();
      const tema = await p.evaluate(() => document.documentElement.dataset.theme);
      exigir(tema === 'dark', 'tema não ficou escuro: ' + tema);
      await print(p, '07-escuro-1280.png');
      await p.setViewportSize({ width: 375, height: 800 });
      await print(p, '08-escuro-375.png');
      await p.setViewportSize({ width: 1280, height: 900 });
    });
    await passo('Etapas: "Chance de ganhar (%)" grava em probabilidade, valida 0 a 100 e volta ao padrão', p, async () => {
      const etapa = psql(`select id || '|' || coalesce(probabilidade::text, '') from operacao_funil_etapas where organizacao_id='${ORG}' and status_sistema='triagem' order by ordem limit 1`).split('|');
      const linha = p.locator(`#etapas-lista .etapa-linha[data-id="${etapa[0]}"]`);
      try {
        await p.click('#kanban-etapas');
        const campo = linha.locator('.etapa-input-chance');
        await campo.waitFor({ timeout: 10000 });
        exigir(await campo.getAttribute('placeholder') === '5', 'padrão da triagem não é 5%');
        exigir(await p.locator('#etapas-lista .etapa-linha').filter({ hasText: 'Do sistema' }).locator('.etapa-input-chance').count() >= 1, 'campo sumiu das etapas do sistema');
        await campo.fill('30'); await campo.press('Tab');
        await new Promise((ok) => setTimeout(ok, 800));
        exigir(psql(`select probabilidade from operacao_funil_etapas where id='${etapa[0]}'`) === '30', 'não gravou 30');
        await campo.fill('150'); await campo.press('Tab');
        exigir(await campo.getAttribute('aria-invalid') === 'true', 'aceitou 150');
        exigir(/0 a 100%/.test(await p.locator('#etapas-aviso').innerText()), 'sem aviso de 0 a 100');
        exigir(psql(`select probabilidade from operacao_funil_etapas where id='${etapa[0]}'`) === '30', '150 chegou ao banco');
        await campo.fill('35'); await campo.press('Tab');
        await new Promise((ok) => setTimeout(ok, 800));
        await print(p, '10-etapas-chance-1280.png');
        await p.setViewportSize({ width: 375, height: 800 });
        await campo.scrollIntoViewIfNeeded();
        await print(p, '11-etapas-chance-375.png');
        await p.setViewportSize({ width: 1280, height: 900 });
        await campo.fill(''); await campo.press('Tab');
        await new Promise((ok) => setTimeout(ok, 800));
        exigir(psql(`select coalesce(probabilidade::text, 'nulo') from operacao_funil_etapas where id='${etapa[0]}'`) === 'nulo', 'vazio não voltou ao padrão');
        await p.keyboard.press('Escape');
      } finally {
        psql(`update operacao_funil_etapas set probabilidade=${etapa[1] === '' ? 'null' : etapa[1]} where id='${etapa[0]}'`);
      }
    });
    await passo('"Apagar exemplos" remove só os exemplos; o processo real fica', p, async () => {
      psql(`insert into operacao_processos(organizacao_id,empresa_id,objeto,origem_externa_id,status) values ('${ORG}','${EMP}','Processo real do teste','manual-real-1','triagem');`);
      await p.goto(SITE + '/painel.html#kanban');
      await p.waitForSelector('#funil-exemplos [data-fx="apagar"]', { timeout: 30000 });
      await p.click('#funil-exemplos [data-fx="apagar"]');
      await p.waitForFunction(() => !document.querySelector('#kanban-quadro .kanban-card[data-id^="exemplo-"]'), null, { timeout: 20000 });
      exigir(contar('exemplo') === 0, 'exemplo ficou no banco');
      exigir(contar("origem_externa_id='manual-real-1'") === 1, 'apagou o processo real');
      exigir(await card(p, 'manual-real-1').count() === 1, 'cartão real sumiu da tela');
      exigir(await p.locator('#funil-exemplos [data-fx]').count() === 0, 'convite voltou com processo real');
      await print(p, '09-exemplos-apagados-1280.png');
    });
    await passo('console sem erro', null, async () => {
      const erros = p.erros.filter((e) => !/favicon|manifest/.test(e));
      exigir(!erros.length, erros.slice(0, 5).join(' | '));
    });
  } finally {
    await p.evaluate(() => localStorage.removeItem('licitaplena_tema')).catch(() => {});
    await nav.close();
    limpar();
    fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 2));
    const falhas = resultados.filter((r) => !r.ok).length;
    console.log(falhas ? `${falhas} passo(s) falharam` : 'TUDO OK');
    process.exit(falhas ? 1 : 0);
  }
})();
