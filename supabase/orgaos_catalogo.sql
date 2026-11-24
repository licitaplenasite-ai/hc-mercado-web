-- Catálogo de órgãos + busca tolerante (24/11/2026). Idempotente (seguro rodar mais de uma vez), transação única; só
-- acrescenta (não apaga nem altera dados das outras tabelas). Rodar no SQL Editor do Supabase DEPOIS de
-- seguranca_aprovacao_20261119.sql, schema_oportunidades.sql, schema_dados_mercado.sql e prospeccao.sql, e ANTES de
-- crm_orgao_linha_tempo.sql (a ficha do órgão usa este catálogo para achar o órgão pelo nome).
-- Teste: scripts/orgaos_catalogo_sql.test.js (PGlite, com unaccent e pg_trgm de verdade).
--
-- POR QUE EXISTE
--   O dono digitou nomes de órgãos na ficha (orgao.html) e "não apareceu nada": a ficha achava o órgão pelo nome EXATO
--   (lower(nome) = lower(termo)), sensível a acento e ao nome completo ("Município de Apuí" não achava "MUNICIPIO DE APUI";
--   "prefeitura de manaus" não achava "MUNICIPIO DE MANAUS"). E órgão sem licitação aberta nem contrato coletado não existia.
--
-- O QUE TEM
--   orgaos_catalogo: um órgão por CNPJ. Duas fontes, cada uma dona das suas colunas:
--     - cadastro do PNCP (todos os ~98 mil órgãos, com ou sem compra recente): nome_registro, esfera_registro, poder.
--       Carregado 1 vez por semana pelo robô scripts/atualizar_cadastro_orgaos.js (passo do atualizar-dados.yml), pela
--       carregar_cadastro_orgaos (1 chamada ao PNCP devolve a lista inteira, ~46 MB).
--     - dados já coletados (oportunidades_abertas, contratos, mercado_atas, prospeccao_itens): nome_local, UF, município,
--       UASGs, nomes das unidades, contagens e última atividade. Recalculados 1 vez por dia pela atualizar_orgaos_catalogo,
--       agendada no pg_cron (fim deste arquivo). Só colunas leves: contratos e atas não abrem o jsonb "dado" (pesado).
--     O gatilho monta o texto de busca (sem acento, minúsculo, com apelidos e siglas) a cada gravação.
--   buscar_orgaos(termo, uf, limite): CNPJ (com ou sem máscara, ou só os 8 primeiros), UASG, ou nome parcial em qualquer
--     ordem, sem acento, com sinônimos (prefeitura = município, governo = estado, estadual = estado) e abreviação no
--     começo da palavra (sec, est, gov, univ, pref). Nada casou com todas as palavras: tenta parecido (pg_trgm), para erro
--     de digitação. Ordena por relevância e atividade; um resultado por nome e UF (o cadastro tem centenas de CNPJs
--     "COMANDO DA AERONAUTICA").
--   orgao_chave_nome(nome): nome canônico ("Prefeitura Municipal de Apuí" = "MUNICIPIO DE APUI" = "municipio apui"), que
--     a ficha_orgao usa para achar pelo nome digitado num processo cadastrado à mão.
--
-- SEGURANÇA: o catálogo só tem dado público (nome, CNPJ, cidade, contagens). Ninguém lê a tabela direto (sem grant): só
--   pela buscar_orgaos (security definer, exige cliente_aprovado()). Só o robô (service_role) grava o cadastro.
--
-- ESPAÇO E TEMPO (estimado): ~98 mil linhas x ~0,6 kB + índice trigram do texto de busca = ~90-120 MB.
--   A tabela nasce vazia aqui (índices instantâneos, sem "concurrently"). A 1ª carga do cadastro vem do robô; o 1º
--   recálculo, do pg_cron (passo 2 abaixo). A busca lê só o catálogo (~100 mil linhas): milissegundos.
--
-- COMO RODAR EM PRODUÇÃO (nesta ordem)
--   1. Este arquivo inteiro no SQL Editor (Run). Leva segundos: tabela nova e vazia.
--   2. Primeiro recálculo, pelo pg_cron, porque lê contratos/prospecção inteiros e pode passar do statement_timeout
--      padrão (2 min) e do corte de 60 s do editor. Agende num horário FIXO (UTC) uns 5 minutos à frente, com 15 min de
--      prazo só neste comando. Ex.: agora 14:32 UTC -> '37 14 * * *'. Selecione SÓ este comando e Run:
--        select cron.schedule('orgaos_catalogo_agora', '37 14 * * *', $c$set statement_timeout = '15min'; select public.atualizar_orgaos_catalogo()$c$);
--      Não ponha o cron.unschedule dentro do job: se o recálculo falhar, a transação desfaz o unschedule junto e o job
--      fica agendado. Acompanhar (status succeeded) e DEPOIS tirar da agenda à mão:
--        select status, return_message, start_time, end_time from cron.job_run_details
--          where jobid = (select jobid from cron.job where jobname = 'orgaos_catalogo_agora') order by start_time desc limit 3;
--        select cron.unschedule('orgaos_catalogo_agora');
--      (Sem o unschedule ele repetiria no mesmo horário todo dia: inofensivo, mas duplica o diário.)
--      Sem pg_cron: Database > Extensions > pg_cron. Depois rode este arquivo de novo (passo 3 é automático).
--   3. O recálculo diário (12:40 UTC = 09:40 de Brasília, depois do robô das 09:00 UTC) é agendado no fim deste arquivo,
--      também com 15 min de prazo. Só ele eleva o statement_timeout, e só dentro do próprio comando.
--   4. Cadastro completo do PNCP: dispare "Atualizar dados" no GitHub Actions (ou espere a rodada diária); o passo
--      "Cadastro de órgãos do PNCP" carrega os ~98 mil órgãos (1 vez por semana; ~2 min).
--   5. crm_orgao_linha_tempo.sql de novo (a ficha passa a achar pelo nome canônico e usa o catálogo de reserva).
--   Voltar atrás: select cron.unschedule('orgaos_catalogo_diario'); drop table public.orgaos_catalogo cascade;
--     (e o crm_orgao_linha_tempo.sql da versão anterior).
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.oportunidades_abertas') is null or to_regclass('public.contratos') is null
    or to_regclass('public.mercado_atas') is null or to_regclass('public.prospeccao_itens') is null
    or to_regprocedure('public.cliente_aprovado()') is null then
    raise exception 'Aplique antes seguranca_aprovacao_20261119.sql, schema_oportunidades.sql, schema_dados_mercado.sql e prospeccao.sql';
  end if;
  -- No Supabase as extensões ficam no esquema "extensions"; fora dele (testes), no public.
  if not exists (select 1 from pg_extension where extname = 'unaccent') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then create extension unaccent schema extensions;
    else create extension unaccent; end if;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then create extension pg_trgm schema extensions;
    else create extension pg_trgm; end if;
  end if;
end $$;
set local search_path = public, extensions;

-- ---------- Normalização (mesmas regras na gravação e na busca) ----------
-- Minúsculo, sem acento, só letras e números separados por 1 espaço.
create or replace function public.orgao_normalizar(p text) returns text
language sql stable parallel safe set search_path = public, extensions, pg_temp as $$
  select btrim(regexp_replace(lower(unaccent(coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Nome canônico para comparar nomes escritos de jeitos diferentes: sem "de/da/do", e prefeitura (municipal) = município,
-- inclusive no formato do cadastro do PNCP ("SAO PEDRO DO PIAUI PREFEITURA").
create or replace function public.orgao_chave_nome(p text) returns text
language plpgsql stable parallel safe set search_path = public, extensions, pg_temp as $$
declare
  k text := ' ' || public.orgao_normalizar(p) || ' ';
begin
  -- Duas vezes: em "do de" adjacentes a 1ª troca consome o espaço que a 2ª precisa.
  k := regexp_replace(k, ' (de|da|do|das|dos|e) ', ' ', 'g');
  k := regexp_replace(k, ' (de|da|do|das|dos|e) ', ' ', 'g');
  -- "Governo do (Estado do) Amazonas" é o ente ESTADO DO AMAZONAS.
  if k ~ '^ governo ' then
    k := ' estado ' || regexp_replace(k, '^ governo (estado )?', '');
  elsif k ~ '^ (prefeitura municipal|prefeitura|municipio) ' then
    k := ' municipio ' || regexp_replace(k, '^ (prefeitura municipal|prefeitura|municipio) ', '');
  elsif k ~ ' prefeitura( municipal)? $' then
    k := ' municipio ' || regexp_replace(k, ' prefeitura( municipal)? $', ' ');
  end if;
  return btrim(regexp_replace(k, ' +', ' ', 'g'));
end $$;

-- Siglas deduzidas do nome: iniciais + UF ("tribunal de justica do estado do amazonas" -> tjam; "universidade federal do
-- oeste do para" -> ufopa; "tribunal regional federal da 1 regiao" -> trf1) e iniciais de todas as palavras ("universidade
-- do estado do amazonas" -> uea). Sigla que não segue a regra (UFAM é "FUNDACAO UNIVERSIDADE DO AMAZONAS") vai em
-- orgaos_apelidos.
create or replace function public.orgao_siglas(p_norm text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  s text := ' ' || coalesce(p_norm, '') || ' ';
  e record;
  w text;
  a text := ''; b text := ''; ufs text := ''; palavras int := 0;
begin
  for e in select * from (values ('mato grosso do sul', 'ms'), ('rio grande do norte', 'rn'), ('rio grande do sul', 'rs'),
      ('distrito federal', 'df'), ('espirito santo', 'es'), ('mato grosso', 'mt'), ('minas gerais', 'mg'), ('rio de janeiro', 'rj'),
      ('santa catarina', 'sc'), ('sao paulo', 'sp'), ('acre', 'ac'), ('alagoas', 'al'), ('amapa', 'ap'), ('amazonas', 'am'),
      ('bahia', 'ba'), ('ceara', 'ce'), ('goias', 'go'), ('maranhao', 'ma'), ('para', 'pa'), ('paraiba', 'pb'), ('parana', 'pr'),
      ('pernambuco', 'pe'), ('piaui', 'pi'), ('rondonia', 'ro'), ('roraima', 'rr'), ('sergipe', 'se'), ('tocantins', 'to')) v(nome, uf)
      order by length(v.nome) desc
  loop
    s := replace(s, ' ' || e.nome || ' ', ' #' || e.uf || ' ');
  end loop;
  foreach w in array regexp_split_to_array(btrim(s), ' +') loop
    continue when w = '' or w in ('de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'para', 'na', 'no');
    palavras := palavras + 1;
    if w like '#%' then ufs := ufs || substr(w, 2); b := b || substr(w, 2, 1);
    elsif w ~ '^[0-9]+$' then a := a || w; b := b || w;
    else
      b := b || left(w, 1);
      if w not in ('estado', 'regiao') then a := a || left(w, 1); end if;
    end if;
  end loop;
  if palavras < 2 then return ''; end if;
  return concat_ws(' ', case when length(a || ufs) between 2 and 8 then a || ufs end,
                        case when length(b) between 2 and 8 and b <> a || ufs then b end);
end $$;

create or replace function public.orgao_uf_nome(p_uf text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case upper(p_uf) when 'AC' then 'acre' when 'AL' then 'alagoas' when 'AP' then 'amapa' when 'AM' then 'amazonas'
    when 'BA' then 'bahia' when 'CE' then 'ceara' when 'DF' then 'distrito federal' when 'ES' then 'espirito santo'
    when 'GO' then 'goias' when 'MA' then 'maranhao' when 'MT' then 'mato grosso' when 'MS' then 'mato grosso do sul'
    when 'MG' then 'minas gerais' when 'PA' then 'para' when 'PB' then 'paraiba' when 'PR' then 'parana' when 'PE' then 'pernambuco'
    when 'PI' then 'piaui' when 'RJ' then 'rio de janeiro' when 'RN' then 'rio grande do norte' when 'RS' then 'rio grande do sul'
    when 'RO' then 'rondonia' when 'RR' then 'roraima' when 'SC' then 'santa catarina' when 'SP' then 'sao paulo'
    when 'SE' then 'sergipe' when 'TO' then 'tocantins' end
$$;

-- Palavra da busca -> padrões aceitos. A abreviação no começo da palavra já casa sozinha (sec, est, gov, univ, pref):
-- aqui só os sinônimos que não são prefixo um do outro.
create or replace function public.orgao_variantes(p_palavra text) returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_palavra in ('prefeitura', 'pref', 'prefeit') then array[p_palavra, 'municipio']
    when p_palavra in ('municipio', 'mun', 'munic') then array[p_palavra, 'prefeitura', 'municipal']
    when p_palavra = 'municipal' then array['municipal', 'municipio', 'prefeitura']
    when p_palavra in ('governo', 'gov') then array[p_palavra, 'estado']
    when p_palavra in ('estado', 'est') then array[p_palavra, 'estadual', 'governo']
    when p_palavra = 'estadual' then array['estadual', 'estado']
    else array[p_palavra] end
$$;

-- Auxiliares só para uso interno (gatilho e funções security definer, que rodam como o dono): ninguém do PostgREST chama.
revoke all on function public.orgao_normalizar(text), public.orgao_chave_nome(text), public.orgao_siglas(text),
  public.orgao_uf_nome(text), public.orgao_variantes(text) from public, anon, authenticated;

-- ---------- Tabelas ----------
create table if not exists public.orgaos_catalogo (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  -- Cadastro do PNCP (robô semanal).
  nome_registro text check (nome_registro is null or length(nome_registro) <= 300),
  esfera_registro text check (esfera_registro is null or esfera_registro ~ '^[A-Z]$'),
  poder text check (poder is null or poder ~ '^[A-Z]$'),
  -- statusAtivo do cadastro do PNCP: inativo fica no catálogo (histórico da ficha), mas sai da busca.
  ativo boolean not null default true,
  -- Dados coletados (recálculo diário).
  nome_local text check (nome_local is null or length(nome_local) <= 300),
  esfera_local text check (esfera_local is null or esfera_local ~ '^[A-Z]$'),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  municipio text check (municipio is null or length(municipio) <= 120),
  uasgs text[] not null default '{}',
  unidades text[] not null default '{}',
  abertas int not null default 0,
  contratos int not null default 0,
  atas int not null default 0,
  itens int not null default 0,
  ultima_atividade date,
  -- Montados pelo gatilho.
  nome text,
  esfera text,
  nome_norm text not null default '',
  nome_chave text not null default '',
  busca text not null default '',
  atualizado_em timestamptz not null default now()
);
alter table public.orgaos_catalogo enable row level security;
-- Só as funções security definer leem e gravam; a policy existe pela regra do diretório, mas sem grant nenhum papel do
-- PostgREST chega à tabela (mesmo padrão de prospeccao_busca).
revoke all on public.orgaos_catalogo from public, anon, authenticated, service_role;
drop policy if exists orgaos_catalogo_select_aprovado on public.orgaos_catalogo;
create policy orgaos_catalogo_select_aprovado on public.orgaos_catalogo for select to authenticated using ((select public.cliente_aprovado()));
-- Quem rodou a 1ª versão (sem a coluna ativo) recebe a coluna aqui.
alter table public.orgaos_catalogo add column if not exists ativo boolean not null default true;
create index if not exists orgaos_catalogo_busca_trgm_idx on public.orgaos_catalogo using gin (busca gin_trgm_ops);
create index if not exists orgaos_catalogo_cnpj_prefixo_idx on public.orgaos_catalogo (cnpj text_pattern_ops);
create index if not exists orgaos_catalogo_uasgs_idx on public.orgaos_catalogo using gin (uasgs);
create index if not exists orgaos_catalogo_nome_chave_idx on public.orgaos_catalogo (nome_chave);

-- Apelidos que a regra das siglas não deduz. Pelos 8 primeiros dígitos (vale para matriz e filiais). Acrescentar aqui
-- (insert + rodar o arquivo de novo) quando um cliente procurar uma sigla e não achar.
create table if not exists public.orgaos_apelidos (
  cnpj_raiz text primary key check (cnpj_raiz ~ '^[0-9]{8}$'),
  apelidos text not null check (length(apelidos) between 2 and 300)
);
alter table public.orgaos_apelidos enable row level security;
revoke all on public.orgaos_apelidos from public, anon, authenticated, service_role;
drop policy if exists orgaos_apelidos_select_aprovado on public.orgaos_apelidos;
create policy orgaos_apelidos_select_aprovado on public.orgaos_apelidos for select to authenticated using ((select public.cliente_aprovado()));
insert into public.orgaos_apelidos (cnpj_raiz, apelidos) values
  -- Razão social no cadastro: FUNDACAO UNIVERSIDADE DO AMAZONAS (conferido no cadastro do PNCP em 24/11/2026).
  ('04378626', 'ufam universidade federal do amazonas')
on conflict (cnpj_raiz) do update set apelidos = excluded.apelidos;

-- ---------- Gatilho: nome de exibição e texto de busca ----------
create or replace function public.orgaos_catalogo_montar() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_apelidos text;
begin
  new.nome := coalesce(nullif(btrim(new.nome_local), ''), nullif(btrim(new.nome_registro), ''));
  new.esfera := coalesce(new.esfera_registro, new.esfera_local);
  new.nome_norm := public.orgao_normalizar(new.nome);
  new.nome_chave := public.orgao_chave_nome(new.nome);
  select a.apelidos into v_apelidos from public.orgaos_apelidos a where a.cnpj_raiz = left(new.cnpj, 8);
  -- Espaço nas pontas: a busca casa o começo de palavra com '% palavra%'.
  new.busca := ' ' || left(concat_ws(' ',
    new.nome_norm,
    case when public.orgao_normalizar(new.nome_registro) <> new.nome_norm then public.orgao_normalizar(new.nome_registro) end,
    case when new.nome_chave like 'municipio %' then 'prefeitura municipal municipio' end,
    case new.esfera when 'M' then 'municipal' when 'E' then 'estadual' when 'F' then 'federal' when 'D' then 'distrital' end,
    public.orgao_siglas(new.nome_norm),
    public.orgao_normalizar(v_apelidos),
    public.orgao_normalizar(new.municipio),
    lower(new.uf), public.orgao_uf_nome(new.uf),
    public.orgao_normalizar(array_to_string(new.unidades, ' ')),
    new.cnpj), 3000) || ' ';
  new.atualizado_em := now();
  return new;
end $$;
revoke all on function public.orgaos_catalogo_montar() from public, anon, authenticated, service_role;
drop trigger if exists orgaos_catalogo_montar on public.orgaos_catalogo;
create trigger orgaos_catalogo_montar before insert or update on public.orgaos_catalogo
  for each row execute function public.orgaos_catalogo_montar();
-- Apelido novo ou regra nova do gatilho: remonta o texto de busca dos órgãos atingidos (no-op com a tabela vazia).
update public.orgaos_catalogo c set atualizado_em = now() from public.orgaos_apelidos a where a.cnpj_raiz = left(c.cnpj, 8)
  and c.busca not like '% ' || public.orgao_normalizar(a.apelidos) || ' %';

-- ---------- Carga do cadastro do PNCP (robô semanal, service_role) ----------
-- p_orgaos: [{"cnpj":"...","nome":"...","esfera":"M","poder":"E","ativo":true}, ...], até 2.000 por chamada. Só grava o que
-- mudou. ativo=false (statusAtivo do PNCP) marca o órgão como inativo: some da busca, a ficha pelo CNPJ continua.
create or replace function public.carregar_cadastro_orgaos(p_orgaos jsonb) returns int
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_n int;
begin
  if jsonb_typeof(p_orgaos) <> 'array' or jsonb_array_length(p_orgaos) > 2000 then
    raise exception 'Envie uma lista de até 2.000 órgãos' using errcode = '22023';
  end if;
  insert into public.orgaos_catalogo as c (cnpj, nome_registro, esfera_registro, poder, ativo)
  select distinct on (x.cnpj) x.cnpj, left(btrim(x.nome), 300), nullif(upper(x.esfera), ''), nullif(upper(x.poder), ''), coalesce(x.ativo, true)
    from jsonb_to_recordset(p_orgaos) as x(cnpj text, nome text, esfera text, poder text, ativo boolean)
   where x.cnpj ~ '^[0-9]{14}$' and length(btrim(coalesce(x.nome, ''))) between 2 and 300
     and coalesce(x.esfera, '') ~ '^[A-Za-z]?$' and coalesce(x.poder, '') ~ '^[A-Za-z]?$'
  on conflict (cnpj) do update set nome_registro = excluded.nome_registro, esfera_registro = excluded.esfera_registro, poder = excluded.poder,
    ativo = excluded.ativo
    where (c.nome_registro, c.esfera_registro, c.poder, c.ativo) is distinct from (excluded.nome_registro, excluded.esfera_registro, excluded.poder, excluded.ativo);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.carregar_cadastro_orgaos(jsonb) from public, anon, authenticated;
grant execute on function public.carregar_cadastro_orgaos(jsonb) to service_role;

-- ---------- Recálculo diário a partir dos dados coletados (pg_cron) ----------
-- Lê as 4 tabelas do robô uma vez (contratos e atas sem abrir o jsonb "dado") e grava só as linhas que mudaram.
-- Órgão que sumiu dos dados coletados: contagens zeradas (nome/cidade ficam); sem cadastro do PNCP, sai do catálogo.
create or replace function public.atualizar_orgaos_catalogo() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_gravados int; v_zerados int; v_removidos int;
begin
  -- pg_temp explícito: numa função security definer o nome sem esquema não pode cair numa tabela de outro esquema.
  create temp table if not exists pg_temp.orgaos_catalogo_novo (like public.orgaos_catalogo including defaults) on commit drop;
  truncate pg_temp.orgaos_catalogo_novo;
  insert into pg_temp.orgaos_catalogo_novo (cnpj, nome_local, esfera_local, uf, municipio, uasgs, unidades, abertas, contratos, atas, itens, ultima_atividade)
  select f.cnpj,
    left(mode() within group (order by f.nome), 300),
    mode() within group (order by f.esfera),
    mode() within group (order by f.uf),
    left(mode() within group (order by f.municipio), 120),
    coalesce((array_agg(distinct f.uasg) filter (where f.uasg is not null))[1:20], '{}'),
    coalesce((array_agg(distinct f.unidade) filter (where f.unidade is not null))[1:15], '{}'),
    sum(f.abertas), sum(f.contratos), sum(f.atas), sum(f.itens), max(f.quando)
  from (
    select left(o.numero_controle_pncp, 14) as cnpj, nullif(o.dado ->> 'orgao', 'Órgão não informado') as nome,
      case when o.dado ->> 'esferaId' ~ '^[A-Z]$' then o.dado ->> 'esferaId' end as esfera,
      case when o.uf ~ '^[A-Z]{2}$' then o.uf end as uf, nullif(o.dado ->> 'municipio', '') as municipio,
      case when o.dado ->> 'codigoUnidade' ~ '^[0-9]{1,8}$' then o.dado ->> 'codigoUnidade' end as uasg, null::text as unidade,
      case when o.encerramento is null or o.encerramento >= v_hoje then 1 else 0 end as abertas, 0 as contratos, 0 as atas, 0 as itens,
      o.publicacao as quando
      from public.oportunidades_abertas o where o.numero_controle_pncp ~ '^[0-9]{14}-'
    union all
    select left(c.numero_controle_pncp, 14), null, null, case when c.uf ~ '^[A-Z]{2}$' then c.uf end, null, null, null, 0, 1, 0, 0, c.data_assinatura
      from public.contratos c where c.numero_controle_pncp ~ '^[0-9]{14}-'
    union all
    select left(a.numero_controle_pncp_ata, 14), null, null, case when a.uf_orgao ~ '^[A-Z]{2}$' then a.uf_orgao end, nullif(a.municipio_orgao, ''),
      null, null, 0, 0, 1, 0, a.data_assinatura
      from public.mercado_atas a where a.numero_controle_pncp_ata ~ '^[0-9]{14}-'
    union all
    select p.orgao_cnpj, p.orgao_nome, null, p.uf, nullif(p.municipio, ''),
      case when p.unidade_codigo ~ '^[0-9]{1,8}$' then p.unidade_codigo end, nullif(left(p.unidade_nome, 120), ''), 0, 0, 0, 1, p.data_inicio
      from public.prospeccao_itens p where p.orgao_cnpj is not null
  ) f
  group by f.cnpj;

  insert into public.orgaos_catalogo as c (cnpj, nome_local, esfera_local, uf, municipio, uasgs, unidades, abertas, contratos, atas, itens, ultima_atividade)
  select n.cnpj, n.nome_local, n.esfera_local, n.uf, n.municipio, n.uasgs, n.unidades, n.abertas, n.contratos, n.atas, n.itens, n.ultima_atividade
    from pg_temp.orgaos_catalogo_novo n
  on conflict (cnpj) do update set nome_local = excluded.nome_local, esfera_local = excluded.esfera_local, uf = excluded.uf,
    municipio = excluded.municipio, uasgs = excluded.uasgs, unidades = excluded.unidades, abertas = excluded.abertas,
    contratos = excluded.contratos, atas = excluded.atas, itens = excluded.itens, ultima_atividade = excluded.ultima_atividade
    where (c.nome_local, c.esfera_local, c.uf, c.municipio, c.uasgs, c.unidades, c.abertas, c.contratos, c.atas, c.itens, c.ultima_atividade)
      is distinct from (excluded.nome_local, excluded.esfera_local, excluded.uf, excluded.municipio, excluded.uasgs, excluded.unidades,
        excluded.abertas, excluded.contratos, excluded.atas, excluded.itens, excluded.ultima_atividade);
  get diagnostics v_gravados = row_count;

  delete from public.orgaos_catalogo c where c.nome_registro is null and not exists (select 1 from pg_temp.orgaos_catalogo_novo n where n.cnpj = c.cnpj);
  get diagnostics v_removidos = row_count;
  update public.orgaos_catalogo c set abertas = 0, contratos = 0, atas = 0, itens = 0
   where (c.abertas, c.contratos, c.atas, c.itens) <> (0, 0, 0, 0) and not exists (select 1 from pg_temp.orgaos_catalogo_novo n where n.cnpj = c.cnpj);
  get diagnostics v_zerados = row_count;
  return jsonb_build_object('orgaos_com_dados', (select count(*) from pg_temp.orgaos_catalogo_novo), 'gravados', v_gravados,
    'zerados', v_zerados, 'removidos', v_removidos);
end $$;
revoke all on function public.atualizar_orgaos_catalogo() from public, anon, authenticated;
grant execute on function public.atualizar_orgaos_catalogo() to service_role;

-- ---------- Busca (autocompletar da ficha do órgão) ----------
-- termo: CNPJ (14 dígitos, com ou sem máscara; ou os 8 da raiz), UASG (5 a 7 dígitos) ou palavras do nome/cidade/sigla.
-- uf: opcional (só órgãos com UF conhecida pelos dados coletados). limite: 1 a 20 (padrão 8).
-- Modo "parecido" sem o GUC pg_trgm.word_similarity_threshold: no Supabase o papel postgres não pode fixá-lo no SET da
-- função ("permission denied to set parameter"). Em vez do operador <%, o índice filtra pelas 3 primeiras letras de cada
-- palavra (erro de digitação quase nunca está no começo) e word_similarity confere palavra por palavra.
drop function if exists public.buscar_orgaos(text, text, int);
create function public.buscar_orgaos(p_termo text, p_uf text default null, p_limite int default 8)
returns table (cnpj text, nome text, uf text, municipio text, esfera text, uasgs text[], abertas int, contratos int, atas int,
  ultima_atividade date, exato boolean, relevancia real)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare
  v_termo text := left(btrim(coalesce(p_termo, '')), 120);
  v_dig text := regexp_replace(v_termo, '\D', '', 'g');
  v_uf text := case when upper(btrim(coalesce(p_uf, ''))) ~ '^[A-Z]{2}$' then upper(btrim(p_uf)) end;
  v_lim int := least(greatest(coalesce(p_limite, 8), 1), 20);
  v_palavras text[];
  v_q text;
  v_chave text;
  v_filtro text := '';
  v_p text;
  v_pad text[];
  v_achou boolean := false;
begin
  if not public.cliente_aprovado() then
    raise exception 'A busca de órgãos é só para cadastro aprovado' using errcode = '42501';
  end if;
  -- Só números (e máscara): CNPJ, raiz do CNPJ ou UASG.
  if v_termo ~ '^[0-9./\s-]+$' and length(v_dig) >= 4 then
    return query
      select c.cnpj, c.nome, c.uf, c.municipio, c.esfera, c.uasgs[1:5], c.abertas, c.contratos, c.atas, c.ultima_atividade,
        (c.cnpj = v_dig or v_dig = any(c.uasgs)),
        ((case when c.cnpj = v_dig or v_dig = any(c.uasgs) then 2 else 1 end)
          + least(ln(1 + c.abertas * 5 + c.contratos + c.atas + c.itens / 20) / 8, 0.6)
          + case when substr(c.cnpj, 9, 4) = '0001' then 0.05 else 0 end)::real
        from public.orgaos_catalogo c
       where (c.cnpj = v_dig or (length(v_dig) between 8 and 13 and c.cnpj like v_dig || '%') or (length(v_dig) between 4 and 8 and v_dig = any(c.uasgs)))
         and c.nome is not null and c.ativo and (v_uf is null or c.uf = v_uf)
       order by 12 desc, c.cnpj limit v_lim;
    return;
  end if;

  select coalesce(array_agg(w order by n), '{}') into v_palavras from (
    select w, n from regexp_split_to_table(public.orgao_normalizar(v_termo), ' ') with ordinality t(w, n)
     where w <> '' and w not in ('de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'na', 'no', 'nas', 'nos', 'ao', 'aos')
     limit 8) s;
  if cardinality(v_palavras) = 0 or length(array_to_string(v_palavras, '')) < 2 then return; end if;
  v_q := array_to_string(v_palavras, ' ');
  v_chave := public.orgao_chave_nome(v_termo);

  -- Toda palavra tem de casar com o começo de uma palavra do texto de busca (qualquer ordem). Palavras são [a-z0-9]
  -- (normalizadas), então o literal do LIKE não tem curinga nem aspas; %L protege mesmo assim.
  foreach v_p in array v_palavras loop
    select array_agg(format('c.busca like %L', '% ' || x || case when length(v_p) <= 2 then ' %' else '%' end)) into v_pad
      from unnest(public.orgao_variantes(v_p)) x;
    v_filtro := v_filtro || ' and (' || array_to_string(v_pad, ' or ') || ')';
  end loop;

  return query execute format($q$
    with cand as (
      select distinct on (c.nome_chave, coalesce(c.uf, '')) c.nome_chave, c.cnpj, c.nome, c.uf, c.municipio, c.esfera,
          c.uasgs[1:5] as uasgs, c.abertas, c.contratos, c.atas, c.ultima_atividade, c.nome_chave = $1 as exato,
          ((case when c.nome_chave = $1 then 1 else 0 end) + word_similarity($2, c.nome_norm) + 0.5 * similarity($2, c.nome_norm)
            + (case when c.nome_norm like $3 || '%%' then 0.2 else 0 end)
            + least(ln(1 + c.abertas * 5 + c.contratos + c.atas + c.itens / 20) / 8, 0.6)
            + (case when substr(c.cnpj, 9, 4) = '0001' then 0.05 else 0 end))::real as relevancia
        from public.orgaos_catalogo c
       where c.nome is not null and c.ativo and ($4::text is null or c.uf = $4) %s
       order by c.nome_chave, coalesce(c.uf, ''), relevancia desc, c.cnpj)
    -- Mesmo nome sem UF (filial só do cadastro) some quando há um com UF (com dados coletados).
    select r.cnpj, r.nome, r.uf, r.municipio, r.esfera, r.uasgs, r.abertas, r.contratos, r.atas, r.ultima_atividade, r.exato, r.relevancia
      from cand r where r.uf is not null or not exists (select 1 from cand o where o.nome_chave = r.nome_chave and o.uf is not null)
     order by r.relevancia desc, r.nome limit $5$q$, v_filtro)
    using v_chave, v_q, v_palavras[1], v_uf, v_lim;
  get diagnostics v_lim = row_count;
  v_achou := v_lim > 0;
  if v_achou then return; end if;
  v_filtro := '';
  foreach v_p in array v_palavras loop
    if length(v_p) >= 3 then v_filtro := v_filtro || format(' and c.busca like %L', '% ' || left(v_p, 3) || '%'); end if;
  end loop;
  if v_filtro = '' then return; end if;

  -- Nada com todas as palavras: parecido (erro de digitação, palavra a mais). Mesmo formato, relevância menor.
  v_lim := least(greatest(coalesce(p_limite, 8), 1), 20);
  return query execute format($q$
    with cand as (
      select distinct on (c.nome_chave, coalesce(c.uf, '')) c.nome_chave, c.cnpj, c.nome, c.uf, c.municipio, c.esfera,
          c.uasgs[1:5] as uasgs, c.abertas, c.contratos, c.atas, c.ultima_atividade,
          -- A nota compara com o nome; com o texto de busca o "municipio" do apelido empataria tudo.
          (word_similarity($1, c.nome_norm) + 0.5 * similarity($1, c.nome_norm)
            + least(ln(1 + c.abertas * 5 + c.contratos + c.atas + c.itens / 20) / 8, 0.6) * 0.5)::real as relevancia
        from public.orgaos_catalogo c
       where c.nome is not null and c.ativo and ($2::text is null or c.uf = $2) %s
         and word_similarity($1, c.busca) >= 0.5
         -- Cada palavra (3+ letras) tem de aparecer parecida: "secretaria saude" não traz secretaria sem saúde.
         and not exists (select 1 from unnest($3::text[]) w where length(w) >= 3 and word_similarity(w, c.busca) < 0.5)
       order by c.nome_chave, coalesce(c.uf, ''), relevancia desc, c.cnpj)
    select r.cnpj, r.nome, r.uf, r.municipio, r.esfera, r.uasgs, r.abertas, r.contratos, r.atas, r.ultima_atividade, false, r.relevancia
      from cand r where r.uf is not null or not exists (select 1 from cand o where o.nome_chave = r.nome_chave and o.uf is not null)
     order by r.relevancia desc, r.nome limit $4$q$, v_filtro)
    using v_q, v_uf, v_palavras, v_lim;
end $$;
revoke all on function public.buscar_orgaos(text, text, int) from public, anon;
grant execute on function public.buscar_orgaos(text, text, int) to authenticated, service_role;

-- ---------- Agenda diária (pg_cron) ----------
-- 12:40 UTC = 09:40 de Brasília, depois do atualizar-dados.yml (09:00 UTC). statement_timeout elevado só neste comando:
-- o recálculo lê contratos e prospeccao_itens inteiros e pode passar dos 2 min padrão. Sem pg_cron: nada é agendado
-- (ligue em Database > Extensions e rode este arquivo de novo).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('orgaos_catalogo_diario', '40 12 * * *', 'set statement_timeout = ''15min''; select public.atualizar_orgaos_catalogo()');
  else
    raise notice 'pg_cron não está ligado: o recálculo diário do catálogo de órgãos não foi agendado.';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
