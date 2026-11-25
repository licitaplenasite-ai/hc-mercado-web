// Diários oficiais do AM (AAM, DOM Manaus, DOE-AM): fixtures salvas das edições de 18 a 25/11/2026
// em scripts/fixtures/fontes/diarios_am/. Nenhum teste usa rede.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ext = require("./diario_extracao");
const aam = require("./diario_aam");
const doe = require("./doe_am");
const dom = require("./dom_manaus");
const { reconciliar, montarLinha, extrair } = require("../coletar_diarios_am");

const FIX = path.join(__dirname, "..", "fixtures", "fontes", "diarios_am");
const ler = (nome) => fs.readFileSync(path.join(FIX, nome), "utf8");
const materiaAam = (codigo) => ext.textoDoHtml(ler(`aam-materia-${codigo}.html`));

test("AAM: busca vira cartões com código, entidade, data e edição; total para paginar", () => {
  const { cartoes, total } = aam.lerBusca(ler("aam-busca-aviso.html"));
  assert.equal(cartoes.length, 25);
  assert.ok(total > 25, "a busca de 23 a 25/11 tem mais de uma página");
  const nhamunda = cartoes.find((c) => c.codigo === "9C147B8F");
  assert.ok(nhamunda, "cartão da dispensa 007/2026 de Nhamundá");
  assert.deepEqual([nhamunda.entidade, nhamunda.publicacao, nhamunda.titulo], ["Município de Nhamundá", "2026-11-25", "AVISO DE CONTRATAÇÃO DIRETA"]);
  assert.match(nhamunda.edicao, /^\d{4}$/);
  assert.equal(aam.lerBusca("<html>sem resultado</html>").cartoes.length, 0);
});

test("AAM: listar busca por termo, lê só a matéria das oportunidades e pula o que já foi lido", async () => {
  const pedidas = [];
  const cliente = {
    async texto(url) {
      pedidas.push(url);
      if (url.includes("/pesquisar?")) return url.includes("titulo%5D=aviso&") && url.includes("pagina%5D=1") ? ler("aam-busca-aviso.html") : "<html></html>";
      const codigo = /materia\/([0-9A-F]+)/.exec(url)[1];
      if (codigo === "9C147B8F") return ler("aam-materia-9C147B8F.html");
      throw new Error("HTTP 404");
    },
  };
  const ctx = { cliente, desde: "2026-11-23", ate: "2026-11-25", lidos: new Set(["6FC326BB"]), tempoRestanteMs: () => 1e9 };
  const log = console.log;
  console.log = () => {};
  const { publicacoes, lidas } = await aam.listar(ctx).finally(() => { console.log = log; });
  const nhamunda = publicacoes.find((p) => p.idExterno === "9C147B8F");
  assert.match(nhamunda.texto, /gasolina comum/);
  assert.deepEqual([nhamunda.tipo, nhamunda.orgao.municipio, nhamunda.orgao.esfera], ["dispensa", "Nhamundá", "M"]);
  assert.equal(nhamunda.linkOficial, "https://www.diariomunicipal.com.br/aam/materia/9C147B8F");
  assert.deepEqual(lidas, ["9C147B8F"], "matéria que falhou (404) fica para a próxima rodada");
  assert.ok(publicacoes.find((p) => p.idExterno === "6FC326BB").jaLida);
  assert.ok(!pedidas.some((u) => u.endsWith("/6FC326BB")), "matéria já lida não é pedida de novo");
  assert.ok(pedidas.some((u) => u.includes("titulo%5D=aviso&") && u.includes("pagina%5D=2")), "pagina enquanto há resultado");
});

test("regras: aviso padrão (Silves PE 046/2026) sai completo sem IA", () => {
  const c = ext.extrairPorRegras({ titulo: "AVISO DE LICITAÇÃO - PREGÃO ELETRÔNICO Nº 046/2026 - SRP", texto: materiaAam("84E81E30"), publicacao: "2026-11-24" });
  assert.deepEqual([c.tipo, c.modalidade, c.numero, c.ano, c.abertura, c.confianca], ["aviso", "Pregão - Eletrônico", "046", 2026, "2026-12-09T10:00:00", "alta"]);
  assert.match(c.objeto, /^Formação de registro de preços para aquisição de equipamentos de informática/);
  assert.doesNotMatch(c.objeto, /Data e hor/);
  assert.equal(c.urlDisputa, "https://www.licitanet.com.br");
  assert.equal(c.linkEdital, "https://transparenciamunicipalaam.org.br/p/silves");
});

test("regras: dispensa emergencial pega o objeto certo e o prazo limite, não o rótulo da lista de documentos", () => {
  const c = ext.extrairPorRegras({ titulo: "AVISO DE CONTRATAÇÃO DIRETA", texto: materiaAam("9C147B8F"), publicacao: "2026-11-25" });
  assert.equal(c.tipo, "dispensa");
  assert.match(c.objeto, /gasolina comum/);
  assert.doesNotMatch(c.objeto, /comprovante/i);
  assert.equal(c.abertura, "2026-11-26T07:30:00");
});

test("regras: cotação sem rótulo 'Objeto:' usa a frase entre aspas", () => {
  const c = ext.extrairPorRegras({ titulo: "AVISO DE COTAÇÃO DE PREÇOS", texto: materiaAam("F298C5FE"), publicacao: "2026-11-24" });
  assert.equal(c.tipo, "cotacao");
  assert.match(c.objeto, /^AQUISIÇÃO DE COMBUSTÍVEL/);
});

test("matéria com vários pregões vira um aviso por número (Benjamin Constant 032, 033 e 034/2026)", () => {
  const partes = ext.dividirAvisos(materiaAam("6FC326BB"));
  const lidos = partes.map((p) => ext.extrairPorRegras({ titulo: p.titulo, texto: p.texto, contexto: p.contexto, publicacao: "2026-11-24" }));
  assert.deepEqual(lidos.map((c) => c.numero), ["032", "033", "034"]);
  assert.match(lidos[0].objeto, /RAÇÃO PARA PEIXES/);
  assert.equal(lidos[0].abertura, "2026-12-14T08:30:00");
  // Título repetido no corpo não divide.
  assert.equal(ext.dividirAvisos(materiaAam("84E81E30")).length, 1);
});

test("classificação pelo título: oportunidade, resultado e o que não é compra", () => {
  const casos = [
    ["AVISO DE LICITAÇÃO - PREGÃO ELETRÔNICO Nº 046/2026", "aviso"],
    ["AVISO DE REPUBLICAÇÃO DE LICITAÇÃO", "aviso"],
    ["AVISO DE DISPENSA DE LICITAÇÃO Nº 034/2026", "dispensa"],
    ["EXTRATO DE DISPENSA DE LICITAÇÃO", "resultado"],
    ["TERMO DE HOMOLOGAÇÃO - PREGÃO ELETRÔNICO Nº 040/2026", "resultado"],
    ["AVISO DE RESULTADO", "resultado"],
    ["ERRATA AO AVISO DE LICITAÇÃO", "retificacao"],
    ["AVISO DE SUSPENSÃO", "suspensao"],
    ["AVISO DE COTAÇÃO DE PREÇOS", "cotacao"],
    ["EDITAL 001/2026", null], // eleição da Mesa da Câmara
    ["EDITAL DE PROCESSO TÉCNICO SELETIVO Nº 001/2026", null],
    ["PORTARIA GSEAI Nº 058, DISPENSAR para a função de Secretário(a) Escolar", null],
    ["PROCESSO ADMINISTRATIVO Nº 239/2026 DISPENSA ... JUSTIFICATIVA PELA AUSÊNCIA DE PUBLICAÇÃO", null],
    ["DECRETO Nº 56.342", null],
  ];
  for (const [titulo, esperado] of casos) assert.equal(ext.classificar(titulo), esperado, titulo);
  assert.equal(ext.classificar("EDITAL Nº 010/2026", "torna público que realizará licitação na modalidade pregão"), "aviso");
  assert.ok(ext.ehFomento("chamamento", "Chamamento Público com recursos da Política Nacional Aldir Blanc"));
  assert.ok(!ext.ehFomento("chamamento", "CHAMAMENTO PÚBLICO PARA CREDENCIAMENTO DE PESSOAS JURÍDICAS"));
});

test("parceria com OSC (MROSC) é fomento; CPF não vai para a IA", async () => {
  assert.ok(ext.ehFomento("chamamento", "Chamamento para celebrar termo de colaboração, nos termos da Lei nº 13.019/2014"));
  assert.ok(ext.ehFomento("chamamento", "entidades sem fins lucrativos interessadas"));
  let enviado = "";
  const fetchImpl = async (url, op) => { enviado = op.body; return { ok: false, status: 400, json: async () => ({}), text: async () => "" }; };
  await ext.chamarIa({ texto: "Pregoeiro Fulano, CPF 123.456.789-09, CNPJ 12345678000190", publicacao: "2026-11-20", apiKey: "x", modelos: ["m"], fetchImpl }).catch(() => {});
  assert.ok(enviado.includes("***.***.***-**") && !enviado.includes("123.456.789-09"));
  assert.ok(enviado.includes("12345678000190"), "CNPJ fica");
});

test("datas: '09 de dezembro de 2026, às 10:00h', '07/12/2026, às 08h:20min' e data fora da janela", () => {
  assert.equal(ext.extrairAbertura("Data e horário da sessão pública: 09 de dezembro de 2026, às 10:00h", "2026-11-24").abertura, "2026-12-09T10:00:00");
  assert.equal(ext.extrairAbertura("Data e Horário: 07/12/2026, às 08h:20min", "2026-11-18").abertura, "2026-12-07T08:20:00");
  // A lei citada e a assinatura são anteriores; sem data futura, sem abertura.
  assert.equal(ext.extrairAbertura("Lei 14.133, de 1º de abril de 2021. Manaus, 24 de novembro de 2026.", "2026-11-25").abertura, null);
  assert.equal(ext.extrairAbertura("abertura em 31/02/2026", "2026-01-01").abertura, null, "31/02 não existe");
});

test("DOE-AM: sumário em árvore com acento corrigido e órgão pela pasta", () => {
  const materias = doe.lerSumario(ler("doe-sumario-18281.html"));
  assert.ok(materias.length > 200);
  const careiro = materias.find((m) => m.identificador === "299427");
  assert.equal(careiro.titulo, "AVISO DE LICITAÇÃO");
  // Prefeitura publicando em "PUBLICAÇÕES DIVERSAS > Empresas Privadas": o órgão vem da 1ª linha do texto.
  assert.deepEqual(careiro.pastas, ["PUBLICAÇÕES DIVERSAS", "Empresas Privadas"]);
  assert.deepEqual(doe.orgaoDasPastas(careiro.pastas, ext.textoDoHtml(ler("doe-materia-299427.html"))), { nome: "PREFEITURA MUNICIPAL DE CAREIRO", municipio: "Careiro", esfera: "M" });
  assert.ok(!materias.some((m) => /Ã[\u0080-¿]/.test(m.titulo + m.pastas.join(""))), "sem mojibake");
  const csc = materias.find((m) => m.identificador === "299557");
  assert.equal(doe.orgaoDasPastas(csc.pastas).esfera, "E");
  assert.match(doe.orgaoDasPastas(csc.pastas).nome, /Centro de Serviços Compartilhados/);
});

test("DOE-AM: resenha do CSC vira um aviso por processo, com a data do grupo", () => {
  const partes = ext.dividirAvisos(ext.textoDoHtml(ler("doe-materia-299557.html")));
  const lidos = partes.map((p) => ext.extrairPorRegras({ titulo: p.titulo, texto: p.texto, contexto: p.contexto, publicacao: "2026-11-19" }));
  const ce = lidos.find((c) => c.numero === "035");
  assert.deepEqual([ce.modalidade, ce.abertura], ["Concorrência - Eletrônica", "2026-12-18T09:30:00"]);
  assert.match(ce.objeto, /Descargas Atmosféricas/);
  assert.equal(ce.urlDisputa, "https://www.e-compras.am.gov.br");
  assert.ok(lidos.filter((c) => c.modalidade === "Pregão - Eletrônico" && c.objeto).length >= 10);
});

test("DOM Manaus: RSS lista os cadernos e o PDF vira avisos com o órgão do cabeçalho", () => {
  const cadernos = dom.lerRss(ler("dom-rss.xml"));
  assert.ok(cadernos.length >= 10);
  assert.deepEqual(cadernos.find((c) => c.edicao === "6443"), { url: "https://dom.manaus.am.gov.br/pdf/2026/novembro/DOM%206443%2024.11.2026%20CAD%201.pdf", edicao: "6443", dia: "2026-11-24", caderno: "CAD 1" });
  const { paginas } = JSON.parse(ler("dom-6443-paginas-41-42.json"));
  const pubs = dom.publicacoesDoCaderno({ url: "https://x/DOM.pdf", edicao: "6443", dia: "2026-11-24", caderno: "CAD 1" }, paginas);
  const p076 = pubs.find((p) => /076\/2026/.test(p.titulo));
  assert.equal(p076.orgao.nome, "CENTRO MUNICIPAL DE SERVIÇOS COMPARTILHADOS");
  assert.equal(p076.linkOficial, "https://x/DOM.pdf#page=42");
  const c = ext.extrairPorRegras({ titulo: p076.titulo, texto: p076.texto, publicacao: "2026-11-24" });
  assert.deepEqual([c.numero, c.abertura, c.urlDisputa], ["076", "2026-11-27T10:00:00", "https://compras.manaus.am.gov.br"]);
  assert.match(c.objeto, /^Eventual\s+Aquisição\s+de\s+colchão/);
});

test("DOM Manaus: lê o texto por página de um PDF de verdade", async () => {
  // PDF mínimo (1 página, Helvetica) montado aqui para não versionar um caderno de 3 MB.
  const conteudo = "BT /F1 12 Tf 72 720 Td (AVISO DE LICITACAO) Tj 0 -20 Td (PREGAO ELETRONICO N. 076/2026) Tj ET";
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objetos.map((o, i) => { const pos = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return pos; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const paginas = await dom.lerPaginasPdf(Buffer.from(pdf, "latin1"));
  assert.equal(paginas.length, 1);
  assert.equal(paginas[0].texto, "AVISO DE LICITACAO\nPREGAO ELETRONICO N. 076/2026");
});

// ---------- Dedup, fechamento e marcação ----------

const fonteAam = aam.FONTE;
const pubBase = { idExterno: "84E81E30", titulo: "AVISO DE LICITAÇÃO - PREGÃO ELETRÔNICO Nº 046/2026", publicacao: "2026-11-24", linkOficial: "https://www.diariomunicipal.com.br/aam/materia/84E81E30", orgao: { nome: "Município de Silves", municipio: "Silves", uf: "AM", esfera: "M" } };
const camposBase = { tipo: "aviso", modalidade: "Pregão - Eletrônico", numero: "046", ano: 2026, objeto: "Formação de registro de preços para aquisição de equipamentos de informática e climatização", abertura: "2026-12-09T10:00:00", confianca: "alta", extraidoPor: "regras" };
const linhaSilves = (extra = {}) => montarLinha(fonteAam, { ...pubBase, ...extra.pub }, { ...camposBase, ...extra.campos });
const pncpSilves = { chave: "123-1-46/2026", municipio: "Silves", orgao: "MUNICIPIO DE SILVES", esfera: "M", modalidade: "Pregão - Eletrônico", numero: "46", ano: "2026", objeto: "Registro de preços de equipamentos de informática", abertura: "2026-12-09T10:00:00", publicacao: "2026-11-27" };

test("linha do diário: chave própria, selo do diário, link da publicação e 'visto primeiro no diário'", () => {
  const l = linhaSilves();
  assert.equal(l.chave, "fonte:diario-aam:84E81E30");
  assert.equal(l.numero_controle_pncp, null);
  assert.deepEqual([l.uf, l.publicacao, l.encerramento], ["AM", "2026-11-24", "2026-12-09"]);
  assert.equal(l.dado.fonte, "Diário AAM");
  assert.equal(l.dado.link, pubBase.linkOficial);
  assert.equal(l.dado.vistoPrimeiroNoDiario, true);
  assert.equal(l.dado.processo, "Pregão - Eletrônico nº 046/2026");
  assert.equal(l.dado.esferaId, "M");
});

test("dedup: aviso que o PNCP já tem (município + número/ano) não entra; Câmara do mesmo município é outro processo", () => {
  const camara = linhaSilves({ pub: { idExterno: "X1", orgao: { nome: "Câmara Municipal de Silves", municipio: "Silves", uf: "AM", esfera: "M" } } });
  const r = reconciliar({ novas: [linhaSilves(), camara], resultados: [], gravadas: [], pncp: [pncpSilves] });
  assert.deepEqual(r.gravar.map((l) => l.chave), ["fonte:diario-aam:X1"]);
  assert.equal(r.jaNoPncp, 1);
});

test("dedup: sem número, o mesmo objeto com abertura a até 2 dias também conta como já no PNCP", () => {
  const semNumero = linhaSilves({ campos: { numero: null, ano: null, objeto: "Registro de preços de equipamentos de informática" } });
  assert.equal(reconciliar({ novas: [semNumero], resultados: [], gravadas: [], pncp: [pncpSilves] }).gravar.length, 0);
  const outroObjeto = linhaSilves({ campos: { numero: null, ano: null, objeto: "Aquisição de gêneros alimentícios para merenda escolar" } });
  assert.equal(reconciliar({ novas: [outroObjeto], resultados: [], gravadas: [], pncp: [pncpSilves] }).gravar.length, 1);
});

test("dedup: linha gravada que apareceu no PNCP sai, com a antecedência do diário em dias", () => {
  const gravada = linhaSilves();
  const r = reconciliar({ novas: [], resultados: [], gravadas: [{ chave: gravada.chave, dado: gravada.dado }], pncp: [pncpSilves] });
  assert.deepEqual(r.apagar, [gravada.chave]);
  assert.deepEqual(r.antecedencias, [3]);
});

test("homologação publicada no diário tira o aviso do painel; o mesmo aviso em dois diários entra uma vez", () => {
  const gravada = linhaSilves();
  const fechado = reconciliar({ novas: [], resultados: [{ modalidade: "Pregão - Eletrônico", numero: "046", ano: 2026, municipio: "Silves", orgao: "Município de Silves", esfera: "M" }], gravadas: [{ chave: gravada.chave, dado: gravada.dado }], pncp: [] });
  assert.deepEqual(fechado.apagar, [gravada.chave]);
  const noDoe = montarLinha(doe.FONTE, { ...pubBase, idExterno: "299999", orgao: { nome: "Prefeitura Municipal de Silves", municipio: "Silves", uf: "AM", esfera: "M" } }, camposBase);
  const dois = reconciliar({ novas: [linhaSilves(), noDoe], resultados: [], gravadas: [], pncp: [] });
  assert.deepEqual([dois.gravar.length, dois.repetidas], [1, 1]);
  // Já gravado por outro robô (Querido Diário): não duplica, e a linha dele não é apagada daqui.
  const qd = { chave: "fonte:qd:1302405-x", dado: { ...linhaSilves().dado } };
  const comQd = reconciliar({ novas: [linhaSilves()], resultados: [], gravadas: [], pncp: [], outras: [qd] });
  assert.deepEqual([comQd.gravar.length, comQd.apagar.length], [0, 0]);
  // Reprocessar a mesma publicação atualiza a própria linha (mesma chave), não conta como repetida.
  const mesma = reconciliar({ novas: [linhaSilves()], resultados: [], gravadas: [{ chave: gravada.chave, dado: gravada.dado }], pncp: [] });
  assert.equal(mesma.gravar.length, 1);
});

test("órgão estadual compara pelo nome sem a sigla, não pelo município", () => {
  const estadual = { municipio: "Manaus", orgao: "Secretaria de Estado de Educação e Desporto Escolar- SEDUC", esfera: "E", modalidade: "Pregão - Eletrônico", numero: "10", ano: 2026 };
  const noPncp = { municipio: "Manaus", orgao: "SECRETARIA DE ESTADO DE EDUCACAO E DESPORTO ESCOLAR", esfera: "E", modalidade: "Pregão - Eletrônico", numero: "010", ano: "2026" };
  assert.equal(ext.chavesDedup(estadual)[0], ext.chavesDedup(noPncp)[0]);
  assert.notEqual(ext.chavesDedup(estadual)[1], ext.chavesDedup({ ...noPncp, orgao: "MUNICIPIO DE MANAUS", esfera: "M" })[1]);
});

// ---------- IA ----------

test("saída da IA: só fica o que está no texto (objeto inventado, data absurda e link de fora caem)", () => {
  const texto = "Aviso. Objeto: aquisição de merenda escolar para a rede municipal. Sessão em 10/12/2026 no site www.licitanet.com.br";
  const ok = ext.validarSaidaIa({ ehOportunidade: true, objeto: "aquisição de merenda escolar para a rede municipal", abertura: "2026-12-10T09:00", numero: "12", linkEdital: "www.licitanet.com.br" }, texto, "2026-11-24");
  assert.deepEqual([ok.objeto, ok.abertura, ok.linkEdital], ["aquisição de merenda escolar para a rede municipal", "2026-12-10T09:00:00", "https://www.licitanet.com.br"]);
  assert.equal(ok.numero, undefined, "12 não aparece no texto");
  const ruim = ext.validarSaidaIa({ ehOportunidade: true, objeto: "construção de ponte estaiada sobre o rio", abertura: "2031-01-01", linkEdital: "https://golpe.com" }, texto, "2026-11-24");
  assert.deepEqual([ruim.objeto, ruim.abertura, ruim.linkEdital], [undefined, undefined, undefined]);
  assert.equal(ext.validarSaidaIa("não é objeto", texto, "2026-11-24"), null);
});

test("IA só entra quando a regra falta campo, respeita o orçamento e completa sem sobrescrever a regra", async () => {
  const chamadas = [];
  const fetchImpl = async (url, opcoes) => {
    chamadas.push({ url, corpo: JSON.parse(opcoes.body) });
    const saida = { ehOportunidade: true, objeto: "outra coisa", abertura: "2026-12-01T09:00", numero: "", ano: 2026 };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(saida) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60 } }) };
  };
  const ia = { apiKey: "chave-teste", restantes: 1, uso: { chamadas: 0, entrada: 0, saida: 0 }, fetchImpl };
  const semData = { titulo: "AVISO DE COTAÇÃO", texto: "Torna público cotação. Objeto: aquisição de kits escolares para alunos. Propostas até 01/12/2026 às 09h.", publicacao: "2026-11-24", idExterno: "A" };
  // Regra já acha objeto e data; sem número -> média -> chama a IA, que não troca o objeto da regra.
  const c = await extrair({ ...semData, texto: semData.texto.replace(" Propostas até 01/12/2026 às 09h.", "") }, ia);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /gemini-3\.8-flash:generateContent$/);
  assert.equal(c.objeto, "aquisição de kits escolares para alunos");
  assert.equal(c.extraidoPor, "regras+ia");
  assert.deepEqual(ia.uso, { chamadas: 1, entrada: 900, saida: 60 });
  // Orçamento acabou: fica só com a regra.
  const d = await extrair({ ...semData, idExterno: "B", texto: "Objeto: aquisição de material de limpeza." }, ia);
  assert.equal(chamadas.length, 1);
  assert.equal(d.extraidoPor, "regras");
  // Aviso completo pela regra não gasta IA.
  const cheio = await extrair({ titulo: "AVISO DE LICITAÇÃO - PREGÃO ELETRÔNICO Nº 046/2026", texto: materiaAam("84E81E30"), publicacao: "2026-11-24" }, { ...ia, restantes: 5 });
  assert.equal(cheio.extraidoPor, "regras");
  assert.equal(chamadas.length, 1);
});
