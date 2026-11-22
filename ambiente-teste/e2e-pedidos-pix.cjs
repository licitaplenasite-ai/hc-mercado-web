/* global document, window */
// E2E do pedido de compra com Pix manual (assinar.html + aba Pedidos do admin + supabase/planos_e_recursos.sql, seção 9).
//   PORTA_TESTE=8788 node ambiente-teste/servidor.cjs
//   PORTA_TESTE=8788 SITE_TESTE=http://127.0.0.1:8788 node ambiente-teste/e2e-pedidos-pix.cjs
// Cliente com o teste vencido pede o Empresa semestral, vê "Como pagar", o dono libera no admin e as telas destravam.
// Depois a assinatura vence e o aviso fixo mostra "Renovar". Contas fictícias; senhas só em seed.local.json. Os dados do
// Pix são fictícios (.example.com) e entram só nesta página de teste: supabase-config.js continua vazio.
// O 2º fator do dono é simulado como em e2e-planos.cjs (token aal2 assinado com o JWT_SECRET LOCAL).
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-pedidos-pix';
const { passo, exigir, novaPagina, entrar, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const SEED = path.join(__dirname, 'seed.local.json');
const PIX = { LICITAPLENA_PIX_CHAVE: 'pagamentos@teste-licitaplena.example.com', LICITAPLENA_PIX_NOME: 'LicitaPlena Teste', LICITAPLENA_PIX_CIDADE: 'Manaus', LICITAPLENA_WHATSAPP_PAGAMENTO: '5592000000000' };

async function servico(metodo, caminho, corpo) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
async function token(u) {
  const t = await fetch(chaves.API_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: chaves.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.senha }) }).then(r => r.json());
  if (!t.access_token) throw new Error('login falhou para ' + u.email);
  return t;
}
async function comoUsuario(tk, metodo, caminho, corpo) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.ANON_KEY, Authorization: 'Bearer ' + tk, 'content-type': 'application/json' } });
  return { status: r.status, corpo: await r.text() };
}
async function conta(papel, nome, plano, owner) {
  const email = `${papel}@teste-licitaplena.example.com`, senha = crypto.randomBytes(15).toString('base64url') + 'a1!';
  const antigo = ((await servico('GET', '/auth/v1/admin/users?per_page=1000')).users || []).find(u => u.email === email);
  if (antigo) await servico('DELETE', `/auth/v1/admin/users/${antigo.id}`);
  await servico('DELETE', `/rest/v1/clientes?email=eq.${encodeURIComponent(email)}`);
  const u = await servico('POST', '/auth/v1/admin/users', { email, password: senha, email_confirm: true, user_metadata: { nome, plano_desejado: plano } });
  if (owner && !(await servico('GET', `/rest/v1/admins?email=eq.${encodeURIComponent(email)}&select=email`)).length) await servico('POST', '/rest/v1/admins', { email, nome, role: 'owner' });
  await servico('POST', '/rest/v1/clientes', { id: u.id, nome, email, empresa: nome + ' LTDA (fictícia)', status: 'aprovado', aceite_termos: true });
  return { id: u.id, email, senha, nome };
}
function assinarJwt(payload, segredo) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const corpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${corpo}.${crypto.createHmac('sha256', segredo).update(corpo).digest('base64url')}`;
}
function segredoLocal() {
  const r = spawnSync('npx --yes supabase@latest status -o json', { cwd: __dirname, encoding: 'utf8', shell: true });
  const j = JSON.parse(r.stdout.replace(/^[^{]*/, ''));
  if (!/^http:\/\/127\.0\.0\.1:/.test(j.API_URL)) throw new Error('Supabase não é local');
  return j.JWT_SECRET;
}
const semRolagem = p => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function nasDuasLarguras(p, nome, antes) {
  for (const largura of [1280, 375]) {
    await p.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 });
    if (antes) await antes();
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(PRINTS, `${nome}-${largura}.png`), fullPage: true });
    exigir(await semRolagem(p), `${nome}: rolagem lateral em ${largura}`);
  }
  await p.setViewportSize({ width: 1280, height: 900 });
}
const mais = (dias) => { const d = new Date(); d.setDate(d.getDate() + dias); return d; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const maisMeses = (m) => { const d = new Date(); d.setMonth(d.getMonth() + m); return iso(d); };

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const C = await conta('pedido-cliente', 'Cliente Pedido Pix', 'empresa');
  const D = await conta('pedido-dono', 'Dono Pedido Pix', null, true);
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  Object.assign(seed.usuarios, { pedido_cliente: C, pedido_dono: D });
  fs.writeFileSync(SEED, JSON.stringify(seed, null, 2));
  console.log('contas fictícias criadas (senhas em ambiente-teste/seed.local.json)');
  // Teste de 14 dias vencido: só o boletim, telas travadas.
  await servico('PATCH', `/rest/v1/assinaturas?usuario_id=eq.${C.id}`, { teste_ate: mais(-1).toISOString() });

  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  try {
    const pC = await novaPagina(navegador);
    await pC.addInitScript(pix => { for (const [k, v] of Object.entries(pix)) Object.defineProperty(window, k, { value: v, writable: false }); }, PIX);
    await entrar(pC, C);
    await passo('cliente: teste vencido trava o painel e "Assinar" leva à tela de planos', null, async () => {
      await pC.goto(SITE + '/painel.html');
      await pC.waitForSelector('main .trava-plano', { timeout: 30000 });
      exigir(/Seu teste grátis terminou/.test(await pC.innerText('main .trava-plano')), 'sem aviso de teste encerrado');
      await Promise.all([pC.waitForURL(/assinar\.html/, { timeout: 20000 }), pC.click('main .trava-plano a')]);
    });
    await passo('cliente: tela de planos com Mensal / Semestral / Anual, preço por mês e total do banco', null, async () => {
      await pC.waitForSelector('input[name="plano"][value="empresa"]', { timeout: 20000 });
      exigir(/teste grátis terminou/.test(await pC.innerText('#situacao')), 'situação: ' + await pC.innerText('#situacao'));
      await pC.check('input[name="ciclo"][value="semestral"]');
      await pC.check('input[name="plano"][value="empresa"]');
      await pC.waitForFunction(() => /1\.345,00/.test(document.getElementById('total').textContent), null, { timeout: 15000 });
      const card = await pC.innerText('#lista-planos');
      exigir(/224,17/.test(card) && /1\.345,00 a cada 6 meses/.test(card), 'cartões: ' + card.slice(0, 300));
      exigir(/devolvemos os meses não usados/.test(await pC.innerText('main')), 'sem texto de cancelamento');
      await nasDuasLarguras(pC, 'assinar-escolha');
      return await pC.innerText('#total-detalhe');
    });
    await passo('cliente: "Quero assinar" cria o pedido e mostra Como pagar (Pix copia e cola e WhatsApp)', null, async () => {
      await pC.click('#btn-assinar');
      await pC.waitForSelector('#como-pagar:not([hidden]) #pix-codigo', { timeout: 20000 });
      exigir(/1\.345,00/.test(await pC.innerText('#pagar-valor')), 'valor do pedido');
      const codigo = await pC.inputValue('#pix-codigo');
      exigir(codigo.startsWith('000201') && codigo.includes('54071345.00') && codigo.includes('pagamentos@teste-licitaplena.example.com'), 'código: ' + codigo);
      const zap = await pC.getAttribute('#btn-whatsapp', 'href');
      const texto = decodeURIComponent(zap.split('text=')[1] || '');
      exigir(zap.startsWith('https://wa.me/5592000000000') && /Semestral/.test(texto) && /Empresa/.test(texto) && /1\.345,00/.test(texto) && texto.includes(C.email), 'WhatsApp: ' + zap);
      exigir(/Aguardando o Pix/.test(await pC.innerText('#lista-pedidos')), 'lista de pedidos');
      await nasDuasLarguras(pC, 'assinar-como-pagar');
      const g = await servico('GET', `/rest/v1/pedidos?usuario_id=eq.${C.id}&situacao=eq.aguardando&select=valor_centavos,ciclo,plano`);
      exigir(g.length === 1 && g[0].valor_centavos === 134500 && g[0].ciclo === 'semestral', 'pedido no banco: ' + JSON.stringify(g));
      return codigo.slice(0, 40) + '...';
    });
    await passo('cliente sem dados do Pix configurados: "Fale com a equipe", nada quebrado', null, async () => {
      const pSem = await novaPagina(navegador);
      await entrar(pSem, C);
      await pSem.goto(SITE + '/assinar.html');
      await pSem.waitForSelector('#como-pagar:not([hidden]) #fale-equipe', { timeout: 20000 });
      exigir(!(await pSem.$('#pix-codigo')) && !(await pSem.$('#btn-whatsapp')), 'mostrou Pix sem configuração');
      await nasDuasLarguras(pSem, 'assinar-sem-pix');
      exigir(!pSem.erros.some(e => /pageerror|console/.test(e)), pSem.erros.join(' | '));
      await pSem.context().close();
    });
    const tC = await token(C);
    await passo('cliente não libera o próprio pedido nem vê pedidos de outros', null, async () => {
      const g = JSON.parse((await comoUsuario(tC.access_token, 'GET', '/rest/v1/pedidos?select=id,usuario_id')).corpo);
      exigir(g.length >= 1 && g.every(x => x.usuario_id === C.id), 'pedidos visíveis: ' + JSON.stringify(g));
      const r = await comoUsuario(tC.access_token, 'POST', '/rest/v1/rpc/admin_decidir_pedido', { p_pedido: g[0].id, p_acao: 'liberar' });
      exigir(r.status >= 400, 'cliente liberou: ' + r.status);
      const w = await comoUsuario(tC.access_token, 'PATCH', `/rest/v1/pedidos?id=eq.${g[0].id}`, { valor_centavos: 1 });
      exigir(w.status >= 400, 'cliente alterou o valor: ' + w.status);
      return `${r.status} / ${w.status}`;
    });

    // ---------------- Dono: aba Pedidos, "Recebi o Pix: liberar" ----------------
    const segredo = segredoLocal();
    const tD = await token(D);
    const payload = JSON.parse(Buffer.from(tD.access_token.split('.')[1], 'base64url').toString());
    const tokenAal2 = assinarJwt({ ...payload, aal: 'aal2', amr: [{ method: 'password', timestamp: payload.iat }, { method: 'totp', timestamp: payload.iat }] }, segredo);
    const pD = await novaPagina(navegador);
    pD.on('dialog', d => d.accept());
    const fator = { id: '00000000-0000-4000-8000-0000000000f2', friendly_name: 'teste', factor_type: 'totp', status: 'verified', created_at: '2026-11-22T00:00:00Z', updated_at: '2026-11-22T00:00:00Z' };
    await pD.route('**/auth/v1/user', async rota => { const r = await rota.fetch(); const u = await r.json(); await rota.fulfill({ response: r, json: { ...u, factors: [fator] } }); });
    await pD.goto(SITE + '/admin.html');
    await pD.evaluate(({ chave, sessao }) => localStorage.setItem(chave, JSON.stringify(sessao)), {
      chave: 'sb-127-auth-token',
      sessao: { access_token: tokenAal2, refresh_token: tD.refresh_token, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, user: { ...tD.user, factors: [fator] } } });
    await passo('dono sem 2 fatores: o banco recusa liberar', null, async () => {
      const g = (await servico('GET', `/rest/v1/pedidos?usuario_id=eq.${C.id}&situacao=eq.aguardando&select=id`))[0];
      const r = await comoUsuario(tD.access_token, 'POST', '/rest/v1/rpc/admin_decidir_pedido', { p_pedido: g.id, p_acao: 'liberar' });
      exigir(r.status >= 400 && /2 fatores/.test(r.corpo), 'aal1 liberou: ' + r.status + ' ' + r.corpo.slice(0, 120));
    });
    await passo('dono: aba Pedidos mostra cliente, empresa, plano, ciclo e valor esperado', null, async () => {
      await pD.reload();
      await pD.waitForSelector('#painel .card-num', { timeout: 30000 });
      exigir(/Pedido aguardando o Pix/.test(await pD.innerText('#lista-avisos')), 'aviso do pedido na Visão geral');
      await pD.click('.tabs button[data-status="pedidos"]');
      const cartao = `.pedido-cartao:has-text("${C.nome}")`;
      await pD.waitForSelector(cartao, { timeout: 20000 });
      const t = await pD.innerText(cartao);
      exigir(/Empresa/.test(t) && /Semestral/.test(t) && /1\.345,00/.test(t) && /LTDA/.test(t), 'cartão: ' + t);
      await nasDuasLarguras(pD, 'admin-pedidos');
    });
    await passo('dono: "Recebi o Pix: liberar" ativa o Empresa semestral por 6 meses', null, async () => {
      await pD.click(`.pedido-cartao:has-text("${C.nome}") [data-decidir="liberar"]`);
      await pD.waitForFunction(() => /Liberado|Não foi/.test(document.getElementById('resultado-pedido').textContent), null, { timeout: 20000 });
      const r = await pD.innerText('#resultado-pedido');
      exigir(/Liberado/.test(r), r);
      const a = (await servico('GET', `/rest/v1/assinaturas?usuario_id=eq.${C.id}&select=plano,situacao,ciclo,valor_centavos,vence_em`))[0];
      exigir(a.plano === 'empresa' && a.situacao === 'ativa' && a.ciclo === 'semestral' && a.valor_centavos === 134500 && a.vence_em === maisMeses(6), 'assinatura: ' + JSON.stringify(a));
      const pg = await servico('GET', `/rest/v1/pagamentos?usuario_id=eq.${C.id}&select=metodo,gateway,situacao`);
      exigir(pg.length === 1 && pg[0].gateway === 'pix_manual' && pg[0].situacao === 'pago', 'pagamento: ' + JSON.stringify(pg));
      await pD.waitForSelector('#conteudo-pedidos-historico table', { timeout: 20000 });
      exigir(/Liberado/.test(await pD.innerText('#conteudo-pedidos-historico')), 'histórico');
      await nasDuasLarguras(pD, 'admin-pedido-liberado');
      return r;
    });
    await passo('cliente: telas destravadas e o pedido aparece como pago', null, async () => {
      for (const tela of ['painel.html', 'operacao.html']) {
        await pC.goto(SITE + '/' + tela);
        await pC.waitForTimeout(5000);
        exigir(!(await pC.$('main .trava-plano')), tela + ' continua travada');
      }
      await pC.goto(SITE + '/assinar.html');
      await pC.waitForFunction(() => /Pago e liberado/.test(document.getElementById('lista-pedidos').textContent), null, { timeout: 20000 });
      exigir(/ativo até/.test(await pC.innerText('#situacao')), 'situação: ' + await pC.innerText('#situacao'));
      exigir(await pC.$('#como-pagar[hidden]'), 'Como pagar continua aberto depois de pago');
    });
    // Dono na lista "Vencendo nos próximos 7 dias".
    await passo('dono: assinatura que vence em 3 dias aparece em "Vencendo nos próximos 7 dias"', null, async () => {
      await servico('PATCH', `/rest/v1/assinaturas?usuario_id=eq.${C.id}`, { vence_em: iso(mais(3)) });
      await pD.click('.tabs button[data-status="visao"]');
      await pD.click('.tabs button[data-status="pedidos"]');
      await pD.waitForFunction(n => (document.getElementById('conteudo-vencendo').textContent || '').includes(n), C.nome, { timeout: 20000 });
      await nasDuasLarguras(pD, 'admin-vencendo');
    });
    await passo('assinatura vencida e não renovada: só boletim, aviso fixo "Renovar" leva à tela de planos', null, async () => {
      await servico('PATCH', `/rest/v1/assinaturas?usuario_id=eq.${C.id}`, { vence_em: iso(mais(-10)) });
      await pC.goto(SITE + '/painel.html');
      await pC.waitForSelector('main .trava-plano', { timeout: 30000 });
      const t = await pC.innerText('main .trava-plano');
      exigir(/Sua assinatura venceu/.test(t) && /Renovar/.test(t), 'aviso: ' + t);
      exigir((await pC.$$('.trava-plano')).length === 1, 'mais de um aviso');
      await nasDuasLarguras(pC, 'painel-renovar');
      await Promise.all([pC.waitForURL(/assinar\.html/, { timeout: 20000 }), pC.click('main .trava-plano a')]);
      await pC.waitForFunction(() => /venceu/.test(document.getElementById('situacao').textContent), null, { timeout: 20000 });
      exigir(await pC.isChecked('input[name="ciclo"][value="semestral"]') && await pC.isChecked('input[name="plano"][value="empresa"]'), 'renovação não sugere o plano e o ciclo atuais');
    });
    const erros = [pC, pD].flatMap(p => p.erros).filter(e => !/favicon|turnstile|challenges\.cloudflare|fonts\.g/i.test(e));
    await passo('sem erro de página nem de console', null, async () => { exigir(!erros.some(e => /pageerror|console/.test(e)), erros.join(' | ')); return erros.slice(0, 5).join(' | ') || 'nenhum'; });
  } finally {
    await navegador.close();
  }
  fs.writeFileSync(path.join(PRINTS, 'resultado-pedidos-pix.json'), JSON.stringify(resultados, null, 2));
  const falhas = resultados.filter(r => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length} de ${resultados.length}` : `OK: ${resultados.length} de ${resultados.length}`);
  process.exit(falhas.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
