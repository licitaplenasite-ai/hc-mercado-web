const test = require("node:test");
const assert = require("node:assert/strict");
const { coletarFonte, chaveComparacao } = require("./coletar_fontes_extras");

const ORGAO = { nome: "ÓRGÃO TESTE", cnpj: "13659617000165", uf: "AM", municipio: "Manaus" };
const item = (idExterno, extra = {}) => ({ idExterno, aberto: true, objeto: `Objeto ${idExterno}`, modalidade: "Pregão", numero: idExterno.split("-")[1]?.split("/")[0], ano: 2026,
  publicacao: "2026-11-20T10:00:00", encerramento: null, orgao: ORGAO, linkOficial: "https://oficial", linkEdital: "https://pdf", versao: "1", anexos: [], ...extra });

function adaptadorFalso(itens) {
  const detalhados = [];
  return { detalhados, FONTE: { id: "teste", portal: "Site teste", paginaOficial: "https://oficial" }, ORGAO,
    listar: async () => itens,
    detalhe: async (i) => { detalhados.push(i.idExterno); return { ...i, encerramento: "2099-12-01T09:00:00" }; } };
}

// Banco falso: devolve as linhas anteriores e as do PNCP, e anota upserts e DELETEs.
function bancoFalso({ anteriores = [], pncp = [] } = {}) {
  const chamadas = { upserts: [], deletes: [] };
  return { chamadas,
    restFetch: async (caminho, op = {}) => {
      if (op.method === "DELETE") { chamadas.deletes.push(decodeURIComponent(caminho)); return {}; }
      if (caminho.includes("numero_controle_pncp=like.")) return { json: async () => pncp };
      return { json: async () => anteriores };
    },
    upsertEmLotes: async (tabela, linhas) => { chamadas.upserts.push(...linhas); return linhas.length; } };
}

test("chave de comparação junta a mesma modalidade, número e ano do PNCP", () => {
  assert.equal(chaveComparacao("Pregão - Presencial", "014", 2026), chaveComparacao("Pregão - Eletrônico", "14/2026", "2026"));
  assert.notEqual(chaveComparacao("Pregão", "14", 2026), chaveComparacao("Credenciamento", "14", 2026));
  assert.equal(chaveComparacao("Pregão", null, 2026), null);
});

test("só relê o PDF do processo com publicação nova; o resto vem do banco", async () => {
  const adaptador = adaptadorFalso([item("PP-001/2026"), item("PP-002/2026", { versao: "9" })]);
  const banco = bancoFalso({ anteriores: [
    { chave: "fonte:teste:PP-001/2026", dado: { versao: "1", encerramento: "2099-11-25T09:00:00", modalidadeNome: "Pregão - Presencial" } },
    { chave: "fonte:teste:PP-002/2026", dado: { versao: "8", encerramento: null } },
  ] });
  const r = await coletarFonte(adaptador, { banco, simular: false, desdeIso: "2026-07-28", cliente: {} });
  assert.deepEqual(adaptador.detalhados, ["PP-002/2026"]);
  assert.equal(r.pdfsLidos, 1);
  const p1 = banco.chamadas.upserts.find((l) => l.chave === "fonte:teste:PP-001/2026");
  assert.deepEqual([p1.encerramento, p1.dado.modalidadeNome], ["2099-11-25", "Pregão - Presencial"]);
  assert.ok(banco.chamadas.deletes.some((d) => d.includes("chave=like.fonte:teste:*&publicacao=lt.2026-07-28")), "retenção só desta fonte");
});

test("processo que apareceu no PNCP e processo encerrado saem da tabela", async () => {
  const adaptador = adaptadorFalso([item("PP-014/2026"), item("PP-015/2026"), item("PP-016/2026", { aberto: false })]);
  const banco = bancoFalso({
    anteriores: [{ chave: "fonte:teste:PP-014/2026", dado: { versao: "1" } }, { chave: "fonte:teste:PP-016/2026", dado: { versao: "1" } }],
    pncp: [{ dado: { modalidadeNome: "Pregão - Eletrônico", numeroCompra: "14", anoCompra: 2026 } }],
  });
  const r = await coletarFonte(adaptador, { banco, simular: false, desdeIso: "2026-07-28", cliente: {} });
  assert.deepEqual(banco.chamadas.upserts.map((l) => l.chave), ["fonte:teste:PP-015/2026"]);
  const apagadas = banco.chamadas.deletes.find((d) => d.includes("chave=in."));
  assert.ok(apagadas.includes('"fonte:teste:PP-014/2026"') && apagadas.includes('"fonte:teste:PP-016/2026"'));
  assert.equal(r.encerradasOuNoPncp, 2);
});

test("SIMULAR não toca no banco e devolve as linhas para imprimir", async () => {
  const adaptador = adaptadorFalso([item("PP-001/2026")]);
  const r = await coletarFonte(adaptador, { banco: null, simular: true, desdeIso: "2026-07-28", cliente: {} });
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].dado.fonte, "Portal do órgão, fora do PNCP");
});

test("falha ao ler um PDF não derruba a fonte", async () => {
  const adaptador = { ...adaptadorFalso([item("PP-001/2026")]), detalhe: async () => { throw new Error("PDF quebrado"); } };
  const r = await coletarFonte(adaptador, { banco: null, simular: true, desdeIso: "2026-07-28", cliente: {} });
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].encerramento, null);
});

test("prazo vencido sai da tabela, mesmo com o portal ainda dizendo aberto", async () => {
  const adaptador = adaptadorFalso([item("PP-020/2026", { encerramento: "2020-01-10T09:00:00" }), item("PP-021/2026")]);
  const banco = bancoFalso({ anteriores: [{ chave: "fonte:teste:PP-020/2026", dado: { versao: "1" } }] });
  await coletarFonte(adaptador, { banco, simular: false, desdeIso: "2026-07-28", cliente: {} });
  assert.deepEqual(banco.chamadas.upserts.map((l) => l.chave), ["fonte:teste:PP-021/2026"]);
  assert.ok(banco.chamadas.deletes.some((d) => d.includes('"fonte:teste:PP-020/2026"')));
  assert.ok(banco.chamadas.deletes.some((d) => /chave=like\.fonte:teste:\*&encerramento=lt\.\d{4}-\d{2}-\d{2}$/.test(d)), "poda por prazo só desta fonte");
});

test("linha da fonte: CPF mascarado (CNPJ não) e link só http(s)", async () => {
  const adaptador = adaptadorFalso([item("PP-030/2026", { objeto: "Contratação; pregoeiro CPF 123.456.789-09; órgão CNPJ 12345678000190",
    processo: "Proc. 98765432100", linkEdital: "javascript:alert(1)", linkOficial: null })]);
  adaptador.FONTE.paginaOficial = "ftp://x";
  const [linha] = (await coletarFonte(adaptador, { banco: null, simular: true, desdeIso: "2026-07-28", cliente: {} })).linhas;
  assert.equal(linha.dado.objeto, "Contratação; pregoeiro CPF ***.***.***-**; órgão CNPJ 12345678000190");
  assert.equal(linha.dado.processo, "Proc. ***.***.***-**");
  assert.equal(linha.dado.link, null);
});
