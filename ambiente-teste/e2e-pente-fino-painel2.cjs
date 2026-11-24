/* global document -- usados só dentro de p.evaluate (rodam no navegador) */
// Pente fino (20/11/2026) das telas do painel: Inteligência de Mercado (7 abas, mapa, Tabela/Gráfico, G, Trazer mais,
// Baixa concorrência, Licitação anterior, fornecedor com IA), Analisar concorrente, Convênios e Emendas Federais
// (com o Raio-X Financeiro), Pesquisa de Preços e o chat com IA. Cliente aprovado do seed, 1280 e 375 px, console limpo,
// sem jargão de robô, sem rolagem lateral, e uma conta conferida à mão por tela.
//   PORTA_TESTE=8812 node ambiente-teste/servidor.cjs      (antes: subir.cjs e npm run build:cloudflare)
//   PORTA_TESTE=8812 PRINTS=<pasta> node ambiente-teste/e2e-pente-fino-painel2.cjs
// Dados do governo vêm ao vivo (Compras.gov, PNCP): demoram; cada espera é longa. Só o banco local é tocado.
const path = require('node:path');
const fs = require('node:fs');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/pente-fino/prints-painel2';
const { passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

// Códigos sem /i: "nan" aparece dentro de nomes comuns (FERNANDO, financiado).
const JARGAO_TEXTO = /arquivo semanal|robô|fail-open|Netlify|base guardada|\{'tipo'|\bapp\b/i;
const JARGAO_CODIGO = /\bJSON\b|\bRPC\b|TRANSPARENCIA_TOKEN|\bundefined\b|\bNaN\b|\[object/;
const JARGAO = { test: (t) => JARGAO_TEXTO.test(t) || JARGAO_CODIGO.test(t) };
const jargaoEm = (t) => t.match(JARGAO_TEXTO) || t.match(JARGAO_CODIGO);
const TELAS = { diagnostico: 'Inteligência de Mercado', empresa: 'Analisar concorrente', transparencia: 'Convênios e Emendas Federais', precos: 'Pesquisa de Preços' };
// Convênios FICTÍCIOS só no banco local (chave "convenios" de dados_robo), apagados no fim.
async function servico(metodo, caminho, corpo) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' } });
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${(await r.text()).slice(0, 300)}`);
}
const CONVENIOS = { atualizadoEm: new Date().toISOString(), dataInicial: '01/01/2026', dataFinal: '19/11/2026', registros: [
  { id: 1, convenente: 'MUNICIPIO FICTICIO E2E A', objeto: 'Pavimentação de vias FICTÍCIA', orgao: 'MINISTÉRIO FICTÍCIO', uf: 'AMAZONAS', municipio: 'MANAUS', valor: 200000, valorLiberado: 150000.5, dataPublicacao: '2026-11-10' },
  { id: 2, convenente: 'MUNICIPIO FICTICIO E2E B', objeto: 'Saneamento FICTÍCIO', orgao: 'MINISTÉRIO FICTÍCIO', uf: 'SP', municipio: 'CAMPINAS', valor: 90000, valorLiberado: 30000.25, dataPublicacao: '2026-10-01' },
] };
const reais = (t) => Number(String(t).replace(/[^\d,-]/g, '').replace(',', '.')) || 0;

async function abrir(p, alvo) {
  await p.locator(`nav button[data-alvo="${alvo}"]`).dispatchEvent('click');
  await p.waitForSelector(`section#${alvo}.ativa`, { timeout: 15000 });
}
async function semJargao(p, seletor) {
  const texto = await p.locator(seletor).innerText();
  const achou = jargaoEm(texto);
  exigir(!achou, `jargão "${achou && achou[0]}" em ${seletor}: "${achou && texto.slice(Math.max(0, achou.index - 60), achou.index + 60)}"`);
  return texto;
}
async function semRolagemLateral(p) {
  const larg = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  exigir(larg <= 1, `rolagem lateral de ${larg}px`);
}
async function imprimir(p, alvo, nome) {
  await p.addStyleTag({ content: 'header { position: static !important; }' });
  for (const largura of [1280, 375]) {
    await p.setViewportSize({ width: largura, height: 900 });
    await p.waitForTimeout(400);
    if (largura === 375) await semRolagemLateral(p);
    await p.locator(`section#${alvo}`).screenshot({ path: path.join(PRINTS, `${nome}-${largura}.png`) });
  }
  await p.setViewportSize({ width: 1366, height: 900 });
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await novaPagina(navegador, seed.usuarios[process.env.USUARIO_E2E || 'gestor']);
  try {
    await p.goto(SITE + '/painel.html');

    await passo('as 4 telas abrem com o título certo, sem jargão e sem rolagem lateral no celular', null, async () => {
      for (const [alvo, titulo] of Object.entries(TELAS)) {
        await abrir(p, alvo);
        exigir((await p.locator(`section#${alvo} h2`).first().innerText()).includes(titulo), `título de ${alvo}`);
        await semJargao(p, `section#${alvo}`);
        await p.setViewportSize({ width: 375, height: 800 }); await p.waitForTimeout(300); await semRolagemLateral(p);
        await p.setViewportSize({ width: 1366, height: 900 });
      }
      return Object.values(TELAS).join(' · ');
    });

    await passo('Inteligência de Mercado: papel A4 ao vivo, 7 abas com contagem, conta do valor total conferida', null, async () => {
      await abrir(p, 'diagnostico');
      await p.locator('#dg-subabas [data-subaba="pesquisa"]').click();
      await p.fill('#mk-termo', 'papel A4');
      await p.selectOption('#mk-uf', '');
      await p.click('#mk-buscar');
      await p.waitForSelector('#mk-angulos [data-mk-aba]', { timeout: 90000 });
      const abas = await p.locator('#mk-angulos [data-mk-aba]').allInnerTexts();
      exigir(abas.length === 7, `abas: ${abas}`);
      const n = (rotulo) => Number((abas.find((a) => a.startsWith(rotulo)) || '').replace(/\D/g, ''));
      const compras = Number((await p.locator('.mk-cartoes .cartao').nth(1).locator('.valor').innerText()).replace(/\D/g, ''));
      exigir(compras === n('Correspondências'), `cartão ${compras} x aba ${n('Correspondências')}`);
      // Conta à mão: soma da coluna "Valor total" das Correspondências = cartão "Valor total comprado" (quando cabe na tela).
      let conta = 'mais de 300 linhas: soma não conferida';
      if (compras <= 300) {
        const soma = (await p.locator('#mk-aba-conteudo tbody tr td:nth-child(8)').allInnerTexts()).reduce((s, t) => s + reais(t), 0);
        const cartao = reais(await p.locator('.mk-cartoes .cartao').first().locator('.valor').getAttribute('title'));
        exigir(Math.abs(soma - cartao) < 0.05, `soma ${soma} x cartão ${cartao}`);
        conta = `soma das ${compras} linhas = R$ ${soma.toFixed(2)} = cartão`;
      }
      await semJargao(p, '#mk-resultado');
      return `${abas.join(' | ')} · ${conta}`;
    });

    await passo('cada aba abre; Tabela/Gráfico troca; mapa nos Estados; botão G aponta ao Google; prints 1280/375', null, async () => {
      const notas = [];
      for (const id of ['correspondencias', 'catalogo', 'estados', 'orgaos', 'empresas', 'marcas', 'futura']) {
        await p.click(`#mk-angulos [data-mk-aba="${id}"]`);
        await p.waitForFunction((a) => document.getElementById('mk-aba-conteudo').dataset.aba === a, id);
        if (id === 'futura') await p.waitForFunction(() => !document.querySelector('#mk-aba-conteudo .carregando'), null, { timeout: 60000 });
        if (await p.locator('#mk-aba-conteudo [data-mk-modo="grafico"]').count()) {
          await p.click('#mk-aba-conteudo [data-mk-modo="grafico"]');
          exigir(await p.locator('#mk-aba-conteudo .mk-hbarras, #mk-aba-conteudo .dica-clique').count(), `${id}: gráfico vazio`);
          await p.click('#mk-aba-conteudo [data-mk-modo="tabela"]');
        }
        if (id === 'estados') {
          await p.waitForSelector('#mk-mapa svg', { timeout: 20000 }).catch(() => notas.push('mapa não carregou (CDN)'));
        }
        await semJargao(p, '#mk-aba-conteudo');
        await imprimir(p, 'diagnostico', `mercado-${id}`);
      }
      await p.click('#mk-angulos [data-mk-aba="marcas"]');
      const g = await p.locator('#mk-resultado a.mk-g').first().getAttribute('href').catch(() => null);
      exigir(!g || g.startsWith('https://www.google.com/search'), `G: ${g}`);
      notas.push(g ? 'G ok' : 'sem marca/empresa para o G');
      return notas.join(' · ');
    });

    await passo('clique numa marca filtra as Correspondências; "Mostrar todas" volta; CSV baixa', null, async () => {
      await p.click('#mk-angulos [data-mk-aba="marcas"]');
      const linha = p.locator('#mk-aba-conteudo tr[data-mk-filtro="marca"]').first();
      if (!(await linha.count())) return 'sem marca nesta busca';
      const marca = await linha.getAttribute('data-mk-valor');
      await linha.click();
      exigir(await p.locator('.mk-filtro').isVisible(), 'filtro não apareceu');
      const [download] = await Promise.all([p.waitForEvent('download'), p.click('#mk-csv')]);
      await p.click('[data-mk-limpar]');
      exigir(!(await p.locator('.mk-filtro').count()), 'Mostrar todas não limpou');
      return `marca ${marca} · CSV ${download.suggestedFilename()}`;
    });

    await passo('Trazer mais 200 compras soma compras novas', null, async () => {
      const botao = p.locator('#mk-trazer-mais');
      if (!(await botao.count())) return 'sem mais páginas na fonte';
      const antes = Number((await p.locator('#mk-mais .dica-clique').innerText()).replace(/\D.*$/s, '').replace(/\D/g, ''));
      await botao.click();
      await p.waitForFunction((a) => { const t = document.querySelector('#mk-mais .dica-clique'); return t && Number(t.innerText.split(' ')[0].replace(/\D/g, '')) > a; }, antes, { timeout: 90000 });
      return `${antes} -> ${(await p.locator('#mk-mais .dica-clique').innerText()).slice(0, 80)}`;
    });

    await passo('Encontrar fornecedor com IA abre com o mesmo nome do botão e fecha', null, async () => {
      await p.click('#mk-angulos [data-mk-aba="empresas"]');
      await p.click('#mk-aba-conteudo [data-abrir-fornecedor-ia]');
      await p.waitForSelector('#fornecedor-ia-titulo', { state: 'visible', timeout: 10000 });
      exigir((await p.innerText('#fornecedor-ia-titulo')) === 'Encontrar fornecedor com IA', 'título da gaveta');
      await p.locator('#fornecedor-ia-titulo').locator('xpath=..').locator('button').click();
      return 'abre e fecha';
    });

    await passo('Baixa concorrência e Licitação anterior: sem jargão de robô', null, async () => {
      await p.click('#dg-subabas [data-subaba="baixa-concorrencia"]');
      await p.waitForFunction(() => /item|histórico|Pesquise/.test(document.getElementById('dg-bc-licitantes').innerText), null, { timeout: 30000 });
      const bc = await semJargao(p, '#dg-bc-licitantes');
      await imprimir(p, 'diagnostico', 'mercado-baixa-concorrencia');
      await p.click('#dg-subabas [data-subaba="licitacao-anterior"]');
      await semJargao(p, '#dg-licitacao-anterior');
      await imprimir(p, 'diagnostico', 'mercado-licitacao-anterior');
      await p.click('#dg-subabas [data-subaba="pesquisa"]');
      return bc.replace(/\s+/g, ' ').slice(0, 160);
    });

    await passo('"Analisar empresa" da aba Empresas abre Analisar concorrente já com o CNPJ (sem atalho fixo)', null, async () => {
      await p.click('#mk-angulos [data-mk-aba="empresas"]');
      const b = p.locator('#mk-aba-conteudo [data-mk-cnpj]').first();
      if (!(await b.count())) return 'sem empresa com CNPJ nesta busca';
      const cnpj = await b.getAttribute('data-mk-cnpj');
      // Última empresa analisada guardada: antes ela era restaurada por cima e travava o botão (a tela mostrava a outra).
      const outra = cnpj === '03090004000104' ? '14220230000170' : '03090004000104';
      await p.evaluate((c) => localStorage.setItem('hc_empresa_filtro', JSON.stringify({ cnpj: c })), outra);
      await b.click();
      await p.waitForSelector('section#empresa.ativa');
      exigir((await p.inputValue('#emp-cnpj')) === cnpj, 'CNPJ não veio');
      await p.waitForSelector('#emp-analise-cnpj .acn-onde-atua, #emp-resultado .aviso', { timeout: 240000 });
      const digitos = (await p.innerText('#emp-resultado')).replace(/\D/g, '');
      exigir(digitos.includes(cnpj) && !digitos.includes(outra), 'a análise mostrada não é do CNPJ clicado');
      for (const id of ['emp-minhas', 'emp-ir-raiox']) exigir(!(await p.locator('#' + id).count()), `#${id} voltou`);
      await semJargao(p, '#emp-resultado');
      await imprimir(p, 'empresa', 'concorrente');
      return `CNPJ ${cnpj}`;
    });

    await passo('Convênios: busca, soma do valor liberado conferida à mão, detalhe abre', null, async () => {
      await servico('POST', '/rest/v1/dados_robo', [{ chave: 'convenios', dado: CONVENIOS }]);
      await p.reload();
      await abrir(p, 'transparencia');
      await p.selectOption('#cv-uf', ''); // o perfil do seed tem um estado só (AM), que vem marcado sozinho
      await p.click('#cv-buscar');
      await p.waitForFunction(() => !document.querySelector('#cv-resultado .carregando') && document.getElementById('cv-resultado').innerText.trim(), null, { timeout: 30000 });
      const texto = await semJargao(p, '#cv-resultado');
      const linhas = p.locator('#cv-resultado tr.linha-clicavel');
      const qtd = await linhas.count();
      let conta = 'sem convênios no banco local';
      if (qtd) {
        const soma = (await p.locator('#cv-resultado tr.linha-clicavel td:nth-child(5)').allInnerTexts()).reduce((s, t) => s + reais(t), 0);
        const cartao = reais(await p.locator('#cv-resultado .cartao').nth(1).locator('.valor').innerText());
        exigir(Math.abs(soma - cartao) < 0.05, `soma ${soma} x cartão ${cartao}`);
        await linhas.first().click();
        exigir(await p.locator('#cv-resultado .detalhe-drilldown').isVisible(), 'detalhe não abriu');
        exigir(Math.abs(soma - 180000.75) < 0.01, `soma esperada 180.000,75, veio ${soma}`);
        exigir((await linhas.first().innerText()).includes('10/11/2026'), 'data de publicação caiu no dia anterior');
        conta = `${qtd} convênio(s), soma R$ ${soma.toFixed(2)} = cartão = 150.000,50 + 30.000,25 (conta à mão)`;
      }
      await imprimir(p, 'transparencia', 'convenios');
      return `${conta} · ${texto.replace(/\s+/g, ' ').slice(0, 140)}`;
    });

    await passo('Raio-X Financeiro: explica para que serve, sem citar concorrente; sem chave local mostra aviso simples', null, async () => {
      const dica = await p.locator('#raio-x-financeiro .dica-clique').first().innerText();
      exigir(/Para que serve/.test(dica) && !/concorrente/i.test(dica), dica);
      await p.fill('#fn-cnpj', '123');
      await p.click('#fn-buscar');
      exigir(/CNPJ válido/.test(await p.innerText('#fn-resultado')), 'CNPJ curto sem aviso');
      await p.fill('#fn-cnpj', '14220230000170');
      await p.click('#fn-buscar');
      await p.waitForFunction(() => !document.querySelector('#fn-resultado .carregando'), null, { timeout: 120000 });
      const r = await semJargao(p, '#fn-resultado');
      exigir(!/R\$\s*NaN|undefined/.test(r), r);
      await imprimir(p, 'transparencia', 'raio-x');
      return r.replace(/\s+/g, ' ').slice(0, 160);
    });

    await passo('Pesquisa de Preços: notebook ao vivo, marcas e compras, sem jargão', null, async () => {
      await abrir(p, 'precos');
      const campo = p.locator('#pp-mercado input').first();
      await campo.fill('notebook');
      await campo.press('Enter');
      await p.waitForFunction(() => { const t = document.getElementById('pp-mercado').innerText; return /compra\(s\)|Nenhuma compra|não respondeu/.test(t) && !/Carregando compras/.test(t); }, null, { timeout: 120000 });
      const t = await semJargao(p, '#pp-mercado');
      await imprimir(p, 'precos', 'precos');
      return t.replace(/\s+/g, ' ').slice(0, 200);
    });

    await passo('chat com IA abre, responde em português simples e fecha', null, async () => {
      await p.click('#chat-ia-btn');
      await p.fill('#lp-chat-campo', 'Onde fica a Pesquisa de Preços?');
      await p.click('.lp-chat-form button[type=submit]');
      await p.waitForFunction(() => document.querySelectorAll('.lp-chat-msg.lp-chat-ia, .lp-chat-msg.lp-chat-erro').length > 0
        && !/Pensando/.test([...document.querySelectorAll('.lp-chat-msg')].pop().textContent), null, { timeout: 60000 });
      const texto = (await p.locator('.lp-chat-lista').innerText()) + (await p.locator('.lp-chat-aviso').innerText());
      exigir(!JARGAO.test(texto), `jargão no chat: ${jargaoEm(texto)}`);
      await p.screenshot({ path: path.join(PRINTS, 'chat-ia-1280.png') });
      return texto.replace(/\s+/g, ' ').slice(-220);
    });

    await passo('console do navegador sem erro de JavaScript', null, async () => {
      const js = p.erros.filter((e) => e.startsWith('pageerror'));
      exigir(!js.length, js.join(' | '));
      return `${p.erros.length} aviso(s) de rede/console fora de JS: ${p.erros.filter((e) => !e.startsWith('pageerror')).slice(0, 5).join(' | ')}`;
    });
  } finally {
    await servico('DELETE', '/rest/v1/dados_robo?chave=eq.convenios').catch(() => {});
    fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify({ quando: new Date().toISOString(), resultados, errosPagina: p.erros }, null, 2));
    await navegador.close();
  }
  if (resultados.some((r) => !r.ok)) process.exitCode = 1;
}
if (require.main === module) main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
