-- LicitaPlena — Pastas dos documentos da empresa e documentos escolhidos no processo (card do funil/processo).
-- Seguro rodar mais de uma vez (idempotente). Rodar no SQL Editor do Supabase, DEPOIS de seguranca_aprovacao_20261119.sql.
--
-- operacao_documento_pastas: em que pasta (texto livre, ex.: "Habilitação jurídica", "Fiscal") fica cada documento de
--   operacao_documentos. Tabela à parte de propósito: mudar a pasta NÃO é "alterar o documento" (um update em
--   operacao_documentos dispara invalidar_identificacao_empresa e derrubaria a identificação confirmada).
-- operacao_processo_documentos: documentos já salvos que a pessoa escolheu para um processo (sem novo upload).
-- Nas duas, organização e empresa vêm do próprio documento (trigger); o processo precisa ser da mesma empresa.
-- RLS: mesma regra dos documentos (pode_acessar_empresa_operacao). anon não lê nem grava.
-- Teste: testar_documentos_pastas.sql.
begin;
do $$ begin
  if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null then
    raise exception 'Aplique antes seguranca_aprovacao_20261119.sql';
  end if;
end $$;

create table if not exists public.operacao_documento_pastas (
  documento_id uuid primary key references public.operacao_documentos(id) on delete cascade,
  organizacao_id uuid not null,
  empresa_id uuid not null,
  pasta text not null check (length(btrim(pasta)) between 1 and 60 and pasta !~ '[/\\<>]'),
  atualizado_em timestamptz not null default now()
);
create index if not exists operacao_documento_pastas_empresa_idx on public.operacao_documento_pastas (empresa_id);

create table if not exists public.operacao_processo_documentos (
  processo_id uuid not null references public.operacao_processos(id) on delete cascade,
  documento_id uuid not null references public.operacao_documentos(id) on delete cascade,
  organizacao_id uuid not null,
  empresa_id uuid not null,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  primary key (processo_id, documento_id)
);
create index if not exists operacao_processo_documentos_documento_idx on public.operacao_processo_documentos (documento_id);

-- security invoker: o documento é lido com a RLS de quem grava; documento que a pessoa não vê não entra.
create or replace function public.operacao_documento_vinculo_coerente() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_org uuid; v_emp uuid;
begin
  select d.organizacao_id, d.empresa_id into v_org, v_emp from public.operacao_documentos d where d.id = new.documento_id;
  if v_org is null then raise exception 'Documento indisponível.' using errcode = 'check_violation'; end if;
  new.organizacao_id := v_org;
  new.empresa_id := v_emp;
  if TG_TABLE_NAME = 'operacao_processo_documentos' then
    if not exists (select 1 from public.operacao_processos p where p.id = new.processo_id and p.empresa_id = v_emp and p.organizacao_id = v_org) then
      raise exception 'O documento é de outra empresa, não deste processo.' using errcode = 'check_violation';
    end if;
  else
    new.pasta := btrim(new.pasta);
    new.atualizado_em := now();
  end if;
  return new;
end $$;
revoke all on function public.operacao_documento_vinculo_coerente() from public, anon;

drop trigger if exists operacao_documento_pastas_coerente on public.operacao_documento_pastas;
create trigger operacao_documento_pastas_coerente before insert or update on public.operacao_documento_pastas
  for each row execute function public.operacao_documento_vinculo_coerente();
drop trigger if exists operacao_processo_documentos_coerente on public.operacao_processo_documentos;
create trigger operacao_processo_documentos_coerente before insert or update on public.operacao_processo_documentos
  for each row execute function public.operacao_documento_vinculo_coerente();

alter table public.operacao_documento_pastas enable row level security;
alter table public.operacao_processo_documentos enable row level security;
revoke all on public.operacao_documento_pastas, public.operacao_processo_documentos from anon;
grant select, insert, update, delete on public.operacao_documento_pastas, public.operacao_processo_documentos to authenticated;

drop policy if exists operacao_documento_pastas_da_empresa on public.operacao_documento_pastas;
create policy operacao_documento_pastas_da_empresa on public.operacao_documento_pastas
  for all to authenticated using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_processo_documentos_da_empresa on public.operacao_processo_documentos;
create policy operacao_processo_documentos_da_empresa on public.operacao_processo_documentos
  for all to authenticated using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));

commit;
