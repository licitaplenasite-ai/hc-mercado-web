// E2E da tela "Analisar concorrente" refeita (20/11/2026): sem atalho fixo de empresa, sem botão que leva a outra tela,
// seções na ordem dados > alertas > desempenho > contratos > pagamentos federais > onde atua, sem jargão de robô.
// Dois CNPJs reais e públicos de fornecedores do governo. Só o banco local é alterado.
//   PORTA_TESTE=8804 node ambiente-teste/servidor.cjs   (outro terminal; antes: npm run build:cloudflare)
//   PORTA_TESTE=8804 PRINTS=<pasta> node ambiente-teste/e2e-analisar-concorrente.cjs
// O servidor local não tem a chave do Portal da Transparência: a 1ª passada prova o aviso amigável (sem nome de
// variável de ambiente); a 2ª devolve um pagamento simulado só para mostrar a seção preenchida (dito no print).
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');

const CNPJS = [['rymo', '14220230000170'], ['bms', process.env.CNPJ_2 || '03090004000104']];
const ORDEM = ['Dados da empresa', 'Alertas', 'Desempenho em licitações', 'Contratos com o governo', 'Quanto essa empresa já recebeu do governo federal', 'Onde atua e o que vende'];
const JARGAO = /arquivo semanal|a cada 2 horas|Completando|O que já está aqui|TRANSPARENCIA_TOKEN|Netlify|robô/i;
const CPF = /\d{3}\.\d{3}\.\d{3}-\d{2}|\*{3}\.?\d{3}/;

async function analisar(p, cnpj) {
  await p.goto(SITE + '/painel.html');
  await p.click('nav button[data-alvo="empresa"]');
  await p.fill('#emp-cnpj', cnpj);
  await p.click('#emp-buscar');
  await p.waitForSelector('#emp-analise-cnpj .acn-onde-atua', { timeout: 240000 });
  await p.waitForFunction(() => !document.querySelector('#emp-analise-cnpj .acn-pagamentos .carregando'), null, { timeout: 120000 });
}

async function imprimir(p, nome) {
  await p.addStyleTag({ content: 'header { position: static !important; }' });
  for (const largura of [1280, 375]) {
    await p.setViewportSize({ width: largura, height: 900 });
    await p.waitForTimeout(300);
    await p.locator('#empresa').screenshot({ path: path.join(PRINTS, `depois-${nome}-${largura}.png`) });
  }
  await p.setViewportSize({ width: 1366, height: 900 });
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await novaPagina(navegador, seed.usuarios[process.env.USUARIO_E2E || 'gestor']); // outro usuário se a cota diária do gestor acabou
  try {
    await passo('tela limpa: só o campo CNPJ/nome e o botão; sem atalho de empresa nem botão para o Raio-X', null, async () => {
      await p.goto(SITE + '/painel.html');
      await p.click('nav button[data-alvo="empresa"]');
      await p.waitForTimeout(1500); // o atalho antigo aparecia depois de uma consulta ao banco
      for (const id of ['emp-minhas', 'emp-ir-raiox', 'emp-segmento', 'emp-dias']) exigir(!(await p.locator('#' + id).count()), `#${id} ainda existe`);
      const botoes = await p.locator('#emp-filtros-principais button').allInnerTexts();
      return `botões no filtro: ${JSON.stringify(botoes)}`;
    });
    for (const [nome, cnpj] of CNPJS) {
      await passo(`${nome}: seções na ordem, sem jargão, sem CPF e sem sair da tela`, null, async () => {
        await analisar(p, cnpj);
        exigir(await p.locator('#empresa').isVisible(), 'saiu da tela Analisar concorrente');
        exigir(!(await p.locator('#transparencia').isVisible()), 'abriu Convênios');
        const titulos = await p.locator('#emp-analise-cnpj .acn-secao > h3, #emp-analise-cnpj .acn-cabecalho > h3').allInnerTexts();
        exigir(JSON.stringify(titulos) === JSON.stringify(ORDEM), `ordem: ${JSON.stringify(titulos)}`);
        const texto = await p.locator('#emp-analise-cnpj').innerText();
        exigir(!JARGAO.test(texto), `jargão: ${texto.match(JARGAO)}`);
        exigir(!CPF.test(texto), 'CPF na tela');
        exigir(texto.includes('Fonte: Portal da Transparência'), 'pagamentos sem fonte');
        exigir(!(await p.locator('#emp-analise-cnpj .acn-coleta').innerText().catch(() => '')).includes('Não conseguimos'), 'coleta falhou (cota diária?)');
        const pag = await p.locator('#emp-analise-cnpj .acn-pagamentos').innerText();
        await imprimir(p, nome);
        const desemp = await p.locator('#emp-analise-cnpj .acn-desempenho ul').first().innerText();
        const contratos = await p.locator('#emp-analise-cnpj .acn-contratos .cartoes').innerText().catch(() => 'sem contratos');
        return `${titulos.length} seções · desempenho: ${desemp.replace(/\s+/g, ' ').slice(0, 220)} · contratos: ${contratos.replace(/\s+/g, ' ')} · pagamentos: ${pag.replace(/\s+/g, ' ').slice(-140)}`;
      });
    }
    await passo('pagamentos federais aparecem dentro da análise (resposta simulada do Portal, só neste passo)', null, async () => {
      let pedido = null;
      await p.route('**/api/despesas-fornecedor**', (rota) => {
        pedido = new URL(rota.request().url()).searchParams.get('cnpj');
        rota.fulfill({ contentType: 'application/json', body: JSON.stringify({ cnpj: pedido, totalPago: 1234.5, porAno: { 2026: 1000, 2025: 234.5 }, totalDocumentos: 2, parcial: false,
          documentos: [{ data: '2026-03-10', orgao: 'SIMULADO — Ministério', unidadeGestora: 'UG simulada', valor: 1000 }, { data: '2025-05-02', orgao: 'SIMULADO — Ministério', unidadeGestora: 'UG simulada', valor: 234.5 }], erro: null }) });
      });
      await analisar(p, CNPJS[0][1]);
      exigir(pedido === CNPJS[0][1], `function chamada com o CNPJ ${pedido}`);
      const pag = await p.locator('#emp-analise-cnpj .acn-pagamentos').innerText();
      exigir(/Total recebido/.test(pag) && /1\.234,50/.test(pag), pag);
      exigir(await p.locator('#empresa').isVisible(), 'saiu da tela');
      await p.addStyleTag({ content: 'header { position: static !important; }' });
      await p.locator('#emp-analise-cnpj .acn-pagamentos').screenshot({ path: path.join(PRINTS, 'depois-pagamentos-simulado-1280.png') });
      await p.unroute('**/api/despesas-fornecedor**');
      return `CNPJ enviado à function: ${pedido} · ${pag.replace(/\s+/g, ' ').slice(0, 200)}`;
    });
  } finally {
    fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify({ quando: new Date().toISOString(), resultados, errosPagina: p.erros }, null, 2));
    await navegador.close();
  }
}
if (require.main === module) main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
