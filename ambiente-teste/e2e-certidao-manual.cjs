/* global document -- usado só dentro de p.waitForFunction (roda no navegador) */
// E2E: adicionar, ver na lista, editar e excluir certidão manualmente em "Minhas empresas e documentos".
//   PORTA_TESTE=8788 node ambiente-teste/servidor.cjs   (outro terminal)
//   SITE_TESTE=http://127.0.0.1:8788 PRINTS=<pasta> node ambiente-teste/e2e-certidao-manual.cjs
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { banco, passo, exigir, novaPagina, seed, SITE, PRINTS } = require('./e2e.cjs');

const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const linha = (p, texto) => p.locator('#lista-documentos tr', { hasText: texto });

async function main() {
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  const { usuarios: U, ids } = seed;
  const p = await novaPagina(navegador);
  await p.goto(SITE + '/login.html'); await p.fill('#email', U.gestor.email); await p.fill('#senha', U.gestor.senha); // Turnstile pode demorar mais que os 20 s do entrar()
  await Promise.all([p.waitForURL(/painel.html|sistema/, { timeout: 60000, waitUntil: 'commit' }), p.click('#btn-entrar')]);
  fs.mkdirSync(PRINTS, { recursive: true });
  const ok = [];
  try {
    await passo('abre a tela e o botão grande aparece', p, async () => {
      await p.goto(`${SITE}/operacao.html?aba=documentos`);
      await p.waitForSelector('#empresa-atual', { timeout: 20000 });
      await p.selectOption('#empresa-atual', ids.empA1); await p.waitForTimeout(2500);
      exigir(await p.locator('#btn-novo-documento-2').isVisible(), 'botão não visível');
      exigir(/Adicionar certidão ou documento/.test(await p.innerText('#btn-novo-documento-2')), 'texto do botão');
    });
    await passo('adiciona certidão com arquivo PDF', p, async () => {
      await p.click('#btn-novo-documento-2');
      await p.selectOption('#doc-tipo', 'FGTS');
      await p.fill('#form-documento [name=titulo]', 'CRF 2026-E2E');
      await p.fill('#form-documento [name=emissao]', '2026-11-01');
      const venc = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
      await p.fill('#form-documento [name=vencimento]', venc);
      await p.fill('#form-documento [name=observacoes]', 'teste e2e');
      await p.setInputFiles('#form-documento [name=arquivo]', { name: 'crf.pdf', mimeType: 'application/pdf', buffer: PDF });
      await p.screenshot({ path: path.join(PRINTS, '1-formulario-aberto.png') });
      await p.click('#btn-salvar-documento');
      await linha(p, 'CRF 2026-E2E').waitFor({ timeout: 15000 });
      const l = linha(p, 'CRF 2026-E2E');
      exigir(/Válido/.test(await l.locator('.tag').innerText()), 'sem semáforo de validade: ' + await l.innerText());
      exigir(await l.locator('.btn-arquivo').count() === 1, 'sem arquivo');
      const [reg] = await banco(`operacao_documentos?titulo=eq.CRF 2026-E2E&select=id,tipo,arquivo_caminho`);
      exigir(reg && reg.tipo === 'FGTS' && reg.arquivo_caminho, 'registro no banco: ' + JSON.stringify(reg));
      ok.push(reg.id);
      await p.screenshot({ path: path.join(PRINTS, '2-lista-com-certidao.png'), fullPage: true });
    });
    await passo('arquivo inválido (txt) é recusado', p, async () => {
      await p.click('#btn-novo-documento-2');
      await p.fill('#form-documento [name=titulo]', 'RUIM-E2E');
      await p.setInputFiles('#form-documento [name=arquivo]', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('oi') });
      await p.click('#btn-salvar-documento');
      await p.waitForSelector('#aviso.erro, #aviso:has-text("PDF, JPG ou PNG")', { timeout: 8000 });
      exigir((await banco(`operacao_documentos?titulo=eq.RUIM-E2E&select=id`)).length === 0, 'gravou arquivo inválido');
      await p.click('[data-fechar=modal-documento]');
    });
    await passo('edita a certidão (vencimento e observação)', p, async () => {
      await linha(p, 'CRF 2026-E2E').locator('.btn-editar').click();
      exigir(await p.inputValue('#form-documento [name=titulo]') === 'CRF 2026-E2E', 'form não preencheu');
      await p.fill('#form-documento [name=vencimento]', '2020-01-01');
      await p.fill('#form-documento [name=observacoes]', 'editado');
      await p.click('#btn-salvar-documento');
      await linha(p, 'CRF 2026-E2E').locator('.tag', { hasText: 'Vencido' }).waitFor({ timeout: 15000 });
      const [reg] = await banco(`operacao_documentos?id=eq.${ok[0]}&select=observacoes,vencimento,arquivo_caminho`);
      exigir(reg.observacoes === 'editado' && reg.vencimento === '2020-01-01' && reg.arquivo_caminho, 'edição não gravou/perdeu arquivo');
    });
    await passo('exclui a certidão', p, async () => {
      p.once('dialog', d => d.accept());
      await linha(p, 'CRF 2026-E2E').locator('.btn-excluir').click();
      await p.waitForFunction(() => !/CRF 2026-E2E/.test(document.querySelector('#lista-documentos').innerText), null, { timeout: 15000 });
      exigir((await banco(`operacao_documentos?id=eq.${ok[0]}&select=id`)).length === 0, 'ainda no banco');
    });
    // Quadro estilo SICAF. Chamadas externas com dublê: a API do SICAF (rota /api) e o site oficial do TST.
    const secao = (tipo) => p.locator(`.secao-sicaf[data-secao="${tipo}"]`);
    await passo('quadro SICAF mostra as seções com situação e botões', p, async () => {
      exigir(await p.locator('.secao-sicaf').count() === 8, 'seções: ' + await p.locator('.secao-sicaf').count());
      for (const t of ['Certidão Federal', 'FGTS', 'CNDT']) exigir(await secao(t).locator('[data-emitir]').count() === 1 && await secao(t).locator('[data-carregar]').count() === 1, 'botões de ' + t);
      exigir(await secao('Certidão Estadual').locator('[data-emitir]').count() === 0, 'estadual não tem emissão assistida');
      // O seed usa nomes antigos ("CND Federal", "FGTS (CRF)", "Certidão Trabalhista (CNDT)", "CND Estadual"): o quadro os reconhece.
      const tag = async (t) => secao(t).locator('.tag').innerText();
      exigir(/Vencida/.test(await tag('Certidão Federal')), 'CND Federal antiga: ' + await tag('Certidão Federal'));
      exigir(/Vencendo/.test(await tag('FGTS')), 'FGTS (CRF) antigo: ' + await tag('FGTS'));
      exigir(/Válida/.test(await tag('CNDT')), 'CNDT antiga: ' + await tag('CNDT'));
      exigir(/Vencendo/.test(await tag('Certidão Estadual')), 'CND Estadual antiga: ' + await tag('Certidão Estadual'));
      exigir(/Não enviada/.test(await tag('Certidão Municipal')), 'municipal deveria estar não enviada');
      // Prontidão e checklist também contam os nomes antigos (só a CNDT do seed está válida: 1 de 7).
      exigir(await p.innerText('#m-prontidao') === '14%', 'prontidão: ' + await p.innerText('#m-prontidao'));
      const item = async (t) => p.locator('#checklist p', { hasText: t }).first().locator('.tag').innerText();
      exigir(/Vencido/.test(await item('Certidão Federal')) && /Vence em/.test(await item('FGTS')) && /Válido/.test(await item('CNDT')) && /Sem vencimento/.test(await item('Contrato social')), 'checklist com nomes antigos');
      await p.locator('#secoes-sicaf').screenshot({ path: path.join(PRINTS, '3-quadro-sicaf.png') });
    });
    await passo('SICAF atualizado automaticamente grava situação, fonte e data', p, async () => {
      await p.route('**/api/situacao-sicaf**', r => r.fulfill({ json: { cnpj: '11222333000181', encontrado: true, ativo: true, habilitadoLicitar: true, razaoSocial: 'PAPELARIA AURORA TESTE LTDA', fonte: 'https://dadosabertos.compras.gov.br/modulo-fornecedor/1_consultarFornecedor', consultadoEm: new Date().toISOString() } }));
      await secao('SICAF').locator('[data-sicaf-auto]').click();
      await secao('SICAF').locator('.tag', { hasText: 'Ativo e habilitado a licitar' }).waitFor({ timeout: 15000 });
      exigir(/Consultado em .*Compras\.gov\.br/.test(await secao('SICAF').innerText()), 'sem data/fonte na seção');
      const [reg] = await banco('operacao_documentos?tipo=eq.SICAF&orgao_emissor=eq.Compras.gov.br (dados abertos)&select=titulo,emissao,observacoes');
      exigir(reg?.titulo === 'Ativo e habilitado a licitar' && /dadosabertos/.test(reg.observacoes) && reg.emissao, 'registro SICAF: ' + JSON.stringify(reg));
      await p.locator('#secoes-sicaf').screenshot({ path: path.join(PRINTS, '4-sicaf-automatico.png') });
    });
    await passo('Emitir no site oficial abre o TST e mostra o CNPJ', p, async () => {
      await p.context().route('https://cndt-certidao.tst.jus.br/**', r => r.fulfill({ contentType: 'text/html', body: '<p>site oficial (dublê)</p>' }));
      const [nova] = await Promise.all([p.context().waitForEvent('page', { timeout: 10000 }), secao('CNDT').locator('[data-emitir]').click()]);
      exigir(/cndt-certidao\.tst\.jus\.br\/gerarCertidao/.test(nova.url()), 'site aberto: ' + nova.url());
      await nova.close();
      await p.waitForSelector('#aviso:has-text("11222333000181")', { timeout: 8000 });
      await p.screenshot({ path: path.join(PRINTS, '5-emitir-site-oficial.png') });
    });
    await passo('Carregar PDF da seção Trabalhista já escolhe o tipo e vira Válida', p, async () => {
      await secao('CNDT').locator('[data-carregar]').click();
      exigir(await p.inputValue('#doc-tipo') === 'CNDT', 'tipo não veio da seção');
      exigir(/180 dias/.test(await p.innerText('#doc-dica')), 'sem dica de validade');
      await p.fill('#form-documento [name=titulo]', 'CNDT-E2E');
      await p.fill('#form-documento [name=vencimento]', new Date(Date.now() + 170 * 864e5).toISOString().slice(0, 10));
      await p.setInputFiles('#form-documento [name=arquivo]', { name: 'cndt.pdf', mimeType: 'application/pdf', buffer: PDF });
      await p.screenshot({ path: path.join(PRINTS, '6-carregar-pdf-secao.png') });
      await p.click('#btn-salvar-documento');
      // A CNDT antiga do seed já está válida: esperar a linha nova e a validade dela (a mais longa) no quadro.
      await linha(p, 'CNDT-E2E').first().waitFor({ timeout: 15000 });
      const venc = new Date(Date.now() + 170 * 864e5).toISOString().slice(0, 10).split('-').reverse().join('/');
      await secao('CNDT').locator('.nota', { hasText: venc }).waitFor({ timeout: 15000 });
      exigir(/Válida/.test(await secao('CNDT').locator('.tag').innerText()), 'CNDT nova não ficou válida');
      const [reg] = await banco('operacao_documentos?titulo=eq.CNDT-E2E&select=id,tipo,orgao_emissor,arquivo_caminho');
      exigir(reg?.tipo === 'CNDT' && reg.orgao_emissor === 'Tribunal Superior do Trabalho' && reg.arquivo_caminho, 'registro: ' + JSON.stringify(reg));
      await p.locator('#secoes-sicaf').screenshot({ path: path.join(PRINTS, '7-quadro-depois.png') });
      // Apaga todas (sobra de rodada anterior interrompida não pode travar a próxima).
      while (await linha(p, 'CNDT-E2E').count()) {
        const n = await linha(p, 'CNDT-E2E').count();
        p.once('dialog', d => d.accept());
        await linha(p, 'CNDT-E2E').first().locator('.btn-excluir').click();
        await p.waitForFunction((m) => document.querySelectorAll('#lista-documentos tr').length && [...document.querySelectorAll('#lista-documentos tr')].filter(t => /CNDT-E2E/.test(t.innerText)).length < m, n, { timeout: 15000 });
      }
      await p.waitForFunction(() => !/CNDT-E2E/.test(document.querySelector('#lista-documentos').innerText), null, { timeout: 15000 });
    });
  } finally {
    await navegador.close();
  }
  const { resultados } = require('./e2e.cjs');
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : 'E2E CERTIDAO MANUAL OK');
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
