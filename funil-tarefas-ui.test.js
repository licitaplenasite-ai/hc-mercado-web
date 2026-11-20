const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("./funil-tarefas-ui.js");

const ANEXO = "f9000000-0000-4000-8000-000000000031";

test("dias úteis pulam fim de semana, feriado nacional e Sexta-feira Santa", () => {
  assert.equal(T.diaUtil("2026-11-20"), false); // Consciência Negra
  assert.equal(T.diaUtil("2026-04-03"), false); // Sexta-feira Santa (Páscoa 05/04/2026)
  assert.equal(T.diaUtil("2026-11-21"), false); // sábado
  assert.equal(T.diaUtil("2026-11-19"), true);
  assert.equal(T.somarDiasUteis("2026-12-04", -3), "2026-12-01");
  assert.equal(T.somarDiasUteis("2026-11-23", -3), "2026-11-17");
  assert.equal(T.somarDiasUteis("2026-12-24", 3), "2026-12-30");
  assert.equal(T.somarDiasUteis("2026-12-04", 0), "2026-12-04");
});

test("prazos automáticos da Lei 14.133 saem das datas do processo", () => {
  const datas = T.datasDoCard({ datas: { aviso_recurso: "2026-12-24" } }, { abertura: "2026-12-04T12:00:00+00:00", ata: "2026-12-07" });
  assert.equal(datas.abertura, "2026-12-04T09:00");
  assert.equal(T.prazoAuto("esclarecimento", datas), "2026-12-01T09:00");
  assert.equal(T.prazoAuto("impugnacao", datas), "2026-12-01T09:00");
  assert.equal(T.prazoAuto("disputa", datas), "2026-12-04T09:00");
  assert.equal(T.prazoAuto("recurso", datas), "2026-12-10T17:00");
  assert.equal(T.prazoAuto("contrarrazao", datas), "2026-12-30T17:00");
  // Sem a data-base o prazo fica em aberto (a tela pede a data).
  assert.equal(T.prazoAuto("contrarrazao", T.datasDoCard(null, {})), null);
  // A data da ata informada no cartão vence a do processo.
  assert.equal(T.datasDoCard({ datas: { ata: "2026-12-08" } }, { ata: "2026-12-07" }).ata, "2026-12-08T09:00");
});

test("selo de atrasada só para tarefa aberta com data vencida", () => {
  const agora = Date.parse("2026-12-02T12:00:00-03:00");
  const datas = { abertura: "2026-12-04T09:00" };
  const card = { secoes: [{ id: "s", nome: "S", tarefas: [
    { id: "a", titulo: "Impugnar", auto: "impugnacao" },
    { id: "b", titulo: "Feita", quando: "2026-11-30T10:00", feita_em: "2026-11-30T09:00:00Z" },
    { id: "c", titulo: "Futura", quando: "2026-12-03T10:00" },
    { id: "d", titulo: "Sem data" },
  ] }] };
  assert.deepEqual(T.contar(card, datas, agora), { feitas: 1, total: 4, atrasadas: 1 });
  // Cartão nunca mexido = modelo padrão (9 tarefas, 3 seções).
  assert.equal(T.contar(null, {}).total, 9);
  assert.equal(T.contar({ secoes: [] }, {}).total, 0);
});

test("tarefa com pré-requisito não fica feita sem a prova", () => {
  assert.match(T.motivoParaNaoFechar({ exige: "resposta", resposta: " " }), /resposta/);
  assert.match(T.motivoParaNaoFechar({ exige: "documento" }), /documento/);
  assert.equal(T.motivoParaNaoFechar({ exige: "documento", anexo_id: ANEXO }), null);
  const n = T.normalizarCard({ secoes: [{ id: "s", nome: "S", tarefas: [
    { id: "r", titulo: "Pergunta", exige: "resposta", feita_em: "2026-11-20T10:00:00Z" },
    { id: "d", titulo: "Documento", exige: "documento", anexo_id: ANEXO, feita_em: "2026-11-20T10:00:00Z" },
  ] }] });
  assert.equal(n.secoes[0].tarefas[0].feita_em, undefined);
  assert.equal(n.secoes[0].tarefas[1].feita_em, "2026-11-20T10:00:00Z");
});

test("resposta recusa CPF e arquivo segue tipo e tamanho", () => {
  assert.match(T.validarResposta("ligar para 123.456.789-09"), /CPF/);
  assert.match(T.validarResposta(""), /Escreva/);
  assert.equal(T.validarResposta("Entrega em 10 dias; CNPJ 11.222.333/0001-81"), null);
  assert.match(T.validarArquivo({ name: "x.exe", size: 1 }), /PDF/);
  assert.match(T.validarArquivo({ name: "x.pdf", size: 11 * 1024 * 1024 }), /10 MB/);
  assert.equal(T.validarArquivo({ name: "proposta.PDF", size: 1000 }), null);
});

test("normalizar descarta lixo, ids repetidos e chaves desconhecidas", () => {
  const n = T.normalizarCard({ secoes: [
    { id: "s", nome: "  Leitura  ", tarefas: [{ id: "t", titulo: "A", exige: "foto", auto: "x", quando: "amanhã", hack: 1 }, { id: "t", titulo: "dup" }, { id: "MAU", titulo: "x" }] },
    { id: "s", nome: "dup", tarefas: [] },
  ], datas: { ata: "2026-12-01", aviso_recurso: "ontem" }, extra: true });
  assert.deepEqual(n, { secoes: [{ id: "s", nome: "Leitura", tarefas: [{ id: "t", titulo: "A" }] }], datas: { ata: "2026-12-01" } });
});

test("modelo guarda só a estrutura e a troca de modelo funciona", () => {
  const m = T.paraModelo([{ id: "s", nome: "S", tarefas: [{ id: "t", titulo: "A", exige: "resposta", resposta: "x", feita_em: "2026-11-20T10:00:00Z", anexo_id: ANEXO }] }]);
  assert.deepEqual(m, [{ id: "s", nome: "S", tarefas: [{ id: "t", titulo: "A", exige: "resposta" }] }]);
  assert.deepEqual(T.cardDoModelo("nenhum"), { secoes: [] });
  assert.equal(T.cardDoModelo("padrao").secoes.length, 3);
  assert.equal(T.cardDoModelo("abc", [{ id: "abc", nome: "Dispensa", secoes: m }]).secoes[0].tarefas[0].titulo, "A");
});

test("itens do monitor: até 10 números, sem repetir", () => {
  assert.deepEqual(T.itensDoTexto("7, 1; 3 e 1"), [1, 3, 7]);
  assert.deepEqual(T.itensDoTexto(""), []);
  assert.equal(T.itensDoTexto("1, dois"), null);
  assert.equal(T.itensDoTexto("0"), null);
  assert.equal(T.itensDoTexto("1 2 3 4 5 6 7 8 9 10 11"), null);
});

test("agenda recebe as tarefas abertas com data, em ordem", () => {
  const ev = T.eventosAgenda([{ id: "p1", objeto: "Papel", empresaId: "e", abertura: "2026-12-04T09:00:00-03:00", tarefas_card: { secoes: [{ id: "s", nome: "S", tarefas: [
    { id: "a", titulo: "Disputa", auto: "disputa" }, { id: "b", titulo: "Ligar", quando: "2026-11-30T10:00", responsavel: "Ana" },
    { id: "c", titulo: "Feita", quando: "2026-11-29T10:00", feita_em: "2026-11-29T09:00:00Z" }, { id: "d", titulo: "Sem data" }] }] } }]);
  assert.deepEqual(ev.map((e) => [e.id, e.inicio]), [["p1:b", "2026-11-30T10:00"], ["p1:a", "2026-12-04T09:00"]]);
  assert.equal(ev[0].responsavel, "Ana");
});

test("botão do cartão mostra contagem, atraso e o selo da sugestão escapado", () => {
  const h = T.htmlCard('x"><b>', { feitas: 1, total: 4, atrasadas: 2 }, 85);
  assert.match(h, /Tarefas 1 de 4/);
  assert.match(h, /2 tarefas atrasadas/);
  assert.match(h, /Sugerida · nota 85/);
  assert.doesNotMatch(h, /"><b>/);
  assert.doesNotMatch(T.htmlCard("x", { feitas: 0, total: 0, atrasadas: 0 }, null), /Sugerida|atrasada/);
});
