const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const operacao = fs.readFileSync(path.join(__dirname, "..", "operacao.html"), "utf8");
const admin = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
const migracao = fs.readFileSync(path.join(__dirname, "..", "supabase", "limite_cnpjs_operacao.sql"), "utf8");
const inicio = operacao.indexOf("  async function salvarEmpresa(");
const fim = operacao.indexOf("  async function salvarEvento(", inicio);
assert.ok(inicio > 0 && fim > inicio);

test("painel administrativo mantém scripts inline válidos", () => {
  const scripts = [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach((script, i) => new vm.Script(script, { filename: `admin-inline-${i}.js` }));
});

test("migração reconhece o owner pelo e-mail real e protege o limite no banco", () => {
  assert.match(migracao, /join public\.admins a on lower\(a\.email\) = lower\(u\.email\)/);
  assert.doesNotMatch(migracao, /public\.admins\s+where\s+id\s*=/);
  assert.match(migracao, /check \(limite between 1 and 3\)/);
  assert.match(migracao, /for update;/);
  assert.match(migracao, /before insert or update of ativo, organizacao_id on public\.operacao_empresas/);
});

function preparar(limite, empresas) {
  const chamadas = [];
  const formulario = { reset() { chamadas.push("reset"); }, querySelector() { return botao; } };
  const botao = { disabled: false };
  const contexto = {
    estado: { orgId: "org", empresaId: "primeira", empresas, limiteCnpjs: limite },
    FormData: class { get(campo) { return ({ razao_social: "Empresa nova", cnpj: "", responsavel: "" })[campo]; } },
    normalizarCnpj: () => null,
    sb: { from(tabela) {
      assert.equal(tabela, "operacao_empresas");
      return { insert(dados) {
        chamadas.push(["insert", dados]);
        return { select() { return { single: async () => ({ data: { id: "nova" }, error: null }) }; } };
      } };
    } },
    localStorage: { setItem: (...args) => chamadas.push(["preferencia", ...args]) },
    fecharModal: () => chamadas.push("fechar"),
    carregarEmpresas: async () => chamadas.push("recarregar"),
    aviso: mensagem => chamadas.push(["aviso", mensagem]),
    motivo: e => e.message,
  };
  vm.runInNewContext(`${operacao.slice(inicio, fim)}\nthis.salvar = salvarEmpresa;`, contexto);
  return { salvar: contexto.salvar, formulario, botao, chamadas };
}

test("cliente no limite não consegue abrir um quarto cadastro pela interface", async () => {
  const caso = preparar(3, [{}, {}, {}]);
  await caso.salvar({ currentTarget: caso.formulario, preventDefault() {} });
  assert.equal(caso.chamadas.some(c => Array.isArray(c) && c[0] === "insert"), false);
  assert.match(caso.chamadas.find(c => Array.isArray(c) && c[0] === "aviso")[1], /limite de 3 empresas/);
  assert.equal(caso.botao.disabled, false);
});

// Regressão 23/11: com 0 empresas a regra antiga (usadas <= 1) escondia "+ Empresa" do plano de 1 CNPJ.
function cota(limite, usadas) {
  const i = operacao.indexOf("  function atualizarCotaEmpresas()");
  const f = operacao.indexOf("  // Plano da conta (meu_plano", i);
  const el = () => ({ style: {}, hidden: false, disabled: false, title: "", textContent: "" });
  const els = {};
  let abaClicada = null;
  const ctx = {
    estado: { empresas: Array.from({ length: usadas }, () => ({})), limiteCnpjs: limite, acessoEmpresaId: null, plano: null },
    $: (id) => (els[id] ||= el()),
    document: { querySelector: (s) => (s.includes("data-aba") ? { click: () => { abaClicada = s; } } : (els[s] ||= el())) },
  };
  vm.runInNewContext(`${operacao.slice(i, f)}\natualizarCotaEmpresas();`, ctx);
  return { els, abaClicada };
}

test("plano de 1 CNPJ sem empresa mostra '+ Empresa', o convite e trava os botões de documento", () => {
  const { els, abaClicada } = cota(1, 0);
  assert.equal(els["btn-nova-empresa"].style.display, "");
  assert.equal(els["sem-empresa"].hidden, false);
  assert.equal(els["btn-novo-documento"].disabled, true);
  assert.equal(els["btn-novo-documento-2"].disabled, true);
  assert.match(abaClicada, /identificacao/);
});

test("plano de 1 CNPJ com a empresa cadastrada esconde seletor e '+ Empresa' e libera documentos", () => {
  const { els, abaClicada } = cota(1, 1);
  assert.equal(els["btn-nova-empresa"].style.display, "none");
  assert.equal(els[".empresa-select"].style.display, "none");
  assert.equal(els["sem-empresa"].hidden, true);
  assert.equal(els["btn-novo-documento"].disabled, false);
  assert.equal(abaClicada, null);
});

test("proprietário ilimitado continua podendo cadastrar empresa", async () => {
  const caso = preparar(null, [{}, {}, {}, {}]);
  await caso.salvar({ currentTarget: caso.formulario, preventDefault() {} });
  assert.equal(caso.chamadas.filter(c => Array.isArray(c) && c[0] === "insert").length, 1);
  assert.ok(caso.chamadas.includes("recarregar"));
  assert.equal(caso.botao.disabled, false);
});
