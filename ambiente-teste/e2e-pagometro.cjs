/* global document, window -- usados só dentro de p.evaluate (rodam no navegador) */
// E2E local do Pagômetro (pagometro-ui.js + /api/pagometro). Ambiente: subir.cjs + servidor.cjs rodando.
//   npm run build:cloudflare && PORTA_TESTE=8899 node ambiente-teste/servidor.cjs   (outro terminal)
//   SITE_TESTE=http://127.0.0.1:8899 node ambiente-teste/e2e-pagometro.cjs
// Usa o SICONFI do Tesouro e a API do TCE-SP de verdade (públicas, sem chave). A busca do painel é simulada
// (pncp-proxy); no banco LOCAL, a linha de Manaus (pagometro_entes) e as de prazo de Adolfo-SP e da UG federal
// fictícia (pagometro_prazos) são apagadas antes, para provar coleta, fila do robô e cache.
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-pagometro';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados, robo } = require('./e2e.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const SELOS = /Costuma pagar em dia|Paga, mas deixa parte|Histórico de atraso relevante|Sem dados recentes/;
const futuro = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
const edital = (numero, esfera, orgao, uf, municipio, unidade = null) => ({ numero_controle_pncp: numero, description: `Material de limpeza (e2e pagômetro ${esfera} ${municipio})`,
  title: `Material de limpeza (e2e pagômetro ${esfera} ${municipio})`, uf, municipio_nome: municipio, orgao_nome: orgao, esfera_id: esfera, unidade_codigo: unidade,
  data_fim_vigencia: `${futuro}T17:00:00`, data_publicacao_pncp: '2026-11-18T10:00:00', modalidade_licitacao_nome: 'Pregão - Eletrônico' });
const UG_TESTE = '999990';
const EDITAIS = [edital('99999999000191-1-000001/2026', 'M', 'MUNICIPIO DE MANAUS', 'AM', 'Manaus'),
  edital('99999999000191-1-000002/2026', 'F', 'Órgão federal fictício', 'DF', 'Brasília', UG_TESTE),
  edital('99999999000191-1-000003/2026', 'M', 'PREFEITURA MUNICIPAL DE ADOLFO', 'SP', 'Adolfo')];
const prazoNaTela = (p) => p.locator('#modal-ia-pagometro .pagometro-prazo').innerText({ timeout: 30000 });

async function abrirResumo(p, indice) {
  await p.locator('#modal-ia-fechar').click().catch(() => {});
  const card = p.locator('#op-resultado .boletim-card').nth(indice);
  const resposta = indice === 0 ? p.waitForResponse((r) => r.url().includes('/api/pagometro?ente='), { timeout: 90000 }) : null;
  await card.getByRole('button', { name: /Resumir edital/ }).click();
  await p.waitForSelector('#modal-ia-fundo.aberto', { timeout: 15000 });
  return resposta ? (await resposta).json() : null;
}

(async () => {
  fs.mkdirSync(PRINTS, { recursive: true });
  psql(`delete from pagometro_entes where id_ente='1302603'; delete from pagometro_prazos where chave in ('M:3500204','F:${UG_TESTE}');`);
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.route('**/api/pncp-proxy**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: EDITAIS.length, items: EDITAIS }) }));
  try {
    await passo('Busca simulada com edital municipal e federal', p, async () => {
      await p.goto(SITE + '/painel.html');
      await p.locator('nav button[data-alvo="oportunidades"]').dispatchEvent('click');
      await p.waitForSelector('#op-palavras', { state: 'visible' });
      await p.evaluate(() => { document.querySelector('#op-uf').querySelectorAll('option').forEach((o) => { o.selected = false; }); });
      await p.fill('#op-palavras', 'limpeza'); await p.click('#op-buscar');
      await p.locator('#op-resultado .boletim-card').nth(2).waitFor({ timeout: 30000 });
      return `${await p.locator('#op-resultado .boletim-card').count()} cartões`;
    });
    await passo('Resumo do edital municipal: Pagômetro coleta no SICONFI, mostra selo, data e fonte', p, async () => {
      const j = await abrirResumo(p, 0);
      exigir(j && j.guardado === false && j.id_ente === '1302603', `resposta inesperada: ${JSON.stringify(j).slice(0, 300)}`);
      const caixa = p.locator('#modal-ia-pagometro .pagometro');
      await caixa.locator('.pagometro-selo').waitFor({ timeout: 30000 });
      const texto = await caixa.innerText();
      exigir(SELOS.test(texto), `sem selo: ${texto}`);
      exigir(/dados públicos/.test(texto) && /SICONFI/.test(texto) && /Consultado em \d{2}\/\d{2}\/\d{4}/.test(texto), `sem aviso de dado público/data/fonte: ${texto}`);
      const href = await caixa.getByRole('link', { name: 'Ver dado bruto no Tesouro' }).getAttribute('href');
      exigir(href.startsWith('https://apidatalake.tesouro.gov.br/'), `link da fonte: ${href}`);
      const banco = psql("select semaforo||'|'||exercicio from pagometro_entes where id_ente='1302603';");
      exigir(banco === `${j.semaforo}|${j.exercicio}`, `cache no banco: "${banco}"`);
      await caixa.screenshot({ path: path.join(PRINTS, 'pagometro-manaus-1280.png') });
      return `${j.nome}: ${j.semaforo} (${j.exercicio}), pago ${Math.round(j.indicadores.taxaPago * 100)}% | banco ${banco}`;
    });
    await passo('Segunda consulta usa o cache (guardado: true)', p, async () => {
      const j = await abrirResumo(p, 0);
      exigir(j.guardado === true, `não usou o cache: ${JSON.stringify(j).slice(0, 200)}`);
      return 'guardado: true';
    });
    await passo('Manaus: prazo em dias diz "sem dado público" (fora de SP e não federal)', p, async () => {
      const t = await prazoNaTela(p);
      exigir(/sem dado público/.test(t), `prazo de Manaus: ${t}`);
      return t;
    });
    await passo('Edital federal: sem semáforo do SICONFI; prazo entra na fila da UG', p, async () => {
      let chamouEnte = false;
      const ouvir = (r) => { if (r.url().includes('/api/pagometro?ente=')) chamouEnte = true; };
      p.on('request', ouvir);
      await abrirResumo(p, 1);
      const t = await prazoNaTela(p);
      p.off('request', ouvir);
      const texto = await p.locator('#modal-ia-pagometro .pagometro').innerText();
      const fila = psql(`select situacao from pagometro_prazos where chave='F:${UG_TESTE}';`);
      exigir(/federal/.test(texto) && !chamouEnte && /calculando/.test(t) && fila === 'pendente', `federal: "${texto}" ente=${chamouEnte} fila=${fila}`);
      return `${t} | fila: ${fila}`;
    });
    await passo('Município de SP (Adolfo): pedido na fila, robô lê o TCE-SP, tela mostra os dias', p, async () => {
      await abrirResumo(p, 2);
      const antes = await prazoNaTela(p);
      exigir(/calculando/.test(antes), `antes do robô: ${antes}`);
      const r = robo('coletar_pagometro_prazos.js', { PAUSA_MS_PAGOMETRO: '200' });
      exigir(r.status === 0 && /M:3500204: 24m \d+ dias/.test(r.saida), `robô: ${r.saida}`);
      exigir(/F:999990: sem TRANSPARENCIA_TOKEN, fica pendente/.test(r.saida), `federal sem token: ${r.saida}`);
      const banco = psql("select situacao||'|'||dias_24m||'|'||dias_36m from pagometro_prazos where chave='M:3500204';");
      await abrirResumo(p, 2);
      const depois = await prazoNaTela(p);
      const [, d24, d36] = banco.split('|');
      exigir(banco.startsWith('pronto|') && depois.includes(`em 24 meses, ${d24} dias`) && depois.includes(`em 36 meses, ${d36} dias`) && /TCE-SP/.test(depois) && /calculado em \d{2}\/\d{2}\/\d{4}/.test(depois), `depois: ${depois} | banco ${banco}`);
      await p.locator('#modal-ia-pagometro .pagometro').screenshot({ path: path.join(PRINTS, 'pagometro-adolfo-prazo-1280.png') });
      return depois;
    });
    await passo('Celular 375: sem rolagem horizontal', p, async () => {
      await abrirResumo(p, 0);
      await p.setViewportSize({ width: 375, height: 812 });
      const caixa = p.locator('#modal-ia-pagometro .pagometro');
      await caixa.locator('.pagometro-selo').waitFor({ timeout: 30000 });
      await p.waitForTimeout(400);
      const { largura, janela } = await p.evaluate(() => ({ largura: document.documentElement.scrollWidth, janela: window.innerWidth }));
      await caixa.screenshot({ path: path.join(PRINTS, 'pagometro-manaus-375.png') });
      await p.setViewportSize({ width: 1280, height: 900 });
      exigir(largura <= janela, `rolagem horizontal: ${largura} > ${janela}`);
      return `scrollWidth ${largura} / innerWidth ${janela}`;
    });
    await passo('erros de página', null, async () => {
      const graves = p.erros.filter((e) => /pageerror/.test(e));
      exigir(!graves.length, graves.join(' | '));
      return `${p.erros.length} aviso(s) de rede/console (não fatais)`;
    });
  } finally {
    psql(`delete from pagometro_prazos where chave='F:${UG_TESTE}';`);
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.map((f) => f.nome).join('; ')}` : 'OK');
  process.exit(falhas.length ? 1 : 0);
})();
