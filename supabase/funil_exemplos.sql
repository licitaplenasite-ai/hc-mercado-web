-- LicitaPlena: dados de exemplo do primeiro acesso (botão "Ver o sistema com exemplos" no Funil do painel.html).
-- Idempotente: seguro rodar mais de uma vez no SQL Editor. Rodar DEPOIS de planos_e_recursos.sql (que também cria a
-- coluna e tira os exemplos da contagem do limite de processos) e de funil_v3.sql. Teste: testar_funil_exemplos.sql.
--
-- Critério único para todo mundo filtrar (boletim, e-mails, avisos, previsão, relatórios): operacao_processos.exemplo = true.
-- Prazos, tarefas e esteira do exemplo pendem do processo (processo_id, on delete cascade): apagar o processo apaga tudo.
-- Reforço sem depender da coluna: todo exemplo tem objeto começando com "[Exemplo] " (o gatilho abaixo garante).
begin;

alter table public.operacao_processos add column if not exists exemplo boolean not null default false;
create index if not exists operacao_processos_exemplo_idx on public.operacao_processos (organizacao_id) where exemplo;

-- A marca nasce no INSERT e não muda depois: um exemplo não vira processo real (furaria o limite do plano) e um processo
-- real não vira exemplo (o botão "Apagar exemplos" apagaria dado do cliente). Teto de 8 exemplos por organização.
create or replace function public.guardar_exemplo_processo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.exemplo is distinct from old.exemplo then
    raise exception 'A marca de exemplo não pode ser trocada. Apague os exemplos e cadastre o processo de verdade.'
      using errcode = 'P0001';
  end if;
  if not new.exemplo then return new; end if;
  if tg_op = 'INSERT' then
    perform 1 from public.operacao_organizacoes where id = new.organizacao_id for update;
    if (select count(*) from public.operacao_processos where organizacao_id = new.organizacao_id and exemplo) >= 8 then
      raise exception 'Esta conta já tem os exemplos. Use "Apagar exemplos" antes de criar de novo.' using errcode = 'P0001';
    end if;
  end if;
  if left(new.objeto, 10) <> '[Exemplo] ' then new.objeto := '[Exemplo] ' || new.objeto; end if;
  return new;
end $$;
revoke all on function public.guardar_exemplo_processo() from public, anon, authenticated;
drop trigger if exists operacao_processos_exemplo_guarda on public.operacao_processos;
create trigger operacao_processos_exemplo_guarda before insert or update of exemplo, objeto on public.operacao_processos
  for each row execute function public.guardar_exemplo_processo();

commit;
