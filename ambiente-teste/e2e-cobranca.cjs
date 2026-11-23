/* global document */
// E2E da aba Cobrança do admin (supabase/planos_e_recursos.sql, seção 10) e da carência no painel do cliente.
//   PORTA_TESTE=8788 node ambiente-teste/servidor.cjs
//   node ambiente-teste/e2e-cobranca.cjs
// Cliente Empresa mensal vencido há 2 dias usa tudo com aviso fixo; o dono vê o atraso, o link pronto do WhatsApp
// (só lido, nada enviado), muda a carência; o robô bloqueia depois da carência; "Recebi: renovar" libera. Contas fictícias.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/pente-fino/prints-cobranca';
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
// Datas em UTC, como o current_date do banco (Supabase roda em UTC): depois das 21h de Brasília já é o dia seguinte.
const mais = (dias) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + dias); return d; };
const iso = (d) => d.toISOString().slice(0, 10);
const maisMeses = (m) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + m); return iso(d); };

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const C = await conta('cobranca-cliente', 'Cliente Cobranca Teste', 'empresa');
  const D = await conta('cobranca-dono', 'Dono Cobranca Teste', null, true);
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  Object.assign(seed.usuarios, { cobranca_cliente: C, cobranca_dono: D });
  fs.writeFileSync(SEED, JSON.stringify(seed, null, 2));
  console.log('contas fictícias criadas (senhas em ambiente-teste/seed.local.json)');
  await servico('PATCH', `/rest/v1/clientes?id=eq.${C.id}`, { telefone: '92900000000' });
  // Empresa mensal que venceu há 2 dias: na carência (padrão 3 dias).
  await servico('PATCH', `/rest/v1/assinaturas?usuario_id=eq.${C.id}`, { plano: 'empresa', situacao: 'ativa', ciclo: 'mensal', valor_centavos: 24900, vence_em: iso(mais(-2)) });
  await servico('PATCH', '/rest/v1/config_cobranca?id=eq.1', { carencia_dias: 3 });

  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  try {
    const pC = await novaPagina(navegador);
    await entrar(pC, C);
    await passo('cliente na carência: usa tudo, com o aviso fixo "Sua assinatura venceu em ... Renove até ..."', null, async () => {
      await pC.goto(SITE + '/painel.html');
      await pC.waitForSelector('#aviso-carencia', { timeout: 30000 });
      const t = await pC.innerText('#aviso-carencia');
      const dm = (d) => iso(d).slice(8, 10) + '/' + iso(d).slice(5, 7);
      exigir(t.includes(`Sua assinatura venceu em ${dm(mais(-2))}. Renove até ${dm(mais(1))} para não perder o acesso.`) && /Renovar/.test(t), 'aviso: ' + t);
      exigir(!(await pC.$('main .trava-plano')), 'travou na carência');
      exigir((await pC.$$('#aviso-carencia')).length === 1, 'aviso repetido');
      await nasDuasLarguras(pC, 'cobranca-cliente-carencia');
      return t;
    });

    const segredo = segredoLocal();
    const tD = await token(D);
    const payload = JSON.parse(Buffer.from(tD.access_token.split('.')[1], 'base64url').toString());
    const tokenAal2 = assinarJwt({ ...payload, aal: 'aal2', amr: [{ method: 'password', timestamp: payload.iat }, { method: 'totp', timestamp: payload.iat }] }, segredo);
    const tC = await token(C);
    await passo('cliente e dono sem 2 fatores não veem a cobrança nem mudam a carência', null, async () => {
      for (const t of [tC.access_token, tD.access_token]) {
        const r = await comoUsuario(t, 'POST', '/rest/v1/rpc/admin_cobranca', {});
        const w = await comoUsuario(t, 'POST', '/rest/v1/rpc/admin_definir_carencia', { p_dias: 9 });
        const b = await comoUsuario(t, 'POST', '/rest/v1/rpc/cobranca_rodar_diario', {});
        exigir(r.status >= 400 && w.status >= 400 && b.status >= 400, `recusa: ${r.status}/${w.status}/${b.status}`);
      }
    });
    const pD = await novaPagina(navegador);
    pD.on('dialog', d => d.accept());
    const fator = { id: '00000000-0000-4000-8000-0000000000f3', friendly_name: 'teste', factor_type: 'totp', status: 'verified', created_at: '2026-11-22T00:00:00Z', updated_at: '2026-11-22T00:00:00Z' };
    await pD.route('**/auth/v1/user', async rota => { const r = await rota.fetch(); const u = await r.json(); await rota.fulfill({ response: r, json: { ...u, factors: [fator] } }); });
    // Abrir o WhatsApp não envia nada: o teste só lê o link, sem abrir a página.
    await pD.route('https://wa.me/**', rota => rota.abort());
    await pD.goto(SITE + '/admin.html');
    await pD.evaluate(({ chave, sessao }) => localStorage.setItem(chave, JSON.stringify(sessao)), {
      chave: 'sb-127-auth-token',
      sessao: { access_token: tokenAal2, refresh_token: tD.refresh_token, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, user: { ...tD.user, factors: [fator] } } });
    const linha = `#cobranca-em_atraso tr[data-cobranca="${C.id}"]`;
    await passo('dono: aba Cobrança com totais do mês e o cliente em atraso (dias, valor, plano, contato)', null, async () => {
      await pD.reload();
      await pD.waitForSelector('#painel .card-num', { timeout: 30000 });
      exigir(await pD.isVisible('#link-normas-obra'), 'link "Normas de obra" no topo do admin');
      await pD.click('.tabs button[data-status="cobranca"]');
      await pD.waitForSelector(linha, { timeout: 20000 });
      const t = await pD.innerText(linha), tot = await pD.innerText('#cobranca-totais');
      exigir(/Cliente Cobranca Teste/.test(t) && /há 2 dias/.test(t) && /249,00/.test(t) && /Empresa · Mensal/.test(t) && /92900000000/.test(t), 'linha: ' + t);
      exigir(/A receber no mês/.test(tot) && /Recebido no mês/.test(tot) && /Em atraso/.test(tot), 'totais: ' + tot);
      exigir(await pD.inputValue('#carencia-dias') === '3', 'carência padrão');
      await nasDuasLarguras(pD, 'admin-cobranca');
      return tot.replace(/\s+/g, ' ');
    });
    await passo('dono: "Cobrar no WhatsApp" abre wa.me com a mensagem pronta (valor e link de assinar.html)', null, async () => {
      const href = await pD.getAttribute(`${linha} a:has-text("Cobrar no WhatsApp")`, 'href');
      const texto = decodeURIComponent(href.split('text=')[1] || '');
      exigir(href.startsWith('https://wa.me/5592900000000?text=') && /R\$\s?249,00/.test(texto) && /venceu em/.test(texto) && texto.includes(SITE + '/assinar.html') && /Se já pagou, desconsidere/.test(texto), 'link: ' + texto);
      exigir(await pD.getAttribute(`${linha} a:has-text("Cobrar no WhatsApp")`, 'target') === '_blank', 'abre em outra aba');
      return texto;
    });
    await passo('dono muda a carência para 5 dias e o banco guarda', null, async () => {
      await pD.fill('#carencia-dias', '5');
      await pD.click('#form-carencia button[type="submit"]');
      await pD.waitForFunction(() => /Carência salva|Não foi/.test(document.getElementById('resultado-carencia').textContent), null, { timeout: 20000 });
      const c = await servico('GET', '/rest/v1/config_cobranca?select=carencia_dias');
      exigir(c[0].carencia_dias === 5, 'carência no banco: ' + JSON.stringify(c));
      await servico('PATCH', '/rest/v1/config_cobranca?id=eq.1', { carencia_dias: 3 });
    });
    await passo('robô diário: passou da carência, bloqueia (só boletim, "Renovar"), sem apagar nada', null, async () => {
      await servico('PATCH', `/rest/v1/assinaturas?usuario_id=eq.${C.id}`, { vence_em: iso(mais(-4)) });
      const r = await servico('POST', '/rest/v1/rpc/cobranca_rodar_diario', {});
      exigir(r.bloqueados.some(b => b.usuario_id === C.id), 'robô: ' + JSON.stringify(r).slice(0, 300));
      const a = (await servico('GET', `/rest/v1/assinaturas?usuario_id=eq.${C.id}&select=situacao`))[0];
      exigir(a.situacao === 'vencida', 'situação: ' + a.situacao);
      await pC.goto(SITE + '/painel.html');
      await pC.waitForSelector('main .trava-plano', { timeout: 30000 });
      const t = await pC.innerText('main .trava-plano');
      exigir(/Sua assinatura venceu/.test(t) && /Renovar/.test(t) && !(await pC.$('#aviso-carencia')), 'trava: ' + t);
      exigir((await servico('GET', `/rest/v1/clientes?id=eq.${C.id}&select=id`)).length === 1, 'cliente apagado');
    });
    await passo('dono: cliente aparece em "Bloqueados" e "Recebi: renovar" libera por mais 1 mês', null, async () => {
      await pD.click('.tabs button[data-status="visao"]');
      await pD.click('.tabs button[data-status="cobranca"]');
      const bloq = `#cobranca-bloqueados tr[data-cobranca="${C.id}"]`;
      await pD.waitForSelector(bloq, { timeout: 20000 });
      await pD.click(`${bloq} [data-renovar]`);
      await pD.waitForFunction(() => /Renovado|Não foi/.test(document.getElementById('resultado-cobranca').textContent), null, { timeout: 20000 });
      const r = await pD.innerText('#resultado-cobranca');
      exigir(/Renovado/.test(r), r);
      const a = (await servico('GET', `/rest/v1/assinaturas?usuario_id=eq.${C.id}&select=situacao,vence_em,plano`))[0];
      exigir(a.situacao === 'ativa' && a.plano === 'empresa' && a.vence_em === maisMeses(1), 'assinatura: ' + JSON.stringify(a));
      await pC.goto(SITE + '/painel.html');
      await pC.waitForTimeout(5000);
      exigir(!(await pC.$('main .trava-plano')) && !(await pC.$('#aviso-carencia')), 'continua travado depois de renovar');
      return r;
    });
    const erros = [pC, pD].flatMap(p => p.erros).filter(e => !/favicon|turnstile|challenges\.cloudflare|fonts\.g|wa\.me/i.test(e));
    await passo('sem erro de página nem de console', null, async () => { exigir(!erros.some(e => /pageerror|console/.test(e)), erros.join(' | ')); return erros.slice(0, 5).join(' | ') || 'nenhum'; });
  } finally {
    await navegador.close();
  }
  fs.writeFileSync(path.join(PRINTS, 'resultado-cobranca.json'), JSON.stringify(resultados, null, 2));
  const falhas = resultados.filter(r => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length} de ${resultados.length}` : `OK: ${resultados.length} de ${resultados.length}`);
  process.exit(falhas.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
