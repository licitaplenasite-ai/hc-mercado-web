-- Funil, fase 1 de CRM (24/11/2026): alerta de cartão parado e limite de dias por etapa. Idempotente, transação única;
-- só acrescenta (não apaga dados). Rodar no SQL Editor DEPOIS de operacao_licitacoes.sql e operacao_funil_etapas.sql.
--  * operacao_processos.etapa_desde: quando o processo entrou na etapa atual. Quem grava é o gatilho (mudou status ou
--    etapa_id = agora; senão fica o valor anterior), então a tela não consegue "zerar" o relógio sem mover o cartão.
--    Processos que já existiam recebem etapa_desde = momento em que este SQL roda (decisão 24/11: o relógio começa na
--    publicação; senão todo cartão antigo acenderia "Parado há 40 dias" no primeiro dia). O painel só conta da última
--    atualização (atualizado_em, marcado como aproximado) enquanto este SQL não foi aplicado.
--  * operacao_funil_etapas.limite_parado_dias: dias sem movimento até o alerta. null = padrão do estágio (funil-crm-ui.js,
--    LIMITE_PADRAO); 0 = sem alerta nesta etapa. Mesma RLS de escrita das etapas (pode_escrever_org_operacao).
--  * O motivo da perda usa a coluna que já existe, operacao_processos.motivo_perda (a mesma do processos.html).
--  * Os filtros salvos do Funil usam a tabela filtros_salvos (filtros_salvos.sql) com filtro.tela = 'funil': nada novo aqui.
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.operacao_processos') is null or to_regclass('public.operacao_funil_etapas') is null then
    raise exception 'Aplique antes operacao_licitacoes.sql e operacao_funil_etapas.sql';
  end if;
end $$;

alter table public.operacao_processos add column if not exists etapa_desde timestamptz;
alter table public.operacao_funil_etapas add column if not exists limite_parado_dias smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.operacao_funil_etapas'::regclass
                  and conname = 'operacao_funil_etapas_limite_parado_valido') then
    alter table public.operacao_funil_etapas add constraint operacao_funil_etapas_limite_parado_valido
      check (limite_parado_dias is null or limite_parado_dias between 0 and 365);
  end if;
end $$;

-- Roda depois de operacao_processos_etapa_coerente (ordem alfabética dos gatilhos BEFORE), que pode soltar a etapa.
create or replace function public.operacao_processos_etapa_desde()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.etapa_desde := now();
  elsif new.status is distinct from old.status or new.etapa_id is distinct from old.etapa_id then
    new.etapa_desde := now();
  else
    new.etapa_desde := old.etapa_desde;
  end if;
  return new;
end $$;
drop trigger if exists operacao_processos_etapa_desde on public.operacao_processos;
-- Preenche os antigos ANTES de criar o gatilho (dentro da transação, sem janela). Idempotente: na 2ª execução não há null.
-- Sem session_replication_role (exige superusuário, que o SQL Editor do Supabase não tem): o UPDATE só mexe em
-- etapa_desde, então os gatilhos "update of status/data_sessao/tarefas_card..." não disparam; o único BEFORE UPDATE
-- sem lista de colunas é preservar_escopo_operacao, que só confere que organização/empresa não mudaram (leve).
update public.operacao_processos set etapa_desde = now() where etapa_desde is null;
create trigger operacao_processos_etapa_desde before insert or update on public.operacao_processos
  for each row execute function public.operacao_processos_etapa_desde();
revoke all on function public.operacao_processos_etapa_desde() from public, anon, authenticated, service_role;

commit;
notify pgrst, 'reload schema';
