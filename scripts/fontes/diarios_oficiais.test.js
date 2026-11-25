// Testes do DOU (INLABS), do Querido Diário e do robô scripts/coletar_diarios_oficiais.js, sem rede:
// fixtures em scripts/fixtures/fontes/dou/ e scripts/fixtures/fontes/querido_diario/.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");

const T = require("./avisos_texto");
const dou = require("./dou");
const qd = require("./querido_diario");
const { decidir } = require("../coletar_diarios_oficiais");

const FIX = path.join(__dirname, "..", "fixtures", "fontes");
const xmlDou = fs.readFileSync(path.join(FIX, "dou", "inlabs_do3.xml"), "utf8");
const cidades = JSON.parse(fs.readFileSync(path.join(FIX, "querido_diario", "cidades.json"), "utf8"));
const gazettes = JSON.parse(fs.readFileSync(path.join(FIX, "querido_diario", "gazettes.json"), "utf8"));
const HOJE = "2026-11-25";

test("aviso padrão do Compras.gov: modalidade, número, UASG, objeto e abertura", () => {
  const [a] = T.avisosDoTexto("PREGÃO ELETRÔNICO Nº 90031/2026 - UASG 160016 Nº Processo: 64106.012345/2026. Objeto: Aquisição de gêneros alimentícios perecíveis. Total de Itens Licitados: 42. Entrega das Propostas: a partir de 25/11/2026 às 08h00. Abertura das Propostas: 09/12/2026 às 09h00 no site www.gov.br/compras.", "2026-11-25");
  assert.equal(a.modalidade, "Pregão - Eletrônico");
  assert.equal(a.numero, "90031");
  assert.equal(a.ano, "2026");
  assert.equal(a.uasg, "160016");
  assert.equal(a.objeto, "Aquisição de gêneros alimentícios perecíveis");
  assert.equal(a.encerramento, "2026-12-09T09:00:00");
});

test("hora antes da data, data por extenso e data anterior à publicação", () => {
  assert.equal(T.aberturaNoTexto("Sessão pública/lances: Às 08h30min do dia 08/12/2026", "2026-11-24"), "2026-12-08T08:30:00");
  assert.equal(T.aberturaNoTexto("DATA DO PREGÃO: 09 de dezembro de 2026, às 9h", "2026-11-24"), "2026-12-09T09:00:00");
  assert.equal(T.aberturaNoTexto("DATA DO PREGÃO: 05 de janeiro, às 10:00", "2026-11-24"), "2027-01-05T10:00:00");
  // Erro de digitação comum (sessão antes da publicação) não vira data.
  assert.equal(T.aberturaNoTexto("Início da sessão eletrônica dia 07/11/2026 às 08h00", "2026-11-25"), null);
  assert.equal(T.aberturaNoTexto("Abertura: 31/02/2027", "2026-11-25"), null);
});

test("objeto termina no rótulo seguinte, não em palavra do próprio objeto", () => {
  const [a] = T.avisosDoTexto("CONCORRÊNCIA Nº 5/2026 Objeto: contratação de empresa para realização de eventos culturais. Realização: dia 10/12/2026, às 9h.", "2026-11-25");
  assert.equal(a.objeto, "contratação de empresa para realização de eventos culturais");
  assert.equal(a.encerramento, "2026-12-10T09:00:00");
});

test("classificação do ato pelo título", () => {
  assert.equal(T.classificar("AVISO DE LICITAÇÃO Aviso de Licitação-Pregão", ""), "oportunidade");
  assert.equal(T.classificar("AVISO DE DISPENSA DE LICITAÇÃO ELETRÔNICA", ""), "oportunidade");
  assert.equal(T.classificar("RESULTADO DE JULGAMENTO", ""), "encerramento");
  assert.equal(T.classificar("AVISO DE HOMOLOGAÇÃO E ADJUDICAÇÃO", ""), "encerramento");
  assert.equal(T.classificar("EXTRATO DE CONTRATO", ""), "ignorar");
  assert.equal(T.classificar("EXTRATO DE INEXIGIBILIDADE DE LICITAÇÃO", ""), "ignorar");
  assert.equal(T.classificar("AVISO DE SUSPENSÃO", ""), "ignorar");
  assert.equal(T.classificar("EDITAL DE NOTIFICAÇÃO", ""), "ignorar");
  assert.equal(T.classificar("AVISO", "PREGÃO ELETRÔNICO Nº 3/2026 objeto..."), "oportunidade");
  assert.equal(T.classificar("AVISO", "Comunicamos aos acionistas..."), "ignorar");
});

test("chamamento de fomento cultural ou de OSC não vira oportunidade (DOU e Querido Diário)", () => {
  assert.equal(T.classificar("AVISO DE CHAMAMENTO PÚBLICO", "seleção de organizações da sociedade civil para termo de colaboração (Lei 13.019)"), "ignorar");
  assert.equal(T.classificar("EDITAL", "Chamamento Público nº 2/2026 - Política Nacional Aldir Blanc, premiação"), "ignorar");
  assert.equal(T.classificar("AVISO DE CHAMAMENTO PÚBLICO", "credenciamento de clínicas para exames"), "oportunidade");
  assert.equal(T.classificar("AVISO DE LICITAÇÃO", "Pregão eletrônico 5/2026, aquisição de troféus para premiação"), "oportunidade");
  const diario = { state_code: "TO", territory_name: "Palmas", date: "2026-11-20", url: "https://diario",
    excerpts: ["AVISO DE CHAMAMENTO PÚBLICO Nº 3/2026 PREFEITURA MUNICIPAL DE PALMAS Objeto: seleção de organização da sociedade civil sem fins lucrativos para termo de fomento. Abertura: 10/12/2026"] };
  const [item] = qd.itensDoDiario(diario, qd.cidadesPorUf(cidades.cities), HOJE);
  assert.equal(item.aberto, false);
});

test("diário municipal: vale a última marca antes do objeto", () => {
  assert.equal(T.tipoDoTrecho("AVISO DE LICITAÇÃO PREGÃO Nº 1/2026"), "oportunidade");
  assert.equal(T.tipoDoTrecho("AVISO DE LICITAÇÃO ... EXTRATO DE ADJUDICAÇÃO E HOMOLOGAÇÃO PREGÃO Nº 2/2026"), "encerramento");
  assert.equal(T.tipoDoTrecho("EXTRATO DO CONTRATO Nº 10/2026"), "ignorar");
});

test("chave do processo bate com o número do PNCP com prefixo e com a UASG", () => {
  const diario = T.chavesDoProcesso({ uf: "PR", municipio: "Mamborê", modalidade: "Pregão - Eletrônico", numero: "127", ano: "2026" });
  const pncp = T.chavesDoProcesso({ uf: "PR", municipio: "MAMBORÊ", modalidade: "Pregão - Eletrônico", numero: "PCE 127", ano: 2026, uasg: "05001" });
  assert.ok(diario.some((k) => pncp.includes(k)));
  assert.deepEqual(T.chavesDoProcesso({ uasg: "160016", modalidade: "Pregão", numero: "90031", ano: "2026" }), ["uasg:160016|pregao|90031|2026"]);
  assert.deepEqual(T.chavesDoProcesso({ uf: "AM", municipio: "Manaus", modalidade: "Pregão", numero: null, ano: "2026" }), []);
});

test("DOU: lê o XML do INLABS e separa oportunidade, resultado e extrato", () => {
  const artigos = dou.artigosDoXml(xmlDou);
  assert.equal(artigos.length, 4);
  assert.equal(artigos[0].link, "http://pesquisa.in.gov.br/imprensa/jsp/visualiza/index.jsp?data=25/11/2026&jornal=530&pagina=10");
  assert.equal(artigos[0].data, "2026-11-25");

  const [federal] = dou.itensDoArtigo(artigos[0], HOJE);
  assert.equal(federal.tipo, "oportunidade");
  assert.equal(federal.aberto, true);
  assert.equal(federal.uasg, "160016");
  assert.equal(federal.orgao.uf, "AM");
  assert.equal(federal.orgao.municipio, "Manaus");
  assert.match(federal.orgao.nome, /12ª Região Militar/);
  assert.equal(federal.encerramento, "2026-12-09T09:00:00");

  const [prefeitura] = dou.itensDoArtigo(artigos[1], HOJE);
  assert.deepEqual(prefeitura.orgao, { nome: "Prefeitura Municipal de Sucupira", uf: "TO", municipio: "Sucupira" });
  assert.equal(prefeitura.numero, "13");
  assert.equal(prefeitura.encerramento, "2026-12-10T08:00:00");

  assert.equal(dou.itensDoArtigo(artigos[2], HOJE)[0].tipo, "encerramento");
  assert.deepEqual(dou.itensDoArtigo(artigos[3], HOJE), []);
});

test("DOU: listar lê zip local e, sem conta do INLABS, avisa o que cadastrar", async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "dou-"));
  const zip = new AdmZip();
  zip.addFile("2026-11-25-DO3/materia1.xml", Buffer.from(xmlDou, "utf8"));
  const arquivo = path.join(pasta, "2026-11-25-DO3.zip");
  zip.writeZip(arquivo);
  const relatorio = {};
  const itens = await dou.listar({ arquivoLocal: arquivo, hojeIso: HOJE, relatorio });
  assert.equal(relatorio.atosLidos, 4);
  assert.equal(itens.filter((i) => i.tipo === "oportunidade").length, 2);

  const antes = { e: process.env.INLABS_EMAIL, s: process.env.INLABS_SENHA };
  delete process.env.INLABS_EMAIL;
  delete process.env.INLABS_SENHA;
  await assert.rejects(dou.listar({ dias: [HOJE], hojeIso: HOJE }), (e) => e.semCadastro === true && /INLABS_EMAIL/.test(e.message));
  if (antes.e !== undefined) process.env.INLABS_EMAIL = antes.e;
  if (antes.s !== undefined) process.env.INLABS_SENHA = antes.s;
});

test("DOU: login recusado vira erro claro; dia sem edição (404) não é erro", async () => {
  process.env.INLABS_EMAIL = "teste@exemplo.com";
  process.env.INLABS_SENHA = "x";
  try {
    const semCookie = async () => ({ status: 200, headers: { getSetCookie: () => [] } });
    await assert.rejects(dou.listar({ dias: [HOJE], hojeIso: HOJE, fetchImpl: semCookie }), /recusou o login/);
    const pedidos = [];
    const comCookie = async (url) => {
      pedidos.push(url);
      if (url.endsWith("logar.php")) return { status: 302, headers: { getSetCookie: () => ["inlabs_session_cookie=abc; path=/"] } };
      return { status: 404, ok: false };
    };
    const relatorio = {};
    assert.deepEqual(await dou.listar({ dias: ["2026-11-22"], hojeIso: HOJE, fetchImpl: comCookie, relatorio }), []);
    assert.equal(relatorio.atosLidos, 0);
    assert.ok(pedidos.some((u) => u.includes("dl=2026-11-22-DO3.zip")) && pedidos.some((u) => u.includes("dl=2026-11-22-DO3E.zip")));
  } finally {
    delete process.env.INLABS_EMAIL;
    delete process.env.INLABS_SENHA;
  }
});

test("Querido Diário: aviso de outro município no diário da associação fica com o município do texto", () => {
  const porUf = qd.cidadesPorUf(cidades.cities);
  const [arapiraca] = qd.itensDoDiario(gazettes.gazettes[2], porUf, HOJE);
  assert.equal(arapiraca.orgao.municipio, "Arapiraca");
  assert.equal(arapiraca.orgao.nome, "Prefeitura Municipal de Arapiraca");
  assert.equal(arapiraca.uasg, "982705");
  assert.equal(arapiraca.numero, "90031");
  assert.equal(arapiraca.encerramento, "2026-12-09T09:00:00");
  assert.equal(arapiraca.aberto, true);
  // A repetição no diário de outro membro gera o mesmo idExterno (vira uma linha só).
  assert.equal(qd.itensDoDiario(gazettes.gazettes[3], porUf, HOJE)[0].idExterno, arapiraca.idExterno);

  const mambore = qd.itensDoDiario(gazettes.gazettes[0], porUf, HOJE).find((i) => i.numero === "127");
  assert.equal(mambore.orgao.municipio, "Mamborê");
  assert.equal(mambore.encerramento, "2026-12-08T08:30:00");
  assert.match(mambore.objeto, /^CONTRATAÇÃO DE EMPRESA ESPECIALIZADA/);

  const homologacao = qd.itensDoDiario(gazettes.gazettes[1], porUf, HOJE).find((i) => i.numero === "90037");
  assert.equal(homologacao.tipo, "encerramento");
  assert.equal(homologacao.orgao.municipio, "Pilar");
});

test("Querido Diário: listar busca o Norte primeiro e não relê o mesmo diário", async () => {
  const pedidos = [];
  const cliente = {
    async json(url) {
      pedidos.push(url);
      if (url.includes("/cities")) return cidades;
      return { total_gazettes: gazettes.gazettes.length, gazettes: gazettes.gazettes };
    },
  };
  const relatorio = {};
  const itens = await qd.listar({ cliente, desdeIso: "2026-11-18", hojeIso: HOJE, relatorio });
  assert.equal(pedidos.length, 3); // cidades + Norte + país
  assert.match(pedidos[1], /territory_ids=1501402/);
  assert.doesNotMatch(pedidos[1], /1300029/); // nível 0 (sem raspador) fica fora
  assert.doesNotMatch(pedidos[1], /1302603/); // AM tem robô próprio de diário
  assert.doesNotMatch(pedidos[2], /territory_ids/);
  assert.equal(relatorio.atosLidos, 4);
  assert.ok(itens.length >= 4);
  await assert.rejects(qd.listar({ cliente: { json: async () => ({ cities: [] }) }, desdeIso: "x", hojeIso: HOJE }), /sem municípios/);
});

test("Querido Diário pula o AM e o DOU não repete aviso já gravado pelos diários do AM", () => {
  const porUf = qd.cidadesPorUf(cidades.cities);
  assert.deepEqual(qd.itensDoDiario({ ...gazettes.gazettes[0], state_code: "AM", territory_name: "Manaus" }, porUf, HOJE), []);
  const item = {
    idExterno: "1", tipo: "oportunidade", aberto: true, objeto: "Aquisição de ração para peixes da piscicultura municipal",
    orgao: { nome: "Prefeitura Municipal de Benjamin Constant", uf: "AM", municipio: "Benjamin Constant" },
    modalidade: "Pregão - Presencial", numero: "32", ano: "2026", publicacao: HOJE, encerramento: "2026-12-10T09:00:00",
  };
  const aam = [{ chave: "fonte:diario-aam:9", municipio: "Benjamin Constant", orgao: "Prefeitura Municipal de Benjamin Constant", esfera: "M", modalidade: "Pregão - Presencial", numero: "032", ano: "2026", objeto: "Ração para peixes", abertura: "2026-12-10T09:00:00" }];
  const fontes = [{ fonte: dou.FONTE, itens: [item] }];
  assert.equal(decidir(fontes, new Map(), new Map(), aam).contagem.dou.repetidos, 1);
  // Sem número: objeto parecido e abertura a até 2 dias também contam como o mesmo aviso.
  const semNumero = [{ ...aam[0], numero: null, objeto: "Aquisição de ração para peixes da piscicultura", abertura: "2026-12-11T09:00:00" }];
  assert.equal(decidir(fontes, new Map(), new Map(), semNumero).contagem.dou.repetidos, 1);
  assert.equal(decidir(fontes, new Map(), new Map(), []).contagem.dou.gravar, 1);
});

test("robô: já no PNCP não entra, DOU ganha do diário municipal, resultado encerra e PNCP tardio registra quem viu antes", () => {
  const artigos = dou.artigosDoXml(xmlDou);
  const itensDou = artigos.flatMap((a) => dou.itensDoArtigo(a, HOJE));
  const porUf = qd.cidadesPorUf(cidades.cities);
  const itensQd = gazettes.gazettes.flatMap((g) => qd.itensDoDiario(g, porUf, HOJE));
  // O mesmo pregão de Sucupira chega pelo Querido Diário: deve contar como repetido.
  const sucupiraQd = { ...itensDou.find((i) => i.orgao.municipio === "Sucupira"), idExterno: "x1" };
  const pncp = new Map([["mun:PR|mambore|pregao|127|2026", { controle: "75368928000122-1-000319/2026", publicacao: "2026-11-24" }]]);
  const anteriores = new Map([
    ["fonte:qd:antigo", { chaves: ["uasg:982705|pregao|90031|2026"], vistoNoDiarioEm: "2026-11-20", fonteId: "qd" }],
    ["fonte:dou:velho", { chaves: ["uasg:160017|pregao|90020|2026"], fonteId: "dou" }],
    ["fonte:qd:vira-pncp", { chaves: ["mun:PR|mambore|pregao|127|2026"], vistoNoDiarioEm: "2026-11-22", fonteId: "qd" }],
  ]);
  const r = decidir([{ fonte: dou.FONTE, itens: itensDou }, { fonte: qd.FONTE, itens: [...itensQd, sucupiraQd] }], pncp, anteriores);

  const chaves = r.linhas.map((l) => l.chave);
  assert.ok(chaves.includes("fonte:dou:45001") && chaves.includes("fonte:dou:45002"));
  assert.equal(r.contagem.qd.jaNoPncp, 1); // Mamborê 127 já está no PNCP
  assert.ok(r.contagem.qd.repetidos >= 2); // Arapiraca (já gravado por outra chave) e Sucupira (veio pelo DOU)
  assert.equal(r.contagem.dou.encerramentos, 1);
  const linhaDou = r.linhas.find((l) => l.chave === "fonte:dou:45001");
  assert.equal(linhaDou.dado.fonte, "Diário Oficial da União");
  assert.equal(linhaDou.dado.codigoUnidade, "160016");
  assert.equal(linhaDou.encerramento, "2026-12-09");
  assert.equal(linhaDou.numero_controle_pncp, null);
  // Resultado de 90020/UASG 160017 apaga a linha antiga; a de Mamborê sai porque chegou ao PNCP.
  assert.deepEqual(r.apagar.sort(), ["fonte:dou:velho", "fonte:qd:vira-pncp"]);
  assert.deepEqual(r.vistoPrimeiro, [{ chave: "fonte:qd:vira-pncp", fonte: "qd", vistoNoDiarioEm: "2026-11-22", numeroControlePNCP: "75368928000122-1-000319/2026", publicacaoPncp: "2026-11-24" }]);
});
