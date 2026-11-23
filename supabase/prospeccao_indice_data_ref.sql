-- Índices da prospecção em produção, sem travar a gravação do robô (23/11/2026).
-- A limpeza dos vencidos (DELETE data_ref < hoje) estourava o statement timeout (57014) sem índice em data_ref.
--
-- COMO RODAR no SQL editor do Supabase: UM comando por vez (selecione só a linha e clique em Run).
-- "concurrently" não roda dentro de transação, e o editor junta vários comandos numa transação só.
-- Idempotente: se o índice já existe, o comando não faz nada.
-- Se der timeout ou erro no meio, apague o índice inválido e rode de novo:
--   drop index concurrently if exists public.prospeccao_itens_data_ref_idx;

create index concurrently if not exists prospeccao_itens_data_ref_idx on public.prospeccao_itens (data_ref);

-- Os dois de 23/11 (v4 de prospeccao.sql). Se já rodou, não faz nada:
create index concurrently if not exists prospeccao_itens_tipo_data_valor_idx on public.prospeccao_itens (tipo, data_ref, valor_total desc nulls last);
create index concurrently if not exists prospeccao_itens_coletado_em_idx on public.prospeccao_itens (coletado_em desc);
