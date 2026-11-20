const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Q = require("./quadros-ui.js");

test("ordemEntre: vazio, começo, fim e meio", () => {
  assert.equal(Q.ordemEntre(null, null), 1);
  assert.equal(Q.ordemEntre(null, 2), 1);
  assert.equal(Q.ordemEntre(3, null), 4);
  assert.equal(Q.ordemEntre(1, 2), 1.5);
});

test("ordemNaPosicao ignora o próprio cartão e limita o índice", () => {
  const lista = [{ id: "a", ordem: 1 }, { id: "b", ordem: 2 }, { id: "c", ordem: 3 }];
  assert.equal(Q.ordemNaPosicao(lista, 0, "x"), 0); // antes do primeiro
  assert.equal(Q.ordemNaPosicao(lista, 1, "x"), 1.5);
  assert.equal(Q.ordemNaPosicao(lista, 99, "x"), 4); // índice além do fim = último
  assert.equal(Q.ordemNaPosicao(lista, Infinity, "c"), 3); // "c" para o fim da própria coluna fica onde está
  assert.equal(Q.ordemNaPosicao(lista, 0, "a"), 1); // "a" no topo: média de nada com "b" (2) - 1
  assert.equal(Q.ordemNaPosicao([], 0, "x"), 1);
  // Arrastar "a" para depois de "b": vai entre b e c.
  assert.equal(Q.ordemNaPosicao(lista, 1, "a"), 2.5);
});

test("agruparCartoes ordena por ordem e descarta coluna desconhecida", () => {
  const colunas = [{ id: "c1" }, { id: "c2" }];
  const cartoes = [
    { id: "k2", coluna_id: "c1", ordem: 2, criado_em: "2026-01-01" },
    { id: "k1", coluna_id: "c1", ordem: 1, criado_em: "2026-01-02" },
    { id: "k3", coluna_id: "zz", ordem: 1, criado_em: "2026-01-01" },
  ];
  const g = Q.agruparCartoes(colunas, cartoes);
  assert.deepEqual(g.get("c1").map((k) => k.id), ["k1", "k2"]);
  assert.deepEqual(g.get("c2"), []);
  assert.equal(g.has("zz"), false);
});

test("normalizarNome junta espaços, corta no limite e recusa vazio", () => {
  assert.equal(Q.normalizarNome("  Cotar   papel \n A4 ", 60), "Cotar papel A4");
  assert.equal(Q.normalizarNome("   ", 60), "");
  assert.equal(Q.normalizarNome("x".repeat(80), Q.LIMITES.coluna).length, 40);
  assert.equal(Q.normalizarNome(null, 10), "");
});

test("mensagemErro traduz os erros do banco", () => {
  assert.match(Q.mensagemErro({ code: "23503" }, "apagar-coluna"), /Mova ou apague os cartões/);
  assert.match(Q.mensagemErro({ code: "23503", message: "Processo de outra empresa" }), /outra empresa/);
  assert.match(Q.mensagemErro({ code: "P0001", message: "Limite de 20 atingido" }), /até 20/);
  assert.match(Q.mensagemErro({ code: "42501", message: "new row violates row-level security" }), /só de leitura/);
  assert.match(Q.mensagemErro({ semPermissao: true }), /só de leitura/);
  assert.match(Q.mensagemErro({ message: "rede caiu" }), /rede caiu/);
});

test("htmlQuadro escapa texto, liga o processo e marca prazo vencido", () => {
  const colunas = [{ id: "c1", nome: "<b>A fazer</b>", cor: "javascript:x" }, { id: "c2", nome: "Feito", cor: "#16a34a" }];
  const cartoes = [{ id: "k1", coluna_id: "c1", ordem: 1, titulo: "<img src=x onerror=alert(1)>", descricao: null, prazo: "2026-11-01", processo_id: "p1" }];
  const html = Q.htmlQuadro(colunas, cartoes, [{ id: "p1", numero: "90/2026", objeto: "Papel & tinta" }], "2026-11-20");
  assert.ok(!html.includes("<img"), "título sem escape");
  assert.ok(!html.includes("<b>A fazer"), "nome de coluna sem escape");
  assert.ok(!html.includes("javascript:x"), "cor inválida passou para o style");
  assert.match(html, /href="processos\.html\?processo=p1">90\/2026: Papel &amp; tinta/);
  assert.match(html, /q-vencido">Prazo 01\/11\/2026/);
  assert.match(html, /data-coluna-esq="c1" disabled/); // primeira coluna não vai mais à esquerda
  assert.match(html, /data-coluna-dir="c2" disabled/);
  assert.match(Q.htmlQuadro([], [], [], "2026-11-20"), /ainda não tem colunas/);
});

test("quadros.html carrega o módulo e o menu marca Quadros como ativo", () => {
  const html = fs.readFileSync(__dirname + "/quadros.html", "utf8");
  assert.match(html, /<script src="quadros-ui\.js"><\/script>/);
  assert.match(html, /<a href="quadros\.html" class="ativo" aria-current="page" title="Quadros">/);
  for (const id of ["empresa-atual", "quadro-atual", "quadro", "dlg-nome", "dlg-cartao", "form-cartao", "btn-apagar-cartao"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
});
