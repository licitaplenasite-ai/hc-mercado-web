-- Ficha completa do órgão (24/11/2026): índice do plano de compras (PCA/IRP) por CNPJ do órgão, ANTES de rodar de novo
-- supabase/crm_orgao_linha_tempo.sql. Idempotente: qualquer passo pode ser repetido. Não muda dado nenhum.
--
-- POR QUÊ: a ficha passou a mostrar "o que o órgão pretende comprar" (prospeccao_itens, tipo pca/irp). Sem índice por
--   orgao_cnpj cada ficha leria a tabela inteira (~900 mil linhas). Criar o índice dentro da transação do
--   crm_orgao_linha_tempo.sql travaria a gravação do robô da Prospecção e passaria do corte de 60 s do editor; por isso
--   vai pelo pg_cron, com "concurrently" (o editor junta comandos numa transação, e concurrently não roda em transação).
--   Espaço estimado: ~35 bytes por linha com CNPJ = ~30 MB. Tempo: 1 a 3 min.
--
-- COMO RODAR no SQL Editor do Supabase, fora do horário do robô de prospecção (prospeccao.yml). UM comando por vez.
--
-- Passo 1. Agenda a criação (roda no próximo minuto e repete a cada minuto; depois de pronto, "if not exists" não faz nada).
select cron.schedule('ficha_orgao_indice_pca', '* * * * *',
  'create index concurrently if not exists prospeccao_itens_orgao_idx on public.prospeccao_itens (orgao_cnpj, tipo) where orgao_cnpj is not null');
--
-- Passo 2. Acompanhar até aparecer status succeeded (e ver o progresso).
select jobid, status, return_message, start_time, end_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'ficha_orgao_indice_pca') order by start_time desc limit 3;
select phase, blocks_done, blocks_total, tuples_done, tuples_total from pg_stat_progress_create_index;
--
-- Passo 3. Pronto: tira da agenda e confere que o índice ficou válido (indisvalid = true).
select cron.unschedule('ficha_orgao_indice_pca');
select c.relname, x.indisvalid, pg_size_pretty(pg_relation_size(c.oid)) from pg_index x join pg_class c on c.oid = x.indexrelid
 where c.relname = 'prospeccao_itens_orgao_idx';
--          indisvalid = false (falhou no meio: timeout, disco, robô gravando): apague e volte ao passo 1.
--            drop index concurrently if exists public.prospeccao_itens_orgao_idx;
--          return_message com "statement timeout": o papel postgres tem statement_timeout; me avise antes de mexer nele.
--
-- Passo 4. Rode supabase/crm_orgao_linha_tempo.sql inteiro (ele confere que este índice existe).
-- Voltar atrás: drop index concurrently if exists public.prospeccao_itens_orgao_idx;
