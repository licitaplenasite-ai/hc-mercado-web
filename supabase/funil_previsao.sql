-- CRM, fase 2 (24/11/2026): chance de ganhar por etapa do Funil, usada na "Previsão de faturamento" do Dashboard
-- (crm-relatorios-ui.js). Idempotente e só acrescenta (não apaga dados). Rodar no SQL Editor do Supabase DEPOIS de
-- operacao_funil_etapas.sql (e de funil_crm.sql, se já aplicado; não depende dele).
--  * operacao_funil_etapas.probabilidade: chance em % (0 a 100) de a licitação nesta etapa virar contrato.
--    null = padrão do estágio (CHANCE_PADRAO em crm-relatorios-ui.js). Igual à "probability" de etapa do HubSpot,
--    só que em inteiro de 0 a 100 (a tela mostra %, sem conversão).
--  * Escrita: a mesma RLS das etapas (pode_escrever_org_operacao). O gatilho operacao_funil_etapas_proteger só barra
--    id/organização/chave/criado_em, então a coluna nova pode ser editada também nas etapas do sistema.
--  * O motivo da perda continua em operacao_processos.motivo_perda (funil_crm.sql / funil-crm-ui.js): nada novo aqui.
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.operacao_funil_etapas') is null then
    raise exception 'Aplique antes operacao_funil_etapas.sql';
  end if;
end $$;

alter table public.operacao_funil_etapas add column if not exists probabilidade smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.operacao_funil_etapas'::regclass
                  and conname = 'operacao_funil_etapas_probabilidade_valida') then
    alter table public.operacao_funil_etapas add constraint operacao_funil_etapas_probabilidade_valida
      check (probabilidade is null or probabilidade between 0 and 100);
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
