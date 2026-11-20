const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("./monitor_processos");

const NUM = "07237373000120-1-000084/2025";

test("referência: número do PNCP, link do app do PNCP e compra de 17 dígitos", () => {
  assert.deepEqual(m.referenciaDoProcesso({ origem_externa_id: NUM }), { numero: NUM, idCompra: null });
  assert.deepEqual(m.referenciaDoProcesso({ url_origem: "https://pncp.gov.br/app/editais/07237373000120/2025/84" }), { numero: NUM, idCompra: null });
  assert.deepEqual(m.referenciaDoProcesso({ origem_externa_id: "pedido-1", url_origem: "https://x/landing?destino=a&compra=17908505901022025" }),
    { numero: null, idCompra: "17908505901022025" });
  assert.equal(m.referenciaDoProcesso({ origem_externa_id: "pedido-1" }), null);
  assert.equal(m.referenciaDoProcesso({ url_origem: "https://x/?compra=179085059010220251" }), null);
});

test("classifica impugnação, esclarecimento e aviso pelo texto do órgão", () => {
  assert.equal(m.classificarTexto("Reabertura de prazo e publicidade das IMPUGNAÇÕES"), "impugnacao");
  assert.equal(m.classificarTexto("Resposta ao pedido de esclarecimento 2"), "esclarecimento");
  assert.equal(m.classificarTexto("Errata nº 1"), "aviso");
  assert.equal(m.classificarTexto("Ajustes no edital"), null);
});

const ev = (cat, tipo, quando, extra = {}) => ({ categoriaLogManutencao: cat, tipoLogManutencao: tipo, logManutencaoDataInclusao: quando, ...extra });

test("histórico do PNCP vira mudança em linguagem simples, itens do mesmo minuto juntos", () => {
  const r = m.mudancasDoHistorico([
    ev(1, 1, "2026-11-09T08:08:37", { justificativa: "Ajustes no edital." }),
    ev(6, 0, "2026-10-29T07:01:25", { documentoTipo: "Edital", documentoTitulo: "v2", documentoSequencial: 3 }),
    ev(6, 2, "2026-10-29T07:01:24", { documentoTipo: "Edital", documentoTitulo: "v1", documentoSequencial: 2, justificativa: "Arquivo excluído pelo sistema para inclusão de um novo arquivo" }),
    ev(6, 2, "2026-10-30T07:00:00", { documentoTipo: "Outros", documentoTitulo: "x", documentoSequencial: 4, justificativa: "Publicado por engano" }),
    ev(6, 0, "2026-10-31T07:00:00", { documentoTipo: "Outros", documentoTitulo: "Resposta Esclarecimento 1", documentoSequencial: 5 }),
    ev(4, 1, "2026-11-10T10:56:20", { itemNumero: 7 }), ev(4, 1, "2026-11-10T10:56:22", { itemNumero: 2 }), ev(4, 1, "2026-11-10T10:57:01", { itemNumero: 9 }),
    ev(1, 0, "2025-09-29T07:31:52"),
  ]);
  const tipos = r.map((x) => x.tipo);
  assert.deepEqual(tipos, ["retificacao", "arquivo_novo", "arquivo_retificado", "arquivo_removido", "esclarecimento", "item_alterado", "item_alterado", "outro"]);
  assert.match(r[0].resumo, /Motivo informado: "Ajustes no edital\."/);
  assert.match(r[5].resumo, /2 itens foram alterados pelo órgão \(itens 2, 7\)/);
  assert.match(r[6].resumo, /O item 9 foi alterado/);
  assert.equal(r[0].ocorrido_em, "2026-11-09T11:08:37.000Z");
  assert.equal(new Set(r.map((x) => x.chave)).size, r.length);
});

test("compra: situação, datas e resultado só mudam com retrato anterior", () => {
  const antes = { situacao: "Divulgada no PNCP", abertura: "2026-10-29T11:00:00.000Z", encerramento: "2026-11-23T13:00:00.000Z", existeResultado: false };
  const agora = { ...antes, situacao: "Suspensa", encerramento: "2026-11-30T13:00:00.000Z", existeResultado: true, atualizacao: "2026-11-09T08:08:37" };
  const r = m.mudancasDaCompra(antes, agora);
  assert.deepEqual(r.map((x) => x.tipo), ["situacao", "data", "resultado"]);
  assert.match(r[1].resumo, /23\/11\/2026, 10:00 para 30\/11\/2026, 10:00/);
  assert.deepEqual(m.mudancasDaCompra(null, agora), []);
  assert.deepEqual(m.mudancasDaCompra(antes, { ...antes }), []);
});

test("itens: cancelados agrupados; item novo não conta como mudança", () => {
  const r = m.mudancasDosItens({ 1: "Em andamento", 2: "Em andamento", 3: "Em andamento" },
    { 1: "Anulado/Revogado/Cancelado", 2: "Anulado/Revogado/Cancelado", 3: "Homologado", 4: "Em andamento" });
  assert.deepEqual(r.map((x) => [x.tipo, x.detalhe.itens]), [["item_cancelado", [1, 2]], ["resultado", [3]]]);
  assert.deepEqual(m.mudancasDosItens(null, { 1: "x" }), []);
});

function falsos(respostas) {
  const urls = [];
  const leitor = { usadas: 0, async json(url) { urls.push(url); this.usadas++; const k = Object.keys(respostas).find((p) => url.includes(p)); return k ? respostas[k] : null; } };
  const rest = async () => ({ json: async () => respostas.chat || [] });
  return { leitor, rest, urls };
}
const COMPRA = { situacaoCompraNome: "Divulgada no PNCP", dataAberturaProposta: "2026-10-29T08:00:00", dataEncerramentoProposta: "2026-11-23T10:00:00",
  dataAtualizacaoGlobal: "2026-11-09T08:08:37", linkSistemaOrigem: "https://x/landing?compra=17908505901022025" };

test("primeira verificação grava o histórico sem alerta; a seguinte só alerta o novo e usa o cache", async () => {
  const agora = Date.parse("2026-11-19T12:00:00Z");
  const a = falsos({ "/historico": [ev(1, 1, "2026-11-09T08:08:37", { justificativa: "Ajustes" })], "/itens": [{ numeroItem: 1, situacaoCompraItemNome: "Em andamento" }], "/compras/2025/84": COMPRA,
    chat: [{ chave: "a".repeat(32), numero_item: 1, data_hora: "2026-11-19T09:00:00", texto: "Senhores, a sessão foi suspensa", tipo: "outro", gravado_em: "2026-11-19T12:00:00Z" }] });
  const r1 = await m.verificarProcesso({ numero_controle_pncp: NUM, retrato: {}, verificado_em: null }, { leitor: a.leitor, rest: a.rest, agora });
  assert.ok(r1.mudancas.length >= 2 && r1.mudancas.every((x) => x.alerta === false));
  assert.equal(r1.patch.id_compra, "17908505901022025");
  assert.equal(r1.patch.situacao, "Divulgada no PNCP");
  assert.equal(r1.mudancas.find((x) => x.tipo === "chat").fonte, "extensao");

  // Mesma atualização no PNCP e histórico lido há pouco: 1 requisição externa (a consulta) e nada novo.
  const b = falsos({ "/compras/2025/84": COMPRA });
  const r2 = await m.verificarProcesso({ numero_controle_pncp: NUM, retrato: r1.patch.retrato, verificado_em: r1.patch.verificado_em }, { leitor: b.leitor, rest: b.rest, agora: agora + 3600000 });
  assert.equal(b.urls.length, 1);
  assert.deepEqual(r2.mudancas, []);

  // Suspensa e prazo novo: alerta ligado.
  const c = falsos({ "/historico": [ev(1, 1, "2026-11-09T08:08:37", { justificativa: "Ajustes" }), ev(1, 1, "2026-11-19T14:00:00", { justificativa: "Suspensão para análise de impugnação" })],
    "/compras/2025/84": { ...COMPRA, situacaoCompraNome: "Suspensa", dataEncerramentoProposta: "2026-11-30T10:00:00", dataAtualizacaoGlobal: "2026-11-19T14:00:00" } });
  const r3 = await m.verificarProcesso({ numero_controle_pncp: NUM, retrato: r1.patch.retrato, verificado_em: r1.patch.verificado_em }, { leitor: c.leitor, rest: c.rest, agora: agora + 7200000 });
  const alertas = r3.mudancas.filter((x) => x.alerta).map((x) => x.tipo);
  // A retificação antiga volta na lista, mas o banco a ignora (on_conflict processo_id,chave já gravada na 1ª vez).
  assert.deepEqual(alertas.sort(), ["data", "impugnacao", "retificacao", "situacao"]);
  assert.ok(r1.mudancas.some((x) => x.chave === r3.mudancas.find((y) => y.tipo === "retificacao").chave));
});

test("sem número do PNCP: resolve pelo Compras.gov; sem resposta, espera um dia", async () => {
  const a = falsos({ dadosabertos: { resultado: [{ numeroControlePNCP: NUM }] }, "/compras/2025/84": COMPRA, "/historico": [], "/itens": [] });
  const r = await m.verificarProcesso({ id_compra: "17908505901022025", retrato: {} }, { leitor: a.leitor, rest: a.rest, agora: 0 });
  assert.equal(r.patch.numero_controle_pncp, NUM);
  const b = falsos({});
  const r2 = await m.verificarProcesso({ id_compra: "17908505901022025", retrato: {} }, { leitor: b.leitor, rest: b.rest, agora: 0 });
  assert.match(r2.patch.erro, /Sem número/);
  assert.equal(r2.patch.proximo_em, new Date(24 * 3600000).toISOString());
});

test("leitor espera a pausa entre requisições e trata 404 como vazio", async () => {
  let relogio = 0;
  const esperas = [];
  const leitor = m.criarLeitor({ fetchImpl: async () => ({ status: 404, ok: false }), esperar: async (ms) => { esperas.push(ms); relogio += ms; }, agora: () => relogio });
  assert.equal(await leitor.json("https://pncp.gov.br/a"), null);
  assert.equal(await leitor.json("https://pncp.gov.br/b"), null);
  assert.deepEqual(esperas, [1500]);
});

test("chat: citação do CNPJ da empresa vira aviso próprio (destinatário ou texto, com ou sem pontuação)", () => {
  const CNPJ = "11222333000181";
  const msgs = [
    { chave: "1".repeat(32), numero_item: 2, texto: "Senhor fornecedor, envie a proposta ajustada", fornecedor_chave: CNPJ },
    { chave: "2".repeat(32), numero_item: 0, texto: "Convoco a empresa 11.222.333/0001-81 para o anexo" },
    { chave: "3".repeat(32), numero_item: 0, texto: "Convoco a empresa 99.888.777/0001-66" },
  ];
  const r = m.mudancasDoChat(msgs, CNPJ);
  assert.deepEqual(r.map((x) => Boolean(x.detalhe.cita_cnpj)), [true, true, false]);
  assert.match(r[0].resumo, /citou a sua empresa \(CNPJ 11\.222\.333\/0001-81\) no chat \(item 2\)/);
  assert.equal(m.mudancasDoChat(msgs, null).some((x) => x.detalhe.cita_cnpj), false);
  assert.equal(m.citaCnpj({ texto: "x" }, "123"), false);
});

test("alerta: itens escolhidos filtram, citação sempre avisa, primeira verificação não avisa", () => {
  assert.equal(m.comAlerta({ tipo: "chat", detalhe: { item: 5 } }, false, [1, 3]), false);
  assert.equal(m.comAlerta({ tipo: "chat", detalhe: { item: 3 } }, false, [1, 3]), true);
  assert.equal(m.comAlerta({ tipo: "chat", detalhe: { item: null } }, false, [1, 3]), true); // mensagem geral
  assert.equal(m.comAlerta({ tipo: "item_alterado", detalhe: { itens: [4, 7] } }, false, [7]), true);
  assert.equal(m.comAlerta({ tipo: "item_alterado", detalhe: { itens: [4] } }, false, []), true);
  assert.equal(m.comAlerta({ tipo: "chat", detalhe: { item: 5, cita_cnpj: true } }, true, [1]), true);
  assert.equal(m.comAlerta({ tipo: "situacao", detalhe: {} }, true, []), false);
  assert.equal(m.comAlerta({ tipo: "outro", detalhe: {} }, false, []), false);
});
