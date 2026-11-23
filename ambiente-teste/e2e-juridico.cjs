/* global document */
// E2E da área Jurídico (juridico-ui.js): aviso fixo e HC, busca em tudo com filtro por lei, modelos preenchidos com o
// processo do Funil e exportados (Word e PDF), calculadora de prazos, artigos, link de abrir o modelo e peças reais.
//   PORTA_TESTE=8870 node ambiente-teste/servidor.cjs   (outro terminal; antes: npm run build:cloudflare e subir.cjs)
//   PORTA_TESTE=8870 PRINTS=<pasta> node ambiente-teste/e2e-juridico.cjs
// Só lê: nenhuma peça é enviada, o Word é gerado localmente pelo /api/gerar-checklist do ambiente de teste.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// O banco local nasce sem peças (o coletor fala com o ComprasNet/PNCP): o teste grava 2 fictícias e apaga no fim.
const PECAS = ['cn-e2e-juridico-1', 'pncp-e2e-juridico-2'];
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const apagarPecas = () => psql(`delete from pecas_juridicas where id in ('${PECAS.join("','")}');`);
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');

async function imprimir(p, nome) {
  await p.addStyleTag({ content: 'header { position: static !important; }' });
  for (const largura of [1280, 375]) {
    await p.setViewportSize({ width: largura, height: 900 });
    await p.waitForTimeout(300);
    const larguraDoc = await p.evaluate(() => document.documentElement.scrollWidth);
    exigir(larguraDoc <= largura, `${nome}: sem rolagem horizontal em ${largura}px (scrollWidth ${larguraDoc})`);
    await p.locator('#juridico').screenshot({ path: path.join(PRINTS, `${nome}-${largura}.png`) });
  }
  await p.setViewportSize({ width: 1366, height: 900 });
}
// Preenche todo campo do modelo que ainda está vazio (o que viria do processo já veio).
async function completarCampos(p) {
  for (const campo of await p.locator('#jur-painel-modelos .jur-campos input, #jur-painel-modelos .jur-campos textarea').all()) {
    if (!(await campo.inputValue()).trim()) await campo.fill('Texto de exemplo do teste');
  }
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await novaPagina(navegador, seed.usuarios.gestor);
  const errosConsole = [];
  p.on('console', (m) => { if (m.type() === 'error') errosConsole.push(m.text()); });
  p.on('pageerror', (e) => errosConsole.push(String(e)));
  // Nenhum passo deve abrir janela de arquivo; se abrir, falha em vez de travar.
  p.on('filechooser', () => errosConsole.push('abriu janela de arquivo sem pedir'));
  apagarPecas();
  psql(`insert into pecas_juridicas(id,tipo,pregao,uasg,orgao,texto,resposta,lei,url,data,busca) values
    ('${PECAS[0]}','recurso','12/2022','158000','ORGAO FICTICIO E2E','Recurso fictício e2e: o atestado de capacidade técnica apresentado atende ao edital.','Negado provimento (fictício).','10520',
     'https://www.comprasnet.gov.br/livre/pregao/ficticio','2022-05-10','recurso ficticio e2e o atestado de capacidade tecnica apresentado atende ao edital orgao ficticio e2e'),
    ('${PECAS[1]}','impugnacao',null,null,'MUNICIPIO FICTICIO E2E','Impugnação fictícia e2e: exigência de atestado com quantidade mínima acima de 50%.',null,'14133',
     'https://pncp.gov.br/app/editais/99999999000191/2026/2','2026-11-18','impugnacao ficticia e2e exigencia de atestado com quantidade minima acima de 50 municipio ficticio e2e');`);
  let processoId = null;
  try {
    await p.goto(SITE + '/painel.html#juridico');
    await p.waitForSelector('#juridico-central .jur-abas');
    await passo('topo: aviso fixo e link da HC, sem pop-up', null, async () => {
      exigir((await p.textContent('#juridico-central .jur-pendente')).includes('Conteúdo informativo. Confira com um advogado antes de protocolar.'), 'aviso fixo ausente');
      exigir(await p.getAttribute('#juridico-central .jur-hc a', 'href') === 'https://www.hclicitacoes.com', 'link da HC errado');
      exigir(await p.locator('dialog[open]').count() === 0, 'pop-up aberto');
    });
    await passo('buscar em tudo: modelos, artigos e perguntas; filtro por lei; peças reais', null, async () => {
      await p.fill('#jur-tudo', 'atestado');
      await p.waitForTimeout(200);
      const texto = await p.textContent('#jur-painel-busca');
      exigir(/Modelos \(\d+\)/.test(texto) && /Artigos \(\d+\)/.test(texto) && /Perguntas e respostas \(\d+\)/.test(texto), 'busca não juntou as três fontes');
      await p.click('#jur-painel-busca button:has-text("Buscar também nas peças reais")');
      await p.waitForSelector('#jur-painel-busca .jur-peca', { timeout: 15000 });
      await imprimir(p, 'juridico-busca');
      await p.click('#jur-painel-busca .jur-chip[data-lei="8666"]');
      await p.fill('#jur-tudo', 'recurso');
      await p.waitForTimeout(200);
      const artigos = await p.locator('#jur-painel-busca .jur-resultado').allTextContents();
      exigir(artigos.length === 1 && /Lei 8\.666/.test(artigos[0]), `filtro 8.666 trouxe: ${artigos.join(' | ')}`);
      await p.click('#jur-painel-busca .jur-resultado');
      await p.waitForSelector('#jur-artigo-lei-antiga[open]');
    });
    await passo('artigos: 15, com fonte oficial e Equipe LicitaPlena', null, async () => {
      exigir(/15 artigo/.test(await p.textContent('#jur-painel-artigos .jur-contagem')), 'não são 15 artigos');
      const selos = await p.locator('#jur-painel-artigos .jur-selo').allTextContents();
      exigir(selos.every((s) => s.includes('Equipe LicitaPlena')), 'autor errado');
      exigir(await p.locator('#jur-painel-artigos a[href^="https://www.planalto.gov.br/"]').count() >= 15, 'artigos sem link do Planalto');
      await imprimir(p, 'juridico-artigos');
    });
    await passo('modelos: recurso preenchido com o processo, [PREENCHER] trava, Word baixa e PDF imprime', null, async () => {
      await p.click('#jur-aba-modelos');
      await p.selectOption('#jur-modelo', 'recurso');
      exigir((await p.inputValue('#jur-texto')).includes('[PREENCHER: decisão recorrida]'), 'marcador ausente');
      exigir(await p.isDisabled('#jur-painel-modelos .jur-primario'), 'Word liberado com campo vazio');
      exigir((await p.locator('#jur-painel-modelos .jur-faltar li').count()) >= 3, 'sem "o que não pode faltar"');
      await p.waitForFunction(() => document.querySelectorAll('#jur-processo option').length > 1, null, { timeout: 15000 });
      processoId = await p.locator('#jur-processo option').nth(1).getAttribute('value');
      await p.selectOption('#jur-processo', processoId);
      const orgao = await p.inputValue('#jur-campo-orgao');
      exigir(orgao.trim().length > 0, 'órgão não veio do processo');
      await completarCampos(p);
      await p.check('#jur-revisado');
      exigir(!(await p.isDisabled('#jur-painel-modelos .jur-primario')), 'Word continua travado');
      const [baixado] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#jur-painel-modelos .jur-primario')]);
      exigir(/recurso\.docx$/.test(baixado.suggestedFilename()), `nome do arquivo: ${baixado.suggestedFilename()}`);
      const destino = path.join(PRINTS, 'juridico-recurso.docx');
      await baixado.saveAs(destino);
      exigir(fs.statSync(destino).size > 2000, 'Word vazio');
      await p.click('#jur-painel-modelos button:has-text("Imprimir / salvar PDF")');
      await p.waitForSelector('#jur-quadro-impressao', { state: 'attached' });
      const noQuadro = await p.evaluate(() => document.getElementById('jur-quadro-impressao').contentDocument.body.textContent);
      exigir(noQuadro.includes(orgao), 'PDF sem o texto preenchido');
      await imprimir(p, 'juridico-modelos');
    });
    await passo('modelos: exequibilidade, intenção de recurso curta e declarações', null, async () => {
      await p.selectOption('#jur-modelo', 'exequibilidade');
      exigir(/75%/.test(await p.inputValue('#jur-texto')), 'exequibilidade sem a linha dos 75%');
      await p.selectOption('#jur-modelo', 'intencao_recurso');
      exigir(!(await p.inputValue('#jur-texto')).includes('pede deferimento'), 'intenção de recurso com fecho de peça');
      await p.selectOption('#jur-modelo', 'declaracoes');
      exigir((await p.inputValue('#jur-texto')).includes('art. 63, IV'), 'declarações sem o art. 63');
    });
    await passo('calculadora de prazos: ata 23/12/2026 → recurso até 29/12/2026', null, async () => {
      await p.click('#jur-aba-prazos');
      await p.selectOption('#jur-prazo-evento', 'ata');
      await p.fill('#jur-prazo-data', '2026-12-23');
      await p.waitForTimeout(200);
      const texto = await p.textContent('#jur-painel-prazos');
      exigir(texto.includes('29/12/2026 (terça-feira)'), 'recurso fora da data conferida');
      exigir(texto.includes('04/01/2027 (segunda-feira)'), 'contrarrazão estimada fora da data conferida');
      await p.selectOption('#jur-prazo-evento', 'abertura');
      await p.fill('#jur-prazo-data', '2026-11-23');
      await p.waitForTimeout(200);
      exigir((await p.textContent('#jur-painel-prazos')).includes('17/11/2026 (terça-feira)'), 'impugnação não pulou o feriado de 20/11');
      await imprimir(p, 'juridico-prazos');
      await p.click('#jur-painel-prazos button:has-text("Preparar: Impugnação ao edital")');
      exigir(await p.inputValue('#jur-modelo') === 'impugnacao', 'botão não abriu o modelo');
    });
    await passo('link do Funil / "Mudou algo no edital?": abre contrarrazão já com o processo', null, async () => {
      await p.goto(`${SITE}/painel.html?juridico=contrarrazao&processo=${processoId}#juridico`);
      await p.waitForFunction((id) => document.getElementById('jur-processo')?.value === id, processoId, { timeout: 15000 });
      exigir(await p.inputValue('#jur-modelo') === 'contrarrazao', 'modelo do link errado');
      exigir((await p.inputValue('#jur-campo-orgao')).trim().length > 0, 'órgão não preenchido pelo link');
    });
    await passo('peças reais: filtro por lei 14.133', null, async () => {
      await p.click('#jur-aba-banco');
      await p.fill('#jur-banco-palavras', 'atestado');
      await p.selectOption('#jur-banco-lei', '14133');
      await p.click('#jur-painel-banco .jur-primario');
      await p.waitForSelector('#jur-painel-banco .jur-peca', { timeout: 15000 });
      const topos = await p.locator('#jur-painel-banco .jur-peca .jur-ajuda').allTextContents();
      exigir(topos.length > 0 && topos.every((t) => /Lei 14133/.test(t)), 'filtro 14.133 falhou');
      exigir(await p.locator('#jur-painel-banco mark').count() > 0, 'sem destaque');
      await imprimir(p, 'juridico-banco');
    });
    await passo('tema escuro e console sem erro', null, async () => {
      await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.classList.remove('tema-claro'); });
      await p.click('#jur-aba-modelos');
      await imprimir(p, 'juridico-modelos-escuro');
      const meus = errosConsole.filter((e) => !/favicon|net::ERR_|Failed to load resource/i.test(e));
      exigir(meus.length === 0, `erros no console: ${meus.join(' | ')}`);
    });
  } finally {
    apagarPecas();
    await navegador.close();
    console.log(JSON.stringify(resultados, null, 1));
  }
}

main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
