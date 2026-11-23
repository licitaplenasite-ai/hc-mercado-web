-- ============================================================================
-- LicitaPlena — pré-consulta diária da Pesquisa de Preços (termos mais buscados).
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente (pode rodar de novo), transação única.
-- Roda depois de sinapi_todas_ufs.sql ou seguranca_aprovacao_20261119.sql (usa cliente_aprovado()).
--
-- Por que existe: a 1ª consulta de um produto na Pesquisa de Preços do Compras.gov leva 7-9 s (medido 23/11).
-- O robô scripts/pre_consultar_precos.js consulta de madrugada os ~200 termos mais buscados e guarda aqui a
-- resposta pronta; a função /api/comprasgov-marcas-produto lê esta tabela antes de ir ao portal.
--
-- cache_consultas_publicas: só dado público (resposta pronta da Pesquisa de Preços). Escrita só do robô
--   (service_role). Leitura: cliente aprovado (a função lê com a sessão do próprio usuário).
-- buscas_termos: contagem ANÔNIMA dos termos buscados (termo normalizado + dia + contagem). Nunca usuário,
--   e-mail, IP ou empresa. Só a função (service_role) grava, pela registrar_busca_termo; só o robô lê.
--
-- Tamanho: ~200 termos x (1 resposta da busca + 3 páginas do produto principal) = ~800 linhas de 50-200 KB
-- em texto, comprimido pelo Postgres (TOAST) para ~30-40 MB no total. buscas_termos: dezenas de KB.
-- Retenção: o robô apaga resposta com mais de 7 dias e contagem com mais de 90 dias.
-- ============================================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.cache_consultas_publicas (
  -- Mesma chave do cache da função (_cache_publico.js): "marcas-produto|<termo>|<uf>|<pdm>|<item>|<página>|<produto>".
  chave text primary key check (length(chave) between 3 and 400),
  fonte text not null check (fonte in ('precos')),
  termo text not null check (length(termo) between 2 and 100),
  corpo text not null check (length(corpo) between 2 and 2000000),
  atualizado_em timestamptz not null default now()
);
create index if not exists cache_consultas_publicas_atualizado on public.cache_consultas_publicas (atualizado_em);

create table if not exists public.buscas_termos (
  fonte text not null check (fonte in ('precos')),
  -- Normalizado pela função: minúsculo, sem acento, espaços simples. Sem sequência longa de dígitos (CPF/CNPJ).
  termo text not null check (length(termo) between 2 and 100 and termo !~ '[0-9]{9,}'),
  dia date not null default current_date,
  contagem integer not null default 1 check (contagem > 0),
  primary key (fonte, termo, dia)
);

alter table public.cache_consultas_publicas enable row level security;
alter table public.buscas_termos enable row level security;
revoke all on public.cache_consultas_publicas, public.buscas_termos from anon, authenticated;
grant select on public.cache_consultas_publicas to authenticated;
revoke truncate on public.cache_consultas_publicas, public.buscas_termos from service_role;
grant select, insert, update, delete on public.cache_consultas_publicas, public.buscas_termos to service_role;

drop policy if exists cache_consultas_publicas_select_aprovado on public.cache_consultas_publicas;
create policy cache_consultas_publicas_select_aprovado on public.cache_consultas_publicas
  for select to authenticated using (public.cliente_aprovado());
-- buscas_termos não tem policy para authenticated: nenhum cliente lê nem grava (só service_role, que ignora RLS).
drop policy if exists buscas_termos_nenhum_cliente on public.buscas_termos;
create policy buscas_termos_nenhum_cliente on public.buscas_termos for select to authenticated using (false);

-- Soma 1 no termo de hoje. A função chama com a chave de serviço depois de validar o login.
create or replace function public.registrar_busca_termo(p_fonte text, p_termo text)
returns void language sql volatile security definer set search_path = public as $$
  insert into public.buscas_termos (fonte, termo, dia, contagem) values (p_fonte, p_termo, current_date, 1)
  on conflict (fonte, termo, dia) do update set contagem = public.buscas_termos.contagem + 1
$$;
revoke all on function public.registrar_busca_termo(text, text) from public, anon, authenticated;
grant execute on function public.registrar_busca_termo(text, text) to service_role;

-- Os termos mais buscados nos últimos p_dias (o robô completa com a lista inicial até ~200).
create or replace function public.termos_mais_buscados(p_fonte text, p_dias integer default 30, p_limite integer default 200)
returns table (termo text, buscas bigint) language sql stable security definer set search_path = public as $$
  select b.termo, sum(b.contagem)::bigint as buscas
  from public.buscas_termos b
  where b.fonte = p_fonte and b.dia >= current_date - greatest(1, least(p_dias, 365))
  group by b.termo
  order by buscas desc, b.termo
  limit greatest(1, least(p_limite, 1000))
$$;
revoke all on function public.termos_mais_buscados(text, integer, integer) from public, anon, authenticated;
grant execute on function public.termos_mais_buscados(text, integer, integer) to service_role;

commit;
