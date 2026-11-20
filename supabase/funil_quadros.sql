-- Quadros: kanbans livres por empresa (CNPJ), com colunas próprias e cartões que podem apontar para um processo do funil.
-- Referência: "Negócios > Quadros" do Siga Pregão (_historico/siga-pregao-canal-analise-20261119.md); aqui o quadro não
-- substitui o Funil (operacao_funil_etapas): serve para tarefas e rotinas que não cabem nas etapas da licitação.
-- Idempotente; rodar no SQL Editor depois de operacao_licitacoes.sql, seguranca_operacao.sql e seguranca_aprovacao_20261119.sql.
-- Teste: supabase/testar_funil_quadros.sql.
-- Leitura: pode_acessar_empresa_operacao; escrita: pode_escrever_empresa_operacao (as duas já exigem cliente_aprovado()).
begin;
do $$ begin
 if to_regclass('public.operacao_empresas') is null or to_regclass('public.operacao_processos') is null
    or to_regprocedure('public.pode_escrever_empresa_operacao(uuid,uuid)') is null then
  raise exception 'Aplique antes operacao_licitacoes.sql e seguranca_operacao.sql';
 end if;
end $$;

create table if not exists public.operacao_quadros (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  empresa_id uuid not null references public.operacao_empresas(id) on delete cascade,
  nome text not null check (nome = btrim(nome) and length(nome) between 1 and 60),
  criado_por uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (id, organizacao_id, empresa_id)
);
create index if not exists operacao_quadros_empresa_idx on public.operacao_quadros (empresa_id, criado_em);

create table if not exists public.operacao_quadros_colunas (
  id uuid primary key default gen_random_uuid(),
  quadro_id uuid not null,
  organizacao_id uuid not null,
  empresa_id uuid not null,
  nome text not null check (nome = btrim(nome) and length(nome) between 1 and 40),
  -- Fracionária: mover = 1 update com a média dos vizinhos, sem renumerar a lista.
  ordem double precision not null default 0,
  cor text not null default '#64748b' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  criado_em timestamptz not null default now(),
  unique (id, quadro_id, organizacao_id, empresa_id),
  foreign key (quadro_id, organizacao_id, empresa_id) references public.operacao_quadros(id, organizacao_id, empresa_id) on delete cascade
);
create index if not exists operacao_quadros_colunas_quadro_idx on public.operacao_quadros_colunas (quadro_id, ordem);

create table if not exists public.operacao_quadros_cartoes (
  id uuid primary key default gen_random_uuid(),
  quadro_id uuid not null,
  coluna_id uuid not null,
  organizacao_id uuid not null,
  empresa_id uuid not null,
  titulo text not null check (titulo = btrim(titulo) and length(titulo) between 1 and 200),
  descricao text check (descricao is null or length(descricao) <= 4000),
  processo_id uuid references public.operacao_processos(id) on delete set null,
  prazo date,
  ordem double precision not null default 0,
  criado_por uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Coluna com cartão não sai (NO ACTION: apagar o quadro inteiro ainda leva tudo pela cascata abaixo, no mesmo comando).
  foreign key (coluna_id, quadro_id, organizacao_id, empresa_id) references public.operacao_quadros_colunas(id, quadro_id, organizacao_id, empresa_id),
  foreign key (quadro_id, organizacao_id, empresa_id) references public.operacao_quadros(id, organizacao_id, empresa_id) on delete cascade
);
create index if not exists operacao_quadros_cartoes_coluna_idx on public.operacao_quadros_cartoes (coluna_id, ordem);
create index if not exists operacao_quadros_cartoes_quadro_idx on public.operacao_quadros_cartoes (quadro_id);
create index if not exists operacao_quadros_cartoes_processo_idx on public.operacao_quadros_cartoes (processo_id) where processo_id is not null;

-- Limites, dono imutável e coerência empresa/organização/processo. Definer: conta linhas que a RLS esconderia.
create or replace function public.operacao_quadros_proteger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limite int; v_total int; v_chave text;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.organizacao_id is distinct from old.organizacao_id
       or new.empresa_id is distinct from old.empresa_id or new.criado_em is distinct from old.criado_em
       or (tg_table_name <> 'operacao_quadros' and to_jsonb(new) ->> 'quadro_id' is distinct from to_jsonb(old) ->> 'quadro_id') then
      raise exception 'Quadro, empresa e organização não mudam' using errcode = 'P0001';
    end if;
  else
    if not exists (select 1 from public.operacao_empresas e where e.id = new.empresa_id and e.organizacao_id = new.organizacao_id) then
      raise exception 'Empresa fora da organização' using errcode = '23503';
    end if;
    if tg_table_name = 'operacao_quadros' then
      v_chave := 'operacao_quadros:' || new.empresa_id::text; v_limite := 30;
    else
      v_chave := tg_table_name || ':' || (to_jsonb(new) ->> 'quadro_id'); v_limite := case tg_table_name when 'operacao_quadros_colunas' then 20 else 500 end;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_chave));
    if tg_table_name = 'operacao_quadros' then
      select count(*) into v_total from public.operacao_quadros where empresa_id = new.empresa_id;
    elsif tg_table_name = 'operacao_quadros_colunas' then
      select count(*) into v_total from public.operacao_quadros_colunas where quadro_id = (to_jsonb(new) ->> 'quadro_id')::uuid;
    else
      select count(*) into v_total from public.operacao_quadros_cartoes where quadro_id = (to_jsonb(new) ->> 'quadro_id')::uuid;
    end if;
    if v_total >= v_limite then
      raise exception 'Limite de % atingido', v_limite using errcode = 'P0001';
    end if;
  end if;
  if tg_table_name = 'operacao_quadros_cartoes' then
    if new.processo_id is not null and not exists (select 1 from public.operacao_processos p
        where p.id = new.processo_id and p.empresa_id = new.empresa_id and p.organizacao_id = new.organizacao_id) then
      raise exception 'Processo de outra empresa' using errcode = '23503';
    end if;
    if tg_op = 'UPDATE' then new.atualizado_em := now(); end if;
  end if;
  return new;
end $$;
revoke all on function public.operacao_quadros_proteger() from public, anon, authenticated, service_role;

drop trigger if exists operacao_quadros_proteger on public.operacao_quadros;
create trigger operacao_quadros_proteger before insert or update on public.operacao_quadros
  for each row execute function public.operacao_quadros_proteger();
drop trigger if exists operacao_quadros_colunas_proteger on public.operacao_quadros_colunas;
create trigger operacao_quadros_colunas_proteger before insert or update on public.operacao_quadros_colunas
  for each row execute function public.operacao_quadros_proteger();
drop trigger if exists operacao_quadros_cartoes_proteger on public.operacao_quadros_cartoes;
create trigger operacao_quadros_cartoes_proteger before insert or update on public.operacao_quadros_cartoes
  for each row execute function public.operacao_quadros_proteger();

do $$
declare t text;
begin
  foreach t in array array['operacao_quadros', 'operacao_quadros_colunas', 'operacao_quadros_cartoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
    execute format('drop policy if exists %I on public.%I', t || '_escrita', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))', t || '_leitura', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id)) with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))', t || '_escrita', t);
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';
