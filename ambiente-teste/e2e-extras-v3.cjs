/* global document, window -- usados só dentro de p.evaluate (rodam no navegador) */
// E2E local dos extras v3 (itens 7, 8 e 10 do mapa do Siga Pregão): edital aberto na tela, fornecedor com site,
// ajuda com lugar de vídeo e WhatsApp pela configuração, aviso do boletim no celular, pastas e .zip dos documentos,
// documentos escolhidos no processo, resumo de 1 página e peças da Lei 14.133 vindas do PNCP.
// Ambiente: subir.cjs (ou os SQL novos aplicados) + servidor.cjs rodando.
//   npm run build:cloudflare && PORTA_TESTE=8911 node ambiente-teste/servidor.cjs   (outro terminal)
//   SITE_TESTE=http://127.0.0.1:8911 node ambiente-teste/e2e-extras-v3.cjs
// Usa o PNCP de verdade (API pública) para o PDF e para 1 rodada curta do robô de peças. A IA do fornecedor é
// simulada (rota /api/fornecedor-ia), sem chave paga. Dados criados aqui levam "e2e-v3" e são apagados no fim.
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-extras-v3';
const { passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados, robo, AdmZip } = require('./e2e.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const { ids, usuarios: U } = seed;
// Edital real e público no PNCP (conferido em 20/11/2026): pedido de esclarecimento anexado como "Outros Documentos".
const PDF = '/api/pncp-baixar?cnpj=89971758000180&ano=2026&sequencial=1381&documento=10&nome=ESCLARECIMENTO';
const CAMINHO = `${ids.orgA}/${ids.empA1}/e2e-v3-cnd.pdf`;
const PDF_FICTICIO = Buffer.from('%PDF-1.4\n% documento ficticio e2e-v3\n%%EOF\n');
const ID_PECA = 'pncp-99999999000191-2026-1-1';

async function subirArquivo() {
  const r = await fetch(`${chaves.API_URL}/storage/v1/object/operacao-documentos/${CAMINHO}`, { method: 'POST',
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: `Bearer ${chaves.SERVICE_ROLE_KEY}`, 'content-type': 'application/pdf', 'x-upsert': 'true' }, body: PDF_FICTICIO });
  if (!r.ok) throw new Error(`upload: ${r.status} ${await r.text()}`);
}
function limpar() {
  psql(`delete from operacao_documentos where titulo='e2e-v3'; delete from pecas_juridicas where id='${ID_PECA}';`);
}

(async () => {
  fs.mkdirSync(PRINTS, { recursive: true });
  limpar();
  await subirArquivo();
  const docId = psql(`insert into operacao_documentos(organizacao_id,empresa_id,tipo,titulo,vencimento,arquivo_caminho,arquivo_nome)
    values ('${ids.orgA}','${ids.empA1}','CND Federal','e2e-v3',current_date+20,'${CAMINHO}','cnd.pdf') returning id;`).split('\n')[0];
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, U.gestor);
  await p.setViewportSize({ width: 1280, height: 900 });
  try {
    await passo('Edital aberto dentro da tela: PDF do PNCP inline, só pelo próprio site', p, async () => {
      await p.goto(SITE + '/painel.html');
      await p.waitForFunction(() => window.LicitaVisualizadorPdf, null, { timeout: 15000 });
      const h = await p.evaluate(async (u) => { const r = await fetch(`${u}&ver=1`); return { s: r.status, t: r.headers.get('content-type'), d: r.headers.get('content-disposition'), f: r.headers.get('content-security-policy') }; }, PDF);
      exigir(h.s === 200 && h.t === 'application/pdf' && /^inline/.test(h.d) && h.f === "frame-ancestors 'self'", `cabeçalhos: ${JSON.stringify(h)}`);
      await p.evaluate((u) => window.LicitaVisualizadorPdf.abrir(u, 'ESCLARECIMENTO PREGAO 106 2026'), PDF);
      await p.waitForSelector('.lp-pdf-fundo:not([hidden]) iframe', { timeout: 10000 });
      await p.waitForTimeout(3000);
      const src = await p.getAttribute('.lp-pdf-moldura', 'src');
      exigir(/ver=1$/.test(src), `iframe: ${src}`);
      await p.screenshot({ path: path.join(PRINTS, 'v3-01-edital-na-tela-1280.png') });
      exigir(await p.evaluate(() => window.LicitaVisualizadorPdf.abrir('https://evil.com/x.pdf', 'x')) === false, 'abriu link de fora');
      await p.click('.lp-pdf-fechar');
      return `${h.t} · ${h.d}`;
    });

    await passo('Fornecedor com IA: aderência, contato público, site provável e uso justo sem número', p, async () => {
      await p.route('**/api/fornecedor-ia', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ analise: 'dados', maisDisponiveis: false, uso: { usadas: 2, limite: 3 },
        fornecedores: [{ cnpj: '11222333000181', nome: 'PAPELARIA FICTICIA LTDA', contratos: 4, valorTotal: 12000, ufsAtuacao: ['AM'], exemplos: [], aderencia: 92, porque: 'Já forneceu papel A4.', analisePor: 'dados',
          contato: { telefone: '(92) 3333-4444', email: 'vendas@papelariaficticia.com.br', site: 'https://papelariaficticia.com.br', mei: false }, municipio: 'MANAUS', uf: 'AM', situacao: 'ATIVA' },
        { cnpj: '11444777000161', nome: 'OUTRA FICTICIA LTDA', contratos: 1, valorTotal: 500, ufsAtuacao: [], exemplos: [], aderencia: 60, porque: 'Objeto parecido.', analisePor: 'dados',
          contato: { telefone: null, email: null, site: null, mei: false }, municipio: null, uf: null, situacao: 'ATIVA' }] }) }));
      await p.evaluate(() => window.abrirFornecedorIA('papel sulfite A4'));
      await p.click('.lp-gaveta-rodape .lp-primario');
      await p.waitForSelector('.lp-cartao', { timeout: 10000 });
      const t = await p.innerText('.lp-gaveta-fundo:not([hidden]) .lp-gaveta');
      exigir(/Aderência 92%/.test(t) && /Telefone \(92\) 3333-4444/.test(t) && /papelariaficticia\.com\.br \(provável: domínio do e-mail na Receita\)/.test(t), `cartão: ${t.slice(0, 400)}`);
      exigir(/Não localizado · Procurar no Google/.test(t) && /IA à vontade, com uso justo/.test(t) && !/2 de 3|perguntas diárias/.test(t), 'sem busca no Google ou com contador de cota');
      await p.locator('.lp-gaveta-fundo:not([hidden]) .lp-gaveta').screenshot({ path: path.join(PRINTS, 'v3-02-fornecedor-site-1280.png') });
      await p.keyboard.press('Escape');
      return 'site provável, contato, aderência e "uso justo" sem número';
    });

    await passo('Ajuda: botão "Falar no WhatsApp" com o número do suporte de supabase-config.js', p, async () => {
      // O servidor local serve um supabase-config.js próprio (URL/chave locais), sem o número: entra aqui o do arquivo real.
      const numero = (fs.readFileSync(path.join(__dirname, '..', 'supabase-config.js'), 'utf8').match(/LICITAPLENA_WHATSAPP_SUPORTE = "(\d*)"/) || [])[1];
      exigir(numero === '5592981937781', `número do suporte: ${numero}`);
      await p.evaluate((n) => { window.LICITAPLENA_WHATSAPP_SUPORTE = n; window.LicitaPlenaAjuda.abrir(); }, numero);
      await p.waitForSelector('.lp-gaveta-fundo:not([hidden]) .lp-lista-tutoriais', { timeout: 10000 });
      const t = await p.innerText('.lp-gaveta-fundo:not([hidden]) .lp-gaveta');
      const href = await p.getAttribute('.lp-gaveta-fundo:not([hidden]) a:has-text("Falar no WhatsApp")', 'href');
      exigir(!/em breve/i.test(t) && href && href.startsWith(`https://wa.me/${numero}?text=`) && /Mandar dúvida à equipe/.test(t), `ajuda: ${href} ${t.slice(0, 300)}`);
      await p.locator('.lp-gaveta-fundo:not([hidden]) .lp-gaveta').screenshot({ path: path.join(PRINTS, 'v3-03-ajuda-video-whatsapp-1280.png') });
      await p.keyboard.press('Escape');
      return 'sem "em breve" · "Falar no WhatsApp" abre wa.me/' + numero + ' · "Mandar dúvida" presente';
    });

    await passo('Celular: tipo "Oportunidade nova no boletim" nas preferências de aviso', p, async () => {
      await p.evaluate(() => window.LicitaPlenaCelular.abrir());
      await p.waitForSelector('text=Oportunidade nova no boletim', { timeout: 10000 });
      await p.screenshot({ path: path.join(PRINTS, 'v3-04-aviso-boletim-1280.png') });
      await p.keyboard.press('Escape');
      return 'tipo boletim na gaveta de avisos';
    });

    await passo('Central de documentos: pasta no documento, filtro e .zip com a pasta', p, async () => {
      await p.goto(SITE + '/operacao.html');
      await p.waitForSelector('#empresa-atual option', { state: 'attached', timeout: 20000 });
      await p.selectOption('#empresa-atual', ids.empA1);
      const campo = p.locator(`#lista-documentos tr:has(input[data-id="${docId}"]) .lp-pasta-campo`);
      await campo.waitFor({ timeout: 20000 });
      await campo.fill('Fiscal e2e'); await campo.press('Enter'); await campo.blur();
      await p.waitForFunction(() => /pasta Fiscal e2e/.test(document.getElementById('lp-zip-status')?.textContent || ''), null, { timeout: 10000 });
      const banco = psql(`select pasta from operacao_documento_pastas where documento_id='${docId}';`);
      exigir(banco === 'Fiscal e2e', `pasta no banco: "${banco}"`);
      await p.selectOption('#lp-pasta-filtro', 'Fiscal e2e');
      const visiveis = await p.locator('#lista-documentos tr:not([hidden])').count();
      exigir(visiveis === 1, `filtro mostrou ${visiveis} linha(s)`);
      const [baixado] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('text=Baixar .zip')]);
      const destino = path.join(PRINTS, 'v3-documentos.zip');
      await baixado.saveAs(destino);
      const nomes = new AdmZip(destino).getEntries().map((e) => e.entryName);
      exigir(nomes.length === 1 && nomes[0] === 'Fiscal e2e/CND Federal - e2e-v3.pdf', `zip: ${nomes.join(', ')}`);
      exigir(new AdmZip(destino).readFile(nomes[0]).equals(PDF_FICTICIO), 'arquivo do zip diferente do enviado');
      await p.screenshot({ path: path.join(PRINTS, 'v3-05-pastas-zip-1280.png') });
      fs.rmSync(destino);
      return `${nomes[0]} · filtro 1 linha`;
    });

    await passo('Processo: escolher documento salvo, conferir no banco e baixar o .zip', p, async () => {
      await p.goto(`${SITE}/sistema?empresa=${ids.empA1}&processo=${ids.procA}`);
      await p.waitForSelector('#processo-documentos h2', { timeout: 30000 });
      await p.click('#processo-documentos summary');
      await p.check(`#processo-documentos input[value="${docId}"]`);
      await p.click('#processo-documentos >> text=Salvar escolha');
      await p.waitForFunction(() => /Escolha salva/.test(document.querySelector('#processo-documentos [aria-live]')?.textContent || ''), null, { timeout: 10000 });
      const banco = psql(`select count(*) from operacao_processo_documentos where processo_id='${ids.procA}' and documento_id='${docId}';`);
      exigir(banco === '1', `vínculo no banco: ${banco}`);
      const t = await p.innerText('#processo-documentos');
      exigir(/CND Federal/.test(t) && /Fiscal e2e/.test(t) && /(Válido até|Vence em)/.test(t), `cartão: ${t.slice(0, 300)}`);
      const [baixado] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#processo-documentos >> text=Baixar .zip')]);
      exigir(baixado.suggestedFilename() === 'documentos-do-processo.zip', baixado.suggestedFilename());
      await p.locator('#processo-documentos').screenshot({ path: path.join(PRINTS, 'v3-06-processo-documentos-1280.png') });
      return t.replace(/\s+/g, ' ').slice(0, 200);
    });

    await passo('Resumo do processo em 1 página para imprimir', p, async () => {
      const href = await p.getAttribute('#processo-documentos a[href^="resumo-processo.html"]', 'href');
      await p.goto(`${SITE}/${href}`);
      await p.waitForSelector('#resumo h1', { timeout: 20000 });
      const t = await p.innerText('#resumo');
      const falta = ['FICHA', 'PREÇO', 'DOCUMENTOS ESCOLHIDOS', 'CND Federal'].filter((x) => !t.toUpperCase().includes(x.toUpperCase()));
      exigir(!falta.length && !/undefined|NaN/.test(t), `resumo sem: ${falta.join(', ')} ${/undefined|NaN/.test(t) ? '(tem undefined/NaN)' : ''}`);
      await p.screenshot({ path: path.join(PRINTS, 'v3-07-resumo-tela-1280.png'), fullPage: true });
      await p.emulateMedia({ media: 'print' });
      const alto = await p.evaluate(() => document.getElementById('resumo').scrollHeight);
      await p.screenshot({ path: path.join(PRINTS, 'v3-08-resumo-impressao.png'), fullPage: true });
      await p.emulateMedia({ media: 'screen' });
      // A4 a 96 dpi, sem as margens de 10 mm: ~1047 px de altura útil.
      exigir(alto <= 1100, `resumo passa de 1 página na impressão: ${alto}px`);
      return `altura na impressão ${alto}px`;
    });

    await passo('Celular 375: processo e resumo sem rolagem horizontal', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 });
      const larguras = [];
      for (const url of [`${SITE}/sistema?empresa=${ids.empA1}&processo=${ids.procA}`, `${SITE}/resumo-processo.html?empresa=${ids.empA1}&processo=${ids.procA}`]) {
        await p.goto(url);
        await p.waitForSelector(url.includes('resumo') ? '#resumo h1' : '#processo-documentos h2', { timeout: 30000 });
        const { largura, janela } = await p.evaluate(() => ({ largura: document.documentElement.scrollWidth, janela: window.innerWidth }));
        await p.screenshot({ path: path.join(PRINTS, `v3-09-${url.includes('resumo') ? 'resumo' : 'processo'}-375.png`) });
        exigir(largura <= janela, `rolagem horizontal em ${url}: ${largura} > ${janela}`);
        larguras.push(largura);
      }
      await p.setViewportSize({ width: 1280, height: 900 });
      return larguras.join(' / ');
    });

    await passo('Peças 14.133: robô lê o PNCP (rodada curta) e o Jurídico mostra "Abrir no PNCP"', p, async () => {
      psql("delete from dados_robo where chave='pecas_juridicas_pncp_cursor';");
      const r = robo('coletar_pecas_pncp.js', { ORCAMENTO_PEDIDOS: '6', LIMITE_MINUTOS: '1', PECAS_PNCP_DIA_INICIAL: '2026-11-10', PAUSA_MS: '1000' });
      exigir(r.status === 0 && /\[pecas-pncp\] \d+ peças gravadas, \d+ pedidos; cursor 2026-11-1\d/.test(r.saida), `robô: ${r.saida}`);
      const cursor = psql("select dado->>'dia' from dados_robo where chave='pecas_juridicas_pncp_cursor';");
      psql(`insert into pecas_juridicas(id,tipo,texto,orgao,lei,url,data,busca) values ('${ID_PECA}','impugnacao','Impugnação fictícia e2e-v3 sobre exigência de amostra.','MUNICIPIO FICTICIO','14133',
        'https://pncp.gov.br/app/editais/99999999000191/2026/1','2026-11-19','impugnacao ficticia e2e-v3 sobre exigencia de amostra municipio ficticio');`);
      await p.goto(SITE + '/painel.html#juridico');
      // Tela nova do Jurídico (c6064f5): abas e filtro de lei em <select> no lugar do checkbox 14.133.
      await p.waitForSelector('#juridico-central .jur-abas', { timeout: 20000 });
      await p.click('#jur-aba-banco');
      await p.fill('#jur-banco-palavras', 'amostra');
      await p.selectOption('#jur-banco-lei', '14133');
      await p.click('#jur-painel-banco .jur-primario');
      await p.waitForSelector('#jur-painel-banco a:has-text("Abrir no PNCP")', { timeout: 20000 });
      await p.locator('#juridico').screenshot({ path: path.join(PRINTS, 'v3-10-pecas-pncp-1280.png') });
      return `${r.saida.trim().split('\n').pop()} · cursor salvo: ${cursor}`;
    });

    await passo('erros de página', null, async () => {
      const graves = p.erros.filter((e) => /pageerror/.test(e));
      exigir(!graves.length, graves.join(' | '));
      return `${p.erros.length} aviso(s) de rede/console (não fatais)`;
    });
  } finally {
    limpar();
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 2));
  console.log(falhas.length ? `FALHOU: ${falhas.map((f) => f.nome).join('; ')}` : 'OK');
  process.exit(falhas.length ? 1 : 0);
})();
