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
});
