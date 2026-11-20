/* global document, window -- usados só dentro de p.evaluate/p.waitForFunction (rodam no navegador) */
// E2E local do mercado v3 (Siga Pregão, itens 3, 4 e 10 do mapa de 20/11/2026): baixa concorrência por nº de
// licitantes, histórico mais rico (classificação, fabricante/modelo, nº de lances, botão G, WhatsApp, "só 1 ou 2"),
// % do mercado com chave Tabela/Gráfico na Pesquisa de Preços e os filtros de busca modo de disputa / produto ou
// serviço / valor do item. Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8863 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8863 node ambiente-teste/e2e-mercado-v3.cjs
// Pesquisa de Preços: Compras.gov de verdade (dados abertos, sem login). Busca: PNCP simulado (page.route).
// Histórico de licitantes: linhas fictícias gravadas no banco LOCAL e apagadas no fim.
const path = require('node:path'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-mercado-v3';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const ID = '99000105900012026';
const limpar = () => psql(`delete from public.historico_compras where id_compra = '${ID}';`);
const semear = () => {
  limpar();
  const item = (n, situacao) => `('${ID}', ${n}, 'CANETA ESFEROGRAFICA E2EV3 item ${n}', 100, 'UN', 1.25, '${situacao}')`;
  const part = (n, chave, cl) => `('${ID}', ${n}, '${chave}', 'Fornecedor ficticio ${chave}', ${cl}, 1.10)`;
  psql(`insert into public.historico_compras (id_compra, uasg, orgao_nome, unidade_nome, ano, numero, modalidade, data_publicacao, link_origem)
    values ('${ID}', '990001', 'ORGAO FICTICIO E2E', 'UNIDADE FICTICIA E2E', 2026, '00001/2026', 'Pregão', '2026-03-01', 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${ID}');
    insert into public.historico_itens (id_compra, numero_item, descricao, quantidade, unidade, valor_estimado, situacao_item) values
      ${[item(1, 'Deserto'), item(2, 'Homologado'), item(3, 'Homologado'), item(4, 'Homologado'), item(5, 'Homologado')].join(',')};
    insert into public.historico_participacoes (id_compra, numero_item, fornecedor_chave, fornecedor_nome, classificacao, valor_proposta) values
      ${[part(2, 'a', 1), part(3, 'a', 1), part(3, 'b', 2), part(4, 'a', 1), part(4, 'b', 2), part(4, 'c', 3)].join(',')};
    insert into public.historico_participacoes (id_compra, numero_item, fornecedor_chave, fornecedor_nome, marca) values ('${ID}', 5, 'a', 'So vencedor', 'BIC');`);
};

// Licitação anterior com gravação da extensão (dado fictício): a mesma visão que a tela monta, desenhada pelo módulo.
const VISAO = {
  compras: [{ id_compra: ID, numero: '00001/2026', modalidade: 'Pregão', unidade_nome: 'UNIDADE FICTICIA E2E', plataforma: 'Compras.gov.br', data_publicacao: '2026-03-01',
    link_origem: `https://cnetmobile.estaleiro.serpro.gov.br/x?compra=${ID}` }],
  itens: [{ id_compra: ID, numero_item: 1, descricao: 'Caneta esferográfica azul', situacao_item: 'Homologado' }, { id_compra: ID, numero_item: 2, descricao: 'Lápis preto', situacao_item: 'Homologado' }],
  casamentos: [{ id_compra: ID, numero_item: 1, confianca: 'alta', regra: 'teste' }, { id_compra: ID, numero_item: 2, confianca: 'alta', regra: 'teste' }],
  participacoes: [
    { id_compra: ID, numero_item: 1, fornecedor_chave: '11111111000191', fornecedor_ni: '11111111000191', fornecedor_nome: 'VENCEDORA FICTICIA', ordem_classificacao: 1, classificacao: 1, valor_homologado: 1.1, valor_proposta: 1.3, marca: 'BIC' },
    { id_compra: ID, numero_item: 1, fornecedor_chave: '22222222000191', fornecedor_ni: '22222222000191', fornecedor_nome: 'RECUSADA FICTICIA', classificacao: 2, valor_proposta: 1.2 },
    { id_compra: ID, numero_item: 1, fornecedor_chave: '33333333000191', fornecedor_ni: '33333333000191', fornecedor_nome: 'INABILITADA FICTICIA', classificacao: 3, valor_proposta: 1.4 },
    { id_compra: ID, numero_item: 2, fornecedor_chave: '11111111000191', fornecedor_ni: '11111111000191', fornecedor_nome: 'VENCEDORA FICTICIA', ordem_classificacao: 1, classificacao: 1, valor_homologado: 0.5, valor_proposta: 0.6, marca: 'FABER' },
  ],
};
const GRAVADO = {
  pregoes: [{ id_compra: ID, fonte: 'comprasgov', leituras_concordantes: 1, gravado_em: '2026-11-19T10:00:00Z', itens: { 1: { propostas_lidas_em: '2026-11-19T10:00:00Z' } } }],
  propostas: [
    { id_compra: ID, numero_item: 1, fornecedor_chave: '11111111000191', situacao: 'Aceita e habilitada', marca: 'BIC', fabricante: 'Société BIC', modelo: 'Cristal 1.0', lances: [{ valor: 1.25 }, { valor: 1.1 }], leituras_concordantes: 1, gravado_em: '2026-11-19T10:00:00Z' },
    { id_compra: ID, numero_item: 1, fornecedor_chave: '22222222000191', situacao: 'Desclassificada', marca: 'GENERICA', lances: [{ valor: 1.2 }], leituras_concordantes: 1, gravado_em: '2026-11-19T10:00:00Z' },
    { id_compra: ID, numero_item: 1, fornecedor_chave: '33333333000191', situacao: 'Inabilitada', lances: [], leituras_concordantes: 1, gravado_em: '2026-11-19T10:00:00Z' },
  ],
  mensagens: [],
};

// Busca: 3 licitações simuladas; só a 1ª tem item de serviço (R$ 2.500); as outras, material de R$ 3.
const ED = (n, objeto) => ({ numero_controle_pncp: `04312239000141-1-0003${n}/2026`, description: objeto, title: objeto, uf: 'AM', municipio_nome: 'Manaus', orgao_nome: 'Prefeitura de Manaus',
  data_fim_vigencia: '2027-03-10T17:00:00', data_publicacao_pncp: '2026-11-10T10:00:00', modalidade_licitacao_nome: 'Pregão - Eletrônico' });
const EDITAIS = [ED(11, 'Serviço de manutenção de impressoras E2EV3'), ED(12, 'Toner para impressoras E2EV3'), ED(13, 'Papel para impressoras E2EV3')];

(async () => {
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  await p.setViewportSize({ width: 1280, height: 900 });
  try {
    await passo('baixa concorrência: abas Desertos / 1 / 2 / 3 licitantes e planilha (banco local)', p, async () => {
      semear();
      await p.goto(SITE + '/painel.html');
      await p.locator('nav button[data-alvo="diagnostico"]').dispatchEvent('click');
      await p.locator('#dg-subabas [data-subaba="baixa-concorrencia"]').click();
      await p.evaluate(async () => { await window.__clientePronto; await window.BaixaConcorrencia.montar({ alvo: document.getElementById('dg-bc-licitantes'), cliente: window.__sbClient, palavras: ['caneta esferografica e2ev3'] }).pronto; });
      await p.waitForSelector('#dg-bc-licitantes [data-bc-aba]', { timeout: 15000 });
      const abas = (await p.locator('#dg-bc-licitantes [data-bc-aba]').allInnerTexts()).map((t) => t.trim());
      exigir(JSON.stringify(abas) === JSON.stringify(['Desertos ou fracassados (1)', '1 licitante (1)', '2 licitantes (1)', '3 licitantes (1)']), `abas: ${abas.join(' | ')}`);
      const status = await p.locator('#dg-bc-licitantes [role="status"]').innerText();
      exigir(/1 sem a lista de propostas ficaram de fora/.test(status), `status: ${status}`);
      await p.locator('#dg-bc-licitantes [data-bc-aba="2"]').click();
      const linha = await p.locator('#dg-bc-licitantes tbody tr').first().innerText();
      exigir(/item 3/.test(linha) && /\b2\b/.test(linha), `linha da aba 2: ${linha}`);
      const [download] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#dg-bc-licitantes [data-bc-planilha]')]);
      exigir(/\.xlsx$/.test(download.suggestedFilename()), download.suggestedFilename());
      await p.locator('#dg-bc-licitantes').screenshot({ path: path.join(PRINTS, 'baixa-concorrencia-licitantes-1280.png') });
      return `${abas.join(' · ')}; planilha ${download.suggestedFilename()}`;
    });

    await passo('histórico: classificação, fabricante e modelo, nº de lances, botão G, WhatsApp e "só 1 ou 2 licitantes"', p, async () => {
      await p.locator('#dg-subabas [data-subaba="licitacao-anterior"]').click();
      await p.evaluate(({ visao, gravado }) => {
        const U = window.LicitaLicitacaoAnterior, alvo = document.createElement('div');
        alvo.id = 'e2e-historico'; document.getElementById('dg-licitacao-anterior').append(alvo);
        U.desenhar(alvo, U.montarVisao(visao), { extras: { gravado: U.indexarGravado(gravado) } });
      }, { visao: VISAO, gravado: GRAVADO });
      const h = p.locator('#e2e-historico');
      await h.locator('.la-participantes').first().evaluate((d) => { d.open = true; });
      const texto = await h.innerText();
      for (const esperado of ['Fabricante: Société BIC', 'Modelo: Cristal 1.0', '2 lance(s)', 'Vencedora', 'Desclassificada', 'Inabilitada']) exigir(texto.includes(esperado), `faltou "${esperado}"`);
      const g = await h.locator('a.la-google').first().getAttribute('href');
      exigir(g.startsWith('https://www.google.com/search?q=BIC%20'), `link G: ${g}`);
      const zap = await h.locator('a.la-zap').first().getAttribute('href');
      exigir(zap.startsWith('https://wa.me/?text=') && !/VENCEDORA|RECUSADA|11111111000191/.test(decodeURIComponent(zap)), `WhatsApp: ${zap}`);
      await h.screenshot({ path: path.join(PRINTS, 'historico-rico-1280.png') });
      await h.locator('.la-filtros select').selectOption('inabilitada');
      const itensInab = await h.locator('.la-item').count();
      exigir(itensInab === 1 && (await h.locator('.la-participantes li').count()) === 1, `filtro inabilitada: ${itensInab} item(ns)`);
      await h.locator('.la-filtros select').selectOption('');
      await h.locator('.la-filtros input[type="checkbox"]').check();
      const poucos = await h.locator('.la-item').count();
      exigir(poucos === 1 && /Item 2/.test(await h.locator('.la-item').first().innerText()), `só 1 ou 2 licitantes: ${poucos} item(ns)`);
      await h.screenshot({ path: path.join(PRINTS, 'historico-filtro-1-ou-2-1280.png') });
      return `filtro inabilitada -> ${itensInab} item; só 1 ou 2 -> ${poucos} item (o de 3 licitantes saiu)`;
    });

    await passo('busca: produto ou serviço e valor do item leem os itens no PNCP (até 40, com cache); modo de disputa não quebra', p, async () => {
      let chamadas = 0;
      await p.route('**/api/pncp-proxy**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: EDITAIS, total: EDITAIS.length }) }));
      await p.route('**/api/pncp-itens**', (r) => {
        chamadas += 1;
        const servico = new URL(r.request().url()).searchParams.get('sequencial') === '311';
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ erro: null, itens: [{ numero: 1, materialOuServico: servico ? 'Serviço' : 'Material', valorUnitarioEstimado: servico ? 2500 : 3 }] }) });
      });
      await p.locator('nav button[data-alvo="oportunidades"]').dispatchEvent('click');
      await p.waitForTimeout(400);
      await p.locator('#op-tipo-item').evaluate((s) => s.closest('details')?.setAttribute('open', ''));
      const buscar = async () => { await p.click('#op-buscar'); await p.waitForSelector('#op-resultado .boletim-card, #op-resultado .aviso', { timeout: 20000 }); await p.waitForTimeout(800); return p.locator('#op-resultado .boletim-card').count(); };
      await p.fill('#op-palavras', 'impressoras e2ev3');
      const todas = await buscar();
      await p.selectOption('#op-tipo-item', 'servico');
      const servicos = await buscar();
      const nota = await p.locator('#op-itens-nota').innerText();
      exigir(todas >= 3 && servicos === 1, `sem filtro ${todas}, só serviço ${servicos}`);
      exigir(/conferimos os itens/.test(nota), `nota: ${nota}`);
      await p.selectOption('#op-tipo-item', '');
      await p.fill('#op-item-min', '1000');
      const caros = await buscar();
      exigir(caros === 1, `valor do item >= R$ 1.000: ${caros}`);
      const antesCache = chamadas;
      await buscar();
      exigir(chamadas === antesCache, `cache: ${chamadas - antesCache} chamada(s) a mais na mesma busca`);
      await p.fill('#op-item-min', '');
      await p.selectOption('#op-modo-disputa', 'aberto');
      const abertas = await buscar();
      await p.locator('#oportunidades').screenshot({ path: path.join(PRINTS, 'busca-filtros-item-1280.png') });
      await p.selectOption('#op-modo-disputa', '');
      return `sem filtro ${todas}; serviço ${servicos}; item >= R$ 1.000 ${caros}; modo aberto ${abertas} (busca ao vivo não traz o modo); ${chamadas} chamada(s) a /api/pncp-itens`;
    });

    await passo('Pesquisa de Preços: % do mercado e chave Tabela/Gráfico (Compras.gov de verdade)', p, async () => {
      await p.locator('nav button[data-alvo="precos"]').dispatchEvent('click');
      await p.waitForSelector('#pp-mercado input[type="search"]', { state: 'visible' });
      await p.fill('#pp-mercado input[type="search"]', 'notebook');
      await p.click('#pp-mercado button[type="submit"]');
      await p.waitForFunction(() => /compra\(s\) encontradas|não respondeu|Nenhuma compra/.test(document.querySelector('#pp-mercado [role="status"]')?.textContent || ''), null, { timeout: 150000 });
      const fatia = await p.locator('#pp-mercado td[data-rotulo="% do mercado"]').first().innerText();
      exigir(/\d+(,\d)?% das compras · (\d+(,\d)?|—)% do valor|—/.test(fatia), `célula %: ${fatia}`);
      await p.locator('#pp-mercado [data-mercado-grafico]').click();
      const barras = await p.locator('#pp-mercado .mercado-barra').count();
      exigir(barras >= 3, `barras: ${barras}`);
      await p.locator('#pp-mercado .mercado-marcas-caixa').screenshot({ path: path.join(PRINTS, 'mercado-grafico-1280.png') });
      await p.setViewportSize({ width: 375, height: 812 });
      await p.waitForTimeout(500);
      const { largura, janela } = await p.evaluate(() => ({ largura: document.documentElement.scrollWidth, janela: window.innerWidth }));
      exigir(largura <= janela, `rolagem horizontal: ${largura} > ${janela}`);
      await p.locator('#pp-mercado .mercado-marcas-caixa').screenshot({ path: path.join(PRINTS, 'mercado-grafico-375.png') });
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.locator('#pp-mercado [data-mercado-grafico]').click();
      exigir(await p.locator('#pp-mercado td[data-rotulo="% do mercado"]').count() > 0, 'voltar para tabela');
      await p.locator('#pp-mercado .mercado-marcas-caixa').screenshot({ path: path.join(PRINTS, 'mercado-tabela-share-1280.png') });
      return `1ª marca: ${fatia}; ${barras} barras; 375 px sem rolagem (${largura}/${janela})`;
    });

    await passo('erros de página', null, async () => {
      const graves = p.erros.filter((e) => !/favicon|404 GET \/api\/(chat|notificacoes)/.test(e));
      exigir(!graves.some((e) => /pageerror/.test(e)), graves.join(' | '));
      return graves.slice(0, 5).join(' | ') || 'nenhum';
    });
  } finally {
    try { limpar(); } catch (e) { console.log('limpeza:', e.message); }
    await nav.close();
    const falhas = resultados.filter((r) => !r.ok).length;
    console.log(`\n${resultados.length - falhas}/${resultados.length} passos ok. Prints em ${path.resolve(PRINTS)}`);
    process.exitCode = falhas ? 1 : 0;
  }
})();
