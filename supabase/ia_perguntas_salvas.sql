-- LicitaPlena — Perguntas salvas da Plena (a IA do sistema; chat-ia-ui.js + netlify/functions/chat-ia.js, ações
-- "perguntas", "salvar_pergunta" e "apagar_pergunta"). Seguro rodar mais de uma vez (idempotente). Rodar no SQL Editor
-- do Supabase DEPOIS de ia_conversas.sql. Teste: testar_ia_perguntas_salvas.sql (banco local) e
-- scripts/ia_perguntas_salvas_sql.test.js (PGlite, roda no npm test).
--
-- ia_perguntas_salvas: perguntas prontas que a pessoa reutiliza em qualquer edital ("Salvar pergunta", como na Aimê).
--   Cada um lê, grava e apaga só as suas (RLS por auth.uid(), sem chave de serviço); ninguém edita (apaga e salva de
--   novo). Até 50 por pessoa (gatilho) e sem repetir o mesmo texto. CPF é recusado pelo CHECK (a rota já troca CPF
--   por ***.***.***-** antes de gravar; mesma regra de _cpf.js).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.ia_perguntas_salvas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  texto text not null check (length(texto) between 3 and 300),
  criado_em timestamptz not null default now(),
  unique (usuario_id, texto)
);
alter table public.ia_perguntas_salvas drop constraint if exists ia_perguntas_salvas_sem_cpf;
alter table public.ia_perguntas_salvas add constraint ia_perguntas_salvas_sem_cpf check (
  texto !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');

-- Teto por pessoa: sem ele, quem chama a API direto (anon key + token) encheria a tabela.
create or replace function public.ia_perguntas_salvas_limite() returns trigger language plpgsql
set search_path = public as $$
begin
  if (select count(*) from public.ia_perguntas_salvas where usuario_id = new.usuario_id) >= 50 then
    raise exception 'limite de 50 perguntas salvas' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists ia_perguntas_salvas_limite on public.ia_perguntas_salvas;
create trigger ia_perguntas_salvas_limite before insert on public.ia_perguntas_salvas
  for each row execute function public.ia_perguntas_salvas_limite();

alter table public.ia_perguntas_salvas enable row level security;
revoke all on public.ia_perguntas_salvas from anon;
revoke update on public.ia_perguntas_salvas from authenticated;
grant select, insert, delete on public.ia_perguntas_salvas to authenticated;
drop policy if exists ia_perguntas_salvas_select_proprio on public.ia_perguntas_salvas;
create policy ia_perguntas_salvas_select_proprio on public.ia_perguntas_salvas for select to authenticated using (auth.uid() = usuario_id);
drop policy if exists ia_perguntas_salvas_insert_proprio on public.ia_perguntas_salvas;
create policy ia_perguntas_salvas_insert_proprio on public.ia_perguntas_salvas for insert to authenticated with check (auth.uid() = usuario_id);
drop policy if exists ia_perguntas_salvas_delete_proprio on public.ia_perguntas_salvas;
create policy ia_perguntas_salvas_delete_proprio on public.ia_perguntas_salvas for delete to authenticated using (auth.uid() = usuario_id);
commit;
