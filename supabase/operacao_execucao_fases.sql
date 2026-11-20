-- Execução do contrato em fases (Potencial → Empenhado → Entregue → Faturado → Recebido), aba "Empenhos e execução"
-- de processos.html. Guarda só o que a PESSOA lança quando a fonte oficial não trouxe: entrega, nota fiscal e recebimento.
-- Empenho manual continua em operacao_empenhos; contrato manual em operacao_contratos; o oficial em operacao_contratos_publicos.
-- A conta das fases (maior valor entre oficial e lançado, em centavos) fica em contrato-publico.js (fasesExecucao).
-- Idempotente (pode rodar mais de uma vez no SQL Editor do Supabase), transação única, não apaga dados.
-- Rodar depois do 01-aplicar.sql (que já traz operacao_acompanhamento.sql e seguranca_operacao.sql).
begin;
do $$ begin
 if to_regprocedure('public.pode_acessar_processo_operacao(uuid,uuid)') is null
  or to_regprocedure('public.pode_escrever_processo_operacao(uuid,uuid)') is null
  or to_regclass('public.operacao_processos_id_org_idx') is null then
  raise exception 'Aplique antes 01-aplicar.sql (operacao_acompanhamento.sql e seguranca_operacao.sql)';
 end if;
end $$;

create table if not exists public.operacao_execucao_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  processo_id uuid not null,
  tipo text not null check (tipo in ('entrega', 'nota', 'recebimento')),
  ocorrido_em date not null,
  valor numeric(15,2) not null check (valor > 0),
  referencia text check (length(referencia) <= 100), -- número da nota fiscal, do termo de recebimento ou do empenho
  observacoes text check (length(observacoes) <= 2000),
  criado_em timestamptz not null default now(),
  foreign key (processo_id, organizacao_id) references public.operacao_processos(id, organizacao_id) on delete cascade
);
create index if not exists operacao_execucao_eventos_processo_idx on public.operacao_execucao_eventos (processo_id, ocorrido_em);

-- Mesma regra das outras tabelas do processo (seguranca_operacao.sql): lê quem acessa a empresa; escreve gestor/operador.
alter table public.operacao_execucao_eventos enable row level security;
revoke all on public.operacao_execucao_eventos from public, anon;
grant select, insert, update, delete on public.operacao_execucao_eventos to authenticated;
grant all on public.operacao_execucao_eventos to service_role;
drop policy if exists operacao_execucao_eventos_da_empresa on public.operacao_execucao_eventos;
drop policy if exists operacao_execucao_eventos_da_empresa_escrita on public.operacao_execucao_eventos;
create policy operacao_execucao_eventos_da_empresa on public.operacao_execucao_eventos for select to authenticated
  using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_execucao_eventos_da_empresa_escrita on public.operacao_execucao_eventos for all to authenticated
  using (public.pode_escrever_processo_operacao(organizacao_id, processo_id))
  with check (public.pode_escrever_processo_operacao(organizacao_id, processo_id));

notify pgrst, 'reload schema';
commit;
