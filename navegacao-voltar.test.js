'use strict';
/* global URL, setImmediate -- globais do Node */
// Regressão 24/11 (dono, iPhone): (1) o link "Acessar o boletim" do e-mail, sem sessão, voltava do login para a busca
// porque a trava jogava fora o #boletim; (2) o gesto de voltar no Resumo do edital caía no login, que ficava no
// histórico (login -> painel com location.href) e o resumo (modal) não tinha entrada própria no histórico.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const trava = fs.readFileSync(require.resolve('./trava-sessao.js'), 'utf8');

function rodarTrava({ chaves = [], sessao = null, status = 'aprovado' }) {
  const ida = [];
  const raiz = { style: { visibility: '' } };
  const ctx = {
    location: { pathname: '/painel.html', search: '?edicao=2026-11-24&filtro=principal', hash: '#boletim', replace: (u) => ida.push(u) },
    localStorage: { length: chaves.length, key: (i) => chaves[i] },
    document: { documentElement: raiz, currentScript: { dataset: {} }, addEventListener() {} },
    SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'y',
    supabase: { createClient: () => ({
      auth: { getSession: async () => ({ data: { session: sessao } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status } }) }) }) }),
    }) },
  };
  ctx.window = ctx;
  vm.runInNewContext(trava, ctx);
  return new Promise((r) => setImmediate(() => r({ ida, raiz })));
}

test('sem sessão, a trava manda ao login guardando o #boletim no voltar', async () => {
  const { ida, raiz } = await rodarTrava({});
  assert.equal(raiz.style.visibility, 'hidden');
  assert.equal(ida.length, 1);
  const voltar = new URL(ida[0], 'https://x.test/').searchParams.get('voltar');
  assert.equal(voltar, '/painel.html?edicao=2026-11-24&filtro=principal#boletim');
});

test('com sessão válida e aprovada, a trava libera a tela sem ir ao login', async () => {
  const { ida, raiz } = await rodarTrava({ chaves: ['sb-abc-auth-token'], sessao: { user: { id: 'u1' } } });
  assert.deepEqual(ida, []);
  assert.equal(raiz.style.visibility, '');
});

test('cadastro não aprovado continua indo ao login', async () => {
  const { ida, raiz } = await rodarTrava({ chaves: ['sb-abc-auth-token'], sessao: { user: { id: 'u1' } }, status: 'pendente' });
  assert.equal(ida.length, 1);
  assert.equal(raiz.style.visibility, 'hidden');
});

test('login vai ao destino com replace e o destino seguro mantém o #', () => {
  const html = fs.readFileSync(require.resolve('./login.html'), 'utf8');
  assert.match(html, /window\.location\.replace\(destino\);/);
  assert.doesNotMatch(html, /location\.href\s*=\s*destino/);
  const fonte = html.slice(html.indexOf('function destinoSeguro('), html.indexOf('const parametros'));
  const destinoSeguro = vm.runInNewContext(`${fonte}; destinoSeguro`, { window: { location: { origin: 'https://x.test' } }, URL });
  assert.equal(destinoSeguro('/painel.html?edicao=2026-11-24#boletim'), '/painel.html?edicao=2026-11-24#boletim');
  assert.equal(destinoSeguro('//evil.com/#boletim'), 'painel.html');
  for (const ruim of ['/.//evil.com', '/a/..//evil.com', '/%2e//evil.com', '/./\\evil.com']) {
    assert.equal(destinoSeguro(ruim), 'painel.html', ruim);
  }
});

// Histórico falso: pilha de estados; back() dispara o popstate como o navegador.
function janelaFalsa() {
  const entradas = [null];
  const ouvintes = [];
  const win = {
    location: { href: 'https://x.test/painel.html#boletim' },
    history: {
      get state() { return entradas[entradas.length - 1]; },
      pushState: (s) => entradas.push(s),
      back: () => { entradas.pop(); ouvintes.forEach((f) => f()); },
    },
    addEventListener: (ev, f) => { if (ev === 'popstate') ouvintes.push(f); },
    entradas,
  };
  return win;
}
function janela(nome) { const j = { nome, aberto: false, fechadas: 0 }; j.item = { aberto: () => j.aberto, fechar: () => { j.fechadas++; j.aberto = false; } }; return j; }

test('voltar fecha o modal aberto e não sai da tela', () => {
  const { criarPilhaVoltar } = require('./voltar-fecha-modal.js');
  const win = janelaFalsa(), resumo = janela('resumo');
  const p = criarPilhaVoltar(win, [resumo.item]);
  resumo.aberto = true; p.mudou(resumo.item);
  assert.equal(win.entradas.length, 2);
  win.history.back();
  assert.equal(resumo.fechadas, 1);
  assert.equal(win.entradas.length, 1);
  assert.deepEqual(p.pilha, []);
});

test('fechar pelo X tira a entrada do histórico (sem voltar extra)', () => {
  const { criarPilhaVoltar } = require('./voltar-fecha-modal.js');
  const win = janelaFalsa(), lembrete = janela('lembrete');
  const p = criarPilhaVoltar(win, [lembrete.item]);
  lembrete.aberto = true; p.mudou(lembrete.item);
  lembrete.aberto = false; p.mudou(lembrete.item);
  assert.equal(win.entradas.length, 1);
  assert.equal(lembrete.fechadas, 0);
});

test('modal sobre modal: o voltar fecha só o de cima', () => {
  const { criarPilhaVoltar } = require('./voltar-fecha-modal.js');
  const win = janelaFalsa(), resumo = janela('resumo'), enviar = janela('enviar');
  const p = criarPilhaVoltar(win, [resumo.item, enviar.item]);
  resumo.aberto = true; p.mudou(resumo.item);
  enviar.aberto = true; p.mudou(enviar.item);
  win.history.back();
  assert.equal(enviar.fechadas, 1);
  assert.equal(resumo.aberto, true);
  win.history.back();
  assert.equal(resumo.fechadas, 1);
  assert.equal(win.entradas.length, 1);
});

test('o painel liga o voltar em todos os modais, na gaveta do menu e no diálogo de etapas', () => {
  const html = fs.readFileSync(require.resolve('./painel.html'), 'utf8');
  assert.match(html, /<script src="voltar-fecha-modal\.js"><\/script>/);
  assert.match(html, /querySelectorAll\('\[id\^="modal-"\]\[id\$="-fundo"\]'\)/);
  for (const id of ['modal-ia', 'modal-enviar-resumo', 'modal-arquivos', 'modal-verarquivos', 'modal-lembrete', 'modal-conta']) {
    assert.match(html, new RegExp(`id="${id}-fundo"`), `${id}-fundo sumiu`);
    assert.match(html, new RegExp(`id="${id}-fechar"`), `${id}-fechar sumiu (o voltar fecha por ele)`);
  }
  assert.match(html, /porId\("menu-principal"\), gaveta = porId\("nav-gaveta-fundo"\), etapas = porId\("etapas-dialogo"\)/);
});
