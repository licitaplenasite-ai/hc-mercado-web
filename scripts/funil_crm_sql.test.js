const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

// PGlite em memória roda supabase/funil_crm.sql de verdade (2 vezes: tem de ser idempotente) sobre um esboço mínimo das
// tabelas do Funil. Prova o gatilho de etapa_desde e o check do limite; não prova RLS (fica a das tabelas existentes).
test("funil_crm.sql: etapa_desde só muda com a etapa; limite de dias aceita 0 a 365", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.operacao_funil_etapas (id uuid primary key default gen_random_uuid(), status_sistema text not null);
      create table public.operacao_processos (id uuid primary key default gen_random_uuid(), status text not null default 'triagem',
        etapa_id uuid, motivo_perda text, observacoes text);`);
    // Processo antigo, de antes do SQL: o relógio dele começa quando o SQL roda (não acende "Parado há 40 dias").
    await db.exec("insert into public.operacao_processos (status, observacoes) values ('triagem', 'antigo')");
    const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "funil_crm.sql"), "utf8");
    await db.exec(sql);
    const antigo = async () => (await db.query("select etapa_desde::text as d from public.operacao_processos where observacoes = 'antigo'")).rows[0].d;
    const primeira = await antigo();
    assert.notEqual(primeira, null, "processo antigo ficou sem etapa_desde");
    await db.exec(sql);
    assert.equal(await antigo(), primeira, "rodar de novo não reinicia o relógio dos antigos");
    await db.exec("delete from public.operacao_processos");
    const desde = async () => (await db.query("select etapa_desde::text as d from public.operacao_processos")).rows[0].d;

    await db.exec("insert into public.operacao_processos (status, etapa_desde) values ('triagem', '2000-01-01')");
    const inserido = await desde();
    assert.notEqual(inserido, null);
    assert.doesNotMatch(inserido, /^2000/, "a tela não escolhe a data de entrada");

    await db.exec("update public.operacao_processos set etapa_desde = '2000-01-01', observacoes = 'nota'");
    assert.equal(await desde(), inserido, "atualizar outro campo não zera nem falsifica o relógio");

    await db.exec("update public.operacao_processos set etapa_desde = null where true");
    await db.exec("update public.operacao_processos set status = 'triagem', motivo_perda = 'x'");
    assert.equal(await desde(), inserido, "mesmo status gravado de novo não conta como mudança");

    await db.exec("select pg_sleep(0.01)");
    await db.exec("begin; update public.operacao_processos set status = 'perdido'; commit;");
    assert.notEqual(await desde(), inserido, "mudar de etapa reinicia a contagem");

    await db.exec("insert into public.operacao_funil_etapas (status_sistema, limite_parado_dias) values ('triagem', 0), ('triagem', 365), ('triagem', null)");
    await assert.rejects(db.exec("insert into public.operacao_funil_etapas (status_sistema, limite_parado_dias) values ('triagem', 366)"));
    await assert.rejects(db.exec("insert into public.operacao_funil_etapas (status_sistema, limite_parado_dias) values ('triagem', -1)"));
  } finally {
    await db.close();
  }
});
