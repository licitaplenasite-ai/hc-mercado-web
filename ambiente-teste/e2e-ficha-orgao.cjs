/* global document, localStorage, window */
// E2E da fase 2 do CRM (24/11/2026): linha do tempo no dossiê do processo e ficha do órgão (orgao.html), aberta pelo
// processo e pelo cartão do Funil. Contato com e-mail errado mostra o erro e salva depois de corrigido; anotação;
// "Acompanhar este órgão"; papel leitura sem formulário; outra organização não vê as anotações. Prints 1366, 375 e escuro.
//   PORTA_TESTE=8896 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8896 node ambiente-teste/e2e-ficha-orgao.cjs
// Banco LOCAL (subir.cjs) com crm_orgao_linha_tempo.sql aplicado. Cria dados FICTÍCIOS (contratos/atas/processos
// "exemplo local" do Município de Apuí) e apaga tudo o que criou no fim.
const path = require('node:path'), fs = require('node:fs'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-fase2-orgao';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const CNPJ = '22812960000199', GANHO = 'f2000000-0000-4000-8000-000000000001';
const FIXTURES = `
begin;
insert into contratos(numero_controle_pncp, objeto, uf, cnpj_fornecedor, data_assinatura, dado) values
 ('${CNPJ}-2-000031/2026', 'Serviços gráficos (exemplo local)', 'AM', '11111111000191', '2026-08-12', '{"orgao":"MUNICIPIO DE APUI","municipio":"Apuí","nomeFornecedor":"Gráfica Exemplo Norte LTDA","valor":84500}'),
 ('${CNPJ}-2-000027/2026', 'Material de expediente (exemplo local)', 'AM', '65d6fe24000100', '2026-05-03', '{"orgao":"MUNICIPIO DE APUI","municipio":"Apuí","nomeFornecedor":"Materiais Horizonte Teste LTDA","valor":31200.5}'),
 ('${CNPJ}-2-000012/2025', 'Impressos para a Secretaria de Saúde (exemplo local)', 'AM', '11111111000191', '2025-09-20', '{"orgao":"MUNICIPIO DE APUI","municipio":"Apuí","nomeFornecedor":"Gráfica Exemplo Norte LTDA","valor":47900}')
 on conflict do nothing;
insert into mercado_atas(numero_controle_pncp_ata, numero_controle_pncp_compra, objeto, uf_orgao, municipio_orgao, data_assinatura, vigencia_fim, dado) values
 ('${CNPJ}-1-000019/2026-000001', '${CNPJ}-1-000019/2026', 'Registro de preços de papel A4 (exemplo local)', 'AM', 'Apuí', '2026-03-10', '2027-03-10', '{"orgao":"MUNICIPIO DE APUI"}')
 on conflict do nothing;
insert into operacao_processos(id, organizacao_id, empresa_id, objeto, numero, orgao, modalidade, status, decisao, origem_externa_id, valor_estimado, observacoes, criado_em)
 values ('${GANHO}', '${seed.ids.orgA}', '${seed.ids.empA2}', 'Material de expediente para as escolas municipais (exemplo local)', 'PE 27/2026', 'MUNICIPIO DE APUI',
 'Pregão eletrônico', 'triagem', 'participar', '${CNPJ}-1-000027/2026', 36000, 'fixture-fase2', '2026-04-02 13:10:00+00') on conflict do nothing;
update operacao_processos set status = 'preparacao' where id = '${GANHO}' and status = 'triagem';
update operacao_processos set status = 'sessao', data_sessao = '2026-04-22 14:00:00+00', data_publicacao = '2026-04-08' where id = '${GANHO}' and status = 'preparacao';
update operacao_processos set status = 'homologado', situacao_resultado = 'vitoria_total', valor_homologado = 31200.50, data_resultado = '2026-04-30' where id = '${GANHO}' and status = 'sessao';
update operacao_processos_etapas_historico h set mudou_em = v.quando from (values ('triagem', '2026-04-02 13:10:00+00'::timestamptz),
 ('preparacao', '2026-04-09 15:40:00+00'), ('sessao', '2026-04-21 19:05:00+00'), ('homologado', '2026-04-30 17:20:00+00')) v(st, quando)
 where h.processo_id = '${GANHO}' and h.status_novo = v.st;
delete from operacao_prazos_processo where processo_id = '${GANHO}'; delete from operacao_ocorrencias where processo_id = '${GANHO}';
insert into operacao_prazos_processo(organizacao_id, processo_id, categoria, titulo, vencimento, responsavel, concluido_em) values
 ('${seed.ids.orgA}', '${GANHO}', 'esclarecimento', 'Pedir esclarecimento sobre a amostra', '2026-04-16 20:00:00+00', 'Ana', '2026-04-15 13:30:00+00'),
 ('${seed.ids.orgA}', '${GANHO}', 'entrega', 'Primeira entrega nas escolas', '2026-12-05 15:00:00+00', 'Bruno', null);
insert into operacao_ocorrencias(organizacao_id, processo_id, ocorrido_em, categoria, descricao) values
 ('${seed.ids.orgA}', '${GANHO}', '2026-04-22 14:45:00+00', 'chat', 'Pregoeira pediu a proposta readequada em 2 horas.');
insert into operacao_contratos(organizacao_id, processo_id, numero, assinado_em, valor, situacao) values
 ('${seed.ids.orgA}', '${GANHO}', '27/2026', '2026-05-03', 31200.50, 'vigente') on conflict do nothing;
insert into operacao_processos(id, organizacao_id, empresa_id, objeto, orgao, status, decisao, valor_estimado, observacoes, criado_em)
 values ('f2000000-0000-4000-8000-000000000002', '${seed.ids.orgA}', '${seed.ids.empA1}', 'Impressos para a Secretaria de Saúde (exemplo local)',
 'Municipio de Apui', 'triagem', 'participar', 52000, 'fixture-fase2', '2025-08-28 12:00:00+00') on conflict do nothing;
update operacao_processos set status = 'perdido', situacao_resultado = 'sem_vitoria', motivo_perda = 'Preço 8% acima do vencedor', data_resultado = '2025-09-15'
 where id = 'f2000000-0000-4000-8000-000000000002' and status = 'triagem';
update operacao_processos_etapas_historico set mudou_em = case status_novo when 'triagem' then '2025-08-28 12:00:00+00'::timestamptz else '2025-09-15 18:00:00+00' end
 where processo_id = 'f2000000-0000-4000-8000-000000000002';
commit;`;
const limpar = () => psql(`delete from operacao_orgaos_registros where orgao_chave in ('cnpj:${CNPJ}', 'nome:municipio de apui');
  delete from operacao_processos where observacoes = 'fixture-fase2';
  delete from contratos where objeto like '%(exemplo local)'; delete from mercado_atas where objeto like '%(exemplo local)';`);
const semRolagemLateral = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  fs.mkdirSync(PRINTS, { recursive: true });
  limpar(); psql(FIXTURES);
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge' });
  let p;
  try {
    p = await novaPagina(navegador, seed.usuarios.gestor);
    await passo('dossie com linha do tempo unica', null, async () => {
      await p.goto(`${SITE}/processos.html?empresa=${seed.ids.empA2}&processo=${GANHO}`);
      await p.waitForSelector('#d-linha-tempo .lt-item', { timeout: 20000 });
      exigir(await p.isVisible('#d-linha-tempo [data-lt-todos]'), 'botão "Mostrar tudo" com mais de 8 registros');
      await p.click('#d-linha-tempo [data-lt-todos]');
      const titulos = await p.$$eval('#d-linha-tempo .lt-item strong', (xs) => xs.map((x) => x.textContent));
      exigir(titulos[0] === 'Prazo: Primeira entrega nas escolas', 'primeiro item devia ser o prazo futuro: ' + titulos[0]);
      for (const t of ['Resultado: Vitória total', 'Mudou para Homologado', 'Mensagem do chat', 'Prazo cumprido: Pedir esclarecimento sobre a amostra', 'Processo criado a partir do Boletim / Funil'])
        exigir(titulos.some((x) => x.startsWith(t.split(':')[0]) && x.includes(t.split(': ')[1] || t)), 'faltou: ' + t + ' em ' + titulos.join(' | '));
      exigir(await p.isVisible('#d-linha-tempo .lt-futuro .lt-selo'), 'selo "Próximo" em texto');
      await p.locator('#modal-dossie .modal-corpo').screenshot({ path: path.join(PRINTS, '01-dossie-linha-do-tempo-1366.png') });
      return `${titulos.length} itens: ${titulos.slice(0, 4).join(' | ')}…`;
    });
    await passo('ficha do orgao aberta pelo processo', p, async () => {
      const href = await p.getAttribute('#modal-dossie .link-ficha-orgao', 'href');
      exigir(href && href.startsWith(`orgao.html?cnpj=${CNPJ}`), 'link da ficha: ' + href);
      await p.click('#modal-dossie .link-ficha-orgao');
      await p.waitForSelector('.fo-kpis', { timeout: 20000 });
      const kpis = await p.$$eval('.fo-kpi b', (xs) => xs.map((x) => x.textContent));
      exigir(Number(kpis[0]) >= 1, 'licitações abertas: ' + kpis[0]);
      exigir(kpis[1] === '1 de 2', 'histórico ganho/perdido: ' + kpis[1]);
      exigir(/31\.200,50/.test(kpis[2]), 'valor ganho: ' + kpis[2]);
      exigir(kpis[3] === '3', 'contratos do órgão: ' + kpis[3]);
      const linhas = await p.$$eval('#fo-h-historico ~ .fo-tabela-wrap tbody tr', (xs) => xs.length);
      // 2 pelo CNPJ (o do seed e o ganho) + 1 cadastrado à mão, achado pelo nome.
      exigir(linhas === 3, 'processos pelo CNPJ e o cadastrado à mão pelo nome: ' + linhas);
      exigir(await semRolagemLateral(p), 'página rola de lado');
      return 'KPIs: ' + kpis.join(' / ');
    });
    await passo('contato com erro na hora e depois salvo', null, async () => {
      await p.fill('#fc-nome', 'Maria Pregoeira (exemplo)'); await p.fill('#fc-papel', 'Pregoeira'); await p.fill('#fc-telefone', '(97) 3389-1000');
      await p.fill('#fc-email', 'maria@'); await p.click('#fo-form-contato [type=submit]');
      exigir((await p.textContent('#fc-erro')).includes('E-mail inválido'), 'mensagem do e-mail');
      exigir(await p.getAttribute('#fc-email', 'aria-invalid') === 'true', 'campo marcado');
      await p.screenshot({ path: path.join(PRINTS, '03-contato-erro-na-hora.png'), fullPage: false, clip: await p.locator('#fo-h-contatos').locator('..').boundingBox() });
      await p.fill('#fc-email', 'pregoeira@apui.example.invalid');
      exigir(!(await p.textContent('#fc-erro')).trim(), 'erro some ao corrigir');
      await p.click('#fo-form-contato [type=submit]');
      await p.waitForSelector('text=Maria Pregoeira (exemplo)', { timeout: 10000 });
      await p.fill('#fa-texto', 'Exemplo: exige amostra em 48 h e costuma pagar em 30 dias.'); await p.click('#fo-form-anotacao [type=submit]');
      await p.waitForSelector('text=Exemplo: exige amostra em 48 h', { timeout: 10000 });
      await p.click('#fo-acompanhar');
      await p.waitForSelector('#fo-acompanhar[aria-pressed="true"]', { timeout: 10000 });
      const n = psql(`select string_agg(tipo, ',' order by tipo) from operacao_orgaos_registros where orgao_chave = 'cnpj:${CNPJ}' and organizacao_id = '${seed.ids.orgA}'`);
      exigir(n === 'acompanhar,anotacao,contato', 'gravado no banco: ' + n);
      return n;
    });
    await passo('ficha completa 1366', p, async () => { await p.evaluate(() => window.scrollTo(0, 0)); });
    await passo('lista de orgaos acompanhados', p, async () => {
      await p.goto(`${SITE}/orgao.html`);
      await p.waitForSelector('#fo-busca');
      exigir(await p.isVisible('text=MUNICIPIO DE APUI'), 'órgão acompanhado na lista');
      await p.click('#fo-busca [type=submit]');
      exigir((await p.textContent('#fo-busca-erro')).includes('14 números'), 'busca vazia explica o que fazer');
    });
    await passo('cartao do Funil leva a ficha', p, async () => {
      await p.goto(`${SITE}/painel.html#kanban`);
      await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), seed.ids.empA1);
      await p.reload();
      const link = p.locator(`.kanban-card a.kanban-card-orgao[href^="orgao.html?cnpj=${CNPJ}"]`).first();
      await link.waitFor({ timeout: 25000 });
      await link.scrollIntoViewIfNeeded();
      await Promise.all([p.waitForURL(/orgao\.html/), link.click()]);
      await p.waitForSelector('.fo-kpis', { timeout: 20000 });
    });
    const erros = p.erros.filter((e) => !/favicon|chat-ia|ia-conversas|404 GET \/api\//.test(e));
    await passo('console sem erro (gestor)', null, async () => { exigir(!erros.length, erros.join(' | ')); return p.erros.length + ' avisos ignorados (favicon/chat)'; });
    await p.context().close();

    const cel = await navegador.newContext({ viewport: { width: 375, height: 812 }, locale: 'pt-BR', isMobile: true, hasTouch: true });
    p = await cel.newPage(); p.erros = [];
    const { entrar } = require('./e2e.cjs');
    await entrar(p, seed.usuarios.gestor);
    await passo('celular 375 ficha', p, async () => {
      await p.goto(`${SITE}/orgao.html?cnpj=${CNPJ}&nome=MUNICIPIO%20DE%20APUI`);
      await p.waitForSelector('.fo-kpis', { timeout: 20000 });
      exigir(await semRolagemLateral(p), 'página rola de lado no celular');
    });
    await passo('celular 375 linha do tempo', null, async () => {
      await p.goto(`${SITE}/processos.html?empresa=${seed.ids.empA2}&processo=${GANHO}`);
      await p.waitForSelector('#d-linha-tempo .lt-item', { timeout: 20000 });
      await p.locator('#d-linha-tempo').screenshot({ path: path.join(PRINTS, '07-celular-linha-do-tempo.png') });
      exigir(await semRolagemLateral(p), 'página rola de lado no celular');
    });
    await passo('escuro 375 ficha', p, async () => {
      await p.evaluate(() => localStorage.setItem('licitaplena_tema', 'escuro'));
      await p.goto(`${SITE}/orgao.html?cnpj=${CNPJ}`);
      await p.waitForSelector('.fo-kpis', { timeout: 20000 });
      exigir(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'tema escuro');
    });
    await cel.close();

    const esc = await navegador.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' });
    p = await esc.newPage(); p.erros = [];
    await entrar(p, seed.usuarios.gestor);
    await passo('escuro 1366 dossie', null, async () => {
      await p.evaluate(() => localStorage.setItem('licitaplena_tema', 'escuro'));
      await p.goto(`${SITE}/processos.html?empresa=${seed.ids.empA2}&processo=${GANHO}`);
      await p.waitForSelector('#d-linha-tempo .lt-item', { timeout: 20000 });
      await p.locator('#modal-dossie .modal-corpo').screenshot({ path: path.join(PRINTS, '10-escuro-dossie-linha-do-tempo.png') });
    });
    await esc.close();

    p = await novaPagina(navegador, seed.usuarios.leitura);
    await passo('papel leitura ve sem formulario', p, async () => {
      await p.goto(`${SITE}/orgao.html?cnpj=${CNPJ}`);
      await p.waitForSelector('.fo-kpis', { timeout: 20000 });
      exigir(await p.isVisible('text=Maria Pregoeira (exemplo)'), 'leitura vê o contato');
      exigir(!(await p.$('#fo-form-contato')) && !(await p.$('#fo-acompanhar')), 'leitura sem formulário nem acompanhar');
    });
    await p.context().close();
    p = await novaPagina(navegador, seed.usuarios.outra_org);
    await passo('outra organizacao nao ve anotacoes', p, async () => {
      await p.goto(`${SITE}/orgao.html?cnpj=${CNPJ}`);
      await p.waitForSelector('.fo-kpis', { timeout: 20000 });
      exigir(!(await p.isVisible('text=Maria Pregoeira (exemplo)')), 'vazou contato de outra organização');
      exigir((await p.$$eval('.fo-kpi b', (xs) => xs[1].textContent)) === '0 de 0', 'histórico de outra org');
    });
    await p.context().close();
  } finally {
    await navegador.close();
    limpar();
    fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 2));
    const falhas = resultados.filter((r) => !r.ok).length;
    console.log(falhas ? `${falhas} passo(s) falharam` : 'TUDO OK');
    process.exitCode = falhas ? 1 : 0;
  }
})();
