/* global document, localStorage, window */
// E2E da troca de empresa ativa (25/11, bug do dono: no Boletim, trocar HCM -> Raimon não trazia a Raimon; ficava preso).
// Conta com 2 empresas (gestor do seed: A = Materiais Horizonte, B = Papelaria Aurora). A -> B -> A em Boletim (filtro,
// edições, cartões, contador de lidos, edição aberta pelo link do e-mail), Encontrar licitações (filtros salvos), Funil,
// Dashboard (previsão) e, na casca, Processos aberto antes da troca. Nenhum dado de uma empresa pode aparecer na outra.
//   PORTA_TESTE=8811 node ambiente-teste/servidor.cjs   (serve publico/: npm run build:cloudflare antes)
//   SITE_TESTE=http://127.0.0.1:8811 node ambiente-teste/e2e-troca-empresa.cjs
// Banco LOCAL. Cria os próprios editais, edições, filtros e processos fictícios e apaga no fim.
const path = require('node:path'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-troca-empresa';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const q = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const u = seed.usuarios.gestor, ORG = seed.ids.orgA;
const A = { id: seed.ids.empA2, nome: 'Materiais Horizonte', palavra: 'limpeza', marca: 'TROCA-A limpeza marcador', num: '99999999000199-1-000961/2026', filtroSalvo: 'Troca e2e A' };
const B = { id: seed.ids.empA1, nome: 'Papelaria Aurora', palavra: 'sulfite', marca: 'TROCA-B papel sulfite marcador', num: '99999999000199-1-000962/2026', filtroSalvo: 'Troca e2e B' };
const dia = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
// Filtro de B criado só depois do passo do estado vazio; o de A (seed) é regravado igual, para o teste não depender de outro.
let filtroBAntes = null, jornalB = null;

function limpar() {
  psql(`delete from oportunidades_abertas where chave in (${q(A.num)}, ${q(B.num)});
    delete from boletim_edicoes where cliente_id=${q(u.id)} and filtro_nome like 'troca-e2e%';
    delete from filtros_salvos where cliente_id=${q(u.id)} and nome in (${q(A.filtroSalvo)}, ${q(B.filtroSalvo)}, 'Jornal troca e2e');
    delete from operacao_processos where organizacao_id=${q(ORG)} and origem_externa_id in (${q(A.num)}, ${q(B.num)});`);
}
function criar() {
  limpar();
  filtroBAntes = psql(`select filtro::text from boletim_filtros_empresa where empresa_id=${q(B.id)}`) || null;
  psql(`delete from boletim_filtros_empresa where empresa_id=${q(B.id)};
    insert into boletim_filtros_empresa (empresa_id, organizacao_id, cliente_id, filtro) values (${q(A.id)}, ${q(ORG)}, ${q(u.id)}, '{"uf":"AM","ufs":["AM"],"palavrasRaw":"limpeza"}')
      on conflict (empresa_id) do update set filtro = excluded.filtro;`);
  psql([A, B].map((e) => {
    const dado = JSON.stringify({ numeroControlePNCP: e.num, objeto: `Aquisição ${e.marca}`, orgao: 'Órgão Fictício da Troca', uf: 'AM', municipio: 'Manaus', publicacao: dia(0), encerramento: dia(-20), modalidade: 'Pregão Eletrônico', valorEstimado: 5000 });
    return `insert into oportunidades_abertas (chave, numero_controle_pncp, objeto, uf, publicacao, encerramento, dado) values (${q(e.num)}, ${q(e.num)}, ${q('Aquisição ' + e.marca)}, 'AM', ${q(dia(0))}, ${q(dia(-20))}, ${q(dado)}::jsonb);
      insert into boletim_edicoes (cliente_id, edicao, filtro_id, filtro_nome, empresa, quantidade, numeros) values (${q(u.id)}, ${q(dia(0))}, ${q('empresa:' + e.id)}, ${q('troca-e2e ' + e.palavra)}, ${q(e.nome)}, 1, array[${q(e.num)}]) on conflict (cliente_id, edicao, filtro_id) do update set filtro_nome = excluded.filtro_nome, empresa = excluded.empresa, quantidade = 1, numeros = excluded.numeros;
      insert into filtros_salvos (cliente_id, empresa_id, nome, filtro) values (${q(u.id)}, ${q(e.id)}, ${q(e.filtroSalvo)}, ${q(JSON.stringify({ palavrasRaw: e.palavra }))}::jsonb);
      insert into operacao_processos (organizacao_id, empresa_id, origem_externa_id, objeto, orgao, modalidade, sistema, status, decisao, valor_estimado)
        values (${q(ORG)}, ${q(e.id)}, ${q(e.num)}, ${q('Funil ' + e.marca)}, 'Órgão Fictício da Troca', 'Pregão - Eletrônico', 'Compras.gov.br', 'triagem', 'em_analise', 5000);`;
  }).join('\n'));
  // Jornal de B (filtro salvo com jornal) com edição de hoje: o link do e-mail dele deve abrir em B mesmo com A ativa.
  jornalB = psql(`insert into filtros_salvos (cliente_id, empresa_id, nome, filtro) values (${q(u.id)}, ${q(B.id)}, 'Jornal troca e2e', '{"palavrasRaw":"sulfite","jornal":true}'::jsonb) returning id`).split('\n')[0];
  psql(`insert into boletim_edicoes (cliente_id, edicao, filtro_id, filtro_nome, empresa, quantidade, numeros) values (${q(u.id)}, ${q(dia(0))}, ${q('jornal:' + jornalB)}, 'troca-e2e jornal', ${q(B.nome)}, 1, array[${q(B.num)}]);`);
}
function restaurar() {
  limpar();
  psql(`delete from boletim_filtros_empresa where empresa_id=${q(B.id)};` + (filtroBAntes
    ? `insert into boletim_filtros_empresa (empresa_id, organizacao_id, cliente_id, filtro) values (${q(B.id)}, ${q(ORG)}, ${q(u.id)}, ${q(filtroBAntes)}::jsonb);` : ''));
}

// Foto do Boletim: o que a pessoa vê.
const boletim = (p) => p.evaluate(() => ({
  empresa: document.getElementById('bol-empresa').selectedOptions[0]?.text || '',
  selo: document.getElementById('bol-selo-filtros').innerText,
  meta: document.getElementById('bol-meta').innerText,
  lista: document.getElementById('bol-resultado').innerText,
  cartoes: document.querySelectorAll('#bol-resultado .boletim-card').length,
  edicoes: document.getElementById('bol-edicoes').hidden ? '' : document.getElementById('bol-edicoes').innerText,
  calendario: [...document.querySelectorAll('.bol-cal-edicao')].map((b) => b.title).join(' | '),
  naoLidos: document.getElementById('bol-marcar-lidos-n').innerText,
  palavras: document.getElementById('bol-palavras').value,
}));
async function trocarNoBoletim(p, e) {
  await p.selectOption('#bol-empresa', e.id);
  await p.waitForFunction((n) => window.__filtroBoletimEmpresaNome?.includes(n) && !/Carregando/.test(document.getElementById('bol-resultado').innerText)
    && /de 2 filtros/.test(document.getElementById('bol-selo-filtros').innerText), e.nome, { timeout: 30000 });
}
const esperarCartao = (p, e) => p.waitForFunction((m) => document.getElementById('bol-resultado').innerText.includes(m), e.marca, { timeout: 30000 });
function semOutra(foto, outra, onde) {
  const texto = Object.values(foto).join(' ');
  exigir(!texto.includes(outra.marca) && !texto.includes(outra.nome) && !texto.includes('troca-e2e ' + outra.palavra), `${onde}: dado de ${outra.nome} na tela: ${texto.slice(0, 400)}`);
}
async function print(p, nome) { await p.screenshot({ path: path.join(PRINTS, nome), fullPage: true }); }

(async () => {
  require('node:fs').mkdirSync(PRINTS, { recursive: true });
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  try {
    criar();
    const p = await novaPagina(nav, u);
    await p.goto(SITE + '/painel.html#boletim');
    await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), A.id);
    await p.reload();

    await passo('Boletim abre na empresa A com o filtro, a edição e os cartões dela', p, async () => {
      await esperarCartao(p, A);
      await p.waitForFunction(() => !document.getElementById('bol-edicoes').hidden && /de 2 filtros/.test(document.getElementById('bol-selo-filtros').innerText), null, { timeout: 20000 });
      const f = await boletim(p);
      exigir(f.empresa.includes(A.nome) && /de 2 filtros/.test(f.selo), `empresa/selo: ${f.empresa} / ${f.selo}`);
      exigir(f.edicoes.includes('troca-e2e limpeza'), 'edição de A ausente: ' + f.edicoes);
      exigir(Number(f.naoLidos) === f.cartoes && f.cartoes > 0, `contador ${f.naoLidos} x ${f.cartoes} cartões`);
      semOutra(f, B, 'A');
      return `${f.cartoes} cartões · ${f.selo}`;
    });
    await print(p, '01-boletim-empresa-a.png');

    await passo('B sem filtro: estado vazio com "Configurar filtro desta empresa", nada de A', p, async () => {
      await trocarNoBoletim(p, B);
      await p.waitForSelector('#bol-configurar-empresa', { timeout: 20000 });
      const f = await boletim(p);
      exigir(f.cartoes === 0 && f.palavras === '' && /2 de 2 filtros/.test(f.selo), JSON.stringify(f).slice(0, 300));
      semOutra(f, A, 'B vazio');
      await p.click('#bol-configurar-empresa');
      exigir(await p.evaluate(() => document.activeElement.id) === 'bol-palavras', 'botão não levou ao campo de palavras');
      return f.lista.slice(0, 120);
    });
    await print(p, '02-boletim-empresa-b-sem-filtro.png');

    await passo('salvar o filtro de B monta o boletim de B (sem tocar no de A)', p, async () => {
      await p.fill('#bol-palavras', B.palavra);
      await p.click('#bol-salvar');
      await esperarCartao(p, B);
      const f = await boletim(p);
      semOutra(f, A, 'B');
      const filtroA = psql(`select filtro->>'palavrasRaw' from boletim_filtros_empresa where empresa_id=${q(A.id)}`);
      exigir(filtroA === 'limpeza', 'filtro de A mudou: ' + filtroA);
      exigir(f.edicoes.includes('troca-e2e sulfite') && !f.edicoes.includes('troca-e2e limpeza'), 'edições: ' + f.edicoes);
      return `${f.cartoes} cartões · ${f.meta.slice(0, 80)}`;
    });
    await print(p, '03-boletim-empresa-b.png');

    await passo('marcar como lido em B não marca nada em A; voltar para A traz A inteira', p, async () => {
      await p.click('#bol-marcar-lidos');
      await p.waitForFunction(() => document.getElementById('bol-marcar-lidos-n').innerText === '0', null, { timeout: 10000 });
      await trocarNoBoletim(p, A);
      await esperarCartao(p, A);
      const f = await boletim(p);
      exigir(Number(f.naoLidos) === f.cartoes && f.cartoes > 0, `A ficou com lidos de B: ${f.naoLidos} de ${f.cartoes}`);
      exigir(f.palavras === 'limpeza', 'campo de palavras: ' + f.palavras);
      semOutra(f, B, 'A de volta');
      return `${f.naoLidos} não lidos em A`;
    });
    await print(p, '04-boletim-volta-a.png');

    await passo('link do e-mail da edição de A, trocar para B: sai da edição e mostra B (antes ficava preso)', p, async () => {
      await p.goto(`${SITE}/painel.html?edicao=${dia(0)}&filtro=empresa:${A.id}#boletim`);
      await p.waitForFunction(() => /Edição de/.test(document.getElementById('bol-meta').innerText), null, { timeout: 30000 });
      await esperarCartao(p, A);
      await trocarNoBoletim(p, B);
      await esperarCartao(p, B);
      const f = await boletim(p);
      exigir(!/Edição de/.test(f.meta), 'continuou na edição: ' + f.meta);
      exigir(!new URL(p.url()).searchParams.has('edicao'), 'endereço manteve a edição: ' + p.url());
      semOutra(f, A, 'B depois da edição');
      return f.meta.slice(0, 90);
    });
    await print(p, '05-edicao-a-trocada-para-b.png');

    await passo('link do e-mail de B abre o Boletim já na empresa B', p, async () => {
      await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), A.id);
      await p.goto(`${SITE}/painel.html?edicao=${dia(0)}&filtro=empresa:${B.id}#boletim`);
      await p.waitForFunction(() => /Edição de/.test(document.getElementById('bol-meta').innerText), null, { timeout: 30000 });
      await esperarCartao(p, B);
      await p.waitForFunction((id) => document.getElementById('bol-empresa').value === id, B.id, { timeout: 20000 });
      return (await boletim(p)).meta;
    });

    await passo('link do e-mail do jornal de B com A ativa: troca para B e abre a edição do jornal', p, async () => {
      await p.goto(SITE + '/painel.html#boletim');
      await trocarNoBoletim(p, A);
      await p.goto(`${SITE}/painel.html?edicao=${dia(0)}&filtro=jornal:${jornalB}#boletim`);
      await p.waitForFunction(() => /Edição de .*troca-e2e jornal/.test(document.getElementById('bol-meta').innerText), null, { timeout: 30000 });
      await esperarCartao(p, B);
      await p.waitForFunction((id) => document.getElementById('bol-empresa').value === id, B.id, { timeout: 20000 });
      const f = await boletim(p);
      exigir(!/Não encontramos/.test(await p.innerText('#bol-filtro-status')), 'disse que não achou a edição');
      semOutra(f, A, 'jornal de B');
      return f.meta;
    });
    await print(p, '06b-link-jornal-b.png');

    await passo('Encontrar licitações: filtros salvos só da empresa ativa (B, depois A)', p, async () => {
      await p.goto(SITE + '/painel.html#oportunidades');
      const opcoes = () => p.evaluate(() => [...document.querySelectorAll('#op-salvos-lista option')].map((o) => o.textContent).join(' | '));
      await p.waitForFunction((n) => [...document.querySelectorAll('#op-salvos-lista option')].some((o) => o.textContent.includes(n)), B.filtroSalvo, { timeout: 30000 });
      const emB = await opcoes();
      exigir(!emB.includes(A.filtroSalvo), 'B vê filtro de A: ' + emB);
      await p.goto(SITE + '/painel.html#boletim');
      await trocarNoBoletim(p, A);
      await p.goto(SITE + '/painel.html#oportunidades');
      await p.waitForFunction((n) => [...document.querySelectorAll('#op-salvos-lista option')].some((o) => o.textContent.includes(n)), A.filtroSalvo, { timeout: 30000 });
      const emA = await opcoes();
      exigir(!emA.includes(B.filtroSalvo), 'A vê filtro de B: ' + emA);
      return `B: ${emB} // A: ${emA}`;
    });
    await print(p, '06-encontrar-filtros-a.png');

    await passo('Funil: cartões só da empresa escolhida, A -> B -> A no seletor do Funil', p, async () => {
      await p.goto(SITE + '/painel.html#kanban');
      const cartoes = () => p.evaluate(() => document.getElementById('kanban-quadro').innerText);
      const esperar = (m) => p.waitForFunction((t) => document.getElementById('kanban-quadro').innerText.includes(t), m, { timeout: 30000 });
      await esperar(A.marca);
      exigir(!(await cartoes()).includes(B.marca), 'Funil de A com cartão de B');
      await p.selectOption('#kanban-empresa', B.id);
      await esperar(B.marca);
      exigir(!(await cartoes()).includes(A.marca), 'Funil de B com cartão de A');
      await print(p, '07-funil-empresa-b.png');
      await p.selectOption('#kanban-empresa', A.id);
      await esperar(A.marca);
      exigir(!(await cartoes()).includes(B.marca), 'Funil de volta em A com cartão de B');
      return 'ok';
    });

    await passo('Dashboard: previsão e Boletim seguem a empresa trocada no Funil', p, async () => {
      await p.selectOption('#kanban-empresa', B.id);
      await p.waitForFunction(() => window.__filtroBoletimEmpresaNome?.includes('Papelaria'), null, { timeout: 30000 });
      await p.goto(SITE + '/painel.html#dashboard');
      await p.waitForFunction((id) => document.querySelector('#dash-crm [data-crm-empresa]')?.value === id, B.id, { timeout: 30000 });
      await p.evaluate(() => { document.querySelector('nav button[data-alvo="kanban"]').click(); });
      await p.selectOption('#kanban-empresa', A.id);
      await p.evaluate(() => { document.querySelector('nav button[data-alvo="dashboard"]').click(); window.__atualizarDashboard?.(); });
      await p.waitForFunction((id) => document.querySelector('#dash-crm [data-crm-empresa]')?.value === id, A.id, { timeout: 30000 });
      return 'previsão B -> A';
    });
    await print(p, '08-dashboard-empresa-a.png');

    await passo('casca: Processos aberto em A; trocar para B no Boletim; Processos avisa e "Atualizar" traz B', p, async () => {
      await p.goto(SITE + '/app#/processos');
      const ativo = async () => (await p.waitForSelector('.casca-tela.ativa', { state: 'attached', timeout: 30000 })).contentFrame();
      let f = await ativo();
      await f.waitForFunction((id) => document.getElementById('empresa-atual')?.value === id, A.id, { timeout: 30000 });
      await p.locator('#casca-menu a[data-rota="painel#boletim"]').first().click();
      await p.waitForFunction(() => /\/painel/.test(document.querySelector('.casca-tela.ativa')?.contentWindow.location.pathname || ''), null, { timeout: 30000 });
      f = await ativo();
      await f.waitForSelector('#bol-empresa:not([disabled])', { timeout: 30000 });
      await f.selectOption('#bol-empresa', B.id);
      await f.waitForFunction((m) => document.getElementById('bol-resultado').innerText.includes(m), B.marca, { timeout: 30000 });
      await print(p, '09-casca-boletim-b.png');
      await p.locator('#casca-menu a[data-rota="processos"]').first().click();
      await p.waitForFunction(() => /\/processos/.test(document.querySelector('.casca-tela.ativa')?.contentWindow.location.pathname || ''), null, { timeout: 30000 });
      // Processos não garante "sem alteração" (__lpTemAlteracoes): a casca avisa em vez de recarregar sozinha.
      await p.waitForSelector('#casca-aviso:not([hidden])', { timeout: 5000 });
      exigir(/empresa ativa/.test(await p.innerText('#casca-aviso-texto')), 'aviso: ' + await p.innerText('#casca-aviso-texto'));
      await print(p, '10a-casca-processos-aviso.png');
      await p.click('#casca-aviso-atualizar');
      f = await ativo();
      await f.waitForFunction((id) => document.getElementById('empresa-atual')?.value === id, B.id, { timeout: 30000 });
      await f.waitForFunction((m) => document.body.innerText.includes(m), 'Funil ' + B.marca, { timeout: 30000 }).catch(() => {});
      const texto = await f.evaluate(() => document.body.innerText);
      exigir(!texto.includes(A.marca), 'Processos de B mostra processo de A');
      await print(p, '10-casca-processos-b.png');
      // E de volta para A pelo seletor de Processos: o Boletim vivo avisa e o Atualizar abre já em A.
      await f.selectOption('#empresa-atual', A.id);
      await p.locator('#casca-menu a[data-rota="painel#boletim"]').first().click();
      await p.waitForFunction(() => /\/painel/.test(document.querySelector('.casca-tela.ativa')?.contentWindow.location.pathname || ''), null, { timeout: 30000 });
      await p.waitForSelector('#casca-aviso:not([hidden])', { timeout: 5000 });
      await p.click('#casca-aviso-atualizar');
      f = await ativo();
      // A lista de A é paginada (o cartão marcado pode estar na 2ª página): confere empresa e filtro do Boletim vivo.
      await f.waitForFunction((id) => document.getElementById('bol-empresa')?.value === id && /limpeza/.test(document.getElementById('bol-meta').innerText), A.id, { timeout: 30000 });
      const fb = await f.evaluate(() => document.getElementById('bol-resultado').innerText);
      exigir(!fb.includes(B.marca), 'Boletim vivo voltou com B');
      await print(p, '11-casca-boletim-volta-a.png');
      return 'Processos e Boletim avisam e o Atualizar traz a empresa ativa';
    });

    await passo('sem erro de JavaScript', null, async () => {
      const erros = p.erros.filter((e) => e.startsWith('pageerror') || e.startsWith('console'));
      exigir(!erros.length, erros.join(' | '));
    });
  } finally {
    try { restaurar(); } catch (e) { console.log('limpeza falhou: ' + e.message); }
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  require('node:fs').writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 2));
  console.log(falhas.length ? `${falhas.length} falha(s)` : 'tudo certo');
  process.exit(falhas.length ? 1 : 0);
})();
