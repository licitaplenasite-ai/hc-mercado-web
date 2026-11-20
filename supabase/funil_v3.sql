-- Funil v3 (mapa do Siga Pregão, lista "FALTA" itens 1, 5, 6 e 9). Idempotente, transação única; não apaga dados.
-- Rodar no SQL Editor DEPOIS de operacao_acompanhamento.sql, operacao_funil_checklist.sql, operacao_monitor_edital.sql,
-- boletim_por_empresa.sql e seguranca_aprovacao_20261119.sql. Teste: testar_funil_v3.sql.
--  1. Tarefas avançadas no card: operacao_processos.tarefas_card = {secoes:[{id,nome,tarefas:[...]}], datas:{ata,aviso_recurso}}.
--     Cada tarefa: id, titulo, quando (data e hora, vai para a agenda), responsavel, exige (documento|resposta),
--     auto (prazo da Lei 14.133 calculado no navegador a partir das datas do processo), feita_em, resposta, anexo_id.
--     Nulo = modelo padrão (mesma convenção do checklist). A tarefa que exige prova só fecha com ela: o CHECK confere a
--     resposta escrita e o gatilho confere que o anexo existe em operacao_anexos_processo do MESMO processo.
--     Modelos de tarefas da empresa: operacao_funil_modelos_tarefas; o escolhido em operacao_funil_preferencias vale
--     para toda licitação que entra no Funil (gatilho de INSERT).
--  5. Prospecta: prospecta_sugerir() (só service_role, chamado por scripts/boletim_editais.py) põe no Funil as melhores do
--     boletim, sem duplicar (índice único da origem), com o limite diário e a nota mínima que a empresa ligou.
--  6. Metas e nicho por empresa: operacao_funil_preferencias.meta / nichos / oportunidades_dia.
--  9. Monitor por item: operacao_processos.monitor_itens (até 10). A citação do CNPJ no chat é feita pelo robô
--     scripts/monitor_processos.js com o CNPJ que a empresa já tem cadastrado: nada pessoal novo é guardado.
-- Nunca guarda CPF: resposta, título e responsável recusam número no formato de CPF (mesma regra do chat gravado).
begin;
set local lock_timeout = '5s';
do $$ begin
 if to_regclass('public.operacao_anexos_processo') is null or to_regclass('public.operacao_monitor_processos') is null
  or to_regclass('public.boletim_filtros_empresa') is null
  or to_regprocedure('public.pode_escrever_empresa_operacao(uuid,uuid)') is null then
  raise exception 'Aplique antes operacao_acompanhamento.sql, operacao_monitor_edital.sql, boletim_por_empresa.sql e seguranca_aprovacao_20261119.sql';
 end if;
end $$;

-- ---------- 1. Tarefas do card ----------
create or replace function public.funil_secoes_validas(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare s jsonb; t jsonb; n int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 12 or octet_length(p::text) > 60000 then return false; end if;
  for s in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(s) <> 'object' or coalesce(s->>'id', '') !~ '^[a-z0-9-]{1,40}$'
      or length(btrim(coalesce(s->>'nome', ''))) not between 1 and 80 or jsonb_typeof(s->'tarefas') is distinct from 'array' then
      return false;
    end if;
    for t in select value from jsonb_array_elements(s->'tarefas') loop
      n := n + 1;
      if n > 60 or jsonb_typeof(t) <> 'object' or coalesce(t->>'id', '') !~ '^[a-z0-9-]{1,40}$'
        or length(btrim(coalesce(t->>'titulo', ''))) not between 1 and 160
        or coalesce(t->>'exige', 'nada') not in ('nada', 'documento', 'resposta')
        or coalesce(t->>'auto', 'nada') not in ('nada', 'esclarecimento', 'impugnacao', 'disputa', 'recurso', 'contrarrazao')
        or (t ? 'quando' and coalesce(t->>'quando', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$')
        or (t ? 'feita_em' and coalesce(t->>'feita_em', '') !~ '^\d{4}-\d{2}-\d{2}T')
        or (t ? 'anexo_id' and coalesce(t->>'anexo_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        or length(coalesce(t->>'responsavel', '')) > 80 or length(coalesce(t->>'resposta', '')) > 2000
        or concat_ws(' ', t->>'titulo', t->>'responsavel', t->>'resposta') ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'
        -- Pergunta só fecha com resposta escrita.
        or (t->>'exige' = 'resposta' and t ? 'feita_em' and length(btrim(coalesce(t->>'resposta', ''))) = 0)
      then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create or replace function public.funil_tarefas_card_valido(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or (jsonb_typeof(p) = 'object' and (p - array['secoes', 'datas']) = '{}'::jsonb
    and public.funil_secoes_validas(coalesce(p->'secoes', '[]'::jsonb))
    and (not p ? 'datas' or (jsonb_typeof(p->'datas') = 'object' and ((p->'datas') - array['ata', 'aviso_recurso']) = '{}'::jsonb
      and coalesce(p->'datas'->>'ata', '2000-01-01') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(p->'datas'->>'aviso_recurso', '2000-01-01') ~ '^\d{4}-\d{2}-\d{2}$')))
$$;

alter table public.operacao_processos add column if not exists tarefas_card jsonb;
alter table public.operacao_processos drop constraint if exists operacao_processos_tarefas_card_valido;
alter table public.operacao_processos add constraint operacao_processos_tarefas_card_valido check (public.funil_tarefas_card_valido(tarefas_card));

-- 9. Itens que o monitor acompanha (aviso só desses itens quando a lista não está vazia).
alter table public.operacao_processos add column if not exists monitor_itens integer[] not null default '{}';
alter table public.operacao_processos drop constraint if exists operacao_processos_monitor_itens_validos;
alter table public.operacao_processos add constraint operacao_processos_monitor_itens_validos
  check (cardinality(monitor_itens) <= 10 and 0 < all(monitor_itens) and 100000 > all(monitor_itens));

-- 5. Sugestão do Prospecta: nota (selo "Sugerida") e quando entrou (limite diário). Aceitar = nota nula; dispensar = arquivar.
alter table public.operacao_processos add column if not exists sugerida_nota smallint;
alter table public.operacao_processos add column if not exists sugerida_em timestamptz;
alter table public.operacao_processos drop constraint if exists operacao_processos_sugerida_nota_valida;
alter table public.operacao_processos add constraint operacao_processos_sugerida_nota_valida check (sugerida_nota between 0 and 100);

-- Modelos de tarefas da empresa (sem marcação, resposta nem anexo: só a estrutura).
create table if not exists public.operacao_funil_modelos_tarefas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null references public.operacao_empresas(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 60),
  secoes jsonb not null,
  criado_em timestamptz not null default now()
);
alter table public.operacao_funil_modelos_tarefas drop constraint if exists operacao_funil_modelos_tarefas_secoes_validas;
alter table public.operacao_funil_modelos_tarefas add constraint operacao_funil_modelos_tarefas_secoes_validas check (
  public.funil_secoes_validas(secoes)
  and not jsonb_path_exists(secoes, '$[*].tarefas[*] ? (exists(@.feita_em) || exists(@.resposta) || exists(@.anexo_id))'));
create unique index if not exists operacao_funil_modelos_tarefas_nome_idx on public.operacao_funil_modelos_tarefas (empresa_id, lower(btrim(nome)));

-- ---------- 5 e 6. Preferências da empresa: modelo ao adicionar, Prospecta, meta e nichos ----------
create table if not exists public.operacao_funil_preferencias (
  empresa_id uuid primary key references public.operacao_empresas(id) on delete cascade,
  organizacao_id uuid not null,
  modelo_tarefas text not null default 'padrao'
    check (modelo_tarefas in ('padrao', 'nenhum') or modelo_tarefas ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  prospecta_ativo boolean not null default false,
  prospecta_limite smallint not null default 3 check (prospecta_limite between 1 and 10),
  prospecta_nota_minima smallint not null default 60 check (prospecta_nota_minima between 0 and 100),
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 4000),
  nichos jsonb not null default '[]'::jsonb check (jsonb_typeof(nichos) = 'array' and jsonb_array_length(nichos) <= 20 and octet_length(nichos::text) <= 16000),
  oportunidades_dia smallint not null default 10 check (oportunidades_dia between 0 and 200),
  atualizado_em timestamptz not null default now()
);

-- Organização + empresa coerentes (a policy confere o par).
create or replace function public.funil_empresa_coerente() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.operacao_empresas e where e.id = new.empresa_id and e.organizacao_id = new.organizacao_id) then
    raise exception 'Empresa não pertence à organização.' using errcode = 'check_violation';
  end if;
  if tg_table_name = 'operacao_funil_preferencias' then new.atualizado_em := now(); end if;
  return new;
end $$;
drop trigger if exists operacao_funil_preferencias_coerente on public.operacao_funil_preferencias;
create trigger operacao_funil_preferencias_coerente before insert or update on public.operacao_funil_preferencias
  for each row execute function public.funil_empresa_coerente();
drop trigger if exists operacao_funil_modelos_tarefas_coerente on public.operacao_funil_modelos_tarefas;
create trigger operacao_funil_modelos_tarefas_coerente before insert or update on public.operacao_funil_modelos_tarefas
  for each row execute function public.funil_empresa_coerente();

-- Licitação nova no Funil recebe o modelo escolhido pela empresa ("nenhum" = lista vazia; "padrao" = nulo).
create or replace function public.funil_aplicar_modelo_tarefas() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_pref text; v_secoes jsonb;
begin
  if new.tarefas_card is not null then return new; end if;
  select f.modelo_tarefas into v_pref from public.operacao_funil_preferencias f
    where f.empresa_id = new.empresa_id and f.organizacao_id = new.organizacao_id;
  if v_pref = 'nenhum' then
    new.tarefas_card := '{"secoes": []}'::jsonb;
  elsif v_pref ~ '^[0-9a-f-]{36}$' then
    select m.secoes into v_secoes from public.operacao_funil_modelos_tarefas m where m.id = v_pref::uuid and m.empresa_id = new.empresa_id;
    if v_secoes is not null then new.tarefas_card := jsonb_build_object('secoes', v_secoes); end if;
  end if;
  return new;
end $$;
-- Tarefa que exige documento só fecha com anexo do mesmo processo (o anexo passa pela RLS de operacao_anexos_processo).
create or replace function public.funil_tarefas_card_prova() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t jsonb;
begin
  if new.tarefas_card is null then return new; end if;
  for t in select x.value from jsonb_array_elements(coalesce(new.tarefas_card->'secoes', '[]'::jsonb)) s,
      jsonb_array_elements(s.value->'tarefas') x loop
    if t->>'exige' = 'documento' and t ? 'feita_em' and not exists (select 1 from public.operacao_anexos_processo a
        where a.id = (t->>'anexo_id')::uuid and a.processo_id = new.id and a.organizacao_id = new.organizacao_id) then
      raise exception 'A tarefa "%" só fecha com o documento anexado.', left(t->>'titulo', 80) using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end $$;
-- Gatilhos BEFORE rodam em ordem alfabética: primeiro o modelo, depois a prova.
drop trigger if exists funil_a_modelo_tarefas on public.operacao_processos;
create trigger funil_a_modelo_tarefas before insert on public.operacao_processos
  for each row execute function public.funil_aplicar_modelo_tarefas();
drop trigger if exists funil_b_prova_tarefas on public.operacao_processos;
create trigger funil_b_prova_tarefas before insert or update of tarefas_card on public.operacao_processos
  for each row execute function public.funil_tarefas_card_prova();

alter table public.operacao_funil_preferencias enable row level security;
alter table public.operacao_funil_modelos_tarefas enable row level security;
revoke all on public.operacao_funil_preferencias, public.operacao_funil_modelos_tarefas from public, anon, authenticated;
grant select, insert, update, delete on public.operacao_funil_preferencias, public.operacao_funil_modelos_tarefas to authenticated;
grant all on public.operacao_funil_preferencias, public.operacao_funil_modelos_tarefas to service_role;
drop policy if exists operacao_funil_preferencias_leitura on public.operacao_funil_preferencias;
create policy operacao_funil_preferencias_leitura on public.operacao_funil_preferencias for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_preferencias_escrita on public.operacao_funil_preferencias;
create policy operacao_funil_preferencias_escrita on public.operacao_funil_preferencias for insert to authenticated
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_preferencias_alteracao on public.operacao_funil_preferencias;
create policy operacao_funil_preferencias_alteracao on public.operacao_funil_preferencias for update to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_preferencias_exclusao on public.operacao_funil_preferencias;
create policy operacao_funil_preferencias_exclusao on public.operacao_funil_preferencias for delete to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_modelos_tarefas_leitura on public.operacao_funil_modelos_tarefas;
create policy operacao_funil_modelos_tarefas_leitura on public.operacao_funil_modelos_tarefas for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_modelos_tarefas_escrita on public.operacao_funil_modelos_tarefas;
create policy operacao_funil_modelos_tarefas_escrita on public.operacao_funil_modelos_tarefas for insert to authenticated
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_modelos_tarefas_alteracao on public.operacao_funil_modelos_tarefas;
create policy operacao_funil_modelos_tarefas_alteracao on public.operacao_funil_modelos_tarefas for update to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_modelos_tarefas_exclusao on public.operacao_funil_modelos_tarefas;
create policy operacao_funil_modelos_tarefas_exclusao on public.operacao_funil_modelos_tarefas for delete to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));

-- ---------- 5. Prospecta: o robô do boletim põe as melhores no Funil ----------
-- p_itens: [{numero_controle, objeto, orgao, modalidade, link, valor, publicacao (AAAA-MM-DD),
--            encerramento (AAAA-MM-DDTHH:MM:SS, Brasília), nota}] já ordenados da melhor para a pior.
-- Só entra quem tem nota >= mínima, até o limite do dia, na primeira etapa (triagem), sem duplicar. Devolve quantas entraram.
create or replace function public.prospecta_sugerir(p_empresa uuid, p_itens jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  f public.operacao_funil_preferencias; it jsonb; v_id uuid; v_ja int; n int := 0; v_nota int; v_dono uuid;
  v_hoje timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 200 then raise exception 'Lista inválida'; end if;
  select * into f from public.operacao_funil_preferencias where empresa_id = p_empresa;
  if f.empresa_id is null or not f.prospecta_ativo then return 0; end if;
  if not exists (select 1 from public.operacao_empresas e where e.id = p_empresa and e.organizacao_id = f.organizacao_id and e.ativo) then return 0; end if;
  select b.cliente_id into v_dono from public.boletim_filtros_empresa b where b.empresa_id = p_empresa;
  select count(*) into v_ja from public.operacao_processos p where p.empresa_id = p_empresa and p.sugerida_em >= v_hoje;
  for it in select value from jsonb_array_elements(p_itens) loop
    exit when v_ja + n >= f.prospecta_limite;
    v_nota := case when coalesce(it->>'nota', '') ~ '^\d{1,3}$' then (it->>'nota')::int end;
    continue when v_nota is null or v_nota > 100 or v_nota < f.prospecta_nota_minima
      or coalesce(it->>'numero_controle', '') !~ '^\d{14}-\d-\d{6}/\d{4}$';
    v_id := null;
    insert into public.operacao_processos (organizacao_id, empresa_id, origem_externa_id, objeto, orgao, modalidade, url_origem,
      valor_estimado, data_publicacao, status, criado_por, sugerida_nota, sugerida_em)
    values (f.organizacao_id, p_empresa, it->>'numero_controle',
      left(coalesce(nullif(btrim(it->>'objeto'), ''), 'Licitação sugerida pelo Prospecta'), 1000),
      left(nullif(btrim(it->>'orgao'), ''), 300), left(nullif(btrim(it->>'modalidade'), ''), 120),
      case when it->>'link' ~ '^https://\S+$' and length(it->>'link') <= 500 then it->>'link' end,
      case when coalesce(it->>'valor', '') ~ '^\d{1,13}(\.\d{1,2})?$' then (it->>'valor')::numeric end,
      case when coalesce(it->>'publicacao', '') ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'publicacao')::date end,
      'triagem', v_dono, v_nota, now())
    on conflict (organizacao_id, empresa_id, origem_externa_id) where origem_externa_id is not null do nothing
    returning id into v_id;
    continue when v_id is null;
    n := n + 1;
    if coalesce(it->>'encerramento', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$' then
      insert into public.operacao_prazos_processo (organizacao_id, processo_id, categoria, titulo, vencimento)
      values (f.organizacao_id, v_id, 'proposta', 'Prazo de propostas (Boletim)', (left(it->>'encerramento', 16) || ':00-03')::timestamptz);
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.prospecta_sugerir(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.prospecta_sugerir(uuid, jsonb) to service_role;
revoke all on function public.funil_aplicar_modelo_tarefas(), public.funil_tarefas_card_prova(), public.funil_empresa_coerente() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
