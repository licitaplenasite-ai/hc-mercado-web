const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./vigia_normas_obra");

test("termosDe: termo forte basta; sobrepreço e inexequibilidade só contam em obra", () => {
  assert.deepEqual(V.termosDe("Representação. BDI acima do 3º quartil."), ["BDI"]);
  assert.deepEqual(V.termosDe("Sobrepreço na aquisição de medicamentos"), []);
  assert.deepEqual(V.termosDe("Obra rodoviária. Sobrepreço e inexequibilidade da proposta."), ["sobrepreço", "inexequibilidade"]);
  assert.deepEqual(V.termosDe("Nota SINAPI sobre desoneração da folha"), ["SINAPI", "desoneração"]);
});

test("dataDe lê data do TCU (dd/mm/aaaa) e do título de norma (13 DE ABRIL DE 2026)", () => {
  assert.equal(V.dataDe("18/11/2026"), "2026-11-18");
  assert.equal(V.dataDe("INSTRUÇÃO NORMATIVA SEGES/MGI Nº 148, DE 13 DE ABRIL DE 2026"), "2026-04-13");
  assert.equal(V.dataDe("DECRETO Nº 12.304, DE 9 DE DEZEMBRO DE 2024"), "2024-12-09");
  assert.equal(V.dataDe("sem data"), null);
});

test("novidadeTcu: só acórdão de orçamento de obra, com link https, data e resumo; o resto fica de fora", () => {
  const base = { titulo: "ACÓRDÃO 3133/2026 ATA 46/2026 - PLENÁRIO", dataSessao: "18/11/2026", urlAcordao: "https://contas.tcu.gov.br/x", urlArquivoPdf: "https://x.pdf" };
  const n = V.novidadeTcu({ ...base, sumario: "FISCOBRAS 2026. OBRAS DO METRÔ. SOBREPREÇO NA PLANILHA ORÇAMENTÁRIA." });
  assert.equal(n.fonte, "TCU");
  assert.equal(n.link, "https://contas.tcu.gov.br/x");
  assert.equal(n.publicado_em, "2026-11-18");
  assert.deepEqual(n.termos, ["planilha orçamentária", "sobrepreço"]);
  assert.equal(V.novidadeTcu({ ...base, sumario: "Aposentadoria. Legalidade." }), null);
  assert.equal(V.novidadeTcu({ ...base, urlAcordao: "javascript:alert(1)", urlArquivoPdf: "", sumario: "BDI" }), null);
});

test("linksCaixa: PDFs do SINAPI da página, sem repetir", () => {
  const html = `<a href="/Downloads/sinapi-historico-de-encargos-e-notas/Notas_SINAPI.pdf">Consultar notas divulgadas</a>
<a class="x" href="/Downloads/sinapi-metodologia/Livro_SINAPI_Calculos_Parametros.pdf">Livro – Cálculos e Parâmetros</a>
<a href="/Downloads/sinapi-metodologia/Livro_SINAPI_Calculos_Parametros.pdf">livro Cálculos e Parâmetros.</a>
<a href="/voce/cartoes/Paginas/default.aspx">Cartões</a>`;
  assert.deepEqual(V.linksCaixa(html), [
    { url: "https://www.caixa.gov.br/Downloads/sinapi-historico-de-encargos-e-notas/Notas_SINAPI.pdf", titulo: "Consultar notas divulgadas" },
    { url: "https://www.caixa.gov.br/Downloads/sinapi-metodologia/Livro_SINAPI_Calculos_Parametros.pdf", titulo: "Livro – Cálculos e Parâmetros" },
  ]);
});

test("itensSeges: IN e decreto da lista, sem menu nem perguntas frequentes", () => {
  const html = `<a href="https://www.gov.br/compras/pt-br/acesso-a-informacao/perguntas-frequentes/instrucao-normativa-de-servicos">Instrução Normativa de Serviços - IN nº 5</a>
<a class="summary url" href="https://www.gov.br/compras/pt-br/legislacao/in-148" title="Document">INSTRUÇÃO NORMATIVA SEGES/MGI Nº 148, DE 13 DE ABRIL DE 2026</a>
<a class="external-link" href="https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12926.htm#art1" target="_blank">DECRETO Nº 12.926, DE 13 DE ABRIL DE 2026</a>
<a href="https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/decretos-vigentes">Decretos vigentes</a>`;
  assert.deepEqual(V.itensSeges(html), [
    { link: "https://www.gov.br/compras/pt-br/legislacao/in-148", titulo: "INSTRUÇÃO NORMATIVA SEGES/MGI Nº 148, DE 13 DE ABRIL DE 2026" },
    { link: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12926.htm", titulo: "DECRETO Nº 12.926, DE 13 DE ABRIL DE 2026" },
  ]);
});

test("o vigia só cria novidade: não toca nas regras do Auditor nem grava em outra tabela", () => {
  const fonte = require("node:fs").readFileSync(require.resolve("./vigia_normas_obra"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(fonte, /orcamento-obra-regras|orcamento-obra-auditor|require\(".\/orcamento/);
  const tabelas = [...fonte.matchAll(/restFetch\(\s*["'`]([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tabelas)], ["orcamento_normas_novidades"]);
  assert.match(fonte, /resolution=ignore-duplicates/); // nunca sobrescreve a decisão já tomada pelo dono
  assert.deepEqual([...new Set([...fonte.matchAll(/salvarBlob\("dados_robo", ([A-Z_]+)/g)].map((m) => m[1]))], ["CHAVE_ESTADO"]);
});
