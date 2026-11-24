const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { pg_trgm } = require("@electric-sql/pglite/contrib/pg_trgm");
const { unaccent } = require("@electric-sql/pglite/contrib/unaccent");

// PGlite em memória roda supabase/crm_orgao_linha_tempo.sql de verdade (2 vezes: tem de ser idempotente) sobre os SQL reais
// da operação (mesma base do ponte_leitura_sql.test.js). Prova o gatilho do histórico de etapas, a RLS das duas tabelas
// novas (inclusive entre organizações) e a ficha_orgao. As tabelas do robô (oportunidades/contratos/atas) são esboços.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sql = (nome) => fs.readFileSync(path.join(__dirname, "..", "supabase", nome), "utf8");
const CNPJ = "12345678000190";

async function banco() {
  const db = new PGlite({ extensions: { pg_trgm, unaccent } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1, '/')$$;
    create table public.clientes(id uuid primary key, status text, nome text, empresa text, cnpj text);
    create table public.admins(email text, role text);
    grant usage on schema auth, storage, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;`);
  for (const f of ["operacao_licitacoes.sql", "operacao_acompanhamento.sql", "limite_cnpjs_operacao.sql", "acesso_empresa_convites.sql",
    "identificacao_empresa.sql", "seguranca_operacao.sql", "operacao_funil_etapas.sql"]) await db.exec(sql(f));
  // Mesmo corpo de seguranca_aprovacao_20261119.sql; as tabelas do robô seguem schema_oportunidades/schema_dados_mercado.
  await db.exec(`create or replace function public.cliente_aprovado() returns boolean language sql stable security definer set search_path = '' as $$
      select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado') $$;
    grant execute on function public.cliente_aprovado() to authenticated;
    create table public.oportunidades_abertas(chave text primary key, numero_controle_pncp text, objeto text not null default '', uf text,
      publicacao date, encerramento date, dado jsonb not null);
    create table public.contratos(numero_controle_pncp text primary key, objeto text not null default '', uf text, data_assinatura date, dado jsonb not null);
    create table public.mercado_atas(numero_controle_pncp_ata text primary key, objeto text not null default '', uf_orgao text, municipio_orgao text, data_assinatura date,
      vigencia_fim date, cancelado boolean not null default false, dado jsonb not null);
    alter table public.oportunidades_abertas enable row level security; alter table public.contratos enable row level security;
    alter table public.mercado_atas enable row level security;
    create table public.prospeccao_itens(id text primary key, tipo text, uf text, orgao_cnpj text, orgao_nome text, unidade_codigo text,
      unidade_nome text, municipio text, data_inicio date);
    -- Como no Supabase: authenticated tem privilégio de tabela; quem filtra é a RLS.
    grant select, insert, update, delete on all tables in schema public to authenticated;`);
  for (const n of [101, 102, 103, 104]) {
    await db.query("insert into auth.users values($1, $2)", [id(n), `f${n}@example.invalid`]);
    await db.query("insert into clientes(id, status) values($1, $2)", [id(n), n === 104 ? "pendente" : "aprovado"]);
  }
  await db.query("insert into operacao_organizacoes(id, nome, owner_id) values($1, 'Org A', $3), ($2, 'Org B', $4)", [id(1), id(2), id(101), id(103)]);
  await db.query("insert into operacao_empresas(id, organizacao_id, razao_social, cnpj) values($1, $3, 'A', '11222333000181'), ($2, $4, 'B', '11222333000343')", [id(11), id(13), id(1), id(2)]);
  await db.query(`insert into operacao_membros(organizacao_id, usuario_id, papel, empresa_id) values
    ($1, $3, 'gestor', null), ($1, $4, 'leitura', null), ($2, $5, 'gestor', null), ($1, $6, 'gestor', null)`, [id(1), id(2), id(101), id(102), id(103), id(104)]);
  await db.query("insert into operacao_funil_etapas(id, organizacao_id, nome, ordem, status_sistema) values($1, $2, 'Montando proposta', 5, 'preparacao')", [id(61), id(1)]);
  // Processo de antes do SQL: o passado dele não é inventado.
  await db.query("insert into operacao_processos(id, organizacao_id, empresa_id, objeto) values($1, $2, $3, 'Antigo')", [id(20), id(1), id(11)]);
  await db.exec(sql("orgaos_catalogo.sql"));
  await db.exec(sql("crm_orgao_linha_tempo.sql"));
  await db.exec(sql("crm_orgao_linha_tempo.sql"));
  return db;
}
const como = async (db, uid) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || ""]);
  await db.exec("set role authenticated");
};
const historico = async (db, proc) => (await db.query(
  "select status_anterior, status_novo, etapa_nome, mudou_por from operacao_processos_etapas_historico where processo_id = $1 order by id", [proc])).rows;

test("crm_orgao_linha_tempo.sql: histórico de etapas por gatilho, só leitura e isolado por organização", async () => {
  const db = await banco();
  try {
    assert.deepEqual(await historico(db, id(20)), [], "processo antigo não ganha histórico inventado");
    await como(db, id(101));
    await db.query("insert into operacao_processos(id, organizacao_id, empresa_id, objeto) values($1, $2, $3, 'Novo')", [id(21), id(1), id(11)]);
    await db.query("update operacao_processos set observacoes = 'nota' where id = $1", [id(21)]);
    await db.query("update operacao_processos set status = 'preparacao', etapa_id = $2 where id = $1", [id(21), id(61)]);
    await db.query("update operacao_processos set status = 'preparacao' where id = $1", [id(21)]);
    await db.query("update operacao_processos set status = 'perdido', etapa_id = null, motivo_perda = 'Preço' where id = $1", [id(21)]);
    const h = await historico(db, id(21));
    assert.deepEqual(h.map((r) => [r.status_anterior, r.status_novo, r.etapa_nome]),
      [[null, "triagem", null], ["triagem", "preparacao", "Montando proposta"], ["preparacao", "perdido", null]],
      "criação + 2 mudanças; editar outro campo ou gravar o mesmo estágio não conta");
    assert.equal(h[1].mudou_por, id(101), "guarda quem mudou");
    await assert.rejects(db.query("insert into operacao_processos_etapas_historico(organizacao_id, processo_id, status_novo) values($1, $2, 'homologado')", [id(1), id(21)]),
      /permission denied/, "o navegador não escreve histórico");
    await assert.rejects(db.query("update operacao_processos_etapas_historico set status_novo = 'homologado'"), /permission denied/);
    await como(db, id(103));
    assert.equal((await db.query("select count(*)::int n from operacao_processos_etapas_historico")).rows[0].n, 0, "outra organização não vê");
  } finally { await db.close(); }
});

test("crm_orgao_linha_tempo.sql: contatos e anotações do órgão privados da organização, sem CPF", async () => {
  const db = await banco();
  try {
    const inserir = (r) => db.query(`insert into operacao_orgaos_registros(organizacao_id, orgao_chave, orgao_nome, tipo, nome, papel, telefone, email, texto)
      values($1, $2, 'Prefeitura Fictícia', $3, $4, $5, $6, $7, $8)`, [r.org || id(1), r.chave || `cnpj:${CNPJ}`, r.tipo, r.nome || null, r.papel || null, r.telefone || null, r.email || null, r.texto || null]);
    await como(db, id(101));
    await inserir({ tipo: "contato", nome: "Maria Pregoeira", papel: "Pregoeira", telefone: "(92) 3333-4444", email: "maria@orgao.example.invalid" });
    await inserir({ tipo: "anotacao", texto: "Prefere amostra antes da sessão." });
    await inserir({ tipo: "acompanhar", chave: "nome:prefeitura de exemplo" });
    await assert.rejects(inserir({ tipo: "acompanhar", chave: "nome:prefeitura de exemplo" }), /duplicate key/, "acompanhar uma vez só");
    await assert.rejects(inserir({ tipo: "contato" }), /tipo_coerente/, "contato sem nome");
    await assert.rejects(inserir({ tipo: "anotacao", texto: "CPF 123.456.789-09 do fiscal" }), /sem_cpf/, "CPF não é guardado");
    await assert.rejects(inserir({ tipo: "contato", nome: "Ana", papel: "Fiscal 123.456.789-09" }), /sem_cpf/, "CPF na função");
    await assert.rejects(inserir({ tipo: "contato", nome: "Ana", telefone: "123.456.789-09" }), /sem_cpf/, "CPF no telefone");
    await inserir({ tipo: "contato", nome: "Bia", telefone: "92999998888" });
    await db.query("delete from operacao_orgaos_registros where nome = 'Bia'");
    await assert.rejects(inserir({ tipo: "anotacao", texto: "x", chave: "cnpj:123" }), /orgao_chave/, "chave inválida");
    await assert.rejects(inserir({ tipo: "contato", nome: "Ana", email: "sem-arroba" }), /email/);
    await assert.rejects(inserir({ tipo: "anotacao", texto: "outra org", org: id(2) }), /row-level security/, "não grava em outra organização");
    await como(db, id(102));
    assert.equal((await db.query("select count(*)::int n from operacao_orgaos_registros")).rows[0].n, 3, "papel leitura lê");
    await assert.rejects(inserir({ tipo: "anotacao", texto: "leitura tenta gravar" }), /row-level security/, "papel leitura não grava");
    await como(db, id(103));
    assert.equal((await db.query("select count(*)::int n from operacao_orgaos_registros")).rows[0].n, 0, "outra organização não vê");
    assert.equal((await db.query("delete from operacao_orgaos_registros returning id")).rows.length, 0, "nem apaga");
  } finally { await db.close(); }
});

test("crm_orgao_linha_tempo.sql: ficha_orgao junta abertas, contratos e atas pelo CNPJ ou pelo nome", async () => {
  const db = await banco();
  try {
    await db.query(`insert into oportunidades_abertas(chave, numero_controle_pncp, objeto, uf, publicacao, encerramento, dado) values
      ('a', '${CNPJ}-1-000010/2026', 'Material de limpeza', 'AM', '2026-11-20', '2099-01-10', '{"orgao":"PREFEITURA FICTICIA","municipio":"Manaus","codigoUnidade":"925001","valorTotalEstimado":1500.5}'),
      ('b', '${CNPJ}-1-000009/2026', 'Já encerrada', 'AM', '2026-10-01', '2026-10-15', '{"orgao":"PREFEITURA FICTICIA"}'),
      ('c', '99999999000199-1-000001/2026', 'Outro órgão', 'SP', '2026-11-20', '2099-01-10', '{"orgao":"OUTRO"}')`);
    await db.query(`insert into contratos(numero_controle_pncp, objeto, uf, data_assinatura, dado) values
      ('${CNPJ}-2-000001/2026', 'Contrato 1', 'AM', '2026-03-01', '{"orgao":"PREFEITURA FICTICIA","nomeFornecedor":"Fornecedora X","valor":1000}'),
      ('${CNPJ}-2-000002/2026', 'Contrato 2', 'AM', '2026-05-01', '{"orgao":"PREFEITURA FICTICIA","nomeFornecedor":"Fornecedora X","valor":"texto"}'),
      ('${CNPJ}-2-000003/2026', 'Contrato 3', 'AM', '2026-06-01', '{"orgao":"PREFEITURA FICTICIA","nomeFornecedor":"Fornecedora Y","valor":250}')`);
    await db.query(`insert into mercado_atas(numero_controle_pncp_ata, objeto, data_assinatura, vigencia_fim, dado) values
      ('${CNPJ}-1-000005/2025-000001', 'Ata de café', '2025-12-01', '2026-12-01', '{}')`);
    const ficha = async (cnpj, nome) => (await db.query("select ficha_orgao($1, $2) as f", [cnpj, nome])).rows[0].f;
    await como(db, id(104));
    await assert.rejects(ficha(CNPJ), /cadastro aprovado/, "cadastro pendente não usa");
    await como(db, null);
    await assert.rejects(ficha(CNPJ), /cadastro aprovado/, "sem login não usa");
    await como(db, id(103));
    const f = await ficha("12.345.678/0001-90");
    assert.equal(f.cnpj, CNPJ);
    assert.equal(f.dados.nome, "PREFEITURA FICTICIA");
    assert.deepEqual(f.uasgs, ["925001"]);
    assert.deepEqual(f.abertas.map((a) => a.objeto), ["Material de limpeza"], "só as abertas deste órgão");
    assert.equal(Number(f.abertas[0].valor), 1500.5);
    assert.equal(f.contratos_resumo.quantidade, 3);
    assert.equal(Number(f.contratos_resumo.valor), 1250, "valor que não é número fica fora da soma");
    assert.deepEqual(f.contratos.map((c) => c.objeto), ["Contrato 3", "Contrato 2", "Contrato 1"]);
    assert.deepEqual(f.fornecedores.map((x) => [x.nome, x.contratos, Number(x.valor)]), [["Fornecedora X", 2, 1000], ["Fornecedora Y", 1, 250]]);
    assert.equal(f.atas.length, 1);
    assert.equal((await ficha(null, "  Prefeitura Ficticia ")).cnpj, CNPJ, "acha pelo nome quando o processo não tem CNPJ");
    assert.deepEqual(await ficha(null, "Órgão que não existe"), { encontrado: false, cnpj: null });
    // Catálogo (orgaos_catalogo.sql): nome canônico sem acento, prefeitura = município; órgão só do cadastro do PNCP.
    await db.exec("reset role");
    await db.query(`select carregar_cadastro_orgaos('[{"cnpj":"22812960000199","nome":"MUNICIPIO DE APUI","esfera":"M","poder":"E"}]'::jsonb)`);
    await db.query("insert into contratos(numero_controle_pncp, objeto, uf, data_assinatura, dado) values ('22812960000199-2-000001/2026', 'Contrato Apuí', 'AM', '2026-03-01', '{}')");
    await db.query("select atualizar_orgaos_catalogo()");
    await como(db, id(103));
    assert.equal((await ficha(null, "Prefeitura Municipal de Apuí")).cnpj, "22812960000199", "acha pelo nome canônico do catálogo");
    const soCatalogo = await ficha("22812960000199");
    assert.deepEqual([soCatalogo.dados.nome, soCatalogo.dados.uf, soCatalogo.esfera], ["MUNICIPIO DE APUI", "AM", "M"], "sem licitação aberta, o nome vem do catálogo");
    assert.equal(f.esfera, null, "órgão fora do catálogo: esfera vazia");
    await assert.rejects(ficha("123"), /CNPJ do órgão inválido/);
    await assert.rejects(ficha(null, "ab"), /Informe o CNPJ ou o nome/);
    // LGPD: fornecedor com CPF (11 dígitos) aparece como "Pessoa física", na lista e no ranking.
    await db.exec("reset role");
    await db.query(`insert into contratos(numero_controle_pncp, objeto, uf, data_assinatura, dado) values
      ('${CNPJ}-2-000009/2026', 'Contrato PF', 'AM', '2026-09-01', '{"nomeFornecedor":"Fulano de Tal","cnpjFornecedor":"123.456.789-09","valor":5000}')`);
    await como(db, id(103));
    const pf = await ficha(CNPJ);
    assert.equal(pf.contratos[0].fornecedor, "Pessoa física");
    assert.ok(!JSON.stringify(pf).includes("Fulano"), "nome da pessoa física não sai da ficha");
  } finally { await db.close(); }
});
