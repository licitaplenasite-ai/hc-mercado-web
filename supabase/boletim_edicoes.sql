-- Edições do Boletim: o robô de e-mail (scripts/boletim_editais.py) grava, a cada envio, uma linha por
-- conta/dia/filtro com os números dos editais daquela edição. O aviso por e-mail só leva o link; a lista
-- fica aqui, para o painel mostrar a edição do dia e as dos dias anteriores.
-- Aditivo e idempotente. Cada conta lê só as próprias linhas (RLS); quem grava é o robô (service_role).
-- Teste: testar_boletim_edicoes.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.boletim_edicoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references auth.users(id) on delete cascade,
  edicao date not null,
  filtro_id text not null default 'principal' check (length(filtro_id) between 1 and 60),
  filtro_nome text check (filtro_nome is null or length(filtro_nome) <= 120),
  empresa text check (empresa is null or length(empresa) <= 160),
  quantidade integer not null default 0 check (quantidade >= 0),
  numeros text[] not null default '{}' check (cardinality(numeros) <= 500),
  criado_em timestamptz not null default now(),
  unique (cliente_id, edicao, filtro_id)
);
create index if not exists boletim_edicoes_cliente_data on public.boletim_edicoes (cliente_id, edicao desc);

alter table public.boletim_edicoes enable row level security;
drop policy if exists boletim_edicoes_proprias on public.boletim_edicoes;
create policy boletim_edicoes_proprias on public.boletim_edicoes for select to authenticated
  using (cliente_id = auth.uid());
revoke all on public.boletim_edicoes from public, anon, authenticated;
grant select on public.boletim_edicoes to authenticated;
grant all on public.boletim_edicoes to service_role;
commit;
