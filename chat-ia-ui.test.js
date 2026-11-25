// Plena (chat-ia-ui.js): regras puras da tela, sem navegador (o arquivo exporta antes de tocar no DOM).
const test = require("node:test");
const assert = require("node:assert/strict");
const Plena = require("./chat-ia-ui.js");

const AGORA = Date.parse("2026-11-25T12:00:00-03:00");
const valor = (campos, rotulo) => campos.find((c) => c.rotulo === rotulo).valor;

test("cartão: dossiê tem preferência; o que faltar vem do cartão da licitação; sem fonte = 'Não informado'", () => {
  const edital = Plena.editalDoRegistro({ numeroControlePNCP: "04312401000148-1-000123/2026", numeroCompra: "90012", anoCompra: "2026", objeto: "Papel A4", orgao: "Prefeitura de Manaus",
    municipio: "Manaus", uf: "am", modalidadeNome: "Pregão - Eletrônico", srp: true, encerramento: "2026-12-01T09:00:00-03:00", valorTotalEstimado: 15000 }, { portal: "Compras.gov.br" });
  const estrutura = { identificacao: { numero: "Pregão 90012/2026", modalidade: "Pregão eletrônico", objeto: "Aquisição de papel A4 para as escolas", portalRealizacao: "Não informado" },
    detalhes: { criterioJulgamento: "Menor preço por item", valorEstimado: "" }, prazos: { limiteEnvioPropostas: "01/12/2026 às 09h" }, orgao: { nome: "Secretaria Municipal de Educação" } };
  const c = Plena.montarCartao(estrutura, edital, AGORA);
  assert.equal(c.length, 10);
  assert.deepEqual(c.map((x) => x.rotulo), ["Órgão", "Número", "Modalidade", "Critério de julgamento", "Registro de preço", "Prazo da proposta", "Valor estimado", "Portal", "Objeto", "Situação"]);
  assert.equal(valor(c, "Órgão"), "Secretaria Municipal de Educação · Manaus/AM");
  assert.equal(valor(c, "Número"), "Pregão 90012/2026");
  assert.equal(valor(c, "Critério de julgamento"), "Menor preço por item");
  assert.equal(valor(c, "Registro de preço"), "Sim");
  assert.equal(valor(c, "Prazo da proposta"), "01/12/2026 às 09h");
  assert.match(valor(c, "Valor estimado"), /15\.000,00/, "valor vazio no dossiê usa o do cartão");
  assert.equal(valor(c, "Portal"), "Compras.gov.br", "'Não informado' do dossiê não esconde o dado do cartão");
  assert.equal(valor(c, "Objeto"), "Aquisição de papel A4 para as escolas");
  assert.equal(valor(c, "Situação"), "Recebendo propostas");
});

test("cartão sem dossiê nem dado: nada é deduzido; SRP só por texto explícito; prazo vencido muda a situação", () => {
  const vazio = Plena.montarCartao(null, Plena.editalDoRegistro({ objeto: "Cimento" }), AGORA);
  assert.equal(valor(vazio, "Critério de julgamento"), "Não informado");
  assert.equal(valor(vazio, "Registro de preço"), "Não informado");
  assert.equal(valor(vazio, "Situação"), "Não informado");
  const srp = Plena.montarCartao({ identificacao: { contratacao: "Sistema de Registro de Preços" } }, Plena.editalDoRegistro({ encerramento: "2026-11-01T10:00:00-03:00" }), AGORA);
  assert.equal(valor(srp, "Registro de preço"), "Sim");
  assert.equal(valor(srp, "Situação"), "Prazo de propostas encerrado");
  const pncp = Plena.montarCartao(null, Plena.editalDoRegistro({ situacaoCompraNome: "Suspensa", encerramento: "2026-12-01" }), AGORA);
  assert.equal(valor(pncp, "Situação"), "Suspensa", "situação do PNCP vence a conta pela data");
});

test("cartão com a ficha básica do dossiê (edital real da COSAMA): data ISO legível, portal pelo nome, número sem ano repetido", () => {
  const edital = Plena.editalDoRegistro({ numeroCompra: "030/2026", anoCompra: 2026, encerramento: "2026-12-03T09:45:00" }, { portal: "Licitações-e (BB)" });
  assert.equal(edital.numero, "030/2026");
  const c = Plena.montarCartao({ identificacao: { portalRealizacao: "https://licitacoes-e2.bb.com.br/aop-inter-estatico/visualizar-processo-publico/1103935" }, prazos: { limiteEnvioPropostas: "2026-12-03T09:45:00" } }, edital, AGORA);
  assert.equal(valor(c, "Portal"), "Licitações-e (BB)");
  assert.equal(valor(c, "Prazo da proposta"), "03/12/2026 09:45", "hora de Brasília sem converter pelo fuso da máquina");
  assert.equal(valor(Plena.montarCartao({ identificacao: { numero: "030/2026/2026" } }, edital, AGORA), "Número"), "030/2026");
  const semNome = Plena.montarCartao({ identificacao: { portalRealizacao: "https://www.gov.br/compras/x" } }, Plena.editalDoRegistro({}), AGORA);
  assert.equal(valor(semNome, "Portal"), "www.gov.br");
});

test("registro de processo do CRM vira edital: id do PNCP validado, valor numeric em texto, link só https", () => {
  const e = Plena.editalDoRegistro({ objeto: "Material gráfico", numero: "77/2026", orgao: "UFAM", modalidade: "Pregão", sistema: "Compras.gov.br", data_sessao: "2026-12-10T09:00:00Z", valor_estimado: "9800.50", url_origem: "javascript:alert(1)" },
    { numeroControlePNCP: "04378626000197-1-000045/2026" });
  assert.equal(e.numeroControlePNCP, "04378626000197-1-000045/2026");
  assert.equal(e.valor, 9800.5);
  assert.equal(e.portal, "Compras.gov.br");
  assert.equal(e.link, "");
  assert.equal(Plena.editalDoRegistro({ numeroControlePNCP: "../../etc" }).numeroControlePNCP, null);
  assert.equal(Plena.editalDoRegistro(null), null);
});

test("chips: 8 perguntas prontas; atalhos padrão até a pessoa salvar as dela", () => {
  const padrao = Plena.chipsDoEdital([]);
  assert.deepEqual(padrao.sugeridas.map((s) => s.rotulo), ["Prazo de impugnação", "Habilitação técnica", "Entrega", "Penalidades", "Disputa de preço", "Garantia", "Pagamento", "Amostra"]);
  assert.equal(padrao.fixas.length, 5);
  assert.ok(padrao.fixas.every((f) => !f.salva));
  const proprias = Plena.chipsDoEdital([{ id: "a", texto: " Exige visita técnica? " }, { id: "b", texto: "" }, null]);
  assert.deepEqual(proprias.fixas, [{ id: "a", rotulo: "Exige visita técnica?", pergunta: "Exige visita técnica?", salva: true }]);
});

test("citação: rótulo com arquivo, página e cláusula; link só se for oficial (gov.br)", () => {
  const c = Plena.citacao({ trecho: "O prazo de entrega é de 10 dias.", documento: "Edital (#1)", pagina: "12", clausula: "8.1", url: "https://pncp.gov.br/pncp-api/v1/orgaos/1/compras/2026/1/arquivos/1" });
  assert.equal(c.rotulo, "Edital (#1) · página 12 · cláusula 8.1");
  assert.ok(c.url.startsWith("https://pncp.gov.br/"));
  assert.equal(Plena.citacao({ trecho: "x".repeat(20), documento: "Anexo", url: "https://golpe.example/x" }).url, null);
  assert.equal(Plena.citacao({ trecho: "x".repeat(20), url: "https://pncp.gov.br.golpe.example/x" }).url, null);
  assert.equal(Plena.citacao({ trecho: "  " }), null);
});

test("erros viram frase para leigo, nunca código ou nome de variável", () => {
  assert.match(Plena.mensagemDeErro("tempo"), /demorou demais/);
  assert.equal(Plena.mensagemDeErro("cancelado"), "Pergunta cancelada.");
  assert.match(Plena.mensagemDeErro(409, "Os documentos deste edital ainda não estão disponíveis", true), /sendo preparados/);
  assert.match(Plena.mensagemDeErro(503, "Nenhum provedor de IA configurado (GROQ_API_KEY...)"), /indisponível agora/);
  assert.doesNotMatch(Plena.mensagemDeErro(500, "GEMINI_API_KEY"), /API_KEY/);
  assert.match(Plena.mensagemDeErro(429, "Limite diário atingido."), /Limite diário/);
});

test("arquivos do edital: situação só pelo que a leitura informou", () => {
  const arquivos = [{ titulo: "Edital", sequencialDocumento: 1 }, { titulo: "Termo de referência", sequencialDocumento: 2 }, { titulo: "Planilha", sequencialDocumento: 3 }];
  assert.ok(Plena.situacaoArquivos(arquivos, null, false).every((a) => a.situacao === "Na fila de leitura"));
  const s = Plena.situacaoArquivos(arquivos, { documentosLidos: ["Edital (#1)"], documentosNaoLidos: ["Termo de referência (#2): limite de documentos"] }, true);
  assert.deepEqual(s.map((a) => a.situacao), ["Lido", "Não lido: limite de documentos", "Fora da leitura"]);
});

test("contexto da tela: nome da tela, título sem a marca e seção do painel", () => {
  assert.deepEqual(Plena.contextoTela({ pathname: "/painel.html", hash: "#boletim" }, "Painel — LicitaPlena"), { tela: "painel", titulo: "Painel", secao: "boletim" });
  assert.equal(Plena.contextoTela({ pathname: "/" }, "").tela, "painel");
});

test("só uma tela da casca consulta a leitura do edital: marca de outra Plena vale pela janela, a própria sempre vale", () => {
  assert.equal(Plena.marcaLivre(null, "a", 1000, 30000), true);
  assert.equal(Plena.marcaLivre({ dono: "a", em: 999 }, "a", 1000, 30000), true);
  assert.equal(Plena.marcaLivre({ dono: "b", em: 1000 }, "a", 20000, 30000), false, "outra tela consultou há 19 s");
  assert.equal(Plena.marcaLivre({ dono: "b", em: 1000 }, "a", 31000, 30000), true, "a outra parou: esta assume");
  assert.equal(Plena.marcaLivre({ dono: "b", em: "lixo" }, "a", 31000, 30000), true);
});
