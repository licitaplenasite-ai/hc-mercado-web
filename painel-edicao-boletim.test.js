// Regressão 23/11: o link "Acessar o boletim" ficava em "Carregando a edição..." e às vezes caía em "Não foi possível
// carregar esta edição agora". A edição buscava oportunidades_abertas por numero_controle_pncp, coluna sem índice:
// varria a tabela inteira a cada bloco de 80. A chave primária é o próprio numeroControlePNCP.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(require.resolve("./painel.html"), "utf8");
const inicio = html.indexOf("    async function abrirEdicao(");
const fim = html.indexOf("    async function carregarEdicoes(", inicio);

test("a edição do boletim busca as oportunidades pela chave primária", () => {
  assert.ok(inicio > 0 && fim > inicio);
  const corpo = html.slice(inicio, fim);
  assert.match(corpo, /from\("oportunidades_abertas"\)\.select\("dado"\)\.in\("chave",/);
  assert.doesNotMatch(corpo, /\.in\("numero_controle_pncp"/);
});

test("a chave das oportunidades continua sendo o numeroControlePNCP", () => {
  const robo = fs.readFileSync(require.resolve("./scripts/atualizar_dados.js"), "utf8");
  assert.match(robo, /function chaveOportunidade\(r\) \{\n\s+return r\.numeroControlePNCP \|\|/);
});
