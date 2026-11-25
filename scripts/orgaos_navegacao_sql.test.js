const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { pg_trgm } = require("@electric-sql/pglite/contrib/pg_trgm");
const { unaccent } = require("@electric-sql/pglite/contrib/unaccent");

// PGlite em memória: orgaos_catalogo.sql (em produção) + orgaos_navegacao.sql, este 2 vezes (idempotente).
// Nomes e naturezas jurídicas do cadastro real do PNCP (baixado em 24/11/2026).
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", "supabase", f), "utf8");
const APROVADO = "00000000-0000-4000-8000-000000000001", PENDENTE = "00000000-0000-4000-8000-000000000002";
const CADASTRO = [
  ["04034583000122", "MUNICIPIO DE RIO BRANCO", "M", "1244"], ["04034583000203", "MUNICIPIO DE RIO BRANCO", "M", "1244"],
  ["04115298000150", "RIO BRANCO CAMARA MUNICIPAL", "M", "1066"], ["13782456000103", "FUNDO MUNICIPAL DE SAUDE DE RIO BRANCO", "M", "1333"],
  ["04034526000143", "MUNICIPIO DE CRUZEIRO DO SUL", "M", "1244"], ["63606479000124", "ESTADO DO ACRE", "E", "1236"],
  ["04035127000146", "INSTITUTO DE PREVIDENCIA DO ESTADO DO ACRE", "E", "1112"], ["10918674000123", "INSTITUTO FEDERAL DE EDUCACAO,CIENCIA E TECNOLOGIA DO ACRE", "F", "1104"],
  ["10918674000204", "INSTITUTO FEDERAL DE EDUCACAO,CIENCIA E TECNOLOGIA DO ACRE", "F", "1104"], ["04034484000140", "ACRE TRIBUNAL DE JUSTICA", "E", "1082"],
  ["00394429000100", "COMANDO DA AERONAUTICA", "F", "1015"], ["04365326000173", "MUNICIPIO DE MANAUS", "M", "1244"],
  ["11111111000191", "ORGAO SEM UNIDADE NO PNCP", "F", "1015"],
].map(([cnpj, nome, esfera, natureza]) => ({ cnpj, nome, esfera, poder: "E", natureza }));

async function banco() {
  const db = new PGlite({ extensions: { pg_trgm, unaccent } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table public.clientes(id uuid primary key, status text);
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create function public.cliente_aprovado() returns boolean language sql stable security definer set search_path = '' as $$
      select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado') $$;
    grant execute on function public.cliente_aprovado() to authenticated;
    create table public.oportunidades_abertas(chave text primary key, numero_controle_pncp text, objeto text not null default '', uf text,
      publicacao date, encerramento date, dado jsonb not null);
    create table public.contratos(numero_controle_pncp text primary key, objeto text not null default '', uf text, data_assinatura date, dado jsonb not null);
    create table public.mercado_atas(numero_controle_pncp_ata text primary key, objeto text not null default '', uf_orgao text, municipio_orgao text,
      data_assinatura date, vigencia_fim date, cancelado boolean not null default false, dado jsonb not null);
    create table public.prospeccao_itens(id text primary key, tipo text, uf text, orgao_cnpj text, orgao_nome text, unidade_codigo text,
      unidade_nome text, municipio text, data_inicio date);
    insert into public.clientes values ('${APROVADO}', 'aprovado'), ('${PENDENTE}', 'pendente');`);
  await db.exec(ler("orgaos_catalogo.sql"));
  // Catálogo como está em produção hoje: cadastro carregado sem natureza (versão antiga) antes deste arquivo.
  await db.query("select public.carregar_cadastro_orgaos($1::jsonb)", [JSON.stringify(CADASTRO.map(({ natureza, ...o }) => o))]);
  await db.exec(ler("orgaos_navegacao.sql"));
  await db.exec(ler("orgaos_navegacao.sql"));
  await db.query("select public.carregar_cadastro_orgaos($1::jsonb)", [JSON.stringify(CADASTRO)]);
  // Manaus tem dados coletados (UF e cidade dos dados); Rio Branco tem licitação aberta (filial) e contrato (matriz).
  await db.exec(`
    insert into oportunidades_abertas values
      ('a', '04365326000173-1-000010/2026', 'Limpeza', 'AM', '2026-11-20', '2099-01-10', '{"orgao":"MUNICIPIO DE MANAUS","municipio":"Manaus"}'),
      ('b', '04034583000203-1-000001/2026', 'Merenda', 'AC', '2026-11-20', '2099-01-10', '{"orgao":"MUNICIPIO DE RIO BRANCO","municipio":"Rio Branco"}'),
      ('c', '04034484000140-1-000002/2026', 'TI', 'AC', '2026-11-20', '2099-01-10', '{"orgao":"ACRE TRIBUNAL DE JUSTICA","municipio":"Rio Branco"}'),
      ('d', '04034484000140-1-000003/2026', 'TI 2', 'AC', '2026-11-20', '2099-01-10', '{"orgao":"ACRE TRIBUNAL DE JUSTICA","municipio":"Rio Branco"}');
    insert into contratos values ('04034583000122-2-000001/2026', 'C1', 'AC', '2026-03-01', '{}'), ('04034583000122-2-000002/2026', 'C2', 'AC', '2026-03-02', '{}');`);
  await db.query("select public.atualizar_orgaos_catalogo()");
  return db;
}
const como = async (db, uid) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || ""]);
  await db.exec(uid === "service" ? "set role service_role" : uid === "anon" ? "set role anon" : "set role authenticated");
};
const listar = async (db, p = {}) => (await db.query(
  "select public.listar_orgaos($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) r",
  [p.uf ?? null, p.municipio ?? null, p.tipo ?? null, p.esfera ?? null, p.soAbertas ?? false, p.ordem ?? "abertas", p.limite ?? 30, p.offset ?? 0, p.termo ?? null, p.agrupar ?? true],
)).rows[0].r;
const locais = (db, lista) => db.query("select public.gravar_local_orgaos($1::jsonb) n", [JSON.stringify(lista)]);

test("orgao_tipo: regras pelo nome e pela natureza jurídica", async () => {
  const db = await banco();
  try {
    const casos = [
      ["MUNICIPIO DE RIO BRANCO", "1244", "M", "prefeitura"], ["SAO PEDRO DO PIAUI PREFEITURA", "1031", "M", "prefeitura"],
      ["Prefeitura Municipal de Apuí", null, "M", "prefeitura"], ["MUNICIPIO DE AMARANTE-SECRETARIA MUNICIPAL DE EDUCACAO", "1031", "M", "educacao"],
      ["MUNICIPIO DE APUI - GABINETE DO PREFEITO", "1031", "M", "municipal"], ["FUNDO MUNICIPAL DE ASSISTENCIA SOCIAL DE RIO BRANCO - MT", "1333", "M", "municipal"],
      ["RIO BRANCO CAMARA MUNICIPAL", "1066", "M", "legislativo"], ["ASSEMBLEIA LEGISLATIVA DO ESTADO DO AMAZONAS", null, "E", "legislativo"],
      ["ESTADO DO ACRE", "1236", "E", "estadual"], ["SECRETARIA DE ESTADO DE FAZENDA", "1023", "E", "estadual"],
      ["ACRE TRIBUNAL DE JUSTICA", "1082", "E", "justica"], ["TRIBUNAL DE CONTAS DO ESTADO DO ACRE", "1058", "E", "justica"], ["CAMARA DOS DEPUTADOS", "1040", "F", "legislativo"], ["MINISTERIO PUBLICO DO ESTADO DO PARA", "1171", "E", "justica"],
      ["TRIBUNAL REGIONAL DO TRABALHO DA 11 REGIAO", "1074", "F", "justica"], ["SECRETARIA DE ESTADO DE JUSTICA E DIREITOS HUMANOS", "1023", "E", "estadual"],
      ["COMANDO DA AERONAUTICA", "1015", "F", "seguranca"], ["POLICIA MILITAR DO ESTADO DO AMAZONAS", "1023", "E", "seguranca"],
      ["FUNDO MUNICIPAL DE SAUDE DE RIO BRANCO", "1333", "M", "saude"], ["HOSPITAL UNIVERSITARIO GETULIO VARGAS", "1104", "F", "saude"],
      ["UNIVERSIDADE FEDERAL DE CIENCIAS DA SAUDE DE PORTO ALEGRE", "1104", "F", "universidade"],
      ["INSTITUTO FEDERAL DE EDUCACAO,CIENCIA E TECNOLOGIA DO ACRE", "1104", "F", "universidade"], ["FUNDACAO UNIVERSIDADE DO AMAZONAS", "1139", "F", "universidade"],
      ["SECRETARIA DE ESTADO DE EDUCACAO E DESPORTO", "1023", "E", "educacao"],
      ["INSTITUTO DE PREVIDENCIA DO ESTADO DO ACRE", "1112", "E", "autarquia"], ["CONSELHO REGIONAL DE MEDICINA DO ESTADO DO ACRE", "1104", "F", "autarquia"],
      ["SERVICO AUTONOMO DE AGUA E ESGOTO DE ITU", "1120", "M", "autarquia"],
      ["CONSORCIO INTERMUNICIPAL DE SAUDE DA REGIAO ALTO TAPAJOS", "1210", "N", "consorcio"],
      ["MINISTERIO DA FAZENDA", "1015", "F", "federal"], ["SERVICO SOCIAL DA INDUSTRIA", "3077", "N", "outros"], ["EMPRESA X", null, null, "outros"],
    ];
    for (const [nome, nat, esf, tipo] of casos)
      assert.equal((await db.query("select orgao_tipo(orgao_normalizar($1), $2, $3) t", [nome, nat, esf])).rows[0].t, tipo, nome);
  } finally { await db.close(); }
});

test("orgaos_navegacao.sql: natureza, tipo, UF e cidade das unidades do PNCP entram no catálogo e na busca", async () => {
  const db = await banco();
  try {
    const linha = async (cnpj) => (await db.query("select * from orgaos_catalogo where cnpj = $1", [cnpj])).rows[0];
    assert.deepEqual([(await linha("04115298000150")).natureza, (await linha("04115298000150")).tipo], ["1066", "legislativo"]);
    assert.equal((await linha("63606479000124")).uf, null, "só do cadastro: ainda sem UF");
    // Fila do robô: sem UF, os ativos primeiro; Manaus tem UF dos dados e não entra.
    await como(db, "service");
    const fila = (await db.query("select orgaos_sem_local(100) f")).rows[0].f;
    assert.ok(fila.includes("63606479000124") && fila.includes("04034526000143"));
    assert.ok(!fila.includes("04365326000173") && !fila.includes("04034583000122"), "UF já veio dos dados coletados");
    assert.equal(fila.indexOf("00394429000100") < fila.indexOf("10918674000204"), true, "matriz antes de filial");
    assert.equal((await locais(db, [
      { cnpj: "63606479000124", uf: "AC", municipio: "Rio Branco" }, { cnpj: "04115298000150", uf: "AC", municipio: "Rio Branco" },
      { cnpj: "04034526000143", uf: "AC", municipio: "Cruzeiro do Sul" }, { cnpj: "13782456000103", uf: "AC", municipio: "Rio Branco" },
      { cnpj: "04035127000146", uf: "AC", municipio: "Rio Branco" }, { cnpj: "10918674000123", uf: "AC", municipio: "Rio Branco" },
      { cnpj: "10918674000204", uf: "AC", municipio: "Cruzeiro do Sul" }, { cnpj: "04034583000122", uf: "AC", municipio: "Rio Branco" },
      { cnpj: "11111111000191", uf: null }, { cnpj: "04365326000173", uf: "SP", municipio: "Errado" },
      { cnpj: "123", uf: "AC" }, { cnpj: "00394429000100", uf: "acre" },
    ])).rows[0].n, 10, "CNPJ e UF inválidos ficam fora");
    await db.exec("reset role");
    const estado = await linha("63606479000124");
    assert.deepEqual([estado.uf, estado.municipio, estado.municipio_norm], ["AC", "Rio Branco", "rio branco"]);
    assert.match(estado.busca, / rio branco ac acre /, "UF e cidade entram no texto de busca");
    assert.deepEqual([(await linha("04365326000173")).uf, (await linha("04365326000173")).municipio], ["AM", "Manaus"], "dado coletado manda");
    assert.equal((await linha("11111111000191")).local_consultado_em !== null, true, "sem unidade: marcado como consultado");
    await como(db, "service");
    assert.ok(!(await db.query("select orgaos_sem_local(100) f")).rows[0].f.includes("11111111000191"), "não volta para a fila antes de 30 dias");
    // Erro do PNCP (não 404): conta a falha, sai da fila hoje, volta no fim da fila; com 3 falhas, só depois de 7 dias.
    const aer = "00394429000100";
    const filaAgora = async () => (await db.query("select orgaos_sem_local(100) f")).rows[0].f;
    await como(db, "service");
    await db.query(`select gravar_local_orgaos('[{"cnpj":"${aer}","falhou":true}]'::jsonb)`);
    assert.ok(!(await filaAgora()).includes(aer), "falhou hoje: não volta no mesmo dia");
    await db.exec("reset role");
    await db.query("insert into orgaos_catalogo (cnpj, nome_registro, esfera_registro) values ('22222222000191', 'ORGAO NOVO', 'F')");
    await db.query("update orgaos_catalogo set local_consultado_em = current_date - 1 where cnpj = $1", [aer]);
    await como(db, "service");
    const f1 = await filaAgora();
    assert.ok(f1.indexOf(aer) > f1.indexOf("22222222000191"), "volta no dia seguinte, depois dos nunca consultados");
    await db.exec("reset role");
    await db.query("update orgaos_catalogo set local_falhas = 3, local_consultado_em = current_date - 2 where cnpj = $1", [aer]);
    await como(db, "service");
    assert.ok(!(await filaAgora()).includes(aer), "3 falhas: espera 7 dias");
    await db.exec("reset role");
    await db.query("update orgaos_catalogo set local_consultado_em = current_date - 8 where cnpj = $1", [aer]);
    await como(db, "service");
    assert.ok((await filaAgora()).includes(aer));
    await db.query(`select gravar_local_orgaos('[{"cnpj":"${aer}","uf":"DF","municipio":"Brasília"}]'::jsonb)`);
    await db.exec("reset role");
    assert.deepEqual([(await linha(aer)).local_falhas, (await linha(aer)).uf], [0, "DF"], "resposta boa zera as falhas");
    // Recálculo diário não apaga a UF do PNCP de quem tem dado sem UF.
    await db.exec("reset role");
    await db.query("select atualizar_orgaos_catalogo()");
    assert.equal((await linha("04034583000122")).uf, "AC");
    await como(db, APROVADO);
    const busca = (await db.query("select cnpj from buscar_orgaos('estado acre', 'AC', 5)")).rows.map((r) => r.cnpj);
    assert.ok(busca.includes("63606479000124"), "a busca com UF passa a achar órgão que só estava no cadastro");
  } finally { await db.close(); }
});

test("listar_orgaos: escolher pela UF sem digitar, com filtros, ordem, agrupamento e segurança", async () => {
  const db = await banco();
  try {
    await como(db, "service");
    await locais(db, [
      ["63606479000124", "Rio Branco"], ["04115298000150", "Rio Branco"], ["04034526000143", "Cruzeiro do Sul"], ["13782456000103", "Rio Branco"],
      ["04035127000146", "Rio Branco"], ["10918674000123", "Rio Branco"], ["10918674000204", "Rio Branco"], ["04034583000122", "Rio Branco"],
    ].map(([cnpj, municipio]) => ({ cnpj, uf: "AC", municipio })));
    await como(db, APROVADO);
    const ac = await listar(db, { uf: "AC" });
    // Rio Branco (matriz + filial) e IFAC (2 CNPJs) viram 1 linha cada: 8 órgãos.
    assert.equal(ac.total, 8);
    assert.deepEqual(ac.tipos, { prefeitura: 2, legislativo: 1, estadual: 1, justica: 1, universidade: 1, saude: 1, autarquia: 1 });
    assert.deepEqual(ac.itens.map((o) => o.tipo), ["prefeitura", "prefeitura", "legislativo", "estadual", "justica", "universidade", "saude", "autarquia"], "agrupado na ordem dos grupos");
    const rb = ac.itens[0];
    assert.deepEqual([rb.cnpj, rb.nome, rb.abertas, rb.contratos, rb.cnpjs, rb.municipio], ["04034583000122", "MUNICIPIO DE RIO BRANCO", 1, 2, 2, "Rio Branco"], "matriz representa; contagens somadas");
    assert.equal(ac.itens[1].nome, "MUNICIPIO DE CRUZEIRO DO SUL");
    // Sem agrupar, por abertas: TJAC (2) > Rio Branco (1).
    assert.deepEqual((await listar(db, { uf: "AC", agrupar: false, limite: 2 })).itens.map((o) => o.cnpj), ["04034484000140", "04034583000122"]);
    assert.deepEqual((await listar(db, { uf: "AC", agrupar: false, ordem: "contratos", limite: 1 })).itens.map((o) => o.cnpj), ["04034583000122"]);
    assert.equal((await listar(db, { uf: "AC", agrupar: false, ordem: "nome", limite: 1 })).itens[0].nome, "ACRE TRIBUNAL DE JUSTICA");
    // Filtros.
    const cz = await listar(db, { uf: "AC", municipio: "cruzeiro do sul" });
    assert.deepEqual(cz.itens.map((o) => o.nome), ["MUNICIPIO DE CRUZEIRO DO SUL"], "cidade sem acento; filial do IFAC em Cruzeiro fica com a matriz em Rio Branco");
    assert.equal((await listar(db, { uf: "AC", tipo: "prefeitura" })).total, 2);
    assert.equal((await listar(db, { uf: "AC", tipo: "prefeitura" })).tipos.legislativo, 1, "contagem por tipo ignora o filtro de tipo");
    assert.equal((await listar(db, { uf: "AC", tipo: "inexistente" })).total, 8, "tipo desconhecido = todos");
    assert.equal((await listar(db, { uf: "AC", esfera: "F" })).itens[0].tipo, "universidade");
    assert.deepEqual((await listar(db, { uf: "AC", soAbertas: true, agrupar: false })).itens.map((o) => o.abertas), [2, 1]);
    assert.equal((await listar(db, { uf: "AC", termo: "camara" })).itens[0].cnpj, "04115298000150", "digitar filtra a lista");
    assert.equal((await listar(db, { uf: "AC", termo: "prefeitura rio" })).itens[0].cnpj, "04034583000122", "sinônimo prefeitura = município");
    assert.equal((await listar(db, { uf: "AC,AM", tipo: "prefeitura" })).total, 3, "várias UFs");
    assert.equal((await listar(db, { soAbertas: true })).total, 3, "Brasil: só quem tem aberta");
    // Paginação.
    const p2 = await listar(db, { uf: "AC", limite: 3, offset: 3 });
    assert.deepEqual([p2.total, p2.itens.length, p2.itens[0].tipo], [8, 3, "estadual"]);
    assert.equal((await listar(db, { uf: "AC", limite: 500 })).itens.length, 8, "limite máximo 60 não quebra");
    assert.deepEqual(ac.itens.slice(0, 2).map((o) => o.secretarias), [2, 0], "prefeitura de Rio Branco: câmara e fundo de saúde");
    assert.equal(ac.itens[2].secretarias, null, "só prefeitura tem o atalho");
    // Órgãos do mesmo ente (ficha de prefeitura/câmara/governo).
    await db.exec("reset role");
    await db.exec(`insert into contratos values ('13782456000103-2-000009/2026', 'Remédios', 'AC', '2026-05-01', '{"valor": 1000.5}')`);
    await como(db, APROVADO);
    const ente = async (cnpj) => (await db.query("select orgaos_mesmo_ente($1) r", [cnpj])).rows[0].r;
    const pref = await ente("04034583000203");
    assert.deepEqual([pref.ente, pref.municipio, pref.total.orgaos, pref.total.contratos, Number(pref.total.valor), pref.proprio.contratos],
      ["municipio", "Rio Branco", 3, 3, 1000.5, 2], "prefeitura + secretarias, somados; aberta pela filial");
    assert.deepEqual(pref.orgaos.map((o) => o.cnpj), ["13782456000103", "04115298000150"], "maior valor primeiro; sem a própria prefeitura");
    assert.deepEqual((await ente("04115298000150")).orgaos.map((o) => o.cnpj).sort(), ["04034583000122", "13782456000103"], "câmara também");
    const estadoAc = await ente("63.606.479/0001-24");
    assert.deepEqual([estadoAc.ente, estadoAc.orgaos.map((o) => o.cnpj).sort()], ["estado", ["04034484000140", "04035127000146"]], "governo: órgãos estaduais da UF");
    assert.equal(await ente("10918674000123"), null, "universidade federal: sem a seção");
    assert.equal(await ente("123"), null);
    // Cidades da UF.
    assert.deepEqual((await db.query("select * from listar_municipios_orgaos('ac')")).rows.map((r) => [r.municipio, r.orgaos]),
      [["Cruzeiro do Sul", 1], ["Rio Branco", 7]]);
    assert.deepEqual((await db.query("select * from listar_municipios_orgaos('x')")).rows, []);
    // Segurança.
    await assert.rejects(db.query("select orgaos_sem_local(1)"), /permission denied/, "fila do robô só com a chave de serviço");
    await assert.rejects(db.query("select gravar_local_orgaos('[]'::jsonb)"), /permission denied/);
    await assert.rejects(db.query("select orgao_tipo('x', null, null)"), /permission denied/);
    await como(db, PENDENTE);
    await assert.rejects(listar(db, { uf: "AC" }), /só para cadastro aprovado/);
    await assert.rejects(db.query("select * from listar_municipios_orgaos('AC')"), /só para cadastro aprovado/);
    await assert.rejects(db.query("select orgaos_mesmo_ente('04034583000122')"), /só para cadastro aprovado/);
    await como(db, "anon");
    await assert.rejects(listar(db, { uf: "AC" }), /permission denied/);
  } finally { await db.close(); }
});
