-- ============================================================================
-- LicitaPlena — histórico das bases oficiais de preço de obra (Orçamentista, fase 2).
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única. Roda depois de
-- sinapi_todas_ufs.sql (usa cliente_aprovado()).
--
-- Por que existe: o orçamento usa a DATA-BASE do edital, não o mês atual. sinapi_itens/sinapi_custos guardam só a
-- referência vigente (rápido para a busca da tela). Aqui fica uma "fotografia" de cada mês de cada base (SINAPI,
-- SICRO e as que vierem), com o que a proposta precisa citar: fonte, versão, data-base, desonerado ou não e a
-- regra de arredondamento da base (o edital manda; o SICRO arredonda pela NBR 5891, órgãos com SINAPI costumam truncar).
--
-- Tamanho: o conteúdo vai em jsonb fatiado por "balde" (2 primeiros dígitos do código), para a tela pedir só os
-- códigos da planilha (bases_preco_buscar). Um mês do SINAPI com as 27 UFs ocupa ~9 MB comprimido
-- (preços ~6 MB, analítico ~2 MB, descrições ~1 MB); 24 meses ~220 MB. Retenção: robô apaga o que passar de
-- BASES_RETENCAO_MESES (24 por padrão; no plano Free do Supabase, 500 MB, use 12).
--
-- Escrita: só os robôs (service_role): scripts/coletar_sinapi.js e scripts/coletar_bases_oficiais.js.
-- Leitura: cliente aprovado. anon não lê.
-- ============================================================================
begin;
set local lock_timeout = '5s';

-- Uma versão publicada de uma base: SINAPI 2026-10 (todas as UFs), SICRO AM 2026-07, ORSE 2026-08...
create table if not exists public.bases_preco_versoes (
  id bigint generated always as identity primary key,
  base text not null check (base ~ '^[A-Z][A-Z0-9-]{1,19}$'),
  -- 'BR' quando um arquivo traz todas as UFs (SINAPI); senão a UF ou região do arquivo (SICRO AM, SETOP-CENTRAL).
  abrangencia text not null check (abrangencia ~ '^[A-Z][A-Z0-9-]{1,29}$'),
  data_base date not null check (extract(day from data_base) = 1),
  -- Como a fonte chama a versão: "2026-10 Retificação 01", "028.1", "Boletim 194".
  versao text not null check (length(versao) between 1 and 80),
  desonerado text not null check (desonerado in ('ambos', 'sim', 'nao', 'nao_informado')),
  arredondamento text not null check (arredondamento in ('truncar', 'arredondar', 'edital')),
  casas_decimais smallint check (casas_decimais between 0 and 8),
  fonte text not null check (length(fonte) between 1 and 200),
  fonte_url text check (fonte_url is null or (fonte_url ~ '^https?://' and length(fonte_url) <= 600)),
  arquivo text check (arquivo is null or length(arquivo) <= 300),
  -- precos = conteúdo gravado; catalogo = só a notícia de que saiu (fonte sem arquivo aberto: PDF, programa próprio,
  -- login); zerada = arquivo publicado sem preço (ex.: SINAPI out/2025), não serve de base até a retificação.
  situacao text not null check (situacao in ('precos', 'catalogo', 'zerada')),
  itens integer not null default 0 check (itens >= 0),
  zerados integer not null default 0 check (zerados >= 0),
  observacao text check (observacao is null or length(observacao) <= 1000),
  publicado_em date,
  coletado_em timestamptz not null default now(),
  unique (base, abrangencia, data_base)
);
create index if not exists bases_preco_versoes_base_data on public.bases_preco_versoes (base, data_base desc);

-- Conteúdo de uma versão, fatiado. parte = "<grupo>:<balde>", ex.: "precos:AM:97" (insumo|codigo -> [sd, cd]),
-- "itens:97" (tipo|codigo -> [descrição, unidade]), "analitico:97" (composição -> [[tipo, código, coeficiente], ...]).
create table if not exists public.bases_preco_partes (
  versao_id bigint not null references public.bases_preco_versoes (id) on delete cascade,
  parte text not null check (parte ~ '^[a-z]+(:[A-Z0-9-]{2,30})?:[0-9A-Za-z_]{1,10}$'),
  conteudo jsonb not null check (jsonb_typeof(conteudo) = 'object'),
  primary key (versao_id, parte)
);

alter table public.bases_preco_versoes enable row level security;
alter table public.bases_preco_partes enable row level security;
revoke all on public.bases_preco_versoes, public.bases_preco_partes from anon, authenticated;
grant select on public.bases_preco_versoes, public.bases_preco_partes to authenticated;
revoke truncate on public.bases_preco_versoes, public.bases_preco_partes from service_role;
grant select, insert, update, delete on public.bases_preco_versoes, public.bases_preco_partes to service_role;

drop policy if exists bases_preco_versoes_select_aprovado on public.bases_preco_versoes;
create policy bases_preco_versoes_select_aprovado on public.bases_preco_versoes
  for select to authenticated using (public.cliente_aprovado());
drop policy if exists bases_preco_partes_select_aprovado on public.bases_preco_partes;
create policy bases_preco_partes_select_aprovado on public.bases_preco_partes
  for select to authenticated using (public.cliente_aprovado());

-- Só os códigos pedidos (a planilha tem dezenas ou centenas; a parte inteira tem milhares). Chave "tipo|codigo"
-- ou "codigo": o balde sai dos 2 primeiros caracteres do código. security invoker: vale a RLS acima.
create or replace function public.bases_preco_buscar(p_versao bigint, p_grupo text, p_chaves text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(k.chave, p.conteudo -> k.chave), '{}'::jsonb)
  from (select distinct c as chave from unnest(p_chaves[1:5000]) c where c is not null) k
  join public.bases_preco_partes p
    on p.versao_id = p_versao and p.parte = p_grupo || ':' || left(regexp_replace(k.chave, '^.*\|', ''), 2)
  where p.conteudo ? k.chave
$$;
revoke all on function public.bases_preco_buscar(bigint, text, text[]) from public, anon;
grant execute on function public.bases_preco_buscar(bigint, text, text[]) to authenticated, service_role;

commit;
