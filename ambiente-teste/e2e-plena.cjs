/* global document */
// E2E da Plena (chat-ia-ui.js + /api/chat-ia + /api/ia-edital) no ambiente local, com edital REAL do PNCP:
// Pregão Eletrônico 030/2026 da COSAMA (04406195000125-1-000014/2026). Sem chave de IA (o servidor de teste apaga):
// a conversa geral responde no modo "base" e a pergunta de pagamento sai direto das cláusulas do edital (sem IA).
//   LEITURA_DOCUMENTAL_LOCAL=1 PORTA_TESTE=8893 node ambiente-teste/servidor.cjs   (outro terminal; ia_perguntas_salvas.sql aplicado)
//   PORTA_TESTE=8893 PRINTS=<pasta> node ambiente-teste/e2e-plena.cjs
// LEITURA_DOCUMENTAL_LOCAL=1: sem dossiê, o servidor lê os arquivos do PNCP de verdade e grava a leitura documental
// (ainda sem a síntese do robô Gemini). O roteiro faz o papel do robô ao "concluir" essa leitura no banco LOCAL.
const path = require('node:path');
const fs = require('node:fs');
const { passo, exigir, novaPagina, comoUsuario, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const EDITAL = '04406195000125-1-000014/2026';
const PROCESSO = '2cde2ec4-6796-44d7-acf9-e03ecace8056'; // processo do seed (empresa A2) com este edital
const servico = (caminho, op = {}) => fetch(`${chaves.API_URL}/rest/v1/${caminho}`, { ...op, headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', ...(op.headers || {}) } });

async function imprimir(p, nome) {
  for (const [largura, altura] of [[1366, 900], [375, 812]]) {
    await p.setViewportSize({ width: largura, height: altura });
    await p.waitForTimeout(400);
    const larguraDoc = await p.evaluate(() => document.documentElement.scrollWidth);
    exigir(larguraDoc <= largura + 1, `${nome}: rolagem horizontal em ${largura}px (scrollWidth ${larguraDoc})`);
    await p.screenshot({ path: path.join(PRINTS, `${nome}-${largura}.png`) });
  }
  await p.setViewportSize({ width: 1366, height: 900 });
}
const ultimaIa = (p) => p.locator('.lp-plena .lp-chat-msg.lp-chat-ia, .lp-plena .lp-chat-msg.lp-chat-erro').last();
async function esperarResposta(p, antes, tempo = 60000) {
  await p.waitForFunction((n) => document.querySelectorAll('.lp-plena .lp-chat-msg.lp-chat-ia:not(.lp-plena-pensando), .lp-plena .lp-chat-msg.lp-chat-erro').length > n
    && !document.querySelector('.lp-plena-pensando'), antes, { timeout: tempo });
  return (await ultimaIa(p).textContent()) || '';
}
const contarIa = (p) => p.locator('.lp-plena .lp-chat-msg.lp-chat-ia:not(.lp-plena-pensando), .lp-plena .lp-chat-msg.lp-chat-erro').count();
async function perguntar(p, texto) {
  const antes = await contarIa(p);
  await p.fill('#lp-chat-campo', texto);
  await p.click('.lp-chat-form button[type=submit]');
  return esperarResposta(p, antes);
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  // Começa sem dossiê nem fila deste edital e sem cota gasta (só o banco LOCAL; chaves.local.json aponta para 127.0.0.1).
  exigir(/^http:\/\/127\.0\.0\.1:/.test(chaves.API_URL), 'chaves não são do Supabase local');
  await servico(`dossies_editais?numero_controle_pncp=eq.${encodeURIComponent(EDITAL)}`, { method: 'DELETE' });
  await servico(`fila_dossies?numero_controle_pncp=eq.${encodeURIComponent(EDITAL)}`, { method: 'DELETE' });
  await servico(`uso_diario?usuario_id=eq.${seed.usuarios.gestor.id}`, { method: 'DELETE' });
  await servico(`ia_perguntas_salvas?usuario_id=eq.${seed.usuarios.gestor.id}`, { method: 'DELETE' });
  // Ficha real do PNCP para o cartão da busca (a busca do painel é simulada só na listagem; documentos e dossiê são reais).
  const ficha = await fetch('https://pncp.gov.br/api/consulta/v1/orgaos/04406195000125/compras/2026/14').then((r) => r.json());
  const item = { numero_controle_pncp: EDITAL, description: ficha.objetoCompra, title: `Pregão ${ficha.numeroCompra}`, uf: ficha.unidadeOrgao?.ufSigla || 'AM', municipio_nome: ficha.unidadeOrgao?.municipioNome || 'Manaus',
    orgao_nome: ficha.orgaoEntidade.razaoSocial, data_fim_vigencia: ficha.dataEncerramentoProposta, data_publicacao_pncp: ficha.dataPublicacaoPncp, modalidade_licitacao_nome: ficha.modalidadeNome,
    usuario_nome: 'Licitações-e', link_sistema_origem: ficha.linkSistemaOrigem, orgao_cnpj: '04406195000125', ano: '2026', numero_sequencial: '14', numero: ficha.numeroCompra };

  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const p = await novaPagina(navegador, seed.usuarios.gestor);
  try {
    await p.route('**/api/pncp-proxy**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [item], total: 1 }) }));
    await passo('botão flutuante "Plena" com ícone próprio nas telas logadas', null, async () => {
      for (const tela of ['/painel.html', '/processos.html', '/sistema']) {
        await p.goto(SITE + tela);
        await p.waitForSelector('#chat-ia-btn', { timeout: 15000 });
        exigir((await p.textContent('#chat-ia-btn')).trim() === 'Plena', `${tela}: botão sem o nome Plena`);
        exigir(await p.locator('#chat-ia-btn svg.lp-plena-icone').count() === 1, `${tela}: sem ícone`);
      }
    });

    await p.goto(SITE + '/painel.html');
    await p.locator('nav button[data-alvo="oportunidades"]').dispatchEvent('click');
    await p.waitForSelector('#op-palavras', { state: 'visible' });
    const card = p.locator('#op-resultado .boletim-card').first();
    await passo('Encontrar licitações: cartão real da COSAMA com botão Plena', null, async () => {
      await p.evaluate(() => { document.querySelector('#op-uf').querySelectorAll('option').forEach((o) => { o.selected = false; }); });
      await p.fill('#op-palavras', 'poço'); await p.click('#op-buscar');
      await card.waitFor({ timeout: 20000 });
      exigir(await card.locator('.btn-plena').count() === 1, 'cartão sem o botão Plena');
      await card.screenshot({ path: path.join(PRINTS, '01-cartao-com-botao-plena.png') });
    });

    await passo('Plena no edital: cartão de 10 campos e leitura real dos arquivos do PNCP com progresso', null, async () => {
      await card.locator('.btn-plena').click();
      await p.waitForSelector('.lp-plena .lp-plena-cartao dl', { timeout: 15000 });
      const rotulos = await p.$$eval('.lp-plena-cartao dt', (xs) => xs.map((x) => x.textContent));
      exigir(rotulos.length === 10, `cartão com ${rotulos.length} campos`);
      exigir(/Falando sobre/.test(await p.textContent('.lp-plena-barra')), 'sem a barra do edital');
      await p.waitForFunction(() => /Lendo os documentos|Documentos lidos|Leitura parcial/.test(document.querySelector('.lp-plena-status')?.textContent || ''), null, { timeout: 90000 });
      const status = await p.textContent('.lp-plena-status');
      const arquivos = await p.$$eval('.lp-plena-arquivos li', (xs) => xs.map((x) => x.textContent));
      exigir(arquivos.length > 0, 'sem a lista de arquivos do PNCP');
      exigir(await p.locator('.lp-plena .lp-chat-sugestao[disabled]').count() > 0 || /Documentos lidos/.test(status), 'perguntas liberadas antes da leitura terminar');
      await imprimir(p, '02-plena-lendo-documentos');
      return `${status} | ${arquivos.length} arquivo(s): ${arquivos.join(' / ').slice(0, 200)}`;
    });

    await passo('robô conclui a leitura (banco local) e a Plena libera o edital sozinha', null, async () => {
      let linha = [];
      for (let i = 0; i < 30 && !linha.length; i++) {
        linha = await servico(`dossies_editais?numero_controle_pncp=eq.${encodeURIComponent(EDITAL)}&select=dossie`).then((r) => r.json());
        if (!linha.length) await p.waitForTimeout(2000);
      }
      exigir(linha.length === 1 && linha[0].dossie?.textoEdital, 'a leitura documental local não foi gravada');
      const dossie = { ...linha[0].dossie, modoDegradado: false, metodoResumo: 'documentos', revisaoPrazos: true, resposta: 'Resumo do edital (19 seções) — gerado no teste local.' };
      const r = await servico(`dossies_editais?numero_controle_pncp=eq.${encodeURIComponent(EDITAL)}`, { method: 'PATCH', body: JSON.stringify({ dossie, status: 'pronto', fonte_lida: true }) });
      exigir(r.ok, `PATCH do dossiê: ${r.status} ${await r.text()}`);
      await p.waitForFunction(() => /Documentos lidos|Leitura parcial/.test(document.querySelector('.lp-plena-status')?.textContent || ''), null, { timeout: 60000 });
      exigir(await p.locator('.lp-plena-cartao button', { hasText: 'Ver resumo completo' }).count() === 1, 'sem "Ver resumo completo"');
      exigir(await p.locator('.lp-plena .lp-chat-sugestao[disabled]').count() === 0, 'perguntas continuam travadas');
      const campos = await p.$$eval('.lp-plena-cartao dl > *', (xs) => xs.map((x) => x.textContent).join(' | '));
      exigir(/COSAMA|SANEAMENTO/i.test(campos), 'órgão real ausente do cartão: ' + campos.slice(0, 300));
      await imprimir(p, '03-plena-cartao-edital');
      return campos.slice(0, 400);
    });

    await passo('chip Pagamento: trecho literal com arquivo, página e link oficial do documento', null, async () => {
      const antes = await contarIa(p);
      await p.locator('.lp-plena .lp-chat-sugestao', { hasText: /^Pagamento$/ }).click();
      await esperarResposta(p, antes);
      const citacoes = ultimaIa(p).locator('.lp-plena-citacao');
      exigir(await citacoes.count() > 0, 'sem citação: ' + (await ultimaIa(p).textContent()).slice(0, 300));
      const legenda = await citacoes.first().locator('figcaption').textContent();
      exigir(/página \d+/.test(legenda) && /cláusula/.test(legenda), 'citação sem página/cláusula: ' + legenda);
      const href = await citacoes.first().locator('a').getAttribute('href');
      exigir(/^https:\/\/pncp\.gov\.br\/pncp-api\/v1\/orgaos\/04406195000125\/compras\/2026\/14\/arquivos\/\d+$/.test(href || ''), 'link do documento: ' + href);
      await imprimir(p, '04-plena-citacao-pagamento');
      return `${legenda.trim()} -> ${href}`;
    });

    await passo('pergunta que precisa de IA sem provedor: mensagem simples, nada técnico', null, async () => {
      const r = await perguntar(p, 'Quais são as multas previstas?');
      exigir(/indisponível agora/.test(r), 'mensagem inesperada: ' + r.slice(0, 200));
      exigir(!/API_KEY|GROQ|GEMINI|HTTP \d/.test(r), 'vazou mensagem técnica: ' + r);
    });

    await passo('Salvar pergunta: vira atalho, só o dono vê (RLS) e o ✕ apaga', null, async () => {
      await p.fill('#lp-chat-campo', 'Exige visita técnica?');
      await p.click('text=Salvar pergunta');
      await p.waitForSelector('.lp-plena-chip-salva .lp-chat-sugestao:has-text("Exige visita técnica?")', { timeout: 15000 });
      const meus = JSON.parse((await comoUsuario(seed.usuarios.gestor, '/rest/v1/ia_perguntas_salvas?select=texto')).corpo);
      exigir(meus.length === 1 && meus[0].texto === 'Exige visita técnica?', 'não gravou: ' + JSON.stringify(meus));
      const outro = JSON.parse((await comoUsuario(seed.usuarios.outra_org, '/rest/v1/ia_perguntas_salvas?select=id')).corpo);
      exigir(Array.isArray(outro) && outro.length === 0, 'outra conta vê a pergunta salva');
      await p.locator('#lp-chat-campo').fill('');
      await imprimir(p, '05-plena-pergunta-salva');
      await p.click('.lp-plena-chip-salva .lp-plena-apagar');
      await p.waitForFunction(() => !document.querySelector('.lp-plena-chip-salva'), null, { timeout: 15000 });
      exigir(JSON.parse((await comoUsuario(seed.usuarios.gestor, '/rest/v1/ia_perguntas_salvas?select=id')).corpo).length === 0, 'não apagou');
    });

    await passo('conversa geral com a tela: "o que vence hoje?" lê a conta sem "meu/minha"', null, async () => {
      await p.click('.lp-plena-alvo button[data-alvo="geral"]');
      const r = await perguntar(p, 'O que vence hoje?');
      exigir(/Processos em andamento|Prazos|Tarefas|Empresa/i.test(r), 'não leu os dados da conta: ' + r.slice(0, 300));
    });

    await passo('"não sei": oferece Enviar dúvida à equipe e Perguntar ao edital', null, async () => {
      await perguntar(p, 'Qual a capital da Mongólia?');
      const acoes = await ultimaIa(p).locator('.lp-plena-acoes button').allTextContents();
      exigir(acoes.includes('Enviar dúvida à equipe') && acoes.includes('Perguntar ao edital'), 'ações: ' + acoes.join(', '));
      await ultimaIa(p).locator('button', { hasText: 'Enviar dúvida à equipe' }).click();
      exigir(await p.locator('.lp-plena-duvida textarea').inputValue() === 'Qual a capital da Mongólia?', 'dúvida não veio preenchida');
      await imprimir(p, '06-plena-nao-sei');
    });

    await passo('Cancelar: corta a espera e avisa sem travar a conversa', null, async () => {
      await p.route('**/api/chat-ia', async (r) => { if (/"perguntar"/.test(r.request().postData() || '')) await new Promise((ok) => setTimeout(ok, 6000)); await r.continue().catch(() => {}); });
      await p.fill('#lp-chat-campo', 'Qual o prazo para apresentar recurso?');
      await p.click('.lp-chat-form button[type=submit]');
      await p.waitForSelector('.lp-plena-cancelar:not([hidden])', { timeout: 5000 });
      await p.click('.lp-plena-cancelar');
      await p.waitForFunction(() => /Pergunta cancelada/.test(document.querySelector('.lp-plena .lp-chat-lista')?.textContent || ''), null, { timeout: 5000 });
      exigir(!(await p.locator('.lp-chat-form button[type=submit]').isDisabled()), 'Enviar ficou travado');
      await p.unroute('**/api/chat-ia');
    });

    await passo('Ver resumo completo abre o Resumo do edital do painel', null, async () => {
      await p.locator('.lp-plena-cartao button', { hasText: 'Ver resumo completo' }).click();
      await p.waitForSelector('#modal-ia-fundo.aberto', { timeout: 10000 });
      await p.keyboard.press('Escape');
    });

    await passo('memória: a conversa continua em outra tela (Processos) e no dossiê do processo', null, async () => {
      await p.goto(`${SITE}/processos.html?empresa=${seed.ids.empA2}&processo=${PROCESSO}`);
      await p.waitForSelector('#chat-ia-btn');
      await p.click('#chat-ia-btn');
      await p.waitForSelector('.lp-plena .lp-plena-cartao', { timeout: 10000 });
      const lista = await p.textContent('.lp-plena .lp-chat-lista');
      exigir(/O que vence hoje\?/.test(lista) && /Pergunta cancelada/.test(lista), 'conversa não veio da outra tela');
      await p.click('.lp-plena .lp-gaveta-fechar');
      await p.waitForSelector('#modal-dossie [data-plena-processo]', { timeout: 20000 });
      await p.click('#modal-dossie [data-plena-processo]');
      await p.waitForFunction(() => document.querySelectorAll('.lp-plena .lp-plena-cartao').length >= 2, null, { timeout: 10000 });
      await p.waitForFunction(() => /Documentos lidos|Leitura parcial/.test([...document.querySelectorAll('.lp-plena-status')].pop()?.textContent || ''), null, { timeout: 30000 });
      await imprimir(p, '07-plena-no-dossie-do-processo');
    });

    await passo('tema escuro: gaveta da Plena e cartão', null, async () => {
      await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.classList.remove('tema-claro'); });
      await imprimir(p, '08-plena-escuro');
    });

    await passo('sem erro de página nem de console da Plena', null, async () => {
      const erros = p.erros.filter((e) => !/favicon|sw\.js|503 POST \/api\/ia-edital/.test(e));
      exigir(!erros.some((e) => /pageerror|chat-ia|Plena/.test(e)), erros.join(' | '));
      return erros.length ? 'avisos fora da Plena: ' + erros.slice(0, 5).join(' | ') : 'limpo';
    });
  } finally {
    await navegador.close();
    fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 1));
    console.log(JSON.stringify(resultados.map(({ n, nome, ok, notas }) => ({ n, nome, ok, notas })), null, 1));
    if (resultados.some((r) => !r.ok)) process.exitCode = 1;
  }
}

main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
