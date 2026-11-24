const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./funil-crm-ui.js");

test("total da coluna soma em centavos, prefere o valor proposto e conta à parte os cartões sem valor", () => {
  const t = C.totalDaColuna([
    { valorTotalEstimado: 0.1 }, { valorTotalEstimado: 0.2 },
    { precoProposta: 900, valorTotalEstimado: 1000 },
    { valor: "R$ 1.234,56" },
    { valorTotalEstimado: null }, {}, { valorTotalEstimado: 0 }, { valor: "abc" },
  ]);
  assert.deepEqual(t, { quantidade: 8, total: 2134.86, semValor: 4 });
  assert.deepEqual(C.totalDaColuna([]), { quantidade: 0, total: 0, semValor: 0 });
  assert.deepEqual(C.totalDaColuna(undefined), { quantidade: 0, total: 0, semValor: 0 });
});

test("valor do cartão: número, texto em reais, texto com ponto decimal; negativo não conta", () => {
  assert.equal(C.valorDoCard({ valor: "1.234,56" }), 1234.56);
  assert.equal(C.valorDoCard({ valor: "1234.5" }), 1234.5);
  assert.equal(C.valorDoCard({ valor: "150.000" }), 150000, "ponto de milhar não vira decimal");
  assert.equal(C.valorDoCard({ valor: "R$ 1.234.567" }), 1234567);
  assert.equal(C.valorDoCard({ valor: "R$ 1.234.567,89" }), 1234567.89);
  assert.equal(C.valorDoCard({ valor: "12.5" }), 12.5);
  assert.equal(C.valorDoCard({ precoProposta: -5, valorTotalEstimado: 10 }), 10);
  assert.equal(C.valorDoCard({}), null);
});

test("HTML do total deixa claro que cartão sem valor conta R$ 0", () => {
  const html = C.htmlTotal({ quantidade: 2, total: 1500, semValor: 1 });
  assert.match(html, /R\$\s?1\.500,00/);
  assert.match(html, /2 licitações/);
  assert.match(html, /1 sem valor \(conta R\$ 0\)/);
  assert.doesNotMatch(C.htmlTotal({ quantidade: 1, total: 10, semValor: 0 }), /sem valor/);
});

test("limite da etapa: próprio, 0 desliga, vazio cai no padrão do estágio; finais sem alerta", () => {
  assert.equal(C.limiteDaEtapa({ limite_parado_dias: 12, status_sistema: "triagem" }), 12);
  assert.equal(C.limiteDaEtapa({ limite_parado_dias: 0, status_sistema: "triagem" }), null);
  assert.equal(C.limiteDaEtapa({ limite_parado_dias: null, status_sistema: "sessao" }), 3);
  assert.equal(C.limiteDaEtapa(null, "triagem"), 7);
  assert.equal(C.limiteDaEtapa({ status_sistema: "perdido" }), null);
  assert.equal(C.limiteDaEtapa({ status_sistema: "contratado" }), null);
});

test("dias parado contam por dia civil de Brasília", () => {
  const as23h = Date.parse("2026-11-20T23:30:00-03:00");
  assert.equal(C.diasParado(as23h, Date.parse("2026-11-21T00:10:00-03:00")), 1);
  assert.equal(C.diasParado(as23h, Date.parse("2026-11-20T23:59:00-03:00")), 0);
  assert.equal(C.diasParado(as23h, Date.parse("2026-11-27T08:00:00-03:00")), 7);
  assert.equal(C.diasParado(NaN), null);
  assert.equal(C.diasParado(Date.parse("2026-12-01T00:00:00Z"), Date.parse("2026-11-01T00:00:00Z")), 0, "data no futuro não dá negativo");
});

test("cartão parado: acende só depois do limite; tarefa concluída zera a contagem", () => {
  const agora = Date.parse("2026-11-24T10:00:00-03:00");
  const base = { etapaDesde: "2026-11-18T10:00:00-03:00" }; // 6 dias
  assert.deepEqual(C.estadoParado(base, 5, agora), { dias: 6, limite: 5, parado: true, aproximada: false });
  assert.equal(C.estadoParado(base, 6, agora).parado, false, "no dia do limite ainda não");
  const comChecklist = { ...base, checklistFunil: { "analisar-edital": "2026-11-23T09:00:00-03:00" } };
  assert.equal(C.estadoParado(comChecklist, 5, agora).dias, 1);
  const comTarefa = { ...base, tarefasCard: { secoes: [{ tarefas: [{ id: "a" }, { id: "b", feita_em: "2026-11-24T08:00:00-03:00" }] }] } };
  assert.equal(C.estadoParado(comTarefa, 5, agora).dias, 0);
  assert.equal(C.estadoParado(base, null, agora), null, "etapa sem limite");
});

test("cartão antigo sem etapa_desde conta da última atualização e fica marcado como aproximado", () => {
  const agora = Date.parse("2026-11-24T10:00:00-03:00");
  const e = C.estadoParado({ etapaDesde: null, atualizadoEm: "2026-11-10T10:00:00-03:00" }, 7, agora);
  assert.deepEqual(e, { dias: 14, limite: 7, parado: true, aproximada: true });
  assert.match(C.htmlSeloParado(e), /Parado há 14 dias/);
  assert.match(C.htmlSeloParado(e), /última atualização/);
  assert.equal(C.estadoParado({}, 7, agora), null, "sem data nenhuma não acusa");
  assert.equal(C.htmlSeloParado({ dias: 3, limite: 5, parado: false }), "");
});

test("motivo da perda: obrigatório, 'Outro' exige texto, limite de tamanho e sem CPF", () => {
  assert.match(C.validarMotivo("", ""), /Escolha/);
  assert.match(C.validarMotivo("inventado", ""), /Escolha/);
  assert.equal(C.validarMotivo("preco", ""), null);
  assert.match(C.validarMotivo("outro", "  a "), /pelo menos 3/);
  assert.equal(C.validarMotivo("outro", "Órgão cancelou o item"), null);
  assert.match(C.validarMotivo("preco", "x".repeat(301)), /até 300/);
  assert.match(C.validarMotivo("documento", "falar com 123.456.789-09"), /CPF/);
});

test("texto do motivo vai para motivo_perda e volta ao código para o relatório", () => {
  assert.equal(C.textoMotivo("preco", ""), "Preço acima do vencedor");
  assert.equal(C.textoMotivo("documento", "  CND   vencida "), "Inabilitação ou documento: CND vencida");
  for (const [codigo] of C.MOTIVOS_PERDA) assert.equal(C.codigoDoMotivo(C.textoMotivo(codigo, "detalhe")), codigo);
  assert.equal(C.codigoDoMotivo("Preço acima do vencedor"), "preco");
  assert.equal(C.codigoDoMotivo("texto livre antigo do processos.html"), "outro");
  assert.equal(C.codigoDoMotivo(""), null);
});

test("filtro salvo: só campos preenchidos, marcado como do Funil, e volta igual para a tela", () => {
  const f = { visao: "lista", texto: " limpeza ", portal: "Compras.gov.br", modalidade: "", de: "2026-12-01", ate: "", favoritas: true };
  const salvo = C.filtroParaSalvar(f, true);
  assert.deepEqual(salvo, { tela: "funil", texto: "limpeza", portal: "Compras.gov.br", de: "2026-12-01", favoritas: true, vence3: true });
  assert.deepEqual(C.filtroSalvoParaTela(salvo), {
    filtros: { texto: "limpeza", portal: "Compras.gov.br", modalidade: "", de: "2026-12-01", ate: "", favoritas: true }, vence3: true,
  });
  assert.deepEqual(C.filtroParaSalvar({}, false), { tela: "funil" });
  assert.equal(C.nomeFiltroValido("  Minhas   favoritas "), "Minhas favoritas");
  assert.equal(C.nomeFiltroValido("   "), null);
  assert.equal(C.nomeFiltroValido("x".repeat(61)), null);
});

test("HTML dos filtros salvos escapa o nome e só deixa salvar com filtro escolhido", () => {
  const html = C.htmlSalvos([{ id: "1", nome: "<b>x</b>" }], false, false, "");
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /data-fc-novo disabled/);
  assert.match(C.htmlSalvos([], true, true, ""), /data-fc-form/);
});
