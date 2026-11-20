-- LicitaPlena: planos com regras automáticas (Grátis, Teste, Empresa, Assessoria, Dono), assinaturas,
-- pagamentos (preparado, sem integração) e funções do painel de administração.
-- Arquitetura: _historico/arquitetura-planos-admin-20261119.md. Teste: supabase/testar_planos.sql.
-- Idempotente: seguro rodar mais de uma vez no SQL Editor. Não apaga dados; não mexe em empresas, processos,
-- documentos nem membros. Rodar DEPOIS de seguranca_aprovacao_20261119.sql. Se limite_cnpjs_operacao.sql ou
-- acesso_empresa_convites.sql forem rodados de novo, rode este outra vez em seguida (ele redefine o trigger de CNPJs
-- e limite_cnpjs_operacao()).
begin;

-- ---------------------------------------------------------------------------------------------------------------
-- 1) Catálogo: planos, recursos e a tabela única plano x recurso. Leitura pública (é a página de preços);
--    escrita só pelas funções do admin (owner com 2 fatores) ou pelo SQL Editor.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.planos (
  codigo text primary key check (codigo ~ '^[a-z_]{2,30}$'),
  nome text not null check (length(nome) between 2 and 60),
  descricao text not null default '',
  max_cnpjs integer check (max_cnpjs is null or max_cnpjs >= 1),       -- vazio = sem limite
  max_usuarios integer check (max_usuarios is null or max_usuarios >= 1),
  max_processos integer check (max_processos is null or max_processos >= 0), -- processos não arquivados
  preco_mensal_centavos integer check (preco_mensal_centavos is null or preco_mensal_centavos >= 0),
  preco_anual_centavos integer check (preco_anual_centavos is null or preco_anual_centavos >= 0),
  dias_teste integer check (dias_teste is null or dias_teste between 1 and 90),
  escolhivel_no_cadastro boolean not null default false,
  ordem integer not null default 0,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.recursos_plano (
  codigo text primary key check (codigo ~ '^[a-z_]{2,30}$'),
  nome text not null,
  funcoes text[] not null default '{}'  -- nomes usados em uso_diario.funcao pelas rotas /api (verificarLimiteDiario)
);
create table if not exists public.plano_recursos (
  plano text not null references public.planos(codigo) on update cascade on delete cascade,
  recurso text not null references public.recursos_plano(codigo) on update cascade on delete cascade,
  permitido boolean not null default true,
  limite_diario integer check (limite_diario is null or limite_diario >= 0), -- vazio = limite padrão da rota
  primary key (plano, recurso)
);
alter table public.planos enable row level security;
alter table public.recursos_plano enable row level security;
alter table public.plano_recursos enable row level security;
revoke all on public.planos, public.recursos_plano, public.plano_recursos from anon, authenticated;
grant select on public.planos, public.recursos_plano, public.plano_recursos to anon, authenticated;
drop policy if exists planos_select_publico on public.planos;
create policy planos_select_publico on public.planos for select to anon, authenticated using (ativo);
drop policy if exists recursos_plano_select_publico on public.recursos_plano;
create policy recursos_plano_select_publico on public.recursos_plano for select to anon, authenticated using (true);
drop policy if exists plano_recursos_select_publico on public.plano_recursos;
create policy plano_recursos_select_publico on public.plano_recursos for select to anon, authenticated using (true);

-- Valores iniciais da proposta (pente-fino-cobranca-concorrentes-20261119.md, 4.1 e 4.2). "do nothing": o que o dono
-- editar depois não volta ao padrão quando este arquivo roda de novo.
insert into public.planos (codigo, nome, descricao, max_cnpjs, max_usuarios, max_processos, preco_mensal_centavos, preco_anual_centavos, dias_teste, escolhivel_no_cadastro, ordem) values
  ('gratis', 'Grátis', 'Busca e boletim de 1 CNPJ, 3 processos no CRM, sem proposta nem análise por CNPJ.', 1, 1, 3, 0, null, null, false, 1),
  ('teste', 'Teste grátis', '14 dias sem cartão. Vale o menor limite entre o plano escolhido e esta linha.', 3, 5, null, 0, null, 14, false, 2),
  ('empresa', 'Empresa', 'Para a empresa que licita: 1 CNPJ e 3 usuários.', 1, 3, null, 14900, 149000, null, true, 3),
  ('assessoria', 'Assessoria', 'Para assessorias e consultores: até 10 CNPJs e 5 usuários.', 10, 5, null, 29900, 299000, null, true, 4),
  ('dono', 'Dono (ilimitado)', 'Conta do proprietário do LicitaPlena.', null, null, null, null, null, null, false, 9)
on conflict (codigo) do nothing;
insert into public.recursos_plano (codigo, nome, funcoes) values
  ('ia', 'Inteligência artificial (resumo, busca e fornecedor com IA)', array['ia-edital', 'monte-busca-ia', 'fornecedor-ia']),
  ('analise_cnpj', 'Análise por CNPJ (concorrente)', array['analise-cnpj', 'analise-cnpj-buscar', 'analise-cnpj-cadastro']),
  ('proposta', 'Proposta e declarações', array['kit-documentos']),
  ('robo_lances', 'Extensão do Compras.gov e robô de lances', array['pregao-gravado', 'pregao-gravado-leitura', 'proposta-lote']),
  ('licitacao_anterior', 'Licitação anterior do órgão', array['licitacao-anterior', 'licitacao-anterior-orgaos'])
on conflict (codigo) do nothing;
insert into public.plano_recursos (plano, recurso, permitido, limite_diario) values
  ('gratis', 'ia', true, 3), ('gratis', 'analise_cnpj', false, null), ('gratis', 'proposta', false, null),
  ('gratis', 'robo_lances', false, null), ('gratis', 'licitacao_anterior', true, 2),
  ('teste', 'ia', true, 15), ('teste', 'analise_cnpj', true, 3), ('teste', 'proposta', true, null),
  ('teste', 'robo_lances', true, null), ('teste', 'licitacao_anterior', true, null),
  ('empresa', 'ia', true, null), ('empresa', 'analise_cnpj', true, null), ('empresa', 'proposta', true, null),
  ('empresa', 'robo_lances', true, null), ('empresa', 'licitacao_anterior', true, null),
  ('assessoria', 'ia', true, null), ('assessoria', 'analise_cnpj', true, null), ('assessoria', 'proposta', true, null),
  ('assessoria', 'robo_lances', true, null), ('assessoria', 'licitacao_anterior', true, null),
  ('dono', 'ia', true, null), ('dono', 'analise_cnpj', true, null), ('dono', 'proposta', true, null),
  ('dono', 'robo_lances', true, null), ('dono', 'licitacao_anterior', true, null)
on conflict (plano, recurso) do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 2) Assinatura (uma por titular = dono da organização), pagamentos e histórico. O titular só LÊ o que é dele;
--    ninguém grava pelo navegador. Colaborador convidado herda o plano do titular da organização.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.assinaturas (
  usuario_id uuid primary key references public.clientes(id) on delete cascade,
  plano text not null references public.planos(codigo) on update cascade,
  situacao text not null default 'teste' check (situacao in ('teste', 'ativa', 'vencida', 'suspensa', 'cancelada')),
  teste_ate timestamptz,
  ciclo text check (ciclo in ('mensal', 'anual')),
  valor_centavos integer check (valor_centavos is null or valor_centavos >= 0),
  vence_em date,
  max_cnpjs integer check (max_cnpjs is null or max_cnpjs >= 1),        -- ajuste do dono; vazio = o do plano
  max_usuarios integer check (max_usuarios is null or max_usuarios >= 1),
  max_processos integer check (max_processos is null or max_processos >= 0),
  plano_solicitado text references public.planos(codigo) on update cascade,
  plano_solicitado_em timestamptz,
  -- Pontos de ligação do pagamento (Asaas ou Inter PJ), ainda sem uso.
  gateway text check (gateway in ('pix_manual', 'asaas', 'inter')),
  gateway_cliente_id text,
  gateway_assinatura_id text,
  observacoes text check (length(observacoes) <= 2000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.clientes(id) on delete set null,   -- registro fiscal fica mesmo se a conta sair
  cliente_email text,
  plano text references public.planos(codigo) on update cascade,
  ciclo text check (ciclo in ('mensal', 'anual')),
  valor_centavos integer not null check (valor_centavos > 0),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'pago', 'cancelado', 'estornado', 'vencido')),
  metodo text not null default 'pix' check (metodo in ('pix', 'boleto', 'cartao', 'manual')),
  vencimento date,
  pago_em timestamptz,
  periodo_inicio date,
  periodo_fim date,
  referencia text check (length(referencia) <= 200),
  gateway text check (gateway in ('pix_manual', 'asaas', 'inter')),
  gateway_cobranca_id text unique,  -- o webhook acha o pagamento por aqui; único = entrega repetida não duplica
  observacoes text check (length(observacoes) <= 2000),
  criado_em timestamptz not null default now(),
  criado_por text
);
create index if not exists pagamentos_usuario_idx on public.pagamentos (usuario_id, criado_em desc);
create table if not exists public.assinaturas_historico (
  id bigint generated always as identity primary key,
  usuario_id uuid not null,
  acao text not null,
  antes jsonb,
  depois jsonb,
  feito_por text,
  feito_em timestamptz not null default now()
);
create index if not exists assinaturas_historico_usuario_idx on public.assinaturas_historico (usuario_id, feito_em desc);
alter table public.assinaturas enable row level security;
alter table public.pagamentos enable row level security;
alter table public.assinaturas_historico enable row level security;
revoke all on public.assinaturas, public.pagamentos, public.assinaturas_historico from anon, authenticated;
grant select on public.assinaturas, public.pagamentos to authenticated;
drop policy if exists assinaturas_select_proprio on public.assinaturas;
create policy assinaturas_select_proprio on public.assinaturas for select to authenticated using (usuario_id = (select auth.uid()));
drop policy if exists pagamentos_select_proprio on public.pagamentos;
create policy pagamentos_select_proprio on public.pagamentos for select to authenticated using (usuario_id = (select auth.uid()));
-- assinaturas_historico: sem policy = só funções security definer e service_role.

-- ---------------------------------------------------------------------------------------------------------------
-- 3) O cálculo do plano: uma função só, usada por triggers, RLS, rotas /api e telas.
-- ---------------------------------------------------------------------------------------------------------------
-- Owner administrativo com 2 fatores na sessão (aal2 vem do JWT; mesmo dado que auth.jwt() lê).
create or replace function public.admin_planos_autorizado() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.eh_owner_admin_operacao(auth.uid())
    and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2';
$$;

create or replace function public.titular_do_usuario(p_usuario uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.owner_id from public.operacao_organizacoes o where o.owner_id = p_usuario limit 1),
    (select o.owner_id from public.operacao_membros m join public.operacao_organizacoes o on o.id = m.organizacao_id
      where m.usuario_id = p_usuario order by m.criado_em limit 1),
    p_usuario);
$$;

create or replace function public.plano_efetivo_titular(p_titular uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a public.assinaturas%rowtype; p public.planos%rowtype; t public.planos%rowtype;
  v_tem boolean := false; v_contratado text; v_efetivo text; v_teste boolean := false; v_situacao text;
  v_max_c integer; v_max_u integer; v_max_p integer; v_rec jsonb;
begin
  if p_titular is not null and public.eh_owner_admin_operacao(p_titular) then
    v_contratado := 'dono'; v_efetivo := 'dono'; v_situacao := 'ativa';
  else
    select * into a from public.assinaturas where usuario_id = p_titular;
    v_tem := found;
    if not v_tem then
      -- Dono de organização sem linha em clientes (caso legado): regras do teste, como a cota antiga de 3 CNPJs.
      v_contratado := 'teste'; v_efetivo := 'teste'; v_situacao := 'sem_assinatura';
    else
      v_contratado := a.plano; v_situacao := a.situacao;
      -- Vencimento com 5 dias de tolerância; teste vencido, vencida, suspensa e cancelada caem para o Grátis.
      v_efetivo := case
        when a.situacao = 'ativa' and (a.vence_em is null or a.vence_em + 5 >= current_date) then a.plano
        when a.situacao = 'teste' and (a.teste_ate is null or a.teste_ate > now()) then a.plano
        else 'gratis' end;
      v_teste := a.situacao = 'teste' and v_efetivo = a.plano;
    end if;
  end if;
  select * into p from public.planos where codigo = v_efetivo;
  if not found then v_efetivo := 'gratis'; v_teste := false; select * into p from public.planos where codigo = 'gratis'; end if;
  v_max_c := p.max_cnpjs; v_max_u := p.max_usuarios; v_max_p := p.max_processos;
  if v_teste then
    -- least() ignora vazio (sem limite): vale o menor entre o plano escolhido e a linha Teste.
    select * into t from public.planos where codigo = 'teste';
    v_max_c := least(v_max_c, t.max_cnpjs); v_max_u := least(v_max_u, t.max_usuarios); v_max_p := least(v_max_p, t.max_processos);
  end if;
  if v_tem and v_efetivo = a.plano then
    v_max_c := coalesce(a.max_cnpjs, v_max_c); v_max_u := coalesce(a.max_usuarios, v_max_u); v_max_p := coalesce(a.max_processos, v_max_p);
  end if;
  select coalesce(jsonb_object_agg(r.codigo, jsonb_build_object(
      'nome', r.nome,
      'permitido', v_efetivo = 'dono' or (coalesce(pr.permitido, false) and (not v_teste or coalesce(tr.permitido, false))),
      'limite_diario', case when v_teste then least(pr.limite_diario, tr.limite_diario) else pr.limite_diario end)), '{}'::jsonb)
    into v_rec
    from public.recursos_plano r
    left join public.plano_recursos pr on pr.plano = v_efetivo and pr.recurso = r.codigo
    left join public.plano_recursos tr on tr.plano = 'teste' and tr.recurso = r.codigo;
  return jsonb_build_object('plano', v_efetivo, 'nome', p.nome, 'plano_contratado', v_contratado,
    'nome_contratado', (select nome from public.planos where codigo = v_contratado),
    'situacao', v_situacao, 'em_teste', v_teste, 'teste_ate', a.teste_ate, 'vence_em', a.vence_em,
    'plano_solicitado', a.plano_solicitado,
    'max_cnpjs', v_max_c, 'max_usuarios', v_max_u, 'max_processos', v_max_p, 'recursos', v_rec);
end $$;

-- Interna: a organização pode usar o recurso, ou cabe mais um CNPJ / usuário / processo?
create or replace function public.pode_organizacao(p_org uuid, p_o_que text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; n integer; v_lim integer;
begin
  v := public.plano_efetivo_titular((select owner_id from public.operacao_organizacoes where id = p_org));
  if p_o_que in ('novo_cnpj', 'novo_usuario', 'novo_processo') then
    v_lim := (v ->> case p_o_que when 'novo_cnpj' then 'max_cnpjs' when 'novo_usuario' then 'max_usuarios' else 'max_processos' end)::integer;
    if v_lim is null then return true; end if;
    if p_o_que = 'novo_cnpj' then
      select count(*) into n from public.operacao_empresas where organizacao_id = p_org and ativo;
    elsif p_o_que = 'novo_usuario' then
      select count(distinct usuario_id) into n from public.operacao_membros where organizacao_id = p_org;
    else
      select count(*) into n from public.operacao_processos where organizacao_id = p_org and status <> 'arquivado';
    end if;
    return n < v_lim;
  end if;
  return coalesce((v -> 'recursos' -> p_o_que ->> 'permitido')::boolean, false);
end $$;

-- Para RLS e telas: só responde a quem tem vínculo com a organização (não revela o plano de outra).
create or replace function public.organizacao_pode(p_org uuid, p_o_que text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tem_vinculo_operacao(p_org) and public.pode_organizacao(p_org, p_o_que);
$$;

revoke all on function public.admin_planos_autorizado(), public.titular_do_usuario(uuid), public.plano_efetivo_titular(uuid),
  public.pode_organizacao(uuid, text), public.organizacao_pode(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_planos_autorizado(), public.organizacao_pode(uuid, text) to authenticated;
grant execute on function public.titular_do_usuario(uuid), public.plano_efetivo_titular(uuid), public.pode_organizacao(uuid, text) to service_role;

-- O que a pessoa logada pode usar, com o uso de agora (telas: painel, operacao, sistema).
create or replace function public.meu_plano() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_usuario uuid := auth.uid(); v_tit uuid; v jsonb; v_org uuid;
begin
  if v_usuario is null then raise exception 'Sessão inválida' using errcode = '42501'; end if;
  v_tit := public.titular_do_usuario(v_usuario);
  v := public.plano_efetivo_titular(v_tit);
  select id into v_org from public.operacao_organizacoes where owner_id = v_tit order by criado_em limit 1;
  return v || jsonb_build_object('eh_titular', v_tit = v_usuario,
    'uso', jsonb_build_object(
      'cnpjs', (select count(*) from public.operacao_empresas where organizacao_id = v_org and ativo),
      'usuarios', (select count(distinct usuario_id) from public.operacao_membros where organizacao_id = v_org),
      'processos', (select count(*) from public.operacao_processos where organizacao_id = v_org and status <> 'arquivado'),
      'hoje', (select coalesce(jsonb_object_agg(r.codigo, (select coalesce(sum(u.contagem), 0) from public.uso_diario u
          where u.usuario_id = v_usuario and u.dia = current_date and u.funcao = any (r.funcoes))), '{}'::jsonb) from public.recursos_plano r)),
    'planos_disponiveis', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome, 'max_cnpjs', max_cnpjs,
        'preco_mensal_centavos', preco_mensal_centavos, 'preco_anual_centavos', preco_anual_centavos) order by ordem), '[]'::jsonb)
      from public.planos where ativo and escolhivel_no_cadastro));
end $$;
revoke all on function public.meu_plano() from public, anon;
grant execute on function public.meu_plano() to authenticated;

-- Pedido de plano (no fim do teste ou para mudar): só registra; quem muda é o admin.
create or replace function public.solicitar_plano(p_plano text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_usuario uuid := auth.uid(); a public.assinaturas%rowtype;
begin
  if v_usuario is null then raise exception 'Sessão inválida' using errcode = '42501'; end if;
  if public.titular_do_usuario(v_usuario) <> v_usuario then raise exception 'Só o titular da conta pode pedir mudança de plano' using errcode = '42501'; end if;
  if not exists (select 1 from public.planos where codigo = p_plano and ativo and escolhivel_no_cadastro) then raise exception 'Plano indisponível'; end if;
  update public.assinaturas set plano_solicitado = p_plano, plano_solicitado_em = now(), atualizado_em = now()
    where usuario_id = v_usuario returning * into a;
  if not found then raise exception 'Assinatura não encontrada'; end if;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por) values (v_usuario, 'plano_solicitado', jsonb_build_object('plano', p_plano), 'cliente');
  return jsonb_build_object('plano_solicitado', a.plano_solicitado, 'plano_solicitado_em', a.plano_solicitado_em);
end $$;
revoke all on function public.solicitar_plano(text) from public, anon;
grant execute on function public.solicitar_plano(text) to authenticated;

-- Rotas /api (verificarLimiteDiario, só chave de serviço): o plano inclui o recurso da rota? Limite do plano ou da rota.
create or replace function public.consumir_uso_plano(p_usuario_id uuid, p_funcao text, p_limite_padrao integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_rec text; v_r jsonb; v_lim integer := p_limite_padrao; n integer;
begin
  if p_usuario_id is null or p_funcao is null then raise exception 'Parâmetros inválidos'; end if;
  v := public.plano_efetivo_titular(public.titular_do_usuario(p_usuario_id));
  select codigo into v_rec from public.recursos_plano where p_funcao = any (funcoes) order by codigo limit 1;
  if v_rec is not null then
    v_r := v -> 'recursos' -> v_rec;
    if not coalesce((v_r ->> 'permitido')::boolean, false) then
      return jsonb_build_object('permitido', false, 'motivo', 'plano', 'recurso', v_rec, 'nome_recurso', v_r ->> 'nome', 'plano', v ->> 'nome');
    end if;
    v_lim := coalesce((v_r ->> 'limite_diario')::integer, p_limite_padrao);
  end if;
  n := public.incrementar_uso(p_usuario_id, p_funcao);
  -- Limite do plano vale para o recurso inteiro (ex.: Grátis = 3 de IA/dia somando resumo, pergunta, fornecedor e chat),
  -- igual ao "hoje" de meu_plano. Sem limite no plano, cada rota segue com o próprio padrão.
  if v_rec is not null and (v_r ->> 'limite_diario') is not null then
    select coalesce(sum(u.contagem), 0)::integer into n from public.uso_diario u
      where u.usuario_id = p_usuario_id and u.dia = current_date and u.funcao = any (select unnest(r.funcoes) from public.recursos_plano r where r.codigo = v_rec);
  end if;
  return jsonb_build_object('permitido', v_lim is null or n <= v_lim, 'contagem', n, 'limite', v_lim, 'recurso', v_rec, 'plano', v ->> 'nome');
end $$;
revoke all on function public.consumir_uso_plano(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consumir_uso_plano(uuid, text, integer) to service_role;

-- A tela "Minhas empresas" já chama esta função: agora devolve o limite do plano (vazio = sem limite).
create or replace function public.limite_cnpjs_operacao() returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  return (public.plano_efetivo_titular(public.titular_do_usuario(auth.uid())) ->> 'max_cnpjs')::integer;
end $$;
revoke all on function public.limite_cnpjs_operacao() from public, anon;
grant execute on function public.limite_cnpjs_operacao() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4) Garantias no banco: CNPJs, usuários e processos (vale para tela, /api e SQL).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.verificar_limite_cnpjs_operacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v jsonb;
begin
  if not new.ativo then return new; end if;
  if tg_op = 'UPDATE' then
    if old.ativo and old.organizacao_id = new.organizacao_id then return new; end if;
  end if;
  -- O bloqueio na organização serializa dois cadastros simultâneos.
  select owner_id into v_owner from public.operacao_organizacoes where id = new.organizacao_id for update;
  if v_owner is null then raise exception 'Organização não encontrada'; end if;
  if not public.pode_organizacao(new.organizacao_id, 'novo_cnpj') then
    v := public.plano_efetivo_titular(v_owner);
    raise exception 'Limite de % CNPJs ativos atingido para esta conta', v ->> 'max_cnpjs'
      using errcode = 'P0001', hint = 'Plano ' || (v ->> 'nome') || '. Para mais empresas, peça a mudança de plano.';
  end if;
  return new;
end $$;
drop trigger if exists operacao_empresas_limite_cnpjs on public.operacao_empresas;
create trigger operacao_empresas_limite_cnpjs before insert or update of ativo, organizacao_id on public.operacao_empresas
  for each row execute function public.verificar_limite_cnpjs_operacao();

create or replace function public.verificar_limite_usuarios_operacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform 1 from public.operacao_organizacoes where id = new.organizacao_id for update;
  if exists (select 1 from public.operacao_membros where organizacao_id = new.organizacao_id and usuario_id = new.usuario_id) then return new; end if;
  if not public.pode_organizacao(new.organizacao_id, 'novo_usuario') then
    v := public.plano_efetivo_titular((select owner_id from public.operacao_organizacoes where id = new.organizacao_id));
    raise exception 'Limite de % usuários atingido para esta conta', v ->> 'max_usuarios'
      using errcode = 'P0001', hint = 'Plano ' || (v ->> 'nome') || '.';
  end if;
  return new;
end $$;
drop trigger if exists operacao_membros_limite_usuarios on public.operacao_membros;
create trigger operacao_membros_limite_usuarios before insert on public.operacao_membros
  for each row execute function public.verificar_limite_usuarios_operacao();

create or replace function public.verificar_limite_processos_operacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if new.status = 'arquivado' then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'arquivado' then return new; end if;
  perform 1 from public.operacao_organizacoes where id = new.organizacao_id for update;
  if not public.pode_organizacao(new.organizacao_id, 'novo_processo') then
    v := public.plano_efetivo_titular((select owner_id from public.operacao_organizacoes where id = new.organizacao_id));
    raise exception 'Limite de % processos ativos atingido para esta conta', v ->> 'max_processos'
      using errcode = 'P0001', hint = 'Plano ' || (v ->> 'nome') || '. Arquive um processo ou peça a mudança de plano.';
  end if;
  return new;
end $$;
drop trigger if exists operacao_processos_limite_plano on public.operacao_processos;
create trigger operacao_processos_limite_plano before insert or update of status on public.operacao_processos
  for each row execute function public.verificar_limite_processos_operacao();

-- RLS: o navegador grava processos direto (Funil). Policy restritiva = a mesma regra antes de chegar ao trigger.
drop policy if exists operacao_processos_plano_permite on public.operacao_processos;
create policy operacao_processos_plano_permite on public.operacao_processos as restrictive for insert to authenticated
  with check (public.organizacao_pode(organizacao_id, 'novo_processo'));

-- Proposta e declarações: a rota kit-documentos confere o recurso "proposta" por consumir_uso_plano. Sem trigger nem
-- policy em operacao_kit_documentos: o gate do kit (02-verificar) exige a tabela exatamente como kit_documentos.sql deixa.
drop trigger if exists operacao_kit_documentos_plano on public.operacao_kit_documentos;
drop function if exists public.verificar_plano_kit_documentos();

-- ---------------------------------------------------------------------------------------------------------------
-- 5) Cadastro -> teste. A assinatura nasce com o cadastro; o prazo do teste começa na aprovação.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.criar_assinatura_do_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pedido text; v_plano text; v_dias integer;
begin
  -- to_jsonb: lê o metadado do cadastro sem depender da coluna existir (ensaio sem Auth real).
  select to_jsonb(u) -> 'raw_user_meta_data' ->> 'plano_desejado' into v_pedido from auth.users u where u.id = new.id;
  v_plano := case
    when lower(coalesce(new.plano, '')) in ('gratis', 'empresa', 'assessoria') then lower(new.plano)
    when exists (select 1 from public.planos where codigo = v_pedido and ativo and escolhivel_no_cadastro) then v_pedido
    else 'assessoria' end; -- sem escolha: teste com até 3 CNPJs, como a cota antiga
  select dias_teste into v_dias from public.planos where codigo = 'teste';
  insert into public.assinaturas (usuario_id, plano, situacao, teste_ate, atualizado_por)
    values (new.id, v_plano, 'teste', case when new.status = 'aprovado' then now() + make_interval(days => coalesce(v_dias, 14)) end, 'cadastro')
    on conflict (usuario_id) do nothing;
  update public.clientes set plano = v_plano where id = new.id and plano is distinct from v_plano;
  return new;
end $$;
drop trigger if exists clientes_criar_assinatura on public.clientes;
create trigger clientes_criar_assinatura after insert on public.clientes
  for each row execute function public.criar_assinatura_do_cliente();

create or replace function public.iniciar_teste_na_aprovacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_dias integer;
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    select dias_teste into v_dias from public.planos where codigo = 'teste';
    update public.assinaturas set teste_ate = now() + make_interval(days => coalesce(v_dias, 14)), atualizado_em = now()
      where usuario_id = new.id and situacao = 'teste' and teste_ate is null;
  end if;
  return new;
end $$;
drop trigger if exists clientes_iniciar_teste on public.clientes;
create trigger clientes_iniciar_teste after update of status on public.clientes
  for each row execute function public.iniciar_teste_na_aprovacao();

revoke all on function public.verificar_limite_usuarios_operacao(), public.verificar_limite_processos_operacao(),
  public.criar_assinatura_do_cliente(), public.iniciar_teste_na_aprovacao() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 6) Migração das contas existentes (só quem ainda não tem assinatura; nada é apagado).
-- ---------------------------------------------------------------------------------------------------------------
with base as (
  select c.id, c.status, c.plano as plano_antigo, l.limite, public.eh_owner_admin_operacao(c.id) as owner,
    (select count(*) from public.operacao_organizacoes o join public.operacao_empresas e on e.organizacao_id = o.id and e.ativo where o.owner_id = c.id)::int as ativos,
    (select count(distinct m.usuario_id) from public.operacao_organizacoes o join public.operacao_membros m on m.organizacao_id = o.id where o.owner_id = c.id)::int as usuarios
  from public.clientes c left join public.operacao_limites_cnpj l on l.usuario_id = c.id
  where not exists (select 1 from public.assinaturas a where a.usuario_id = c.id)
), escolha as (
  select b.*, case
    when b.owner then 'dono'
    when lower(trim(coalesce(b.plano_antigo, ''))) in ('gratis', 'empresa', 'assessoria') then lower(trim(b.plano_antigo))
    when b.limite = 1 then 'empresa'
    when b.limite is not null then 'assessoria'
    when b.ativos > 1 then 'assessoria'
    else 'empresa' end as plano
  from base b
)
insert into public.assinaturas (usuario_id, plano, situacao, max_cnpjs, max_usuarios, observacoes, atualizado_por)
select e.id, e.plano, case when e.status = 'aprovado' or e.owner then 'ativa' else 'teste' end,
  case when e.plano <> 'dono' and (e.ativos > coalesce(p.max_cnpjs, e.ativos) or (e.plano = 'assessoria' and e.limite > 1))
    then greatest(e.ativos, coalesce(e.limite, 0)) end,
  case when e.plano <> 'dono' and e.usuarios > coalesce(p.max_usuarios, e.usuarios) then e.usuarios end,
  'Migração de 19/11/2026. Plano anterior: ' || coalesce(nullif(e.plano_antigo, ''), 'vazio') || coalesce('; cota de CNPJs anterior: ' || e.limite, ''),
  'migracao'
from escolha e join public.planos p on p.codigo = e.plano
on conflict (usuario_id) do nothing;
update public.clientes c set plano = a.plano from public.assinaturas a where a.usuario_id = c.id and c.plano is distinct from a.plano;

-- ---------------------------------------------------------------------------------------------------------------
-- 7) Pagamento confirmado: ponto ÚNICO de ligação com o gateway (admin hoje; webhook do Asaas/Inter depois).
--    Idempotente: pagar de novo o mesmo registro não estende o prazo duas vezes.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.aplicar_pagamento_confirmado(p_pagamento uuid, p_feito_por text default 'servidor') returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.pagamentos%rowtype; a public.assinaturas%rowtype; v_inicio date; v_fim date;
begin
  select * into g from public.pagamentos where id = p_pagamento for update;
  if not found then raise exception 'Pagamento não encontrado'; end if;
  if g.situacao = 'pago' then return jsonb_build_object('ja_aplicado', true, 'pagamento', g.id); end if;
  if g.situacao <> 'pendente' then raise exception 'Pagamento % não pode ser confirmado', g.situacao; end if;
  if g.usuario_id is null or g.plano is null or g.ciclo is null then raise exception 'Pagamento sem conta, plano ou ciclo'; end if;
  select * into a from public.assinaturas where usuario_id = g.usuario_id for update;
  if not found then raise exception 'Assinatura não encontrada'; end if;
  v_inicio := greatest(current_date, coalesce(case when a.situacao = 'ativa' then a.vence_em end, current_date));
  v_fim := (v_inicio + case g.ciclo when 'anual' then interval '1 year' else interval '1 month' end)::date;
  update public.pagamentos set situacao = 'pago', pago_em = coalesce(pago_em, now()), periodo_inicio = v_inicio, periodo_fim = v_fim where id = g.id;
  update public.assinaturas set plano = g.plano, situacao = 'ativa', ciclo = g.ciclo, valor_centavos = g.valor_centavos,
    vence_em = v_fim, plano_solicitado = null, atualizado_em = now(), atualizado_por = p_feito_por where usuario_id = g.usuario_id;
  update public.clientes set plano = g.plano where id = g.usuario_id and plano is distinct from g.plano;
  insert into public.assinaturas_historico (usuario_id, acao, antes, depois, feito_por)
    values (g.usuario_id, 'pagamento_confirmado', to_jsonb(a), jsonb_build_object('pagamento', g.id, 'plano', g.plano, 'vence_em', v_fim), p_feito_por);
  return jsonb_build_object('ja_aplicado', false, 'pagamento', g.id, 'vence_em', v_fim);
end $$;
revoke all on function public.aplicar_pagamento_confirmado(uuid, text) from public, anon, authenticated;
grant execute on function public.aplicar_pagamento_confirmado(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 8) Painel de administração. Listar/aprovar: quem aprova cadastros. Plano, limites e financeiro: owner com 2 fatores.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_email_atual() returns text
language sql stable security definer set search_path = public as $$ select email from auth.users where id = auth.uid() $$;

create or replace function public.admin_listar_contas() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(x order by x ->> 'criado_em' desc), '[]'::jsonb) from (
    select (to_jsonb(c) - 'boletim_filtro') || jsonb_build_object(
      'assinatura', to_jsonb(a),
      'titular_id', t.tit, 'titular_nome', case when t.tit <> c.id then (select coalesce(nullif(nome, ''), email) from public.clientes where id = t.tit) end,
      'efetivo', public.plano_efetivo_titular(t.tit) - 'recursos',
      'cnpjs_ativos', (select count(*) from public.operacao_organizacoes o join public.operacao_empresas e on e.organizacao_id = o.id and e.ativo where o.owner_id = c.id),
      'usuarios', (select count(distinct m.usuario_id) from public.operacao_organizacoes o join public.operacao_membros m on m.organizacao_id = o.id where o.owner_id = c.id),
      'processos_ativos', (select count(*) from public.operacao_organizacoes o join public.operacao_processos p on p.organizacao_id = o.id and p.status <> 'arquivado' where o.owner_id = c.id),
      'uso_hoje', (select coalesce(sum(u.contagem), 0) from public.uso_diario u where u.usuario_id = c.id and u.dia = current_date),
      'uso_30d', (select coalesce(sum(u.contagem), 0) from public.uso_diario u where u.usuario_id = c.id and u.dia > current_date - 30)) as x
    from public.clientes c
    left join public.assinaturas a on a.usuario_id = c.id
    cross join lateral (select public.titular_do_usuario(c.id) as tit) t) s);
end $$;

create or replace function public.admin_empresas_da_conta(p_usuario uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  return jsonb_build_object(
    'empresas', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'ativo', e.ativo, 'criado_em', e.criado_em) order by e.ativo desc, e.razao_social), '[]'::jsonb)
      from public.operacao_organizacoes o join public.operacao_empresas e on e.organizacao_id = o.id where o.owner_id = p_usuario),
    'membros', (select coalesce(jsonb_agg(jsonb_build_object('nome', c.nome, 'email', coalesce(c.email, u.email), 'papel', m.papel,
        'empresa', (select razao_social from public.operacao_empresas where id = m.empresa_id)) order by m.criado_em), '[]'::jsonb)
      from public.operacao_organizacoes o join public.operacao_membros m on m.organizacao_id = o.id
      left join public.clientes c on c.id = m.usuario_id left join auth.users u on u.id = m.usuario_id where o.owner_id = p_usuario));
end $$;

-- Aprovar, reprovar, voltar para pendente, suspender (= login bloqueado + assinatura suspensa) e reativar.
create or replace function public.admin_definir_status_cliente(p_usuario uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes%rowtype; v_status text;
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  if p_status not in ('pendente', 'aprovado', 'rejeitado', 'suspenso', 'reativar') then raise exception 'Situação inválida'; end if;
  if p_status in ('suspenso', 'reativar') and not public.admin_planos_autorizado() then
    raise exception 'Suspender e reativar exigem o proprietário com 2 fatores' using errcode = '42501';
  end if;
  if public.eh_owner_admin_operacao(p_usuario) and p_status <> 'aprovado' and p_status <> 'reativar' then raise exception 'A conta do proprietário não pode ser bloqueada'; end if;
  v_status := case p_status when 'suspenso' then 'rejeitado' when 'reativar' then 'aprovado' else p_status end;
  update public.clientes set status = v_status,
    aprovado_em = case when v_status = 'aprovado' then coalesce(aprovado_em, now()) end,
    aprovado_por = case when v_status = 'aprovado' then coalesce(aprovado_por, public.admin_email_atual()) end
    where id = p_usuario returning * into c;
  if not found then raise exception 'Cliente não encontrado'; end if;
  if p_status = 'suspenso' then
    update public.assinaturas set situacao = 'suspensa', atualizado_em = now(), atualizado_por = public.admin_email_atual() where usuario_id = p_usuario;
  elsif p_status = 'reativar' then
    update public.assinaturas set situacao = 'ativa', atualizado_em = now(), atualizado_por = public.admin_email_atual() where usuario_id = p_usuario and situacao = 'suspensa';
  end if;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por)
    values (p_usuario, 'status_' || p_status, jsonb_build_object('status', c.status), public.admin_email_atual());
  return jsonb_build_object('status', c.status);
end $$;

-- Plano e limites de uma conta. p_dados: plano, situacao, teste_ate, vence_em, ciclo, valor_centavos, max_cnpjs,
-- max_usuarios, max_processos, observacoes. Chave ausente = mantém; null = limpa (ajuste volta ao do plano).
create or replace function public.admin_definir_assinatura(p_usuario uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.assinaturas%rowtype; n public.assinaturas%rowtype; v jsonb; v_uso jsonb;
begin
  if not public.admin_planos_autorizado() then raise exception 'Mudar plano exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  if jsonb_typeof(p_dados) is distinct from 'object' then raise exception 'Dados inválidos'; end if;
  if (select count(*) from jsonb_object_keys(p_dados) k where k not in ('plano', 'situacao', 'teste_ate', 'vence_em', 'ciclo',
      'valor_centavos', 'max_cnpjs', 'max_usuarios', 'max_processos', 'observacoes')) > 0 then raise exception 'Campo não permitido'; end if;
  select * into a from public.assinaturas where usuario_id = p_usuario for update;
  if not found then raise exception 'Assinatura não encontrada'; end if;
  n := a;
  if p_dados ? 'plano' then n.plano := p_dados ->> 'plano'; end if;
  if p_dados ? 'situacao' then n.situacao := p_dados ->> 'situacao'; end if;
  if p_dados ? 'teste_ate' then n.teste_ate := (p_dados ->> 'teste_ate')::timestamptz; end if;
  if p_dados ? 'vence_em' then n.vence_em := (p_dados ->> 'vence_em')::date; end if;
  if p_dados ? 'ciclo' then n.ciclo := nullif(p_dados ->> 'ciclo', ''); end if;
  if p_dados ? 'valor_centavos' then n.valor_centavos := (p_dados ->> 'valor_centavos')::integer; end if;
  if p_dados ? 'max_cnpjs' then n.max_cnpjs := (p_dados ->> 'max_cnpjs')::integer; end if;
  if p_dados ? 'max_usuarios' then n.max_usuarios := (p_dados ->> 'max_usuarios')::integer; end if;
  if p_dados ? 'max_processos' then n.max_processos := (p_dados ->> 'max_processos')::integer; end if;
  if p_dados ? 'observacoes' then n.observacoes := p_dados ->> 'observacoes'; end if;
  if not exists (select 1 from public.planos where codigo = n.plano) then raise exception 'Plano inexistente'; end if;
  if n.plano = 'dono' and not public.eh_owner_admin_operacao(p_usuario) then raise exception 'O plano Dono é só do proprietário'; end if;
  if n.plano = 'teste' then raise exception 'Teste é uma situação, não um plano: escolha o plano e a situação "teste"'; end if;
  if n.plano is distinct from a.plano then n.plano_solicitado := null; end if;
  update public.assinaturas set plano = n.plano, situacao = n.situacao, teste_ate = n.teste_ate, vence_em = n.vence_em, ciclo = n.ciclo,
    valor_centavos = n.valor_centavos, max_cnpjs = n.max_cnpjs, max_usuarios = n.max_usuarios, max_processos = n.max_processos,
    observacoes = n.observacoes, plano_solicitado = n.plano_solicitado, atualizado_em = now(), atualizado_por = public.admin_email_atual()
    where usuario_id = p_usuario;
  -- Não rebaixa abaixo do que a conta já usa (o dono desativa empresas ou usuários antes).
  v := public.plano_efetivo_titular(p_usuario);
  select jsonb_build_object(
    'cnpjs', (select count(*) from public.operacao_organizacoes o join public.operacao_empresas e on e.organizacao_id = o.id and e.ativo where o.owner_id = p_usuario),
    'usuarios', (select count(distinct m.usuario_id) from public.operacao_organizacoes o join public.operacao_membros m on m.organizacao_id = o.id where o.owner_id = p_usuario))
    into v_uso;
  if (v ->> 'plano') = n.plano and (v ->> 'max_cnpjs') is not null and (v_uso ->> 'cnpjs')::int > (v ->> 'max_cnpjs')::int then
    raise exception 'A conta tem % CNPJs ativos e o plano permite %. Desative empresas antes ou ajuste o limite.', v_uso ->> 'cnpjs', v ->> 'max_cnpjs';
  end if;
  if (v ->> 'plano') = n.plano and (v ->> 'max_usuarios') is not null and (v_uso ->> 'usuarios')::int > (v ->> 'max_usuarios')::int then
    raise exception 'A conta tem % usuários e o plano permite %. Revogue acessos antes ou ajuste o limite.', v_uso ->> 'usuarios', v ->> 'max_usuarios';
  end if;
  update public.clientes set plano = n.plano where id = p_usuario and plano is distinct from n.plano;
  insert into public.assinaturas_historico (usuario_id, acao, antes, depois, feito_por)
    values (p_usuario, 'assinatura_alterada', to_jsonb(a), (select to_jsonb(x) from public.assinaturas x where x.usuario_id = p_usuario), public.admin_email_atual());
  return v;
end $$;

create or replace function public.admin_salvar_plano(p_codigo text, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  if jsonb_typeof(p_dados) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_dados) k where k not in
    ('nome', 'descricao', 'max_cnpjs', 'max_usuarios', 'max_processos', 'preco_mensal_centavos', 'preco_anual_centavos', 'dias_teste', 'escolhivel_no_cadastro', 'ativo')) > 0
    then raise exception 'Campo não permitido'; end if;
  update public.planos set
    nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
    descricao = case when p_dados ? 'descricao' then coalesce(p_dados ->> 'descricao', '') else descricao end,
    max_cnpjs = case when p_dados ? 'max_cnpjs' then (p_dados ->> 'max_cnpjs')::integer else max_cnpjs end,
    max_usuarios = case when p_dados ? 'max_usuarios' then (p_dados ->> 'max_usuarios')::integer else max_usuarios end,
    max_processos = case when p_dados ? 'max_processos' then (p_dados ->> 'max_processos')::integer else max_processos end,
    preco_mensal_centavos = case when p_dados ? 'preco_mensal_centavos' then (p_dados ->> 'preco_mensal_centavos')::integer else preco_mensal_centavos end,
    preco_anual_centavos = case when p_dados ? 'preco_anual_centavos' then (p_dados ->> 'preco_anual_centavos')::integer else preco_anual_centavos end,
    dias_teste = case when p_dados ? 'dias_teste' then (p_dados ->> 'dias_teste')::integer else dias_teste end,
    escolhivel_no_cadastro = case when p_dados ? 'escolhivel_no_cadastro' then (p_dados ->> 'escolhivel_no_cadastro')::boolean else escolhivel_no_cadastro end,
    ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end,
    atualizado_em = now()
  where codigo = p_codigo;
  if not found then raise exception 'Plano inexistente'; end if;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por) values (auth.uid(), 'plano_editado:' || p_codigo, p_dados, public.admin_email_atual());
end $$;

create or replace function public.admin_salvar_plano_recurso(p_plano text, p_recurso text, p_permitido boolean, p_limite integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  insert into public.plano_recursos (plano, recurso, permitido, limite_diario) values (p_plano, p_recurso, coalesce(p_permitido, false), p_limite)
    on conflict (plano, recurso) do update set permitido = excluded.permitido, limite_diario = excluded.limite_diario;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por)
    values (auth.uid(), 'recurso_editado:' || p_plano, jsonb_build_object('recurso', p_recurso, 'permitido', p_permitido, 'limite_diario', p_limite), public.admin_email_atual());
end $$;

create or replace function public.admin_uso(p_dias integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(x order by (x ->> 'total')::int desc), '[]'::jsonb) from (
    select jsonb_build_object('usuario_id', u.usuario_id, 'nome', coalesce(c.nome, c.email), 'email', c.email,
      'recurso', coalesce((select r.codigo from public.recursos_plano r where u.funcao = any (r.funcoes) order by r.codigo limit 1), 'outros'),
      'funcao', u.funcao, 'total', sum(u.contagem), 'hoje', sum(u.contagem) filter (where u.dia = current_date)) as x
    from public.uso_diario u left join public.clientes c on c.id = u.usuario_id
    where u.dia > current_date - least(greatest(coalesce(p_dias, 30), 1), 366)
    group by u.usuario_id, c.nome, c.email, u.funcao) s);
end $$;

create or replace function public.admin_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pendentes', (select count(*) from public.clientes where status = 'pendente'),
    'em_teste', (select count(*) from public.assinaturas a join public.clientes c on c.id = a.usuario_id where c.status = 'aprovado' and a.situacao = 'teste' and (a.teste_ate is null or a.teste_ate > now())),
    'ativas', (select count(*) from public.assinaturas a join public.clientes c on c.id = a.usuario_id where c.status = 'aprovado' and a.situacao = 'ativa' and (a.vence_em is null or a.vence_em + 5 >= current_date)),
    'suspensas', (select count(*) from public.assinaturas where situacao = 'suspensa'),
    'por_plano', (select coalesce(jsonb_object_agg(plano, n), '{}'::jsonb) from (select plano, count(*) n from public.assinaturas group by plano) s),
    'avisos', (select coalesce(jsonb_agg(x order by x ->> 'quando'), '[]'::jsonb) from (
      select jsonb_build_object('tipo', 'teste_vencendo', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', a.teste_ate) x
        from public.assinaturas a join public.clientes c on c.id = a.usuario_id
        where a.situacao = 'teste' and a.teste_ate between now() and now() + interval '3 days'
      union all
      select jsonb_build_object('tipo', 'teste_vencido', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', a.teste_ate)
        from public.assinaturas a join public.clientes c on c.id = a.usuario_id
        where a.situacao = 'teste' and a.teste_ate < now() and a.teste_ate > now() - interval '30 days'
      union all
      select jsonb_build_object('tipo', 'vencida', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', a.vence_em)
        from public.assinaturas a join public.clientes c on c.id = a.usuario_id where a.situacao = 'ativa' and a.vence_em < current_date
      union all
      select jsonb_build_object('tipo', 'plano_solicitado', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', a.plano_solicitado_em, 'plano', a.plano_solicitado)
        from public.assinaturas a join public.clientes c on c.id = a.usuario_id where a.plano_solicitado is not null
      union all
      select jsonb_build_object('tipo', 'pendente', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', c.criado_em)
        from public.clientes c where c.status = 'pendente' and c.criado_em < now() - interval '24 hours'
      union all
      select jsonb_build_object('tipo', 'pagamento_pendente', 'usuario_id', g.usuario_id, 'nome', coalesce(g.cliente_email, ''), 'quando', g.vencimento)
        from public.pagamentos g where g.situacao = 'pendente') s));
end $$;

-- Financeiro (preparado, sem gateway). Registrar cobrança manual; se já recebida, confirma na mesma chamada.
create or replace function public.admin_registrar_pagamento(p_usuario uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g uuid; v_plano text; v_ciclo text; v_valor integer;
begin
  if not public.admin_planos_autorizado() then raise exception 'Financeiro exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  v_plano := coalesce(p_dados ->> 'plano', (select plano from public.assinaturas where usuario_id = p_usuario));
  v_ciclo := coalesce(p_dados ->> 'ciclo', 'mensal');
  v_valor := coalesce((p_dados ->> 'valor_centavos')::integer,
    (select case v_ciclo when 'anual' then preco_anual_centavos else preco_mensal_centavos end from public.planos where codigo = v_plano));
  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor'; end if;
  insert into public.pagamentos (usuario_id, cliente_email, plano, ciclo, valor_centavos, metodo, vencimento, referencia, gateway, observacoes, criado_por)
    values (p_usuario, (select email from public.clientes where id = p_usuario), v_plano, v_ciclo, v_valor,
      coalesce(p_dados ->> 'metodo', 'pix'), coalesce((p_dados ->> 'vencimento')::date, current_date), p_dados ->> 'referencia', 'pix_manual',
      p_dados ->> 'observacoes', public.admin_email_atual())
    returning id into g;
  if coalesce((p_dados ->> 'pago')::boolean, false) then
    return public.aplicar_pagamento_confirmado(g, public.admin_email_atual());
  end if;
  return jsonb_build_object('pagamento', g);
end $$;

create or replace function public.admin_atualizar_pagamento(p_pagamento uuid, p_situacao text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Financeiro exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  if p_situacao = 'pago' then return public.aplicar_pagamento_confirmado(p_pagamento, public.admin_email_atual()); end if;
  if p_situacao not in ('cancelado', 'estornado', 'vencido') then raise exception 'Situação inválida'; end if;
  update public.pagamentos set situacao = p_situacao where id = p_pagamento and situacao in ('pendente', 'pago');
  if not found then raise exception 'Pagamento não encontrado ou já encerrado'; end if;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por)
    select usuario_id, 'pagamento_' || p_situacao, jsonb_build_object('pagamento', id), public.admin_email_atual() from public.pagamentos where id = p_pagamento;
  return jsonb_build_object('pagamento', p_pagamento, 'situacao', p_situacao);
end $$;

create or replace function public.admin_listar_pagamentos(p_usuario uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Financeiro exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object('nome', c.nome) order by g.criado_em desc), '[]'::jsonb)
    from public.pagamentos g left join public.clientes c on c.id = g.usuario_id where p_usuario is null or g.usuario_id = p_usuario);
end $$;

create or replace function public.admin_historico_assinatura(p_usuario uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('acao', acao, 'depois', depois, 'feito_por', feito_por, 'feito_em', feito_em) order by feito_em desc), '[]'::jsonb)
    from (select * from public.assinaturas_historico where usuario_id = p_usuario order by feito_em desc limit 100) h);
end $$;

revoke all on function public.admin_email_atual(), public.admin_listar_contas(), public.admin_empresas_da_conta(uuid),
  public.admin_definir_status_cliente(uuid, text), public.admin_definir_assinatura(uuid, jsonb), public.admin_salvar_plano(text, jsonb),
  public.admin_salvar_plano_recurso(text, text, boolean, integer), public.admin_uso(integer), public.admin_resumo(),
  public.admin_registrar_pagamento(uuid, jsonb), public.admin_atualizar_pagamento(uuid, text), public.admin_listar_pagamentos(uuid),
  public.admin_historico_assinatura(uuid) from public, anon;
revoke all on function public.admin_email_atual() from authenticated;
grant execute on function public.admin_listar_contas(), public.admin_empresas_da_conta(uuid),
  public.admin_definir_status_cliente(uuid, text), public.admin_definir_assinatura(uuid, jsonb), public.admin_salvar_plano(text, jsonb),
  public.admin_salvar_plano_recurso(text, text, boolean, integer), public.admin_uso(integer), public.admin_resumo(),
  public.admin_registrar_pagamento(uuid, jsonb), public.admin_atualizar_pagamento(uuid, text), public.admin_listar_pagamentos(uuid),
  public.admin_historico_assinatura(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
