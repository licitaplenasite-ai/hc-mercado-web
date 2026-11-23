/* global document, localStorage */
// E2E dos planos (supabase/planos_e_recursos.sql) e do admin. Ambiente: subir.cjs (ou o SQL aplicado) + servidor.cjs.
//   PORTA_TESTE=8895 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8895 node ambiente-teste/e2e-planos.cjs
// Três contas fictícias (criadas ou recriadas aqui; senhas só em seed.local.json): Empresa (1 CNPJ), Assessoria (3 CNPJs
// no teste) e dono (owner). O 2º fator do dono é simulado: o Auth local está com TOTP desligado (config.toml), então o
// token aal2 é assinado com o JWT_SECRET LOCAL e /auth/v1/user devolve um fator TOTP fictício. A checagem real de
// aal2 no banco (admin_planos_autorizado) é a mesma de produção.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-planos-admin';
const { passo, exigir, novaPagina, entrar, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const SEED = path.join(__dirname, 'seed.local.json');

async function servico(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation', ...extra } });
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
    headers: { apikey: chaves.ANON_KEY, Authorization: 'Bearer ' + tk, 'content-type': 'application/json', Prefer: 'return=representation' } });
  return { status: r.status, corpo: await r.text() };
}

// Cria (ou recria) a conta fictícia; a senha nova vai só para seed.local.json.
async function conta(papel, nome, plano, owner) {
  const email = `${papel}@teste-licitaplena.example.com`, senha = crypto.randomBytes(15).toString('base64url') + 'a1!';
  const lista = await servico('GET', '/auth/v1/admin/users?per_page=1000');
  const antigo = (lista.users || []).find(u => u.email === email);
  if (antigo) await servico('DELETE', `/auth/v1/admin/users/${antigo.id}`);
  // A base local de clientes não tem a FK com cascata de produção: apaga as sobras da rodada anterior.
  await servico('DELETE', `/rest/v1/clientes?email=eq.${encodeURIComponent(email)}`);
  const u = await servico('POST', '/auth/v1/admin/users', { email, password: senha, email_confirm: true, user_metadata: { nome, plano_desejado: plano } });
  // admins não tem chave única no e-mail: só insere se ainda não houver (duplicado quebra o maybeSingle do admin.html).
  if (owner && !(await servico('GET', `/rest/v1/admins?email=eq.${encodeURIComponent(email)}&select=email`)).length) await servico('POST', '/rest/v1/admins', { email, nome, role: 'owner' });
  await servico('POST', '/rest/v1/clientes', { id: u.id, nome, email, empresa: nome + ' LTDA (fictícia)', status: 'aprovado', aceite_termos: true });
  return { id: u.id, email, senha, nome };
}

// JWT HS256 assinado com o segredo LOCAL (só existe no Supabase do Docker).
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

async function print(p, nome) { await p.screenshot({ path: path.join(PRINTS, nome), fullPage: false }); }
const semRolagem = p => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const visivel = (p, sel) => p.evaluate(s => { const el = document.querySelector(s); return !!el && el.offsetParent !== null; }, sel);

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const E = await conta('plano-empresa', 'Empresa Plano Teste', 'empresa');
  const A = await conta('plano-assessoria', 'Assessoria Plano Teste', 'assessoria');
  const D = await conta('plano-dono', 'Dono Plano Teste', null, true);
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  Object.assign(seed.usuarios, { plano_empresa: E, plano_assessoria: A, plano_dono: D });
  fs.writeFileSync(SEED, JSON.stringify(seed, null, 2));
  console.log('contas fictícias criadas (senhas em ambiente-teste/seed.local.json)');

  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  try {
    // ---------------- Empresa: 1 CNPJ, sem seletor, 2º CNPJ recusado também pela API ----------------
    const pE = await novaPagina(navegador);
    await entrar(pE, E);
    await passo('empresa: Minhas empresas cria a 1ª empresa e esconde seletor e botão de adicionar', null, async () => {
      await pE.goto(SITE + '/operacao.html');
      await pE.waitForFunction(() => /Plano/.test(document.getElementById('cota-empresas')?.textContent || ''), null, { timeout: 30000 });
      const cota = await pE.innerText('#cota-empresas');
      exigir(/Plano Empresa/.test(cota) && /1 de 1/.test(cota), 'cota: ' + cota);
      exigir(!(await visivel(pE, '.empresa-select')), 'seletor de empresa visível');
      exigir(!(await visivel(pE, '#btn-nova-empresa')), 'botão Adicionar empresa visível');
      for (const largura of [1280, 375]) { await pE.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pE.reload(); await pE.waitForFunction(() => /Plano/.test(document.getElementById('cota-empresas')?.textContent || ''), null, { timeout: 30000 }); await print(pE, `empresa-minhas-empresas-${largura}.png`); exigir(await semRolagem(pE), 'rolagem horizontal em ' + largura); }
      return cota;
    });
    const tE = await token(E);
    await passo('empresa: 2º CNPJ pela API é recusado pelo banco', null, async () => {
      const org = JSON.parse((await comoUsuario(tE.access_token, 'GET', '/rest/v1/operacao_organizacoes?select=id')).corpo)[0].id;
      const r = await comoUsuario(tE.access_token, 'POST', '/rest/v1/operacao_empresas', { organizacao_id: org, razao_social: 'Segunda empresa via API' });
      exigir(r.status >= 400 && /Limite de 1 CNPJs/.test(r.corpo), `esperava recusa, veio ${r.status} ${r.corpo.slice(0, 200)}`);
      const plano = JSON.parse((await comoUsuario(tE.access_token, 'POST', '/rest/v1/rpc/meu_plano', {})).corpo);
      exigir(plano.max_cnpjs === 1 && plano.uso.cnpjs === 1, 'meu_plano: ' + JSON.stringify(plano).slice(0, 200));
      const sozinho = await comoUsuario(tE.access_token, 'POST', '/rest/v1/rpc/admin_definir_assinatura', { p_usuario: E.id, p_dados: { plano: 'assessoria' } });
      exigir(sozinho.status >= 400, 'cliente mudou o próprio plano: ' + sozinho.status);
      const direto = await comoUsuario(tE.access_token, 'PATCH', `/rest/v1/assinaturas?usuario_id=eq.${E.id}`, { max_cnpjs: 99 });
      exigir(direto.status >= 400 || direto.corpo === '[]', 'cliente alterou assinatura: ' + direto.status + ' ' + direto.corpo);
      return `${r.status}: ${JSON.parse(r.corpo).message}`;
    });
    await passo('empresa: painel sem "Acompanhar oportunidades para" nem "Gerenciar empresas"', null, async () => {
      await pE.setViewportSize({ width: 1280, height: 900 });
      await pE.goto(SITE + '/painel.html#boletim');
      await pE.waitForFunction(() => { const s = document.getElementById('bol-empresa'); return s && !s.disabled; }, null, { timeout: 40000 });
      await pE.waitForTimeout(500);
      exigir(!(await visivel(pE, 'label[for="bol-empresa"]')), 'seletor do boletim visível');
      exigir(!(await pE.evaluate(() => [...document.querySelectorAll('.empresa-acompanhamento > a')].some(a => a.offsetParent !== null))), 'link Gerenciar empresas visível');
      for (const largura of [1280, 375]) { await pE.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pE.waitForTimeout(300); await print(pE, `empresa-painel-boletim-${largura}.png`); }
    });

    // ---------------- Assessoria: 3 CNPJs no teste, alterna; o 4º é recusado ----------------
    const pA = await novaPagina(navegador);
    await entrar(pA, A);
    await pA.goto(SITE + '/operacao.html');
    await pA.waitForFunction(() => /Plano/.test(document.getElementById('cota-empresas')?.textContent || ''), null, { timeout: 30000 });
    const tA = await token(A);
    await passo('assessoria: cadastra 2ª e 3ª empresa; a 4ª é recusada (teste = até 3)', null, async () => {
      const org = JSON.parse((await comoUsuario(tA.access_token, 'GET', '/rest/v1/operacao_organizacoes?select=id')).corpo)[0].id;
      for (const n of [2, 3]) {
        const r = await comoUsuario(tA.access_token, 'POST', '/rest/v1/operacao_empresas', { organizacao_id: org, razao_social: `Cliente ${n} da Assessoria (fictícia)` });
        exigir(r.status === 201, `empresa ${n}: ${r.status} ${r.corpo.slice(0, 200)}`);
      }
      const r4 = await comoUsuario(tA.access_token, 'POST', '/rest/v1/operacao_empresas', { organizacao_id: org, razao_social: 'Cliente 4 (fictícia)' });
      exigir(r4.status >= 400 && /Limite de 3 CNPJs/.test(r4.corpo), `4ª empresa: ${r4.status} ${r4.corpo.slice(0, 200)}`);
    });
    await passo('assessoria: painel mostra o seletor com 3 empresas e alterna', null, async () => {
      await pA.setViewportSize({ width: 1280, height: 900 });
      await pA.goto(SITE + '/painel.html#boletim');
      await pA.waitForFunction(() => { const s = document.getElementById('bol-empresa'); return s && !s.disabled && s.options.length === 3; }, null, { timeout: 40000 });
      exigir(await visivel(pA, 'label[for="bol-empresa"]'), 'seletor escondido na Assessoria');
      const valores = await pA.$$eval('#bol-empresa option', os => os.map(o => o.value));
      await pA.selectOption('#bol-empresa', valores[2]);
      await pA.waitForFunction(v => localStorage.getItem('licitaplena_empresa_operacional_id') === v, valores[2], { timeout: 10000 });
      for (const largura of [1280, 375]) { await pA.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pA.waitForTimeout(300); await print(pA, `assessoria-painel-seletor-${largura}.png`); }
      await pA.goto(SITE + '/operacao.html');
      await pA.waitForFunction(() => /3 de 3/.test(document.getElementById('cota-empresas')?.textContent || ''), null, { timeout: 30000 });
      exigir(await visivel(pA, '.empresa-select'), 'seletor de Minhas empresas escondido na Assessoria');
      for (const largura of [1280, 375]) { await pA.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pA.reload(); await pA.waitForFunction(() => /3 de 3/.test(document.getElementById('cota-empresas')?.textContent || ''), null, { timeout: 30000 }); await print(pA, `assessoria-minhas-empresas-${largura}.png`); }
      return `${valores.length} empresas; selecionada a 3ª`;
    });

    // ---------------- Dono: admin muda o plano da Empresa para Assessoria ----------------
    const segredo = segredoLocal();
    const tD = await token(D);
    const payload = JSON.parse(Buffer.from(tD.access_token.split('.')[1], 'base64url').toString());
    const aal1 = await comoUsuario(tD.access_token, 'POST', '/rest/v1/rpc/admin_definir_assinatura', { p_usuario: E.id, p_dados: { plano: 'assessoria' } });
    const tokenAal2 = assinar({ ...payload, aal: 'aal2', amr: [{ method: 'password', timestamp: payload.iat }, { method: 'totp', timestamp: payload.iat }] }, segredo);
    const pD = await novaPagina(navegador);
    pD.on('dialog', d => d.accept()); // 22/11: salvar plano e registrar Pix recebido perguntam antes (admin reorganizado)
    const fator = { id: '00000000-0000-4000-8000-0000000000f1', friendly_name: 'teste', factor_type: 'totp', status: 'verified', created_at: '2026-11-19T00:00:00Z', updated_at: '2026-11-19T00:00:00Z' };
    await pD.route('**/auth/v1/user', async rota => {
      const r = await rota.fetch(); const u = await r.json();
      await rota.fulfill({ response: r, json: { ...u, factors: [fator] } });
    });
    await pD.goto(SITE + '/admin.html');
    await pD.evaluate(({ chave, sessao }) => localStorage.setItem(chave, JSON.stringify(sessao)), {
      chave: 'sb-127-auth-token',
      sessao: { access_token: tokenAal2, refresh_token: tD.refresh_token, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, user: { ...tD.user, factors: [fator] } } });
    await passo('dono: sem 2 fatores o banco recusa mudar plano', null, async () => {
      exigir(aal1.status >= 400, 'aal1 mudou plano: ' + aal1.status);
      return aal1.corpo.slice(0, 120);
    });
    await passo('dono: Visão geral e Clientes do admin', null, async () => {
      await pD.setViewportSize({ width: 1280, height: 900 });
      await pD.reload();
      await pD.waitForSelector('#painel .card-num', { timeout: 30000 }).catch(async (e) => {
        const tela = await pD.evaluate(() => ['tela-login', 'tela-mfa-enroll', 'tela-mfa-verify', 'painel'].filter(id => document.getElementById(id).style.display !== 'none').join(','));
        throw new Error(`tela visível: ${tela}; ${pD.erros.join(' | ')}; ${e.message.split(String.fromCharCode(10))[0]}`);
      });
      for (const largura of [1280, 375]) { await pD.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pD.waitForTimeout(300); await print(pD, `admin-visao-geral-${largura}.png`); exigir(await semRolagem(pD), 'rolagem horizontal ' + largura); }
      await pD.setViewportSize({ width: 1280, height: 900 });
      await pD.click('.tabs button[data-status="clientes"]');
      await pD.click('.filtros button[data-filtro="todos"]');
      await pD.waitForSelector('#conteudo-lista table', { timeout: 20000 });
      await pD.fill('#busca-clientes', 'plano');
      for (const largura of [1280, 375]) { await pD.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pD.waitForTimeout(300); await print(pD, `admin-clientes-${largura}.png`); }
    });
    await passo('dono: muda a Empresa para Assessoria ativa e a conta passa a aceitar o 2º CNPJ', null, async () => {
      await pD.setViewportSize({ width: 1280, height: 900 });
      await pD.click(`#conteudo-lista button[data-detalhe="${E.id}"]`);
      await pD.waitForSelector('#ass-plano', { timeout: 20000 });
      await pD.selectOption('#ass-plano', 'assessoria');
      await pD.selectOption('#ass-situacao', 'ativa');
      await pD.fill('#ass-max-cnpjs', '5');
      await pD.click('#btn-salvar-plano');
      await pD.waitForFunction(() => document.getElementById("resultado-plano-salvo") || /Não foi possível|Confira/.test(document.getElementById("resultado-plano")?.textContent || ""), null, { timeout: 20000 })
        .catch(async () => { throw new Error('resultado: ' + await pD.evaluate(() => document.getElementById('bloco-plano')?.innerText.slice(0, 300))); });
      const falha = await pD.evaluate(() => document.getElementById('resultado-plano')?.textContent || '');
      exigir(!/Não foi possível|Confira/.test(falha), falha);
      await pD.waitForSelector('#ass-plano', { timeout: 20000 });
      for (const largura of [1280, 375]) { await pD.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pD.waitForTimeout(300); await print(pD, `admin-conta-plano-${largura}.png`); }
      const a = (await servico('GET', `/rest/v1/assinaturas?usuario_id=eq.${E.id}&select=plano,situacao,max_cnpjs`))[0];
      exigir(a.plano === 'assessoria' && a.situacao === 'ativa' && a.max_cnpjs === 5, 'assinatura: ' + JSON.stringify(a));
      const org = JSON.parse((await comoUsuario(tE.access_token, 'GET', '/rest/v1/operacao_organizacoes?select=id')).corpo)[0].id;
      const r = await comoUsuario(tE.access_token, 'POST', '/rest/v1/operacao_empresas', { organizacao_id: org, razao_social: 'Segunda empresa depois do upgrade' });
      exigir(r.status === 201, `2º CNPJ após mudança: ${r.status} ${r.corpo.slice(0, 200)}`);
      return JSON.stringify(a);
    });
    await passo('dono: abas Planos, Clientes (uso) e Cobrança (registra Pix recebido à mão)', null, async () => {
      await pD.keyboard.press('Escape');
      await pD.evaluate(() => document.getElementById('modal-detalhe-fundo').classList.remove('aberto'));
      await pD.setViewportSize({ width: 1280, height: 900 });
      await pD.click('.tabs button[data-status="planos"]');
      await pD.waitForSelector('#conteudo-planos table', { timeout: 20000 });
      for (const largura of [1280, 375]) { await pD.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pD.waitForTimeout(300); await print(pD, `admin-planos-${largura}.png`); }
      await pD.setViewportSize({ width: 1280, height: 900 });
      await pD.click('.tabs button[data-status="clientes"]');
      await pD.waitForSelector('#conteudo-uso table, #conteudo-uso .vazio', { timeout: 20000 });
      await pD.click('.tabs button[data-status="cobranca"]');
      await pD.waitForFunction(() => document.querySelectorAll('#pag-conta option').length > 1, null, { timeout: 20000 });
      await pD.selectOption('#pag-conta', A.id);
      await pD.selectOption('#pag-plano', 'assessoria');
      await pD.check('#pag-pago');
      await pD.fill('#pag-referencia', 'Pix fictício e2e');
      await pD.click('#form-pagamento button[type="submit"]');
      await pD.waitForFunction(() => /registrado/.test(document.getElementById('resultado-pagamento').textContent) || /Não foi/.test(document.getElementById('resultado-pagamento').textContent), null, { timeout: 20000 });
      const texto = await pD.innerText('#resultado-pagamento');
      exigir(/assinatura ativada/.test(texto), texto);
      await pD.waitForSelector('#conteudo-pagamentos table', { timeout: 20000 });
      for (const largura of [1280, 375]) { await pD.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pD.waitForTimeout(300); await print(pD, `admin-financeiro-${largura}.png`); }
      const a = (await servico('GET', `/rest/v1/assinaturas?usuario_id=eq.${A.id}&select=situacao,vence_em`))[0];
      exigir(a.situacao === 'ativa' && a.vence_em, 'assinatura da Assessoria: ' + JSON.stringify(a));
      return texto;
    });
    // ---------------- 21/11: planos novos, fim do Grátis, extras e uso justo ----------------
    await passo('dono: liga Lance assistido e IA extra do mês na assinatura (aba Clientes)', null, async () => {
      await pD.setViewportSize({ width: 1280, height: 900 });
      await pD.click('.tabs button[data-status="clientes"]');
      await pD.click('.filtros button[data-filtro="todos"]');
      await pD.click(`#conteudo-lista button[data-detalhe="${E.id}"]`);
      await pD.waitForSelector('#ass-extra-lance', { timeout: 20000 });
      await pD.check('#ass-extra-lance');
      await pD.fill('#ass-ia-extra', '500');
      for (const largura of [1280, 375]) { await pD.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pD.waitForTimeout(300); await print(pD, `admin-extras-${largura}.png`); }
      await pD.setViewportSize({ width: 1280, height: 900 });
      await pD.click('#btn-salvar-plano');
      await pD.waitForFunction(() => document.getElementById('resultado-plano-salvo') || /Não foi possível|Confira/.test(document.getElementById('resultado-plano')?.textContent || ''), null, { timeout: 20000 });
      const a = (await servico('GET', `/rest/v1/assinaturas?usuario_id=eq.${E.id}&select=extras,ia_extra_usos,ia_extra_mes`))[0];
      exigir(a.extras.includes('lance_assistido') && a.ia_extra_usos === 500 && /-01$/.test(a.ia_extra_mes), 'extras: ' + JSON.stringify(a));
      exigir(/IA no mês: \d+ de \d+/.test(await pD.innerText('#bloco-plano')), 'admin não mostra a IA do mês');
      await pD.keyboard.press('Escape');
      await pD.evaluate(() => document.getElementById('modal-detalhe-fundo').classList.remove('aberto'));
      return JSON.stringify(a);
    });
    const pV = await novaPagina(navegador);
    await passo('página de venda: 3 planos, extras, teste de 14 dias, sem Grátis e sem número de IA', null, async () => {
      for (const largura of [1280, 375]) {
        await pV.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 });
        await pV.goto(SITE + '/index.html#planos');
        const t = await pV.innerText('#planos');
        exigir(/R\$ 127/.test(t) && /R\$ 249/.test(t) && /R\$ 697/.test(t) && /Lance assistido/.test(t) && /14 dias/.test(t) && /uso justo/.test(t), 'planos: ' + t.slice(0, 300));
        exigir(!/grátis para sempre|plano grátis|usos de IA|\d+ usos/i.test(await pV.innerText('body')), 'promessa de Grátis ou número de IA na página');
        exigir(await semRolagem(pV), 'rolagem horizontal na página de venda ' + largura);
        await pV.locator('#planos').screenshot({ path: path.join(PRINTS, `venda-planos-${largura}.png`) });
        await pV.goto(SITE + '/cadastro.html');
        exigir(/Essencial/.test(await pV.innerText('body')) && !/plano Grátis/i.test(await pV.innerText('body')), 'cadastro sem Essencial ou com Grátis');
        exigir(await semRolagem(pV), 'rolagem horizontal no cadastro ' + largura);
      }
    });
    const S = await conta('plano-essencial', 'Essencial Plano Teste', 'essencial');
    const T = await conta('plano-vencido', 'Vencido Plano Teste', 'empresa');
    await servico('PATCH', `/rest/v1/assinaturas?usuario_id=eq.${S.id}`, { plano: 'essencial', situacao: 'ativa', vence_em: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) });
    await servico('PATCH', `/rest/v1/assinaturas?usuario_id=eq.${T.id}`, { teste_ate: new Date(Date.now() - 864e5).toISOString() });
    Object.assign(seed.usuarios, { plano_essencial: S, plano_vencido: T });
    fs.writeFileSync(SEED, JSON.stringify(seed, null, 2));
    const pS = await novaPagina(navegador);
    await entrar(pS, S);
    await passo('essencial: Mercado, Preços, Convênios, Concorrente e Proposta travados, sem botão do Chat; Prospecção travada também no banco', null, async () => {
      for (const [secao, rotulo] of [['diagnostico', 'Mercado'], ['precos', 'Pesquisa de Preços'], ['transparencia', 'Convênios'], ['empresa', 'Análise por CNPJ']]) {
        await pS.goto(SITE + '/painel.html#' + secao);
        await pS.waitForSelector(`#${secao} .trava-plano`, { timeout: 30000 });
        const t = await pS.innerText(`#${secao} .trava-plano`);
        exigir(/não está no seu plano/.test(t) && new RegExp(rotulo).test(t), `${secao}: ${t}`);
        exigir(await pS.getAttribute(`#${secao} .trava-plano a`, 'href') === 'assinar.html', 'botão sem destino');
      }
      await pS.goto(SITE + '/painel.html#boletim');
      await pS.waitForTimeout(3000);
      exigir(!(await pS.$('#boletim .trava-plano')), 'boletim travado no Essencial');
      await pS.goto(SITE + '/prospeccao.html');
      await pS.waitForSelector('main .trava-plano', { timeout: 30000 });
      for (const largura of [1280, 375]) { await pS.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pS.waitForTimeout(300); await print(pS, `essencial-prospeccao-${largura}.png`); exigir(await semRolagem(pS), 'rolagem ' + largura); }
      // Chat com IA fora do plano: o botão some (antes levava a "não está no plano").
      await pS.goto(SITE + '/painel.html#boletim');
      await pS.waitForTimeout(4000);
      exigir(!(await visivel(pS, '#chat-ia-btn')), 'botão do Chat IA visível no Essencial');
      // Proposta e declarações no dossiê do processo: travada com o mesmo aviso, sem botão que leva a erro.
      // As telas já criaram a organização da conta (bootstrap_operacao); só cria se ainda não houver.
      const [org] = (await servico('GET', `/rest/v1/operacao_organizacoes?owner_id=eq.${S.id}&select=id`)).length
        ? await servico('GET', `/rest/v1/operacao_organizacoes?owner_id=eq.${S.id}&select=id`)
        : await servico('POST', '/rest/v1/operacao_organizacoes', { nome: 'Org Essencial (fictícia)', owner_id: S.id });
      if (!(await servico('GET', `/rest/v1/operacao_membros?organizacao_id=eq.${org.id}&usuario_id=eq.${S.id}&select=usuario_id`)).length)
        await servico('POST', '/rest/v1/operacao_membros', { organizacao_id: org.id, usuario_id: S.id, papel: 'gestor' });
      // A empresa do cadastro pode já existir (1 CNPJ no Essencial): reaproveita.
      const [emp] = (await servico('GET', `/rest/v1/operacao_empresas?organizacao_id=eq.${org.id}&ativo=eq.true&select=id`)).length
        ? await servico('GET', `/rest/v1/operacao_empresas?organizacao_id=eq.${org.id}&ativo=eq.true&select=id`)
        : await servico('POST', '/rest/v1/operacao_empresas', { organizacao_id: org.id, razao_social: 'Essencial Plano Teste LTDA (fictícia)' });
      const [proc] = await servico('POST', '/rest/v1/operacao_processos', { organizacao_id: org.id, empresa_id: emp.id, objeto: 'Papel A4 (teste do Essencial)' });
      for (const largura of [1280, 375]) {
        await pS.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 });
        await pS.goto(SITE + `/processos.html?empresa=${emp.id}&processo=${proc.id}`);
        await pS.waitForSelector('#d-kit-documentos .trava-plano', { timeout: 30000 });
        exigir(/Proposta e declarações/.test(await pS.innerText('#d-kit-documentos')), 'aviso da proposta');
        exigir(!(await pS.evaluate(() => [...document.querySelectorAll('#d-kit-documentos button')].some((b) => b.offsetParent))), 'botão da proposta visível');
        exigir(!(await visivel(pS, '#chat-ia-btn')), 'botão do Chat IA visível em processos');
        exigir(await semRolagem(pS), 'rolagem processos ' + largura);
        await print(pS, `essencial-proposta-${largura}.png`);
      }
      const tS = await token(S);
      const r = await comoUsuario(tS.access_token, 'GET', '/rest/v1/prospeccao_itens?select=id&limit=1');
      exigir(r.status === 200 && r.corpo === '[]', 'RLS de Prospecção: ' + r.status + ' ' + r.corpo.slice(0, 100));
      const pl = JSON.parse((await comoUsuario(tS.access_token, 'POST', '/rest/v1/rpc/meu_plano', {})).corpo);
      exigir(pl.plano === 'essencial' && !('ia_mes' in pl), 'meu_plano do Essencial: ' + JSON.stringify(pl).slice(0, 200));
    });
    const pT = await novaPagina(navegador);
    await entrar(pT, T);
    await passo('teste vencido: telas travadas com "Assinar" (aviso fixo) e ferramenta recusada no servidor', null, async () => {
      for (const tela of ['painel.html', 'operacao.html', 'sistema.html']) {
        await pT.goto(SITE + '/' + tela);
        await pT.waitForSelector('main .trava-plano', { timeout: 30000 });
        exigir(/Seu teste grátis terminou/.test(await pT.innerText('main .trava-plano')), tela + ': sem aviso');
        exigir((await pT.$$('.trava-plano')).length === 1, tela + ': mais de um aviso');
        exigir(!(await visivel(pT, '#chat-ia-btn')), tela + ': botão do Chat IA visível no teste vencido');
      }
      for (const largura of [1280, 375]) { await pT.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 }); await pT.waitForTimeout(300); await print(pT, `teste-vencido-${largura}.png`); exigir(await semRolagem(pT), 'rolagem ' + largura); }
      await Promise.all([pT.waitForURL(/assinar\.html/, { timeout: 20000 }), pT.click('main .trava-plano a')]);
      const tT = await token(T);
      // Sanções: rota com cota que não depende de chave de IA no ambiente local; a regra é a mesma de todas (consumir_uso_plano).
      const ia = await fetch(SITE + '/api/sancoes?cnpj=11222333000181', { headers: { Authorization: 'Bearer ' + tT.access_token } });
      const corpo = await ia.text();
      exigir(ia.status === 403 && /teste grátis terminou/.test(corpo), 'ferramenta no teste vencido: ' + ia.status + ' ' + corpo.slice(0, 160));
      return `${ia.status} ${corpo.slice(0, 120)}`;
    });
    const erros = [pE, pA, pD, pV, pS, pT].flatMap(p => p.erros).filter(e => !/favicon|turnstile|challenges\.cloudflare|fonts\.g/i.test(e));
    await passo('sem erro de página nas três contas', null, async () => { exigir(!erros.some(e => /pageerror/.test(e)), erros.join(' | ')); return erros.slice(0, 5).join(' | ') || 'nenhum'; });
  } finally { await navegador.close(); }
  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 2));
  const falhas = resultados.filter(r => !r.ok).length;
  console.log(falhas ? `E2E PLANOS: ${falhas} FALHA(S)` : 'E2E PLANOS OK');
  process.exit(falhas ? 1 : 0);
}
main().catch(e => { console.error('E2E PLANOS FALHOU:', e.message); process.exit(1); });
