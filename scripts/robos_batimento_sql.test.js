const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { ROBOS } = require("./registrar_robo");

// Só o trecho do batimento de supabase/admin_painel.sql (o arquivo inteiro depende de dezenas de tabelas).
// 25/11: o check da coluna robo não tinha "precos": registrar_robo.js precos falhava sempre e a Saúde mostrava parado.
const SQL = fs.readFileSync(path.join(__dirname, "..", "supabase", "admin_painel.sql"), "utf8");
const inicio = SQL.indexOf("create table if not exists public.robos_batimento");
const fimMarca = "grant execute on function public.robo_registrar_sucesso(text) to service_role;";
const TRECHO = SQL.slice(inicio, SQL.indexOf(fimMarca) + fimMarca.length);

test("robos_batimento: aceita todos os robôs de registrar_robo.js (precos, fontes_extras), recusa desconhecido e troca o check antigo", async () => {
  assert.ok(inicio > 0 && TRECHO.includes("robo_registrar_sucesso"), "trecho do batimento não encontrado");
  const db = new PGlite();
  try {
    // logs_boletim: o batimento do boletim apaga o registro com mais de 30 dias.
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table public.logs_boletim (executado_em timestamptz);");
    // Banco de produção: tabela criada antes, com o check sem os robôs novos.
    await db.exec(`create table public.robos_batimento (robo text primary key check (robo in ('pncp', 'ufs', 'mercado', 'prospeccao', 'sancoes',
      'boletim', 'lembretes', 'cobranca', 'bases_obra', 'vigia_normas')), ultimo_sucesso timestamptz not null default now());`);
    await db.exec(TRECHO);
    await db.exec(TRECHO); // idempotente
    for (const robo of ROBOS) {
      const r = await db.query("select public.robo_registrar_sucesso($1) as r", [robo]);
      assert.equal(r.rows[0].r.robo, robo);
    }
    const n = await db.query("select count(*)::int as n from public.robos_batimento");
    assert.equal(n.rows[0].n, ROBOS.length);
    await assert.rejects(db.query("select public.robo_registrar_sucesso('inventado')"), /robos_batimento_robo_check/);
  } finally {
    await db.close();
  }
});
