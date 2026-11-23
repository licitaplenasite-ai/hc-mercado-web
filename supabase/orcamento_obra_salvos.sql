-- Orçamentos de obra salvos na nuvem, por empresa (CNPJ licitante): "Meus orçamentos" em orcamento-obra.html (fase F1,
-- _historico/orcamentista/PLANO-NOVA-TELA-ORCAMENTO-20261123.md). Antes ficava só no localStorage: um orçamento por
-- computador, e podia se perder. O documento é o JSON v2 de orcamento-obra-documento.js (aba lida, leitura, CPU,
-- preços digitados, cotações e campos); as contas são refeitas no navegador ao abrir.
-- O preço da proposta é segredo comercial: só quem tem acesso à empresa lê (pode_acessar_empresa_operacao) e só
-- gestor/operador da empresa grava (pode_escrever_empresa_operacao). Sem anon.
-- Idempotente; rodar no SQL Editor depois de operacao_licitacoes.sql, seguranca_operacao.sql e seguranca_aprovacao_20261119.sql.
-- Teste: supabase/testar_orcamento_obra_salvos.sql.
begin;
do $$ begin
 if to_regclass('public.operacao_empresas') is null
    or to_regprocedure('public.pode_escrever_empresa_operacao(uuid,uuid)') is null
    or to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null then
  raise exception 'Aplique antes operacao_licitacoes.sql, seguranca_operacao.sql e seguranca_aprovacao_20261119.sql';
 end if;
end $$;

create table if not exists public.orcamento_obra_salvos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  empresa_id uuid not null references public.operacao_empresas(id) on delete cascade,
  titulo text not null check (titulo = btrim(titulo) and length(titulo) between 1 and 200),
  -- 6 MB de texto: o Santo Antônio (346 itens + CPU de 216 composições) dá ~0,4 MB. Mesmo limite de orcamento-obra-documento.js.
  documento jsonb not null check (jsonb_typeof(documento) = 'object' and octet_length(documento::text) <= 6291456),
  -- Só para a lista (não baixa o documento inteiro de cada orçamento); a conta de verdade é refeita ao abrir.
  valor_global numeric(14,2) check (valor_global is null or valor_global >= 0),
  -- Controle de versão: o gatilho soma 1 a cada mudança; o navegador grava com "where versao = a que eu abri".
  -- Outra aba ou computador gravou antes: 0 linhas, e a tela pede para recarregar (não sobrescreve calada).
  versao integer not null default 1,
  criado_por uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null default auth.uid(),
  atualizado_em timestamptz not null default now()
);
create index if not exists orcamento_obra_salvos_empresa_idx on public.orcamento_obra_salvos (empresa_id, atualizado_em desc);
create index if not exists orcamento_obra_salvos_org_idx on public.orcamento_obra_salvos (organizacao_id);

-- Limite por empresa, dono imutável, versão e quem mexeu por último. Definer: conta linhas que a RLS esconderia.
create or replace function public.orcamento_obra_salvos_proteger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_total int;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.organizacao_id is distinct from old.organizacao_id
       or new.empresa_id is distinct from old.empresa_id or new.criado_em is distinct from old.criado_em
       or new.criado_por is distinct from old.criado_por then
      raise exception 'Orçamento, empresa e organização não mudam' using errcode = 'P0001';
    end if;
    new.versao := old.versao + 1;
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
    return new;
  end if;
  if not exists (select 1 from public.operacao_empresas e where e.id = new.empresa_id and e.organizacao_id = new.organizacao_id) then
    raise exception 'Empresa fora da organização' using errcode = '23503';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('orcamento_obra_salvos:' || new.empresa_id::text));
  select count(*) into v_total from public.orcamento_obra_salvos where empresa_id = new.empresa_id;
  if v_total >= 200 then
    raise exception 'Limite de 200 orçamentos por empresa atingido' using errcode = 'P0001';
  end if;
  new.versao := 1;
  new.criado_em := now();
  new.atualizado_em := now();
  new.criado_por := auth.uid();
  new.atualizado_por := auth.uid();
  return new;
end $$;
revoke all on function public.orcamento_obra_salvos_proteger() from public, anon, authenticated, service_role;

drop trigger if exists orcamento_obra_salvos_proteger on public.orcamento_obra_salvos;
create trigger orcamento_obra_salvos_proteger before insert or update on public.orcamento_obra_salvos
  for each row execute function public.orcamento_obra_salvos_proteger();

alter table public.orcamento_obra_salvos enable row level security;
revoke all on public.orcamento_obra_salvos from public, anon, authenticated;
grant select, insert, update, delete on public.orcamento_obra_salvos to authenticated;
grant all on public.orcamento_obra_salvos to service_role;
drop policy if exists orcamento_obra_salvos_leitura on public.orcamento_obra_salvos;
drop policy if exists orcamento_obra_salvos_escrita on public.orcamento_obra_salvos;
create policy orcamento_obra_salvos_leitura on public.orcamento_obra_salvos for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
create policy orcamento_obra_salvos_escrita on public.orcamento_obra_salvos for all to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));

commit;
notify pgrst, 'reload schema';
