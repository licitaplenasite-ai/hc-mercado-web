-- Painel do dono reorganizado (22/11/2026, aguarda aprovação). Idempotente: rode inteiro no SQL Editor depois de
-- planos_e_recursos.sql, orcamento_normas.sql, bases_preco.sql, sancoes_empresas.sql e prospeccao.sql.
--   1) Registro do boletim: um resumo por dia no admin (enviados, falhas, clientes sem envio), detalhe só das falhas,
--      busca "o cliente X recebeu?" e limpeza automática do que tem mais de 30 dias. Só a tabela de registro é apagada.
--   2) Saúde do sistema: último sucesso de cada robô (batimento gravado pelo próprio workflow) e cobertura dos estados.
-- Tudo de leitura do admin exige o dono com 2 fatores (public.admin_planos_autorizado()); nada aqui toca CPF.

-- 1) Registro do boletim -----------------------------------------------------------------------------------------
-- A tabela já existe em produção (criada à mão, fora destes SQL); aqui só garante o formato e fecha o acesso direto:
-- antes "authenticated" e até "anon" tinham GRANT ALL. O robô grava com a chave de serviço; o admin lê pelas funções.
create table if not exists public.logs_boletim (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references auth.users (id) on delete set null,
  cliente_email text,
  cliente_nome text,
  status text,
  quantidade_editais integer,
  mensagem_erro text,
  executado_em timestamptz not null default now()
);
create index if not exists logs_boletim_executado_em on public.logs_boletim (executado_em desc);
alter table public.logs_boletim enable row level security;
revoke all on public.logs_boletim from anon, authenticated;
grant select, insert, delete on public.logs_boletim to service_role;

-- Resumo por dia (dia de Brasília). "Sem envio" = cliente aprovado sem nenhuma linha no dia, só nos dias em que o robô rodou.
create or replace function public.admin_boletim_resumo(p_dias integer default 14) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_dias integer := least(greatest(coalesce(p_dias, 14), 1), 30); v_aprovados integer;
begin
  if not public.admin_planos_autorizado() then raise exception 'Boletim exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  select count(*) into v_aprovados from public.clientes where status = 'aprovado';
  return jsonb_build_object(
    'dias', (select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'enviados', enviados, 'sem_novidades', sem_novidades, 'falhas', falhas,
        'sem_envio', greatest(v_aprovados - clientes, 0)) order by dia desc), '[]'::jsonb)
      from (select (l.executado_em at time zone 'America/Sao_Paulo')::date as dia,
          count(*) filter (where l.status = 'enviado') as enviados,
          count(*) filter (where l.status = 'sem_novidades') as sem_novidades,
          count(*) filter (where l.status = 'erro') as falhas,
          count(distinct l.cliente_id) filter (where l.cliente_id in (select id from public.clientes where status = 'aprovado')) as clientes
        from public.logs_boletim l
        where l.executado_em >= (public.hoje_brasilia() - (v_dias - 1))::timestamp at time zone 'America/Sao_Paulo'
        group by 1) s),
    'falhas', (select coalesce(jsonb_agg(jsonb_build_object('executado_em', l.executado_em, 'cliente_id', l.cliente_id, 'nome', l.cliente_nome,
        'email', l.cliente_email, 'mensagem_erro', l.mensagem_erro) order by l.executado_em desc), '[]'::jsonb)
      from (select * from public.logs_boletim where status = 'erro'
        and executado_em >= (public.hoje_brasilia() - (v_dias - 1))::timestamp at time zone 'America/Sao_Paulo'
        order by executado_em desc limit 100) l),
    'aprovados', v_aprovados);
end $$;

-- "O cliente X recebeu?": as últimas linhas (30 dias) de quem bate com o e-mail ou o nome.
create or replace function public.admin_boletim_buscar(p_termo text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_termo text := trim(coalesce(p_termo, ''));
begin
  if not public.admin_planos_autorizado() then raise exception 'Boletim exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  if length(v_termo) < 3 then return '[]'::jsonb; end if;
  v_termo := '%' || replace(replace(replace(v_termo, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return (select coalesce(jsonb_agg(jsonb_build_object('executado_em', l.executado_em, 'cliente_id', l.cliente_id, 'nome', l.cliente_nome,
      'email', l.cliente_email, 'status', l.status, 'quantidade_editais', l.quantidade_editais, 'mensagem_erro', l.mensagem_erro)
      order by l.executado_em desc), '[]'::jsonb)
    from (select * from public.logs_boletim where cliente_email ilike v_termo or cliente_nome ilike v_termo
      order by executado_em desc limit 50) l);
end $$;

revoke all on function public.admin_boletim_resumo(integer), public.admin_boletim_buscar(text) from public, anon;
grant execute on function public.admin_boletim_resumo(integer), public.admin_boletim_buscar(text) to authenticated;

-- 2) Saúde do sistema ------------------------------------------------------------------------------------------
-- Batimento: o último passo de cada workflow (scripts/registrar_robo.js) grava "deu certo agora". Sem isso, robôs que só
-- mandam e-mail (lembretes, cobrança) ou só gravam quando há novidade (vigia de normas) não deixam rastro nenhum.
create table if not exists public.robos_batimento (
  robo text primary key check (robo in ('pncp', 'ufs', 'mercado', 'prospeccao', 'sancoes', 'boletim', 'lembretes', 'cobranca', 'bases_obra', 'vigia_normas', 'precos', 'fontes_extras')),
  ultimo_sucesso timestamptz not null default now()
);
-- 25/11: robôs novos (pré-consulta da Pesquisa de Preços e fontes fora do PNCP). O create table acima não muda uma tabela
-- que já existe: o check é trocado aqui (o nome é o que o Postgres dá ao check da coluna).
alter table public.robos_batimento drop constraint if exists robos_batimento_robo_check;
alter table public.robos_batimento add constraint robos_batimento_robo_check check (robo in ('pncp', 'ufs', 'mercado', 'prospeccao', 'sancoes', 'boletim', 'lembretes', 'cobranca', 'bases_obra', 'vigia_normas', 'precos', 'fontes_extras'));
alter table public.robos_batimento enable row level security;
revoke all on public.robos_batimento from anon, authenticated;
grant select, insert, update on public.robos_batimento to service_role;

-- Só a chave de serviço (robôs). O boletim aproveita para apagar o registro com mais de 30 dias: só logs_boletim,
-- nenhum dado de cliente (clientes, edições e histórico de vistos ficam).
create or replace function public.robo_registrar_sucesso(p_robo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_apagados integer := 0;
begin
  insert into public.robos_batimento (robo, ultimo_sucesso) values (p_robo, now())
    on conflict (robo) do update set ultimo_sucesso = excluded.ultimo_sucesso;
  if p_robo = 'boletim' then
    delete from public.logs_boletim where executado_em < now() - interval '30 days';
    get diagnostics v_apagados = row_count;
  end if;
  return jsonb_build_object('robo', p_robo, 'registros_apagados', v_apagados);
end $$;
revoke all on function public.robo_registrar_sucesso(text) from public, anon, authenticated;
grant execute on function public.robo_registrar_sucesso(text) to service_role;

-- Último sucesso: o batimento ou, enquanto o workflow ainda não grava, o rastro que o robô já deixa nos dados.
-- Cobertura dos estados: o metadado do PNCP (dados_robo.oportunidades_meta), o mesmo do Status das Ferramentas.
-- 23/11 (incidente "Na fila…" por horas): alarme da coleta (dados_robo.coleta_alarme, gravado por
-- scripts/atualizar_dados.js em vez de derrubar o job) e pedidos de processo do cliente (fila_dossies, origem
-- 'interesse') sem dossiê há mais de 1 h. fila_dossies não tem policy (só service_role): o admin vê só a contagem.
create or replace function public.admin_saude_robos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_meta jsonb; v jsonb; v_alarme jsonb; v_fila jsonb; v_pre jsonb; v_extras jsonb;
begin
  if not public.admin_planos_autorizado() then raise exception 'Saúde do sistema exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  select dado into v_meta from public.dados_robo where chave = 'oportunidades_meta';
  select dado into v_alarme from public.dados_robo where chave = 'coleta_alarme';
  -- 25/11: resumo da última execução da pré-consulta da Pesquisa de Preços (scripts/pre_consultar_precos.js).
  select dado into v_pre from public.dados_robo where chave = 'pre_consulta_status';
  -- Fontes fora do PNCP (scripts/coletar_fontes_extras.js): situação de cada portal na última rodada.
  select dado into v_extras from public.dados_robo where chave = 'fontes_extras_status';
  -- execute: a função continua valendo num banco em que fila_dossies.sql ainda não foi aplicado.
  if to_regclass('public.fila_dossies') is not null then
    execute $q$select jsonb_build_object('esperando', count(*), 'mais_antigo', min(pedido_em))
      from public.fila_dossies where origem = 'interesse' and concluido_em is null and pedido_em < now() - interval '1 hour'$q$
      into v_fila;
  end if;
  select coalesce(jsonb_object_agg(robo, ultimo_sucesso), '{}'::jsonb) into v from public.robos_batimento;
  return jsonb_build_object(
    'robos', jsonb_strip_nulls(jsonb_build_object(
      'pncp', greatest((v ->> 'pncp')::timestamptz, (v_meta ->> 'atualizadoEm')::timestamptz),
      'ufs', (v ->> 'ufs')::timestamptz,
      'mercado', greatest((v ->> 'mercado')::timestamptz, (select max(atualizado_em) from public.mercado_atas)),
      'prospeccao', greatest((v ->> 'prospeccao')::timestamptz, (select max(coletado_em) from public.prospeccao_itens)),
      'sancoes', greatest((v ->> 'sancoes')::timestamptz, (select max(atualizado_em) from public.sancoes_empresas)),
      'boletim', greatest((v ->> 'boletim')::timestamptz, (select max(executado_em) from public.logs_boletim where status = 'enviado')),
      'lembretes', (v ->> 'lembretes')::timestamptz,
      'cobranca', (v ->> 'cobranca')::timestamptz,
      'bases_obra', greatest((v ->> 'bases_obra')::timestamptz, (select max(coletado_em) from public.bases_preco_versoes)),
      'vigia_normas', greatest((v ->> 'vigia_normas')::timestamptz, (select max(criado_em) from public.orcamento_normas_novidades)),
      'precos', greatest((v ->> 'precos')::timestamptz, (v_pre ->> 'em')::timestamptz),
      'fontes_extras', (v ->> 'fontes_extras')::timestamptz)),
    'ufs_com_falha', coalesce(v_meta -> 'ufsComFalha', '[]'::jsonb),
    'cobertura_por_uf', (select coalesce(jsonb_object_agg(k, x ->> 'atualizadoEm'), '{}'::jsonb)
      from jsonb_each(coalesce(v_meta -> 'coberturaPorUf', '{}'::jsonb)) as e(k, x) where jsonb_typeof(x) = 'object'),
    'normas_para_revisar', (select count(*) from public.orcamento_normas_novidades where situacao = 'para_revisar'),
    'coleta_alarme', v_alarme,
    'dossies_interesse_atrasados', v_fila,
    'pre_consulta', v_pre,
    'fontes_extras', v_extras);
end $$;
revoke all on function public.admin_saude_robos() from public, anon;
grant execute on function public.admin_saude_robos() to authenticated;
