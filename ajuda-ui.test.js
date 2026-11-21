const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function carregar(janela = {}) {
  const ctx = { window: janela };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "ajuda-ui.js"), "utf8"), ctx);
  return ctx.window.LicitaPlenaAjuda;
}

test("tutoriais da tela atual vêm primeiro; âncora do painel vence a página", () => {
  const ajuda = carregar();
  assert.equal(ajuda.ordenarPorTela("/painel.html#precos")[0].id, "precos");
  assert.equal(ajuda.ordenarPorTela("/painel.html#kanban")[0].id, "resumo"); // resumo também vale no Funil e vem antes na lista
  assert.equal(ajuda.ordenarPorTela("/painel.html#kanban")[1].id, "funil");
  assert.equal(ajuda.ordenarPorTela("/processos.html")[0].id, "processos");
  assert.equal(ajuda.ordenarPorTela("/sistema")[0].id, "hoje");
  assert.equal(ajuda.ordenarPorTela("/qualquer")[0].id, "painel");
  assert.equal(ajuda.ordenarPorTela("/painel.html").length, ajuda.TUTORIAIS.length);
});

test("todo tutorial tem passos e o print existe em ajuda/", () => {
  for (const t of carregar().TUTORIAIS) {
    assert.ok(t.passos.length > 0, t.id);
    assert.ok(fs.existsSync(path.join(__dirname, "ajuda", `${t.print}.webp`)), `faltou ajuda/${t.print}.webp`);
  }
});

test("WhatsApp do suporte: só com número válido da configuração (DDI 55); vazio fica desligado", () => {
  const janela = {};
  const ajuda = carregar(janela);
  assert.equal(ajuda.linkWhatsApp(), null);
  janela.LICITAPLENA_WHATSAPP_SUPORTE = "123";
  assert.equal(ajuda.linkWhatsApp(), null);
  // Lido na hora: a configuração pode chegar depois do script.
  janela.LICITAPLENA_WHATSAPP_SUPORTE = "+55 (92) 90000-0000";
  assert.match(ajuda.linkWhatsApp(), /^https:\/\/wa\.me\/5592900000000\?text=/);
});

test("vídeo do tutorial: lugar vazio por enquanto; só arquivo do próprio site em ajuda/videos", () => {
  const ajuda = carregar();
  assert.equal(ajuda.videoDoTutorial(ajuda.TUTORIAIS[0]), null);
  ajuda.VIDEOS.painel = "ajuda/videos/painel.mp4";
  assert.equal(ajuda.videoDoTutorial({ id: "painel" }), "ajuda/videos/painel.mp4");
  ajuda.VIDEOS.painel = "https://exemplo.com/x.mp4";
  assert.equal(ajuda.videoDoTutorial({ id: "painel" }), null);
  ajuda.VIDEOS.painel = "youtube:abcDEF12345"; // YouTube não listado: só o ID de 11 caracteres
  assert.equal(ajuda.videoDoTutorial({ id: "painel" }), "https://www.youtube-nocookie.com/embed/abcDEF12345");
  ajuda.VIDEOS.painel = "youtube:curto";
  assert.equal(ajuda.videoDoTutorial({ id: "painel" }), null);
});

test("HC Licitações: contatos só valem se vierem da configuração; vazio some", () => {
  const janela = {};
  const ajuda = carregar(janela);
  assert.equal(JSON.stringify(ajuda.contatosHC()), JSON.stringify({ whatsapp: null, site: null }));
  assert.equal(ajuda.chamadaHC(), null);
  janela.LICITAPLENA_HC_WHATSAPP = "(92) 90000-0000"; // sem DDI 55: inválido
  janela.LICITAPLENA_HC_SITE = "http://inseguro.exemplo";
  assert.equal(JSON.stringify(ajuda.contatosHC()), JSON.stringify({ whatsapp: null, site: null }));
  janela.LICITAPLENA_HC_WHATSAPP = "5592900000000";
  janela.LICITAPLENA_HC_SITE = "https://hc.exemplo.com.br";
  const c = ajuda.contatosHC();
  assert.match(c.whatsapp, /^https:\/\/wa\.me\/5592900000000\?text=/);
  assert.equal(c.site, "https://hc.exemplo.com.br");
});

test("Central e página da HC carregam a configuração; a CSP libera o YouTube sem cookies", () => {
  for (const f of ["ajuda.html", "hc.html"]) {
    const html = fs.readFileSync(path.join(__dirname, f), "utf8");
    assert.match(html, /supabase-config\.js/, f);
    assert.match(html, /ajuda-ui\.js/, f);
  }
  for (const f of ["_headers", "netlify.toml"]) assert.match(fs.readFileSync(path.join(__dirname, f), "utf8"), /frame-src [^;]*youtube-nocookie\.com/, f);
});

test("Consultoria do menu: troca hc.html pelo site da HC só quando a configuração é https", () => {
  const links = [{ href: "hc.html" }, { href: "hc.html" }];
  const janela = {};
  const documento = { querySelectorAll: (s) => (s === "a[data-hc-site]" ? links : []), addEventListener() {} };
  const ctx = { window: janela, document: documento };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "ajuda-ui.js"), "utf8"), ctx);
  const ajuda = janela.LicitaPlenaAjuda;
  {
    ajuda.ligarConsultoria();
    assert.deepEqual(links.map((l) => l.href), ["hc.html", "hc.html"]);
    janela.LICITAPLENA_HC_SITE = "http://inseguro.exemplo";
    ajuda.ligarConsultoria();
    assert.equal(links[0].href, "hc.html");
    janela.LICITAPLENA_HC_SITE = "https://hc.exemplo.com.br";
    ajuda.ligarConsultoria();
    assert.deepEqual(links.map((l) => l.href), ["https://hc.exemplo.com.br", "https://hc.exemplo.com.br"]);
  }
});
