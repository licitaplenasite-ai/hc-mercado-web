const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("./funil-metas-ui.js");

test("meta: faturamento que a margem precisa gerar, valor mínimo e disputas", () => {
  const r = M.calcularMeta({ pro_labore: 10000, custo_empresa: 5000, caixa_total: 60000, caixa_meses: 60, margem: 30, vitorias_mes: 4, taxa_vitoria: 20 });
  assert.equal(r.lucro_mes, 16000);
  assert.equal(r.faturamento_mes, 53333.33);
  assert.equal(r.faturamento_ano, 639999.96);
  assert.equal(r.valor_minimo, 13333.33);
  assert.equal(r.disputas_mes, 20);
  assert.equal(r.disputas_semana, 5);
});

test("meta: entrada vazia, negativa ou zero não quebra a conta", () => {
  const r = M.calcularMeta({ pro_labore: "-5", margem: "0", vitorias_mes: "0", taxa_vitoria: "", caixa_meses: "0" });
  assert.equal(r.faturamento_mes, 0);
  assert.equal(r.vitorias_mes, 1);
  assert.equal(r.disputas_mes, 5); // taxa padrão 20%
  assert.ok(Number.isFinite(r.valor_minimo));
});

test("nota do nicho: 4 critérios do diagrama de convergência", () => {
  const bom = M.notaNicho({ participantes: 2.5, volume_anual: 3000000, marcas: 5, afinidade: 3 }, 1000000);
  assert.equal(bom.nota, 4);
  assert.match(bom.veredito, /Vale atuar/);
  const ruim = M.notaNicho({ participantes: 8, volume_anual: 2000000, marcas: 1, afinidade: 1 }, 1000000);
  assert.equal(ruim.nota, 0);
  // Sem meta, "mercado grande" não passa; sem dado, não passa nem quebra.
  const semDados = M.notaNicho({ afinidade: 2 }, 0);
  assert.equal(semDados.nota, 1);
  assert.match(semDados.criterios[0].texto, /Sem dado/);
});

test("resumo do nicho conta participantes por item e marcas distintas", () => {
  const r = M.resumoNicho([
    { numero_item: 1, historico_participacoes: [{ fornecedor_chave: "a", marca: "Chamex" }, { fornecedor_chave: "b", marca: "chamex " }, { fornecedor_chave: "c", marca_declarada: "Report" }] },
    { numero_item: 2, historico_participacoes: [{ fornecedor_chave: "a", marca: null }] },
    { numero_item: 3, historico_participacoes: [] },
  ]);
  assert.deepEqual(r, { itens: 2, participantes: 2, marcas: 2 });
  assert.deepEqual(M.resumoNicho([]), { itens: 0, participantes: null, marcas: null });
});

test("conversão do funil por etapa e meta do dia", () => {
  const etapas = [{ id: "e0", nome: "Tenho interesse", ordem: 0, status_sistema: "triagem" }, { id: "e1", nome: "Participando", ordem: 1, status_sistema: "preparacao" },
    { id: "e2", nome: "Ganhei", ordem: 2, status_sistema: "homologado" }, { id: "e3", nome: "Perdi", ordem: 3, status_sistema: "perdido" }];
  const agora = Date.parse("2026-11-20T15:00:00-03:00");
  const c = M.conversaoFunil(etapas, [
    { status: "triagem", etapa_id: "e0", criado_em: "2026-11-20T10:00:00-03:00" },
    { status: "triagem", etapa_id: "e0", criado_em: "2026-11-19T22:00:00-03:00" },
    { status: "preparacao", etapa_id: "e1" }, { status: "sessao", etapa_id: null },
    { status: "homologado", etapa_id: "e2" }, { status: "perdido", etapa_id: "e3" }, { status: "arquivado", etapa_id: "e0", criado_em: "2026-11-20T10:00:00-03:00" },
  ], agora);
  assert.deepEqual(c.linhas.map((l) => [l.nome, l.chegaram, l.taxa]), [["Tenho interesse", 6, null], ["Participando", 2, 33.3], ["Ganhei", 1, 50]]);
  assert.equal(c.entraramHoje, 1);
  assert.equal(c.perdidas, 1);
});
