const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("./funil-checklist-ui.js");

// As 4 etapas que garantir_etapas_funil cria (operacao_funil_etapas.sql).
const ETAPAS = [
  { id: "e0", nome: "Tenho interesse", ordem: 0, status_sistema: "triagem" },
  { id: "e1", nome: "Participando", ordem: 1, status_sistema: "preparacao" },
  { id: "e2", nome: "Ganhei", ordem: 2, status_sistema: "homologado" },
  { id: "e3", nome: "Perdi", ordem: 3, status_sistema: "perdido" },
];

test("funil padrão dá as 15 tarefas do Siga Pregão para quem não perdeu", () => {
  assert.deepEqual(F.contarChecklist(ETAPAS, ETAPAS[0], {}, {}), { feitas: 0, total: 15 });
  assert.deepEqual(F.contarChecklist(ETAPAS, ETAPAS[2], {}, {}), { feitas: 0, total: 15 });
});

test("cartão em Perdi não conta 'Assinar o contrato'", () => {
  const c = F.contarChecklist(ETAPAS, ETAPAS[3], {}, {});
  assert.equal(c.total, 14);
  const ids = F.gruposDoCaminho(ETAPAS, ETAPAS[3]).flatMap((g) => g.tarefas.map((t) => t.id));
  assert.ok(!ids.includes("assinar-contrato"));
  assert.ok(ids.includes("recurso-contrarrazao"));
});

test("marcação manual e esteira pronta contam como feitas; esteira em andamento não", () => {
  const marcas = { "documentos-habilitacao": "2026-11-19T10:00:00Z" };
  assert.equal(F.contarChecklist(ETAPAS, ETAPAS[0], marcas, { exigencias: "feito", historico: "executando" }).feitas, 2);
});

test("mesma tarefa em duas etapas conta uma vez só", () => {
  const etapas = [...ETAPAS, { id: "e4", nome: "Habilitação", ordem: 2, status_sistema: "habilitacao" }];
  assert.equal(F.contarChecklist(etapas, etapas[0], {}, {}).total, 15);
});

test("etapa editada usa a lista salva; lista inválida é limpa", () => {
  const etapa = { ...ETAPAS[1], tarefas: [{ id: "x-1", titulo: "  Ligar  pro pregoeiro " }, { id: "X!", titulo: "inválida" }, { id: "x-1", titulo: "repetida" }, { id: "x-2", titulo: "", link: "defesa" }] };
  assert.deepEqual(F.tarefasDaEtapa(etapa), [{ id: "x-1", titulo: "Ligar pro pregoeiro" }]);
  assert.deepEqual(F.normalizarTarefas([{ id: "a", titulo: "A", link: "javascript", esteira: "nada" }]), [{ id: "a", titulo: "A" }]);
  const muitas = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, titulo: `T${i}` }));
  assert.equal(F.normalizarTarefas(muitas).length, F.LIMITE_TAREFAS);
});

test("links da Central de Defesa e do Jurídico ficam nas tarefas certas", () => {
  const todas = Object.values(F.GRUPOS).flat();
  assert.equal(todas.find((t) => t.id === "esclarecimento-impugnacao").link, "defesa");
  assert.equal(todas.find((t) => t.id === "recurso-contrarrazao").link, "juridico");
});

test("filtros: nome sem acento, portal, modalidade, período e favoritas", () => {
  const itens = [
    { id: "a", portal: "Compras.gov.br", favorito: true, edital: { objeto: "Aquisição de café", orgao: "Prefeitura", modalidade: "Pregão - Eletrônico", encerramento: "2026-12-05T10:00:00" } },
    { id: "b", portal: "BLL Compras", favorito: false, edital: { objeto: "Material de limpeza", orgao: "Câmara", modalidade: "Dispensa", encerramento: "2026-11-20" } },
    { id: "c", portal: null, favorito: false, edital: { objeto: "Sem data", modalidade: "Dispensa" } },
  ];
  const ids = (f) => F.filtrarCards(itens, f).map((i) => i.id);
  assert.deepEqual(ids({ texto: "CAFE" }), ["a"]);
  assert.deepEqual(ids({ texto: "camara" }), ["b"]);
  assert.deepEqual(ids({ portal: "BLL Compras" }), ["b"]);
  assert.deepEqual(ids({ modalidade: "Dispensa" }), ["b", "c"]);
  assert.deepEqual(ids({ de: "2026-12-01" }), ["a"]);
  assert.deepEqual(ids({ ate: "2026-11-30" }), ["b"]);
  assert.deepEqual(ids({ favoritas: true }), ["a"]);
  assert.deepEqual(ids({}), ["a", "b", "c"]);
  assert.deepEqual(F.opcoesFiltro(itens).portais, ["BLL Compras", "Compras.gov.br"]);
  assert.equal(F.filtroAtivo({ visao: "lista" }), false);
});

test("HTML escapa texto vindo do edital", () => {
  const html = F.htmlLista([{ id: "x\"", edital: { objeto: "<img src=x>" }, etapaNome: "E", contagem: { feitas: 1, total: 2 } }]);
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("1 de 2"));
  const arq = F.htmlArquivados([{ id: "p", origem_externa_id: "o", objeto: "<b>", valor_estimado: 10 }], () => null);
  assert.ok(!arq.includes("<b>") && arq.includes("R$"));
});
