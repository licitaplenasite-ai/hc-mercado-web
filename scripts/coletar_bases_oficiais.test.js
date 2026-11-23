const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./coletar_bases_oficiais");

const R = C.SICRO_RAIZ;
// Recorte da página da região Norte (22/11/2026): link por UF e mês, com "revisado" e a pasta fora do padrão do Acre.
const NORTE = `
<a href="${R}/norte/amazonas/2026/abril/abril-2026">Abril</a>
<a href="${R}/norte/amazonas/2026/julho/julho-2026">Julho</a>
<a href="${R}/norte/acre/2026/abril-2026/abril-2026">Abril</a>
<a href="${R}/norte/acre/2018/julho/julho-2018-revisado">Julho revisado</a>
<a href="${R}/norte/para/2026/julho/julho-2026">Julho</a>
<a href="${R}/norte/para/2026/julho/julho-2026-revisado">Julho revisado</a>
<a href="http://www.facebook.com/sharer.php?u=${R}/norte/norte">compartilhar</a>
<a href="${R}/norte/atlantida/2026/julho/julho-2026">UF que não existe</a>`;

test("sicroMesesDaRegiao: mês mais novo de cada UF, revisado vence, pasta fora do padrão e UF desconhecida", () => {
  const m = C.sicroMesesDaRegiao(NORTE, "norte");
  assert.deepEqual(Object.keys(m).sort(), ["AC", "AM", "PA"]);
  assert.equal(m.AM.mes, "2026-07");
  assert.equal(m.AC.mes, "2026-04");
  assert.equal(m.PA.revisado, true);
  assert.match(m.PA.url, /julho-2026-revisado$/);
});

test("sicroArquivo acha o .7z da página do mês", () => {
  assert.equal(C.sicroArquivo(`<a href="${R}/norte/amazonas/2026/julho/am-07-2026.7z" class="internal-link">Julho/2026</a>`), `${R}/norte/amazonas/2026/julho/am-07-2026.7z`);
  assert.equal(C.sicroArquivo("<p>sem arquivo</p>"), null);
});

test("lerTabelaPorCabecalho: acha o cabeçalho pelo nome, ignora título e linha sem preço, lê coluna com desoneração", () => {
  const linhas = [
    ["DNIT - SICRO", "", "", ""],
    ["Relatório Sintético de Composições de Custos", "", "", ""],
    [],
    ["Código", "Descrição", "Unidade", "Custo Unitário", "Custo Unitário com desoneração"],
    ["5502978", "Compactação de aterros a 100% do Proctor normal", "m³", 4.5123, 4.3101],
    ["", "FASE 1", "", ""],
    ["5502985", "Escavação", "m³", 0, 0],
    ["M0001", "Areia média", "m³", "abc", ""],
  ];
  const r = C.lerTabelaPorCabecalho(linhas);
  assert.equal(r.temDesonerado, true);
  assert.deepEqual(r.linhas, [{ codigo: "5502978", descricao: "Compactação de aterros a 100% do Proctor normal", unidade: "m³", preco: 4.5123, precoDesonerado: 4.3101 }]);
});

test("lerTabelaPorCabecalho sem cabeçalho reconhecível devolve vazio (o robô para e avisa)", () => {
  assert.deepEqual(C.lerTabelaPorCabecalho([["a", "b"], [1, 2]]), { linhas: [], temDesonerado: false });
});

test("partesSicro e versaoSicro: preços por UF no formato do SINAPI e regra de arredondamento do SICRO", () => {
  const p = Object.fromEntries(C.partesSicro("AM", [{ codigo: "5502978", descricao: "Compactação", unidade: "m³", preco: 4.51, precoDesonerado: null }], [{ codigo: "M0001", descricao: "Areia", unidade: "m³", preco: 90, precoDesonerado: null }]).map((x) => [x.parte, x.conteudo]));
  assert.deepEqual(p["precos:AM:55"], { "composicao|5502978": [4.51, null] });
  assert.deepEqual(p["precos:AM:M0"], { "insumo|M0001": [90, null] });
  const v = C.versaoSicro("AM", "2026-07", "https://x/am-07-2026.7z", "precos", 2, "nao_informado");
  assert.equal(v.arredondamento, "arredondar");
  assert.equal(v.versao, "07/2026");
  assert.equal(v.data_base, "2026-07-01");
  assert.equal(v.arquivo, "am-07-2026.7z");
});

test("seinfraVersoes e orseUltimoMes leem o texto da página oficial", () => {
  assert.deepEqual(C.seinfraVersoes("<li>Tabela 028 Sem Desoneração</li><li>Tabela 028.1 Com Desoneração</li>"), [{ versao: "028", desonerado: false }, { versao: "028.1", desonerado: true }]);
  assert.equal(C.orseUltimoMes('<a href="contardownloads.asp?url=downloads/20260701-00.ORSE">x</a> 20260801-00.ORSE 20251201-01.ORSE'), "2026-08");
  assert.equal(C.orseUltimoMes("nada"), null);
});

test("atrasada: SICRO trimestral com 2 meses de tolerância; base sem calendário nunca atrasa", () => {
  assert.equal(C.atrasada("SICRO", "2026-07", Date.UTC(2026, 10, 22)), false); // 4 meses
  assert.equal(C.atrasada("SICRO", "2026-04", Date.UTC(2026, 10, 22)), true); // 7 meses
  assert.equal(C.atrasada("SEINFRA-CE", "2023-10", Date.UTC(2026, 10, 22)), false);
});

// ---------- rota reserva (arquivo baixado no navegador) e "falha não apaga nada" ----------
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "bases-reserva-"));
const fetchOriginal = globalThis.fetch;
const ENV = ["BASES_ARQUIVO", "BASES_RELEASE", "BASES", "SICRO_UFS"];
test.after(() => { globalThis.fetch = fetchOriginal; for (const k of ENV) delete process.env[k]; fs.rmSync(pasta, { recursive: true, force: true }); });
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "chave-de-teste";
// Banco falso: qualquer site que não seja o Supabase responde 403 (o site barrando o robô); anota cada pedido.
function bancoFalso(versoes = []) {
  const pedidos = [];
  globalThis.fetch = async (url, op = {}) => {
    const metodo = op.method || "GET", u = String(url);
    pedidos.push({ metodo, u, corpo: op.body });
    if (!u.includes("supabase.co")) return new Response("bloqueado", { status: 403 });
    if (u.includes("bases_preco_versoes?base=eq.")) return Response.json(versoes);
    if (u.includes("bases_preco_versoes?on_conflict")) return Response.json([{ id: 9 }]);
    if (u.includes("dados_robo?chave")) return Response.json([]);
    return new Response(null, { status: 201 });
  };
  return pedidos;
}
const arquivo = (nome, conteudo) => { const c = path.join(pasta, nome); fs.writeFileSync(c, conteudo); return c; };
const rodar = async (env) => { for (const k of ENV) delete process.env[k]; Object.assign(process.env, env); return C.main(); };
// Escritas no banco, fora a retenção de 24 meses (que roda sempre e só apaga data-base antiga).
const escritas = (pedidos) => pedidos.filter((p) => p.metodo !== "GET" && !/data_base=lt\./.test(p.u));

test("arquivoReserva: nome oficial diz base/UF/mês; tag, BASES e SICRO_UFS têm que concordar", () => {
  assert.deepEqual(C.arquivoReserva("/x/am-07-2026.7z", { tag: "sicro-am-2026-07", bases: "SICRO", ufs: "am" }), { base: "SICRO", uf: "AM", mes: "2026-07", tag: "sicro-am-2026-07", nome: "am-07-2026.7z", caminho: "/x/am-07-2026.7z" });
  assert.equal(C.arquivoReserva("20261001-00.ORSE", { tag: "orse-2026-10" }).mes, "2026-10");
  assert.equal(C.arquivoReserva("tabela.html", { tag: "seinfra-ce-2026-11" }).base, "SEINFRA-CE");
  assert.throws(() => C.arquivoReserva("am-07-2026.7z", { tag: "sicro-am-2026-04" }), /devia ser sicro-am-2026-07/);
  assert.throws(() => C.arquivoReserva("am-07-2026.7z", { ufs: "PA" }), /SICRO AM, mas SICRO_UFS pede PA/);
  assert.throws(() => C.arquivoReserva("20261001-00.ORSE", { bases: "SICRO" }), /é ORSE, mas BASES pede SICRO/);
  assert.throws(() => C.arquivoReserva("tabela.html", { tag: "orse-2026-10" }), /devia ser seinfra-ce-AAAA-MM/);
  assert.throws(() => C.arquivoReserva("am-07-2026 (1).7z"), /nome oficial/);
  assert.throws(() => C.arquivoReserva("xx-07-2026.7z"), /nome oficial/); // UF que não existe
  assert.throws(() => C.arquivoReserva("am-08-2026.7z"), /nome oficial/); // SICRO só sai em jan/abr/jul/out
});

test("rota reserva ORSE: grava o catálogo do mês do arquivo sem falar com o site", async () => {
  const pedidos = bancoFalso();
  await rodar({ BASES_ARQUIVO: arquivo("20261001-00.ORSE", "x"), BASES_RELEASE: "orse-2026-10" });
  assert.ok(pedidos.every((p) => p.u.includes("supabase.co")), "não fala com o ORSE");
  const v = JSON.parse(pedidos.find((p) => p.u.includes("bases_preco_versoes?on_conflict")).corpo)[0];
  assert.equal(v.data_base, "2026-10-01");
  assert.equal(v.arquivo, "20261001-00.ORSE");
});

test("rota reserva SEINFRA-CE: lê a versão da página salva", async () => {
  const pedidos = bancoFalso();
  await rodar({ BASES_ARQUIVO: arquivo("tabela-de-custos.html", "<li>Tabela 029 Sem Desoneração</li><li>Tabela 029.1 Com Desoneração</li>"), BASES_RELEASE: "seinfra-ce-2026-11" });
  assert.ok(pedidos.every((p) => p.u.includes("supabase.co")));
  assert.equal(JSON.parse(pedidos.find((p) => p.u.includes("bases_preco_versoes?on_conflict")).corpo)[0].versao, "029 / 029.1");
});

test("rota reserva SICRO: .7z falso falha como formato_mudou e só grava a saúde", async () => {
  const pedidos = bancoFalso();
  await assert.rejects(rodar({ BASES_ARQUIVO: arquivo("am-07-2026.7z", "não é 7z"), BASES_RELEASE: "sicro-am-2026-07" }), /Falharam: SICRO/);
  assert.ok(pedidos.every((p) => p.u.includes("supabase.co")));
  assert.ok(escritas(pedidos).every((p) => p.u.includes("dados_robo")), "nenhuma escrita em bases_preco_*");
  assert.match(escritas(pedidos).find((p) => p.u.includes("dados_robo")).corpo, /formato_mudou/);
});

test("rota reserva SICRO: mês já gravado com preço não é regravado (nem abre o arquivo)", async () => {
  const pedidos = bancoFalso([{ abrangencia: "AM", data_base: "2026-07-01", situacao: "precos" }]);
  await rodar({ BASES_ARQUIVO: path.join(pasta, "am-07-2026.7z"), BASES_RELEASE: "sicro-am-2026-07" });
  assert.ok(!escritas(pedidos).some((p) => p.u.includes("bases_preco_")));
});

test("rota reserva com página sem versão ou tag errada: falha sem gravar versão", async () => {
  let pedidos = bancoFalso();
  await assert.rejects(rodar({ BASES_ARQUIVO: arquivo("pagina.html", "<p>erro 500</p>"), BASES_RELEASE: "seinfra-ce-2026-11" }), /Falharam: SEINFRA-CE/);
  assert.ok(!escritas(pedidos).some((p) => p.u.includes("bases_preco_")));
  pedidos = bancoFalso();
  await assert.rejects(rodar({ BASES_ARQUIVO: path.join(pasta, "20261001-00.ORSE"), BASES_RELEASE: "orse-2026-09" }), /devia ser orse-2026-10/);
  assert.equal(pedidos.length, 0);
});
