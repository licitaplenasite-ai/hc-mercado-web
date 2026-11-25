const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const bll = require("./bll");
const { paraLinha } = require("./comum");

const FIX = path.join(__dirname, "..", "fixtures", "fontes", "bll");
const ler = (n) => fs.readFileSync(path.join(FIX, n), "utf8");
// Mesmo processo, mas com regulamento próprio (fora da Lei 14.133): é o caso que o adaptador deve trazer.
const processoRegulamentoProprio = () => ler("processo-tonantins.html").replace('value="14.133/2021"', 'value="Decreto 8.241/2014"');

test("lê as linhas da vitrine pública (promotor, número, UF, datas, link do processo)", () => {
  const linhas = bll.linhasDaVitrine(ler("vitrine.html"));
  assert.equal(linhas.length, 4);
  const ton = linhas.find((l) => l.promotor === "MUNICIPIO DE TONANTINS");
  assert.deepEqual([ton.numero, ton.uf, ton.municipio, ton.publicacao, ton.disputa], ["025/2026", "AM", "TONANTINS", "2026-11-24T13:54:00", "2026-12-04T10:00:00"]);
  assert.match(ton.link, /^https:\/\/bllcompras\.com\/Process\/ProcessView\?param1=/);
  assert.equal(bll.linhasDaVitrine("<html></html>"), null);
});

test("página do processo: objeto, regulamento e datas; sem nome de condutor/autoridade", () => {
  const p = bll.lerProcesso(ler("processo-tonantins.html"));
  assert.match(p.objeto, /^CONTRATAÇÃO DE EMPRESA ESPECIALIZADA NA PRESTAÇÃO DE SERVIÇOS DE REALIZAÇÃO DE EVENTOS/);
  assert.equal(p.regulamento, "14.133/2021");
  assert.deepEqual([p.fimPropostas, p.inicioDisputa, p.publicacao], ["2026-12-04T09:30:00", "2026-12-04T10:00:00", "2026-11-24T13:54:00"]);
});

test("listar: Lei 14.133 (já vai ao PNCP), outra UF e FAEPI ficam fechados; regulamento próprio do AM entra", async () => {
  const pedidos = [];
  const cliente = (processo) => ({ texto: async (url) => { pedidos.push(url); return url.includes("ProcessView") ? processo : ler("vitrine.html"); } });

  const lei14133 = await bll.listar({ cliente: cliente(ler("processo-tonantins.html")), desdeIso: "2026-07-28" });
  assert.equal(lei14133.length, 4, "toda a vitrine conta como lida");
  assert.equal(lei14133.filter((i) => i.aberto).length, 0);
  assert.equal(pedidos.filter((u) => u.includes("ProcessView")).length, 1, "só abre o processo do AM que não é da FAEPI");

  const itens = await bll.listar({ cliente: cliente(processoRegulamentoProprio()), desdeIso: "2026-07-28" });
  const abertos = itens.filter((i) => i.aberto);
  assert.equal(abertos.length, 1);
  const [ton] = abertos;
  assert.deepEqual([ton.idExterno, ton.numero, ton.ano, ton.encerramento], ["MUNICIPIO-DE-TONANTINS-025-2026", "025", 2026, "2026-12-04T10:00:00"]);
  const linha = paraLinha(bll.FONTE, ton);
  assert.equal(linha.dado.usuarioNome, "BLL Compras");
  assert.equal(linha.dado.orgao, "MUNICIPIO DE TONANTINS");
  assert.equal(linha.uf, "AM");
});

test("listar: sem tempo não devolve o processo como fechado (não apaga do banco)", async () => {
  const cliente = { texto: async (url) => (url.includes("ProcessView") ? processoRegulamentoProprio() : ler("vitrine.html")) };
  const itens = await bll.listar({ cliente, desdeIso: "2026-07-28", tempoRestanteMs: () => 1000 });
  assert.ok(!itens.some((i) => i.idExterno === "MUNICIPIO-DE-TONANTINS-025-2026"));
  await assert.rejects(bll.listar({ cliente: { texto: async () => "<html></html>" }, desdeIso: "2026-07-28" }), /estrutura mudou/);
});
