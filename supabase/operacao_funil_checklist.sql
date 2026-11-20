-- Funil: checklist padrão por etapa, marcações por processo e favoritas (modelo Siga Pregão, item 15 da análise).
-- Idempotente; rodar no SQL Editor depois de operacao_licitacoes.sql, seguranca_operacao.sql e operacao_funil_etapas.sql.
-- Só acrescenta colunas: nenhuma tabela nova. A RLS que já existe vale para elas:
--  * operacao_funil_etapas.tarefas: escrita só por pode_escrever_org_operacao (mesma regra de renomear etapa);
--  * operacao_processos.checklist_funil / favorito: escrita por pode_escrever_empresa_operacao, leitura por pode_acessar_empresa_operacao.
-- Não tocam atualizado_em (controle de concorrência do kit e do checklist do edital) nem disparam a esteira (gatilho só em "update of status").
begin;
do $$ begin
 if to_regclass('public.operacao_funil_etapas') is null or to_regclass('public.operacao_processos') is null then
  raise exception 'Aplique antes operacao_licitacoes.sql e operacao_funil_etapas.sql';
 end if;
end $$;

-- Nulo = a empresa não mexeu: o painel usa as tarefas padrão do estágio. Lista de {id, titulo, link?, esteira?}, até 30.
alter table public.operacao_funil_etapas add column if not exists tarefas jsonb;
alter table public.operacao_funil_etapas drop constraint if exists operacao_funil_etapas_tarefas_validas;
alter table public.operacao_funil_etapas add constraint operacao_funil_etapas_tarefas_validas
  check (tarefas is null or (jsonb_typeof(tarefas) = 'array' and jsonb_array_length(tarefas) <= 30 and pg_column_size(tarefas) <= 16384));

-- Tarefa marcada: {id_da_tarefa: data em que marcou}.
alter table public.operacao_processos add column if not exists checklist_funil jsonb not null default '{}'::jsonb;
alter table public.operacao_processos drop constraint if exists operacao_processos_checklist_funil_valido;
alter table public.operacao_processos add constraint operacao_processos_checklist_funil_valido
  check (jsonb_typeof(checklist_funil) = 'object' and pg_column_size(checklist_funil) <= 16384);
alter table public.operacao_processos add column if not exists favorito boolean not null default false;

notify pgrst, 'reload schema';
commit;
