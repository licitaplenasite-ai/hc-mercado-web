'use strict';
// 24/11 (dono, falha grave): a calculadora de BDI abria sem login e era linkada pelo site público. Regras que este teste
// garante: (1) toda tela do sistema carrega trava-sessao.js no <head>, depois do supabase-js e do supabase-config.js;
// (2) nenhuma página pública linka para tela interna (quem quiser ver o sistema faz cadastro e usa o teste de 14 dias).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const INTERNAS = ['painel', 'sistema', 'processos', 'operacao', 'quadros', 'prospeccao', 'orcamento-obra', 'sinapi',
  'mao-de-obra', 'bdi', 'normas-obra', 'resumo-processo', 'assinar', 'ajuda', 'orgao'];

for (const p of INTERNAS) {
  test(`${p}.html tem a trava de sessão no head, depois do Supabase`, () => {
    const html = fs.readFileSync(`${p}.html`, 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const umd = head.indexOf('supabase-js@'), cfg = head.indexOf('supabase-config.js'), trava = head.indexOf('trava-sessao.js');
    assert.ok(umd > -1 && cfg > umd && trava > cfg, `${p}: ordem supabase-js -> supabase-config -> trava-sessao`);
    assert.doesNotMatch(head.slice(trava - 40, trava + 60), /defer|async/, `${p}: trava sem defer/async`);
    assert.match(head, /name="robots" content="noindex/, `${p}: noindex`);
  });
}

test('assinar.html exige só sessão (conta ainda não aprovada paga)', () => {
  assert.match(fs.readFileSync('assinar.html', 'utf8'), /<script src="trava-sessao\.js" data-exige="sessao"><\/script>/);
});

test('nenhuma página pública linka para tela interna', () => {
  const publicas = ['index.html', 'sobre.html', 'contato.html', 'glossario.html', '404.html', 'cadastro.html', 'extensao.html',
    'termos-de-uso.html', 'politica-privacidade.html', 'politica-cookies.html', 'assessoria-hc.html'];
  for (const pasta of ['blog', 'blog/categoria', 'ferramentas', 'para']) {
    if (fs.existsSync(pasta)) for (const f of fs.readdirSync(pasta)) if (f.endsWith('.html')) publicas.push(path.join(pasta, f));
  }
  const interna = new RegExp(`href="/?(${INTERNAS.concat(['admin', 'cliente', 'responder-oportunidade']).join('|')})(\\.html)?(["#?/])`);
  for (const f of publicas.filter((x) => fs.existsSync(x))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), interna, `${f} linka tela interna`);
  }
});

test('sitemap não lista telas internas e robots bloqueia /bdi', () => {
  const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
  for (const p of INTERNAS) assert.doesNotMatch(sitemap, new RegExp(`/${p}<`), `sitemap com /${p}`);
  assert.match(fs.readFileSync('robots.txt', 'utf8'), /Disallow: \/bdi/);
});

// 24/11 (dono: "trocar de tela dá uma carregada"): atalho da trava. Quem foi confirmado "aprovado" nesta aba há pouco
// vê a tela na hora; a confirmação no Supabase continua em segundo plano e, se falhar, apaga a marca e vai ao login.
/* global setImmediate -- global do Node */
const vm = require('node:vm');
const fonteTrava = fs.readFileSync(path.join(__dirname, 'trava-sessao.js'), 'utf8');
const MARCA = 'lp_trava_aprovado';

function armazenamento(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), mapa: m };
}
function token(id) { return JSON.stringify({ access_token: 'a', user: { id } }); }

// confirmar: undefined = Supabase nunca responde (para ver o que aparece antes da confirmação).
function rodar({ local = {}, sessao = {}, confirmar, pathname = '/painel', head = null }) {
  const ida = [], ouvintes = {};
  const raiz = { style: { visibility: '' } };
  const pendente = new Promise(() => {});
  const ctx = {
    location: { pathname, search: '', hash: '', replace: (u) => ida.push(u) },
    localStorage: armazenamento(local), sessionStorage: armazenamento(sessao),
    document: { documentElement: raiz, currentScript: { dataset: {} }, head, addEventListener: (t, f) => { ouvintes[t] = f; },
      createElement: (tag) => ({ tag }) },
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'y', Date,
    supabase: { createClient: () => ({
      auth: { getSession: () => (confirmar === undefined ? pendente : Promise.resolve({ data: { session: confirmar.sessao } })) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: confirmar.status } }) }) }) }),
    }) },
  };
  ctx.window = ctx;
  vm.runInNewContext(fonteTrava, ctx);
  const visivelNaHora = raiz.style.visibility === '';
  return new Promise((r) => setImmediate(() => r({ ida, raiz, ctx, ouvintes, visivelNaHora })));
}
const agora = () => Date.now();

test('marca válida do mesmo usuário mostra a tela na hora, antes do Supabase responder', async () => {
  const { visivelNaHora, ida } = await rodar({ local: { 'sb-abc-auth-token': token('u1') }, sessao: { [MARCA]: JSON.stringify({ usuario: 'u1', ate: agora() + 60000 }) } });
  assert.ok(visivelNaHora);
  assert.deepEqual(ida, []);
});

test('marca de outro usuário, vencida ou com validade inflada não libera antes da confirmação', async () => {
  for (const marca of [{ usuario: 'u2', ate: agora() + 60000 }, { usuario: 'u1', ate: agora() - 1 }, { usuario: 'u1', ate: agora() + 9 * 3600000 }, 'lixo']) {
    const { raiz } = await rodar({ local: { 'sb-abc-auth-token': token('u1') }, sessao: { [MARCA]: typeof marca === 'string' ? marca : JSON.stringify(marca) } });
    assert.equal(raiz.style.visibility, 'hidden', JSON.stringify(marca));
  }
});

test('sem token guardado vai ao login na hora mesmo com marca válida', async () => {
  const { ida } = await rodar({ sessao: { [MARCA]: JSON.stringify({ usuario: 'u1', ate: agora() + 60000 }) } });
  assert.equal(ida.length, 1);
  assert.match(ida[0], /^login\.html\?voltar=/);
});

test('com marca, a confirmação em segundo plano que reprova manda ao login e apaga a marca', async () => {
  const { ida, ctx } = await rodar({ local: { 'sb-abc-auth-token': token('u1') }, sessao: { [MARCA]: JSON.stringify({ usuario: 'u1', ate: agora() + 60000 }) },
    confirmar: { sessao: { user: { id: 'u1' } }, status: 'bloqueado' } });
  assert.equal(ida.length, 1);
  assert.equal(ctx.sessionStorage.getItem(MARCA), null);
});

test('sessão expirada no Supabase (sem sessão) também tira a marca e vai ao login', async () => {
  const { ida, ctx } = await rodar({ local: { 'sb-abc-auth-token': token('u1') }, sessao: { [MARCA]: JSON.stringify({ usuario: 'u1', ate: agora() + 60000 }) },
    confirmar: { sessao: null } });
  assert.equal(ida.length, 1);
  assert.equal(ctx.sessionStorage.getItem(MARCA), null);
});

test('confirmação aprovada grava a marca do usuário com validade de no máximo 8 h', async () => {
  const { raiz, ctx } = await rodar({ local: { 'sb-abc-auth-token': token('u1') }, confirmar: { sessao: { user: { id: 'u1' } }, status: 'aprovado' } });
  assert.equal(raiz.style.visibility, '');
  const m = JSON.parse(ctx.sessionStorage.getItem(MARCA));
  assert.equal(m.usuario, 'u1');
  assert.ok(m.ate > agora() + 7 * 3600000 && m.ate <= agora() + 8 * 3600000);
});

function cabecaFalsa() { const filhos = []; return { filhos, appendChild: (f) => filhos.push(f) }; }
function link(href) { const a = { atributos: { href }, getAttribute: (k) => a.atributos[k], setAttribute: (k, v) => { a.atributos[k] = v; } }; return a; }
const passar = (ouvintes, a) => ouvintes.pointerover({ target: { closest: () => a } });

test('na URL limpa, o link do menu passa a apontar para a URL limpa ao passar o mouse (pré-busca não aceita o 308)', async () => {
  const { ouvintes } = await rodar({ local: { 'sb-abc-auth-token': token('u1') }, head: cabecaFalsa(), pathname: '/painel' });
  for (const [de, para] of [['processos.html', 'processos'], ['painel.html#kanban', 'painel#kanban'], ['quadros.html?x=1', 'quadros?x=1'], ['index.html', 'index.html'], ['/sistema', '/sistema'], ['https://x.test/a.html', 'https://x.test/a.html']]) {
    const a = link(de); passar(ouvintes, a);
    assert.equal(a.atributos.href, para, de);
  }
  for (const t of ['pointerover', 'focusin', 'touchstart', 'click']) assert.equal(typeof ouvintes[t], 'function', t);
});

test('em página aberta por .html (host sem URL limpa) os links ficam como estão', async () => {
  const { ouvintes } = await rodar({ local: { 'sb-abc-auth-token': token('u1') }, head: cabecaFalsa(), pathname: '/painel.html' });
  assert.equal(ouvintes.pointerover, undefined);
});

// Revisão 24/11 (piscada): sem @view-transition (esmaecia a tela a cada clique) e sem prerender (lia o estado da tela
// anterior antes de ela gravar); fica só a pré-busca do HTML.
test('pré-conexão ao Supabase no <head>, sem transição de tela', async () => {
  const head = cabecaFalsa();
  await rodar({ local: { 'sb-abc-auth-token': token('u1') }, head });
  assert.ok(!head.filhos.some((f) => f.tag === 'style'));
  assert.doesNotMatch(fonteTrava, /prerender:/);
  assert.ok(head.filhos.some((f) => f.tag === 'link' && f.rel === 'preconnect' && f.href === 'https://x.supabase.co' && f.crossOrigin === 'anonymous'));
});

test('_headers: 308 do .html guardado 1 dia, estáticos com stale-while-revalidate e o portal continua no-store por último', () => {
  const h = fs.readFileSync(path.join(__dirname, '_headers'), 'utf8').replace(/\r/g, '');
  assert.match(h, /\n\/\*\.html\n {2}! Cache-Control\n {2}Cache-Control: public, max-age=86400\n/);
  const bloco = (ext) => ['', `/*.${ext}`, '  ! Cache-Control', '  Cache-Control: public, max-age=14400, stale-while-revalidate=604800', ''].join('\n');
  for (const ext of ['js', 'css', 'svg']) assert.ok(h.includes(bloco(ext)), ext);
  assert.ok(h.indexOf('\n/cliente*') > h.indexOf('\n/*.svg'), '/cliente* depois dos estáticos (o no-store dele vence)');
});
