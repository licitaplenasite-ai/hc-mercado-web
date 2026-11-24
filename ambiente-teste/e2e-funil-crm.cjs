/* global document, localStorage */
// E2E local do Funil, fase 1 de CRM (24/11/2026): total em reais por coluna, selo "Parado há N dias", motivo obrigatório
// ao perder (Funil) e filtros salvos do Funil. Prints 1280, 375 e tema escuro.
//   PORTA_TESTE=8897 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8897 node ambiente-teste/e2e-funil-crm.cjs
// Banco LOCAL com supabase/funil_crm.sql aplicado. Cria os próprios processos fictícios (dados de exemplo) e apaga no fim.
const path = require('node:path'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-funil-crm-20261124';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const ORG = seed.ids.orgA, EMP = seed.ids.empA1, GESTOR = seed.usuarios.gestor.id;
const q = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const PARADO = '90000000000401-1-000001/2026'; // em Tenho interesse há 10 dias (padrão: alerta depois de 7)
const SEM_VALOR = '90000000000402-1-000002/2026'; // sem valor estimado: conta R$ 0
const PERDER = '90000000000403-1-000003/2026'; // vai para Perdi com motivo
const TODOS = [PARADO, SEM_VALOR, PERDER].map(q).join(',');
const dia = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const FIXTURE = [
  [PARADO, '[EXEMPLO] Toner e cartuchos para impressoras', 'Secretaria de Estado de Teste', 'triagem', 85000],
  [SEM_VALOR, '[EXEMPLO] Material de limpeza e higiene', 'Prefeitura Municipal de Exemplo', 'triagem', null],
  [PERDER, '[EXEMPLO] Papel sulfite A4', 'Câmara Municipal de Teste', 'triagem', 12500.5],
];

function limpar() {
  psql(`delete from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id in (${TODOS});
    delete from filtros_salvos where cliente_id=${q(GESTOR)} and filtro->>'tela'='funil';
    update operacao_funil_etapas set limite_parado_dias=null where organizacao_id=${q(ORG)};`);
}
function criar() {
  limpar();
  psql(FIXTURE.map(([o, obj, org, status, valor]) => `
    with p as (insert into operacao_processos (organizacao_id, empresa_id, origem_externa_id, objeto, orgao, modalidade, sistema, status, decisao, valor_estimado)
      values (${q(ORG)}, ${q(EMP)}, ${q(o)}, ${q(obj)}, ${q(org)}, 'Pregão - Eletrônico', 'Compras.gov.br', ${q(status)}, 'em_analise', ${valor === null ? 'null' : valor}) returning id, organizacao_id)
    insert into operacao_prazos_processo (organizacao_id, processo_id, categoria, titulo, vencimento)
      select organizacao_id, id, 'proposta', 'Prazo de propostas (Boletim)', ${q(`${dia(20)} 09:00-03`)}::timestamptz from p;`).join('\n'));
  // Simula um cartão parado: replica desliga o gatilho só nesta sessão do psql.
  psql(`set session_replication_role = replica; update operacao_processos set etapa_desde = now() - interval '10 days', atualizado_em = now() - interval '10 days'
    where empresa_id=${q(EMP)} and origem_externa_id=${q(PARADO)};`);
}
const proc = (o, col) => psql(`select ${col} from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id=${q(o)}`);

async function abrirFunil(p) {
  await p.goto(SITE + '/painel.html#kanban');
  await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), EMP);
  await p.reload();
  await p.waitForSelector(`#kanban-quadro .kanban-card[data-id="${PARADO}"]`, { timeout: 30000 });
}
const card = (p, o) => p.locator(`#kanban-quadro .kanban-card[data-id="${o}"]`);
const coluna = (p, o) => card(p, o).locator('xpath=ancestor::div[contains(@class,"kanban-coluna")][1]');
async function print(p, nome) { await p.screenshot({ path: path.join(PRINTS, nome), fullPage: false }); }
async function moverPara(p, o, rotulo) {
  const sel = card(p, o).locator('.kanban-card-mover');
  const valor = await sel.locator('option', { hasText: rotulo }).first().getAttribute('value');
  await sel.selectOption(valor);
}

(async () => {
  require('node:fs').mkdirSync(PRINTS, { recursive: true });
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  p.on('dialog', (d) => d.accept());
  criar();
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await passo('total em reais e quantidade por coluna; cartão sem valor conta R$ 0', p, async () => {
      await abrirFunil(p);
      const total = await coluna(p, PARADO).locator('.fc-total').innerText();
      exigir(/R\$\s?97\.500,50/.test(total), 'total errado: ' + total);
      exigir(/sem valor \(conta R\$ 0\)/.test(total), 'não avisa o cartão sem valor: ' + total);
      await print(p, '01-totais-e-parado-1280.png');
    });
    await passo('selo "Parado há 10 dias" só no cartão parado', p, async () => {
      exigir(/Parado há 10 dias/.test(await card(p, PARADO).innerText()), 'sem selo de parado');
      exigir(await card(p, PARADO).evaluate((el) => el.classList.contains('fc-parado')), 'cartão sem destaque');
      exigir(!/Parado há/.test(await card(p, SEM_VALOR).innerText()), 'cartão novo com selo');
    });
    await passo('perder exige motivo: cancelar não move; sem escolha mostra erro', p, async () => {
      await moverPara(p, PERDER, 'Perdi');
      const d = p.locator('#funil-motivo-dialogo');
      await d.waitFor({ state: 'visible' });
      await d.locator('button[type=submit]').click();
      exigir(/Escolha por que/.test(await d.locator('#fc-motivo-erro').innerText()), 'sem erro de motivo');
      await d.locator('input[value=outro]').check();
      await d.locator('button[type=submit]').click();
      exigir(/pelo menos 3/.test(await d.locator('#fc-motivo-erro').innerText()), '"Outro" aceitou sem texto');
      await print(p, '02-motivo-erro-1280.png');
      await d.locator('[data-fc-cancelar]').click();
      await p.waitForTimeout(300);
      exigir(proc(PERDER, 'status') === 'triagem', 'cancelar moveu o cartão');
    });
    await passo('motivo salvo em motivo_perda e mostrado no cartão; etapa_desde reinicia', p, async () => {
      const antes = proc(PERDER, 'etapa_desde');
      await moverPara(p, PERDER, 'Perdi');
      const d = p.locator('#funil-motivo-dialogo');
      await d.waitFor({ state: 'visible' });
      await d.locator('input[value=preco]').check();
      await d.locator('textarea[name=detalhe]').fill('vencedor ofertou 8% abaixo');
      await print(p, '03-motivo-escolhido-1280.png');
      await d.locator('button[type=submit]').click();
      await p.waitForFunction((o) => /Motivo da perda/.test(document.querySelector(`#kanban-quadro .kanban-card[data-id="${o}"]`)?.innerText || ''), PERDER, { timeout: 20000 });
      exigir(proc(PERDER, 'motivo_perda') === 'Preço acima do vencedor: vencedor ofertou 8% abaixo', 'motivo no banco: ' + proc(PERDER, 'motivo_perda'));
      exigir(proc(PERDER, 'status') === 'perdido', 'não foi para perdido');
      exigir(proc(PERDER, 'etapa_desde') !== antes, 'etapa_desde não mudou');
      await card(p, PERDER).scrollIntoViewIfNeeded();
      await print(p, '04-motivo-no-cartao-1280.png');
    });
    await passo('sair de Perdi apaga o motivo antigo', p, async () => {
      await moverPara(p, PERDER, 'Ganhei');
      await p.waitForFunction((o) => !/Motivo da perda/.test(document.querySelector(`#kanban-quadro .kanban-card[data-id="${o}"]`)?.innerText || 'Motivo da perda'), PERDER, { timeout: 20000 });
      exigir(proc(PERDER, "coalesce(motivo_perda, 'NULO')") === 'NULO', 'motivo ficou: ' + proc(PERDER, 'motivo_perda'));
      exigir(proc(PERDER, 'status') === 'homologado', 'não foi para Ganhei');
    });
    await passo('limite editável em Etapas: 0 desliga o alerta da etapa', p, async () => {
      await p.click('#kanban-etapas');
      const d = p.locator('#etapas-dialogo');
      await d.waitFor({ state: 'visible' });
      const campo = d.locator('.etapa-linha').first().locator('.etapa-input-limite');
      await campo.fill('400');
      await campo.press('Tab');
      exigir(/0 a 365/.test(await d.locator('#etapas-aviso').innerText()), 'aceitou 400');
      await campo.fill('0');
      await campo.press('Tab');
      await p.waitForFunction(() => !/Parado há/.test(document.querySelector('#kanban-quadro')?.innerText || ''));
      exigir(psql(`select count(*) from operacao_funil_etapas where organizacao_id=${q(ORG)} and limite_parado_dias=0`) === '1', 'limite não gravou');
      await print(p, '05-etapas-limite-1280.png');
      await campo.fill('');
      await campo.press('Tab');
      await p.waitForFunction(() => /Parado há/.test(document.querySelector('#kanban-quadro')?.innerText || ''));
      await d.locator('#etapas-fechar').click();
    });
    await passo('filtro salvo: salvar com nome, aplicar com um clique, apagar', p, async () => {
      await p.fill('[data-funil-filtro="texto"]', 'toner');
      await p.waitForFunction(() => document.querySelectorAll('#kanban-quadro .kanban-card').length === 1);
      await p.click('#funil-salvos [data-fc-novo]');
      await p.fill('#funil-salvos [data-fc-form] input', 'Só toner');
      await p.click('#funil-salvos [data-fc-form] button[type=submit]');
      await p.locator('#funil-salvos [data-fc-aplicar]', { hasText: 'Só toner' }).waitFor();
      exigir(psql(`select filtro->>'texto' from filtros_salvos where cliente_id=${q(GESTOR)} and filtro->>'tela'='funil' and empresa_id=${q(EMP)}`) === 'toner', 'filtro não gravou com tela=funil e empresa');
      await p.click('[data-funil-limpar]');
      await p.waitForFunction(() => document.querySelectorAll('#kanban-quadro .kanban-card').length >= 3);
      await p.click('#funil-salvos [data-fc-aplicar]');
      await p.waitForFunction(() => document.querySelectorAll('#kanban-quadro .kanban-card').length === 1);
      exigir(await p.inputValue('[data-funil-filtro="texto"]') === 'toner', 'campo não voltou');
      await print(p, '06-filtro-salvo-aplicado-1280.png');
      await p.click('#funil-salvos [data-fc-apagar]');
      await p.locator('#funil-salvos', { hasText: 'apagado' }).waitFor();
      exigir(psql(`select count(*) from filtros_salvos where cliente_id=${q(GESTOR)} and filtro->>'tela'='funil'`) === '0', 'não apagou');
      await p.click('[data-funil-limpar]');
    });
    await p.setViewportSize({ width: 375, height: 812 });
    await passo('celular 375: quadro rola dentro do próprio quadro, diálogo cabe', p, async () => {
      await abrirFunil(p);
      await card(p, PARADO).scrollIntoViewIfNeeded();
      await print(p, '07-funil-375.png');
      const largura = await p.evaluate(() => document.documentElement.scrollWidth);
      exigir(largura <= 375, `página com ${largura}px`);
      await moverPara(p, SEM_VALOR, 'Perdi');
      await p.locator('#funil-motivo-dialogo').waitFor({ state: 'visible' });
      const ld = await p.evaluate(() => document.querySelector('#funil-motivo-dialogo').getBoundingClientRect().width);
      exigir(ld <= 375, `diálogo com ${ld}px`);
      await print(p, '08-motivo-375.png');
      await p.locator('#funil-motivo-dialogo [data-fc-cancelar]').click();
    });
    await passo('tema escuro usa os mesmos tokens', p, async () => {
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.evaluate(() => { document.documentElement.classList.remove('tema-claro'); document.documentElement.dataset.theme = 'dark'; });
      await card(p, PARADO).scrollIntoViewIfNeeded();
      await print(p, '09-funil-escuro-1280.png');
      await moverPara(p, SEM_VALOR, 'Perdi');
      await p.locator('#funil-motivo-dialogo').waitFor({ state: 'visible' });
      await p.locator('#funil-motivo-dialogo input[value=fracassada]').check();
      await print(p, '10-motivo-escuro-1280.png');
      await p.locator('#funil-motivo-dialogo [data-fc-cancelar]').click();
    });
    exigir(!p.erros.some((e) => /pageerror/.test(e)), 'erros de página: ' + p.erros.join(' | '));
  } finally {
    limpar();
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} passos ok`);
  if (p.erros.length) console.log('Avisos da página:', [...new Set(p.erros)].slice(0, 15).join(' | '));
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
