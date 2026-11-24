const test = require("node:test");
const assert = require("node:assert/strict");
const { montarVisao, vencedorDe, variacao, linkOficial, textoDesconto, tipoDeOrgao, filtrarOrgaos } = require("./licitacao-anterior-ui.js");

test("textoDesconto: abaixo, acima, igual e sem dado", () => {
  assert.equal(textoDesconto(-18), "18,0% abaixo");
  assert.equal(textoDesconto(5.25), "5,3% acima");
  assert.equal(textoDesconto(0), "igual ao estimado");
  assert.equal(textoDesconto(null), "—");
});

const compra = (id, data) => ({ id_compra: id, numero: id.slice(8, 13), data_publicacao: data, plataforma: "Compras.gov.br" });
const item = (id, n, situacao, estimado) => ({ id_compra: id, numero_item: n, situacao_item: situacao, valor_estimado: estimado, descricao: "Café" });
const cas = (id, n, item_edital = 1) => ({ id_compra: id, numero_item: n, item_edital, confianca: "alta", regra: "mesmo item de catálogo (CATMAT)" });

test("vencedor: 1º do PNCP válido; cancelado não vence; sem PNCP vale a linha da Pesquisa de Preços", () => {
  assert.equal(vencedorDe([{ fornecedor_chave: "a", ordem_classificacao: 2 }, { fornecedor_chave: "b", ordem_classificacao: 1 }]).fornecedor_chave, "b");
  assert.equal(vencedorDe([{ fornecedor_chave: "a", ordem_classificacao: 1, situacao_resultado: "Cancelado" }]), null);
  assert.equal(vencedorDe([{ fornecedor_chave: "pp", marca: "PILÃO" }]).fornecedor_chave, "pp");
  assert.equal(variacao(23.33, 17), -27.1);
  assert.equal(variacao(0, 17), null);
  assert.equal(variacao(null, 17), null);
});

test("visão: só itens casados, mais nova primeiro, fracassado contado, marcas agrupadas sem acento/caixa", () => {
  const v = montarVisao({
    compras: [compra("78882005900042024", "2024-04-12"), compra("78882005900332025", "2025-08-18")],
    itens: [item("78882005900332025", 107, "Homologado", 23.33), item("78882005900332025", 108, "Fracassado", 35.62), item("78882005900332025", 1, "Homologado", 5),
      item("78882005900042024", 27, "Homologado", 21.88), item("78882005900042024", 170, "Homologado", 29.46)],
    participacoes: [
      { id_compra: "78882005900332025", numero_item: 107, fornecedor_chave: "38350458000143", fornecedor_nome: "C R DA SILVA", ordem_classificacao: 1, valor_homologado: 17, marca: null, classificacao: 1, valor_proposta: 19 },
      { id_compra: "78882005900332025", numero_item: 107, fornecedor_chave: "11111111000191", fornecedor_nome: "SEGUNDO", ordem_classificacao: 2, valor_homologado: 17, classificacao: 2, valor_proposta: 20 },
      { id_compra: "78882005900332025", numero_item: 107, fornecedor_chave: "48885922000150", fornecedor_nome: "DESISTIU", ordem_classificacao: 3, situacao_resultado: "Cancelado", motivo_cancelamento: "Não assinou a ata." },
      { id_compra: "78882005900332025", numero_item: 108, fornecedor_chave: "55555555000191", fornecedor_nome: "RECUSADO", classificacao: 1, valor_proposta: 30 },
      { id_compra: "78882005900042024", numero_item: 27, fornecedor_chave: "42343620000173", ordem_classificacao: 1, valor_homologado: 8, marca: "pilão" },
      { id_compra: "78882005900042024", numero_item: 170, fornecedor_chave: "42343620000173", ordem_classificacao: 1, valor_homologado: 23.5, marca: "PILAO" },
    ],
    casamentos: [cas("78882005900332025", 107), cas("78882005900332025", 108), cas("78882005900042024", 27), cas("78882005900042024", 170)],
    alvos: [{ numero: 1, valor_estimado: 20 }],
  });
  assert.deepEqual(v.compras.map((c) => c.compra.id_compra), ["78882005900332025", "78882005900042024"]);
  assert.deepEqual(v.compras[0].itens.map((i) => i.item.numero_item), [107, 108]);
  const i107 = v.compras[0].itens[0];
  assert.equal(i107.vencedor.fornecedor_nome, "C R DA SILVA");
  assert.equal(i107.sobreEstimado, -27.1);
  assert.equal(i107.sobreEstimadoAtual, -15);
  assert.deepEqual(i107.reservas.map((p) => p.fornecedor_nome), ["SEGUNDO"]);
  assert.equal(i107.cancelados[0].motivo_cancelamento, "Não assinou a ata.");
  assert.deepEqual(i107.participantes.map((p) => p.classificacao), [1, 2]);
  assert.equal(v.compras[0].itens[1].ruim, true);
  assert.equal(v.compras[0].itens[1].vencedor, null, "fracassado não tem vencedor");
  assert.equal(v.compras[0].itens[1].primeiroRecusado.fornecedor_nome, "RECUSADO");
  assert.equal(v.ruins, 1);
  assert.deepEqual(v.marcasAceitas, [{ marca: "Pilão", vitorias: 2, ultima: "2024-04-12", compras: 1 }]);
  assert.equal(v.semMarca, 1);
  // Por produto: o item 1 do edital juntou as duas vitórias da Pilão e o vencedor sem marca.
  assert.deepEqual(v.porProduto.map((g) => [g.numero, g.marcasAceitas.map((m) => m.marca), g.semMarca]), [[1, ["Pilão"], 1]]);
});

test("vencedores para o Contador: o homologado mais recente por item do edital; fracassado e sem item casado ficam fora", () => {
  const { vencedoresDoProcesso } = require("./licitacao-anterior-ui.js");
  const v = montarVisao({
    compras: [compra("78882005900042024", "2024-04-12"), compra("78882005900332025", "2025-08-18")],
    itens: [item("78882005900332025", 107, "Homologado", 23.33), item("78882005900332025", 108, "Fracassado", 35.62), item("78882005900042024", 27, "Homologado", 21.88)],
    participacoes: [
      { id_compra: "78882005900332025", numero_item: 107, fornecedor_chave: "a", ordem_classificacao: 1, valor_homologado: 17 },
      { id_compra: "78882005900042024", numero_item: 27, fornecedor_chave: "b", ordem_classificacao: 1, valor_homologado: 8 },
    ],
    casamentos: [cas("78882005900332025", 107), cas("78882005900332025", 108, 2), cas("78882005900042024", 27)],
    alvos: [{ numero: 1, descricao: "Café 500 g" }, { numero: 2, descricao: "Açúcar" }],
  });
  assert.deepEqual(vencedoresDoProcesso(v), [{ numero: 1, descricao: "Café 500 g", homologado: 17, data: "2025-08-18" }]);
  assert.deepEqual(vencedoresDoProcesso(null), []);
});

test("visão vazia não quebra", () => {
  assert.deepEqual(montarVisao({}), { compras: [], marcasAceitas: [], semMarca: 0, porProduto: [], ruins: 0 });
});

test("link na tela: só https em host oficial; o resto não vira href", () => {
  assert.equal(linkOficial("https://pncp.gov.br/app/editais/1/2025/3"), "https://pncp.gov.br/app/editais/1/2025/3");
  assert.equal(linkOficial("https://www.comprasnet.gov.br/x"), "https://www.comprasnet.gov.br/x");
  for (const ruim of ["javascript:alert(1)", "http://pncp.gov.br/x", "https://pncp.gov.br.evil.com/", "data:text/html,x", "", undefined]) assert.equal(linkOficial(ruim), null, String(ruim));
});

test("ver tudo: ata completa do ComprasNet antigo e Acompanhar contratação do Compras.gov, links oficiais e passos", () => {
  const { urlsVerTudo, PASSOS_VER_TUDO, linkOficial } = require("./licitacao-anterior-ui.js");
  const antigo = urlsVerTudo({ id_compra: "15814205000232022", plataforma: "ComprasNet (antigo)" });
  assert.equal(antigo.tipo, "comprasnet-antigo");
  assert.equal(antigo.url, "https://www.comprasnet.gov.br/livre/pregao/AtaEletronico.asp?co_no_uasg=158142&uasg=158142&numprp=232022&codigoModalidade=5&Seq=1");
  assert.ok(linkOficial(antigo.url));
  const novo = urlsVerTudo({ id_compra: "19302805900082025", plataforma: "Compras.gov.br" });
  assert.equal(novo.tipo, "comprasgov");
  assert.equal(novo.url, "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=19302805900082025");
  assert.ok(linkOficial(novo.url));
  assert.equal(urlsVerTudo({ id_compra: "abc" }), null);
  assert.equal(urlsVerTudo({ id_compra: "15814205000232022" }).tipo, "comprasnet-antigo"); // sem plataforma: modalidade 05, número comum, ano <= 2023
  assert.equal(PASSOS_VER_TUDO.length, 3);
  assert.match(PASSOS_VER_TUDO[1].texto, /Ler esta página e gravar/);
  assert.match(PASSOS_VER_TUDO[2].texto, /atualiza sozinho/);
});

test("tipoDeOrgao: câmara antes de prefeitura, saúde municipal é saúde, nome desconhecido é outros", () => {
  assert.equal(tipoDeOrgao("CÂMARA MUNICIPAL DE PARINTINS"), "legislativo");
  assert.equal(tipoDeOrgao("Prefeitura Municipal de Manaus"), "prefeitura");
  assert.equal(tipoDeOrgao("FUNDO MUNICIPAL DE SAÚDE DE ITACOATIARA"), "saude");
  assert.equal(tipoDeOrgao("UNIVERSIDADE FEDERAL DO AMAZONAS"), "educacao");
  assert.equal(tipoDeOrgao("COMANDO MILITAR DA AMAZÔNIA"), "seguranca");
  assert.equal(tipoDeOrgao("TRIBUNAL DE JUSTIÇA DO AMAZONAS"), "justica");
  assert.equal(tipoDeOrgao("XPTO"), "outros");
});

test("filtrarOrgaos: agrupa por órgão e cidade, só UASG de 5 a 8 dígitos, CNPJ do controle PNCP e filtros combinados", () => {
  const l = (orgao, municipio, codigoUnidade, esferaId, cnpj = "04312401000136") => ({ uf: "AM", orgao, municipio, codigoUnidade, esferaId, numero_controle_pncp: `${cnpj}-1-000001/2026` });
  const linhas = [
    l("PREFEITURA MUNICIPAL DE MANAUS", "Manaus", "927000", "M"), l("Prefeitura Municipal de Manaus", "MANAUS", "927010", "M"), l("PREFEITURA MUNICIPAL DE MANAUS", "Manaus", "927000", "M"),
    l("CAMARA MUNICIPAL DE PARINTINS", "Parintins", "1", "M", "04329736000169"),
    l("SECRETARIA DE ESTADO DE SAUDE", "Manaus", "925001", "D"),
    l("UNIVERSIDADE FEDERAL DO AMAZONAS", "Manaus", "154039", "F"), null, { uf: "AM", orgao: "" },
  ];
  const todos = filtrarOrgaos(linhas);
  assert.equal(todos.length, 4);
  assert.deepEqual([todos[0].orgao, todos[0].abertas, todos[0].uasgs], ["PREFEITURA MUNICIPAL DE MANAUS", 3, ["927000", "927010"]]);
  const camara = todos.find((g) => g.tipo === "legislativo");
  assert.deepEqual([camara.uasgs, camara.cnpj], [[], "04329736000169"]); // UASG "1" não serve para a consulta: fica o CNPJ
  assert.equal(filtrarOrgaos(linhas, { esfera: "E" })[0].esfera, "Estadual"); // DF/distrital conta como estadual
  assert.equal(filtrarOrgaos(linhas, { municipio: "parin" }).length, 1);
  assert.equal(filtrarOrgaos(linhas, { tipo: "saude" }).length, 1);
  assert.equal(filtrarOrgaos(linhas, { nome: "universidade" })[0].uasgs[0], "154039");
  assert.equal(filtrarOrgaos(linhas, { nome: "1540" }).length, 1); // parte do código também acha
  assert.deepEqual(filtrarOrgaos(linhas, { esfera: "F", tipo: "prefeitura" }), []);
});
