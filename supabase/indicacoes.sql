-- LicitaPlena: programa "Indique e ganhe" (AGUARDA APROVAÇÃO DO DONO: números são proposta, mudam no admin).
-- Análise e regras: _historico/indicacao-analise-20261120.md. Teste: supabase/testar_indicacoes.sql.
-- Idempotente: seguro rodar mais de uma vez no SQL Editor. Não apaga dados. Rodar DEPOIS de planos_e_recursos.sql
-- (pagamentos, admin_planos_autorizado) e historico_licitacoes.sql (cliente_aprovado).
-- Fluxo: link licitaplena.com.br/?ind=CODIGO -> o cadastro leva o código no metadado -> trigger em clientes cria a
-- indicação (com antifraude) -> pagamento do indicado confirmado (admin hoje; webhook do Asaas depois, pelo mesmo
-- aplicar_pagamento_confirmado) -> trigger em pagamentos cria a comissão -> liberada depois da garantia -> Pix manual.
-- Não guarda CPF, chave Pix nem senha. A chave Pix é pedida ao indicador só na hora do saque, fora do sistema.
begin;

-- ---------------------------------------------------------------------------------------------------------------
-- 1) Regras (uma linha só). Leitura pública: a página de regras e o cadastro mostram os números de verdade.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.indicacao_regras (
  id smallint primary key default 1 check (id = 1),
  ativo boolean not null default true,
  percentual numeric(5,2) not null default 30 check (percentual > 0 and percentual <= 100),
  meses_comissao integer not null default 12 check (meses_comissao between 1 and 60),      -- quantas mensalidades pagam comissão
  dias_garantia integer not null default 30 check (dias_garantia between 0 and 120),        -- carência até a comissão ser liberada
  saque_minimo_centavos integer not null default 5000 check (saque_minimo_centavos >= 0),
  desconto_indicado_percentual numeric(5,2) not null default 10 check (desconto_indicado_percentual between 0 and 100),
  desconto_indicado_meses integer not null default 1 check (desconto_indicado_meses between 0 and 12),
  dias_validade_link integer not null default 60 check (dias_validade_link between 1 and 365),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
insert into public.indicacao_regras (id) values (1) on conflict (id) do nothing;

create table if not exists public.indicacao_codigos (
  usuario_id uuid primary key references public.clientes(id) on delete cascade,
  codigo text not null unique check (codigo ~ '^[A-Z0-9]{6,12}$'),
  criado_em timestamptz not null default now()
);

-- Um indicado tem no máximo um indicador (o primeiro clique válido que chegou no cadastro).
create table if not exists public.indicacoes (
  id uuid primary key default gen_random_uuid(),
  indicador_id uuid not null references public.clientes(id) on delete cascade,
  indicado_id uuid not null unique references public.clientes(id) on delete cascade,
  codigo text not null,
  clicado_em timestamptz,
  situacao text not null default 'cadastrado' check (situacao in ('cadastrado', 'cliente', 'bloqueada')),
  motivo_bloqueio text check (length(motivo_bloqueio) <= 200),
  criado_em timestamptz not null default now()
);
create index if not exists indicacoes_indicador_idx on public.indicacoes (indicador_id, criado_em desc);

-- Uma comissão por pagamento confirmado. "Liberada" não é gravada: é pendente com libera_em vencido.
create table if not exists public.indicacao_comissoes (
  id uuid primary key default gen_random_uuid(),
  indicacao_id uuid references public.indicacoes(id) on delete set null,
  indicador_id uuid references public.clientes(id) on delete set null,   -- registro do que foi pago fica mesmo se a conta sair
  pagamento_id uuid not null unique references public.pagamentos(id),
  meses integer not null check (meses between 1 and 60),
  base_centavos integer not null check (base_centavos > 0),
  percentual numeric(5,2) not null,
  valor_centavos integer not null check (valor_centavos > 0),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'paga', 'cancelada')),
  libera_em timestamptz not null,
  saque_pedido_em timestamptz,
  paga_em timestamptz,
  paga_referencia text check (length(paga_referencia) <= 200),
  paga_por text,
  motivo_cancelamento text check (length(motivo_cancelamento) <= 200),
  criado_em timestamptz not null default now()
);
create index if not exists indicacao_comissoes_indicador_idx on public.indicacao_comissoes (indicador_id, criado_em desc);

alter table public.indicacao_regras enable row level security;
alter table public.indicacao_codigos enable row level security;
alter table public.indicacoes enable row level security;
alter table public.indicacao_comissoes enable row level security;
revoke all on public.indicacao_regras, public.indicacao_codigos, public.indicacoes, public.indicacao_comissoes from anon, authenticated;
grant select on public.indicacao_regras to anon, authenticated;
grant select on public.indicacao_codigos, public.indicacoes, public.indicacao_comissoes to authenticated;
drop policy if exists indicacao_regras_select_publico on public.indicacao_regras;
create policy indicacao_regras_select_publico on public.indicacao_regras for select to anon, authenticated using (true);
drop policy if exists indicacao_codigos_select_proprio on public.indicacao_codigos;
create policy indicacao_codigos_select_proprio on public.indicacao_codigos for select to authenticated
  using (usuario_id = (select auth.uid()) and (select public.cliente_aprovado()));
drop policy if exists indicacoes_select_proprio on public.indicacoes;
create policy indicacoes_select_proprio on public.indicacoes for select to authenticated
  using (indicador_id = (select auth.uid()) and (select public.cliente_aprovado()));
drop policy if exists indicacao_comissoes_select_proprio on public.indicacao_comissoes;
create policy indicacao_comissoes_select_proprio on public.indicacao_comissoes for select to authenticated
  using (indicador_id = (select auth.uid()) and (select public.cliente_aprovado()));
-- Escrita: só pelas funções abaixo (security definer) e service_role.

-- ---------------------------------------------------------------------------------------------------------------
-- 2) Auxiliares
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.situacao_comissao(p_situacao text, p_libera_em timestamptz) returns text
language sql stable set search_path = '' as $$
  select case when p_situacao = 'pendente' and p_libera_em <= now() then 'liberada' else p_situacao end
$$;

-- "Maria da Silva" -> "Maria S.": o indicador nunca vê e-mail, CNPJ, telefone nem nome completo do indicado.
create or replace function public.nome_curto_indicado(p_nome text) returns text
language sql immutable set search_path = '' as $$
  select case when coalesce(btrim(p_nome), '') = '' then 'Cliente'
    else split_part(btrim(p_nome), ' ', 1)
      || case when btrim(p_nome) like '% %' then ' ' || left(regexp_replace(btrim(p_nome), '^.*\s', ''), 1) || '.' else '' end end
$$;

create or replace function public.gerar_codigo_indicacao(p_usuario uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  select codigo into v from public.indicacao_codigos where usuario_id = p_usuario;
  if found then return v; end if;
  loop
    -- 8 caracteres hexadecimais em maiúsculas: sem O, I nem L (não confunde ao ditar o código).
    v := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.indicacao_codigos (usuario_id, codigo) values (p_usuario, v);
      return v;
    exception when unique_violation then
      select codigo into v from public.indicacao_codigos where usuario_id = p_usuario;
      if found then return v; end if; -- outra chamada criou ao mesmo tempo; senão o código repetiu: tenta outro
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3) Cadastro: liga o indicado ao indicador. Nunca impede o cadastro (erro aqui vira só aviso no log).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.vincular_indicacao_no_cadastro() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_meta jsonb; v_codigo text; v_em timestamptz; r public.indicacao_regras%rowtype; i public.clientes%rowtype; v_motivo text;
  so_digitos constant text := '\D';
begin
  -- to_jsonb: lê o metadado do cadastro sem depender da coluna existir (ensaio sem Auth real).
  select to_jsonb(u) -> 'raw_user_meta_data' into v_meta from auth.users u where u.id = new.id;
  v_codigo := upper(btrim(coalesce(v_meta ->> 'indicacao_codigo', '')));
  if v_codigo !~ '^[A-Z0-9]{6,12}$' then return new; end if;
  select * into r from public.indicacao_regras where id = 1;
  if not found or not r.ativo then return new; end if;
  begin v_em := (v_meta ->> 'indicacao_em')::timestamptz; exception when others then v_em := null; end;
  v_em := least(coalesce(v_em, now()), now());
  if v_em < now() - make_interval(days => r.dias_validade_link) then return new; end if; -- link vencido: cadastro segue sem indicação
  select c.* into i from public.indicacao_codigos k join public.clientes c on c.id = k.usuario_id where k.codigo = v_codigo;
  if not found then return new; end if;
  v_motivo := case
    when i.id = new.id then 'autoindicação'
    when lower(btrim(i.email)) = lower(btrim(new.email)) then 'mesmo e-mail do indicador'
    when nullif(regexp_replace(coalesce(i.cnpj, ''), so_digitos, '', 'g'), '') = nullif(regexp_replace(coalesce(new.cnpj, ''), so_digitos, '', 'g'), '') then 'mesmo CNPJ do indicador'
    when nullif(regexp_replace(coalesce(i.telefone, ''), so_digitos, '', 'g'), '') = nullif(regexp_replace(coalesce(new.telefone, ''), so_digitos, '', 'g'), '') then 'mesmo telefone do indicador'
  end;
  insert into public.indicacoes (indicador_id, indicado_id, codigo, clicado_em, situacao, motivo_bloqueio)
    values (i.id, new.id, v_codigo, v_em, case when v_motivo is null then 'cadastrado' else 'bloqueada' end, v_motivo)
    on conflict (indicado_id) do nothing;
  return new;
exception when others then
  raise warning 'indicação não vinculada ao cadastro %: %', new.id, sqlerrm;
  return new;
end $$;
drop trigger if exists clientes_vincular_indicacao on public.clientes;
create trigger clientes_vincular_indicacao after insert on public.clientes
  for each row execute function public.vincular_indicacao_no_cadastro();

-- ---------------------------------------------------------------------------------------------------------------
-- 4) Comissão: nasce do pagamento confirmado. Ponto de ligação do futuro webhook do Asaas: ele confirma o pagamento
--    por aplicar_pagamento_confirmado() (planos_e_recursos.sql) e o trigger abaixo chama esta função. Idempotente.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.indicacao_registrar_pagamento(p_pagamento uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.pagamentos%rowtype; ind public.indicacoes%rowtype; r public.indicacao_regras%rowtype;
  v_ciclo_meses integer; v_usados integer; v_meses integer; v_base integer; v_valor integer; v_id uuid;
begin
  select * into g from public.pagamentos where id = p_pagamento;
  if not found or g.situacao <> 'pago' or g.usuario_id is null then return jsonb_build_object('comissao', null, 'motivo', 'pagamento não confirmado'); end if;
  select id into v_id from public.indicacao_comissoes where pagamento_id = g.id;
  if found then return jsonb_build_object('comissao', v_id, 'ja_registrada', true); end if;
  select * into ind from public.indicacoes where indicado_id = g.usuario_id for update;
  if not found or ind.situacao = 'bloqueada' then return jsonb_build_object('comissao', null, 'motivo', 'sem indicação válida'); end if;
  select * into r from public.indicacao_regras where id = 1;
  if not found or not r.ativo then return jsonb_build_object('comissao', null, 'motivo', 'programa pausado'); end if;
  v_ciclo_meses := case g.ciclo when 'anual' then 12 else 1 end;
  select coalesce(sum(meses), 0) into v_usados from public.indicacao_comissoes where indicacao_id = ind.id and situacao <> 'cancelada';
  v_meses := least(v_ciclo_meses, r.meses_comissao - v_usados);
  if v_meses <= 0 then return jsonb_build_object('comissao', null, 'motivo', 'prazo da comissão encerrado'); end if;
  -- Plano anual: comissão só sobre os meses que ainda faltam no programa (ex.: 12 meses de programa = o ano inteiro).
  v_base := round(g.valor_centavos::numeric * v_meses / v_ciclo_meses);
  v_valor := round(v_base * r.percentual / 100);
  if v_valor <= 0 then return jsonb_build_object('comissao', null, 'motivo', 'valor zero'); end if;
  insert into public.indicacao_comissoes (indicacao_id, indicador_id, pagamento_id, meses, base_centavos, percentual, valor_centavos, libera_em)
    values (ind.id, ind.indicador_id, g.id, v_meses, v_base, r.percentual, v_valor, coalesce(g.pago_em, now()) + make_interval(days => r.dias_garantia))
    on conflict (pagamento_id) do nothing returning id into v_id;
  update public.indicacoes set situacao = 'cliente' where id = ind.id and situacao = 'cadastrado';
  return jsonb_build_object('comissao', v_id, 'valor_centavos', v_valor, 'meses', v_meses);
end $$;

-- Pago -> comissão; estornado/cancelado -> anula a comissão ainda não paga (a já paga fica e é descontada à mão).
create or replace function public.indicacao_ao_mudar_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.situacao = 'pago' and (tg_op = 'INSERT' or old.situacao is distinct from 'pago') then
    begin
      perform public.indicacao_registrar_pagamento(new.id);
    exception when others then
      raise warning 'comissão não registrada para o pagamento %: %', new.id, sqlerrm; -- nunca trava a confirmação do pagamento
    end;
  elsif tg_op = 'UPDATE' and new.situacao in ('estornado', 'cancelado') and old.situacao is distinct from new.situacao then
    update public.indicacao_comissoes set situacao = 'cancelada', motivo_cancelamento = 'pagamento ' || new.situacao
      where pagamento_id = new.id and situacao = 'pendente';
  end if;
  return new;
end $$;
drop trigger if exists pagamentos_indicacao on public.pagamentos;
create trigger pagamentos_indicacao after insert or update of situacao on public.pagamentos
  for each row execute function public.indicacao_ao_mudar_pagamento();

-- ---------------------------------------------------------------------------------------------------------------
-- 5) Tela "Indique e ganhe" (cliente aprovado)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.minhas_indicacoes() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_u uuid := auth.uid();
begin
  if v_u is null or not public.cliente_aprovado() then raise exception 'Acesso restrito a clientes aprovados' using errcode = '42501'; end if;
  return jsonb_build_object(
    'codigo', public.gerar_codigo_indicacao(v_u),
    'regras', (select to_jsonb(r) - 'id' - 'atualizado_por' - 'atualizado_em' from public.indicacao_regras r where r.id = 1),
    'indicados', (select coalesce(jsonb_agg(jsonb_build_object('nome', public.nome_curto_indicado(c.nome), 'situacao', i.situacao, 'desde', i.criado_em)
        order by i.criado_em desc), '[]'::jsonb)
      from public.indicacoes i left join public.clientes c on c.id = i.indicado_id where i.indicador_id = v_u),
    'comissoes', (select coalesce(jsonb_agg(jsonb_build_object('nome', public.nome_curto_indicado(c.nome), 'valor_centavos', k.valor_centavos,
        'meses', k.meses, 'situacao', public.situacao_comissao(k.situacao, k.libera_em), 'libera_em', k.libera_em, 'paga_em', k.paga_em,
        'saque_pedido_em', k.saque_pedido_em, 'criado_em', k.criado_em) order by k.criado_em desc), '[]'::jsonb)
      from public.indicacao_comissoes k left join public.indicacoes i on i.id = k.indicacao_id left join public.clientes c on c.id = i.indicado_id
      where k.indicador_id = v_u));
end $$;

-- Pede o Pix de tudo o que já está liberado (acima do mínimo). A equipe chama o indicador pelo contato do cadastro.
create or replace function public.pedir_saque_indicacao() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_u uuid := auth.uid(); v_total integer; v_min integer;
begin
  if v_u is null or not public.cliente_aprovado() then raise exception 'Acesso restrito a clientes aprovados' using errcode = '42501'; end if;
  select saque_minimo_centavos into v_min from public.indicacao_regras where id = 1;
  select coalesce(sum(valor_centavos), 0) into v_total from public.indicacao_comissoes
    where indicador_id = v_u and situacao = 'pendente' and libera_em <= now() and saque_pedido_em is null;
  if v_total = 0 then raise exception 'Nenhum valor liberado para saque'; end if;
  if v_total < v_min then raise exception 'O saque mínimo é de R$ %', replace(to_char(v_min / 100.0, 'FM999999990.00'), '.', ','); end if;
  update public.indicacao_comissoes set saque_pedido_em = now()
    where indicador_id = v_u and situacao = 'pendente' and libera_em <= now() and saque_pedido_em is null;
  return jsonb_build_object('total_centavos', v_total);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6) Admin (proprietário com 2 fatores, igual ao Financeiro)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_indicacoes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Indicações exigem o proprietário com 2 fatores' using errcode = '42501'; end if;
  return jsonb_build_object(
    'regras', (select to_jsonb(r) - 'id' from public.indicacao_regras r where r.id = 1),
    'indicacoes', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'indicado_id', i.indicado_id, 'situacao', i.situacao, 'motivo', i.motivo_bloqueio,
        'criado_em', i.criado_em, 'codigo', i.codigo, 'indicador', coalesce(nullif(a.nome, ''), a.email), 'indicador_email', a.email,
        'indicado', coalesce(nullif(b.nome, ''), b.email), 'indicado_email', b.email,
        'pagamentos', (select count(*) from public.pagamentos g where g.usuario_id = i.indicado_id and g.situacao = 'pago')) order by i.criado_em desc), '[]'::jsonb)
      from public.indicacoes i left join public.clientes a on a.id = i.indicador_id left join public.clientes b on b.id = i.indicado_id),
    'comissoes', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'valor_centavos', k.valor_centavos, 'base_centavos', k.base_centavos,
        'percentual', k.percentual, 'meses', k.meses, 'situacao', public.situacao_comissao(k.situacao, k.libera_em), 'libera_em', k.libera_em,
        'saque_pedido_em', k.saque_pedido_em, 'paga_em', k.paga_em, 'paga_referencia', k.paga_referencia, 'motivo_cancelamento', k.motivo_cancelamento,
        'indicador', coalesce(nullif(a.nome, ''), a.email), 'indicador_email', a.email, 'indicador_telefone', a.telefone,
        'indicado', coalesce(nullif(b.nome, ''), b.email)) order by k.criado_em desc), '[]'::jsonb)
      from public.indicacao_comissoes k left join public.clientes a on a.id = k.indicador_id
      left join public.indicacoes i on i.id = k.indicacao_id left join public.clientes b on b.id = i.indicado_id));
end $$;

-- Pix feito por fora (manual): marca as comissões liberadas como pagas, com o identificador da transferência.
create or replace function public.admin_pagar_comissoes(p_ids uuid[], p_referencia text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.admin_planos_autorizado() then raise exception 'Indicações exigem o proprietário com 2 fatores' using errcode = '42501'; end if;
  if coalesce(btrim(p_referencia), '') = '' or length(p_referencia) > 200 then raise exception 'Informe a referência do Pix (até 200 caracteres)'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Escolha as comissões'; end if;
  if exists (select 1 from unnest(p_ids) x(id) left join public.indicacao_comissoes k on k.id = x.id
      where k.id is null or public.situacao_comissao(k.situacao, k.libera_em) <> 'liberada') then
    raise exception 'Só comissões liberadas podem ser pagas (fora da garantia e não pagas/canceladas)';
  end if;
  update public.indicacao_comissoes set situacao = 'paga', paga_em = now(), paga_referencia = btrim(p_referencia), paga_por = public.admin_email_atual()
    where id = any (p_ids);
  get diagnostics n = row_count;
  return jsonb_build_object('pagas', n);
end $$;

create or replace function public.admin_cancelar_comissao(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Indicações exigem o proprietário com 2 fatores' using errcode = '42501'; end if;
  if coalesce(btrim(p_motivo), '') = '' or length(p_motivo) > 200 then raise exception 'Informe o motivo (até 200 caracteres)'; end if;
  update public.indicacao_comissoes set situacao = 'cancelada', motivo_cancelamento = btrim(p_motivo) where id = p_id and situacao = 'pendente';
  if not found then raise exception 'Comissão não encontrada ou já paga/cancelada'; end if;
  return jsonb_build_object('cancelada', p_id);
end $$;

create or replace function public.admin_salvar_regras_indicacao(p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.indicacao_regras%rowtype;
begin
  if not public.admin_planos_autorizado() then raise exception 'Indicações exigem o proprietário com 2 fatores' using errcode = '42501'; end if;
  if jsonb_typeof(p_dados) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_dados) k where k not in ('ativo', 'percentual',
      'meses_comissao', 'dias_garantia', 'saque_minimo_centavos', 'desconto_indicado_percentual', 'desconto_indicado_meses', 'dias_validade_link')) > 0
    then raise exception 'Campo não permitido'; end if;
  -- Valor novo vale para as próximas comissões; as já criadas guardam o percentual da época.
  update public.indicacao_regras set
    ativo = coalesce((p_dados ->> 'ativo')::boolean, ativo),
    percentual = coalesce((p_dados ->> 'percentual')::numeric, percentual),
    meses_comissao = coalesce((p_dados ->> 'meses_comissao')::integer, meses_comissao),
    dias_garantia = coalesce((p_dados ->> 'dias_garantia')::integer, dias_garantia),
    saque_minimo_centavos = coalesce((p_dados ->> 'saque_minimo_centavos')::integer, saque_minimo_centavos),
    desconto_indicado_percentual = coalesce((p_dados ->> 'desconto_indicado_percentual')::numeric, desconto_indicado_percentual),
    desconto_indicado_meses = coalesce((p_dados ->> 'desconto_indicado_meses')::integer, desconto_indicado_meses),
    dias_validade_link = coalesce((p_dados ->> 'dias_validade_link')::integer, dias_validade_link),
    atualizado_em = now(), atualizado_por = public.admin_email_atual()
  where id = 1 returning * into r;
  return to_jsonb(r) - 'id';
end $$;

revoke all on function public.situacao_comissao(text, timestamptz), public.nome_curto_indicado(text), public.gerar_codigo_indicacao(uuid),
  public.vincular_indicacao_no_cadastro(), public.indicacao_registrar_pagamento(uuid), public.indicacao_ao_mudar_pagamento(),
  public.minhas_indicacoes(), public.pedir_saque_indicacao(), public.admin_indicacoes(), public.admin_pagar_comissoes(uuid[], text),
  public.admin_cancelar_comissao(uuid, text), public.admin_salvar_regras_indicacao(jsonb) from public, anon, authenticated;
grant execute on function public.situacao_comissao(text, timestamptz), public.nome_curto_indicado(text) to authenticated, service_role;
grant execute on function public.indicacao_registrar_pagamento(uuid) to service_role;
grant execute on function public.minhas_indicacoes(), public.pedir_saque_indicacao(), public.admin_indicacoes(), public.admin_pagar_comissoes(uuid[], text),
  public.admin_cancelar_comissao(uuid, text), public.admin_salvar_regras_indicacao(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
