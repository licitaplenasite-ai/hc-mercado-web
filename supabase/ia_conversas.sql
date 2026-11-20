-- LicitaPlena — Histórico do chat com IA (botão "IA · BETA", netlify/functions/chat-ia.js). Seguro rodar mais de uma vez
-- (idempotente). Rodar no SQL Editor do Supabase DEPOIS de seguranca_aprovacao_20261119.sql e planos_e_recursos.sql.
-- Teste: testar_ia_conversas.sql.
--
-- ia_conversas: uma linha por pergunta/resposta, só quando o usuário liga "Salvar histórico" no chat (padrão: desligado).
--   A rota grava com o TOKEN DO USUÁRIO (sem chave de serviço): a policy de insert exige dono = auth.uid() e, se houver
--   empresa, que ele tenha acesso a ela. Cada um lê e apaga só o seu; ninguém edita. CPF é recusado pelo CHECK (a rota
--   já troca CPF por ***.***.***-** antes de gravar; mesma regra de _cpf.js).
-- Também inclui a função "chat-ia" no recurso "ia" do plano (mesma cota diária por plano das outras ferramentas de IA).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
  if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null then
    raise exception 'Aplique antes seguranca_aprovacao_20261119.sql';
  end if;
end $$;

create table if not exists public.ia_conversas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversa_id uuid not null,
  empresa_id uuid references public.operacao_empresas(id) on delete set null,
  pergunta text not null check (length(pergunta) between 1 and 1000),
  resposta text not null check (length(resposta) between 1 and 4000),
  fontes jsonb not null default '[]'::jsonb check (jsonb_typeof(fontes) = 'array' and octet_length(fontes::text) <= 6000),
  criado_em timestamptz not null default now()
);
alter table public.ia_conversas drop constraint if exists ia_conversas_sem_cpf;
alter table public.ia_conversas add constraint ia_conversas_sem_cpf check (
  pergunta !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y' and resposta !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
create index if not exists ia_conversas_usuario_data_idx on public.ia_conversas (usuario_id, criado_em desc);
create index if not exists ia_conversas_empresa_idx on public.ia_conversas (empresa_id) where empresa_id is not null;

alter table public.ia_conversas enable row level security;
revoke all on public.ia_conversas from anon;
revoke update on public.ia_conversas from authenticated;
grant select, insert, delete on public.ia_conversas to authenticated;
drop policy if exists ia_conversas_select_proprio on public.ia_conversas;
create policy ia_conversas_select_proprio on public.ia_conversas for select to authenticated using (auth.uid() = usuario_id);
drop policy if exists ia_conversas_insert_proprio on public.ia_conversas;
create policy ia_conversas_insert_proprio on public.ia_conversas for insert to authenticated with check (
  auth.uid() = usuario_id and (empresa_id is null or exists (
    select 1 from public.operacao_empresas e where e.id = empresa_id and public.pode_acessar_empresa_operacao(e.organizacao_id, e.id))));
drop policy if exists ia_conversas_delete_proprio on public.ia_conversas;
create policy ia_conversas_delete_proprio on public.ia_conversas for delete to authenticated using (auth.uid() = usuario_id);

-- Cota pelo plano: "chat-ia" entra no recurso "ia" (sem a tabela de planos, a rota usa o contador antigo).
do $$ begin
  if to_regclass('public.recursos_plano') is not null then
    update public.recursos_plano set funcoes = array_append(funcoes, 'chat-ia') where codigo = 'ia' and not ('chat-ia' = any (funcoes));
  end if;
end $$;
commit;
