/* global document, localStorage */
// E2E do "Indique e ganhe" (supabase/indicacoes.sql). Ambiente: subir.cjs (ou o SQL aplicado) + servidor.cjs.
//   npm run build:cloudflare && PORTA_TESTE=8925 node ambiente-teste/servidor.cjs   (outro terminal)
//   SITE_TESTE=http://127.0.0.1:8925 node ambiente-teste/e2e-indicacao.cjs
// Contas fictícias (criadas ou recriadas aqui; senhas só em seed.local.json): indicador, indicado e dono (owner).
// Caminho: link ?ind= guarda o código -> cadastro.html manda o código no signUp (conferido no pedido, sem criar conta
// pela tela) -> conta do indicado criada com o mesmo metadado -> dono registra o pagamento no admin -> comissão aparece
// na garantia -> passa da garantia (simulado no banco) -> abaixo do mínimo não saca -> dono baixa o mínimo -> indicador
// pede o Pix -> dono marca como paga.
// O 2º fator do dono é simulado como em e2e-planos.cjs (token aal2 assinado com o JWT_SECRET LOCAL).
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-indicacao';
const { passo, exigir, novaPagina, entrar, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const SEED = path.join(__dirname, 'seed.local.json');

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
async function rpc(tk, nome, corpo = {}) {
  const r = await fetch(`${chaves.API_URL}/rest/v1/rpc/${nome}`, { method: 'POST', body: JSON.stringify(corpo),
    headers: { apikey: chaves.ANON_KEY, Authorization: 'Bearer ' + tk, 'content-type': 'application/json' } });
  return { status: r.status, corpo: await r.text() };
}
// Cria (ou recria) a conta fictícia; a senha nova vai só para seed.local.json.
async function conta(papel, nome, extra, owner) {
  const email = `${papel}@teste-licitaplena.example.com`, senha = crypto.randomBytes(15).toString('base64url') + 'a1!';
  const antigo = ((await servico('GET', '/auth/v1/admin/users?per_page=1000')).users || []).find(u => u.email === email);
  if (antigo) await servico('DELETE', `/auth/v1/admin/users/${antigo.id}`);
  await servico('DELETE', `/rest/v1/clientes?email=eq.${encodeURIComponent(email)}`);
  const u = await servico('POST', '/auth/v1/admin/users', { email, password: senha, email_confirm: true, user_metadata: { nome, plano_desejado: 'empresa', ...extra.meta } });
  if (owner && !(await servico('GET', `/rest/v1/admins?email=eq.${encodeURIComponent(email)}&select=email`)).length) await servico('POST', '/rest/v1/admins', { email, nome, role: 'owner' });
  await servico('POST', '/rest/v1/clientes', { id: u.id, nome, email, empresa: nome + ' LTDA (fictícia)', status: 'aprovado', aceite_termos: true, cnpj: extra.cnpj, telefone: extra.telefone });
  return { id: u.id, email, senha, nome };
}
function assinar(payload, segredo) {
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
async function prints(p, nome, esperar) {
  for (const largura of [1280, 375]) {
    await p.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 });
    if (esperar) await esperar(); else await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(PRINTS, `${nome}-${largura}.png`), fullPage: true });
    exigir(await semRolagem(p), `rolagem horizontal em ${nome} ${largura}`);
  }
  await p.setViewportSize({ width: 1280, height: 900 });
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  // Regras no padrão (uma rodada anterior que parou no meio pode ter deixado o mínimo baixo).
  await servico('PATCH', '/rest/v1/indicacao_regras?id=eq.1', { saque_minimo_centavos: 5000, percentual: 30, dias_garantia: 30, ativo: true });
  const R = await conta('indica-indicador', 'Ana Indicadora Teste', { cnpj: '11222333000181', telefone: '(92) 99999-1001', meta: {} });
  const D = await conta('indica-dono', 'Dono Indicação Teste', { meta: {} }, true);
  const tR = await token(R);
  const codigo = JSON.parse((await rpc(tR.access_token, 'minhas_indicacoes')).corpo).codigo;
  exigir(/^[A-Z0-9]{8}$/.test(codigo || ''), 'código: ' + codigo);
  let N;
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  try {
    await passo('visitante: link ?ind= guarda o código; outro link depois não troca (primeiro clique vale)', null, async () => {
      const p = await novaPagina(navegador);
      await p.goto(`${SITE}/?ind=${codigo.toLowerCase()}`);
      const g = await p.evaluate(() => JSON.parse(localStorage.getItem('licitaplena_indicacao')));
      exigir(g && g.codigo === codigo, 'guardado: ' + JSON.stringify(g));
      await p.goto(`${SITE}/?ind=ZZZZ9999`);
      exigir((await p.evaluate(() => JSON.parse(localStorage.getItem('licitaplena_indicacao')))).codigo === codigo, 'segundo link trocou o código');
      // Cadastro: o pedido de signUp leva o código (respondido aqui, sem criar conta pela tela nem tocar o Turnstile).
      let enviado = null;
      await p.route('**/auth/v1/signup**', async rota => { enviado = rota.request().postDataJSON(); await rota.fulfill({ status: 200, json: { id: '00000000-0000-4000-8000-00000000ab01', user: null } }); });
      await p.goto(SITE + '/cadastro.html');
      await p.evaluate(() => {
        const v = (id, x) => { document.getElementById(id).value = x; };
        v('nome', 'Nora Indicada Teste'); v('email', 'nora@teste-licitaplena.example.com'); v('email_confirmar', 'nora@teste-licitaplena.example.com');
        v('senha', 'Senha-ficticia-1'); v('senha_confirmar', 'Senha-ficticia-1');
        document.getElementById('campo-segmento-display').dataset.segmento = '["ALIMENTAÇÃO"]';
        document.getElementById('aceite_termos').checked = true;
        document.getElementById('form-cadastro').requestSubmit();
      });
      await p.waitForFunction(() => /Cadastro criado/.test(document.getElementById('aviso').textContent), null, { timeout: 15000 });
      exigir(enviado?.data?.indicacao_codigo === codigo && Date.parse(enviado.data.indicacao_em) > 0, 'metadado: ' + JSON.stringify(enviado?.data || null).slice(0, 300));
      exigir(await p.evaluate(() => localStorage.getItem('licitaplena_indicacao')) === null, 'código não foi limpo depois do cadastro');
      await p.context().close();
      return `código ${codigo} no signUp`;
    });
    await passo('banco: conta criada com o mesmo metadado vira indicação; mesmo CNPJ fica bloqueada', null, async () => {
      N = await conta('indica-indicado', 'Nora Indicada Teste', { cnpj: '33444555000166', telefone: '(11) 97777-1002', meta: { indicacao_codigo: codigo, indicacao_em: new Date().toISOString() } });
      const F = await conta('indica-fraude', 'Fraude Mesmo CNPJ', { cnpj: '11.222.333/0001-81', telefone: '(11) 97777-1003', meta: { indicacao_codigo: codigo, indicacao_em: new Date().toISOString() } });
      const [i] = await servico('GET', `/rest/v1/indicacoes?indicado_id=eq.${N.id}&select=situacao,indicador_id`);
      const [f] = await servico('GET', `/rest/v1/indicacoes?indicado_id=eq.${F.id}&select=situacao,motivo_bloqueio`);
      exigir(i?.situacao === 'cadastrado' && i.indicador_id === R.id, 'indicação: ' + JSON.stringify(i));
      exigir(f?.situacao === 'bloqueada', 'fraude: ' + JSON.stringify(f));
      const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
      Object.assign(seed.usuarios, { indica_indicador: R, indica_indicado: N, indica_dono: D });
      fs.writeFileSync(SEED, JSON.stringify(seed, null, 2));
      const tN = await token(N);
      const v = await rpc(tN.access_token, 'minhas_indicacoes');
      exigir(JSON.parse(v.corpo).comissoes.length === 0, 'indicado vê comissão');
      return `${f.motivo_bloqueio}`;
    });

    // Dono no admin (aal2 simulado), aba Indicações: "Registrar pagamento do cliente" -> Financeiro já preenchido.
    const tD = await token(D);
    const payload = JSON.parse(Buffer.from(tD.access_token.split('.')[1], 'base64url').toString());
    const tokenAal2 = assinar({ ...payload, aal: 'aal2', amr: [{ method: 'password', timestamp: payload.iat }, { method: 'totp', timestamp: payload.iat }] }, segredoLocal());
    const fator = { id: '00000000-0000-4000-8000-0000000000f2', friendly_name: 'teste', factor_type: 'totp', status: 'verified', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z' };
    const pD = await novaPagina(navegador);
    await pD.route('**/auth/v1/user', async rota => { const r = await rota.fetch(); const u = await r.json(); await rota.fulfill({ response: r, json: { ...u, factors: [fator] } }); });
    await pD.goto(SITE + '/admin.html');
    await pD.evaluate(({ chave, sessao }) => localStorage.setItem(chave, JSON.stringify(sessao)), { chave: 'sb-127-auth-token',
      sessao: { access_token: tokenAal2, refresh_token: tD.refresh_token, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, user: { ...tD.user, factors: [fator] } } });
    await passo('dono: aba Indicações mostra regras e indicações; registra o pagamento do indicado', null, async () => {
      await pD.reload();
      await pD.waitForSelector('#painel .card-num', { timeout: 30000 });
      await pD.click('.tabs button[data-status="indicacoes"]');
      await pD.waitForSelector(`#conteudo-indicacoes button[data-registrar-pagamento="${N.id}"]`, { timeout: 20000 });
      exigir(await pD.inputValue('#ri-percentual') === '30', 'percentual padrão');
      await prints(pD, 'admin-indicacoes');
      await pD.click(`#conteudo-indicacoes button[data-registrar-pagamento="${N.id}"]`);
      await pD.waitForFunction(id => document.getElementById('pag-conta').value === id && document.getElementById('pag-pago').checked, N.id, { timeout: 20000 });
      await pD.selectOption('#pag-plano', 'empresa');
      await pD.fill('#pag-referencia', 'Pix fictício e2e indicação');
      await pD.click('#form-pagamento button[type="submit"]');
      await pD.waitForFunction(() => /registrado|Não foi/.test(document.getElementById('resultado-pagamento').textContent), null, { timeout: 20000 });
      const texto = await pD.innerText('#resultado-pagamento');
      exigir(/assinatura ativada/.test(texto), texto);
      const [k] = await servico('GET', `/rest/v1/indicacao_comissoes?indicador_id=eq.${R.id}&select=id,valor_centavos,situacao`);
      exigir(k && k.valor_centavos === 4470 && k.situacao === 'pendente', 'comissão: ' + JSON.stringify(k));
      return `comissão de R$ ${(k.valor_centavos / 100).toFixed(2)} na garantia`;
    });

    const pR = await novaPagina(navegador);
    await entrar(pR, R);
    const carregada = () => pR.waitForFunction(() => /\?ind=/.test(document.getElementById('link-indicacao')?.value || '') && !/Carregando/.test(document.getElementById('corpo-comissoes').textContent), null, { timeout: 30000 });
    // Recarrega em cada largura: o menu lateral decide gaveta (celular) ou barra (computador) ao abrir a página.
    const recarregar = async () => { await pR.reload(); await carregada(); };
    await passo('indicador: tela Indique e ganhe com link, WhatsApp, indicado sem dado sensível e comissão na garantia', null, async () => {
      await pR.goto(SITE + '/indique.html');
      await carregada();
      exigir(await pR.inputValue('#link-indicacao') === `https://licitaplena.com.br/?ind=${codigo}`, 'link');
      const whats = await pR.getAttribute('#btn-whatsapp', 'href');
      exigir(whats.startsWith('https://wa.me/?text=') && decodeURIComponent(whats).includes(codigo), 'whatsapp: ' + whats);
      const texto = await pR.innerText('main');
      exigir(/Nora T\./.test(texto) && !/nora@|33444555|97777|Indicada/.test(texto), 'dado sensível na tela');
      exigir(/R\$\s?44,70/.test(await pR.innerText('#total-pendente')), 'total na garantia');
      exigir(await pR.isDisabled('#btn-saque'), 'saque liberado na garantia');
      exigir(await pR.evaluate(() => !!document.querySelector('#menu-principal a.ativo[href="indique.html"]')), 'menu sem o item ativo');
      await prints(pR, 'indique-garantia', recarregar);
      await pR.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE });
      await pR.click('#btn-copiar');
      await pR.waitForFunction(() => /copiado|Selecionamos/.test(document.getElementById('aviso').textContent), null, { timeout: 5000 });
    });
    await passo('indicador: depois da garantia, abaixo do mínimo o saque fica travado; com mínimo de R$ 40 pede o Pix; dono paga', null, async () => {
      await servico('PATCH', `/rest/v1/indicacao_comissoes?indicador_id=eq.${R.id}`, { libera_em: new Date(Date.now() - 86400000).toISOString() });
      await pR.reload(); await carregada();
      exigir(await pR.isDisabled('#btn-saque'), 'saque abaixo do mínimo liberado');
      await pD.click('.tabs button[data-status="indicacoes"]');
      await pD.waitForSelector('#ri-saque', { timeout: 20000 });
      await pD.waitForFunction(() => document.getElementById('ri-saque').value !== '', null, { timeout: 20000 });
      await pD.fill('#ri-saque', '40,00');
      await pD.click('#form-regras-indicacao button[type="submit"]');
      await pD.waitForFunction(() => /salvas|Não foi/.test(document.getElementById('resultado-regras-indicacao').textContent), null, { timeout: 20000 });
      exigir(/salvas/.test(await pD.innerText('#resultado-regras-indicacao')), await pD.innerText('#resultado-regras-indicacao'));
      await pR.reload(); await carregada();
      exigir(/R\$\s?44,70/.test(await pR.innerText('#total-liberada')), 'total liberado');
      await pR.click('#btn-saque');
      await pR.waitForFunction(() => /Pedido de/.test(document.getElementById('aviso').textContent), null, { timeout: 15000 });
      await prints(pR, 'indique-saque-pedido', recarregar);
      await pD.click('.tabs button[data-status="visao"]');
      await pD.click('.tabs button[data-status="indicacoes"]');
      // A tabela anterior (sem o pedido) já tinha a caixa de seleção: espera o texto novo.
      await pD.waitForFunction(() => /pediu o Pix/.test(document.getElementById('conteudo-comissoes').textContent), null, { timeout: 20000 })
        .catch(() => { throw new Error('admin não vê o pedido'); });
      await pD.check('#conteudo-comissoes input[data-comissao]');
      await pD.fill('#pc-referencia', 'PIX-E2E-0001');
      await pD.click('#form-pagar-comissoes button[type="submit"]');
      await pD.waitForFunction(() => /marcada|Não foi/.test(document.getElementById('resultado-comissoes').textContent), null, { timeout: 20000 });
      exigir(/1 comissão/.test(await pD.innerText('#resultado-comissoes')), await pD.innerText('#resultado-comissoes'));
      await prints(pD, 'admin-comissao-paga');
      await pR.reload(); await carregada();
      exigir(/R\$\s?44,70/.test(await pR.innerText('#total-paga')) && /Paga em/.test(await pR.innerText('#corpo-comissoes')), 'indicador não vê paga');
      await prints(pR, 'indique-paga', recarregar);
      return 'PIX-E2E-0001';
    });
    await passo('segurança pela API: outro cliente não vê; indicador não marca como paga', null, async () => {
      const O = await conta('indica-outro', 'Outro Cliente Teste', { cnpj: '22333444000155', meta: {} });
      const tO = await token(O);
      const v = JSON.parse((await rpc(tO.access_token, 'minhas_indicacoes')).corpo);
      exigir(v.indicados.length === 0 && v.comissoes.length === 0, 'outro cliente viu dados');
      const direto = await fetch(`${chaves.API_URL}/rest/v1/indicacao_comissoes?select=id`, { headers: { apikey: chaves.ANON_KEY, Authorization: 'Bearer ' + tO.access_token } }).then(r => r.json());
      exigir(Array.isArray(direto) && direto.length === 0, 'outro cliente leu comissões: ' + JSON.stringify(direto).slice(0, 100));
      const pagar = await rpc(tR.access_token, 'admin_pagar_comissoes', { p_ids: [], p_referencia: 'x' });
      exigir(pagar.status >= 400, 'indicador chamou admin: ' + pagar.status);
    });
    await passo('regras do programa: página pública com "minuta, aguarda revisão do advogado"', null, async () => {
      const p = await novaPagina(navegador);
      await p.goto(SITE + '/indique-regras.html');
      await p.waitForFunction(() => document.querySelector('[data-regra="saque_minimo_centavos"]').textContent.includes('R$'), null, { timeout: 15000 });
      exigir(/Minuta, aguarda revisão do advogado/.test(await p.innerText('main')), 'aviso de minuta');
      await prints(p, 'regras-programa');
      await p.context().close();
    });
    const erros = [pD, pR].flatMap(p => p.erros).filter(e => !/favicon|turnstile|challenges\.cloudflare|fonts\.g/i.test(e));
    await passo('sem erro de página', null, async () => { exigir(!erros.some(e => /pageerror/.test(e)), erros.join(' | ')); return erros.slice(0, 5).join(' | ') || 'nenhum'; });
  } finally { await navegador.close(); }
  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 2));
  const falhas = resultados.filter(r => !r.ok).length;
  console.log(falhas ? `E2E INDICAÇÃO: ${falhas} FALHA(S)` : 'E2E INDICAÇÃO OK');
  process.exit(falhas ? 1 : 0);
}
main().catch(e => { console.error('E2E INDICAÇÃO FALHOU:', e.message); process.exit(1); });
