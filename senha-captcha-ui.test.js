const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chaveHCaptcha, ehErroDeCaptcha, montarCaptcha, alternarSenha, CHAVE_TESTE, MSG_CAPTCHA, MSG_MARCAR, SCRIPT_HCAPTCHA } = require("./senha-captcha-ui.js");

test("ehErroDeCaptcha reconhece só erro do captcha do Supabase", () => {
  assert.equal(ehErroDeCaptcha({ message: "captcha protection: request disallowed (invalid-input-response)" }), true);
  assert.equal(ehErroDeCaptcha({ message: "Invalid login credentials" }), false);
  assert.equal(ehErroDeCaptcha(null), false);
  assert.ok(!/não permitida/i.test(MSG_CAPTCHA));
});


// Página falsa: um .captcha-widget, rótulo, .captcha-aviso, um head que guarda o <script> injetado e um hcaptcha simulado.
function paginaFalsa(hostname) {
  const el = { hidden: false };
  const rotulo = { hidden: false };
  const aviso = { hidden: true, textContent: "" };
  const scripts = [];
  const doc = {
    documentElement: { dataset: { theme: "dark" } },
    querySelector: (s) => ({ ".captcha-widget": el, ".captcha-rotulo": rotulo, ".captcha-aviso": aviso })[s] || null,
    createElement: () => ({}),
    head: { appendChild: (s) => scripts.push(s) },
  };
  const chamadas = { render: [], reset: [], resposta: "" };
  const win = {
    location: { hostname },
    hcaptcha: {
      render: (alvo, opcoes) => { chamadas.render.push({ alvo, opcoes }); return "w1"; },
      getResponse: (id) => (id === "w1" ? chamadas.resposta : "id errado"),
      reset: (id) => chamadas.reset.push(id),
    },
  };
  return { el, rotulo, aviso, scripts, doc, win, chamadas };
}

test("sem chave em produção: não carrega script, esconde o espaço e devolve token vazio", async () => {
  const p = paginaFalsa("licitaplena.com.br");
  const captcha = montarCaptcha(p.doc, p.win, "");
  assert.equal(captcha.ativo, false);
  assert.equal(p.scripts.length, 0);
  assert.equal(p.el.hidden, true);
  assert.equal(p.rotulo.hidden, true);
  assert.equal(await captcha.obterToken(), "");
  assert.equal(p.aviso.hidden, true);
  captcha.resetar(); // não quebra sem widget
  assert.equal(p.chamadas.reset.length, 0);
});

test("com chave: injeta o api.js em render explícito, renderiza a caixinha visível e lê o token na hora", async () => {
  const p = paginaFalsa("licitaplena.com.br");
  const captcha = montarCaptcha(p.doc, p.win, "E358");
  assert.equal(captcha.ativo, true);
  assert.equal(p.scripts[0].src, SCRIPT_HCAPTCHA);
  assert.ok(SCRIPT_HCAPTCHA.startsWith("https://js.hcaptcha.com/1/api.js?render=explicit&onload=licitaplenaHCaptchaPronto"));
  assert.ok(SCRIPT_HCAPTCHA.includes("hl=pt"));
  p.win.licitaplenaHCaptchaPronto(); // onload do api.js
  const { alvo, opcoes } = p.chamadas.render[0];
  assert.equal(alvo, p.el);
  assert.equal(opcoes.sitekey, "E358");
  assert.equal(opcoes.theme, "dark");
  assert.equal(opcoes.size, undefined); // checkbox normal, nada de invisível
  p.chamadas.resposta = "tok-1";
  assert.equal(await captcha.obterToken(), "tok-1");
  assert.equal(p.aviso.hidden, true);
  captcha.resetar();
  assert.deepEqual(p.chamadas.reset, ["w1"]);
});

test("caixinha não marcada: avisa o que fazer e devolve vazio; marcar esconde o aviso", async () => {
  const p = paginaFalsa("licitaplena.com.br");
  const captcha = montarCaptcha(p.doc, p.win, "E358");
  assert.equal(await captcha.obterToken(), ""); // script ainda não carregou
  assert.equal(p.aviso.textContent, MSG_MARCAR);
  assert.equal(p.aviso.hidden, false);
  p.win.licitaplenaHCaptchaPronto();
  assert.equal(await captcha.obterToken(), "");
  captcha.resetar(); // as telas resetam depois da tentativa: o aviso precisa continuar visível
  assert.equal(p.aviso.hidden, false);
  p.chamadas.render[0].opcoes.callback("tok");
  assert.equal(p.aviso.hidden, true);
});

test("localhost usa a chave de teste do hCaptcha mesmo sem chave configurada", () => {
  assert.equal(CHAVE_TESTE, "10000000-ffff-ffff-ffff-000000000001");
  for (const h of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) assert.equal(chaveHCaptcha(h, "E358"), CHAVE_TESTE);
  for (const h of ["licitaplena.com.br", "localhost.evil.com", "", undefined]) assert.equal(chaveHCaptcha(h, " E358 "), "E358");
  assert.equal(chaveHCaptcha("licitaplena.com.br", ""), "");
  const p = paginaFalsa("127.0.0.1");
  const captcha = montarCaptcha(p.doc, p.win, "");
  assert.equal(captcha.ativo, true);
  p.win.licitaplenaHCaptchaPronto();
  assert.equal(p.chamadas.render[0].opcoes.sitekey, CHAVE_TESTE);
});

test("falha do widget ou do script mostra mensagem amigável", () => {
  const p = paginaFalsa("licitaplena.com.br");
  montarCaptcha(p.doc, p.win, "E358");
  p.win.licitaplenaHCaptchaPronto();
  p.chamadas.render[0].opcoes["error-callback"]("network-error");
  assert.equal(p.aviso.hidden, false);
  assert.equal(p.aviso.textContent, MSG_CAPTCHA);

  const q = paginaFalsa("licitaplena.com.br");
  montarCaptcha(q.doc, q.win, "E358");
  q.scripts[0].onerror(); // api.js bloqueado
  assert.equal(q.aviso.textContent, MSG_CAPTCHA);
});

test("olho alterna tipo do campo, aria-pressed, aria-label e ícone", () => {
  const campo = { type: "password" };
  const attrs = {}; const classes = new Set();
  const btn = {
    dataset: { alvo: "senha" }, title: "",
    setAttribute: (k, v) => { attrs[k] = v; },
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
  };
  const doc = { getElementById: (id) => (id === "senha" ? campo : null) };
  assert.equal(alternarSenha(btn, doc), true);
  assert.equal(campo.type, "text");
  assert.deepEqual(attrs, { "aria-pressed": "true", "aria-label": "Ocultar senha" });
  assert.ok(classes.has("senha-visivel"));
  alternarSenha(btn, doc);
  assert.equal(campo.type, "password");
  assert.deepEqual(attrs, { "aria-pressed": "false", "aria-label": "Mostrar senha" });
  assert.ok(!classes.has("senha-visivel"));
});


test("páginas de acesso usam o olho e o hCaptcha visível, sem Turnstile nem chave fixa no HTML", () => {
  for (const f of ["login", "cadastro", "convite", "admin"]) {
    const html = fs.readFileSync(`${__dirname}/${f}.html`, "utf8");
    assert.ok(html.includes("senha-captcha-ui.js"), f);
    assert.ok(html.includes("supabase-config.js"), f);
    assert.ok(html.includes('class="captcha-widget"'), f);
    assert.ok(/class="captcha-rotulo"[^>]*>Verificação de segurança</.test(html), f);
    assert.ok(html.includes("montarCaptcha(document, window)"), f);
    assert.ok(html.includes("captcha.obterToken()") && html.includes("captcha.resetar()"), f);
    assert.ok(!/turnstile|challenges\.cloudflare|data-sitekey|js\.hcaptcha\.com/i.test(html), f);
    assert.ok(!/>Mostrar senha</.test(html), f);
    assert.ok(/aria-label="Mostrar senha"/.test(html), f);
  }
  for (const arq of ["_headers", "netlify.toml"]) {
    const csp = fs.readFileSync(`${__dirname}/${arq}`, "utf8");
    assert.ok(!/challenges\.cloudflare|turnstile/i.test(csp), arq);
    for (const dir of ["script-src", "style-src", "connect-src", "frame-src"]) {
      assert.ok(csp.split("Content-Security-Policy")[1].split(`${dir} `)[1].split(";")[0].includes("https://*.hcaptcha.com"), `${arq} ${dir}`);
    }
  }
  assert.match(fs.readFileSync(`${__dirname}/supabase-config.js`, "utf8"), /const HCAPTCHA_SITEKEY = "E358601C-A03C-4316-9F24-B3DC4316992E";/);
});
