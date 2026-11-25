const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

// PGlite em memória roda supabase/ia_perguntas_salvas.sql de verdade (2 vezes: idempotente) e prova a RLS com
// "set role authenticated" + request.jwt.claim.sub, como o Supabase faz com o token do usuário.
const A = "fb000000-0000-4000-8000-000000000001";
const B = "fb000000-0000-4000-8000-000000000002";
const SQL = fs.readFileSync(path.join(__dirname, "..", "supabase", "ia_perguntas_salvas.sql"), "utf8");

async function banco() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${A}'), ('${B}');`);
  await db.exec(SQL);
  await db.exec(SQL);
  return db;
}
async function como(db, usuario, sql, params) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${usuario}';`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role;"); }
}
const recusa = (p) => assert.rejects(p);

test("ia_perguntas_salvas.sql: cada um grava, lê e apaga só as suas; ninguém edita", async () => {
  const db = await banco();
  try {
    await como(db, A, "insert into public.ia_perguntas_salvas(texto) values ($1)", ["Qual a garantia contratual?"]);
    await como(db, B, "insert into public.ia_perguntas_salvas(texto) values ($1)", ["Exige amostra?"]);
    assert.deepEqual((await como(db, A, "select texto from public.ia_perguntas_salvas")).rows, [{ texto: "Qual a garantia contratual?" }]);
    // B não grava em nome de A nem apaga a de A.
    await recusa(como(db, B, "insert into public.ia_perguntas_salvas(usuario_id, texto) values ($1, $2)", [A, "Pergunta falsa de A"]));
    await como(db, B, "delete from public.ia_perguntas_salvas where usuario_id = $1", [A]);
    assert.equal((await db.query("select count(*)::int n from public.ia_perguntas_salvas where usuario_id = $1", [A])).rows[0].n, 1);
    await recusa(como(db, A, "update public.ia_perguntas_salvas set texto = 'mudou'"));
    await como(db, A, "delete from public.ia_perguntas_salvas");
    assert.equal((await db.query("select count(*)::int n from public.ia_perguntas_salvas")).rows[0].n, 1, "sobrou só a de B");
  } finally { await db.close(); }
});

test("ia_perguntas_salvas.sql: recusa CPF, texto curto, repetido e mais de 50 por pessoa", async () => {
  const db = await banco();
  try {
    await recusa(como(db, A, "insert into public.ia_perguntas_salvas(texto) values ($1)", ["Responsável CPF 123.456.789-09?"]));
    await recusa(como(db, A, "insert into public.ia_perguntas_salvas(texto) values ($1)", ["ab"]));
    await como(db, A, "insert into public.ia_perguntas_salvas(texto) values ($1)", ["Prazo de entrega?"]);
    await recusa(como(db, A, "insert into public.ia_perguntas_salvas(texto) values ($1)", ["Prazo de entrega?"]));
    // Mesma regra da rota: on conflict ignora a repetida em vez de dar erro.
    await como(db, A, "insert into public.ia_perguntas_salvas(texto) values ($1) on conflict (usuario_id, texto) do nothing", ["Prazo de entrega?"]);
    for (let i = 1; i < 50; i++) await como(db, A, "insert into public.ia_perguntas_salvas(texto) values ($1)", [`Pergunta ${i}`]);
    await recusa(como(db, A, "insert into public.ia_perguntas_salvas(texto) values ($1)", ["A quinquagésima primeira"]));
    await como(db, B, "insert into public.ia_perguntas_salvas(texto) values ($1)", ["B não é afetado pelo teto de A"]);
  } finally { await db.close(); }
});
