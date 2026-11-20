-- LicitaPlena — Aviso no celular (Web Push). Seguro rodar mais de uma vez (idempotente). Rodar no SQL Editor do Supabase.
--
-- avisos_celular_inscricoes: um aparelho/navegador inscrito por linha (endpoint do serviço de push + chaves públicas
--   do aparelho). Grava só pela rota /api/avisos-celular (chave de serviço, endpoint validado contra a lista de
--   serviços de push conhecidos); o próprio usuário lê e apaga as suas. Ninguém lê a de outro.
-- avisos_celular_preferencias: que tipos de aviso a conta quer (sem linha = todos ligados). Grava pela rota.
-- avisos_celular_enviados: o que o robô (scripts/avisos_celular.js) já mandou para quem. A chave primária é a
--   reserva: duas rodadas ao mesmo tempo não mandam o mesmo aviso duas vezes. Só a chave de serviço acessa.

create table if not exists public.avisos_celular_inscricoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,88}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22,24}$'),
  aparelho text check (length(aparelho) <= 120),
  criado_em timestamptz not null default now()
);
create index if not exists avisos_celular_inscricoes_usuario_idx on public.avisos_celular_inscricoes (usuario_id);
alter table public.avisos_celular_inscricoes enable row level security;
drop policy if exists avisos_celular_inscricoes_select_proprio on public.avisos_celular_inscricoes;
create policy avisos_celular_inscricoes_select_proprio on public.avisos_celular_inscricoes for select to authenticated using (auth.uid() = usuario_id);
drop policy if exists avisos_celular_inscricoes_delete_proprio on public.avisos_celular_inscricoes;
create policy avisos_celular_inscricoes_delete_proprio on public.avisos_celular_inscricoes for delete to authenticated using (auth.uid() = usuario_id);
revoke insert, update on public.avisos_celular_inscricoes from anon, authenticated;

create table if not exists public.avisos_celular_preferencias (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  edital boolean not null default true,
  prazo boolean not null default true,
  pregoeiro boolean not null default true,
  certidao boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.avisos_celular_preferencias enable row level security;
drop policy if exists avisos_celular_preferencias_select_proprio on public.avisos_celular_preferencias;
create policy avisos_celular_preferencias_select_proprio on public.avisos_celular_preferencias for select to authenticated using (auth.uid() = usuario_id);
revoke insert, update, delete on public.avisos_celular_preferencias from anon, authenticated;

create table if not exists public.avisos_celular_enviados (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  chave text not null check (length(chave) <= 200),
  enviado_em timestamptz not null default now(),
  primary key (usuario_id, chave)
);
create index if not exists avisos_celular_enviados_data_idx on public.avisos_celular_enviados (enviado_em);
alter table public.avisos_celular_enviados enable row level security;
-- Sem policy: anon/authenticated não leem nem gravam; só service_role (que ignora RLS).
revoke all on public.avisos_celular_enviados from anon, authenticated;
