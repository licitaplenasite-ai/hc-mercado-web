-- CRM, fase 2 (24/11/2026): ficha do órgão (visão 360°) e linha do tempo do processo. Idempotente (seguro rodar mais
-- de uma vez), transação única; só acrescenta (não apaga nem altera dados). Rodar no SQL Editor do Supabase DEPOIS de
-- operacao_licitacoes.sql, operacao_acompanhamento.sql, acesso_empresa_convites.sql, operacao_funil_etapas.sql,
-- seguranca_aprovacao_20261119.sql, schema_oportunidades.sql e schema_dados_mercado.sql. Teste: scripts/crm_orgao_linha_tempo_sql.test.js.
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
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.operacao_processos') is null or to_regclass('public.operacao_funil_etapas') is null
    or to_regclass('public.oportunidades_abertas') is null or to_regclass('public.contratos') is null
    or to_regclass('public.mercado_atas') is null
    or to_regprocedure('public.pode_acessar_processo_operacao(uuid,uuid)') is null
    or to_regprocedure('public.pode_escrever_org_operacao(uuid)') is null
    or to_regprocedure('public.cliente_aprovado()') is null then
    raise exception 'Aplique antes operacao_licitacoes.sql, operacao_acompanhamento.sql, acesso_empresa_convites.sql, operacao_funil_etapas.sql, seguranca_aprovacao_20261119.sql, schema_oportunidades.sql e schema_dados_mercado.sql';
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

create or replace function public.ficha_orgao(p_cnpj text, p_nome text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
  v_nome text := lower(btrim(coalesce(p_nome, '')));
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.cliente_aprovado() then
    raise exception 'A ficha do órgão é só para cadastro aprovado' using errcode = '42501';
  end if;
  if v_cnpj is not null and v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ do órgão inválido' using errcode = '22023';
  end if;
  if v_cnpj is null then
    if length(v_nome) < 3 then raise exception 'Informe o CNPJ ou o nome do órgão' using errcode = '22023'; end if;
    -- Sem CNPJ (processo cadastrado à mão): acha pelo nome exato numa licitação ou num contrato do mesmo órgão.
    select left(o.numero_controle_pncp, 14) into v_cnpj from public.oportunidades_abertas o
      where lower(o.dado ->> 'orgao') = v_nome and o.numero_controle_pncp ~ '^[0-9]{14}-' limit 1;
    if v_cnpj is null then
      select left(c.numero_controle_pncp, 14) into v_cnpj from public.contratos c
        where lower(c.dado ->> 'orgao') = v_nome and c.numero_controle_pncp ~ '^[0-9]{14}-' limit 1;
    end if;
    if v_cnpj is null then return jsonb_build_object('encontrado', false, 'cnpj', null); end if;
  end if;
  return jsonb_build_object(
    'encontrado', true,
    'cnpj', v_cnpj,
    'dados', (select jsonb_build_object('nome', x.orgao, 'uf', x.uf, 'municipio', x.municipio) from (
        select o.dado ->> 'orgao' as orgao, o.uf, o.dado ->> 'municipio' as municipio, o.publicacao as quando
          from public.oportunidades_abertas o where left(o.numero_controle_pncp, 14) = v_cnpj
        union all
        select c.dado ->> 'orgao', c.uf, c.dado ->> 'municipio', c.data_assinatura
          from public.contratos c where left(c.numero_controle_pncp, 14) = v_cnpj
        order by quando desc nulls last limit 1) x),
    'uasgs', (select coalesce(jsonb_agg(distinct o.dado ->> 'codigoUnidade'), '[]'::jsonb)
        from public.oportunidades_abertas o
        where left(o.numero_controle_pncp, 14) = v_cnpj and coalesce(o.dado ->> 'codigoUnidade', '') <> ''),
    'abertas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.encerramento nulls last), '[]'::jsonb) from (
        select o.numero_controle_pncp, o.objeto, o.publicacao, o.encerramento, o.dado ->> 'modalidadeNome' as modalidade,
          case when jsonb_typeof(o.dado -> 'valorTotalEstimado') = 'number' then (o.dado ->> 'valorTotalEstimado')::numeric end as valor
          from public.oportunidades_abertas o
          where left(o.numero_controle_pncp, 14) = v_cnpj and (o.encerramento is null or o.encerramento >= v_hoje)
          order by o.encerramento nulls last limit 30) x),
    'contratos_resumo', (select jsonb_build_object('quantidade', count(*),
          'valor', coalesce(sum(case when jsonb_typeof(c.dado -> 'valor') = 'number' then (c.dado ->> 'valor')::numeric end), 0),
          'desde', min(c.data_assinatura))
        from public.contratos c where left(c.numero_controle_pncp, 14) = v_cnpj),
    'contratos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.data_assinatura desc nulls last), '[]'::jsonb) from (
        select c.numero_controle_pncp, c.objeto, c.data_assinatura, c.dado ->> 'nomeFornecedor' as fornecedor,
          case when jsonb_typeof(c.dado -> 'valor') = 'number' then (c.dado ->> 'valor')::numeric end as valor
          from public.contratos c where left(c.numero_controle_pncp, 14) = v_cnpj
          order by c.data_assinatura desc nulls last limit 30) x),
    'fornecedores', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc), '[]'::jsonb) from (
        select coalesce(nullif(c.dado ->> 'nomeFornecedor', ''), 'Fornecedor não informado') as nome, count(*) as contratos,
          coalesce(sum(case when jsonb_typeof(c.dado -> 'valor') = 'number' then (c.dado ->> 'valor')::numeric end), 0) as valor
          from public.contratos c where left(c.numero_controle_pncp, 14) = v_cnpj
          group by 1 order by 3 desc limit 5) x),
    'atas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.data_assinatura desc nulls last), '[]'::jsonb) from (
        select a.numero_controle_pncp_ata, a.objeto, a.data_assinatura, a.vigencia_fim, a.cancelado
          from public.mercado_atas a where left(a.numero_controle_pncp_ata, 14) = v_cnpj
          order by a.data_assinatura desc nulls last limit 30) x)
  );
end $$;
revoke all on function public.ficha_orgao(text, text) from public, anon;
grant execute on function public.ficha_orgao(text, text) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
