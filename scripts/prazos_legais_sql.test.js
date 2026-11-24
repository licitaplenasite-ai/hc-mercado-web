const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const JuridicoPrazos = require("../juridico-prazos.js");

// PGlite em memória roda supabase/prazos_legais.sql de verdade (2 vezes: tem de ser idempotente) sobre tabelas mínimas.
// Não prova RLS (o gatilho é security definer e só usa a linha que o próprio usuário gravou).
const ORG = "a0000000-0000-4000-8000-000000000001";
const P1 = "a0000000-0000-4000-8000-000000000011";
const MARCA = "calculado pela regra legal; confira o edital";

const SQL = fs.readFileSync(path.join(__dirname, "..", "supabase", "prazos_legais.sql"), "utf8");
// antes(db): roda depois das tabelas e antes do SQL (para provar o acerto único de quem já existia).
async function banco(antes) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.operacao_processos(id uuid primary key, organizacao_id uuid not null, status text not null default 'triagem', data_sessao timestamptz);
    create table public.operacao_prazos_processo(id uuid primary key default gen_random_uuid(), organizacao_id uuid not null,
      processo_id uuid not null references public.operacao_processos(id) on delete cascade, categoria text not null, titulo text not null,
      vencimento timestamptz not null, responsavel text, concluido_em timestamptz, observacoes text, criado_em timestamptz not null default now());`);
  if (antes) await antes(db);
  await db.exec(SQL);
  await db.exec(SQL);
  return db;
}
const prazos = async (db) => (await db.query(`select categoria, to_char(vencimento at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') as dia,
  concluido_em is not null as fechado, observacoes from public.operacao_prazos_processo where processo_id = $1 order by categoria`, [P1])).rows;

test("prazos_legais.sql: 3 dias úteis antes da sessão é igual ao juridico-prazos.js em todos os dias de 2026 a 2028", async () => {
  const db = await banco();
  try {
    const r = await db.query(`select to_char(d, 'YYYY-MM-DD') as dia, to_char(public.dias_uteis_antes(d::date, 3), 'YYYY-MM-DD') as ultimo
      from generate_series(date '2026-01-01', date '2028-12-31', interval '1 day') d`);
    const diferentes = r.rows.filter((x) => x.ultimo !== JuridicoPrazos.somarDiasUteis(x.dia, -3, { semPontoFacultativo: true }));
    assert.equal(r.rows.length, 1096);
    assert.deepEqual(diferentes, []);
  } finally { await db.close(); }
});

test("prazos_legais.sql: feriado, fim de semana, Carnaval e virada de ano no cálculo do banco", async () => {
  const db = await banco();
  try {
    const casos = {
      "2026-11-23": "2026-11-17", // segunda; 20/11 (Consciência Negra) é feriado: o antigo dava 18/11, um dia DEPOIS
      "2026-12-14": "2026-12-09", // segunda: pula sábado e domingo
      "2027-01-04": "2026-12-29", // virada de ano: 01/01 é feriado
      "2026-02-19": "2026-02-12", // quinta depois do Carnaval: 16 e 17/02 não contam (lado seguro); conta 18, 13 e 12
      "2026-04-06": "2026-03-31", // segunda depois da Páscoa: Sexta-feira Santa (03/04) não conta
    };
    for (const [sessao, esperado] of Object.entries(casos)) {
      const r = await db.query("select to_char(public.dias_uteis_antes($1::date, 3), 'YYYY-MM-DD') as d", [sessao]);
      assert.equal(r.rows[0].d, esperado, sessao);
    }
  } finally { await db.close(); }
});

test("prazos_legais.sql: cria, recalcula quando a sessão muda, respeita a correção manual e fecha quando a sessão some", async () => {
  const db = await banco();
  try {
    await db.query("insert into public.operacao_processos(id, organizacao_id, data_sessao) values ($1, $2, '2099-12-14 09:00-03')", [P1, ORG]);
    assert.deepEqual((await prazos(db)).map((p) => [p.categoria, p.dia, p.fechado]),
      [["esclarecimento", "2099-12-09 23:59", false], ["impugnacao", "2099-12-09 23:59", false]]);

    // Pessoa corrigiu a impugnação pelo edital (a tela troca a marca); a próxima mudança de sessão não mexe nela.
    await db.query(`update public.operacao_prazos_processo set vencimento = '2099-12-01 18:00-03', observacoes = 'Data corrigida pelo edital'
      where processo_id = $1 and categoria = 'impugnacao'`, [P1]);
    await db.query("update public.operacao_processos set data_sessao = '2099-12-21 09:00-03' where id = $1", [P1]);
    assert.deepEqual((await prazos(db)).map((p) => [p.categoria, p.dia]),
      [["esclarecimento", "2099-12-16 23:59"], ["impugnacao", "2099-12-01 18:00"]]);

    // Trocar o status várias vezes não duplica.
    await db.query("update public.operacao_processos set status = 'preparacao' where id = $1", [P1]);
    await db.query("update public.operacao_processos set status = 'proposta' where id = $1", [P1]);
    assert.equal((await prazos(db)).length, 2);

    await db.query("update public.operacao_processos set data_sessao = null where id = $1", [P1]);
    const fim = await prazos(db);
    assert.deepEqual(fim.map((p) => [p.categoria, p.fechado]), [["esclarecimento", true], ["impugnacao", false]]);
    assert.equal(fim[0].observacoes, "Sessão removida do cadastro do processo");

    // Sessão marcada de novo: o automático fechado volta, sem duplicar.
    await db.query("update public.operacao_processos set data_sessao = '2099-12-28 09:00-03' where id = $1", [P1]);
    assert.deepEqual((await prazos(db)).map((p) => [p.categoria, p.dia, p.fechado]),
      [["esclarecimento", "2099-12-22 23:59", false], ["impugnacao", "2099-12-01 18:00", false]]);
  } finally { await db.close(); }
});

test("prazos_legais.sql: processo arquivado não ganha prazo; sessão cujo prazo já passou não cria linha atrasada", async () => {
  const db = await banco();
  try {
    await db.query("insert into public.operacao_processos(id, organizacao_id, status, data_sessao) values ($1, $2, 'arquivado', '2099-12-14 09:00-03')", [P1, ORG]);
    assert.equal((await prazos(db)).length, 0);
    await db.query("update public.operacao_processos set status = 'triagem', data_sessao = '2001-01-10 09:00-03' where id = $1", [P1]);
    assert.equal((await prazos(db)).length, 0);
    await db.query("update public.operacao_processos set data_sessao = '2099-12-14 09:00-03' where id = $1", [P1]);
    assert.equal((await prazos(db)).filter((p) => p.observacoes === MARCA).length, 2, "arquivado que volta ao Funil passa a ter prazo");
  } finally { await db.close(); }
});

test("prazos_legais.sql: perdido/contratado/arquivado fecha os automáticos abertos; voltar ao Funil reabre", async () => {
  const db = await banco();
  try {
    await db.query("insert into public.operacao_processos(id, organizacao_id, data_sessao) values ($1, $2, '2099-12-14 09:00-03')", [P1, ORG]);
    await db.query("update public.operacao_processos set status = 'perdido' where id = $1", [P1]);
    const fechados = await prazos(db);
    assert.deepEqual(fechados.map((p) => [p.categoria, p.fechado, p.observacoes]), [
      ["esclarecimento", true, "Processo encerrado (perdido, contratado ou arquivado)"],
      ["impugnacao", true, "Processo encerrado (perdido, contratado ou arquivado)"]]);
    await db.query("update public.operacao_processos set status = 'triagem' where id = $1", [P1]);
    assert.deepEqual((await prazos(db)).map((p) => [p.categoria, p.dia, p.fechado]),
      [["esclarecimento", "2099-12-09 23:59", false], ["impugnacao", "2099-12-09 23:59", false]]);
  } finally { await db.close(); }
});

test("prazos_legais.sql: acerto único recalcula o automático antigo (sem feriado) e cria o que falta; corrigido à mão fica", async () => {
  const P2 = "a0000000-0000-4000-8000-000000000012";
  const db = await banco(async (d) => {
    await d.query(`insert into public.operacao_processos(id, organizacao_id, data_sessao) values ($1, $3, '2099-11-23 09:00-03'), ($2, $3, '2099-12-14 09:00-03')`, [P1, P2, ORG]);
    // Data antiga errada (sem feriado) na impugnação; esclarecimento corrigido à mão pela pessoa.
    await d.query(`insert into public.operacao_prazos_processo(organizacao_id, processo_id, categoria, titulo, vencimento, observacoes) values
      ($1, $2, 'impugnacao', 'Impugnação', '2099-11-01 23:59-03', $3), ($1, $2, 'esclarecimento', 'Esclarecimento', '2099-11-10 18:00-03', 'Data corrigida pela equipe')`, [ORG, P1, MARCA]);
  });
  try {
    const esperado = (await db.query("select to_char(public.dias_uteis_antes(date '2099-11-23', 3), 'YYYY-MM-DD') || ' 23:59' as d")).rows[0].d;
    assert.deepEqual((await prazos(db)).map((p) => [p.categoria, p.dia]), [["esclarecimento", "2099-11-10 18:00"], ["impugnacao", esperado]]);
    const p2 = (await db.query("select count(*)::int as n from public.operacao_prazos_processo where processo_id = $1", [P2])).rows[0].n;
    assert.equal(p2, 2, "processo que não tinha prazo ganhou os dois");
  } finally { await db.close(); }
});

test("prazos_legais.sql: funções fechadas para anon e usuário logado; N de dias úteis limitado a 0..30", async () => {
  const db = await banco();
  try {
    for (const f of ["public.pascoa_ano(int)", "public.dia_util_licitacao(date)", "public.dias_uteis_antes(date,int)", "public.recalcular_prazos_legais(uuid)"]) {
      for (const papel of ["anon", "authenticated"]) {
        const r = await db.query("select has_function_privilege($1, $2, 'execute') as pode", [papel, f]);
        assert.equal(r.rows[0].pode, false, `${papel} executa ${f}`);
      }
    }
    await assert.rejects(db.query("select public.dias_uteis_antes(date '2026-01-01', 31)"), /fora de 0 a 30/);
    await assert.rejects(db.query("select public.dias_uteis_antes(date '2026-01-01', -1)"), /fora de 0 a 30/);
  } finally { await db.close(); }
});
