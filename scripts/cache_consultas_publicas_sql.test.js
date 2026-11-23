const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

// PGlite em memória roda o SQL de verdade (2 vezes: tem de ser idempotente) e o teste testar_*.sql por cima.
// Não prova o PostgREST nem o banco remoto; prova RLS, grants, checks e as funções.
test("cache_consultas_publicas.sql: idempotente; aprovado lê o cache, ninguém além do serviço grava ou vê as buscas", async () => {
  const db = new PGlite();
  const sql = (nome) => fs.readFileSync(path.join(__dirname, "..", "supabase", nome), "utf8");
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.clientes(id uuid primary key, nome text, email text, status text);
      grant usage on schema auth, public to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      create or replace function public.cliente_aprovado() returns boolean
        language sql stable security definer set search_path = '' as $$
        select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado') $$;
      revoke all on function public.cliente_aprovado() from public, anon;
      grant execute on function public.cliente_aprovado() to authenticated, service_role;`);
    await db.exec(sql("cache_consultas_publicas.sql"));
    await db.exec(sql("cache_consultas_publicas.sql"));
    await db.exec(sql("testar_cache_consultas_publicas.sql"));
    const sobrou = await db.query("select count(*)::int as n from public.cache_consultas_publicas");
    assert.equal(sobrou.rows[0].n, 0, "o teste SQL termina em rollback");
  } finally {
    await db.close();
  }
});
