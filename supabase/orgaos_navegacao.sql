-- Navegação de órgãos sem digitar (24/11/2026). Idempotente (seguro rodar mais de uma vez), transação única; só acrescenta
-- colunas, índices e funções ao catálogo de órgãos (não apaga dado). Rodar no SQL Editor do Supabase DEPOIS de
-- orgaos_catalogo.sql (e de novo sempre que orgaos_catalogo.sql for rodado de novo: este arquivo substitui a
-- carregar_cadastro_orgaos de lá por uma versão que também grava a natureza jurídica).
-- Teste: scripts/orgaos_navegacao_sql.test.js (PGlite, roda orgaos_catalogo.sql + este arquivo, 2 vezes).
--
-- POR QUE EXISTE
--   O dono: "a gente não é obrigado a saber o nome, o CNPJ ou a UASG". Escolhendo só a UF (ex.: Acre) a tela não
--   mostrava nada: a busca exigia texto, e órgão que só está no cadastro do PNCP não tinha UF (o cadastro do PNCP não
--   traz UF nem cidade; elas vêm das unidades do órgão, 1 chamada por CNPJ).
--
-- O QUE TEM
--   Colunas novas em orgaos_catalogo:
--     natureza (código da natureza jurídica do cadastro do PNCP), uf_registro/municipio_registro (das unidades do órgão no
--     PNCP, gravadas pelo robô scripts/atualizar_cadastro_orgaos.js), local_consultado_em, municipio_norm e tipo.
--     A UF/cidade dos dados coletados continua mandando; a do PNCP só preenche quando ela falta.
--   orgao_tipo(nome normalizado, natureza, esfera): grupo do órgão para a lista (regras abaixo, testadas).
--   listar_orgaos(uf, municipio, tipo, esfera, so_abertas, ordem, limite, offset, termo, agrupar): a lista para escolher,
--     um órgão por raiz do CNPJ + nome + UF (matriz e filiais juntas, contagens somadas), com o total e a contagem por tipo.
--   listar_municipios_orgaos(uf): cidades da UF que têm órgão no catálogo.
--   orgaos_mesmo_ente(cnpj): na ficha de prefeitura/câmara/governo do estado, os outros órgãos da mesma cidade (ou do mesmo
--     governo) com contratos e valor, e a soma de todos (a prefeitura quase não publica contrato; as secretarias publicam).
--   orgaos_sem_local / gravar_local_orgaos: fila do robô que busca UF e cidade nas unidades do PNCP (só service_role).
--
-- SEGURANÇA: as funções de leitura são security definer, exigem cliente_aprovado(), search_path fixo, sem execução para
--   anon. As do robô só para service_role. A tabela continua sem grant para os papéis do PostgREST.
--
-- ESPAÇO E TEMPO: 6 colunas curtas + 3 índices parciais (~10-15 MB com ~98 mil órgãos). O preenchimento do tipo dos órgãos
--   que já estão no catálogo roda aqui mesmo, com o gatilho pesado (texto de busca) desligado só durante esse update:
--   segundos. A lista lê só os órgãos da UF (até ~10 mil em SP): milissegundos.
--
-- COMO RODAR EM PRODUÇÃO (nesta ordem)
--   1. orgaos_catalogo.sql já aplicado (está em produção).
--   2. Este arquivo inteiro no SQL Editor (Run).
--   3. GitHub Actions > "Local dos órgãos (PNCP)" > Run workflow. O robô recarrega o cadastro uma vez (para gravar a
--      natureza jurídica) e começa a buscar UF e cidade dos órgãos sem UF; continua sozinho de hora em hora (50 min, 20 chamadas/min ao PNCP) até acabar
--      (~98 mil órgãos, ~4 dias; depois só os novos e os que falharam).
--   Voltar atrás: drop function public.orgaos_mesmo_ente(text), public.listar_orgaos(text, text, text, text, boolean, text, int, int, text, boolean),
--     public.listar_municipios_orgaos(text), public.orgaos_sem_local(int), public.gravar_local_orgaos(jsonb);
--     drop trigger orgaos_catalogo_local on public.orgaos_catalogo; e rodar orgaos_catalogo.sql de novo. As colunas novas
--     podem ficar (ninguém mais as lê).
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.orgaos_catalogo') is null or to_regprocedure('public.orgao_normalizar(text)') is null
    or to_regprocedure('public.cliente_aprovado()') is null then
    raise exception 'Aplique antes supabase/orgaos_catalogo.sql';
  end if;
end $$;
set local search_path = public, extensions;

alter table public.orgaos_catalogo
  add column if not exists natureza text check (natureza is null or natureza ~ '^[0-9]{4}$'),
  add column if not exists uf_registro text check (uf_registro is null or uf_registro ~ '^[A-Z]{2}$'),
  add column if not exists municipio_registro text check (municipio_registro is null or length(municipio_registro) <= 120),
  add column if not exists local_consultado_em date,
  -- Erros seguidos do PNCP (não 404) na consulta das unidades: empurram o órgão para o fim da fila (orgaos_sem_local).
  add column if not exists local_falhas int not null default 0,
  add column if not exists municipio_norm text,
  add column if not exists tipo text not null default 'outros',
  -- Ordem na fila do robô das unidades (0 = primeiro), calculada pelo gatilho: a fila lê só um índice parcial com ela.
  add column if not exists local_prioridade smallint not null default 7;

-- ---------- Tipo do órgão ----------
-- Entrada: nome já normalizado (orgao_normalizar: minúsculo, sem acento), natureza jurídica do cadastro do PNCP (tabela da
-- Receita: 1244 Município, 1066 Legislativo municipal, 1104 Autarquia federal...) e esfera (M/E/F/D/N).
-- Ordem importa: o primeiro grupo que casa vence. Assunto do nome (câmara, tribunal, quartel, hospital, universidade,
-- escola) vem antes da esfera, porque "Fundo Municipal de Saúde" interessa mais como Saúde do que como municipal.
create or replace function public.orgao_tipo(p_norm text, p_natureza text, p_esfera text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  n text := ' ' || coalesce(p_norm, '') || ' ';
  nat text := coalesce(p_natureza, '');
  esf text := upper(coalesce(p_esfera, ''));
begin
  if nat in ('1210', '1228') or n ~ ' consorcio ' then return 'consorcio'; end if;
  if n ~ ' (camara (municipal|de vereadores|dos deputados|legislativa)|assembleia legislativa|senado federal) ' then return 'legislativo'; end if;
  -- Tribunal de Contas tem natureza do Legislativo (1058), mas quem procura espera achar junto dos tribunais.
  if nat in ('1074', '1082')
    or n ~ ' (tribunal|ministerio publico|defensoria publica|procuradoria geral de justica|justica (federal|eleitoral|militar|do trabalho)) ' then return 'justica'; end if;
  if nat in ('1040', '1058', '1066') then return 'legislativo'; end if;
  if n ~ ' (comando da (aeronautica|marinha)|comando do exercito|exercito|marinha|aeronautica|forca aerea|ministerio da defesa|policia|bombeiros?|batalhao|guarda municipal|seguranca publica|penitenciari[ao]|sistema prisional|administracao penitenciaria) ' then return 'seguranca'; end if;
  -- Hospital universitário é Saúde; universidade "de ciências da saúde" é Universidade: por isso a saúde forte vem antes.
  if n ~ ' (hospital|hospitais|maternidade|hemocentro|pronto socorro|policlinica|ebserh) ' then return 'saude'; end if;
  if n ~ ' (universidade|universitario|universitaria|instituto federal|faculdade|cefet|colegio pedro ii|escola tecnica federal|centro federal de educacao tecnologica) ' then return 'universidade'; end if;
  if n ~ ' (saude|sus|samu|vigilancia sanitaria) ' then return 'saude'; end if;
  if n ~ ' (educacao|escola|escolas|ensino|fundeb|creche|educacional) ' then return 'educacao'; end if;
  if nat in ('1104', '1112', '1120', '1139', '1147', '1155', '1252', '1260', '1279')
    or n ~ '^ (autarquia|fundacao|agencia|instituto|servico autonomo|departamento (estadual|municipal|nacional)) ' or n ~ ' (saae|autarquia) ' then return 'autarquia'; end if;
  -- Prefeitura = o próprio município ("MUNICIPIO DE X", "X PREFEITURA", "PREFEITURA MUNICIPAL DE X"), sem secretaria/fundo.
  if (esf = 'M' or nat in ('1244', '1031'))
    and (n ~ '^ (prefeitura|municipio) ' or n ~ ' prefeitura( municipal)? $')
    and n !~ ' (secretaria|fundo|gabinete|procuradoria|controladoria|superintendencia|coordenadoria|departamento|previdencia|companhia|empresa|conselho|servico|instituto) ' then return 'prefeitura'; end if;
  if esf = 'M' or nat in ('1031', '1180', '1244', '1309', '1333') then return 'municipal'; end if;
  if esf in ('E', 'D') or nat in ('1023', '1171', '1236', '1295', '1325') then return 'estadual'; end if;
  if esf = 'F' or nat in ('1015', '1163', '1287', '1317', '1341') then return 'federal'; end if;
  return 'outros';
end $$;
revoke all on function public.orgao_tipo(text, text, text) from public, anon, authenticated;

-- Ordem dos grupos na lista (Prefeituras primeiro: é o que mais se procura).
create or replace function public.orgao_tipo_ordem(p_tipo text) returns int
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(array_position(array['prefeitura', 'legislativo', 'municipal', 'estadual', 'justica', 'universidade', 'seguranca',
    'saude', 'educacao', 'autarquia', 'consorcio', 'federal', 'outros'], p_tipo), 99)
$$;
revoke all on function public.orgao_tipo_ordem(text) from public, anon, authenticated;

do $$ begin
  alter table public.orgaos_catalogo add constraint orgaos_catalogo_tipo_check check (tipo in ('prefeitura', 'legislativo', 'municipal',
    'estadual', 'justica', 'universidade', 'seguranca', 'saude', 'educacao', 'autarquia', 'consorcio', 'federal', 'outros'));
exception when duplicate_object then null; end $$;

-- Prioridade na fila do robô das unidades: prefeitura, câmara/assembleia e governo do estado primeiro (a ficha deles lista
-- as secretarias e precisa da UF/cidade), depois quem tem atividade (aberta, contrato, ata), depois a matriz. 0 a 7.
create or replace function public.orgao_prioridade_local(p_tipo text, p_norm text, p_natureza text, p_atividade int, p_cnpj text) returns smallint
language sql immutable parallel safe set search_path = '' as $$
  select ((case when p_tipo in ('prefeitura', 'legislativo')
                  or (p_tipo = 'estadual' and (p_natureza = '1236' or coalesce(p_norm, '') ~ '^(estado|governo) ')) then 0 else 4 end)
        + (case when coalesce(p_atividade, 0) > 0 then 0 else 2 end)
        + (case when substr(p_cnpj, 9, 4) = '0001' then 0 else 1 end))::smallint
$$;
revoke all on function public.orgao_prioridade_local(text, text, text, int, text) from public, anon, authenticated;

-- ---------- Gatilho: UF/cidade de reserva, cidade normalizada, tipo e prioridade na fila ----------
-- Nome "..._local" < "..._montar": o Postgres dispara os gatilhos BEFORE em ordem alfabética, então a UF e a cidade de
-- reserva já estão em new quando orgaos_catalogo_montar monta o texto de busca.
create or replace function public.orgaos_catalogo_local() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_norm text := public.orgao_normalizar(coalesce(nullif(btrim(new.nome_registro), ''), new.nome_local));
begin
  new.uf := coalesce(new.uf, new.uf_registro);
  new.municipio := coalesce(nullif(btrim(new.municipio), ''), new.municipio_registro);
  new.municipio_norm := nullif(public.orgao_normalizar(new.municipio), '');
  new.tipo := public.orgao_tipo(v_norm, new.natureza, coalesce(new.esfera_registro, new.esfera_local));
  new.local_prioridade := public.orgao_prioridade_local(new.tipo, v_norm, new.natureza, new.abertas + new.contratos + new.atas, new.cnpj);
  return new;
end $$;
revoke all on function public.orgaos_catalogo_local() from public, anon, authenticated, service_role;
drop trigger if exists orgaos_catalogo_local on public.orgaos_catalogo;
create trigger orgaos_catalogo_local before insert or update on public.orgaos_catalogo
  for each row execute function public.orgaos_catalogo_local();

-- Órgãos já no catálogo: tipo, cidade normalizada e prioridade na fila. O gatilho do texto de busca fica desligado só neste update (o texto
-- não muda: UF e cidade de reserva ainda estão vazias), para levar segundos em vez de minutos.
alter table public.orgaos_catalogo disable trigger orgaos_catalogo_montar;
update public.orgaos_catalogo c set tipo = c.tipo
 where c.tipo is distinct from public.orgao_tipo(public.orgao_normalizar(coalesce(nullif(btrim(c.nome_registro), ''), c.nome_local)), c.natureza,
         coalesce(c.esfera_registro, c.esfera_local))
    or c.municipio_norm is distinct from nullif(public.orgao_normalizar(c.municipio), '')
    or c.local_prioridade is distinct from public.orgao_prioridade_local(c.tipo,
         public.orgao_normalizar(coalesce(nullif(btrim(c.nome_registro), ''), c.nome_local)), c.natureza, c.abertas + c.contratos + c.atas, c.cnpj);
alter table public.orgaos_catalogo enable trigger orgaos_catalogo_montar;

create index if not exists orgaos_catalogo_uf_tipo_idx on public.orgaos_catalogo (uf, tipo) where ativo and nome is not null;
create index if not exists orgaos_catalogo_uf_municipio_idx on public.orgaos_catalogo (uf, municipio_norm) where ativo and nome is not null;
-- "Mais licitações abertas agora" no Brasil todo: só os poucos milhares com aberta.
create index if not exists orgaos_catalogo_abertas_idx on public.orgaos_catalogo (abertas desc) where abertas > 0 and ativo and nome is not null;
-- Fila do robô das unidades (orgaos_sem_local): etapa 1 (nunca consultados, pela prioridade) e etapa 2 (reconsulta, do mais
-- antigo). Parciais: só os órgãos sem UF; encolhem conforme o robô avança.
create index if not exists orgaos_catalogo_fila_nova_idx on public.orgaos_catalogo (local_prioridade, cnpj)
  where uf is null and ativo and local_consultado_em is null;
create index if not exists orgaos_catalogo_fila_reconsulta_idx on public.orgaos_catalogo (local_consultado_em, cnpj)
  where uf is null and ativo and local_consultado_em is not null;

-- ---------- Carga do cadastro do PNCP, agora com a natureza jurídica (substitui a de orgaos_catalogo.sql) ----------
create or replace function public.carregar_cadastro_orgaos(p_orgaos jsonb) returns int
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_n int;
begin
  if jsonb_typeof(p_orgaos) <> 'array' or jsonb_array_length(p_orgaos) > 2000 then
    raise exception 'Envie uma lista de até 2.000 órgãos' using errcode = '22023';
  end if;
  insert into public.orgaos_catalogo as c (cnpj, nome_registro, esfera_registro, poder, ativo, natureza)
  select distinct on (x.cnpj) x.cnpj, left(btrim(x.nome), 300), nullif(upper(x.esfera), ''), nullif(upper(x.poder), ''), coalesce(x.ativo, true),
      case when x.natureza ~ '^[0-9]{4}$' then x.natureza end
    from jsonb_to_recordset(p_orgaos) as x(cnpj text, nome text, esfera text, poder text, ativo boolean, natureza text)
   where x.cnpj ~ '^[0-9]{14}$' and length(btrim(coalesce(x.nome, ''))) between 2 and 300
     and coalesce(x.esfera, '') ~ '^[A-Za-z]?$' and coalesce(x.poder, '') ~ '^[A-Za-z]?$'
  on conflict (cnpj) do update set nome_registro = excluded.nome_registro, esfera_registro = excluded.esfera_registro, poder = excluded.poder,
    ativo = excluded.ativo, natureza = coalesce(excluded.natureza, c.natureza)
    where (c.nome_registro, c.esfera_registro, c.poder, c.ativo, c.natureza)
      is distinct from (excluded.nome_registro, excluded.esfera_registro, excluded.poder, excluded.ativo, coalesce(excluded.natureza, c.natureza));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.carregar_cadastro_orgaos(jsonb) from public, anon, authenticated;
grant execute on function public.carregar_cadastro_orgaos(jsonb) to service_role;

-- ---------- Fila do robô: UF e cidade pelas unidades do órgão no PNCP ----------
-- Órgão sem UF, em 2 etapas, cada uma lendo só o seu índice parcial (a ordenação sobre ~98 mil linhas sem índice estourou o
-- statement_timeout em produção, 25/11):
--   1. nunca consultados, por local_prioridade (prefeitura/câmara/governo, ativos, matriz primeiro);
--   2. se sobrar espaço no lote, reconsulta, do mais antigo: sem unidade no PNCP (404) depois de 30 dias; com erro do PNCP
--      (local_falhas) no dia seguinte, e com 3 falhas ou mais só depois de 7 dias. Quem falha fica atrás de todos os novos.
create or replace function public.orgaos_sem_local(p_limite int default 500) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_lim int := least(greatest(coalesce(p_limite, 500), 1), 2000);
  v_novos jsonb;
  v_resto jsonb;
begin
  select coalesce(jsonb_agg(s.cnpj), '[]'::jsonb) into v_novos from (
    select c.cnpj from public.orgaos_catalogo c
     where c.uf is null and c.ativo and c.local_consultado_em is null
     order by c.local_prioridade, c.cnpj limit v_lim) s;
  if jsonb_array_length(v_novos) >= v_lim then return v_novos; end if;
  select coalesce(jsonb_agg(s.cnpj), '[]'::jsonb) into v_resto from (
    select c.cnpj from public.orgaos_catalogo c
     where c.uf is null and c.ativo and c.local_consultado_em is not null
       and c.local_consultado_em < current_date
       and ((c.local_falhas = 0 and c.local_consultado_em < current_date - 30)
         or c.local_falhas between 1 and 2
         or (c.local_falhas >= 3 and c.local_consultado_em < current_date - 7))
     order by c.local_consultado_em, c.cnpj limit v_lim - jsonb_array_length(v_novos)) s;
  return v_novos || v_resto;
end $$;
revoke all on function public.orgaos_sem_local(int) from public, anon, authenticated;
grant execute on function public.orgaos_sem_local(int) to service_role;

-- p_locais: [{"cnpj":"...","uf":"AC","municipio":"Rio Branco"}, ...]; uf null = o PNCP não tem unidade (marca a consulta);
-- {"cnpj":"...","falhou":true} = erro do PNCP (soma 1 em local_falhas, não mexe na UF). Resposta boa zera as falhas.
create or replace function public.gravar_local_orgaos(p_locais jsonb) returns int
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_n int;
begin
  if jsonb_typeof(p_locais) <> 'array' or jsonb_array_length(p_locais) > 2000 then
    raise exception 'Envie uma lista de até 2.000 órgãos' using errcode = '22023';
  end if;
  update public.orgaos_catalogo c set
      uf_registro = case when x.falhou then c.uf_registro else x.uf end,
      municipio_registro = case when x.falhou then c.municipio_registro else nullif(left(btrim(x.municipio), 120), '') end,
      local_falhas = case when x.falhou then least(c.local_falhas + 1, 100) else 0 end,
      local_consultado_em = current_date
    from (select distinct on (y.cnpj) y.cnpj, y.uf, y.municipio, coalesce(y.falhou, false) as falhou
            from jsonb_to_recordset(p_locais) as y(cnpj text, uf text, municipio text, falhou boolean)) x
   where c.cnpj = x.cnpj and x.cnpj ~ '^[0-9]{14}$' and (x.uf is null or x.uf ~ '^[A-Z]{2}$')
     and (x.uf is not null or x.municipio is null);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.gravar_local_orgaos(jsonb) from public, anon, authenticated;
grant execute on function public.gravar_local_orgaos(jsonb) to service_role;

-- ---------- Lista para escolher (tela orgao.html) ----------
-- p_uf: uma UF ou várias separadas por vírgula ("AM,PA"); vazio = Brasil. p_municipio: nome da cidade (sem acento ou com).
-- p_tipo: um dos grupos de orgao_tipo. p_esfera: M/E/F/D. p_so_abertas: só quem tem licitação aberta agora.
-- p_ordem: 'abertas' (padrão), 'contratos' ou 'nome'. p_termo: palavras do nome/cidade/sigla (mesma regra de começo de
-- palavra e sinônimos da buscar_orgaos). p_agrupar: ordena primeiro pelo grupo (a tela mostra um título por grupo).
-- Devolve {"total": n, "tipos": {"prefeitura": n, ...}, "itens": [...]}; "tipos" conta sem o filtro de tipo (para os botões).
drop function if exists public.listar_orgaos(text, text, text, text, boolean, text, int, int, text, boolean);
create function public.listar_orgaos(p_uf text default null, p_municipio text default null, p_tipo text default null,
  p_esfera text default null, p_so_abertas boolean default false, p_ordem text default 'abertas', p_limite int default 30,
  p_offset int default 0, p_termo text default null, p_agrupar boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_ufs text[] := (select array_agg(distinct u) from unnest(regexp_split_to_array(upper(coalesce(p_uf, '')), '[^A-Z]+')) u where u ~ '^[A-Z]{2}$');
  v_mun text := nullif(public.orgao_normalizar(left(p_municipio, 120)), '');
  v_tipo text := case when public.orgao_tipo_ordem(p_tipo) < 99 then p_tipo end;
  v_esf text := case when upper(coalesce(p_esfera, '')) in ('M', 'E', 'F', 'D') then upper(p_esfera) end;
  v_ordem text := case when p_ordem in ('contratos', 'nome') then p_ordem else 'abertas' end;
  v_lim int := least(greatest(coalesce(p_limite, 30), 1), 60);
  v_off int := least(greatest(coalesce(p_offset, 0), 0), 5000);
  v_palavras text[];
  v_raizes text[];
  v_r jsonb;
begin
  if not public.cliente_aprovado() then
    raise exception 'A lista de órgãos é só para cadastro aprovado' using errcode = '42501';
  end if;
  -- "Só abertas": antes de agrupar, só as raízes de CNPJ com alguma aberta (índice parcial de abertas, poucos milhares);
  -- sem isso o bloco "no Brasil" da tela inicial lia o catálogo inteiro. As filiais sem aberta continuam somando contratos.
  if coalesce(p_so_abertas, false) then
    select coalesce(array_agg(distinct left(a.cnpj, 8)), '{}') into v_raizes from public.orgaos_catalogo a
     where a.abertas > 0 and a.ativo and a.nome is not null and (v_ufs is null or a.uf = any(v_ufs));
  end if;
  select coalesce(array_agg(w), '{}') into v_palavras from (
    select w from regexp_split_to_table(public.orgao_normalizar(left(p_termo, 120)), ' ') w
     where w <> '' and w not in ('de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'na', 'no', 'nas', 'nos', 'ao', 'aos') limit 8) s;

  with base as (
    select c.cnpj, c.nome, c.nome_chave, c.nome_norm, c.uf, c.municipio, c.municipio_norm, c.esfera, c.tipo, c.abertas, c.contratos, c.atas, c.ultima_atividade
      from public.orgaos_catalogo c
     where c.ativo and c.nome is not null
       and (v_ufs is null or c.uf = any(v_ufs))
       and (v_mun is null or c.municipio_norm = v_mun)
       and (v_esf is null or c.esfera = v_esf)
       and (v_raizes is null or left(c.cnpj, 8) = any(v_raizes))
       -- Toda palavra casa com o começo de uma palavra do texto de busca (ou de um sinônimo dela).
       and not exists (select 1 from unnest(v_palavras) w
                        where not exists (select 1 from unnest(public.orgao_variantes(w)) x
                                           where c.busca like '% ' || x || case when length(w) <= 2 then ' %' else '%' end))),
  -- Matriz e filiais do mesmo órgão na mesma UF viram uma linha (o cadastro tem centenas de "COMANDO DA AERONAUTICA").
  grupos as (
    select (array_agg(b.cnpj order by (substr(b.cnpj, 9, 4) = '0001') desc, b.abertas desc, b.contratos + b.atas desc, b.cnpj))[1] as cnpj,
      sum(b.abertas)::int as abertas, sum(b.contratos)::int as contratos, sum(b.atas)::int as atas, max(b.ultima_atividade) as ultima_atividade,
      count(*)::int as cnpjs
      from base b group by left(b.cnpj, 8), b.nome_chave, b.uf
    having not p_so_abertas or sum(b.abertas) > 0),
  linhas as (
    select g.cnpj, b.nome, b.nome_norm, b.uf, b.municipio, b.municipio_norm, b.esfera, b.tipo, g.abertas, g.contratos, g.atas, g.ultima_atividade, g.cnpjs
      from grupos g join base b on b.cnpj = g.cnpj),
  escolhidas as (select * from linhas l where v_tipo is null or l.tipo = v_tipo),
  pagina as (
    select e.*, row_number() over (order by
        case when p_agrupar and v_tipo is null then public.orgao_tipo_ordem(e.tipo) end,
        case when v_ordem = 'abertas' then e.abertas end desc,
        case when v_ordem in ('abertas', 'contratos') then e.contratos + e.atas end desc,
        case when v_ordem = 'contratos' then e.abertas end desc,
        e.nome_norm, e.cnpj) as n
      from escolhidas e)
  select jsonb_build_object(
    'total', (select count(*) from escolhidas),
    'tipos', (select coalesce(jsonb_object_agg(t.tipo, t.n), '{}'::jsonb) from (select l.tipo, count(*) as n from linhas l group by l.tipo) t),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('cnpj', p.cnpj, 'nome', p.nome, 'uf', p.uf, 'municipio', p.municipio, 'esfera', p.esfera,
        'tipo', p.tipo, 'abertas', p.abertas, 'contratos', p.contratos, 'atas', p.atas, 'ultima_atividade', p.ultima_atividade, 'cnpjs', p.cnpjs,
        -- Prefeitura quase não publica contrato: quem publica são as secretarias e fundos (CNPJ próprio). A tela mostra o atalho.
        'secretarias', case when p.tipo = 'prefeitura' and p.municipio_norm is not null then (
          select count(distinct left(o.cnpj, 8) || o.nome_chave) from public.orgaos_catalogo o
           where o.uf = p.uf and o.municipio_norm = p.municipio_norm and o.esfera = 'M' and o.ativo and o.nome is not null
             and left(o.cnpj, 8) <> left(p.cnpj, 8)) end) order by p.n)
      from pagina p where p.n > v_off and p.n <= v_off + v_lim), '[]'::jsonb))
    into v_r;
  return v_r;
end $$;
revoke all on function public.listar_orgaos(text, text, text, text, boolean, text, int, int, text, boolean) from public, anon;
grant execute on function public.listar_orgaos(text, text, text, text, boolean, text, int, int, text, boolean) to authenticated, service_role;

-- ---------- Órgãos do mesmo ente (ficha de prefeitura, câmara ou governo do estado) ----------
-- Prefeitura de Manaus não publica contratos: quem publica são SEMSA, SEMINF, ManausPrev..., cada uma com CNPJ próprio. O
-- mesmo no Estado. Para prefeitura/câmara: órgãos municipais da mesma cidade; para governo do estado/assembleia: órgãos
-- estaduais da UF. Um por raiz do CNPJ + nome (como a lista), com contratos e valor dos contratos coletados, e a soma de
-- todos (inclusive o próprio). Outro tipo de órgão: null (a ficha não mostra a seção).
drop function if exists public.orgaos_mesmo_ente(text);
create function public.orgaos_mesmo_ente(p_cnpj text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_dig text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  c public.orgaos_catalogo%rowtype;
  v_ente text;
  v_r jsonb;
begin
  if not public.cliente_aprovado() then
    raise exception 'A lista de órgãos é só para cadastro aprovado' using errcode = '42501';
  end if;
  if v_dig !~ '^[0-9]{14}$' then return null; end if;
  -- O CNPJ aberto ou outro da mesma raiz (a ficha soma matriz e filiais): o que tem cidade e é matriz primeiro.
  select o.* into c from public.orgaos_catalogo o where o.cnpj between left(v_dig, 8) || '000000' and left(v_dig, 8) || '999999'
   order by (o.uf is not null) desc, (o.cnpj = v_dig) desc, (o.municipio_norm is not null) desc, (substr(o.cnpj, 9, 4) = '0001') desc, o.cnpj limit 1;
  if not found then return null; end if;
  v_ente := case
    when c.esfera = 'M' and c.tipo in ('prefeitura', 'legislativo') then 'municipio'
    when c.esfera in ('E', 'D') and (c.tipo = 'legislativo' or c.nome_chave ~ '^estado ' or c.natureza = '1236') then 'estado' end;
  if v_ente is null then return null; end if;
  -- Prefeitura/governo ainda sem UF (ou cidade): o robô das unidades ainda não chegou nele. A ficha avisa em vez de sumir.
  if c.uf is null or (v_ente = 'municipio' and c.municipio_norm is null) then
    return jsonb_build_object('ente', v_ente, 'pendente', true);
  end if;

  with irmaos as (
    select o.* from public.orgaos_catalogo o
     where o.ativo and o.nome is not null and o.uf = c.uf
       and ((v_ente = 'municipio' and o.esfera = 'M' and o.municipio_norm = c.municipio_norm) or (v_ente = 'estado' and o.esfera in ('E', 'D')))),
  grupos as (
    select (array_agg(i.cnpj order by (substr(i.cnpj, 9, 4) = '0001') desc, i.contratos desc, i.cnpj))[1] as cnpj, array_agg(i.cnpj) as cnpjs,
      sum(i.abertas)::int as abertas, sum(i.atas)::int as atas, bool_or(left(i.cnpj, 8) = left(c.cnpj, 8)) as proprio
      from irmaos i group by left(i.cnpj, 8), i.nome_chave),
  valores as (
    select g.*, o.nome, o.tipo, o.municipio, v.contratos, v.valor
      from grupos g join public.orgaos_catalogo o on o.cnpj = g.cnpj
      cross join lateral (select count(*)::int as contratos,
          coalesce(sum(case when jsonb_typeof(ct.dado -> 'valor') = 'number' then (ct.dado ->> 'valor')::numeric end), 0) as valor
        from public.contratos ct where left(ct.numero_controle_pncp, 14) = any(g.cnpjs)) v)
  select jsonb_build_object('ente', v_ente, 'uf', c.uf, 'municipio', c.municipio, 'esfera', c.esfera,
    'total', (select jsonb_build_object('orgaos', count(*), 'contratos', coalesce(sum(x.contratos), 0), 'valor', coalesce(sum(x.valor), 0),
        'abertas', coalesce(sum(x.abertas), 0)) from valores x),
    'proprio', (select jsonb_build_object('contratos', coalesce(sum(x.contratos), 0), 'valor', coalesce(sum(x.valor), 0)) from valores x where x.proprio),
    'orgaos', coalesce((select jsonb_agg(jsonb_build_object('cnpj', x.cnpj, 'nome', x.nome, 'tipo', x.tipo, 'municipio', x.municipio, 'abertas', x.abertas,
        'contratos', x.contratos, 'atas', x.atas, 'valor', x.valor) order by x.valor desc, x.contratos desc, x.abertas desc, x.nome)
      from (select * from valores where not proprio order by valor desc, contratos desc, abertas desc, nome limit 40) x), '[]'::jsonb))
    into v_r;
  return v_r;
end $$;
revoke all on function public.orgaos_mesmo_ente(text) from public, anon;
grant execute on function public.orgaos_mesmo_ente(text) to authenticated, service_role;

-- Cidades da UF com órgão no catálogo (filtro de cidade da lista). Nome mais comum de cada cidade (com acento, se houver);
-- órgãos contados como na lista (matriz e filiais = 1).
drop function if exists public.listar_municipios_orgaos(text);
create function public.listar_municipios_orgaos(p_uf text)
returns table (municipio text, orgaos int, abertas int)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
begin
  if not public.cliente_aprovado() then
    raise exception 'A lista de órgãos é só para cadastro aprovado' using errcode = '42501';
  end if;
  if upper(coalesce(p_uf, '')) !~ '^[A-Z]{2}$' then return; end if;
  return query
    select mode() within group (order by c.municipio), count(distinct left(c.cnpj, 8) || c.nome_chave)::int, sum(c.abertas)::int
      from public.orgaos_catalogo c
     where c.uf = upper(p_uf) and c.ativo and c.nome is not null and c.municipio_norm is not null
     group by c.municipio_norm order by c.municipio_norm;
end $$;
revoke all on function public.listar_municipios_orgaos(text) from public, anon;
grant execute on function public.listar_municipios_orgaos(text) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
