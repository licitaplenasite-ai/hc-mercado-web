const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./pix-copia-cola.js");

test("CRC16 confere com o exemplo do Manual de Padrões do Pix (Banco Central)", () => {
  const exemplo = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
  assert.equal(P.crc16(exemplo), "1D3D");
});

test("monta o copia e cola com valor, nome e cidade sem acento, e o CRC no fim", () => {
  const c = P.montarPixCopiaCola({ chave: "fulano@exemplo.com", nome: "José da Conceição", cidade: "Manaus", valorCentavos: 134500 });
  assert.ok(c.startsWith("000201"));
  assert.ok(c.includes("0014br.gov.bcb.pix0118fulano@exemplo.com"));
  assert.ok(c.includes("54071345.00"));
  assert.ok(c.includes("5917JOSE DA CONCEICAO"));
  assert.ok(c.includes("6006MANAUS"));
  assert.equal(c.slice(-4), P.crc16(c.slice(0, -4)));
});

test("nome e cidade longos são cortados no limite do padrão (25 e 15)", () => {
  const c = P.montarPixCopiaCola({ chave: "+5592999999999", nome: "A".repeat(40), cidade: "São Gabriel da Cachoeira", valorCentavos: 12700 });
  assert.ok(c.includes("5925" + "A".repeat(25)));
  assert.ok(c.includes("6014SAO GABRIEL DA"));
});

test("sem chave, nome, cidade ou valor válido não monta nada (a tela mostra Fale com a equipe)", () => {
  const base = { chave: "x@y.com", nome: "Nome", cidade: "Manaus", valorCentavos: 100 };
  for (const falta of [{ chave: "" }, { nome: "" }, { cidade: "  " }, { valorCentavos: 0 }, { valorCentavos: 12.5 }, { chave: "a".repeat(78) }]) {
    assert.equal(P.montarPixCopiaCola({ ...base, ...falta }), "");
  }
});
