const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./resumo-processo.js");

test("resumo de 1 página: ficha, preço, só prazos em aberto em ordem, itens cortados no limite", () => {
  const itens = Array.from({ length: R.MAX_ITENS + 3 }, (_, i) => ({ identificador: String(i + 1), descricao: `Item ${i + 1}`, quantidade: 2, valor_proposta: 10.5 }));
  const r = R.montarResumo({
    processo: { objeto: "Papel A4", orgao: "Prefeitura Fictícia", numero: "90001/2026", status: "preparacao", valor_estimado: 1500, preco_proposta: 1200,
      margem_percentual: 12.5, documentos_exigidos: ["CND Federal", ""], url_origem: "javascript:alert(1)", observacoes: "Frete por conta" },
    empresa: { razao_social: "ACME LTDA", cnpj: "11222333000181" },
    prazos: [{ titulo: "Sessão", vencimento: "2026-12-10T13:00:00Z" }, { titulo: "Esclarecimento", vencimento: "2026-12-01T13:00:00Z" },
      { titulo: "Feito", vencimento: "2026-11-01T13:00:00Z", concluido_em: "2026-11-01T14:00:00Z" }],
    itens, documentos: [{ tipo: "CND Federal", titulo: null, vencimento: "2027-01-10" }],
  });
  assert.equal(r.titulo, "Papel A4");
  assert.deepEqual(r.ficha[0], ["Empresa", "ACME LTDA · CNPJ 11.222.333/0001-81"]);
  assert.equal(r.ficha.find(([k]) => k === "Situação")[1], "Preparação");
  assert.match(r.preco.find(([k]) => k === "Valor estimado")[1], /1\.500,00/);
  assert.equal(r.preco.find(([k]) => k === "Margem")[1], "12,5%");
  assert.deepEqual(r.prazos.map(([, t]) => t), ["Esclarecimento", "Sessão"]);
  assert.equal(r.itens.length, R.MAX_ITENS);
  assert.equal(r.itensRestantes, 3);
  assert.deepEqual(r.exigidos, ["CND Federal"]);
  assert.match(r.documentos[0][2], /10\/01\/2027/);
  assert.equal(r.link, null, "só link https");
});

test("campos vazios viram travessão, não 'undefined'", () => {
  const r = R.montarResumo({ processo: { objeto: "X", status: "triagem" }, empresa: null });
  assert.ok(r.ficha.every(([, v]) => !/undefined|null|NaN/.test(v)));
  assert.ok(r.preco.every(([, v]) => v === "—"));
});

test("item precificado no sistema (só unitário) mostra o total da proposta, não travessão", () => {
  const r = R.montarResumo({ processo: { objeto: "X" }, empresa: null, itens: [{ identificador: "1", descricao: "Caneta", quantidade: 2.5, valor_unitario_proposta: 0.33 }] });
  assert.match(r.itens[0][3], /0,83/); // 2,5 × 0,33 = 0,825 → R$ 0,83
});
