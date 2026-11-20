-- Boletim e jornais por empresa (CNPJ): cada empresa da organização tem o seu filtro do Boletim, e os
-- filtros salvos (jornais) podem pertencer a uma empresa. Aditivo e idempotente; rodar DEPOIS de
-- filtros_salvos.sql e seguranca_aprovacao_20261119.sql. Não apaga clientes.boletim_filtro: o filtro antigo
-- da conta vira o da empresa ativa no primeiro acesso ao painel (painel.html, carregarFiltroBoletimConta),
-- e o robô de e-mail continua usando o cadastro antigo para quem ainda não tem filtro por empresa.
-- Teste: testar_boletim_por_empresa.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
  if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null or to_regclass('public.filtros_salvos') is null then
    raise exception 'Aplique antes seguranca_aprovacao_20261119.sql e filtros_salvos.sql';
  end if;
end $$;

create table if not exists public.boletim_filtros_empresa (
  empresa_id uuid primary key references public.operacao_empresas(id) on delete cascade,
  organizacao_id uuid not null,
  -- Quem salvou por último recebe o e-mail do Boletim desta empresa (scripts/boletim_editais.py).
  cliente_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  filtro jsonb not null,
  atualizado_em timestamptz not null default now()
);
-- Mesmo formato de clientes.boletim_filtro (ufs + palavrasRaw obrigatórios).
alter table public.boletim_filtros_empresa drop constraint if exists boletim_filtros_empresa_filtro_valido;
alter table public.boletim_filtros_empresa add constraint boletim_filtros_empresa_filtro_valido check (
  jsonb_typeof(filtro) = 'object' and filtro ?& array['ufs', 'palavrasRaw'] and jsonb_typeof(filtro->'ufs') = 'array'
  and jsonb_typeof(filtro->'palavrasRaw') = 'string' and jsonb_array_length(filtro->'ufs') <= 27
  and length(btrim(filtro->>'palavrasRaw')) between 1 and 1000 and octet_length(filtro::text) <= 4000);
create index if not exists boletim_filtros_empresa_org_idx on public.boletim_filtros_empresa (organizacao_id);

-- A empresa precisa ser da organização informada (a policy confere o par organização + empresa).
create or replace function public.boletim_filtro_empresa_coerente() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.operacao_empresas e where e.id = new.empresa_id and e.organizacao_id = new.organizacao_id) then
    raise exception 'Empresa não pertence à organização.' using errcode = 'check_violation';
  end if;
  new.atualizado_em := now();
  new.cliente_id := coalesce(auth.uid(), new.cliente_id);
  return new;
end $$;
drop trigger if exists boletim_filtros_empresa_coerente on public.boletim_filtros_empresa;
create trigger boletim_filtros_empresa_coerente before insert or update on public.boletim_filtros_empresa
  for each row execute function public.boletim_filtro_empresa_coerente();

alter table public.boletim_filtros_empresa enable row level security;
drop policy if exists boletim_filtros_empresa_leitura on public.boletim_filtros_empresa;
create policy boletim_filtros_empresa_leitura on public.boletim_filtros_empresa for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists boletim_filtros_empresa_escrita on public.boletim_filtros_empresa;
create policy boletim_filtros_empresa_escrita on public.boletim_filtros_empresa for all to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
revoke all on public.boletim_filtros_empresa from public, anon;
grant select, insert, update, delete on public.boletim_filtros_empresa to authenticated;
grant all on public.boletim_filtros_empresa to service_role;

-- Jornais (filtros salvos) por empresa: empresa_id opcional; sem empresa = filtro da conta (vale para todas).
alter table public.filtros_salvos add column if not exists empresa_id uuid references public.operacao_empresas(id) on delete cascade;
drop index if exists public.filtros_salvos_nome_unico;
create unique index if not exists filtros_salvos_nome_empresa_unico
  on public.filtros_salvos (cliente_id, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(nome)));
drop policy if exists filtros_salvos_proprios on public.filtros_salvos;
create policy filtros_salvos_proprios on public.filtros_salvos for all to authenticated
  using (cliente_id = auth.uid() and public.cliente_aprovado())
  with check (cliente_id = auth.uid() and public.cliente_aprovado() and (empresa_id is null or exists (
    select 1 from public.operacao_empresas e where e.id = empresa_id and public.pode_acessar_empresa_operacao(e.organizacao_id, e.id))));
notify pgrst, 'reload schema';
commit;
