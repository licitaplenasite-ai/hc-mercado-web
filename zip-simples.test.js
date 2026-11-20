/* global Buffer, TextEncoder -- Node */
const test = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");
const Z = require("./zip-simples.js");

test("zip abre em leitor comum, com pastas, nomes com acento e conteúdo intacto", () => {
  const pdf = Buffer.from("%PDF-1.4 conteúdo fictício");
  const zip = Z.montarZip([
    { nome: "Fiscal/CND Federal.pdf", bytes: new Uint8Array(pdf) },
    { nome: "Fiscal/CND Federal.pdf", bytes: new Uint8Array([1, 2, 3]) },
    { nome: "Jurídica/Contrato social.pdf", bytes: new Uint8Array([4]) },
  ], new Date(2026, 10, 20, 10, 30, 0));
  const lido = new AdmZip(Buffer.from(zip));
  const nomes = lido.getEntries().map((e) => e.entryName);
  assert.deepEqual(nomes, ["Fiscal/CND Federal.pdf", "Fiscal/CND Federal (2).pdf", "Jurídica/Contrato social.pdf"]);
  assert.deepEqual(lido.readFile("Fiscal/CND Federal.pdf"), pdf);
  assert.deepEqual([...lido.readFile("Fiscal/CND Federal (2).pdf")], [1, 2, 3]);
});

test("caminho seguro: sem subir de pasta, sem barra inicial nem caractere proibido", () => {
  assert.equal(Z.caminhoSeguro("../../etc/passwd"), "etc/passwd");
  assert.equal(Z.caminhoSeguro("/a\\b:c*.pdf"), "a-b-c-.pdf");
  assert.equal(Z.caminhoSeguro(""), "arquivo");
});

test("limites: vazio e arquivos demais são recusados", () => {
  assert.throws(() => Z.montarZip([]), /Nenhum arquivo/);
  assert.throws(() => Z.montarZip(Array.from({ length: Z.MAX_ARQUIVOS + 1 }, (_, i) => ({ nome: `${i}.pdf`, bytes: new Uint8Array(1) }))), /No máximo/);
  assert.equal(Z.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
