/* global document, window -- usado só dentro de p.evaluate/waitForFunction (roda no navegador) */
// Pente fino: Minhas empresas e documentos, Jurídico & Dúvidas, Status das Ferramentas, admin (só administrador) e páginas legais.
//   PORTA_TESTE=8814 node ambiente-teste/servidor.cjs   (outro terminal; subir.cjs antes)
//   PORTA_TESTE=8814 PRINTS=<pasta> node ambiente-teste/e2e-pente-fino-empresas.cjs
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const fs = require('node:fs');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/pente-fino/prints-empresas';
const { banco, comoUsuario, passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');

const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
// Jargão de sistema que não pode aparecer para o cliente.
const JARGAO = /Supabase|\bSQL\b|\bJSON\b|\bRPC\b|row-level|violates|undefined|\[object|(?-i:\bNaN\b)|fail-open|migração|\.sql\b|\bapp\b/i;
const linha = (p, texto) => p.locator('#lista-documentos tr', { hasText: texto });

async function login(navegador, u) {
  const p = await novaPagina(navegador);
  await p.goto(SITE + '/login.html'); await p.fill('#email', u.email); await p.fill('#senha', u.senha);
  await Promise.all([p.waitForURL(/painel.html|sistema/, { timeout: 60000, waitUntil: 'commit' }), p.click('#btn-entrar')]);
  return p;
}
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const textoVisivel = (p) => p.evaluate(() => document.body.innerText);
async function abrirOperacao(p, empresaId) {
  await p.goto(`${SITE}/operacao.html?aba=documentos`);
  await p.waitForSelector('#empresa-atual option', { state: 'attached', timeout: 20000 });
  if (empresaId) await p.selectOption('#empresa-atual', empresaId).catch(() => {});
  await p.waitForSelector('#lista-documentos tr', { timeout: 20000 }); await p.waitForTimeout(1500);
}
async function enviar(p, titulo, arquivo) {
  await p.click('#btn-novo-documento-2');
  await p.selectOption('#doc-tipo', 'Alvará / licença');
  await p.fill('#form-documento [name=titulo]', titulo);
  await p.fill('#form-documento [name=vencimento]', new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10));
  await p.setInputFiles('#form-documento [name=arquivo]', arquivo);
  await p.click('#btn-salvar-documento');
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  const { usuarios: U, ids } = seed;
  const criados = [];
  try {
    const p = await login(navegador, U.gestor);
    await passo('empresas: todas as abas abrem sem erro e sem texto técnico (1280 e 375)', p, async () => {
      await abrirOperacao(p, ids.empA1);
      for (const largura of [1280, 375]) {
        await p.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 });
        for (const aba of ['identificacao', 'documentos', 'catalogo', 'agenda', 'relatorio']) {
          await p.click(`.aba[data-aba="${aba}"]`); await p.waitForTimeout(1200);
          exigir(await p.locator(`#aba-${aba}.ativo`).count() === 1, 'aba não abriu: ' + aba);
          const t = await textoVisivel(p);
          exigir(!JARGAO.test(t), `texto técnico na aba ${aba}: ${(t.match(JARGAO) || [])[0]}`);
          exigir(await semRolagem(p), `rolagem lateral em ${largura}px na aba ${aba}`);
          await p.screenshot({ path: path.join(PRINTS, `empresas-${aba}-${largura}.png`), fullPage: true });
        }
      }
      await p.setViewportSize({ width: 1366, height: 900 });
      await p.click('.aba[data-aba="documentos"]');
      exigir(/11\.222\.333\/0001-81/.test(await p.innerText('#empresa-atual')), 'CNPJ sem máscara no seletor');
      exigir(!/Histórico de renovações|próxima fatia/.test(await textoVisivel(p)), 'card de promessa ainda na tela');
    });
    await passo('empresas: métricas batem com os documentos (conta à mão)', p, async () => {
      const docs = await banco(`operacao_documentos?empresa_id=eq.${ids.empA1}&select=vencimento`);
      const hoje = new Date(new Date().toDateString());
      const dias = (v) => Math.ceil((new Date(`${v}T12:00:00`) - hoje) / 864e5);
      const esperado = { v: docs.filter(d => d.vencimento && dias(d.vencimento) > 30).length, p: docs.filter(d => d.vencimento && dias(d.vencimento) >= 0 && dias(d.vencimento) <= 30).length, x: docs.filter(d => d.vencimento && dias(d.vencimento) < 0).length };
      const tela = { v: +await p.innerText('#m-validos'), p: +await p.innerText('#m-proximos'), x: +await p.innerText('#m-vencidos') };
      exigir(JSON.stringify(tela) === JSON.stringify(esperado), `métricas ${JSON.stringify(tela)} x banco ${JSON.stringify(esperado)}`);
      return JSON.stringify(tela);
    });
    await passo('empresas: upload aceita PDF, JPG e PNG; recusa .txt e arquivo acima de 10 MB', p, async () => {
      for (const [nome, mime, buf] of [['a.pdf', 'application/pdf', PDF], ['b.jpg', 'image/jpeg', JPG], ['c.png', 'image/png', PNG]]) {
        const titulo = `PF-E2E ${nome}`;
        await enviar(p, titulo, { name: nome, mimeType: mime, buffer: buf });
        await linha(p, titulo).waitFor({ timeout: 15000 });
        exigir(await linha(p, titulo).locator('.btn-arquivo').count() === 1, 'sem arquivo: ' + nome);
        const [reg] = await banco(`operacao_documentos?titulo=eq.${encodeURIComponent(titulo)}&select=id,arquivo_caminho`);
        exigir(reg?.arquivo_caminho, 'não gravou ' + nome); criados.push(reg.id);
      }
      for (const [nome, mime, buf] of [['x.txt', 'text/plain', Buffer.from('oi')], ['grande.pdf', 'application/pdf', Buffer.alloc(10 * 1024 * 1024 + 10, 32)]]) {
        const titulo = `PF-E2E RUIM ${nome}`;
        await enviar(p, titulo, { name: nome, mimeType: mime, buffer: buf });
        await p.waitForSelector('#aviso.erro:has-text("PDF, JPG ou PNG de até 10 MB")', { timeout: 10000 });
        exigir((await banco(`operacao_documentos?titulo=eq.${encodeURIComponent(titulo)}&select=id`)).length === 0, 'gravou arquivo inválido ' + nome);
        await p.click('[data-fechar=modal-documento]');
      }
      await p.screenshot({ path: path.join(PRINTS, 'empresas-upload.png'), fullPage: true });
    });
    await passo('empresas: Abrir arquivo, PDF único e .zip funcionam', p, async () => {
      const [nova] = await Promise.all([p.context().waitForEvent('page', { timeout: 10000 }), linha(p, 'PF-E2E a.pdf').locator('.btn-arquivo').click()]);
      exigir(/\/storage\/v1\/object\/sign\//.test(nova.url()), 'arquivo abriu em: ' + nova.url()); await nova.close();
      await linha(p, 'PF-E2E a.pdf').locator('.pdf-marca input').check();
      await linha(p, 'PF-E2E c.png').locator('.pdf-marca input').check();
      exigir(/\(2\)/.test(await p.innerText('#btn-pdf-unico')), 'contador do PDF único');
      await p.route('https://cdnjs.cloudflare.com/**', r => r.continue());
      const [pdf] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#btn-pdf-unico')]);
      exigir(pdf.suggestedFilename() === 'documentos-habilitacao.pdf', 'nome do PDF');
      const [zip] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('button:has-text("Baixar .zip")')]);
      exigir(/\.zip$/.test(zip.suggestedFilename()), 'nome do zip');
      exigir(/baixado com 2/.test(await p.innerText('#lp-zip-status')), 'status zip: ' + await p.innerText('#lp-zip-status'));
    });
    await passo('empresas: pasta do documento, editar e excluir', p, async () => {
      const campo = linha(p, 'PF-E2E b.jpg').locator('.lp-pasta-campo');
      await campo.fill('Fiscais'); await campo.press('Tab');
      await p.waitForSelector('#lp-zip-status:has-text("pasta Fiscais")', { timeout: 10000 });
      await linha(p, 'PF-E2E b.jpg').locator('.btn-editar').click();
      exigir(await p.inputValue('#form-documento [name=titulo]') === 'PF-E2E b.jpg', 'editar não preencheu');
      await p.fill('#form-documento [name=vencimento]', '2020-01-01'); await p.click('#btn-salvar-documento');
      await linha(p, 'PF-E2E b.jpg').locator('.tag', { hasText: 'Vencido' }).waitFor({ timeout: 15000 });
      for (const t of ['PF-E2E a.pdf', 'PF-E2E b.jpg', 'PF-E2E c.png']) {
        p.once('dialog', d => d.accept());
        await linha(p, t).locator('.btn-excluir').click();
        await p.waitForFunction((x) => !document.querySelector('#lista-documentos').innerText.includes(x), t, { timeout: 15000 });
      }
      exigir((await banco(`operacao_documentos?id=in.(${criados.join(',')})&select=id`)).length === 0, 'sobrou no banco');
    });
    await passo('empresas: agenda grava compromisso com categoria em português', p, async () => {
      await p.click('.aba[data-aba="agenda"]'); await p.click('#btn-novo-evento');
      await p.selectOption('#form-evento [name=categoria]', 'impugnacao');
      await p.fill('#form-evento [name=titulo]', 'PF-E2E prazo de impugnação');
      await p.fill('#form-evento [name=vencimento]', new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 16));
      await p.click('#form-evento button.primario');
      const ev = p.locator('.evento', { hasText: 'PF-E2E prazo de impugnação' });
      await ev.waitFor({ timeout: 15000 });
      exigir(/Impugnação/.test(await ev.innerText()) && !/impugnacao/.test(await ev.innerText()), 'categoria crua: ' + await ev.innerText());
      await p.screenshot({ path: path.join(PRINTS, 'empresas-agenda.png'), fullPage: true });
      const regs = await banco(`operacao_agenda?titulo=eq.${encodeURIComponent('PF-E2E prazo de impugnação')}&select=id`);
      for (const r of regs) await fetch(`${chaves.API_URL}/rest/v1/operacao_agenda?id=eq.${r.id}`, { method: 'DELETE', headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY } });
    });
    await passo('empresas: catálogo de produtos abre com o Catálogo em PDF', p, async () => {
      await p.click('.aba[data-aba="catalogo"]'); await p.waitForTimeout(1500);
      const t = await p.innerText('#aba-catalogo');
      exigir(/Catálogo/.test(t) && !JARGAO.test(t), 'catálogo: ' + t.slice(0, 200));
      exigir(await p.locator('#aba-catalogo button:has-text("PDF")').count() >= 1, 'sem botão Catálogo em PDF');
    });
    await passo('empresas: console sem erro de JavaScript', p, async () => {
      const js = p.erros.filter(e => /pageerror|console/.test(e) && !/Failed to load resource|favicon|challenges\.cloudflare|turnstile/i.test(e));
      exigir(!js.length, js.join(' | '));
    });

    const pl = await login(navegador, U.leitura);
    await passo('permissão: papel leitura vê, mas não tem botão de alterar e o banco recusa', pl, async () => {
      await abrirOperacao(pl, ids.empA1);
      exigir(await pl.locator('#aviso-leitura').isVisible(), 'sem aviso de só consulta');
      for (const sel of ['#btn-novo-documento-2', '.btn-editar', '.btn-excluir', '#btn-nova-empresa', '[data-carregar]']) exigir(await pl.locator(sel).first().isVisible().catch(() => false) === false, 'botão visível para leitura: ' + sel);
      await pl.click('.aba[data-aba="catalogo"]'); await pl.waitForTimeout(1500);
      exigir(!await pl.locator('#aba-catalogo button:has-text("+ Produto")').isVisible(), 'leitura vê + Produto');
      const r = await comoUsuario(U.leitura, '/rest/v1/operacao_documentos', { method: 'POST', body: JSON.stringify({ organizacao_id: ids.orgA, empresa_id: ids.empA1, tipo: 'SICAF', titulo: 'PF-E2E leitura' }) });
      exigir(r.status >= 400, 'leitura gravou documento: ' + r.status);
      await pl.screenshot({ path: path.join(PRINTS, 'permissao-leitura.png'), fullPage: true });
    });
    const pb = await login(navegador, U.outra_org);
    await passo('permissão: outra empresa não vê os documentos nem as empresas da organização A', pb, async () => {
      await abrirOperacao(pb);
      const t = await pb.innerText('#empresa-atual');
      exigir(!/Papelaria Aurora|Materiais Horizonte/.test(t), 'outra org vê empresa A: ' + t);
      exigir(!/fictício\)/.test(await pb.innerText('#lista-documentos')), 'outra org vê documento da A');
      const r = await comoUsuario(U.outra_org, `/rest/v1/operacao_documentos?empresa_id=eq.${ids.empA1}&select=id`);
      exigir(r.corpo === '[]', 'REST devolveu documento da A: ' + r.corpo.slice(0, 100));
    });
    const po = await login(navegador, U.operador);
    await passo('permissão: operador vinculado só enxerga a empresa dele', po, async () => {
      await abrirOperacao(po);
      const opcoes = await po.locator('#empresa-atual option').allInnerTexts();
      exigir(opcoes.length === 1 && /Papelaria Aurora/.test(opcoes[0]), 'opções: ' + opcoes.join(' / '));
      exigir(!await po.locator('#btn-nova-empresa').isVisible(), 'operador vê + Empresa');
    });

    await passo('painel: Jurídico & Dúvidas e Status das Ferramentas sem texto técnico', p, async () => {
      await p.goto(SITE + '/painel.html#juridico'); await p.waitForTimeout(3000);
      await p.evaluate(() => document.querySelector('nav button[data-alvo="juridico"]')?.click()); await p.waitForTimeout(1500);
      const j = await p.innerText('#juridico');
      exigir(/Perguntas, modelos/.test(j) && !JARGAO.test(j) && !/não há robô de lances|revisão jurídica pendente/.test(j), 'jurídico: ' + (j.match(JARGAO) || [j.slice(0, 120)])[0]);
      await p.screenshot({ path: path.join(PRINTS, 'juridico-1280.png'), fullPage: false });
      await p.evaluate(() => document.querySelector('nav button[data-alvo="status"]')?.click());
      await p.waitForFunction(() => !/Verificando/.test(document.querySelector('#status-cartoes').innerText), null, { timeout: 30000 });
      const s = await p.innerText('#status');
      exigir(!JARGAO.test(s) && !/base válida|robô|UF\(s\)|Sem leitura/.test(s), 'status: ' + s.slice(0, 300));
      await p.click('#status-atualizar'); await p.waitForTimeout(2000);
      await p.screenshot({ path: path.join(PRINTS, 'status-1280.png'), fullPage: false });
      await p.setViewportSize({ width: 375, height: 812 }); await p.waitForTimeout(400);
      exigir(await semRolagem(p), 'rolagem lateral no status 375');
      await p.screenshot({ path: path.join(PRINTS, 'status-375.png'), fullPage: false });
      await p.setViewportSize({ width: 1366, height: 900 });
    });

    await passo('admin: conta de cliente comum não entra no painel do dono', null, async () => {
      const pa = await novaPagina(navegador);
      await pa.goto(SITE + '/admin.html');
      await pa.fill('#admin-email', U.gestor.email); await pa.fill('#admin-senha', U.gestor.senha);
      await pa.click('#form-login-admin button[type=submit]');
      await pa.waitForSelector('#erro-login-admin:has-text("não tem acesso")', { timeout: 30000 });
      exigir(!await pa.locator('#painel').isVisible(), 'painel admin apareceu para cliente');
      const r = await comoUsuario(U.gestor, '/rest/v1/rpc/admin_listar_contas', { method: 'POST', body: '{}' });
      exigir(r.status >= 400 || r.corpo === '[]', 'cliente listou contas: ' + r.status + ' ' + r.corpo.slice(0, 80));
      await pa.screenshot({ path: path.join(PRINTS, 'admin-recusa-cliente.png') });
      await pa.context().close();
    });

    await passo('páginas legais: links funcionam, dados da empresa e sem rolagem lateral', null, async () => {
      const pg = await novaPagina(navegador);
      for (const nome of ['termos-de-uso', 'politica-privacidade', 'politica-cookies']) {
        for (const largura of [1280, 375]) {
          await pg.setViewportSize({ width: largura, height: 900 });
          await pg.goto(`${SITE}/${nome}.html`);
          const t = await textoVisivel(pg);
          exigir(/HCM LTDA, CNPJ nº 28\.786\.260\/0001-53/.test(t), 'sem dados da empresa em ' + nome);
          exigir(!/undefined|�|\{\{/.test(t), 'texto quebrado em ' + nome);
          exigir(await semRolagem(pg), `rolagem lateral em ${nome} ${largura}`);
          await pg.screenshot({ path: path.join(PRINTS, `${nome}-${largura}.png`), fullPage: true });
        }
        const links = await pg.$$eval('a[href]', as => as.map(a => a.href).filter(h => h.startsWith(location.origin)));
        for (const l of links) { const r = await fetch(l); exigir(r.ok, `link ${l} -> ${r.status}`); }
      }
      exigir(!pg.erros.filter(e => /pageerror/.test(e)).length, pg.erros.join(' | '));
    });
  } finally {
    await navegador.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : 'E2E PENTE FINO EMPRESAS OK');
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
