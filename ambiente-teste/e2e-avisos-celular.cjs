/* global document, navigator */
// E2E do "LicitaPlena no celular" (PWA + aviso no celular). Ambiente: subir.cjs + servidor.cjs rodando com a chave
// PÚBLICA de um par VAPID de TESTE (node scripts/gerar_chaves_vapid.js <arquivo fora do repo>):
//   VAPID_CHAVE_PUBLICA=... PORTA_TESTE=8899 node ambiente-teste/servidor.cjs
//   VAPID_TESTE=<arquivo do par de teste> SITE_TESTE=http://127.0.0.1:8899 node ambiente-teste/e2e-avisos-celular.cjs
// Navegador com perfil próprio (push não funciona em janela anônima) e notificação liberada. Ativa os avisos pela
// gaveta, confere a inscrição gravada no Supabase local, roda o robô (aviso de teste + lembrete de prazo vencendo) e
// espera a notificação chegar ao service worker (serviço de push real do navegador). Apaga o que criou no fim.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-pwa';
const { passo, exigir, entrar, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const RAIZ = path.resolve(__dirname, '..');
if (!process.env.VAPID_TESTE || !fs.existsSync(process.env.VAPID_TESTE)) {
  console.error('FALHOU: falta VAPID_TESTE (arquivo com um par VAPID de TESTE fora do repo: node scripts/gerar_chaves_vapid.js <arquivo>).\n' +
    'O servidor.cjs precisa rodar com VAPID_CHAVE_PUBLICA desse mesmo par. Nunca use as chaves reais.');
  process.exit(1);
}
const vapid = Object.fromEntries(fs.readFileSync(process.env.VAPID_TESTE, 'utf8').split(/\r?\n/).filter((l) => /^VAPID_/.test(l)).map((l) => l.split('=')));

async function servico(metodo, caminho, corpo) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
function robo(env = {}) {
  const r = spawnSync(process.execPath, ['-r', './ambiente-teste/redirecionar-fetch.cjs', 'scripts/avisos_celular.js'],
    { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, ...vapid, AMBIENTE_TESTE_REDIRECIONAR: '1', SITE_URL: SITE, ...env } });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}
// Notificações mostradas pelo service worker (o que o celular exibiria), lidas na própria página.
const notificacoes = (p) => p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title} | ${n.body}`));
async function esperarNotificacao(p, re, voltas = 60) {
  for (let i = 0; i < voltas; i++) { // até 30 s: o serviço de push real (WNS/FCM) às vezes demora
    const ns = await notificacoes(p);
    if (ns.some((n) => re.test(n))) return ns;
    await p.waitForTimeout(500);
  }
  throw new Error('notificação não chegou ao service worker: ' + JSON.stringify(await notificacoes(p)));
}

async function main() {
  const U = seed.usuarios.gestor;
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-pwa-'));
  const ctx = await chromium.launchPersistentContext(perfil, { channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1',
    viewport: { width: 1280, height: 900 }, locale: 'pt-BR', permissions: ['notifications'] });
  let lembrete = null;
  try {
    await servico('DELETE', `/rest/v1/avisos_celular_inscricoes?usuario_id=eq.${U.id}`);
    const p = ctx.pages()[0] || await ctx.newPage();
    p.erros = [];
    p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
    await entrar(p, U);

    await passo('manifesto, ícones e service worker', null, async () => {
      await p.goto(`${SITE}/sistema`);
      await p.waitForSelector('#celular-btn', { timeout: 20000 });
      const m = await (await fetch(`${SITE}/manifest.webmanifest`)).json();
      exigir(m.display === 'standalone' && m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), 'manifesto incompleto');
      for (const ic of ['/icone-192.png', '/icone-512.png', '/apple-touch-icon.png']) exigir((await fetch(SITE + ic)).ok, ic + ' não servido');
      const sw = await p.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
      exigir(/\/sw\.js$/.test(sw), 'service worker não ativo');
      const head = await p.evaluate(() => [...document.head.querySelectorAll('link[rel=manifest],link[rel=apple-touch-icon]')].map((l) => l.rel).join(','));
      return `${m.name} · SW ${sw.replace(SITE, '')} · head: ${head}`;
    });

    await passo('ativar avisos pela gaveta grava a inscrição', null, async () => {
      await p.click('#celular-btn');
      await p.waitForSelector('#celular-corpo button.lp-primario:has-text("Ativar avisos")', { timeout: 20000 });
      await p.locator('.lp-gaveta').screenshot({ path: path.join(PRINTS, 'pwa-1280-1-gaveta.png') });
      await p.click('#celular-corpo button:has-text("Ativar avisos")');
      await p.waitForSelector('#celular-corpo button:has-text("Desligar avisos")', { timeout: 30000 });
      await p.locator('.lp-gaveta').screenshot({ path: path.join(PRINTS, 'pwa-1280-2-ativado.png') });
      const linhas = await servico('GET', `/rest/v1/avisos_celular_inscricoes?usuario_id=eq.${U.id}&select=endpoint,aparelho,criado_em`);
      exigir(linhas.length === 1, `esperava 1 inscrição, veio ${linhas.length}`);
      return `inscrição gravada: ${new URL(linhas[0].endpoint).hostname} · ${linhas[0].aparelho}`;
    });

    await passo('preferência por tipo salva na conta', null, async () => {
      await p.uncheck('#celular-corpo input[name=certidao]');
      await p.waitForSelector('#celular-corpo p:has-text("Salvo.")');
      const [pref] = await servico('GET', `/rest/v1/avisos_celular_preferencias?usuario_id=eq.${U.id}&select=edital,prazo,pregoeiro,certidao`);
      exigir(pref && pref.certidao === false && pref.prazo === true, 'preferência não gravada');
      await p.check('#celular-corpo input[name=certidao]');
      await p.waitForTimeout(800);
      return JSON.stringify(pref);
    });

    await passo('robô: aviso de teste chega ao service worker', null, async () => {
      let saida = robo({ AVISO_TESTE_USUARIO: U.id });
      exigir(/entregue a 1 aparelho/.test(saida), saida);
      // O WNS às vezes descarta o 1º aviso de um canal recém-criado: uma 2ª tentativa, registrada na nota.
      let ns = await esperarNotificacao(p, /Aviso de teste/).catch(() => null);
      if (!ns) { saida += ' · 2ª tentativa: ' + robo({ AVISO_TESTE_USUARIO: U.id }); ns = await esperarNotificacao(p, /Aviso de teste/); }
      return `${saida} · notificação: ${ns.find((n) => /Aviso de teste/.test(n))}`;
    });

    await passo('robô: lembrete de prazo vencendo vira aviso (uma vez só)', null, async () => {
      [lembrete] = await servico('POST', '/rest/v1/lembretes', { cliente_id: U.id, numero_controle_pncp: 'e2e-avisos-celular', objeto_resumo: 'Papel A4 (e2e aviso no celular)',
        data_final_proposta: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), dias_antes: 0, hora_aviso: 0 });
      const s1 = robo();
      const ns = await esperarNotificacao(p, /Prazo de proposta/);
      const s2 = robo();
      exigir(/0 novo\(s\)/.test(s2), 'repetiu o aviso: ' + s2);
      return `${s1} · 2ª rodada: ${s2} · ${ns.find((n) => /Prazo/.test(n))}`;
    });

    for (const largura of [1280, 375]) {
      await passo(`botão e gaveta em ${largura}px`, null, async () => {
        await p.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 });
        for (const pagina of ['sistema', 'painel.html']) {
          await p.goto(`${SITE}/${pagina}`);
          const sel = '#celular-btn';
          await p.waitForSelector(sel, { state: 'visible', timeout: 30000 });
          await p.waitForTimeout(1500);
          await p.screenshot({ path: path.join(PRINTS, `pwa-${largura}-3-${pagina.replace('.html', '')}-botao.png`) });
          await p.click(sel);
          await p.waitForFunction(() => !/Carregando/.test(document.querySelector('#celular-corpo')?.innerText || 'Carregando'), null, { timeout: 20000 })
            .catch(async () => { throw new Error('gaveta presa: ' + (await p.innerText('body')).replace(/\s+/g, ' ').slice(-400) + ' | erros: ' + p.erros.slice(-5).join(' ; ')); });
          const txt = await p.innerText('#celular-corpo');
          exigir(/Desligar avisos/.test(txt), 'gaveta sem o estado ligado: ' + txt.replace(/\s+/g, ' ').slice(0, 300));
          exigir(!(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)), 'rolagem horizontal');
          await p.screenshot({ path: path.join(PRINTS, `pwa-${largura}-4-${pagina.replace('.html', '')}-gaveta.png`) });
          await p.keyboard.press('Escape');
        }
        return 'sistema e painel ok';
      });
    }

    await passo('desligar avisos apaga a inscrição', null, async () => {
      await p.click('#celular-btn');
      await p.click('#celular-corpo button:has-text("Desligar avisos")');
      await p.waitForSelector('#celular-corpo button:has-text("Ativar avisos")', { timeout: 20000 });
      const linhas = await servico('GET', `/rest/v1/avisos_celular_inscricoes?usuario_id=eq.${U.id}&select=id`);
      exigir(linhas.length === 0, 'inscrição ficou no banco');
      return 'apagada';
    });
    if (p.erros.length) console.log('Erros da página:', p.erros.slice(0, 10));
  } finally {
    if (lembrete) await servico('DELETE', `/rest/v1/lembretes?id=eq.${lembrete.id}`).catch(() => {});
    await servico('DELETE', `/rest/v1/avisos_celular_enviados?usuario_id=eq.${U.id}`).catch(() => {});
    await servico('DELETE', `/rest/v1/avisos_celular_inscricoes?usuario_id=eq.${U.id}`).catch(() => {});
    await servico('DELETE', `/rest/v1/avisos_celular_preferencias?usuario_id=eq.${U.id}`).catch(() => {});
    await ctx.close();
    fs.rmSync(perfil, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2));
  if (resultados.some((r) => !r.ok)) process.exitCode = 1;
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
