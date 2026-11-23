/* global document, window, localStorage */
// E2E do painel do dono reorganizado (admin.html + supabase/admin_painel.sql). Ambiente: subir.cjs + servidor.cjs.
//   PORTA_TESTE=8788 node ambiente-teste/servidor.cjs
//   node ambiente-teste/e2e-admin.cjs
// Clica em TODAS as abas do menu e confere que nenhum botão está morto, a 1280 e 375 px, e os atalhos que ligam as
// telas: Hoje -> pedido / cobrança / robôs / falhas do boletim; pedido -> cliente; cliente -> Cobrança; boletim -> busca.
// Contas e dados fictícios. Nada é enviado (o link do WhatsApp só é lido).
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/admin-reorganizado-20261122/depois';
const { passo, exigir, novaPagina, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
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
const hojeBr = () => new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00Z');
const iso = (dias) => { const d = hojeBr(); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const ABAS = ['visao', 'pedidos', 'cobranca', 'clientes', 'planos', 'normas', 'saude', 'boletim', 'equipe'];
// Atalhos ligados por delegação no document (admin.html: data-ir-aba / data-abrir-conta).
const DELEGADOS = '[data-ir-aba], [data-abrir-conta]';

// Botão "morto" = visível, habilitado, sem listener de clique nele, sem atalho delegado, fora de formulário e não é link.
async function botoesMortos(p, cdp) {
  const ids = await p.evaluate((delegados) => {
    window.__alvos = [...document.querySelectorAll('#painel button, #painel a')].filter((el) => el.offsetParent !== null && !el.disabled);
    return window.__alvos.map((el, i) => ({ i, texto: (el.textContent || '').trim().slice(0, 40), tag: el.tagName, href: el.getAttribute('href'),
      form: !!el.closest('form') && (el.type === 'submit' || !el.getAttribute('type')), delegado: el.matches(delegados) }));
  }, DELEGADOS);
  const mortos = [];
  for (const b of ids) {
    if (b.tag === 'A') { if (!b.href || b.href === '#') mortos.push(b.texto); continue; }
    if (b.form || b.delegado) continue;
    const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__alvos[${b.i}]` });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    if (!listeners.some((l) => l.type === 'click')) mortos.push(b.texto);
  }
  return { total: ids.length, mortos };
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const C = await conta('admin-e2e-cliente', 'Cliente Painel Dono Teste', 'empresa');
  const D = await conta('admin-e2e-dono', 'Dono Painel Teste', null, true);
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  Object.assign(seed.usuarios, { admin_e2e_cliente: C, admin_e2e_dono: D });
  fs.writeFileSync(SEED, JSON.stringify(seed, null, 2));
  // Cliente Empresa que venceu há 1 dia (na carência), com telefone, pedido aberto, um envio e uma falha do boletim.
  await servico('PATCH', `/rest/v1/clientes?id=eq.${C.id}`, { telefone: '92900000001' });
  await servico('PATCH', `/rest/v1/assinaturas?usuario_id=eq.${C.id}`, { plano: 'empresa', situacao: 'ativa', ciclo: 'mensal', valor_centavos: 24900, vence_em: iso(-1) });
  await servico('PATCH', '/rest/v1/config_cobranca?id=eq.1', { carencia_dias: 3 });
  const tC = await token(C);
  const ped = await comoUsuario(tC.access_token, 'POST', '/rest/v1/rpc/pedir_assinatura', { p_plano: 'empresa', p_ciclo: 'semestral' });
  exigir(ped.status === 200, 'pedido: ' + ped.status + ' ' + ped.corpo.slice(0, 200));
  await servico('POST', '/rest/v1/logs_boletim', [
    { cliente_id: C.id, cliente_email: C.email, cliente_nome: C.nome, status: 'enviado', quantidade_editais: 3, mensagem_erro: null },
    { cliente_id: C.id, cliente_email: C.email, cliente_nome: C.nome, status: 'erro', quantidade_editais: 0, mensagem_erro: "(550, b'5.1.1 user unknown')" }]);
  // Robôs: cobrança em dia, boletim parado (3 dias e meio), o resto sem registro.
  await servico('POST', '/rest/v1/rpc/robo_registrar_sucesso', { p_robo: 'cobranca' });
  await servico('PATCH', '/rest/v1/robos_batimento?robo=eq.cobranca', { ultimo_sucesso: new Date(Date.now() - 2 * 3600000).toISOString() });
  await servico('POST', '/rest/v1/rpc/robo_registrar_sucesso', { p_robo: 'lembretes' });
  await servico('PATCH', '/rest/v1/robos_batimento?robo=eq.lembretes', { ultimo_sucesso: new Date(Date.now() - 84 * 3600000).toISOString() });
  const link = `https://portal.tcu.gov.br/teste-e2e-admin-${Date.now()}`;
  await servico('POST', '/rest/v1/orcamento_normas_novidades', { fonte: 'TCU', titulo: 'Acórdão fictício sobre BDI (teste)', link, publicado_em: iso(-2) });

  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  try {
    const tD = await token(D);
    await passo('cliente e dono sem 2 fatores não leem boletim nem saúde; ninguém grava batimento pelo navegador', null, async () => {
      for (const t of [tC.access_token, tD.access_token]) {
        const b = await comoUsuario(t, 'POST', '/rest/v1/rpc/admin_boletim_resumo', { p_dias: 14 });
        const s = await comoUsuario(t, 'POST', '/rest/v1/rpc/admin_saude_robos', {});
        const r = await comoUsuario(t, 'POST', '/rest/v1/rpc/robo_registrar_sucesso', { p_robo: 'pncp' });
        const l = await comoUsuario(t, 'GET', '/rest/v1/logs_boletim?select=id');
        exigir(b.status >= 400 && s.status >= 400 && r.status >= 400 && (l.status >= 400 || l.corpo === '[]'), `recusa: ${b.status}/${s.status}/${r.status}/${l.status}`);
      }
    });
    const segredo = segredoLocal();
    const payload = JSON.parse(Buffer.from(tD.access_token.split('.')[1], 'base64url').toString());
    const tokenAal2 = assinarJwt({ ...payload, aal: 'aal2', amr: [{ method: 'password', timestamp: payload.iat }, { method: 'totp', timestamp: payload.iat }] }, segredo);
    const pD = await novaPagina(navegador);
    pD.on('dialog', d => d.dismiss()); // nenhuma ação de dinheiro é confirmada aqui: só se confere que ela pergunta antes
    const fator = { id: '00000000-0000-4000-8000-0000000000f4', friendly_name: 'teste', factor_type: 'totp', status: 'verified', created_at: '2026-11-22T00:00:00Z', updated_at: '2026-11-22T00:00:00Z' };
    await pD.route('**/auth/v1/user', async rota => { const r = await rota.fetch(); const u = await r.json(); await rota.fulfill({ response: r, json: { ...u, factors: [fator] } }); });
    await pD.route('https://wa.me/**', rota => rota.abort());
    await pD.goto(SITE + '/admin.html');
    await pD.evaluate(({ chave, sessao }) => localStorage.setItem(chave, JSON.stringify(sessao)), {
      chave: 'sb-127-auth-token',
      sessao: { access_token: tokenAal2, refresh_token: tD.refresh_token, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, user: { ...tD.user, factors: [fator] } } });
    const cdp = await pD.context().newCDPSession(pD);

    await passo('Hoje: o que fazer agora, com números no menu (Pedidos, Cobrança, Normas, Saúde, Boletim)', null, async () => {
      await pD.setViewportSize({ width: 1280, height: 900 });
      await pD.reload();
      await pD.waitForSelector('#painel .card-num', { timeout: 30000 });
      await pD.waitForFunction(() => !document.querySelector('[data-contador="pedidos"]').hidden, null, { timeout: 20000 });
      const t = await pD.innerText('#lista-avisos');
      exigir(/Pedido aguardando o Pix/.test(t) && /Cliente Painel Dono Teste/.test(t) && /na carência/.test(t) && /normas de obra para revisar/.test(t) && /Lembretes de prazo/.test(t) && /boletim/.test(t), 'Hoje: ' + t);
      const nums = await pD.$$eval('.tabs button', bs => bs.map(b => b.innerText.replace(/\s+/g, ' ').trim()));
      for (const aba of ['pedidos', 'cobranca', 'normas', 'saude', 'boletim']) exigir(await pD.isVisible(`[data-contador="${aba}"]`), 'sem número em ' + aba + ': ' + nums.join(' | '));
      exigir(await pD.locator('.tabs button').count() === 9, 'menu com ' + await pD.locator('.tabs button').count() + ' itens');
      return nums.join(' | ');
    });

    for (const largura of [1280, 375]) {
      await passo(`todas as abas a ${largura} px: título, frase do que fazer, sem rolagem lateral e nenhum botão morto`, null, async () => {
        await pD.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 });
        const notas = [];
        for (const aba of ABAS) {
          await pD.click(`.tabs button[data-status="${aba}"]`);
          await pD.waitForTimeout(1200);
          await pD.waitForFunction(() => ![...document.querySelectorAll('#painel main > div')].some(d => d.style.display === 'block' && d.querySelector('.carregando')), null, { timeout: 20000 })
            .catch(() => {});
          const info = await pD.evaluate((a) => { const s = document.getElementById('secao-' + a); return { visivel: s.style.display === 'block', titulo: s.querySelector('.titulo-tela')?.textContent || '', frase: s.querySelector('.frase-tela')?.textContent || '', ativo: document.querySelector('.tabs button.ativo')?.dataset.status }; }, aba);
          exigir(info.visivel && info.ativo === aba && info.titulo && info.frase.length > 30, `${aba}: ${JSON.stringify(info)}`);
          exigir(await semRolagem(pD), `${aba}: rolagem lateral a ${largura}`);
          const { total, mortos } = await botoesMortos(pD, cdp);
          exigir(!mortos.length, `${aba}: botões sem ação: ${mortos.join(', ')}`);
          notas.push(`${aba}:${total}`);
          await pD.screenshot({ path: path.join(PRINTS, `admin-${aba}-${largura}.png`), fullPage: true });
        }
        return 'botões vivos por aba: ' + notas.join(' ');
      });
    }

    await pD.setViewportSize({ width: 1280, height: 900 });
    await passo('Hoje -> "Ver pedido" abre Pedidos com o pedido destacado; "Abrir cliente" abre a ficha com pedidos, pagamentos e cobrança', null, async () => {
      await pD.click('.tabs button[data-status="visao"]');
      await pD.waitForSelector('#lista-avisos [data-ir-aba="pedidos"]', { timeout: 20000 });
      await pD.click('#lista-avisos [data-ir-aba="pedidos"]');
      const cartao = `[data-pedido-usuario="${C.id}"]`;
      await pD.waitForSelector(`${cartao}.destaque-alvo`, { timeout: 20000 });
      exigir(await pD.isVisible('#secao-pedidos'), 'Pedidos não abriu');
      await pD.click(`${cartao} [data-abrir-conta]`);
      await pD.waitForSelector('#modal-detalhe-fundo.aberto #bloco-financeiro ul', { timeout: 20000 });
      const f = await pD.innerText('#bloco-financeiro');
      exigir(/Semestral/.test(f) && /Aguardando o Pix/.test(f) && /Cobrar no WhatsApp/.test(f) && /Ver na Cobrança/.test(f), 'ficha: ' + f);
      const zap = await pD.getAttribute('#bloco-financeiro a:has-text("Cobrar no WhatsApp")', 'href');
      exigir(zap.startsWith('https://wa.me/5592900000001?text=') && /249,00/.test(decodeURIComponent(zap)), 'whatsapp: ' + zap);
      await pD.screenshot({ path: path.join(PRINTS, 'admin-ficha-cliente-1280.png'), fullPage: true });
      return f.replace(/\s+/g, ' ').slice(0, 200);
    });
    await passo('ficha do cliente -> "Ver na Cobrança" fecha a ficha e destaca a linha; ali "Abrir cliente" volta para a ficha', null, async () => {
      await pD.click('#bloco-financeiro [data-ir-aba="cobranca"]');
      const linha = `#cobranca-em_atraso tr[data-cobranca="${C.id}"]`;
      await pD.waitForSelector(`${linha}.destaque-alvo`, { timeout: 20000 });
      exigir(!(await pD.isVisible('#modal-detalhe-fundo.aberto')), 'ficha continuou aberta');
      await pD.click(`${linha} [data-abrir-conta]`);
      await pD.waitForSelector('#modal-detalhe-fundo.aberto #ass-ciclo', { timeout: 20000 });
      exigir(await pD.$$eval('#ass-ciclo option', os => os.map(o => o.textContent).join(',')) === '-,Mensal,Semestral,Anual', 'ciclos da assinatura');
      await pD.click('#modal-detalhe-fechar');
    });
    await passo('ações de dinheiro e bloqueio perguntam antes (Liberar, Renovar, Carência); cancelado, nada muda no banco', null, async () => {
      const perguntas = [];
      const ouvir = d => perguntas.push(d.message());
      pD.on('dialog', ouvir);
      await pD.click(`#cobranca-em_atraso tr[data-cobranca="${C.id}"] [data-renovar]`);
      await pD.fill('#carencia-dias', '7');
      await pD.click('#form-carencia button[type="submit"]');
      await pD.click('.tabs button[data-status="pedidos"]');
      await pD.waitForSelector(`[data-pedido-usuario="${C.id}"] [data-decidir="liberar"]`, { timeout: 20000 });
      await pD.click(`[data-pedido-usuario="${C.id}"] [data-decidir="liberar"]`);
      await pD.waitForTimeout(500);
      pD.off('dialog', ouvir);
      exigir(perguntas.length === 3, 'perguntas: ' + perguntas.join(' | '));
      const a = (await servico('GET', `/rest/v1/assinaturas?usuario_id=eq.${C.id}&select=vence_em`))[0];
      const c = await servico('GET', '/rest/v1/config_cobranca?select=carencia_dias');
      exigir(a.vence_em === iso(-1) && c[0].carencia_dias === 3, 'mudou sem confirmar: ' + JSON.stringify([a, c]));
      return perguntas.map(q => q.slice(0, 50)).join(' | ');
    });
    await passo('Hoje -> "Ver robôs" e "Ver falhas"; Saúde mostra os 10 robôs e a cobertura dos estados; Boletim responde "o cliente recebeu?"', null, async () => {
      await pD.click('.tabs button[data-status="visao"]');
      await pD.waitForSelector('#lista-avisos [data-ir-aba="saude"]', { timeout: 20000 });
      await pD.click('#lista-avisos [data-ir-aba="saude"]');
      await pD.waitForSelector('#conteudo-saude .robo', { timeout: 20000 });
      exigir(await pD.locator('#conteudo-saude .robo').count() === 10, 'robôs: ' + await pD.locator('#conteudo-saude .robo').count());
      exigir(await pD.getAttribute('[data-robo="lembretes"]', 'data-nivel') === 'parado' && await pD.getAttribute('[data-robo="cobranca"]', 'data-nivel') === 'ok', 'níveis dos robôs');
      exigir(/estados/i.test(await pD.innerText('#saude-cobertura')), 'cobertura dos estados');
      const saude = await pD.innerText('#conteudo-saude');
      exigir(!/\bUF\b|PNCP\/base|null|undefined|NaN/.test(saude), 'jargão na Saúde: ' + saude.slice(0, 200));
      // Status das Ferramentas (saiu do painel do cliente em 23/11): os 6 cartões das fontes, com o "Afeta:" e o Atualizar.
      const statusPronto = () => pD.waitForFunction(() => document.querySelectorAll('#status-cartoes .cartao-fonte').length === 6 && !/Verificando/.test(document.getElementById('status-cartoes').innerText), null, { timeout: 30000 });
      await statusPronto();
      await pD.click('#status-atualizar');
      await statusPronto();
      const fontes = await pD.innerText('#status-cartoes');
      exigir(/Editais e licitações \(PNCP\)/.test(fontes) && /Prospecção/.test(fontes) && (fontes.match(/Afeta:/g) || []).length === 6 && !/null|undefined|NaN/.test(fontes), 'status das ferramentas: ' + fontes.slice(0, 200));
      await pD.click('.tabs button[data-status="visao"]');
      await pD.waitForSelector('#lista-avisos [data-ir-aba="boletim"]', { timeout: 20000 });
      await pD.click('#lista-avisos [data-ir-aba="boletim"]');
      await pD.waitForSelector('#conteudo-boletim-falhas.destaque-alvo, #conteudo-boletim-falhas table', { timeout: 20000 });
      const falhas = await pD.innerText('#conteudo-boletim-falhas');
      exigir(/não existe ou recusou/.test(falhas) && !/user unknown/.test(falhas), 'motivo: ' + falhas);
      const resumo = await pD.locator('#conteudo-boletim tbody tr').count();
      exigir(resumo >= 1 && resumo <= 14, 'linhas do resumo: ' + resumo);
      await pD.fill('#boletim-busca', 'admin-e2e-cliente');
      await pD.click('#form-boletim-busca button[type="submit"]');
      await pD.waitForSelector('#resultado-boletim-busca table', { timeout: 20000 });
      const busca = await pD.innerText('#resultado-boletim-busca');
      exigir(/Recebeu 3 editais/.test(busca) && /Não recebeu/.test(busca), 'busca: ' + busca);
      await pD.screenshot({ path: path.join(PRINTS, 'admin-boletim-busca-1280.png'), fullPage: true });
      return busca.replace(/\s+/g, ' ').slice(0, 160);
    });
    await passo('Normas de obra: a novidade aparece e "Revisar normas" leva a normas-obra.html', null, async () => {
      await pD.click('.tabs button[data-status="normas"]');
      await pD.waitForSelector('#conteudo-normas .aviso-item', { timeout: 20000 });
      exigir(/Acórdão fictício sobre BDI/.test(await pD.innerText('#conteudo-normas')), 'novidade');
      exigir(await pD.getAttribute('#link-normas-obra', 'href') === 'normas-obra.html', 'link de normas');
      exigir((await pD.getAttribute('#conteudo-normas a', 'href')) === link, 'link da fonte');
    });
    await servico('DELETE', `/rest/v1/orcamento_normas_novidades?link=eq.${encodeURIComponent(link)}`);
    const erros = pD.erros.filter(e => !/favicon|hcaptcha|fonts\.g|wa\.me/i.test(e));
    await passo('sem erro de página nem de console', null, async () => { exigir(!erros.some(e => /pageerror|console/.test(e)), erros.join(' | ')); return erros.slice(0, 5).join(' | ') || 'nenhum'; });
  } finally {
    await navegador.close();
  }
  fs.writeFileSync(path.join(PRINTS, 'resultado-admin.json'), JSON.stringify(resultados, null, 2));
  const falhas = resultados.filter(r => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length} de ${resultados.length}` : `OK: ${resultados.length} de ${resultados.length}`);
  process.exit(falhas.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
