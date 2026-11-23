const test = require("node:test");
const assert = require("node:assert/strict");
const { validar, montarConsulta, handler, coberturaDoTipo } = require("../prospeccao");

const AGORA = Date.parse("2026-11-19T15:00:00Z"); // 12h em Brasília

test("validar: tipo obrigatório, UF e período fechados, CATMAT só dígitos", () => {
  assert.match(validar({}).erro, /tipo/);
  assert.match(validar({ tipo: "edital" }).erro, /tipo/);
  assert.match(validar({ tipo: "pca", uf: "XX" }).erro, /UF/);
  assert.match(validar({ tipo: "pca", dias: "999" }).erro, /Período/);
  assert.match(validar({ tipo: "pca", catmat: "12a" }).erro, /dígitos/);
  assert.deepEqual(validar({ tipo: "ata", uf: "am", catmat: "269941", dias: "90" }), { tipo: "ata", uf: "AM", palavras: [], frases: [], catmat: "269941", dias: 90 });
});

test("validar: palavras sem acento e sem sintaxe do PostgREST; curtas e repetidas caem", () => {
  const f = validar({ tipo: "contrato", palavras: "Café, CAFE, ab, limpeza),or=(id.eq.1, papel A4*" });
  assert.deepEqual(f.palavras, ["cafe", "limpeza", "or id eq 1", "papel a4"]);
});

test("montarConsulta: janela hoje..hoje+dias por data_ref, filtros e limite+1", () => {
  const u = new URL(montarConsulta(validar({ tipo: "contrato", uf: "AM", palavras: "limpeza, papel a4", dias: "180" }), AGORA));
  assert.equal(u.searchParams.get("tipo"), "eq.contrato");
  assert.equal(u.searchParams.get("uf"), "eq.AM");
  assert.deepEqual(u.searchParams.getAll("data_ref"), ["gte.2026-11-19", "lte.2027-05-18"]);
  assert.equal(u.searchParams.get("or"), "(busca.ilike.*limpeza*,and(busca.ilike.*pape*,busca.ilike.*a4*))");
  assert.equal(u.searchParams.get("limit"), "201");
});

test("montarConsulta: ata vigente por mais 30 dias, sem teto; sem UF não filtra UF", () => {
  const u = new URL(montarConsulta(validar({ tipo: "ata", catmat: "269941" }), AGORA));
  assert.deepEqual(u.searchParams.getAll("data_ref"), ["gte.2026-12-19"]);
  assert.equal(u.searchParams.get("uf"), null);
  assert.equal(u.searchParams.get("catmat"), "eq.269941");
});

test("handler: sem sessão responde 401 sem tocar a tabela; método errado 405", async () => {
  const sem = await handler({ httpMethod: "GET", headers: {}, queryStringParameters: { tipo: "pca" } });
  assert.equal(sem.statusCode, 401);
  const post = await handler({ httpMethod: "POST", headers: {} });
  assert.equal(post.statusCode, 405);
});

test("handler: só cadastro aprovado lê a tabela (pendente 403), com o token do próprio usuário", async () => {
  const anterior = global.fetch;
  for (const [status, esperado] of [["pendente", 403], ["aprovado", 200]]) {
    const lidas = [];
    global.fetch = async (url, op = {}) => {
      const u = new URL(url);
      if (u.pathname === "/auth/v1/user") return Response.json({ id: "u1" });
      if (u.pathname === "/rest/v1/clientes") return Response.json([{ status }]);
      lidas.push(`${u.pathname} ${op.headers.Authorization}`);
      return Response.json([]);
    };
    try {
      const r = await handler({ httpMethod: "GET", headers: { authorization: "Bearer T" }, queryStringParameters: { tipo: "pca" } });
      assert.equal(r.statusCode, esperado);
      assert.deepEqual(lidas, esperado === 200 ? ["/rest/v1/prospeccao_itens Bearer T", "/rest/v1/dados_robo Bearer T"] : []);
    } finally { global.fetch = anterior; }
  }
});

test("montarConsulta com nível: início do nome, nome e só especificação (nunca AND solto entre termos)", () => {
  const f = validar({ tipo: "ata", palavras: "papel a4, cafe" });
  const p = (n) => new URL(montarConsulta(f, AGORA, n)).searchParams;
  const papel = (ini) => `and(busca_nome.ilike.${ini ? "" : "*"}pape*,busca_nome.ilike.*a4*)`;
  assert.equal(p("inicio").get("or"), `(${papel(true)},busca_nome.ilike.cafe*)`);
  assert.equal(p("inicio").get("and"), null);
  assert.equal(p("nome").get("and"), `(or(${papel(false)},busca_nome.ilike.*cafe*),not.or(${papel(true)},busca_nome.ilike.cafe*))`);
  assert.equal(p("espec").get("and"), "(or(and(busca.ilike.*pape*,busca.ilike.*a4*),busca.ilike.*cafe*),not.or(and(busca_nome.ilike.*pape*,busca_nome.ilike.*a4*),busca_nome.ilike.*cafe*))");
  assert.equal(new URL(montarConsulta(f, AGORA, "espec", 17)).searchParams.get("limit"), "17");
});

test("handler: com palavras consulta nome antes da especificação, marca so_especificacao e respeita o limite", async () => {
  const anterior = global.fetch;
  const consultas = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: "u1" });
    if (u.pathname === "/rest/v1/clientes") return Response.json([{ status: "aprovado" }]);
    if (u.pathname === "/rest/v1/dados_robo") return Response.json([]);
    const nivel = u.searchParams.get("or") ? "inicio" : /not\.or\(and\(busca_nome\.ilike\.p/.test(u.searchParams.get("and")) ? "nome" : "espec";
    consultas.push(nivel);
    return Response.json([{ id: `${nivel}1`, coletado_em: "2026-11-19" }]);
  };
  try {
    const r = await handler({ httpMethod: "GET", headers: { authorization: "Bearer T" }, queryStringParameters: { tipo: "ata", palavras: "papel a4" } });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(consultas, ["inicio", "nome", "espec"]);
    const { linhas } = JSON.parse(r.body);
    assert.deepEqual(linhas.map((l) => [l.id, !!l.so_especificacao]), [["inicio1", false], ["nome1", false], ["espec1", true]]);
  } finally { global.fetch = anterior; }
});

test("busca: acento, plural/singular e palavras fora de ordem viram o mesmo filtro", () => {
  const frases = (t) => validar({ tipo: "pca", palavras: t }).frases;
  assert.deepEqual(frases("construção"), [["construc"]]);
  assert.deepEqual(frases("CONSTRUÇÕES"), [["construc"]]);
  assert.deepEqual(frases("limpezas"), frases("limpeza"));
  assert.deepEqual(frases("papéis"), frases("papel"));
  assert.deepEqual(frases("materiais de expediente"), [["materia", "expediente"]]);
  assert.deepEqual(frases("computadores"), [["computador"]]);
  // Ordem não importa: cada palavra vira um ILIKE e a frase é o AND delas.
  const u = (t) => new URL(montarConsulta(validar({ tipo: "pca", palavras: t }), AGORA)).searchParams.get("or");
  assert.equal(u("limpeza material"), "(and(busca.ilike.*limpeza*,busca.ilike.*materia*))");
  assert.equal(u("material de limpeza"), "(and(busca.ilike.*materia*,busca.ilike.*limpeza*))");
  // Número (CATMAT digitado na caixa de palavras) e palavra curta ficam como estão.
  assert.deepEqual(frases("papel a4 269941"), [["pape", "a4", "269941"]]);
});

test("coberturaDoTipo: junta os grupos do robô, só o tipo pedido; IRP vira BR", () => {
  const blobs = [
    { dado: { etapas: { "AM:pca": { concluidaEm: "2026-11-23T10:00:00Z", linhas: 12, emAndamento: false }, "AM:ata": { concluidaEm: "x" }, irp: { concluidaEm: "2026-11-23T09:00:00Z" } } } },
    { dado: { etapas: { "SP:pca": { concluidaEm: null, emAndamento: true }, "XX:pca": { concluidaEm: "y" } } } },
  ];
  assert.deepEqual(coberturaDoTipo(blobs, "pca"), {
    AM: { concluidaEm: "2026-11-23T10:00:00Z", emAndamento: false, linhas: 12 },
    SP: { concluidaEm: null, emAndamento: true, linhas: null },
  });
  assert.deepEqual(Object.keys(coberturaDoTipo(blobs, "irp")), ["BR"]);
  assert.deepEqual(coberturaDoTipo(null, "pca"), {});
});

test("handler: devolve a cobertura do tipo; sem ela (policy ausente) a busca segue com cobertura nula", async () => {
  const anterior = global.fetch;
  const casos = [
    [[{ dado: { etapas: { "AM:pca": { concluidaEm: "2026-11-23T10:00:00Z" } } } }], { AM: { concluidaEm: "2026-11-23T10:00:00Z", emAndamento: false, linhas: null } }],
    [null, null],
  ];
  for (const [resposta, esperado] of casos) {
    global.fetch = async (url) => {
      const u = new URL(url);
      if (u.pathname === "/auth/v1/user") return Response.json({ id: "u1" });
      if (u.pathname === "/rest/v1/clientes") return Response.json([{ status: "aprovado" }]);
      if (u.pathname === "/rest/v1/dados_robo") {
        assert.equal(u.searchParams.get("chave"), "like.prospeccao_cobertura_*");
        return resposta ? Response.json(resposta) : new Response("{}", { status: 401 });
      }
      return Response.json([]);
    };
    try {
      const r = await handler({ httpMethod: "GET", headers: { authorization: "Bearer T" }, queryStringParameters: { tipo: "pca", uf: "AM" } });
      assert.equal(r.statusCode, 200);
      assert.deepEqual(JSON.parse(r.body).cobertura, esperado);
    } finally { global.fetch = anterior; }
  }
});
