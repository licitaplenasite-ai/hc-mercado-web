-- Edições do Boletim: o robô de e-mail (scripts/boletim_editais.py) grava, a cada envio, uma linha por
-- conta/dia/filtro com os números dos editais daquela edição. O aviso por e-mail só leva o link; a lista
-- fica aqui, para o painel mostrar a edição do dia e as dos dias anteriores.
-- Aditivo e idempotente. Cada conta lê só as próprias linhas (RLS); quem grava é o robô (service_role).
-- 23/11: número da edição e código do cliente, que o cabeçalho do e-mail mostra ("Edição nº", "Identificação do
-- cliente"). Os dois são números curtos de sequência, nunca o UUID da conta. Rodar DEPOIS de rls_e_limite_de_uso.sql
-- (tabela clientes). Teste: testar_boletim_edicoes.sql.
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

-- Número da edição: uma sequência só para o serviço inteiro (não por cliente). Cada linha (conta + dia + filtro) ganha
-- um número que nunca se repete nem muda: as rodadas do mesmo dia atualizam a linha e mantêm o número (o upsert do
-- robô não manda "numero"), e o suporte acha o e-mail exato só pelo número que o cliente informar. Contador por
-- cliente repetiria números entre contas e exigiria trava para calcular o próximo. Começa em 1001; buracos na
-- sequência (tentativa que não gravou) são normais e não quebram nada.
create sequence if not exists public.boletim_edicoes_numero_seq start 1001 minvalue 1;
alter table public.boletim_edicoes add column if not exists numero bigint;
with s as (select id, row_number() over (order by criado_em, id) as n from public.boletim_edicoes where numero is null)
update public.boletim_edicoes b set numero = (select coalesce(max(numero), 1000) from public.boletim_edicoes) + s.n
  from s where b.id = s.id;
select setval('public.boletim_edicoes_numero_seq', m)
  from (select max(numero) as m from public.boletim_edicoes) x
  where m is not null and m >= (select last_value from public.boletim_edicoes_numero_seq);
alter sequence public.boletim_edicoes_numero_seq owned by public.boletim_edicoes.numero;
alter table public.boletim_edicoes alter column numero set default nextval('public.boletim_edicoes_numero_seq');
alter table public.boletim_edicoes alter column numero set not null;
create unique index if not exists boletim_edicoes_numero_unico on public.boletim_edicoes (numero);
revoke all on sequence public.boletim_edicoes_numero_seq from public, anon, authenticated;
grant usage, select on sequence public.boletim_edicoes_numero_seq to service_role;

-- Código do cliente ("Identificação do cliente" no e-mail, em Minha conta e no admin): curto, estável e sem o UUID.
-- Quem dá o número é o banco: no cadastro o valor enviado pelo navegador é trocado pelo próximo da sequência e
-- depois ninguém muda (nem o próprio cliente pela policy de update, nem o admin). Contas antigas ganham o número na
-- ordem de cadastro.
create sequence if not exists public.clientes_codigo_seq start 1001 minvalue 1;
alter table public.clientes add column if not exists codigo bigint;
with s as (select id, row_number() over (order by criado_em, id) as n from public.clientes where codigo is null)
update public.clientes c set codigo = (select coalesce(max(codigo), 1000) from public.clientes) + s.n
  from s where c.id = s.id;
select setval('public.clientes_codigo_seq', m)
  from (select max(codigo) as m from public.clientes) x
  where m is not null and m >= (select last_value from public.clientes_codigo_seq);
create unique index if not exists clientes_codigo_unico on public.clientes (codigo);
revoke all on sequence public.clientes_codigo_seq from public, anon, authenticated;

create or replace function public.clientes_codigo_fixo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.codigo := nextval('public.clientes_codigo_seq');
  else
    new.codigo := coalesce(old.codigo, nextval('public.clientes_codigo_seq'));
  end if;
  return new;
end $$;
revoke all on function public.clientes_codigo_fixo() from public, anon, authenticated;
drop trigger if exists clientes_codigo_fixo on public.clientes;
create trigger clientes_codigo_fixo before insert or update on public.clientes
  for each row execute function public.clientes_codigo_fixo();
commit;
