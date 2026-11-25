const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sebrae = require("./sebrae");
const { paraLinha } = require("./comum");

const FIX = path.join(__dirname, "..", "fixtures", "fontes", "sebrae");
const ler = (n) => fs.readFileSync(path.join(FIX, n), "utf8");
const filtro = () => JSON.parse(ler("filtro.json"));

test("unidade do SEBRAE vira UF (inclusive nomes compostos e o Nacional)", () => {
  assert.equal(sebrae.ufDaUnidade("SEBRAE AMAZONAS"), "AM");
  assert.equal(sebrae.ufDaUnidade("SEBRAE MATO GROSSO DO SUL"), "MS");
  assert.equal(sebrae.ufDaUnidade("SEBRAE MATO GROSSO"), "MT");
  assert.equal(sebrae.ufDaUnidade("SEBRAE SANTA CATARINA "), "SC");
  assert.equal(sebrae.ufDaUnidade("SEBRAE MARANHÃO"), "MA");
  assert.equal(sebrae.ufDaUnidade("SEBRAE NACIONAL"), "DF");
  assert.equal(sebrae.ufDaUnidade("OUTRA COISA"), null);
});

test("formulário: token anti-CSRF da página e situação Em Andamento", () => {
  const campos = sebrae.camposDoFormulario(ler("licitacoes.html"));
  assert.equal(campos.__RequestVerificationToken, "TOKEN_DE_TESTE");
  assert.equal(campos.StatusId, "5");
  assert.equal(sebrae.camposDoFormulario("<form id=\"formFilterLicitacao\"></form>"), null);
});

test("local da disputa: portal vira link; sala ou reunião online não", () => {
  assert.equal(sebrae.urlDoLocal("www.licitanet.com.br"), "https://www.licitanet.com.br");
  assert.equal(sebrae.urlDoLocal("Sala de Reunião CCL e via teams, pelo link: https://teams.microsoft.com/meet/1"), null);
  assert.equal(sebrae.urlDoLocal("Sede do Sebrae"), null);
  assert.deepEqual(sebrae.numeroDaLicitacao("PERP/27-SEBRAE-AM-2026"), { numero: "027", ano: 2026 });
});

test("aberta = em andamento com abertura futura; credenciamento fica aberto; sem abertura também", () => {
  const agora = "2026-11-25T08:00:00";
  const por = (n) => sebrae.itemDaLicitacao(filtro().aData.find((l) => l.Numero === n), agora);
  const pe = por("PE/037-SEBRAE-AM-2026");
  assert.deepEqual([pe.aberto, pe.encerramento, pe.publicacao, pe.numero, pe.ano], [true, "2026-12-02T10:00:00", "2026-11-24T00:00:00", "037", 2026]);
  assert.equal(pe.linkOficial, "https://www.licitanet.com.br");
  assert.equal(pe.linkEdital, "https://www.scf3.sebrae.com.br/PortalCf/Licitacoes/Detalhe/15782");
  assert.equal(por("CONC/001-SEBRAE-AM-2026").aberto, false, "abertura já passou: está em julgamento");
  assert.equal(por("CRED/003-SEBRAE-AM-2026").aberto, true);
  assert.equal(por("PERP/018-SEBRAE-AM-2026").aberto, true, "sem data de abertura informada");
  assert.equal(por("PERP/018-SEBRAE-AM-2026").srp, true);
});

test("listar: token da página vai no POST; respeita a janela; resposta sem lista é falha", async () => {
  const posts = [];
  const cliente = { texto: async () => ler("licitacoes.html"), postForm: async (url, campos) => { posts.push({ url, campos }); return filtro(); } };
  const itens = await sebrae.listar({ cliente, desdeIso: "2026-10-01" });
  assert.equal(posts[0].url, "https://www.scf3.sebrae.com.br/PortalCf/Licitacoes/Filter");
  assert.equal(posts[0].campos.__RequestVerificationToken, "TOKEN_DE_TESTE");
  assert.ok(itens.every((i) => i.publicacao >= "2026-10-01"));
  assert.ok(itens.some((i) => i.orgao.uf === "MA"), "outras UFs também entram");
  const linha = paraLinha(sebrae.FONTE, itens.find((i) => i.idExterno === "PE/037-SEBRAE-AM-2026"));
  assert.deepEqual([linha.chave, linha.uf, linha.dado.usuarioNome], ["fonte:sebrae:PE/037-SEBRAE-AM-2026", "AM", "Canal do Fornecedor SEBRAE"]);

  const ruim = { texto: cliente.texto, postForm: async () => ({ success: false, aErro: "erro" }) };
  await assert.rejects(sebrae.listar({ cliente: ruim, desdeIso: "2026-10-01" }), /SEBRAE: filtro sem lista \(erro\)/);
});
