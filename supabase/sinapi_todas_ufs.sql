-- ============================================================================
-- LicitaPlena — SINAPI das 27 UFs (insumos, composições e composições analíticas da CAIXA).
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única.
-- Substitui a tabela sinapi_precos (sinapi.sql, só AM): ela é apagada aqui. É cache de dado público
-- da CAIXA; depois de rodar, dispare o robô (Actions -> SINAPI -> Run workflow) para recarregar.
-- Escrita: só o robô scripts/coletar_sinapi.js (service_role), uma vez por mês.
-- Leitura: cliente aprovado (cliente_aprovado()), pela tela sinapi.html. anon não lê.
--
-- Por que três tabelas: descrição, unidade e grupo são iguais nas 27 UFs; só o preço muda. Guardar a descrição
-- uma vez (sinapi_itens) e só os dois preços por UF (sinapi_custos) cabe em ~45 MB, contra ~330 MB repetindo
-- a descrição em cada UF e regime. Só a referência vigente fica no banco (o robô apaga a anterior).
-- ============================================================================
begin;

drop table if exists public.sinapi_precos;

-- Um insumo ou composição da referência vigente (igual para todas as UFs).
create table if not exists public.sinapi_itens (
  tipo text not null check (tipo in ('insumo', 'composicao')),
  codigo text not null check (codigo ~ '^[0-9]{1,10}$'),
  descricao text not null check (length(descricao) between 1 and 2000),
  unidade text check (unidade is null or length(unidade) <= 30),
  -- Insumo: classificação (MATERIAL, SERVIÇOS...); composição: grupo (Acessibilidade, Alvenaria...).
  grupo text check (grupo is null or length(grupo) <= 200),
  -- Insumo: origem do preço (C = coletado, CR = coeficiente de representatividade, AS = atribuído de SP).
  origem text check (origem is null or length(origem) <= 10),
  -- Mês de referência (data-base) da CAIXA, sempre dia 1.
  referencia date not null check (extract(day from referencia) = 1),
  -- Descrição minúscula e sem acento, montada pelo robô para o ILIKE da busca.
  busca text not null default '' check (length(busca) <= 2000),
  primary key (tipo, codigo)
);
-- shortcut: a busca por palavras (ILIKE '%x%') varre ~16 mil linhas, poucos milissegundos sem índice. Se a busca
-- ficar lenta, criar índice gin_trgm_ops em busca (extensão pg_trgm).

-- Preço mediano da capital por UF: sem desoneração (preco_sd) e com desoneração (preco_cd).
-- Em branco no relatório (sem coleta mínima na UF) fica null.
create table if not exists public.sinapi_custos (
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  tipo text not null,
  codigo text not null,
  preco_sd numeric(14, 2) check (preco_sd is null or preco_sd > 0),
  preco_cd numeric(14, 2) check (preco_cd is null or preco_cd > 0),
  referencia date not null check (extract(day from referencia) = 1),
  primary key (uf, tipo, codigo),
  foreign key (tipo, codigo) references public.sinapi_itens (tipo, codigo) on delete cascade,
  check (preco_sd is not null or preco_cd is not null)
);
-- A FK (tipo, codigo) precisa de índice próprio para o cascade e para o embed itens -> custos do PostgREST.
create index if not exists sinapi_custos_item on public.sinapi_custos (tipo, codigo);

-- Composição analítica: itens (insumos e composições auxiliares) com coeficiente. Nacional: o custo de cada
-- item na UF sai de sinapi_custos. Item "SEM PREÇO"/"EM ESTUDO" pode não estar em sinapi_itens: sem FK no item.
create table if not exists public.sinapi_composicao_itens (
  composicao text not null,
  item_tipo text not null check (item_tipo in ('insumo', 'composicao')),
  item_codigo text not null check (item_codigo ~ '^[0-9]{1,10}$'),
  descricao text not null check (length(descricao) between 1 and 2000),
  unidade text check (unidade is null or length(unidade) <= 30),
  coeficiente numeric(20, 8) not null check (coeficiente >= 0),
  situacao text check (situacao is null or length(situacao) <= 30),
  referencia date not null check (extract(day from referencia) = 1),
  primary key (composicao, item_tipo, item_codigo)
);

alter table public.sinapi_itens enable row level security;
alter table public.sinapi_custos enable row level security;
alter table public.sinapi_composicao_itens enable row level security;
revoke all on public.sinapi_itens, public.sinapi_custos, public.sinapi_composicao_itens from anon, authenticated;
grant select on public.sinapi_itens, public.sinapi_custos, public.sinapi_composicao_itens to authenticated;
revoke truncate on public.sinapi_itens, public.sinapi_custos, public.sinapi_composicao_itens from service_role;
grant select, insert, update, delete on public.sinapi_itens, public.sinapi_custos, public.sinapi_composicao_itens to service_role;

-- Mesmo corpo de prospeccao.sql e historico_licitacoes.sql: este arquivo roda sozinho.
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

drop policy if exists sinapi_itens_select_aprovado on public.sinapi_itens;
create policy sinapi_itens_select_aprovado on public.sinapi_itens
  for select to authenticated using (public.cliente_aprovado());
drop policy if exists sinapi_custos_select_aprovado on public.sinapi_custos;
create policy sinapi_custos_select_aprovado on public.sinapi_custos
  for select to authenticated using (public.cliente_aprovado());
drop policy if exists sinapi_composicao_itens_select_aprovado on public.sinapi_composicao_itens;
create policy sinapi_composicao_itens_select_aprovado on public.sinapi_composicao_itens
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (bypassrls) grava.

commit;
