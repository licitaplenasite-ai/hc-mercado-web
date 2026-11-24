/* global document, localStorage */
// E2E local do CRM, fase 2 (24/11/2026): Previsão de faturamento e "Por que eu perco?" no Dashboard (crm-relatorios-ui.js).
//   PORTA_TESTE=8931 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8931 node ambiente-teste/e2e-crm-previsao.cjs
// Banco LOCAL com supabase/funil_previsao.sql aplicado. Cria processos fictícios ([Teste], não [Exemplo]: exemplos são filtrados) na empresa A2 e apaga no fim.
const path = require('node:path'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-fase2-previsao';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const ORG = seed.ids.orgA, EMP = seed.ids.empA2;
const q = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const dia = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const PREFIXO = 'crm-prev-'; // origem_externa_id dos fictícios: limpeza só apaga estes
// [id, objeto, status, valor, sessao(dias), resultado(dias), motivo]
const FIXTURE = [
  ['a1', 'Toner e cartuchos', 'sessao', 40000, 10, null, null],
  ['a2', 'Mobiliário escolar', 'habilitacao', 120000, 40, null, null],
  ['a3', 'Material de limpeza', 'triagem', 15000, null, null, null],
  ['a4', 'Café e açúcar', 'preparacao', null, 5, null, null],
  ['g1', 'Merenda escolar (contrato)', 'contratado', 90000, null, -20, null],
  ['p1', 'Papel A4', 'perdido', 12000, null, -10, 'Preço acima do vencedor: vencedor ofertou 8% abaixo'],
  ['p2', 'Pneus', 'perdido', 30000, null, -30, 'Preço acima do vencedor'],
  ['p3', 'Uniformes', 'perdido', 8000, null, -60, 'Preço acima do vencedor: lance final 3% acima'],
  ['p4', 'Computadores', 'perdido', 200000, null, -15, 'Inabilitação ou documento: CND estadual vencida'],
  ['p5', 'Medicamentos', 'perdido', 45000, null, -100, 'Inabilitação ou documento'],
  ['p6', 'Ar-condicionado', 'perdido', 60000, null, -45, 'Desclassificação técnica: marca não aceita'],
  ['p7', 'Combustível', 'perdido', 25000, null, -5, null],
  ['p8', 'Gás de cozinha', 'perdido', 9000, null, -400, 'Licitação deserta, fracassada ou revogada'],
];
function limpar() {
  psql(`delete from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id like ${q(PREFIXO + '%')};
    update operacao_funil_etapas set probabilidade=null where organizacao_id=${q(ORG)};`);
}
function criar() {
  limpar();
  psql(FIXTURE.map(([id, obj, status, valor, sessao, resultado, motivo]) => `insert into operacao_processos
    (organizacao_id, empresa_id, origem_externa_id, objeto, orgao, status, decisao, valor_estimado, data_sessao, data_resultado, motivo_perda)
    values (${q(ORG)}, ${q(EMP)}, ${q(PREFIXO + id)}, ${q('[Teste] ' + obj)}, 'Órgão fictício de exemplo', ${q(status)}, 'participar',
      ${valor ?? 'null'}, ${sessao === null ? 'null' : q(dia(sessao) + ' 10:00-03')}, ${resultado === null ? 'null' : q(dia(resultado))}, ${q(motivo)});`).join('\n'));
  // Exemplos do primeiro acesso (coluna exemplo e/ou prefixo): nunca podem aparecer na previsão nem nas perdas.
  psql(`insert into operacao_processos (organizacao_id, empresa_id, origem_externa_id, objeto, status, decisao, valor_estimado, data_resultado, motivo_perda, exemplo) values
    (${q(ORG)}, ${q(EMP)}, ${q(PREFIXO + 'x1')}, 'Disputa marcada como exemplo', 'sessao', 'participar', 7777777, null, null, true),
    (${q(ORG)}, ${q(EMP)}, ${q(PREFIXO + 'x2')}, '[Exemplo] Perda de exemplo', 'perdido', 'participar', 5555555, ${q(dia(-3))}, 'Preço acima do vencedor', false);`);
  // Contrato ganho: R$ 90 mil até daqui a 150 dias, R$ 30 mil já pagos (empenho "pago").
  psql(`with p as (select id, organizacao_id from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id=${q(PREFIXO + 'g1')}),
    c as (insert into operacao_contratos (organizacao_id, processo_id, numero, valor, vigencia_fim, situacao) select organizacao_id, id, 'CT-EXEMPLO-1', 90000, ${q(dia(150))}, 'vigente' from p returning 1)
    insert into operacao_empenhos (organizacao_id, processo_id, numero, valor, status) select organizacao_id, id, 'NE-EXEMPLO-1', 30000, 'pago' from p;`);
}
const textoPrev = (p) => p.locator('#crm-prev-titulo').locator('xpath=..').innerText();
const totalNaTela = async (p) => (await p.locator('.crm-numero strong').innerText()).trim();
async function print(p, nome, alvo) { await (alvo ? p.locator(alvo) : p).screenshot({ path: path.join(PRINTS, nome) }); }

(async () => {
  require('node:fs').mkdirSync(PRINTS, { recursive: true });
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  criar();
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await passo('previsão aparece no Dashboard com rótulo "Estimativa", mês a mês e por etapa', p, async () => {
      await p.goto(SITE + '/painel.html');
      await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), EMP);
      await p.reload();
      await p.waitForSelector('.crm-numero strong', { timeout: 30000 });
      const t = await textoPrev(p);
      exigir(!/7\.777\.777|77\.777/.test(t), 'previsão contou o processo de exemplo');
      exigir(/estimativa/i.test(t) && /Não é promessa/.test(t), 'sem rótulo de estimativa');
      exigir(await p.locator('.crm-mes').count() === 6, 'não mostrou 6 meses');
      exigir(/Sessão de lances/i.test(t) && /Habilitação/i.test(t), 'sem quebra por etapa: ' + JSON.stringify(t));
      exigir(/sem valor ficam? de fora/.test(t), 'não avisou a disputa sem valor');
      exigir(/Ganhos nos últimos 90 dias[\s\S]*R\$\s?90\.000,00/.test(t), 'ganho dos 90 dias errado');
      exigir(/total R\$\s?60\.000,00/.test(t), 'saldo do contrato (90 mil − 30 mil pagos) errado');
      await p.locator('#dash-crm').scrollIntoViewIfNeeded();
      await print(p, '01-previsao-e-perdas-1280.png', '#dash-crm');
    });
    await passo('ajustar chance: 150 recusado; 100 em "Tenho interesse" grava e recalcula', p, async () => {
      const antes = await totalNaTela(p);
      await p.click('[data-crm-ajustar]');
      const d = p.locator('.crm-dialogo');
      await d.waitFor({ state: 'visible' });
      const campo = d.locator('.crm-ajuste-linha', { hasText: 'Tenho interesse' }).locator('input');
      await campo.fill('150');
      await d.locator('button[type=submit]').click();
      exigir(/0 a 100/.test(await d.locator('#crm-ajuste-erro').innerText()), 'aceitou 150');
      await print(p, '02-ajuste-chance-erro-1280.png', '.crm-dialogo');
      await campo.fill('100');
      await d.locator('button[type=submit]').click();
      await d.waitFor({ state: 'hidden' });
      exigir(psql(`select count(*) from operacao_funil_etapas where organizacao_id=${q(ORG)} and probabilidade=100 and chave_sistema='interesse'`) === '1', 'chance não gravou');
      const depois = await totalNaTela(p);
      exigir(depois !== antes, `total não mudou (${antes})`);
      exigir(/100%/.test(await textoPrev(p)), 'tabela sem a chance nova');
      return `${antes} -> ${depois}`;
    });
    await passo('"Por que eu perco?": motivos agrupados, valor, conselho e período', p, async () => {
      const perco = p.locator('#crm-perco-titulo').locator('xpath=..');
      const t = await perco.innerText();
      exigir(/Preço acima do vencedor\s*3 vezes/.test(t), 'preço não somou 3: ' + t.slice(0, 400));
      exigir(!/5\.555\.555/.test(t), 'perdas contaram o processo de exemplo');
      exigir(/Minhas empresas e documentos/.test(t), 'sem conselho de inabilitação');
      exigir(/Motivo não informado/.test(t), 'sem a linha de motivo não informado');
      exigir(!/deserta/.test(t), '12 meses mostrou perda de 400 dias atrás');
      await perco.locator('[data-crm-periodo="tudo"]').click();
      exigir(/deserta/.test(await perco.innerText()), '"Tudo" sem a perda antiga');
      await perco.locator('[data-crm-periodo="90d"]').click();
      const t90 = await perco.innerText();
      exigir(!/Medicamentos|Inabilitação ou documento\s*2 vezes/.test(t90), '90 dias contou perda de 100 dias');
      await print(p, '03-por-que-perco-90d-1280.png', '#crm-perco-titulo >> xpath=..');
      await perco.locator('[data-crm-periodo="12m"]').click();
    });
    await passo('celular 375: sem rolagem lateral; tabela rola dentro do quadro', p, async () => {
      await p.setViewportSize({ width: 375, height: 800 });
      await p.waitForTimeout(400);
      const largura = await p.evaluate(() => document.documentElement.scrollWidth);
      exigir(largura <= 375, `página com ${largura}px`);
      const rola = await p.evaluate(() => { const el = document.querySelector('.crm-tabela-rolagem'); return el.scrollWidth > el.clientWidth; });
      exigir(rola, 'tabela não rola no quadro');
      await p.locator('#dash-crm').scrollIntoViewIfNeeded();
      await print(p, '04-previsao-375.png', '#crm-prev-titulo >> xpath=..');
      await print(p, '05-perco-375.png', '#crm-perco-titulo >> xpath=..');
    });
    await passo('tema escuro', p, async () => {
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.evaluate(() => { document.documentElement.classList.remove('tema-claro'); document.documentElement.dataset.theme = 'dark'; });
      await print(p, '06-escuro-1280.png', '#dash-crm');
    });
    await passo('estado vazio amigável numa empresa sem perdas', p, async () => {
      limpar();
      await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      await p.reload();
      await p.waitForSelector('.crm-numero strong', { timeout: 30000 });
      const t = await p.locator('#crm-perco-titulo').locator('xpath=..').innerText();
      exigir(/Nenhuma licitação perdida|vezes/.test(t), 'sem estado vazio nem lista');
      await print(p, '07-vazio-1280.png', '#dash-crm');
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
