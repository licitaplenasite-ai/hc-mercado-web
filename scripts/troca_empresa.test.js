// Troca de empresa ativa (25/11, bug do dono: Boletim preso na HCM ao escolher a Raimon). Cada empresa tem as suas
// edições do aviso por e-mail e os seus lidos/favoritos; a troca nunca deixa dado de uma empresa na tela da outra.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
function funcao(nome) {
  const inicio = html.search(new RegExp(`  (?:async )?function ${nome}\\(`));
  assert.ok(inicio >= 0, `${nome} deve existir`);
  return html.slice(inicio, html.indexOf("\n  }", inicio) + 4);
}

test("edições: só as da empresa ativa, os jornais dela ou sem dono e as do filtro antigo da conta", () => {
  const ctx = vm.createContext({});
  vm.runInContext(funcao("edicoesDaEmpresa"), ctx);
  const lista = [
    { id: 1, filtro_id: "empresa:hcm" }, { id: 2, filtro_id: "empresa:raimon" },
    { id: 3, filtro_id: "jornal:j-hcm" }, { id: 4, filtro_id: "jornal:j-raimon" }, { id: 5, filtro_id: "jornal:j-conta" },
    { id: 6, filtro_id: "principal" },
  ];
  const donos = { "j-hcm": "hcm", "j-raimon": "raimon", "j-conta": null };
  const ids = (empresa) => [...ctx.edicoesDaEmpresa(lista, empresa, donos).map((e) => e.id)];
  assert.deepEqual(ids("hcm"), [1, 3, 5, 6]);
  assert.deepEqual(ids("raimon"), [2, 4, 5, 6]);
  assert.deepEqual(ids(null), [1, 2, 3, 4, 5, 6]); // conta sem empresa cadastrada
  assert.equal(ctx.edicoesDaEmpresa([], "hcm", {}).length, 0);
});

test("lidos e favoritos ficam separados por pessoa e empresa; a lista antiga sem dono é o ponto de partida", () => {
  const dados = new Map([["hc_lidos", JSON.stringify(["antigo"])]]);
  const inicio = html.indexOf("  function chaveArmazenamento(nome)");
  const fim = html.indexOf("  const OPCOES_STATUS_LICITACAO", inicio);
  const ctx = { window: { __clienteIdAtual: "u1" }, localStorage: { getItem: (k) => (dados.has(k) ? dados.get(k) : null), setItem: (k, v) => dados.set(k, v) }, Set, JSON, Array };
  vm.runInNewContext(`${html.slice(inicio, fim)}
    this.empresa = (id) => { window.__filtroBoletimEmpresa = id; };
    this.marcar = (nome, id) => alternarNoConjunto(nome, id);
    this.ler = (nome) => JSON.stringify([...lerConjunto(nome)].sort());`, ctx);
  ctx.empresa("hcm");
  assert.equal(ctx.ler("lidos"), '["antigo"]');
  ctx.marcar("lidos", "edital-hcm");
  ctx.empresa("raimon");
  assert.equal(ctx.ler("lidos"), '["antigo"]', "lido na HCM não aparece na Raimon");
  ctx.marcar("lidos", "edital-raimon");
  ctx.marcar("favoritos", "fav-raimon");
  ctx.empresa("hcm");
  assert.equal(ctx.ler("lidos"), '["antigo","edital-hcm"]');
  assert.equal(ctx.ler("favoritos"), "[]");
  assert.equal(dados.get("hc_lidos"), JSON.stringify(["antigo"]), "a lista antiga não é reescrita");
  assert.ok(dados.has("hc_lidos:u1:raimon") && dados.has("hc_lidos:u1:hcm"));
});

test("troca de empresa: um evento único reprograma o Boletim e sai da edição aberta da outra empresa", () => {
  assert.match(funcao("selecionarEmpresaAcompanhamentoAgora"), /dispatchEvent\(new CustomEvent\("lp:empresa-ativa"/);
  assert.match(html, /addEventListener\("lp:empresa-ativa", \(\) => \{ void trocarFiltroBoletimDaEmpresa\(\); \}\)/);
  assert.match(funcao("trocarFiltroBoletimDaEmpresa"), /abriuEdicao = [^\n]*__bolEdicoesDaEmpresaAtiva\(\)[\s\S]*if \(!abriuEdicao\) void gerarBoletim\(\)/);
  assert.match(html, /window\.__bolEdicoesDaEmpresaAtiva = \(\) => \{[^}]*window\.__bolEdicaoAberta = false;/);
  // Link do e-mail com boletim ou jornal de outra empresa: só troca para uma empresa que está na lista do usuário.
  assert.match(html, /const minhas = dona \? [^\n]*empresaOperacionalParaDossie\(\)[\s\S]{0,90}if \(minhas\.some\(\(e\) => e\.id === dona\)\)/);
  assert.doesNotMatch(html, /if \(edicaoDoLink && empresaDoLink\)/, "o link não grava a empresa sem conferir a lista");
  // A Plena e a previsão do Dashboard acompanham a empresa ativa.
  assert.match(fs.readFileSync(path.join(__dirname, "..", "chat-ia-ui.js"), "utf8"), /addEventListener\("lp:empresa-ativa"/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "crm-relatorios-ui.js"), "utf8"), /ativa\.id !== estado\.ativaVista/);
});
