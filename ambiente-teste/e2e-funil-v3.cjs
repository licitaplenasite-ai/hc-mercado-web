/* global document, localStorage */
// E2E local do Funil v3 (mapa do Siga Pregão, FALTA 1, 5, 6 e 9): tarefas avançadas no cartão (seções, data e hora,
// prova por documento ou resposta, prazos automáticos, selo de atrasada, modelos), agenda do processos.html, monitor por
// item, Metas e automação (meta, nicho, conversão, Prospecta) e a sugestão do Prospecta no Funil. Prints 1280 e 375.
//   PORTA_TESTE=8893 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8893 node ambiente-teste/e2e-funil-v3.cjs
// Banco LOCAL com supabase/funil_v3.sql aplicado. Cria os próprios processos fictícios e apaga no fim.
const path = require('node:path'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-funil-v3';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const ORG = seed.ids.orgA, EMP = seed.ids.empA1;
const q = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const ORIGEM = '90000000000301-1-000001/2026'; // abertura em 15 dias: prazos automáticos no futuro
const ATRASADO = '90000000000302-1-000002/2026'; // abertura há 2 dias: esclarecimento e impugnação atrasados
const SUGERIDO = '90000000000303-1-000003/2026'; // posto pelo Prospecta
const dia = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const FIXTURE = [
  [ORIGEM, 'Papel sulfite A4 e material de escritório', 'Prefeitura Municipal de Exemplo', `${dia(15)} 09:00-03`],
  [ATRASADO, 'Toner e cartuchos para impressoras', 'Secretaria de Estado de Teste', `${dia(-2)} 10:00-03`],
];
const TODOS = [ORIGEM, ATRASADO, SUGERIDO].map(q).join(',');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

function limpar() {
  psql(`delete from operacao_anexos_processo where processo_id in (select id from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id in (${TODOS}));
    delete from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id in (${TODOS});
    delete from operacao_funil_preferencias where empresa_id=${q(EMP)}; delete from operacao_funil_modelos_tarefas where empresa_id=${q(EMP)};`);
}
function criar() {
  limpar();
  psql(FIXTURE.map(([o, obj, org, prazo]) => `
    with p as (insert into operacao_processos (organizacao_id, empresa_id, origem_externa_id, objeto, orgao, modalidade, sistema, status, decisao, valor_estimado)
      values (${q(ORG)}, ${q(EMP)}, ${q(o)}, ${q(obj)}, ${q(org)}, 'Pregão - Eletrônico', 'Compras.gov.br', 'triagem', 'em_analise', 85000) returning id, organizacao_id)
    insert into operacao_prazos_processo (organizacao_id, processo_id, categoria, titulo, vencimento)
      select organizacao_id, id, 'proposta', 'Prazo de propostas (Boletim)', ${q(prazo)}::timestamptz from p;`).join('\n'));
}
const banco = (sql) => psql(sql);
const proc = (o, col) => banco(`select ${col} from operacao_processos where empresa_id=${q(EMP)} and origem_externa_id=${q(o)}`);

async function abrirFunil(p) {
  await p.goto(SITE + '/painel.html#kanban');
  await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), EMP);
  await p.reload();
  await p.waitForSelector(`#kanban-quadro .kanban-card[data-id="${ORIGEM}"] [data-funil-tarefas]`, { timeout: 30000 });
}
const card = (p, o) => p.locator(`#kanban-quadro .kanban-card[data-id="${o}"]`);
const dlg = (p) => p.locator('#funil-tarefas-dialogo');
async function print(p, nome) { await p.screenshot({ path: path.join(PRINTS, nome), fullPage: false }); }
async function tarefa(p, id) { return dlg(p).locator(`li.ft-tarefa[data-tarefa="${id}"]`); }

(async () => {
  require('node:fs').mkdirSync(PRINTS, { recursive: true });
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  p.on('dialog', (d) => d.accept());
  criar();
  try {
    await p.setViewportSize({ width: 1280, height: 900 });
    await passo('cartão mostra tarefas do modelo padrão e o selo de atrasada', p, async () => {
      await abrirFunil(p);
      exigir(/Tarefas 0 de 9/.test(await card(p, ORIGEM).locator('[data-funil-tarefas]').innerText()), 'cartão sem "Tarefas 0 de 9"');
      exigir(/tarefas atrasadas/.test(await card(p, ATRASADO).innerText()), 'cartão vencido sem selo de atrasada');
      exigir(!/atrasada/.test(await card(p, ORIGEM).innerText()), 'cartão no prazo com selo de atrasada');
      await card(p, ATRASADO).scrollIntoViewIfNeeded();
      await print(p, '01-cartoes-tarefas-1280.png');
    });
    await passo('diálogo: seções, prazos automáticos da Lei 14.133 e botão de agenda', p, async () => {
      await card(p, ORIGEM).locator('[data-funil-tarefas]').click();
      await dlg(p).waitFor({ state: 'visible' });
      exigir(await dlg(p).locator('.ft-secao').count() === 3, 'esperava 3 seções do padrão');
      const esc = await (await tarefa(p, 'esclarecimento')).innerText();
      exigir(/Prazo automático/.test(esc) && /📅/.test(esc), 'esclarecimento sem prazo automático: ' + esc);
      exigir(/Informe a data da ata/.test(await (await tarefa(p, 'recurso')).innerText()), 'recurso sem pedir a data da ata');
      exigir(await dlg(p).locator('.agenda-add').count() >= 3, 'sem "Adicionar à agenda" nas tarefas com data');
      await print(p, '02-tarefas-padrao-1280.png');
    });
    await passo('marcar tarefa simples grava no banco', p, async () => {
      await dlg(p).locator('[data-ft-marcar="baixar-edital"]').check();
      await p.waitForFunction(() => /1 de 9/.test(document.querySelector('#funil-tarefas-titulo')?.textContent || ''));
      exigir(proc(ORIGEM, `tarefas_card->'secoes'->1->'tarefas'->0 ? 'feita_em'`) === 't', 'marcação não chegou ao banco');
    });
    await passo('tarefa que exige resposta só fecha com texto (e recusa CPF)', p, async () => {
      await dlg(p).locator('[data-ft-marcar="anotar-edital"]').click(); // check() falharia: a tela desmarca e pede a resposta
      const form = dlg(p).locator('[data-ft-resposta="anotar-edital"]');
      await form.waitFor();
      exigir(proc(ORIGEM, `tarefas_card->'secoes'->1->'tarefas'->2 ? 'feita_em'`) === 'f', 'fechou sem resposta');
      await form.locator('textarea').fill('Falar com 123.456.789-09');
      await form.locator('button[type=submit]').click();
      await dlg(p).getByText('Não escreva CPF aqui').waitFor();
      await dlg(p).locator('[data-ft-resposta="anotar-edital"] textarea').fill('Entrega em 10 dias; garantia de 12 meses; sem amostra.');
      await print(p, '03-resposta-obrigatoria-1280.png');
      await dlg(p).locator('[data-ft-resposta="anotar-edital"] button[type=submit]').click();
      await p.waitForFunction(() => /2 de 9/.test(document.querySelector('#funil-tarefas-titulo')?.textContent || ''));
      exigir(/garantia de 12 meses/.test(proc(ORIGEM, `tarefas_card->'secoes'->1->'tarefas'->2->>'resposta'`)), 'resposta não gravou');
    });
    await passo('tarefa que exige documento só fecha com o anexo (bucket privado)', p, async () => {
      await dlg(p).locator('[data-ft-marcar="proposta-assinada"]').click();
      const form = dlg(p).locator('[data-ft-anexo="proposta-assinada"]');
      await form.locator('input[type=file]').setInputFiles({ name: 'proposta-assinada.pdf', mimeType: 'application/pdf', buffer: PDF });
      await form.locator('button[type=submit]').click();
      await p.waitForFunction(() => /3 de 9/.test(document.querySelector('#funil-tarefas-titulo')?.textContent || ''));
      const anexo = proc(ORIGEM, `tarefas_card->'secoes'->2->'tarefas'->0->>'anexo_id'`);
      exigir(banco(`select count(*) from operacao_anexos_processo where id=${q(anexo)} and arquivo_caminho like ${q(`${ORG}/${EMP}/%/tarefas/%`)}`) === '1', 'anexo não ligado ao processo');
      exigir(banco(`select count(*) from storage.objects o join operacao_anexos_processo a on a.arquivo_caminho=o.name where a.id=${q(anexo)} and o.bucket_id='operacao-documentos'`) === '1', 'arquivo não está no bucket');
      exigir(/Documento anexado/.test(await (await tarefa(p, 'proposta-assinada')).innerText()), 'tela não mostra o anexo');
    });
    await passo('nova seção e tarefa com data, hora e responsável', p, async () => {
      await dlg(p).locator('[data-ft-nova-secao] input').fill('Habilitação');
      await dlg(p).locator('[data-ft-nova-secao] button').click();
      await dlg(p).locator('.ft-secao').nth(3).waitFor();
      const nova = dlg(p).locator('.ft-secao').nth(3).locator('form.ft-nova input');
      await nova.fill('Pedir atestado de capacidade técnica');
      await nova.press('Enter');
      await dlg(p).getByText('Pedir atestado de capacidade técnica').waitFor();
      await dlg(p).locator('.ft-secao').nth(3).locator('[data-ft-editar]').click();
      const ed = dlg(p).locator('form.ft-edicao');
      await ed.locator('[name=quando]').fill(`${dia(5)}T14:30`);
      await ed.locator('[name=responsavel]').fill('Ana (compras)');
      await ed.locator('[name=exige]').selectOption('documento');
      await print(p, '04-editar-tarefa-1280.png');
      await ed.locator('button[type=submit]').click();
      await dlg(p).getByText('Responsável: Ana (compras)').waitFor();
      const salvo = JSON.parse(proc(ORIGEM, `tarefas_card->'secoes'->3`));
      exigir(salvo.nome === 'Habilitação' && salvo.tarefas[0].quando === `${dia(5)}T14:30` && salvo.tarefas[0].exige === 'documento', 'seção/tarefa não gravou: ' + JSON.stringify(salvo));
    });
    await passo('monitor por item e modelo salvo', p, async () => {
      await dlg(p).locator('[data-ft-itens] input').fill('3, 1');
      await dlg(p).locator('[data-ft-itens] button').click();
      await dlg(p).getByText('Acompanhando os itens 1, 3').waitFor();
      exigir(proc(ORIGEM, 'monitor_itens') === '{1,3}', 'itens do monitor não gravaram');
      await dlg(p).locator('.ft-modelos summary').click();
      await dlg(p).locator('[data-ft-salvar-modelo] input').fill('Pregão completo');
      await dlg(p).locator('[data-ft-salvar-modelo] button').click();
      await p.waitForFunction(() => [...document.querySelectorAll('[data-ft-modelo] option')].some((o) => o.textContent === 'Pregão completo'));
      exigir(banco(`select count(*) from operacao_funil_modelos_tarefas where empresa_id=${q(EMP)} and nome='Pregão completo' and secoes::text not like '%feita_em%'`) === '1', 'modelo não gravou limpo');
      await dlg(p).locator('.ft-monitor').scrollIntoViewIfNeeded();
      await print(p, '05-monitor-e-modelos-1280.png');
      await dlg(p).locator('[data-ft-fechar]').click();
      const texto = await card(p, ORIGEM).locator('[data-funil-tarefas]').innerText();
      exigir(/Tarefas 3 de 10/.test(texto), 'cartão não atualizou a contagem: ' + texto);
    });
    await passo('agenda do processos.html recebe as tarefas com data', p, async () => {
      await p.goto(`${SITE}/processos.html`);
      await p.locator('[data-aba="prazos"]').click();
      await p.getByText('Tarefa: Pedir atestado de capacidade técnica').waitFor({ timeout: 30000 });
      exigir(await p.locator('#lista-prazos .evento-tarefa').filter({ hasText: 'Participar da disputa' }).count() >= 1, 'prazo automático da disputa fora da agenda');
      await print(p, '06-agenda-processos-1280.png');
    });
    await passo('Metas e automação: meta, nicho, conversão e Prospecta gravam por empresa', p, async () => {
      await abrirFunil(p);
      await p.click('#funil-metas');
      const m = p.locator('#funil-metas-dialogo');
      await m.waitFor({ state: 'visible' });
      await m.locator('[name=pro_labore]').fill('10000');
      await m.locator('[name=custo_empresa]').fill('5000');
      await m.locator('[name=caixa_total]').fill('60000');
      await m.getByText('R$ 13.333,33').first().waitFor();
      await print(p, '07-meta-1280.png');
      await m.locator('[data-fm-meta] button[type=submit]').click();
      await m.getByText('Meta salva.').waitFor();
      exigir(banco(`select meta->>'valor_minimo' from operacao_funil_preferencias where empresa_id=${q(EMP)}`) === '13333.33', 'meta não gravou');
      await m.locator('[data-fm-aba="nicho"]').click();
      await m.locator('[name=termo]').fill('papel sulfite');
      await m.locator('[name=participantes]').fill('2.5');
      await m.locator('[name=volume_anual]').fill('5000000');
      await m.locator('[name=marcas]').fill('6');
      await m.locator('[data-fm-nicho] button[type=submit]').click();
      await m.getByText('papel sulfite').waitFor();
      exigir(/nota 4 de 4/.test(await m.locator('.fm-nicho').first().innerText()), 'nicho sem nota 4');
      await print(p, '08-nicho-1280.png');
      await m.locator('[data-fm-aba="conversao"]').click();
      await m.locator('.fm-tabela').waitFor();
      await print(p, '09-conversao-1280.png');
      await m.locator('[data-fm-aba="automacao"]').click();
      await m.locator('[name=prospecta_ativo]').check();
      await m.locator('[name=prospecta_limite]').fill('2');
      await m.locator('[data-fm-automacao] button[type=submit]').click();
      await m.getByText('Preferências salvas.').waitFor();
      await print(p, '10-prospecta-1280.png');
      exigir(banco(`select prospecta_ativo||'|'||prospecta_limite from operacao_funil_preferencias where empresa_id=${q(EMP)}`) === 'true|2', 'Prospecta não ligou');
      await m.locator('[data-fm-fechar]').click();
    });
    await passo('sugestão do Prospecta aparece com selo e "Dispensar" arquiva', p, async () => {
      const n = banco(`set role service_role; select public.prospecta_sugerir(${q(EMP)}, '[{"numero_controle":"${SUGERIDO}","objeto":"Resma de papel reciclado","orgao":"Câmara Municipal de Teste","nota":85,"encerramento":"${dia(9)}T09:00:00"}]'::jsonb);`);
      exigir(n === '1', 'Prospecta não pôs a sugestão: ' + n);
      exigir(banco(`set role service_role; select public.prospecta_sugerir(${q(EMP)}, '[{"numero_controle":"${SUGERIDO}","objeto":"x","nota":99}]'::jsonb);`) === '0', 'duplicou');
      await abrirFunil(p);
      await card(p, SUGERIDO).getByText('Sugerida · nota 85').waitFor({ timeout: 30000 });
      await card(p, SUGERIDO).scrollIntoViewIfNeeded();
      await print(p, '11-sugerida-1280.png');
      await card(p, SUGERIDO).locator('[data-funil-dispensar]').click();
      await p.waitForFunction((o) => !document.querySelector(`#kanban-quadro .kanban-card[data-id="${o}"]`), SUGERIDO);
      exigir(proc(SUGERIDO, 'status') === 'arquivado', 'dispensar não arquivou');
    });
    await p.setViewportSize({ width: 375, height: 812 });
    await passo('celular 375: cartão e diálogos sem rolagem horizontal', p, async () => {
      await abrirFunil(p);
      await card(p, ATRASADO).scrollIntoViewIfNeeded();
      await print(p, '12-cartao-375.png');
      await card(p, ORIGEM).locator('[data-funil-tarefas]').click();
      await dlg(p).waitFor({ state: 'visible' });
      const largura = await p.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('#funil-tarefas-dialogo').scrollWidth));
      exigir(largura <= 375, `diálogo com ${largura}px`);
      await print(p, '13-tarefas-375.png');
      await dlg(p).locator('[data-ft-fechar]').click();
      await p.click('#funil-metas');
      await p.locator('#funil-metas-dialogo').waitFor({ state: 'visible' });
      await print(p, '14-metas-375.png');
      await p.locator('#funil-metas-dialogo [data-fm-fechar]').click();
    });
    await passo('tema escuro usa os mesmos tokens', p, async () => {
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.evaluate(() => { document.documentElement.classList.remove('tema-claro'); document.documentElement.dataset.theme = 'dark'; });
      await card(p, ORIGEM).locator('[data-funil-tarefas]').click();
      await dlg(p).waitFor({ state: 'visible' });
      await print(p, '15-tarefas-escuro-1280.png');
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
