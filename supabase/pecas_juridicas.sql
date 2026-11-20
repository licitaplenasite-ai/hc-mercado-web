-- ============================================================================
-- LicitaPlena — Banco de peças reais (Jurídico & Dúvidas): esclarecimentos, impugnações, intenções de recurso,
-- recursos e contrarrazões publicados no ComprasNet antigo (com a resposta/decisão do pregoeiro) e, da Lei 14.133,
-- os que os órgãos anexam às contratações no PNCP.
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única;
-- só cria objetos novos (não altera nem apaga dados de outras tabelas).
-- Escrita: só os robôs scripts/coletar_pecas_juridicas.js e scripts/coletar_pecas_pncp.js (service_role). Leitura: cliente aprovado (cliente_aprovado()),
-- pela aba "Banco de peças reais" do painel. anon não lê.
-- LGPD: o robô apaga CPF, e-mail, telefone, RG, OAB e nomes de pessoas antes de gravar; o CHECK abaixo recusa CPF
-- (mesma regra de netlify/functions/_cpf.js). Ficam empresa, CNPJ e órgão (dado público de pessoa jurídica).
-- ============================================================================
begin;

create table if not exists public.pecas_juridicas (
  id text primary key check (id ~ '^(cn|pncp)-[0-9A-Za-z-]{3,120}$'),
  tipo text not null check (tipo in ('esclarecimento', 'impugnacao', 'intencao_recurso', 'recurso', 'contrarrazao')),
  pregao text check (pregao is null or pregao ~ '^[0-9]{1,6}/[0-9]{4}$'),
  uasg text check (uasg is null or uasg ~ '^[0-9]{5,6}$'),
  orgao text check (orgao is null or length(orgao) <= 300),
  prgcod text check (prgcod is null or prgcod ~ '^[0-9]{3,12}$'),
  item integer check (item is null or item between 0 and 100000),
  data date,
  empresa_cnpj text check (empresa_cnpj is null or empresa_cnpj ~ '^[0-9]{14}$'),
  empresa_nome text check (empresa_nome is null or (length(empresa_nome) <= 300 and empresa_nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y')),
  texto text not null check (length(texto) between 1 and 60000 and texto !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'),
  resposta text check (resposta is null or (length(resposta) <= 60000 and resposta !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y')),
  -- Cabeçalho da decisão no portal ("NÃO PROCEDE", "PROCEDE"...), quando há.
  resultado text check (resultado is null or length(resultado) <= 200),
  lei text check (lei is null or lei in ('14133', '10520', '8666', '13303')),
  url text check (url is null or url ~ '^https://(www\.comprasnet\.gov\.br|pncp\.gov\.br)/'),
  -- Texto minúsculo e sem acento (peça + resposta + órgão + empresa), montado pelo robô para o ILIKE da busca.
  busca text not null default '' check (length(busca) <= 20000),
  coletado_em timestamptz not null default now()
);
-- shortcut: ILIKE por palavra em busca, filtrado por tipo e ordenado por data, com limite de 30 linhas na tela. Com
-- dezenas de milhares de peças e lentidão, criar extensão pg_trgm e índice gin (busca gin_trgm_ops).
-- Peças da Lei 14.133 anexadas no PNCP (scripts/coletar_pecas_pncp.js): id "pncp-..." e link para pncp.gov.br. Em banco
-- que já tinha a tabela, troca os dois CHECKs antigos (só ComprasNet) pelos novos.
alter table public.pecas_juridicas drop constraint if exists pecas_juridicas_id_check;
alter table public.pecas_juridicas add constraint pecas_juridicas_id_check check (id ~ '^(cn|pncp)-[0-9A-Za-z-]{3,120}$');
alter table public.pecas_juridicas drop constraint if exists pecas_juridicas_url_check;
alter table public.pecas_juridicas add constraint pecas_juridicas_url_check check (url is null or url ~ '^https://(www\.comprasnet\.gov\.br|pncp\.gov\.br)/');
create index if not exists pecas_juridicas_tipo_data_idx on public.pecas_juridicas (tipo, data desc);

alter table public.pecas_juridicas enable row level security;
revoke all on public.pecas_juridicas from anon, authenticated;
grant select on public.pecas_juridicas to authenticated;
revoke truncate on public.pecas_juridicas from service_role;
grant select, insert, update, delete on public.pecas_juridicas to service_role;

-- Mesmo corpo de prospeccao.sql, historico_licitacoes.sql e sinapi.sql: este arquivo roda sozinho.
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

drop policy if exists pecas_juridicas_select_aprovado on public.pecas_juridicas;
create policy pecas_juridicas_select_aprovado on public.pecas_juridicas
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (bypassrls) grava.

commit;
