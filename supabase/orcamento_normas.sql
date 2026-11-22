-- ============================================================================
-- LicitaPlena — vigia de normas do Orçamentista (fase 2): novidades para revisar.
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente. Roda depois de planos_e_recursos.sql
-- (usa admin_planos_autorizado(): dono com login de 2 fatores).
--
-- O robô semanal scripts/vigia_normas_obra.js procura, em fonte oficial (TCU dados abertos, páginas do SINAPI na
-- CAIXA, instruções normativas e decretos no gov.br/compras), o que mexe em orçamento de obra e grava aqui como
-- "para_revisar", com o link. Ele NÃO muda regra do Auditor: a regra só muda quando o dono (ou um agente com ordem
-- dele) aprova aqui e alguém altera orcamento-obra-regras.js com nova versão e "vale desde".
--   Escrita do robô: service_role (insert sem sobrescrever: o link é único).
--   Leitura e decisão: só o dono (admin_planos_autorizado()), pela tela normas-obra.html.
-- ============================================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.orcamento_normas_novidades (
  id bigint generated always as identity primary key,
  fonte text not null check (fonte in ('TCU', 'CAIXA-SINAPI', 'SEGES-IN', 'SEGES-DECRETO')),
  titulo text not null check (length(titulo) between 1 and 500),
  link text not null unique check (link ~ '^https://' and length(link) <= 600),
  publicado_em date,
  -- Palavras que fizeram o robô separar (BDI, sobrepreço, inexequibilidade, encargos...).
  termos text[] not null default '{}' check (cardinality(termos) <= 20),
  resumo text check (resumo is null or length(resumo) <= 4000),
  situacao text not null default 'para_revisar' check (situacao in ('para_revisar', 'aprovada', 'descartada')),
  -- Chave da regra que muda (orcamento-obra-regras.js) ou "nova"; obrigatória para aprovar.
  regra text check (regra is null or regra ~ '^[a-z0-9_]{2,60}$'),
  nota text check (nota is null or length(nota) <= 2000),
  revisado_por uuid references auth.users (id) on delete set null,
  revisado_em timestamptz,
  criado_em timestamptz not null default now(),
  check ((situacao = 'para_revisar') = (revisado_em is null)),
  check (situacao <> 'aprovada' or regra is not null)
);
create index if not exists orcamento_normas_novidades_situacao on public.orcamento_normas_novidades (situacao, criado_em desc);

alter table public.orcamento_normas_novidades enable row level security;
revoke all on public.orcamento_normas_novidades from anon, authenticated;
grant select on public.orcamento_normas_novidades to authenticated;
revoke truncate on public.orcamento_normas_novidades from service_role;
grant select, insert, update, delete on public.orcamento_normas_novidades to service_role;
drop policy if exists orcamento_normas_novidades_select_dono on public.orcamento_normas_novidades;
create policy orcamento_normas_novidades_select_dono on public.orcamento_normas_novidades
  for select to authenticated using (public.admin_planos_autorizado());

-- Decisão do dono: aprovar (com a regra que muda) ou descartar, com nota. Só uma vez: decidida não volta.
create or replace function public.revisar_novidade_norma(p_id bigint, p_decisao text, p_regra text, p_nota text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Só o dono, com login de 2 fatores, revisa novidades.' using errcode = '42501'; end if;
  if p_decisao not in ('aprovada', 'descartada') then raise exception 'Decisão inválida.' using errcode = '22023'; end if;
  if p_decisao = 'aprovada' and coalesce(p_regra, '') = '' then raise exception 'Para aprovar, diga qual regra muda (ou "nova").' using errcode = '22023'; end if;
  update orcamento_normas_novidades
     set situacao = p_decisao, regra = nullif(lower(trim(p_regra)), ''), nota = nullif(trim(left(p_nota, 2000)), ''),
         revisado_por = auth.uid(), revisado_em = now()
   where id = p_id and situacao = 'para_revisar';
  if not found then raise exception 'Novidade não encontrada ou já revisada.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.revisar_novidade_norma(bigint, text, text, text) from public, anon;
grant execute on function public.revisar_novidade_norma(bigint, text, text, text) to authenticated;

commit;
