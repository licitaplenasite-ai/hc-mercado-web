/* global document, localStorage, window, Event */
// E2E do defeito de 23/11 (pregão 012/2026 da ALEPA): em Encontrar Licitações, "Acompanhar" + "Participando" direto
// num edital novo tem que gravar na PRIMEIRA tentativa, inclusive logo depois de voltar para a aba (a recarga das
// empresas deixava o seletor ligado e a escolha falhava). Se o banco recusa, a tela volta ao status anterior e diz
// o motivo em português. Prints 1280 e 375.
//   PORTA_TESTE=8893 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8893 node ambiente-teste/e2e-acompanhar.cjs
// Banco LOCAL (subir.cjs). Usa um edital do seed fora do Funil da empresa A1 e apaga o processo no fim.
const path = require('node:path'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-acompanhar';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const EMP = seed.ids.empA1;
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const usados = new Set(psql(`select origem_externa_id from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id is not null`).split('\n'));
const [EDITAL, EDITAL2] = seed.editais.filter((e) => !usados.has(e));
const limpar = () => psql(`delete from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id in (${q(EDITAL)},${q(EDITAL2)})`);
const proc = (e) => psql(`select status || '/' || decisao from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id=${q(e)}`);
const objeto = (e) => psql(`select objeto from oportunidades_abertas where numero_controle_pncp=${q(e)}`);
// Palavra rara do objeto: a busca traz o edital escolhido sem depender da ordem dos resultados.
const palavra = (e) => (objeto(e).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z]{8,}/g) || ['contratacao']).sort((a, b) => b.length - a.length)[0];

async function buscar(p, edital) {
  await p.goto(SITE + '/painel.html#oportunidades');
  await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), EMP);
  await p.reload();
  await p.fill('#op-palavras', palavra(edital));
  await p.click('#op-buscar');
  const card = p.locator(`#op-resultado [data-id="${edital}"]`).first();
  await card.waitFor({ timeout: 30000 });
  // Espera o acompanhamento da empresa carregar (seletor ligado) antes de "voltar para a aba".
  await p.waitForFunction(() => document.querySelector('#op-resultado .select-status-licitacao:not([disabled])'));
  return card;
}

(async () => {
  require('node:fs').mkdirSync(PRINTS, { recursive: true });
  exigir(EDITAL && EDITAL2, 'seed sem dois editais fora do Funil da empresa A1');
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  const avisos = [];
  p.on('console', (m) => { if (m.type() === 'warning') avisos.push(m.text()); });
  limpar();
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await passo('Participando direto, logo depois de voltar para a aba, grava na primeira tentativa', p, async () => {
      const card = await buscar(p, EDITAL);
      await p.waitForTimeout(16000); // a recarga ao voltar para a aba só roda depois de 15 s
      await card.locator('.btn-acompanhar').click();
      await p.evaluate(() => window.dispatchEvent(new Event('focus'))); // volta para a aba: recarrega as empresas
      await card.locator('.select-status-licitacao').selectOption('participando');
      await p.getByText(/Acompanhamento salvo para/).waitFor({ timeout: 20000 });
      exigir(proc(EDITAL) === 'preparacao/participar', 'processo não gravado na primeira tentativa: ' + proc(EDITAL));
      exigir(await card.locator('.select-status-licitacao').inputValue() === 'participando', 'tela não mostra Participando');
      await p.screenshot({ path: path.join(PRINTS, '01-participando-1280.png') });
    });
    await passo('aparece no Funil, em Participando', p, async () => {
      await p.goto(SITE + '/painel.html#kanban');
      const cartao = p.locator(`#kanban-quadro .kanban-card[data-id="${EDITAL}"]`);
      await cartao.waitFor({ timeout: 30000 });
      exigir(await cartao.locator('.kanban-card-mover option:checked').innerText() === 'Participando', 'cartão fora de Participando');
      await p.screenshot({ path: path.join(PRINTS, '02-funil-1280.png') });
    });
    await passo('aparece em Processos', p, async () => {
      await p.goto(SITE + '/processos.html');
      const linha = p.locator('#lista-processos [data-processo]').filter({ hasText: objeto(EDITAL).slice(0, 40) });
      await linha.first().waitFor({ timeout: 30000 });
      await p.screenshot({ path: path.join(PRINTS, '03-processos-1280.png') });
    });
    await passo('banco recusa: a tela volta ao status anterior e explica em português; console traz o erro real', p, async () => {
      await p.route('**/rest/v1/operacao_processos?select=*', (r) => r.request().method() === 'POST'
        ? r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy for table "operacao_processos"', details: null, hint: null }) })
        : r.continue());
      await p.setViewportSize({ width: 375, height: 800 });
      const card = await buscar(p, EDITAL2);
      await card.locator('.btn-acompanhar').click();
      avisos.length = 0;
      await card.locator('.select-status-licitacao').selectOption('participando');
      const aviso = p.locator('#aviso-sincronizacao-operacional');
      await aviso.getByText(/não tem permissão/).waitFor({ timeout: 20000 });
      exigir(await card.locator('.select-status-licitacao').inputValue() === '', 'tela não voltou ao status anterior');
      exigir(avisos.some((a) => a.includes('42501 | new row violates')), 'console sem a mensagem real: ' + avisos.join(' || '));
      exigir(!avisos.some((a) => /: Object$/.test(a)), 'console ainda mostra "Object"');
      exigir(proc(EDITAL2) === '', 'gravou mesmo com o banco recusando');
      await p.screenshot({ path: path.join(PRINTS, '04-erro-375.png') });
      await p.unroute('**/rest/v1/operacao_processos?select=*');
    });
    await passo('Participando no celular (375) grava direto', p, async () => {
      const card = await buscar(p, EDITAL2);
      await card.locator('.btn-acompanhar').click();
      await card.locator('.select-status-licitacao').selectOption('participando');
      await p.getByText(/Acompanhamento salvo para/).waitFor({ timeout: 20000 });
      exigir(proc(EDITAL2) === 'preparacao/participar', 'não gravou no celular');
      exigir(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'página rola na horizontal em 375');
      await p.screenshot({ path: path.join(PRINTS, '05-participando-375.png') });
    });
    // O 403 do passo 04 é simulado de propósito (banco recusando).
    const erros = p.erros.filter((e) => !/403 POST .*operacao_processos|status of 403/.test(e));
    await passo('console sem erro', null, async () => { exigir(!erros.length, erros.join(' | ')); });
  } finally {
    limpar();
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : 'TUDO OK');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
