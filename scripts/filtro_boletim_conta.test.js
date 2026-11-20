const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
function funcao(nome) {
  const inicio = html.search(new RegExp(`  (?:async )?function ${nome}\\(`));
  assert.ok(inicio >= 0, `${nome} deve existir`);
  return html.slice(inicio, html.indexOf("\n  }", inicio) + 4);
}
// Banco falso: clientes (filtro da conta) e boletim_filtros_empresa (filtro por empresa, supabase/boletim_por_empresa.sql).
// empresas = null simula conta sem empresa cadastrada (o painel volta ao filtro da conta).
function ambiente({ remoto = null, erro = null, cache = {}, empresas = null, porEmpresa = [], ativa = null } = {}) {
  const dados = new Map(Object.entries(cache));
  const escritas = [];
  let contaAtual = { boletim_filtro: remoto };
  const linhas = porEmpresa.map((l) => ({ ...l }));
  const consulta = (resolver) => {
    const q = { eq() { return q; }, select() { return q; }, maybeSingle: async () => resolver(), then: (ok, falha) => Promise.resolve(resolver()).then(ok, falha) };
    return q;
  };
  const sb = { from(tabela) {
    if (tabela === "clientes") return {
      select: () => consulta(() => ({ data: contaAtual, error: erro })),
      update(valor) { escritas.push({ tabela, valor }); if (!erro) contaAtual = valor; return consulta(() => ({ data: erro ? null : valor, error: erro })); },
    };
    assert.equal(tabela, "boletim_filtros_empresa");
    return {
      select: () => consulta(() => ({ data: linhas, error: erro })),
      insert(valor) { escritas.push({ tabela, valor }); linhas.push(valor); return consulta(() => ({ data: null, error: erro })); },
      upsert(valor) {
        escritas.push({ tabela, valor });
        if (!erro) { const i = linhas.findIndex((l) => l.empresa_id === valor.empresa_id); if (i >= 0) linhas[i] = valor; else linhas.push(valor); }
        return consulta(() => ({ data: erro ? null : valor, error: erro }));
      },
    };
  } };
  const contexto = vm.createContext({
    window: { __clienteIdAtual: "conta-a", __clientePronto: Promise.resolve({ status: "aprovado" }), __sbClient: sb },
    localStorage: { getItem: (k) => dados.get(k) || null, setItem: (k, v) => dados.set(k, v) },
    empresaOperacionalId: ativa,
    empresaOperacionalParaDossie: async (id) => {
      if (!empresas) throw new Error("Cadastre uma empresa");
      return { organizacaoId: "org-1", empresa: empresas.find((e) => e.id === id) || empresas[0], empresas };
    },
    normalizarUfs: (ufs) => [...new Set((Array.isArray(ufs) ? ufs : String(ufs || "").split(",")).map((s) => s.trim().toUpperCase()).filter((s) => ["AM", "SP"].includes(s)))],
  });
  for (const nome of ["donoFiltroBoletim", "chaveFiltroBoletimConta", "lerFiltroBoletim", "filtrosBoletimDasEmpresas", "carregarFiltroBoletimConta", "salvarFiltroBoletim"]) vm.runInContext(funcao(nome), contexto);
  return { contexto, dados, escritas, linhas };
}
const HCM = { id: "e-hcm", razao_social: "HCM" }, RYMO = { id: "e-rymo", razao_social: "RYMO" };

test("sem empresa: navegador vazio recupera o filtro da conta", async () => {
  const { contexto } = ambiente({ remoto: { ufs: ["AM"], palavrasRaw: "expediente" } });
  await contexto.carregarFiltroBoletimConta();
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "expediente");
});
test("sem empresa: preferência remota prevalece sobre cache antigo e não lê outra conta", async () => {
  const { contexto } = ambiente({ remoto: { ufs: ["AM"], palavrasRaw: "novo" }, cache: {
    "hc_boletim_filtro:conta-a:conta": JSON.stringify({ ufs: ["SP"], palavrasRaw: "antigo" }),
    "hc_boletim_filtro:conta-b:conta": JSON.stringify({ ufs: ["SP"], palavrasRaw: "privado" }),
  } });
  await contexto.carregarFiltroBoletimConta();
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "novo");
  contexto.window.__clienteIdAtual = "conta-c";
  assert.equal(contexto.lerFiltroBoletim(), null);
});
test("sem empresa: salvar confirma persistência remota antes de trocar filtro local", async () => {
  const { contexto, escritas } = ambiente();
  await contexto.carregarFiltroBoletimConta();
  await contexto.salvarFiltroBoletim(["am", "AM"], "  expediente  ");
  assert.equal(escritas.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(escritas[0])), { tabela: "clientes", valor: { boletim_filtro: { ufs: ["AM"], uf: "AM", palavrasRaw: "expediente" } } });
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "expediente");
});
test("falha de banco não aparenta sucesso nem apaga filtro anterior", async () => {
  const anterior = { ufs: ["AM"], palavrasRaw: "anterior" };
  const { contexto } = ambiente({ erro: { message: "indisponível" }, cache: { "hc_boletim_filtro:conta-a:conta": JSON.stringify(anterior) } });
  contexto.window.__filtroBoletimEmpresa = null;
  await assert.rejects(contexto.salvarFiltroBoletim(["AM"], "novo"), /indisponível/);
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "anterior");
});
test("migração: o filtro antigo da conta vira o da empresa ativa, uma vez só", async () => {
  const { contexto, escritas, linhas } = ambiente({ remoto: { ufs: ["AM"], palavrasRaw: "limpeza" }, empresas: [HCM, RYMO], ativa: "e-rymo" });
  await contexto.carregarFiltroBoletimConta();
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "limpeza");
  assert.deepEqual(JSON.parse(JSON.stringify(escritas.map((e) => [e.tabela, e.valor.empresa_id]))), [["boletim_filtros_empresa", "e-rymo"]]);
  // A outra empresa começa vazia e pode copiar.
  contexto.empresaOperacionalId = "e-hcm";
  await contexto.carregarFiltroBoletimConta();
  assert.equal(contexto.lerFiltroBoletim(), null);
  assert.equal(contexto.window.__filtrosBoletimOutras[0].nome, "RYMO");
  assert.equal(linhas.length, 1);
});
test("duas empresas: cada uma salva e lê o próprio filtro ao trocar e voltar", async () => {
  const { contexto } = ambiente({ empresas: [HCM, RYMO], ativa: "e-hcm",
    porEmpresa: [{ empresa_id: "e-hcm", filtro: { ufs: ["AM"], palavrasRaw: "limpeza" } }] });
  await contexto.carregarFiltroBoletimConta();
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "limpeza");
  contexto.empresaOperacionalId = "e-rymo";
  await contexto.carregarFiltroBoletimConta();
  assert.equal(contexto.lerFiltroBoletim(), null);
  await contexto.salvarFiltroBoletim(["SP"], "café");
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "café");
  contexto.empresaOperacionalId = "e-hcm";
  await contexto.carregarFiltroBoletimConta();
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "limpeza");
  contexto.empresaOperacionalId = "e-rymo";
  await contexto.carregarFiltroBoletimConta();
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "café");
});
