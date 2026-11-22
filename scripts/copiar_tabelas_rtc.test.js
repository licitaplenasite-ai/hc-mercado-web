const test = require("node:test");
const assert = require("node:assert/strict");
const { montarTabela } = require("./copiar_tabelas_rtc");

// Formato real da API oficial (GET classificacoes-tributarias/cbs-ibs e fundamentacoes-legais, V0073).
const linha = (codigo, red, extra = {}) => ({ codigo, descricao: `Classe ${codigo}`, nomenclatura: "NCM", percentualReducaoCbs: red, percentualReducaoIbsUf: red,
  percentualReducaoIbsMun: red, tipoAliquota: "Padrão", indicaApropriacaoCreditoAdquirenteCbs: true, ...extra });

test("junta a tabela oficial com a base legal curta e guarda a versão", () => {
  const classes = [linha("200003", 100.0), linha("200032", 60.0), ...Array.from({ length: 60 }, (_, i) => linha(String(300000 + i), 0))];
  const fund = [{ codigoClassificacaoTributaria: "200003", textoCurto: "Art. 125" }, { codigoClassificacaoTributaria: "200003", textoCurto: "duplicada" },
    { codigoClassificacaoTributaria: "200032", textoCurto: "Art. 133" }];
  const t = montarTabela(classes, fund, { versaoDb: "V0073", dataVersaoDb: "2026-11-09", descricaoVersaoDb: "Nova tabela" });
  assert.equal(t.versaoDb, "V0073"); assert.equal(t.linhas.length, 62);
  assert.deepEqual(t.linhas[0], { codigo: "200003", descricao: "Classe 200003", nomenclatura: "NCM", reducaoCbs: 100, reducaoIbsUf: 100, reducaoIbsMun: 100,
    tipoAliquota: "Padrão", creditoCbs: true, baseLegal: "Art. 125" });
  assert.equal(t.linhas[1].baseLegal, "Art. 133"); assert.equal(t.linhas[2].baseLegal, null);
});

test("recusa tabela incompleta (a API caiu no meio) em vez de apagar a boa", () => {
  assert.throws(() => montarTabela([linha("000001", 0)], [], {}), /incompleta/);
  assert.throws(() => montarTabela(null, [], {}), /incompleta/);
});
