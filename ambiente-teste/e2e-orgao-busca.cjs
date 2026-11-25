/* global document, localStorage, window */
// E2E da busca de órgãos (24/11/2026): autocompletar em orgao.html com nomes reais (catálogo local carregado com o
// cadastro do PNCP por scripts/atualizar_cadastro_orgaos.js), Enter abre o primeiro, filtro de UF, nada achado com dica,
// ficha aberta por nome digitado à mão (processo sem CNPJ) e a ficha completada ao vivo pelo PNCP (/api/orgao-pncp).
//   PORTA_TESTE=8897 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8897 node ambiente-teste/e2e-orgao-busca.cjs
// Banco LOCAL (subir.cjs) com orgaos_catalogo.sql e crm_orgao_linha_tempo.sql aplicados e o cadastro carregado:
//   AMBIENTE_TESTE_REDIRECIONAR=1 node -r ./ambiente-teste/redirecionar-fetch.cjs scripts/atualizar_cadastro_orgaos.js
// A ficha ao vivo vai ao PNCP de verdade (leitura pública; pode levar 30-60 s). Não grava nada no banco.
const path = require('node:path'), fs = require('node:fs'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-orgao-busca';
const { passo, exigir, novaPagina, entrar, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
// UF vem dos dados coletados: duas licitações fictícias (CNPJs reais da SEDUC-PA e de Apuí) dão UF e atividade.
const FIXTURES = `insert into oportunidades_abertas(chave, numero_controle_pncp, objeto, uf, publicacao, encerramento, dado) values
  ('05054937000163-1-990001/2026', '05054937000163-1-990001/2026', 'Material escolar (exemplo busca)', 'PA', current_date, current_date + 20, '{"orgao":"SECRETARIA DE ESTADO DE EDUCACAO","municipio":"Belém","codigoUnidade":"925999"}'),
  ('22812960000199-1-990001/2026', '22812960000199-1-990001/2026', 'Merenda (exemplo busca)', 'AM', current_date, current_date + 20, '{"orgao":"MUNICIPIO DE APUI","municipio":"Apuí"}')
  on conflict do nothing; select public.atualizar_orgaos_catalogo();`;
const limpar = () => psql("delete from oportunidades_abertas where objeto like '%(exemplo busca)'; select public.atualizar_orgaos_catalogo();");
const semRolagemLateral = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const sugestoes = (p) => p.$$eval('#fo-sugestoes li strong', (xs) => xs.map((x) => x.textContent));
async function digitar(p, termo) {
  await p.fill('#fo-busca-termo', '');
  await p.type('#fo-busca-termo', termo, { delay: 25 });
  await p.waitForFunction(() => { const s = document.getElementById('fo-busca-status').textContent; return s && !/Procurando/.test(s); }, null, { timeout: 30000 });
}

(async () => {
  fs.mkdirSync(PRINTS, { recursive: true });
  const n = Number(psql('select count(*) from orgaos_catalogo where nome_registro is not null'));
  if (n < 1000) throw new Error(`Catálogo local sem o cadastro do PNCP (${n} órgãos): rode scripts/atualizar_cadastro_orgaos.js antes (ver cabeçalho).`);
  limpar(); psql(FIXTURES);
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge' });
  let p;
  try {
    p = await novaPagina(navegador, seed.usuarios.gestor);
    await passo('autocompletar com acento e nome inteiro', null, async () => {
      await p.goto(`${SITE}/orgao.html`);
      await p.waitForSelector('#fo-busca-termo');
      await digitar(p, 'Município de Apuí');
      const s = await sugestoes(p);
      exigir(s[0] === 'MUNICIPIO DE APUI', 'primeira sugestão: ' + s.join(' | '));
      exigir(await p.getAttribute('#fo-busca-termo', 'aria-expanded') === 'true', 'combobox aberto');
      await p.screenshot({ path: path.join(PRINTS, '01-autocompletar-municipio-de-apui-1366.png') });
      return s.slice(0, 3).join(' | ');
    });
    await passo('prefeitura = municipio e setas', null, async () => {
      await digitar(p, 'pref manaus');
      const s = await sugestoes(p);
      exigir(s[0] === 'MUNICIPIO DE MANAUS', 'pref manaus: ' + s.join(' | '));
      await p.keyboard.press('ArrowDown');
      exigir(await p.getAttribute('#fo-busca-termo', 'aria-activedescendant') === 'fo-sug-0', 'seta marca a primeira');
      await p.screenshot({ path: path.join(PRINTS, '02-autocompletar-pref-manaus-seta.png') });
      return s.slice(0, 3).join(' | ');
    });
    await passo('sigla e filtro de UF', null, async () => {
      await digitar(p, 'tjam');
      exigir((await sugestoes(p))[0] === 'AMAZONAS TRIBUNAL DE JUSTICA', 'tjam');
      await p.selectOption('#fo-busca-uf', 'PA');
      await digitar(p, 'sec educacao');
      const s = await sugestoes(p);
      exigir(s.length && (await p.textContent('#fo-sugestoes')).includes('/PA'), 'filtro PA: ' + s.join(' | '));
      await p.screenshot({ path: path.join(PRINTS, '03-sigla-e-filtro-uf-pa.png') });
      await p.selectOption('#fo-busca-uf', '');
      return s.slice(0, 2).join(' | ');
    });
    await passo('nada encontrado explica o que tentar', null, async () => {
      await p.selectOption('#fo-busca-uf', 'RR');
      await digitar(p, 'universidade federal do para');
      const st = await p.textContent('#fo-busca-status');
      exigir(/Tente parte do nome, a cidade, a sigla ou o CNPJ, ou tire o filtro de UF/.test(st), 'mensagem: ' + st);
      await p.screenshot({ path: path.join(PRINTS, '04-nada-encontrado-com-dica.png') });
      await p.selectOption('#fo-busca-uf', '');
      return st;
    });
    await passo('Enter abre o primeiro e a ficha vem do PNCP ao vivo', p, async () => {
      await digitar(p, 'prefeitura municipal de apui');
      await Promise.all([p.waitForURL(/orgao\.html\?cnpj=22812960000199/, { timeout: 20000 }), p.press('#fo-busca-termo', 'Enter')]);
      await p.waitForSelector('.fo-kpis', { timeout: 20000 });
      await p.waitForSelector('#fo-pncp.carregando', { timeout: 10000 }).catch(() => {});
      await p.screenshot({ path: path.join(PRINTS, '05-ficha-buscando-no-pncp.png') });
      await p.waitForFunction(() => { const c = document.getElementById('fo-pncp'); return c && !c.classList.contains('carregando'); }, null, { timeout: 90000 });
      const aviso = await p.textContent('#fo-pncp');
      exigir(/Inclui o PNCP consultado|não respondeu/.test(aviso), 'aviso da origem: ' + aviso);
      const titulo = await p.textContent('#fo-titulo');
      exigir(titulo === 'MUNICIPIO DE APUI', 'título: ' + titulo);
      exigir(/Esfera municipal/.test(await p.textContent('.fo-cabeca p')), 'esfera no subtítulo');
      exigir(await semRolagemLateral(p), 'página rola de lado');
      const kpis = await p.$$eval('.fo-kpi b', (xs) => xs.map((x) => x.textContent));
      return `${aviso.trim()} | KPIs ${kpis.join(' / ')}`;
    });
    await passo('nome digitado a mao no processo acha o orgao', p, async () => {
      await p.goto(`${SITE}/orgao.html?nome=${encodeURIComponent('Prefeitura Municipal de Apuí')}`);
      await p.waitForSelector('.fo-kpis', { timeout: 20000 });
      const sub = await p.textContent('.fo-cabeca p');
      exigir(sub.includes('22.812.960/0001-99'), 'achou pelo nome canônico: ' + sub);
      return sub;
    });
    await passo('nome sem orgao igual mostra parecidos', p, async () => {
      await p.goto(`${SITE}/orgao.html?nome=${encodeURIComponent('Prefeitura de Manaos')}`);
      await p.waitForSelector('.fo-nao-achou', { timeout: 20000 });
      const itens = await p.$$eval('.fo-nao-achou li strong', (xs) => xs.map((x) => x.textContent));
      exigir(itens.length > 0, 'sem sugestões');
      return itens.slice(0, 3).join(' | ');
    });
    const erros = p.erros.filter((e) => !/favicon|chat-ia|ia-conversas|404 GET \/api\//.test(e));
    await passo('console sem erro', null, async () => { exigir(!erros.length, erros.join(' | ')); });
    await p.context().close();

    const cel = await navegador.newContext({ viewport: { width: 375, height: 812 }, locale: 'pt-BR', isMobile: true, hasTouch: true });
    p = await cel.newPage(); p.erros = [];
    await entrar(p, seed.usuarios.gestor);
    await passo('celular 375 autocompletar', null, async () => {
      await p.goto(`${SITE}/orgao.html`);
      await digitar(p, 'universidade federal do para');
      exigir((await sugestoes(p))[0] === 'UNIVERSIDADE FEDERAL DO PARA', 'ufpa no celular');
      exigir(await semRolagemLateral(p), 'rola de lado no celular');
      await p.screenshot({ path: path.join(PRINTS, '07-celular-375-autocompletar.png') });
    });
    await passo('escuro 375 autocompletar', null, async () => {
      await p.evaluate(() => localStorage.setItem('licitaplena_tema', 'escuro'));
      await p.goto(`${SITE}/orgao.html`);
      await digitar(p, 'comando da marinha');
      exigir(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'tema escuro');
      await p.screenshot({ path: path.join(PRINTS, '08-escuro-375-autocompletar.png') });
    });
    await cel.close();
  } finally {
    await navegador.close();
    limpar();
    fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 2));
    const falhas = resultados.filter((r) => !r.ok).length;
    console.log(falhas ? `${falhas} passo(s) falharam` : 'TUDO OK');
    process.exitCode = falhas ? 1 : 0;
  }
})();
