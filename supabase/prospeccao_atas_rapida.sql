-- Prospecção v8 em produção: busca de ATA abaixo de 2 s (24/11/2026). Idempotente: qualquer passo pode ser repetido.
-- Não muda tabela, função nem resultado: só cria dois índices trigram em prospeccao_busca, restritos às atas.
--
-- DIAGNÓSTICO
--   A busca com palavra roda três níveis (inicio, nome, espec), cada um um select em prospeccao_busca ordenado por
--   (data_ref, valor_total) com limite de 201. Nas outras abas a janela tem teto (hoje até hoje+dias); na ata não:
--   "vigente daqui a 30 dias em diante" pega quase todas as atas, o tipo com mais linhas. Quando a palavra é comum, o
--   índice ordenado acha as 201 logo e para. Quando é rara (ou uma das frases não casa nada), não há atalho: cada nível
--   lê a parte das atas do índice de ponta a ponta (ou a tabela toda, em paralelo), e cada linha passa por até 8 LIKE
--   '%palavra%'. Três níveis x (índice/tabela de ~1 GB que não cabe no cache) = os 2,7–4 s medidos.
--   Por que só a ata: PCA (1,6 s) tem janela de no máximo 365 dias, contrato e IRP têm menos linhas.
--
-- SAÍDA
--   GIN trigram parcial (where tipo = 'ata') em texto e em nome. O planejador escolhe por busca: palavra rara/que não casa
--   -> lê só as listas do GIN e as poucas linhas candidatas; palavra comum -> segue no índice ordenado e para nas 201,
--   como hoje. Vale porque buscar_prospeccao é security definer (sem RLS por dentro; sob RLS o LIKE não usaria índice).
--   O SQL da busca é o mesmo; só muda o plano. testar_prospeccao_atas_rapida.sql prova mesmo resultado nos dois planos.
--
-- MEDIDO (banco local, 1,25 M linhas sintéticas: 700 mil atas; blocos de 8 kB lidos por nível, soma dos três níveis)
--   busca (ata, UF Todas)                 antes                   depois
--   nada casa (3 frases)                  270 mil blocos, 1,2 s   ~170 blocos, < 0,01 s
--   1 palavra rara                        270 mil blocos, 0,7 s   ~500 blocos, < 0,01 s
--   1 palavra média (~2 mil atas)         270 mil blocos, 1,0 s   ~5,7 mil blocos, 0,02 s
--   8 frases comuns (expediente, ...)     ~5,7 mil blocos         ~5,7 mil blocos (mesmo plano, índice ordenado)
--   UF AM, nada casa                      200 mil blocos, 1,0 s   ~170 blocos
--   Produção lê do disco boa parte desses blocos (índice de ~1 GB, cache de 224 MB): 270 mil blocos = ~2 GB, que é o
--   pior caso de hoje. Depois, o pior caso medido foi ~50 mil blocos (palavra de 2 letras no início, ex. "a4" sozinha).
--   Espaço: ~0,47 kB por ata (texto) + ~0,26 kB por ata (nome). 700 mil atas = 330 MB + 180 MB. Ver passo 0.
--   Tempo de criação local: 2 min 40 s (texto) e 1 min 10 s (nome); no Micro estimar 3 a 4 vezes isso.
--
-- COMO RODAR no SQL Editor do Supabase, FORA do horário do robô de prospecção (workflow prospeccao.yml).
-- Cada passo é UM comando, selecionado sozinho e com Run (o editor junta vários comandos numa transação só, e
-- "create index concurrently" não roda dentro de transação). O create index leva minutos e o editor corta em 60 s:
-- por isso ele vai pelo pg_cron (Database > Extensions > pg_cron ligado), que roda o comando sozinho, sem esse limite.
--
-- Passo 0. Conferir antes: quantas atas, disco livre (Settings > Usage) e onde está o pg_trgm.
select count(*) as atas, pg_size_pretty(count(*) * 750) as espaco_estimado from public.prospeccao_busca where tipo = 'ata';
select extname, extnamespace::regnamespace as esquema from pg_extension where extname in ('pg_trgm', 'pg_cron');
--          Sem pg_trgm na lista: create extension if not exists pg_trgm;  Sem pg_cron: ligar em Database > Extensions.
--
-- Passo 0b (opcional, para comparar depois). Medida ANTES: rode os três EXPLAIN do fim deste arquivo e anote
--          "Execution Time" e "Buffers: shared hit/read" da primeira linha de cada um.
--
-- Passo 1. Agenda o índice do texto no pg_cron (roda no próximo minuto). Monta o nome do operador com o esquema certo
--          do pg_trgm, porque o pg_cron não usa o search_path do editor.
select cron.schedule('prospeccao_ata_trgm_texto', '* * * * *', format(
  'create index concurrently if not exists prospeccao_busca_ata_texto_trgm_idx on public.prospeccao_busca using gin (texto %I.gin_trgm_ops) where tipo = %L',
  (select extnamespace::regnamespace::text from pg_extension where extname = 'pg_trgm'), 'ata'));
--
-- Passo 2. Acompanhar (repita até aparecer status succeeded; o job repete a cada minuto, mas com "if not exists" as
--          repetições depois de pronto não fazem nada). Ver também o progresso: pg_stat_progress_create_index.
select jobid, status, return_message, start_time, end_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'prospeccao_ata_trgm_texto') order by start_time desc limit 3;
select phase, blocks_done, blocks_total, tuples_done, tuples_total from pg_stat_progress_create_index;
--
-- Passo 3. Pronto (succeeded): tira o job da agenda e confere que o índice ficou válido (indisvalid = true).
select cron.unschedule('prospeccao_ata_trgm_texto');
select c.relname, x.indisvalid, pg_size_pretty(pg_relation_size(c.oid)) from pg_index x join pg_class c on c.oid = x.indexrelid
 where c.relname in ('prospeccao_busca_ata_texto_trgm_idx', 'prospeccao_busca_ata_nome_trgm_idx');
--          indisvalid = false (falhou no meio: timeout, disco, robô gravando): apague e volte ao passo 1.
--            drop index concurrently if exists public.prospeccao_busca_ata_texto_trgm_idx;
--          return_message com "statement timeout": o papel postgres tem statement_timeout; me avise antes de mexer nele.
--
-- Passo 4. Mesmo caminho para o índice do nome (só depois do passo 3: um por vez).
select cron.schedule('prospeccao_ata_trgm_nome', '* * * * *', format(
  'create index concurrently if not exists prospeccao_busca_ata_nome_trgm_idx on public.prospeccao_busca using gin (nome %I.gin_trgm_ops) where tipo = %L',
  (select extnamespace::regnamespace::text from pg_extension where extname = 'pg_trgm'), 'ata'));
select jobid, status, return_message, start_time, end_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'prospeccao_ata_trgm_nome') order by start_time desc limit 3;
--          succeeded: tira da agenda e confere (mesma consulta do passo 3: os dois com indisvalid = true).
select cron.unschedule('prospeccao_ata_trgm_nome');
--
-- Passo 5. Estatística nova da tabela (segundos) e medida DEPOIS: rode os três EXPLAIN abaixo de novo. Esperado: o nível
--          espec e o nome caem para milissegundos com palavra rara; com as 8 frases comuns, o mesmo plano de antes.
--          Na tela: Prospecção > Ata > UF Todas > as mesmas palavras do teste lento. Deve abrir em menos de 2 s.
analyze public.prospeccao_busca;
--
-- (cron.unschedule de um job que já saiu dá erro "could not find valid entry": pode ignorar.)
-- Voltar atrás (a busca volta a ser como antes, mesmo resultado):
--   drop index concurrently if exists public.prospeccao_busca_ata_texto_trgm_idx;
--   drop index concurrently if exists public.prospeccao_busca_ata_nome_trgm_idx;
--
-- MEDIÇÃO: o mesmo SQL que buscar_prospeccao monta para "Ata, UF Todas" com as 8 frases (expediente, limpeza,
-- material hospitalar, evento, fogo, show, material permanente, móveis), um por nível. Para medir outra busca, troque as
-- palavras (minúsculas, sem acento, já no radical: "moveis" -> "movei", "material" -> "materia").
-- Nível inicio:
explain (analyze, buffers) select id, data_ref, valor_total from public.prospeccao_busca where tipo = 'ata' and data_ref >= current_date + 30 and ((nome like 'expediente%') or (nome like 'limpeza%') or (nome like 'materia%' and nome like '%hospitalar%') or (nome like 'evento%') or (nome like 'fogo%') or (nome like 'show%') or (nome like 'materia%' and nome like '%permanente%') or (nome like 'movei%')) order by data_ref asc, valor_total desc nulls last limit 201;
-- Nível nome:
explain (analyze, buffers) select id, data_ref, valor_total from public.prospeccao_busca where tipo = 'ata' and data_ref >= current_date + 30 and ((nome like '%expediente%') or (nome like '%limpeza%') or (nome like '%materia%' and nome like '%hospitalar%') or (nome like '%evento%') or (nome like '%fogo%') or (nome like '%show%') or (nome like '%materia%' and nome like '%permanente%') or (nome like '%movei%')) and not ((nome like 'expediente%') or (nome like 'limpeza%') or (nome like 'materia%' and nome like '%hospitalar%') or (nome like 'evento%') or (nome like 'fogo%') or (nome like 'show%') or (nome like 'materia%' and nome like '%permanente%') or (nome like 'movei%')) order by data_ref asc, valor_total desc nulls last limit 201;
-- Nível espec (o mais caro antes):
explain (analyze, buffers) select id, data_ref, valor_total from public.prospeccao_busca where tipo = 'ata' and data_ref >= current_date + 30 and ((texto like '%expediente%') or (texto like '%limpeza%') or (texto like '%materia%' and texto like '%hospitalar%') or (texto like '%evento%') or (texto like '%fogo%') or (texto like '%show%') or (texto like '%materia%' and texto like '%permanente%') or (texto like '%movei%')) and not ((nome like '%expediente%') or (nome like '%limpeza%') or (nome like '%materia%' and nome like '%hospitalar%') or (nome like '%evento%') or (nome like '%fogo%') or (nome like '%show%') or (nome like '%materia%' and nome like '%permanente%') or (nome like '%movei%')) order by data_ref asc, valor_total desc nulls last limit 201;
-- Pior caso (nada casa; antes lia tudo nos três níveis). Depois deve aparecer "Bitmap Index Scan on prospeccao_busca_ata_texto_trgm_idx":
explain (analyze, buffers) select id, data_ref, valor_total from public.prospeccao_busca where tipo = 'ata' and data_ref >= current_date + 30 and ((texto like '%qqxyzw%') or (texto like '%kkwwpp%' and texto like '%a4%')) and not ((nome like '%qqxyzw%') or (nome like '%kkwwpp%' and nome like '%a4%')) order by data_ref asc, valor_total desc nulls last limit 201;
