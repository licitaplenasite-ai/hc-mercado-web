-- CRM, fase 2 (24/11/2026): ficha do órgão (visão 360°) e linha do tempo do processo. Idempotente (seguro rodar mais
-- de uma vez), transação única; só acrescenta (não apaga nem altera dados). Rodar no SQL Editor do Supabase DEPOIS de
-- operacao_licitacoes.sql, operacao_acompanhamento.sql, acesso_empresa_convites.sql, operacao_funil_etapas.sql,
-- seguranca_aprovacao_20261119.sql, schema_oportunidades.sql, schema_dados_mercado.sql e orgaos_catalogo.sql.
-- Teste: scripts/crm_orgao_linha_tempo_sql.test.js.
--  1. operacao_processos_etapas_historico: cada mudança de estágio/etapa do processo vira uma linha (gatilho). Antes deste
--     SQL só existia etapa_desde (a última mudança); o passado não é reconstruído: a linha do tempo mostra "na etapa atual
--     desde" para processos antigos. Só o gatilho grava (o navegador só lê), então ninguém falsifica o histórico.
--  2. operacao_orgaos_registros: contatos (pregoeiro, fiscal...), anotações e "Acompanhar este órgão" da organização.
--     Privado da organização (mesma regra das etapas do Funil: lê quem é membro da org inteira, grava gestor/operador).
--     Membro restrito a uma empresa (cliente de assessoria) não vê as anotações internas da assessoria.
--  3. ficha_orgao(cnpj, nome): junta numa chamada o que já é público para qualquer cliente aprovado (oportunidades_abertas,
--     contratos, mercado_atas). Security definer só para usar os índices novos (sob RLS o planejador não usa índice de
--     expressão com função não-leakproof); não devolve nada que o cliente aprovado já não leia direto nas tabelas.
--     Índices por CNPJ: o número de controle do PNCP começa pelo CNPJ do órgão (CNPJ-1-000012/2026), nas três tabelas.
--     Em produção os índices de contratos podem levar alguns segundos; se preferir, rode antes, fora desta transação,
--     os mesmos "create index concurrently if not exists" (nome igual: aqui viram no-op).
--     24/11 (catálogo de órgãos): pelo nome, acha pelo nome canônico do catálogo (sem acento, prefeitura = município:
--     "Prefeitura Municipal de Apuí" acha "MUNICIPIO DE APUI"); sem dado coletado, nome/UF/cidade/esfera/UASGs vêm do
--     catálogo (cadastro do PNCP). A tela completa com o PNCP ao vivo (/api/orgao-pncp).
--     24/11 (ficha completa): agrega pela raiz do CNPJ (todas as unidades do órgão; p_uasg = uma unidade), junta o PNCP
--     ao vivo guardado em orgaos_pncp_cache (item 4) e devolve PCA/IRP, valores por ano e mês, fornecedores, categorias,
--     modalidades, dispensas e prazo médio. Nome com homônimo não é adivinhado (ambiguo = true).
--  4. orgaos_pncp_cache + gravar_pncp_orgao: o que /api/orgao-pncp leu do PNCP, para a próxima pessoa ver na hora.
-- ORDEM EM PRODUÇÃO (24/11, ficha completa): 1) supabase/ficha_orgao_indice.sql (índice do PCA pelo pg_cron, concurrently);
--   2) este arquivo inteiro no SQL Editor (segundos: só tabela nova pequena e funções; os índices grandes já existem);
--   3) publicar o site (orgao.html, ficha-orgao.js, orgao-pncp.js). A tela antiga continua funcionando com a função nova.
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.operacao_processos') is null or to_regclass('public.operacao_funil_etapas') is null
    or to_regclass('public.oportunidades_abertas') is null or to_regclass('public.contratos') is null
    or to_regclass('public.mercado_atas') is null
    or to_regprocedure('public.pode_acessar_processo_operacao(uuid,uuid)') is null
    or to_regprocedure('public.pode_escrever_org_operacao(uuid)') is null
    or to_regprocedure('public.cliente_aprovado()') is null
    or to_regclass('public.orgaos_catalogo') is null or to_regprocedure('public.orgao_chave_nome(text)') is null then
    raise exception 'Aplique antes operacao_licitacoes.sql, operacao_acompanhamento.sql, acesso_empresa_convites.sql, operacao_funil_etapas.sql, seguranca_aprovacao_20261119.sql, schema_oportunidades.sql, schema_dados_mercado.sql e orgaos_catalogo.sql';
  end if;
end $$;

-- ---------- 1. Histórico de etapas ----------
create table if not exists public.operacao_processos_etapas_historico (
  id bigint generated always as identity primary key,
  organizacao_id uuid not null,
  processo_id uuid not null,
  status_anterior text,
  status_novo text not null,
  -- Nome da etapa do Funil no momento da mudança: a etapa pode ser renomeada ou apagada depois.
  etapa_nome text,
  mudou_em timestamptz not null default now(),
  mudou_por uuid,
  foreign key (processo_id, organizacao_id) references public.operacao_processos(id, organizacao_id) on delete cascade
);
create index if not exists operacao_processos_etapas_historico_processo_idx
  on public.operacao_processos_etapas_historico (processo_id, mudou_em desc);
alter table public.operacao_processos_etapas_historico enable row level security;
revoke all on public.operacao_processos_etapas_historico from public, anon, authenticated;
grant select on public.operacao_processos_etapas_historico to authenticated;
grant all on public.operacao_processos_etapas_historico to service_role;
drop policy if exists operacao_processos_etapas_historico_leitura on public.operacao_processos_etapas_historico;
create policy operacao_processos_etapas_historico_leitura on public.operacao_processos_etapas_historico
  for select to authenticated using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));

create or replace function public.operacao_processos_registrar_etapa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.etapa_id is distinct from old.etapa_id then
    insert into public.operacao_processos_etapas_historico (organizacao_id, processo_id, status_anterior, status_novo, etapa_nome, mudou_por)
    values (new.organizacao_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
      (select e.nome from public.operacao_funil_etapas e where e.id = new.etapa_id), auth.uid());
  end if;
  return null;
end $$;
revoke all on function public.operacao_processos_registrar_etapa() from public, anon, authenticated, service_role;
drop trigger if exists operacao_processos_registrar_etapa on public.operacao_processos;
create trigger operacao_processos_registrar_etapa after insert or update of status, etapa_id on public.operacao_processos
  for each row execute function public.operacao_processos_registrar_etapa();

-- ---------- 2. Contatos, anotações e "acompanhar" por órgão ----------
-- orgao_chave: 'cnpj:<14 dígitos>' ou, sem CNPJ, 'nome:<nome em minúsculas, sem acento>' (ficha-orgao.js, chaveOrgao).
create table if not exists public.operacao_orgaos_registros (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  orgao_chave text not null check (orgao_chave ~ '^(cnpj:[0-9]{14}|nome:[a-z0-9][a-z0-9 .,/()-]{2,219})$'),
  orgao_nome text check (orgao_nome is null or length(orgao_nome) <= 300),
  tipo text not null check (tipo in ('acompanhar', 'contato', 'anotacao')),
  nome text check (nome is null or length(btrim(nome)) between 1 and 120),
  papel text check (papel is null or length(papel) <= 80),
  telefone text check (telefone is null or telefone ~ '^[0-9 ()+.-]{8,20}$'),
  email text check (email is null or (length(email) <= 160 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  texto text check (texto is null or length(btrim(texto)) between 1 and 2000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint operacao_orgaos_registros_tipo_coerente check (case tipo
    when 'contato' then nome is not null
    when 'anotacao' then texto is not null
    else true end)
);
-- Mesma regra do chat gravado e das tarefas do card (funil_v3.sql): número com cara de CPF não é guardado em nome, função
-- e texto. No telefone, 11 dígitos seguidos são celular com DDD: ali só o formato de CPF (123.456.789-09) é recusado.
-- Drop + add: quem rodou a primeira versão deste arquivo (só nome e texto) recebe a regra nova.
alter table public.operacao_orgaos_registros drop constraint if exists operacao_orgaos_registros_sem_cpf;
alter table public.operacao_orgaos_registros add constraint operacao_orgaos_registros_sem_cpf check (
  coalesce(nome, '') || ' ' || coalesce(papel, '') || ' ' || coalesce(texto, '') !~ '(^|[^0-9])[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}($|[^0-9])'
  and coalesce(telefone, '') !~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}');
create unique index if not exists operacao_orgaos_registros_acompanhar_idx
  on public.operacao_orgaos_registros (organizacao_id, orgao_chave) where tipo = 'acompanhar';
create index if not exists operacao_orgaos_registros_orgao_idx
  on public.operacao_orgaos_registros (organizacao_id, orgao_chave, criado_em desc);
alter table public.operacao_orgaos_registros enable row level security;
revoke all on public.operacao_orgaos_registros from public, anon, authenticated;
grant select, insert, update, delete on public.operacao_orgaos_registros to authenticated;
grant all on public.operacao_orgaos_registros to service_role;
drop policy if exists operacao_orgaos_registros_leitura on public.operacao_orgaos_registros;
drop policy if exists operacao_orgaos_registros_escrita on public.operacao_orgaos_registros;
create policy operacao_orgaos_registros_leitura on public.operacao_orgaos_registros for select to authenticated
  using (public.eh_membro_operacao(organizacao_id));
create policy operacao_orgaos_registros_escrita on public.operacao_orgaos_registros for all to authenticated
  using (public.pode_escrever_org_operacao(organizacao_id)) with check (public.pode_escrever_org_operacao(organizacao_id));

-- ---------- 3. Ficha do órgão (dados públicos já coletados pelo robô) ----------
create index if not exists oportunidades_abertas_orgao_cnpj_idx on public.oportunidades_abertas (left(numero_controle_pncp, 14));
create index if not exists oportunidades_abertas_orgao_nome_idx on public.oportunidades_abertas (lower(dado ->> 'orgao'));
create index if not exists contratos_orgao_cnpj_idx on public.contratos (left(numero_controle_pncp, 14));
create index if not exists contratos_orgao_nome_idx on public.contratos (lower(dado ->> 'orgao'));
create index if not exists mercado_atas_orgao_cnpj_idx on public.mercado_atas (left(numero_controle_pncp_ata, 14));

-- PCA e IRP do órgão (prospeccao_itens, ~900 mil linhas em produção) por CNPJ. Em produção o índice é criado ANTES, fora
-- desta transação, pelo pg_cron (supabase/ficha_orgao_indice.sql): criar aqui travaria a gravação do robô e passaria do
-- corte de 60 s do editor. Tabela pequena (teste, banco local): cria aqui mesmo.
do $$ begin
  if to_regclass('public.prospeccao_itens_orgao_idx') is null then
    if (select c.reltuples from pg_class c where c.oid = 'public.prospeccao_itens'::regclass) > 50000 then
      raise exception 'Crie antes o índice prospeccao_itens_orgao_idx pelo pg_cron: siga supabase/ficha_orgao_indice.sql e rode este arquivo de novo';
    end if;
    create index prospeccao_itens_orgao_idx on public.prospeccao_itens (orgao_cnpj, tipo) where orgao_cnpj is not null;
  end if;
end $$;

-- ---------- 4. PNCP ao vivo guardado por órgão (ficha completa, 24/11/2026) ----------
-- /api/orgao-pncp grava aqui o que leu do PNCP: contratos dos últimos 12 meses (um lote por trimestre, cada um com prazo
-- próprio: numa chamada só passavam de 50 s), licitações abertas, atas e o cadastro. A próxima pessoa que abre a ficha
-- vê na hora pela ficha_orgao, sem esperar o PNCP. Dado público. Fechada: nenhum papel do PostgREST lê a tabela; só a
-- ficha_orgao (security definer) lê e só a gravar_pncp_orgao (service_role) grava.
create table if not exists public.orgaos_pncp_cache (
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  fonte text not null check (fonte in ('orgao', 'abertas', 'contratos', 'atas')),
  -- Contratos: AAAAMM do 1º mês do trimestre (um lote por trimestre); as outras fontes: '' (um lote só).
  periodo text not null default '' check (periodo ~ '^([0-9]{6})?$'),
  -- Quantos registros o PNCP diz ter no lote (pode ser mais do que os itens guardados).
  total int not null default 0 check (total >= 0),
  itens jsonb not null default '[]' check (jsonb_typeof(itens) = 'array'),
  consultado_em timestamptz not null default now(),
  primary key (cnpj, fonte, periodo)
);
alter table public.orgaos_pncp_cache enable row level security;
revoke all on public.orgaos_pncp_cache from public, anon, authenticated, service_role;
drop policy if exists orgaos_pncp_cache_select_aprovado on public.orgaos_pncp_cache;
create policy orgaos_pncp_cache_select_aprovado on public.orgaos_pncp_cache for select to authenticated using ((select public.cliente_aprovado()));

-- p_lotes: [{"fonte":"contratos","periodo":"202610","total":135,"itens":[...]}, ...], até 20 lotes de até 1.500 itens.
-- Lote repetido grava o último. Os itens já chegam no formato da ficha, sem nome de pessoa física (orgao-pncp.js).
create or replace function public.gravar_pncp_orgao(p_cnpj text, p_lotes jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  if coalesce(p_cnpj, '') !~ '^[0-9]{14}$' then raise exception 'CNPJ do órgão inválido' using errcode = '22023'; end if;
  if jsonb_typeof(p_lotes) is distinct from 'array' or jsonb_array_length(p_lotes) > 20 then
    raise exception 'Envie uma lista de até 20 lotes' using errcode = '22023';
  end if;
  insert into public.orgaos_pncp_cache as k (cnpj, fonte, periodo, total, itens, consultado_em)
  select distinct on (l.fonte, coalesce(l.periodo, '')) p_cnpj, l.fonte, coalesce(l.periodo, ''), greatest(coalesce(l.total, 0), 0), l.itens, now()
    from rows from (jsonb_to_recordset(p_lotes) as (fonte text, periodo text, total int, itens jsonb)) with ordinality as l(fonte, periodo, total, itens, n)
   where l.fonte in ('orgao', 'abertas', 'contratos', 'atas') and coalesce(l.periodo, '') ~ '^([0-9]{6})?$'
     and jsonb_typeof(l.itens) = 'array' and jsonb_array_length(l.itens) <= 1500
   order by l.fonte, coalesce(l.periodo, ''), l.n desc
  on conflict (cnpj, fonte, periodo) do update set total = excluded.total, itens = excluded.itens, consultado_em = excluded.consultado_em;
  get diagnostics v_n = row_count;
  -- Retenção: órgão que ninguém abriu em 60 dias sai (quem abrir de novo consulta o PNCP). Tabela pequena: a varredura é barata.
  delete from public.orgaos_pncp_cache where consultado_em < now() - interval '60 days';
  return v_n;
end $$;
revoke all on function public.gravar_pncp_orgao(text, jsonb) from public, anon, authenticated;
grant execute on function public.gravar_pncp_orgao(text, jsonb) to service_role;

-- ---------- 3 (cont.). Ficha do órgão ----------
-- O ÓRGÃO é a raiz do CNPJ (8 primeiros dígitos): o cadastro do PNCP tem um CNPJ por unidade (o Comando da Aeronáutica
-- tem centenas), mas as compras saem quase todas pelo CNPJ da matriz. Abrir a ficha por uma filial mostrava tudo zerado
-- (relato do dono, 24/11: 00.394.429/0179-33). Agora soma todas as unidades da raiz; p_uasg restringe a uma unidade
-- (só entra o registro que traz a unidade: os contratos antigos do robô não trazem).
-- A faixa raiz||'000000'..raiz||'999999' usa os mesmos índices por CNPJ (left(numero, 14)); o left(.., 8) confere.
-- Pelo nome (processo cadastrado à mão): só quando o nome aponta para UM órgão; homônimos (Bom Jesus/PI e Bom Jesus/RS)
-- devolvem ambiguo = true e a tela oferece a escolha, em vez de mostrar dados de outro órgão.
drop function if exists public.ficha_orgao(text, text);
create or replace function public.ficha_orgao(p_cnpj text, p_nome text default null, p_uasg text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
  v_nome text := lower(btrim(coalesce(p_nome, '')));
  v_uasg text := nullif(btrim(coalesce(p_uasg, '')), '');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_raizes text[];
  v_raiz text;
  v_ini text;
  v_fim text;
  v_principal text;
begin
  if not public.cliente_aprovado() then
    raise exception 'A ficha do órgão é só para cadastro aprovado' using errcode = '42501';
  end if;
  if v_cnpj is not null and v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ do órgão inválido' using errcode = '22023';
  end if;
  if v_uasg is not null and v_uasg !~ '^[0-9]{1,8}$' then
    raise exception 'Unidade (UASG) inválida' using errcode = '22023';
  end if;
  if v_cnpj is null then
    if length(v_nome) < 3 then raise exception 'Informe o CNPJ ou o nome do órgão' using errcode = '22023'; end if;
    select array_agg(distinct left(c.cnpj, 8)) into v_raizes from public.orgaos_catalogo c
      where c.nome_chave = public.orgao_chave_nome(p_nome) and c.nome_chave <> '';
    if v_raizes is null then
      select array_agg(distinct left(x.n, 8)), min(left(x.n, 14)) into v_raizes, v_cnpj from (
        select o.numero_controle_pncp as n from public.oportunidades_abertas o
          where lower(o.dado ->> 'orgao') = v_nome and o.numero_controle_pncp ~ '^[0-9]{14}-'
        union all
        select c.numero_controle_pncp from public.contratos c
          where lower(c.dado ->> 'orgao') = v_nome and c.numero_controle_pncp ~ '^[0-9]{14}-') x;
    end if;
    if v_raizes is null then return jsonb_build_object('encontrado', false, 'cnpj', null); end if;
    if cardinality(v_raizes) > 1 then
      return jsonb_build_object('encontrado', false, 'cnpj', null, 'ambiguo', true, 'orgaos', cardinality(v_raizes));
    end if;
    v_raiz := v_raizes[1];
  else
    v_raiz := left(v_cnpj, 8);
  end if;
  v_ini := v_raiz || '000000';
  v_fim := v_raiz || '999999';
  -- CNPJ principal: o da raiz com mais compras nos dados coletados (a matriz no empate). É o que vai ao PNCP ao vivo.
  select c.cnpj into v_principal from public.orgaos_catalogo c where c.cnpj between v_ini and v_fim
    order by c.abertas * 5 + c.contratos + c.atas + c.itens desc, substr(c.cnpj, 9, 4) = '0001' desc, c.cnpj limit 1;
  v_principal := coalesce(v_principal, v_cnpj);

  return (
  with cache as (
    select k.fonte, k.itens from public.orgaos_pncp_cache k where k.cnpj between v_ini and v_fim and left(k.cnpj, 8) = v_raiz
  ),
  -- Mesmo registro no robô e no PNCP ao vivo: vale o do PNCP (mais novo e com a unidade).
  abc as (
    select distinct on (x.numero_controle_pncp) x.* from cache k
      cross join jsonb_to_recordset(k.itens) as x(numero_controle_pncp text, objeto text, publicacao date, encerramento date,
        modalidade text, valor numeric, uasg text, unidade text)
     where k.fonte = 'abertas' and x.numero_controle_pncp is not null
  ),
  ab as (
    select * from abc
    union all
    select o.numero_controle_pncp, o.objeto, o.publicacao, o.encerramento, o.dado ->> 'modalidadeNome',
      case when jsonb_typeof(o.dado -> 'valorTotalEstimado') = 'number' then (o.dado ->> 'valorTotalEstimado')::numeric end,
      nullif(o.dado ->> 'codigoUnidade', ''), null
      from public.oportunidades_abertas o
     where left(o.numero_controle_pncp, 14) between v_ini and v_fim and left(o.numero_controle_pncp, 8) = v_raiz
       and o.numero_controle_pncp not in (select numero_controle_pncp from abc)
  ),
  ctc as (
    select distinct on (x.numero_controle_pncp) x.* from cache k
      cross join jsonb_to_recordset(k.itens) as x(numero_controle_pncp text, objeto text, data_assinatura date, fornecedor text,
        valor numeric, uasg text, unidade text, categoria text)
     where k.fonte = 'contratos' and x.numero_controle_pncp is not null
  ),
  ct as (
    select * from ctc
    union all
    select c.numero_controle_pncp, c.objeto, c.data_assinatura,
      -- LGPD: CPF (11 dígitos) vira "Pessoa física"; o CPF que a razão social de MEI traz no fim sai do nome.
      case when regexp_replace(coalesce(c.dado ->> 'cnpjFornecedor', ''), '\D', '', 'g') ~ '^[0-9]{11}$' then 'Pessoa física'
        else nullif(btrim(regexp_replace(coalesce(c.dado ->> 'nomeFornecedor', ''), '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', '', 'g')), '') end,
      case when jsonb_typeof(c.dado -> 'valor') = 'number' then (c.dado ->> 'valor')::numeric end,
      nullif(c.dado ->> 'codigoUnidade', ''), null, nullif(c.dado ->> 'categoria', '')
      from public.contratos c
     where left(c.numero_controle_pncp, 14) between v_ini and v_fim and left(c.numero_controle_pncp, 8) = v_raiz
       and c.numero_controle_pncp not in (select numero_controle_pncp from ctc)
  ),
  atc as (
    select distinct on (x.numero_controle_pncp_ata) x.* from cache k
      cross join jsonb_to_recordset(k.itens) as x(numero_controle_pncp_ata text, objeto text, data_assinatura date, vigencia_fim date,
        cancelado boolean, uasg text, unidade text)
     where k.fonte = 'atas' and x.numero_controle_pncp_ata is not null
  ),
  at as (
    select * from atc
    union all
    select a.numero_controle_pncp_ata, a.objeto, a.data_assinatura, a.vigencia_fim, a.cancelado, nullif(a.dado ->> 'uasg', ''), null
      from public.mercado_atas a
     where left(a.numero_controle_pncp_ata, 14) between v_ini and v_fim and left(a.numero_controle_pncp_ata, 8) = v_raiz
       and a.numero_controle_pncp_ata not in (select numero_controle_pncp_ata from atc)
  ),
  pc as (
    select p.tipo, p.objeto, p.descricao, p.quantidade, p.valor_total, p.data_ref, p.unidade_codigo as uasg, p.unidade_nome as unidade, p.link
      from public.prospeccao_itens p where p.orgao_cnpj between v_ini and v_fim and left(p.orgao_cnpj, 8) = v_raiz and p.tipo in ('pca', 'irp')
  ),
  un as (
    select u.uasg, max(u.unidade) as nome, count(*) as registros from (
      select uasg, unidade from ab union all select uasg, unidade from ct union all select uasg, unidade from at
      union all select uasg, unidade from pc) u
     where u.uasg ~ '^[0-9]{1,8}$' group by u.uasg
  ),
  abf as (select * from ab where v_uasg is null or uasg = v_uasg),
  ctf as (select * from ct where v_uasg is null or uasg = v_uasg),
  atf as (select * from at where v_uasg is null or uasg = v_uasg),
  pcf as (select * from pc where v_uasg is null or uasg = v_uasg)
  select jsonb_build_object(
    'encontrado', true,
    'cnpj', coalesce(v_cnpj, v_principal),
    'cnpj_principal', v_principal,
    'raiz', v_raiz,
    'pelo_nome', p_cnpj is null or btrim(p_cnpj) = '',
    'cnpjs', (select count(*) from public.orgaos_catalogo c where c.cnpj between v_ini and v_fim),
    'unidade', v_uasg,
    'unidades', (select coalesce(jsonb_agg(jsonb_build_object('uasg', z.uasg, 'nome', z.nome, 'registros', z.registros) order by z.registros desc, z.uasg), '[]'::jsonb)
        from (select * from un order by registros desc, uasg limit 200) z),
    'uasgs', (select coalesce(jsonb_agg(z.uasg order by z.registros desc, z.uasg), '[]'::jsonb) from (select * from un order by registros desc, uasg limit 6) z),
    -- Campo a campo: o dado coletado mais recente do CNPJ principal; o que faltar, do catálogo e do cadastro do PNCP.
    'dados', (select jsonb_build_object('nome', coalesce(nullif(x.orgao, ''), k.nome, (select g.itens -> 0 ->> 'nome' from cache g where g.fonte = 'orgao' limit 1)),
          'uf', coalesce(x.uf, k.uf), 'municipio', coalesce(nullif(x.municipio, ''), k.municipio))
        from (select 1) um
        left join lateral (
          select o.dado ->> 'orgao' as orgao, o.uf, o.dado ->> 'municipio' as municipio, o.publicacao as quando
            from public.oportunidades_abertas o where left(o.numero_controle_pncp, 14) = v_principal
          union all
          select c.dado ->> 'orgao', c.uf, c.dado ->> 'municipio', c.data_assinatura
            from public.contratos c where left(c.numero_controle_pncp, 14) = v_principal
          order by quando desc nulls last limit 1) x on true
        left join public.orgaos_catalogo k on k.cnpj = v_principal),
    'esfera', (select k.esfera from public.orgaos_catalogo k where k.cnpj = v_principal),
    'abertas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.encerramento nulls last), '[]'::jsonb) from (
        select a.numero_controle_pncp, a.objeto, a.publicacao, a.encerramento, a.modalidade, a.valor, a.uasg, a.unidade
          from abf a where a.encerramento is null or a.encerramento >= v_hoje
          order by a.encerramento nulls last limit 30) x),
    'abertas_total', (select count(*) from abf a where a.encerramento is null or a.encerramento >= v_hoje),
    -- Licitações publicadas (abertas e já encerradas; o robô guarda ~4 meses): modalidades, dispensas, prazo dado ao fornecedor.
    'compras_publicadas', (select jsonb_build_object('quantidade', count(*), 'desde', min(a.publicacao), 'valor', coalesce(sum(a.valor), 0),
          'dispensas', count(*) filter (where a.modalidade ilike 'dispensa%'),
          'inexigibilidades', count(*) filter (where a.modalidade ilike 'inexigibilidade%'),
          'prazo_medio_dias', round(avg(a.encerramento - a.publicacao) filter (where a.encerramento >= a.publicacao)),
          'modalidades', (select coalesce(jsonb_agg(jsonb_build_object('nome', m.nome, 'quantidade', m.n, 'valor', m.valor) order by m.n desc, m.nome), '[]'::jsonb)
              from (select coalesce(b.modalidade, 'Não informada') as nome, count(*) as n, coalesce(sum(b.valor), 0) as valor from abf b group by 1 order by 2 desc limit 8) m))
        from abf a),
    'contratos_resumo', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(c.valor), 0), 'desde', min(c.data_assinatura),
          'ate', max(c.data_assinatura), 'ticket_medio', round(avg(c.valor) filter (where c.valor > 0), 2),
          'ao_vivo', (select count(*) from ctc))
        from ctf c),
    'contratos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.data_assinatura desc nulls last), '[]'::jsonb) from (
        select c.numero_controle_pncp, c.objeto, c.data_assinatura, c.fornecedor, c.valor, c.uasg, c.unidade, c.categoria
          from ctf c order by c.data_assinatura desc nulls last limit 30) x),
    'maiores_contratos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc), '[]'::jsonb) from (
        select c.numero_controle_pncp, c.objeto, c.data_assinatura, c.fornecedor, c.valor, c.unidade
          from ctf c where c.valor > 0 and c.data_assinatura >= v_hoje - 365 order by c.valor desc limit 5) x),
    'fornecedores', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc), '[]'::jsonb) from (
        select coalesce(c.fornecedor, 'Fornecedor não informado') as nome, count(*) as contratos, coalesce(sum(c.valor), 0) as valor
          from ctf c group by 1 order by 3 desc, 2 desc limit 10) x),
    'por_ano', (select coalesce(jsonb_agg(to_jsonb(x) order by x.ano), '[]'::jsonb) from (
        select extract(year from c.data_assinatura)::int as ano, count(*) as contratos, coalesce(sum(c.valor), 0) as valor
          from ctf c where c.data_assinatura is not null group by 1) x),
    'por_mes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.mes), '[]'::jsonb) from (
        select to_char(c.data_assinatura, 'YYYY-MM') as mes, count(*) as contratos, coalesce(sum(c.valor), 0) as valor
          from ctf c where c.data_assinatura >= (date_trunc('month', v_hoje) - interval '23 months')::date and c.data_assinatura <= v_hoje group by 1) x),
    'meses_do_ano', (select coalesce(jsonb_agg(to_jsonb(x) order by x.mes), '[]'::jsonb) from (
        select extract(month from c.data_assinatura)::int as mes, count(*) as contratos, coalesce(sum(c.valor), 0) as valor
          from ctf c where c.data_assinatura is not null group by 1) x),
    'categorias', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc), '[]'::jsonb) from (
        select c.categoria as nome, count(*) as contratos, coalesce(sum(c.valor), 0) as valor
          from ctf c where c.categoria is not null group by 1 order by 3 desc limit 8) x),
    'atas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.data_assinatura desc nulls last), '[]'::jsonb) from (
        select a.numero_controle_pncp_ata, a.objeto, a.data_assinatura, a.vigencia_fim, a.cancelado, a.unidade
          from atf a order by a.data_assinatura desc nulls last limit 30) x),
    'atas_total', (select count(*) from atf),
    'atas_vigentes', (select count(*) from atf a where not coalesce(a.cancelado, false) and a.vigencia_fim >= v_hoje),
    -- Plano de compras (PCA/PGC) daqui para frente: o robô da Prospecção só guarda item com data desejada a partir de hoje.
    'pca', (select jsonb_build_object('itens', count(*), 'valor', coalesce(sum(p.valor_total), 0), 'ate', max(p.data_ref),
          'principais', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc), '[]'::jsonb) from (
              select coalesce(q.descricao, q.objeto, 'Item sem descrição') as descricao, count(*) as itens, coalesce(sum(q.valor_total), 0) as valor, min(q.data_ref) as quando
                from pcf q where q.tipo = 'pca' group by 1 order by 3 desc limit 12) x),
          'por_mes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.mes), '[]'::jsonb) from (
              select to_char(q.data_ref, 'YYYY-MM') as mes, count(*) as itens, coalesce(sum(q.valor_total), 0) as valor
                from pcf q where q.tipo = 'pca' and q.data_ref between v_hoje and v_hoje + 365 group by 1) x),
          'proximos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.data_ref, x.valor_total desc nulls last), '[]'::jsonb) from (
              select q.descricao, q.objeto, q.quantidade, q.valor_total, q.data_ref, q.unidade, q.link
                from pcf q where q.tipo = 'pca' and q.data_ref >= v_hoje order by q.data_ref, q.valor_total desc nulls last limit 10) x))
        from pcf p where p.tipo = 'pca'),
    'irp', (select coalesce(jsonb_agg(to_jsonb(x) order by x.data_ref), '[]'::jsonb) from (
        select q.descricao, q.objeto, q.quantidade, q.valor_total, q.data_ref, q.unidade, q.link
          from pcf q where q.tipo = 'irp' and q.data_ref >= v_hoje order by q.data_ref limit 10) x),
    -- Quando cada lote do PNCP ao vivo foi consultado (a tela decide se consulta de novo).
    'pncp', (select coalesce(jsonb_agg(jsonb_build_object('fonte', k.fonte, 'periodo', k.periodo, 'total', k.total,
          'itens', jsonb_array_length(k.itens), 'em', k.consultado_em) order by k.fonte, k.periodo), '[]'::jsonb)
        from public.orgaos_pncp_cache k where k.cnpj = v_principal)
  ));
end $$;
revoke all on function public.ficha_orgao(text, text, text) from public, anon;
grant execute on function public.ficha_orgao(text, text, text) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
