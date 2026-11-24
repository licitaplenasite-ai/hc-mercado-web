const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { pg_trgm } = require("@electric-sql/pglite/contrib/pg_trgm");
const { unaccent } = require("@electric-sql/pglite/contrib/unaccent");

// PGlite em memória roda supabase/orgaos_catalogo.sql de verdade (2 vezes: tem de ser idempotente), com unaccent e pg_trgm.
// Nomes do cadastro real do PNCP (baixado em 24/11/2026). As tabelas do robô são esboços com as colunas que o recálculo lê.
const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "orgaos_catalogo.sql"), "utf8");
const APROVADO = "00000000-0000-4000-8000-000000000001", PENDENTE = "00000000-0000-4000-8000-000000000002";
const CADASTRO = [
  ["22812960000199", "MUNICIPIO DE APUI", "M"], ["07438468000101", "MUNICIPIO DE APUIARES", "M"],
  ["04365326000173", "MUNICIPIO DE MANAUS", "M"], ["04365326000254", "MUNICIPIO DE MANAUS", "M"],
  ["07811304000188", "PROCURADORIA GERAL DO MUNICIPIO - MANAUS", "M"], ["04461836000144", "MANAUS SECRETARIA MUNICIPAL DE SAUDE", "M"],
  ["04812509000190", "AMAZONAS TRIBUNAL DE JUSTICA", "E"], ["04378626000197", "FUNDACAO UNIVERSIDADE DO AMAZONAS", "F"],
  ["34621748000123", "UNIVERSIDADE FEDERAL DO PARA", "F"], ["75095679000149", "UNIVERSIDADE FEDERAL DO PARANA", "F"],
  ["11118393000159", "UNIVERSIDADE FEDERAL DO OESTE DO PARA", "F"], ["04280196000176", "UNIVERSIDADE DO ESTADO DO AMAZONAS", "E"],
  ["00697295000105", "SECRETARIA DE ESTADO DA SAUDE - SUSAM", "E"], ["04312369000190", "ESTADO DO AMAZONAS", "E"],
  ["06636765000107", "SAO PEDRO DO PIAUI PREFEITURA", "M"], ["01671187000118", "TRIBUNAL REGIONAL DO TRABALHO DA 11 REGIAO", "F"],
  ["00394429000100", "COMANDO DA AERONAUTICA", "F"], ["00394429000291", "COMANDO DA AERONAUTICA", "F"],
  ["00394502000144", "COMANDO DA MARINHA", "F"], ["02228364000159", "CONSORCIO INTERMUNICIPAL DE SAUDE DA REGIAO ALTO TAPAJOS", "N"],
].map(([cnpj, nome, esfera]) => ({ cnpj, nome, esfera, poder: "E" }));

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
  await db.exec(sql);
  await db.exec(sql);
  await db.query("select public.carregar_cadastro_orgaos($1::jsonb)", [JSON.stringify(CADASTRO)]);
  // Dados coletados: Manaus e SUSAM no AM (UASG, unidade), Marinha com ata, uma licitação já encerrada do TJAM.
  await db.exec(`
    insert into oportunidades_abertas values
      ('a', '04365326000173-1-000010/2026', 'Limpeza', 'AM', '2026-11-20', '2099-01-10', '{"orgao":"MUNICIPIO DE MANAUS","municipio":"Manaus","codigoUnidade":"927001","esferaId":"M"}'),
      ('b', '04812509000190-1-000009/2026', 'Encerrada', 'AM', '2026-10-01', '2026-10-15', '{"orgao":"AMAZONAS TRIBUNAL DE JUSTICA","municipio":"Manaus"}');
    insert into contratos values ('04365326000173-2-000001/2026', 'C1', 'AM', '2026-03-01', '{}'), ('99999999000191-2-000001/2026', 'Fora do cadastro', 'PA', '2026-04-01', '{}');
    insert into mercado_atas values ('00394502000144-1-003018/2025-000001', 'Cesta básica', 'AM', 'Manaus', '2025-09-19', '2027-09-20', false, '{}');
    insert into prospeccao_itens values ('p1', 'ata', 'AM', '00697295000105', 'SECRETARIA DE ESTADO DA SAUDE - SUSAM', '925001', 'SECRETARIA DE ESTADO DE SAUDE DO AMAZONAS', 'Manaus', '2026-10-01');`);
  await db.query("select public.atualizar_orgaos_catalogo()");
  return db;
}
const como = async (db, uid) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || ""]);
  await db.exec("set role authenticated");
};
const buscar = async (db, termo, uf = null, limite = 5) => (await db.query("select * from public.buscar_orgaos($1, $2, $3)", [termo, uf, limite])).rows;
const primeiro = async (db, termo, uf) => (await buscar(db, termo, uf))[0]?.cnpj;

test("orgaos_catalogo.sql: normalização, nome canônico, siglas e sinônimos", async () => {
  const db = await banco();
  try {
    const um = async (q, ...p) => Object.values((await db.query(q, p)).rows[0])[0];
    assert.equal(await um("select orgao_normalizar($1)", "  Município de Apuí – AM! "), "municipio de apui am");
    for (const nome of ["Prefeitura Municipal de Apuí", "MUNICIPIO DE APUI", "prefeitura de apui", "Município de Apuí"])
      assert.equal(await um("select orgao_chave_nome($1)", nome), "municipio apui", nome);
    assert.equal(await um("select orgao_chave_nome($1)", "SAO PEDRO DO PIAUI PREFEITURA"), "municipio sao pedro piaui", "formato do cadastro do PNCP");
    assert.equal(await um("select orgao_chave_nome($1)", "Governo do Estado do Amazonas"), "estado amazonas");
    assert.equal(await um("select orgao_chave_nome($1)", "Governo do Amazonas"), "estado amazonas");
    assert.equal(await um("select orgao_siglas(orgao_normalizar($1))", "TRIBUNAL DE JUSTICA DO ESTADO DO AMAZONAS"), "tjam tjea");
    assert.match(await um("select orgao_siglas(orgao_normalizar($1))", "UNIVERSIDADE FEDERAL DO OESTE DO PARA"), /^ufopa\b/);
    assert.match(await um("select orgao_siglas(orgao_normalizar($1))", "UNIVERSIDADE DO ESTADO DO AMAZONAS"), /\buea\b/);
    assert.match(await um("select orgao_siglas(orgao_normalizar($1))", "TRIBUNAL REGIONAL DO TRABALHO DA 11 REGIAO"), /^trt11\b/);
    assert.match(await um("select orgao_siglas(orgao_normalizar($1))", "MATO GROSSO DO SUL SECRETARIA"), /^sms\b/, "estado de várias palavras");
    assert.equal(await um("select orgao_siglas('manaus')"), "", "uma palavra não vira sigla");
    assert.deepEqual(await um("select orgao_variantes('pref')"), ["pref", "municipio"]);
    assert.deepEqual(await um("select orgao_variantes('governo')"), ["governo", "estado"]);
    assert.deepEqual(await um("select orgao_variantes('saude')"), ["saude"]);
  } finally { await db.close(); }
});

test("orgaos_catalogo.sql: recálculo junta cadastro e dados coletados; ninguém lê nem grava a tabela direto", async () => {
  const db = await banco();
  try {
    const linha = async (cnpj) => (await db.query("select * from orgaos_catalogo where cnpj = $1", [cnpj])).rows[0];
    const manaus = await linha("04365326000173");
    assert.deepEqual([manaus.uf, manaus.municipio, manaus.uasgs, manaus.abertas, manaus.contratos, manaus.esfera],
      ["AM", "Manaus", ["927001"], 1, 1, "M"]);
    assert.match(manaus.busca, / prefeitura municipal municipio /, "apelido de prefeitura no texto de busca");
    assert.equal((await linha("04812509000190")).abertas, 0, "licitação encerrada não conta como aberta");
    assert.ok((await linha("00697295000105")).busca.includes("secretaria de estado de saude do amazonas"), "nome da unidade entra na busca");
    assert.ok((await linha("04378626000197")).busca.includes(" ufam "), "apelido de orgaos_apelidos");
    assert.equal((await linha("99999999000191")).nome, null, "só nos contratos, sem nome: entra pelo CNPJ e espera o cadastro");
    // Some dos dados coletados: contagem zera (fica o cadastro); sem cadastro, sai do catálogo.
    await db.exec("delete from contratos; delete from oportunidades_abertas;");
    const r = (await db.query("select atualizar_orgaos_catalogo() r")).rows[0].r;
    assert.equal(r.removidos, 1);
    assert.equal((await linha("04365326000173")).abertas, 0);
    assert.equal((await linha("04365326000173")).nome, "MUNICIPIO DE MANAUS");
    assert.equal(await linha("99999999000191"), undefined);
    // Carga do cadastro: valida e só grava o que mudou.
    assert.equal((await db.query("select carregar_cadastro_orgaos($1::jsonb) n", [JSON.stringify(CADASTRO)])).rows[0].n, 0, "nada mudou, nada gravado");
    assert.equal((await db.query(`select carregar_cadastro_orgaos('[{"cnpj":"123","nome":"X"},{"cnpj":"11111111000191","nome":"A"},{"cnpj":"22222222000191","nome":"OK","esfera":"m"}]'::jsonb) n`)).rows[0].n, 1, "CNPJ e nome inválidos ficam fora");
    await assert.rejects(db.query("select carregar_cadastro_orgaos($1::jsonb)", [JSON.stringify(Array(2001).fill(CADASTRO[0]))]), /até 2.000/);
    await como(db, APROVADO);
    await assert.rejects(db.query("select * from orgaos_catalogo limit 1"), /permission denied/, "tabela só pelas funções");
    await assert.rejects(db.query("select carregar_cadastro_orgaos('[]'::jsonb)"), /permission denied/, "navegador não carrega cadastro");
    await assert.rejects(db.query("select atualizar_orgaos_catalogo()"), /permission denied/, "navegador não recalcula");
    await assert.rejects(db.query("select orgao_normalizar('x')"), /permission denied/, "auxiliares só por dentro");
    await assert.rejects(db.query("select orgao_chave_nome('x')"), /permission denied/);
  } finally { await db.close(); }
});

test("orgaos_catalogo.sql: buscar_orgaos tolera acento, ordem, abreviação, sigla, CNPJ, UASG e erro de digitação", async () => {
  const db = await banco();
  try {
    await como(db, PENDENTE);
    await assert.rejects(buscar(db, "manaus"), /cadastro aprovado/, "cadastro pendente não busca");
    await como(db, null);
    await assert.rejects(buscar(db, "manaus"), /cadastro aprovado/, "sem login não busca");
    await como(db, APROVADO);
    const r = await buscar(db, "Município de Apuí");
    assert.deepEqual([r[0].cnpj, r[0].exato], ["22812960000199", true], "acento e nome inteiro");
    assert.equal(await primeiro(db, "prefeitura de manaus"), "04365326000173", "prefeitura = município, matriz com dados antes");
    assert.equal((await buscar(db, "prefeitura de manaus")).filter((x) => x.nome === "MUNICIPIO DE MANAUS").length, 1, "filial sem UF do mesmo nome não repete");
    assert.equal(await primeiro(db, "pref manaus"), "04365326000173", "abreviação");
    assert.equal(await primeiro(db, "manaus municipio"), "04365326000173", "qualquer ordem");
    assert.equal(await primeiro(db, "secretaria saude amazonas"), "00697295000105", "UF e unidade dos dados coletados");
    assert.equal(await primeiro(db, "sec saude", "AM"), "00697295000105", "filtro de UF");
    assert.deepEqual(await buscar(db, "manaus", "SP"), [], "UF sem órgão");
    assert.equal(await primeiro(db, "tjam"), "04812509000190", "sigla deduzida");
    assert.equal(await primeiro(db, "ufam"), "04378626000197", "sigla de orgaos_apelidos");
    assert.equal(await primeiro(db, "ufopa"), "11118393000159");
    assert.equal(await primeiro(db, "universidade federal do para"), "34621748000123", "Pará antes de Paraná");
    assert.equal(await primeiro(db, "governo do amazonas"), "04312369000190", "governo = estado");
    assert.equal(await primeiro(db, "trt 11"), "01671187000118", "número curto casa a palavra inteira");
    assert.equal(await primeiro(db, "consorcio tapajos"), "02228364000159");
    assert.equal((await buscar(db, "comando aeronautica")).length, 1, "centenas de CNPJs com o mesmo nome viram 1 linha");
    assert.equal(await primeiro(db, "aeronautica"), "00394429000100", "matriz (0001) primeiro");
    assert.equal(await primeiro(db, "municipio de apuii"), "22812960000199", "erro de digitação: parecido");
    assert.equal(await primeiro(db, "04.312.369/0001-90"), "04312369000190", "CNPJ com máscara");
    assert.equal(await primeiro(db, "04365326"), "04365326000173", "raiz do CNPJ: matriz primeiro");
    assert.equal(await primeiro(db, "927001"), "04365326000173", "UASG");
    assert.deepEqual(await buscar(db, "a"), [], "termo curto demais");
    assert.deepEqual(await buscar(db, "de da do"), [], "só palavras vazias");
    assert.deepEqual(await buscar(db, "x' or 1=1 --"), [], "aspas viram espaço: nada injeta");
    assert.deepEqual(await buscar(db, "%%%"), [], "curinga não lista tudo");
    assert.equal((await buscar(db, "municipio", null, 500)).length <= 20, true, "limite máximo 20");
    // Inativo no cadastro do PNCP (statusAtivo=false): sai da busca.
    await db.exec("reset role");
    await db.query(`select carregar_cadastro_orgaos('[{"cnpj":"01671187000118","nome":"TRIBUNAL REGIONAL DO TRABALHO DA 11 REGIAO","esfera":"F","ativo":false}]'::jsonb)`);
    await como(db, APROVADO);
    assert.equal(await primeiro(db, "trt 11"), undefined, "inativo não aparece");
    assert.equal(await primeiro(db, "tribunal trabalho regiao 11"), undefined, "nem pelo parecido");
  } finally { await db.close(); }
});
