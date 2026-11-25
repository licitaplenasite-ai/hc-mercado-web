const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const faepi = require("./faepi");
const cot = require("./faepi_cotacoes");
const { paraLinha } = require("./comum");

const FIX = path.join(__dirname, "..", "fixtures", "fontes");
const ler = (p) => fs.readFileSync(path.join(FIX, p), "utf8");

test("FAEPI editais: número do título em todos os formatos que o site usa", () => {
  assert.deepEqual(faepi.numeroDoTitulo("EDITAL Nº 2026-126 – SELEÇÃO"), { numero: "126", ano: 2026 });
  assert.deepEqual(faepi.numeroDoTitulo("EDITAL Nº 129-2026 – SELEÇÃO"), { numero: "129", ano: 2026 });
  assert.deepEqual(faepi.numeroDoTitulo("EDITAL Nº 2026/120 – SELEÇÃO"), { numero: "120", ano: 2026 });
  assert.deepEqual(faepi.numeroDoTitulo("EDITAL Nº 0137-2026 – SELEÇÃO"), { numero: "137", ano: 2026 });
  assert.equal(faepi.numeroDoTitulo("Aviso sem número"), null);
  assert.equal(faepi.objetoDoTitulo("EDITAL Nº 129-2026 – SELEÇÃO PÚBLICA DE FORNECEDORES / FAEPI PREÂMBULO"), "SELEÇÃO PÚBLICA DE FORNECEDORES");
});

const HOJE = "2026-11-25";
const AGORA = "2026-11-25T08:00:00";
const TRECHO = ler("faepi/edital-126-trecho.txt");
// Cliente falso: REST salva, a página do edital certa para cada link e o PDF (o texto vem de textoDoPdf).
const clienteFaepi = (editais = JSON.parse(ler("faepi/editais.json"))) => ({
  json: async () => editais,
  texto: async (url) => ler(url.includes("2026-120") ? "faepi/edital-129.html" : "faepi/edital-126.html"),
  bytes: async (url) => url,
});
const ctx = (cliente, extra = {}) => ({ cliente, textoDoPdf: async () => TRECHO, desdeIso: "2026-07-28", hojeIso: HOJE, agoraIso: AGORA, ...extra });

test("FAEPI editais: só pessoa jurídica entra; objeto e data da disputa vêm da página e do PDF", async () => {
  const itens = await faepi.listar(ctx(clienteFaepi()));
  assert.equal(itens.length, 2, "o edital de bolsista (pessoa física) fica fora");
  const e126 = itens.find((i) => i.idExterno === "SPF-126/2026");
  assert.equal(e126.aberto, true);
  assert.equal(e126.encerramento, "2026-11-27T17:30:00");
  assert.equal(itens.find((i) => i.idExterno === "SPF-120/2026").aberto, true, "sem termo de status não fecha");
  assert.equal(e126.publicacao, "2026-11-23T12:23:22");
  assert.equal(e126.objeto, "Seleção Publica de Fornecedores para aquisição de material permanente para projeto Fundo Reserva - CTHM IFAM (projeto apoiado: IFAM)");
  assert.equal(e126.anexos.length, 4);
  // Descrição genérica na página ("...contratação de pessoa jurídica"): fica o título.
  const e120 = itens.find((i) => i.idExterno === "SPF-120/2026");
  assert.equal(e120.objeto, "SELEÇÃO PÚBLICA DE FORNECEDORES (projeto apoiado: INPA)");
  const linha = paraLinha(faepi.FONTE, e126);
  assert.equal(linha.chave, "fonte:faepi:SPF-126/2026");
  assert.equal(linha.dado.cnpjOrgao, "04623300000188");
  assert.match(linha.dado.link, /^https:\/\/faepi\.org\/edital\//);
});

test("FAEPI editais: disputa já feita fecha; PDF que falha não derruba a fonte", async () => {
  const depois = await faepi.listar(ctx(clienteFaepi(), { agoraIso: "2026-11-28T09:00:00" }));
  assert.equal(depois.find((i) => i.idExterno === "SPF-126/2026").aberto, false);
  const semPdf = { ...clienteFaepi(), bytes: async () => { throw new Error("HTTP 404 em pdf"); } };
  const itens = await faepi.listar(ctx(semPdf));
  assert.equal(itens.find((i) => i.idExterno === "SPF-126/2026").encerramento, null);
  assert.equal(itens.find((i) => i.idExterno === "SPF-126/2026").aberto, true);
});

test("FAEPI editais: em andamento há mais de 30 dias fica fechado; número repetido fica só o post mais novo", async () => {
  const [e126] = JSON.parse(ler("faepi/editais.json"));
  assert.equal(faepi.itemDoEdital(e126, "2026-12-30").aberto, false);
  const repetido = { ...e126, id: 1, date: "2026-10-30T10:00:00", link: "https://faepi.org/edital/antigo/" };
  const itens = await faepi.listar(ctx(clienteFaepi([e126, repetido])));
  assert.equal(itens.length, 1);
  assert.equal(itens[0].publicacao, "2026-11-23T12:23:22");
});

test("FAEPI editais: página para depois da última (WordPress responde 400) sem falhar", async () => {
  const cheia = Array.from({ length: 50 }, (_, i) => ({ ...JSON.parse(ler("faepi/editais.json"))[0], id: i, title: { rendered: `EDITAL Nº 2026-${i + 1}` } }));
  let chamadas = 0;
  const cliente = { ...clienteFaepi(), json: async () => { chamadas += 1; if (chamadas > 1) throw new Error("HTTP 400 em x"); return cheia; } };
  const itens = await faepi.listar(ctx(cliente));
  assert.equal(itens.length, 50);
});

test("FAEPI editais: anexos com e sem data; leitura da data da disputa no PDF", async () => {
  const p126 = faepi.lerPagina(ler("faepi/edital-126.html"));
  assert.deepEqual([p126.anexos[0].publicadoEm, /Edital-no-2026-126/.test(p126.anexos[0].url)], ["2026-11-23T11:00:00", true]);
  const p129 = faepi.lerPagina(ler("faepi/edital-129.html"));
  assert.equal(p129.anexos.length, 4);
  assert.equal(p129.anexos[0].publicadoEm, null);
  assert.equal(faepi.dataDisputaDoTexto(TRECHO), "2026-11-27T17:30:00");
  assert.equal(faepi.dataDisputaDoTexto("sem data"), null);

  const cliente = { bytes: async (url) => url };
  const item = { idExterno: "SPF-126/2026", anexos: p126.anexos, encerramento: null };
  const escaneado = await faepi.lerPdfDoEdital(item, { cliente, textoDoPdf: async () => "" });
  assert.equal(escaneado.pdfSemTexto, true);
  assert.equal((await faepi.lerPdfDoEdital({ anexos: [] }, { cliente, textoDoPdf: async () => TRECHO })).encerramento, undefined);
});

test("FAEPI Conveniar: um período por dia nos 30 dias e um bloco com o resto, sem passar da janela", () => {
  const p = cot.periodos("2026-11-25", "2026-07-28");
  assert.equal(p.length, 31);
  assert.deepEqual(p[0], { de: "2026-11-25", ate: "2026-11-25" });
  assert.deepEqual(p[29], { de: "2026-10-27", ate: "2026-10-27" });
  assert.deepEqual(p[30], { de: "2026-07-28", ate: "2026-10-26" });
  assert.deepEqual(cot.periodos("2026-11-25", "2026-11-24"), [{ de: "2026-11-25", ate: "2026-11-25" }, { de: "2026-11-24", ate: "2026-11-24" }]);
});

test("FAEPI Conveniar: SF 7982026 vira SF-798/2026 (o 'SM/798/2026' do ConLicitação); CO e IL ficam fechados", () => {
  assert.deepEqual(cot.lerModalidade("Seleção de Fornecedores - SF 7982026"), { nome: "Seleção de Fornecedores", sigla: "SF", numero: "798", ano: 2026 });
  assert.equal(cot.lerModalidade("texto sem sigla"), null);
  const processos = cot.processosDaPagina(ler("faepi_cotacoes/em-andamento.html"));
  assert.equal(processos.length, 4);
  assert.ok(processos.every((p) => !/Coordenador/.test(JSON.stringify(p))), "nome de coordenador não é lido");
  const hoje = "2026-11-25";
  const recente = { de: "2026-11-21", ate: "2026-11-21" };
  const itens = processos.map((p) => cot.itemDoProcesso(p, recente, hoje));
  const sf = itens.find((i) => i.idExterno === "SF-798/2026");
  assert.equal(sf.aberto, true);
  assert.match(sf.objeto, /^Serviços de Manutenção de Equipamentos: /);
  assert.match(sf.objeto, /Projeto financiado por: /);
  assert.equal(sf.publicacao, "2026-11-21T00:00:00");
  assert.match(sf.linkOficial, /txtPeriodoProcessoCompra=21%2F11%2F2026\+a\+21%2F11%2F2026/);
  assert.equal(itens.find((i) => i.idExterno === "CO-33/2026").aberto, false);
  assert.equal(itens.find((i) => i.idExterno === "IL-17/2026").aberto, false);
  assert.equal(itens.find((i) => i.idExterno === "CD-603/2026").aberto, true);
  const velho = cot.itemDoProcesso(processos[0], { de: "2026-09-01", ate: "2026-10-01" }, hoje);
  assert.equal(velho.aberto, false, "processo com mais de 30 dias sai do painel");
});

test("FAEPI Conveniar: listar não repete processo e acusa página sem formulário", async () => {
  const html = ler("faepi_cotacoes/em-andamento.html").replace("<body>", '<body><div id="FormConsultaProcessoCompra"></div>');
  const itens = await cot.listar({ cliente: { texto: async () => html }, desdeIso: "2026-11-20", hojeIso: "2026-11-25" });
  assert.equal(itens.length, 4);
  assert.equal(itens.find((i) => i.idExterno === "SF-798/2026").publicacao, "2026-11-25T00:00:00", "fica com o período mais novo");
  await assert.rejects(cot.listar({ cliente: { texto: async () => "<html></html>" }, desdeIso: "2026-11-20", hojeIso: "2026-11-25" }), /estrutura mudou/);
});
