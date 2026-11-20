/* global document, localStorage */
// E2E local do Funil v2 (checklist por etapa, favoritas, filtros, lista e Arquivados) com prints 1280 e 375.
//   PORTA_TESTE=8890 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8890 node ambiente-teste/e2e-funil-v2.cjs
// Banco LOCAL com supabase/operacao_funil_checklist.sql aplicado. Cria os próprios processos fictícios e apaga no fim.
const path = require('node:path'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-funil-v2';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const ORG = seed.ids.orgA, EMP = seed.ids.empA1;
const ORIGEM = '90000000000101-1-000001/2026'; // triagem com a etapa "exigencias" da esteira pronta
// Processos fictícios próprios deste roteiro (o banco local é compartilhado com outros E2E); apagados no fim.
const FIXTURE = [
  [ORIGEM, 'Material para manutenção da iluminação pública', 'Prefeitura Municipal de Exemplo', 'Pregão - Eletrônico', 'Compras.gov.br', 'triagem', 'em_analise', 'nao_apurado', 120000, false, {}, '2026-12-03 09:00-03'],
  ['90000000000102-1-000002/2026', 'Contact center: atendimento ao cidadão', 'Secretaria de Estado de Teste', 'Pregão - Eletrônico', 'BLL Compras', 'triagem', 'em_analise', 'nao_apurado', 350000, true, { 'documentos-habilitacao': 'x', 'analisar-mercado': 'x' }, '2026-11-27 10:00-03'],
  ['90000000000103-1-000003/2026', 'Locação de impressoras com manutenção', 'Instituto Municipal de Teste', 'Pregão - Eletrônico', 'Licitanet', 'preparacao', 'participar', 'em_disputa', 64000, false, {}, '2026-11-21 14:00-03'],
  ['90000000000104-1-000004/2026', 'Aquisição de café e açúcar para as secretarias', 'Prefeitura Municipal de Exemplo', 'Dispensa', 'Compras.gov.br', 'homologado', 'participar', 'vitoria_sem_detalhamento', 48000,
    false, Object.fromEntries(['analisar-edital', 'documentos-habilitacao', 'esclarecimento-impugnacao', 'analisar-mercado', 'analisar-concorrentes', 'definir-produto', 'cadastrar-proposta', 'composicao-precos', 'estrategia-preco', 'participar-disputa', 'habilitacao-concorrentes'].map((k) => [k, 'x'])), '2026-11-10 10:00-03'],
  ['90000000000105-1-000005/2026', 'Material de limpeza e higiene', 'Câmara Municipal de Teste', 'Pregão - Eletrônico', 'BLL Compras', 'perdido', 'participar', 'sem_vitoria', 15500, false, {}, '2026-11-05 09:00-03'],
  ['90000000000106-1-000006/2025', 'Papel A4 e material de escritório (2025)', 'Fundo Municipal de Saúde de Exemplo', 'Dispensa', 'Licitanet', 'arquivado', 'em_analise', 'nao_apurado', 9800, false, {}, null],
];
const q = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const IDS = FIXTURE.map((f) => q(f[0])).join(',');
function limparFixture() {
  psql(`delete from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id in (${IDS}); delete from fila_dossies where numero_controle_pncp in (${IDS}); update operacao_funil_etapas set tarefas=null where organizacao_id=${q(ORG)};`);
}
function criarFixture() {
  limparFixture();
  psql(FIXTURE.map(([o, obj, org, mod, sis, st, dec, res, val, fav, marcas, prazo]) => `
    with p as (insert into operacao_processos (organizacao_id, empresa_id, origem_externa_id, objeto, orgao, modalidade, sistema, status, decisao, situacao_resultado, valor_estimado, favorito, checklist_funil)
      values (${q(ORG)}, ${q(EMP)}, ${q(o)}, ${q(obj)}, ${q(org)}, ${q(mod)}, ${q(sis)}, ${q(st)}, ${q(dec)}, ${q(res)}, ${val}, ${fav}, ${q(JSON.stringify(marcas))}::jsonb) returning id, organizacao_id)
    insert into operacao_prazos_processo (organizacao_id, processo_id, categoria, titulo, vencimento)
      select organizacao_id, id, 'proposta', 'Prazo de propostas (Boletim)', ${q(prazo)}::timestamptz from p where ${prazo ? 'true' : 'false'};`).join('\n')
    + `update operacao_esteira_tarefas set estado='feito' where etapa='exigencias' and processo_id=(select id from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id=${q(ORIGEM)});`);
}

async function abrirFunil(p) {
  await p.goto(SITE + '/painel.html#kanban');
  // Empresa A1 do seed: é ela que tem os processos fictícios do Funil.
  await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), EMP);
  await p.reload();
  await p.waitForSelector(`#kanban-quadro .kanban-card[data-id="${ORIGEM}"]`, { timeout: 30000 });
  await p.waitForSelector('#kanban-quadro .kanban-card', { timeout: 30000 });
  await p.waitForSelector('#funil-filtros .funil-abas');
}
async function print(p, nome) { await p.screenshot({ path: path.join(PRINTS, nome), fullPage: false }); }

(async () => {
  require('node:fs').mkdirSync(PRINTS, { recursive: true });
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  criarFixture();
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await passo('funil mostra contador e estrela no cartão', p, async () => {
      await abrirFunil(p);
      const contadores = await p.locator('#kanban-quadro .funil-contador').allInnerTexts();
      exigir(contadores.some((t) => /2 de 15/.test(t)), 'esperava "2 de 15" no cartão favorito: ' + contadores.join('|'));
      exigir(contadores.some((t) => /11 de 15/.test(t)), 'esperava "11 de 15" no cartão ganho: ' + contadores.join('|'));
      exigir(contadores.some((t) => /de 14/.test(t)), 'cartão perdido conta 14 tarefas');
      await print(p, '01-funil-quadro-1280.png');
    });
    await passo('checklist abre, a esteira marca "Analisar o edital" e a marcação vai ao banco', p, async () => {
      const card = p.locator(`#kanban-quadro .kanban-card[data-id="${ORIGEM}"]`);
      await card.locator('.funil-contador').click();
      const dlg = p.locator('#funil-checklist-dialogo');
      await dlg.waitFor({ state: 'visible' });
      exigir(await dlg.getByText('Feito pela esteira automática').count() >= 1, 'tarefa da esteira não apareceu marcada');
      exigir(await dlg.getByRole('button', { name: 'Abrir a Central de Defesa' }).count() === 1, 'sem link da Central de Defesa');
      exigir(await dlg.getByRole('button', { name: 'Ir ao Jurídico' }).count() === 1, 'sem link do Jurídico');
      await dlg.locator('input[data-funil-marcar="analisar-mercado"]').check();
      await p.waitForFunction(() => /2 de 15/.test(document.querySelector('#funil-checklist-titulo')?.textContent || ''));
      const banco = psql(`select checklist_funil ? 'analisar-mercado' from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id=${q(ORIGEM)}`);
      exigir(banco === 't', 'marcação não chegou ao banco');
      await print(p, '02-checklist-1280.png');
    });
    await passo('editar tarefas: renomear grava na etapa e "Voltar ao padrão" desfaz', p, async () => {
      const dlg = p.locator('#funil-checklist-dialogo');
      await dlg.locator('[data-funil-editar]').click();
      const campo = dlg.locator('input[data-tarefa="analisar-mercado"]');
      await campo.fill('Analisar o mercado e os preços de referência');
      await campo.press('Tab');
      await p.waitForFunction(() => document.querySelector('[data-funil-padrao]'));
      exigir(psql(`select count(*) from operacao_funil_etapas where tarefas::text like '%preços de referência%' and organizacao_id=${q(ORG)}`) === '1', 'tarefa renomeada não gravou');
      await print(p, '03-checklist-editar-1280.png');
      await dlg.locator('[data-funil-padrao]').first().click();
      await p.waitForFunction(() => !document.querySelector('[data-funil-padrao]'));
      await dlg.locator('[data-funil-fechar]').click();
    });
    await passo('favoritas e busca por nome filtram o quadro', p, async () => {
      await p.click('[data-funil-favoritas]');
      exigir(await p.locator('#kanban-quadro .kanban-card').count() === 1, 'só favoritas deveria deixar 1 cartão');
      await p.click('[data-funil-limpar]');
      await p.fill('[data-funil-filtro="texto"]', 'iluminacao');
      await p.waitForTimeout(500);
      exigir(await p.locator('#kanban-quadro .kanban-card').count() === 1, 'busca sem acento deveria achar 1 cartão');
      await print(p, '04-filtro-nome-1280.png');
      await p.click('[data-funil-limpar]');
    });
    await passo('visão em lista', p, async () => {
      await p.click('[data-funil-visao="lista"]');
      exigir(await p.locator('#funil-lista tbody tr').count() >= 5, 'lista deveria ter os cartões');
      await print(p, '05-lista-1280.png');
    });
    await passo('aba Arquivados mostra o edital antigo com dossiê e valor', p, async () => {
      await p.click('[data-funil-visao="arquivados"]');
      exigir(await p.locator('#funil-arquivados .funil-arquivado').count() >= 1, 'sem arquivados');
      exigir(/R\$/.test(await p.locator('#funil-arquivados').innerText()), 'sem valor estimado');
      await print(p, '06-arquivados-1280.png');
    });
    await p.setViewportSize({ width: 375, height: 812 });
    await passo('celular 375 sem rolagem horizontal da página', p, async () => {
      for (const [visao, nome] of [['quadro', '07-quadro-375.png'], ['lista', '08-lista-375.png'], ['arquivados', '09-arquivados-375.png']]) {
        await p.click(`[data-funil-visao="${visao}"]`);
        await p.waitForTimeout(300);
        const largura = await p.evaluate(() => document.documentElement.scrollWidth);
        exigir(largura <= 375, `${visao}: página com ${largura}px de largura`);
        await print(p, nome);
      }
      await p.click('[data-funil-visao="quadro"]');
      await p.locator(`#kanban-quadro .kanban-card[data-id="${ORIGEM}"] .funil-contador`).click();
      await p.locator('#funil-checklist-dialogo').waitFor({ state: 'visible' });
      await print(p, '10-checklist-375.png');
    });
    await passo('tema escuro usa os mesmos tokens', p, async () => {
      await p.locator('#funil-checklist-dialogo [data-funil-fechar]').click();
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.evaluate(() => { document.documentElement.classList.remove('tema-claro'); document.documentElement.dataset.theme = 'dark'; });
      await p.click('[data-funil-visao="lista"]');
      await print(p, '11-lista-escuro-1280.png');
    });
    await passo('dossiê: busca por palavra em todas as páginas de itens', p, async () => {
      // PNCP simulado: 2 páginas de 100 itens; "lâmpada" só nos itens 50 e 150.
      await p.route('**/api/pncp-itens**', (r) => {
        const pagina = Number(new URL(r.request().url()).searchParams.get('pagina'));
        const itens = Array.from({ length: 100 }, (_, i) => { const n = (pagina - 1) * 100 + i + 1; return { numero: n, descricao: n % 100 === 50 ? `Lâmpada LED ${n}W` : `Item genérico ${n}`, quantidade: 1, unidade: 'UN' }; });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ itens, proximaPagina: pagina < 2 }) });
      });
      await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      await p.goto(`${SITE}/processos?origem=${encodeURIComponent(ORIGEM)}`);
      await p.locator('[data-alternar-itens]').click({ timeout: 30000 });
      await p.fill('#texto-item-busca', 'lampada');
      await p.locator('[data-busca-itens] button[type="submit"]').click();
      await p.getByText('2 itens com “lampada” em 2 páginas').waitFor({ timeout: 15000 });
      exigir(await p.locator('#d-itens-edital .linha-registro').count() === 2, 'esperava 2 itens achados');
      await p.locator('#d-itens-edital').scrollIntoViewIfNeeded();
      await print(p, '12-busca-itens-1280.png');
    });
    exigir(!p.erros.some((e) => /pageerror/.test(e)), 'erros de página: ' + p.erros.join(' | '));
  } finally {
    limparFixture();
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} passos ok`);
  if (p.erros.length) console.log('Avisos da página:', [...new Set(p.erros)].slice(0, 10).join(' | '));
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
