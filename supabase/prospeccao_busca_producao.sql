-- Prospecção v7 em produção: liga a cópia estreita prospeccao_busca sem parar a tela nem o robô (23/11/2026).
-- Por quê: busca com 8 frases e UF "Todas" levava 6–18 s (timeout de 8 s, tela "Não foi possível consultar"). Ver v7 em
-- supabase/prospeccao.sql. Medido em 1,3 M linhas sintéticas (heap 1,2 GB, total 2,3 GB), shared_buffers 128 MB, cache do
-- sistema zerado antes de cada medida (frio), 8 frases (expediente, limpeza, materia+hospitalar, evento, fogo, show,
-- materia+permanente, movei), soma dos três níveis:
--   aba       UF      v6 frio (blocos lidos)    v7 frio (blocos lidos)   v7 quente
--   pca       Todas    1,9 s  ( 8.600)          0,32 s (1.900)          0,02 s
--   pca       AM       1,1 s  ( 6.200)          0,49 s (1.900)          0,02 s
--   irp       Todas    1,6 s  (10.300)          0,27 s (1.700)          0,02 s
--   irp       AM       0,5 s  ( 1.200)          0,20 s   (880)          0,01 s
--   ata       Todas   13,4 s  (56.300)          0,34 s (2.000)          0,03 s
--   ata       AM       1,0 s  ( 5.200)          0,59 s (1.900)          0,07 s
--   contrato  Todas    4,6 s  (25.100)          0,47 s (1.900)          0,06 s
--   contrato  AM       0,7 s  ( 3.700)          0,43 s (1.300)          0,05 s
-- Pior caso da v7 (8 frases que não casam nada: lê a janela inteira do índice, em sequência): pca Todas 1,8 s (24 mil
-- blocos), ata Todas 1,3 s, contrato 0,5 s, com UF < 0,1 s. Produção tem disco e CPU mais lentos (Micro: ~11 mil IOPS
-- em rajada): estimativa até ~1 s nos casos comuns e 2–3 s no pior caso de UF Todas sem nenhum resultado.
-- Espaço: a cópia ocupa ~2,1 GB em 1,3 M linhas (heap 630 MB + 2 índices de 700 MB + chave 90 MB); o passo 6 devolve
-- ~0,9 GB (índices antigos). Confira o disco livre antes (Settings > Usage).
--
-- COMO RODAR no SQL editor do Supabase, FORA do horário do robô de prospecção (workflow prospeccao.yml):
-- cada passo é UM comando, selecionado sozinho e com Run (concurrently/vacuum não rodam dentro de transação, e o editor
-- junta vários comandos numa transação só). Todos são idempotentes: pode repetir qualquer passo.
--
-- Passo 1. Rode o arquivo supabase/prospeccao.sql inteiro (como sempre). Cria a tabela vazia, o trigger e a função v7.
--          A busca continua lendo prospeccao_itens (não há a marca "pronta") até o passo 5. ~10 s.
--
-- Passo 2. Tire os dois índices grandes da cópia vazia (carregar sem eles é ~5x mais rápido; voltam no passo 4).
drop index if exists public.prospeccao_busca_tipo_data_idx;
drop index if exists public.prospeccao_busca_tipo_uf_data_idx;
--
-- Passo 3. Carga em lotes. Rode e repita até devolver 0 (cerca de 7 vezes para 1,3 M linhas; o robô pode gravar junto,
--          o trigger cuida das linhas novas). Cada vez 20–90 s aqui (prod Micro: estimar 1–5 min; total ~10–20 min). Se der timeout, rode de novo com lote menor (50000).
select public.prospeccao_busca_carregar(200000);
--
-- Passo 4. Índices da busca (um por vez; ~10 s cada aqui, estimar 1–3 min em prod) e vacuum (marca as páginas "all-visible": é o que deixa a busca só no índice).
create index concurrently if not exists prospeccao_busca_tipo_data_idx on public.prospeccao_busca (tipo, data_ref, valor_total desc nulls last) include (uf, catmat, id, nome, texto);
create index concurrently if not exists prospeccao_busca_tipo_uf_data_idx on public.prospeccao_busca (tipo, uf, data_ref, valor_total desc nulls last) include (catmat, id, nome, texto);
vacuum (analyze) public.prospeccao_busca;
--          Se um create index falhar no meio, ele fica inválido: apague e repita o comando.
--            drop index concurrently if exists public.prospeccao_busca_tipo_data_idx;
--
-- Passo 5. Liga a busca nova: rode a carga mais uma vez (devolve 0, confere os índices e grava a marca). Confira:
select public.prospeccao_busca_carregar(200000);
select dado from public.dados_robo where chave = 'prospeccao_busca_pronta';  -- tem que voltar uma linha
--          Teste na tela: Prospecção > PCA > UF Todas > as 8 frases. Deve abrir em menos de 2 s.
--
-- Passo 6 (no dia seguinte, com a tela conferida). Apaga os índices da v5/v6 em prospeccao_itens, que a busca não usa mais
--          (~1 GB de disco e gravação do robô mais leve). Um por vez:
drop index concurrently if exists public.prospeccao_itens_busca_trgm_idx;
drop index concurrently if exists public.prospeccao_itens_busca_nome_trgm_idx;
drop index concurrently if exists public.prospeccao_itens_busca_nome_cobre_idx;
drop index concurrently if exists public.prospeccao_itens_busca_nome_prefixo_idx;
--
-- Voltar atrás (antes do passo 6): apagar a marca faz a busca ler prospeccao_itens de novo, como na v6.
--   delete from public.dados_robo where chave = 'prospeccao_busca_pronta';
-- Depois do passo 6 a volta fica lenta (sem os índices antigos); recriar com "create index concurrently" da v6.
