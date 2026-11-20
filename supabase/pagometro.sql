-- ============================================================================
-- LicitaPlena — Pagômetro (BETA): "este ente costuma pagar em dia?".
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única;
-- só cria objetos novos (não altera nem apaga dados de outras tabelas).
-- Escrita: só a função /api/pagometro (netlify/functions/pagometro.js, service_role), cache por ente.
-- Leitura: cliente aprovado (cliente_aprovado()). anon não lê.
--
-- Dado público: o RREO Anexo 7 (Restos a Pagar) que o próprio município/estado declara ao Tesouro (SICONFI).
-- Uma linha por ente; a função refaz a coleta quando a linha tem mais de 15 dias. Sem dado pessoal.
-- Metodologia: _historico/pagometro-metodologia-20261120.md. Teste: supabase/testar_pagometro.sql.
-- ============================================================================
begin;

create table if not exists public.pagometro_entes (
  -- Código IBGE: 7 dígitos = município, 2 dígitos = estado ou DF.
  id_ente text primary key check (id_ente ~ '^([0-9]{2}|[0-9]{7})$'),
  esfera text not null check (esfera in ('M', 'E')),
  nome text check (nome is null or length(nome) <= 300),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  exercicio integer check (exercicio is null or exercicio between 2015 and 2100),
  semaforo text not null check (semaforo in ('verde', 'amarelo', 'vermelho', 'sem_dados')),
  -- devido, pago, cancelado, antigos (R$) e as taxas taxaPago, taxaCancelado, taxaAntigo (0 a 1).
  indicadores jsonb not null default '{}' check (jsonb_typeof(indicadores) = 'object'),
  fonte text not null check (fonte like 'https://apidatalake.tesouro.gov.br/%' and length(fonte) <= 500),
  coletado_em timestamptz not null default now(),
  check ((esfera = 'M') = (length(id_ente) = 7)),
  check (semaforo = 'sem_dados' or exercicio is not null)
);

alter table public.pagometro_entes enable row level security;
revoke all on public.pagometro_entes from anon, authenticated;
grant select on public.pagometro_entes to authenticated;
revoke delete, truncate on public.pagometro_entes from service_role;
grant select, insert, update on public.pagometro_entes to service_role;

-- Mesmo corpo de sinapi.sql, prospeccao.sql e historico_licitacoes.sql: este arquivo roda sozinho.
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

drop policy if exists pagometro_entes_select_aprovado on public.pagometro_entes;
create policy pagometro_entes_select_aprovado on public.pagometro_entes
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (bypassrls) grava. Sem delete: a linha é sobrescrita pelo upsert.

-- Prazo médio de pagamento em dias (24 e 36 meses): fila que a função abre e o robô
-- scripts/coletar_pagometro_prazos.js completa. chave "F:<UG>" (federal, Portal da Transparência) ou
-- "M:<IBGE>" (município de SP, TCE-SP). Dias nulos = amostra pequena ou sem dado; nunca estimado.
create table if not exists public.pagometro_prazos (
  chave text primary key check (chave ~ '^(F:[0-9]{6}|M:[0-9]{7})$'),
  fonte text not null check (fonte in ('transparencia', 'tce-sp')),
  situacao text not null check (situacao in ('pendente', 'pronto', 'falhou')),
  nome text check (nome is null or length(nome) <= 300),
  dias_24m integer check (dias_24m is null or dias_24m between 0 and 3650),
  amostra_24m integer not null default 0 check (amostra_24m >= 0),
  dias_36m integer check (dias_36m is null or dias_36m between 0 and 3650),
  amostra_36m integer not null default 0 check (amostra_36m >= 0),
  erro text check (erro is null or length(erro) <= 300),
  pedido_em timestamptz not null default now(),
  coletado_em timestamptz
);
create index if not exists pagometro_prazos_fila_idx on public.pagometro_prazos (pedido_em) where situacao = 'pendente';

alter table public.pagometro_prazos enable row level security;
revoke all on public.pagometro_prazos from anon, authenticated;
grant select on public.pagometro_prazos to authenticated;
revoke delete, truncate on public.pagometro_prazos from service_role;
grant select, insert, update on public.pagometro_prazos to service_role;

drop policy if exists pagometro_prazos_select_aprovado on public.pagometro_prazos;
create policy pagometro_prazos_select_aprovado on public.pagometro_prazos
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (função e robô) grava.

commit;
