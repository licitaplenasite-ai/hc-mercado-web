const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("./orgaos-navegacao.js");
const { normalizarNome } = require("./ficha-orgao.js");

test("navegação de órgãos: filtros válidos, URL de ida e volta e quando a lista aparece", () => {
  const f = N.normalizarFiltros({ uf: "ac", municipio: " Rio Branco ", tipo: "prefeitura", esfera: "M", soAbertas: "1", ordem: "nome", termo: "camara" });
  assert.deepEqual(f, { uf: "AC", municipio: "Rio Branco", tipo: "prefeitura", esfera: "M", soAbertas: true, ordem: "nome", termo: "camara" });
  assert.deepEqual(N.filtrosDaUrl(N.urlDosFiltros(f)), f, "URL guarda os filtros (voltar da ficha mantém a lista)");
  assert.equal(N.urlDosFiltros(N.normalizarFiltros({})), "");
  const lixo = N.normalizarFiltros({ uf: "XX", municipio: "Manaus", tipo: "hack", esfera: "Z", ordem: "drop", soAbertas: "sim" });
  assert.deepEqual(lixo, { uf: "", municipio: "", tipo: "", esfera: "", soAbertas: false, ordem: "abertas", termo: "" }, "cidade sem UF não vale");
  assert.equal(N.listaAtiva(N.normalizarFiltros({})), false, "nada escolhido: blocos de início");
  assert.equal(N.listaAtiva(N.normalizarFiltros({ uf: "AC" })), true, "só a UF já mostra a lista");
  assert.equal(N.listaAtiva(N.normalizarFiltros({ termo: "ca" })), false, "2 letras ainda não");
  assert.equal(N.listaAtiva(N.normalizarFiltros({ termo: "04.312.369/0001-90" })), false, "CNPJ fica com o autocompletar");
  assert.equal(N.termoDaLista("ufam"), "ufam");
});

test("navegação de órgãos: parâmetros da RPC, agrupamento por tipo e textos", () => {
  const p = N.parametrosRpc(N.normalizarFiltros({ uf: "AM", termo: "12" }), 30);
  assert.deepEqual(p, { p_uf: "AM", p_municipio: null, p_tipo: null, p_esfera: null, p_so_abertas: false, p_ordem: "abertas", p_limite: 30, p_offset: 30, p_termo: null, p_agrupar: true });
  assert.equal(N.parametrosRpc(N.normalizarFiltros({ tipo: "saude" })).p_agrupar, false, "um tipo só: sem títulos de grupo");
  const g = N.agruparPorTipo([{ tipo: "prefeitura" }, { tipo: "prefeitura" }, { tipo: "legislativo" }, { tipo: "xyz" }]);
  assert.deepEqual(g.map((x) => [x.tipo, x.rotulo, x.itens.length]), [["prefeitura", "Prefeituras", 2], ["legislativo", "Câmaras e Assembleias", 1], ["xyz", "Outros", 1]]);
  assert.deepEqual(N.agruparPorTipo(null), []);
  assert.equal(N.tituloLista(1, N.normalizarFiltros({ uf: "BA" })), "1 órgão na Bahia");
  assert.equal(N.tituloLista(1234, N.normalizarFiltros({ uf: "PA", municipio: "Belém", esfera: "E", soAbertas: true })), "1.234 órgãos no Pará · Belém · esfera estadual · com licitação aberta agora");
  assert.equal(N.tituloLista(0, N.normalizarFiltros({ tipo: "universidade" })), "0 órgãos no Brasil · Universidades e institutos federais");
  assert.equal(N.noEstado("SP"), "em São Paulo");
  assert.deepEqual(N.ufsDoCliente(["am", "AM", " pa ", "Todos", null, "XX"]), ["AM", "PA"]);
  assert.deepEqual(N.ufsDoCliente("AM"), []);
  assert.equal(N.TIPOS.length, 13, "mesmos 13 grupos de orgao_tipo (supabase/orgaos_navegacao.sql)");
});

test("navegação de órgãos: título e link da seção 'órgãos do mesmo município/governo' da ficha", () => {
  assert.deepEqual(N.textoEnte({ ente: "municipio", uf: "AM", municipio: "Manaus" }),
    { titulo: "Órgãos do mesmo município: Manaus/AM", soma: "Prefeitura, câmara, secretarias e fundos", lista: "?uf=AM&cidade=Manaus&esfera=M" });
  assert.equal(N.textoEnte({ ente: "estado", uf: "AM" }).titulo, "Órgãos do mesmo governo: Estado do Amazonas");
  assert.equal(N.textoEnte({ ente: "estado", uf: "BA" }).titulo, "Órgãos do mesmo governo: Estado da Bahia");
  assert.equal(N.textoEnte({ ente: "estado", uf: "SP" }).lista, "?uf=SP&esfera=E");
});

test("navegação de órgãos: órgãos com que a organização já disputou, pelo CNPJ ou pelo nome", () => {
  const r = N.orgaosDisputados([
    { origem_externa_id: "04365326000173-1-000010/2026", orgao: "Prefeitura de Manaus", situacao_resultado: "ganhou" },
    { origem_externa_id: "04365326000173-1-000011/2026", orgao: "MUNICIPIO DE MANAUS", status: "triagem" },
    { origem_externa_id: null, orgao: "Câmara de Apuí" }, { origem_externa_id: null, orgao: "CAMARA DE APUI", status: "contratado" },
    { origem_externa_id: null, orgao: "AB" }, null,
  ], normalizarNome);
  assert.deepEqual(r, [
    { cnpj: null, nome: "Câmara de Apuí", disputas: 2, ganhou: 1 },
    { cnpj: "04365326000173", nome: "Prefeitura de Manaus", disputas: 2, ganhou: 1 },
  ], "empate em disputas: ordem alfabética");
  assert.deepEqual(N.orgaosDisputados(undefined, normalizarNome), []);
});
