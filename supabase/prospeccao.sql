-- ============================================================================
-- LicitaPlena — Prospecção (o que o órgão vai comprar antes do edital).
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única;
-- só cria objetos novos (não altera nem apaga dados de outras tabelas).
-- Escrita: só o robô scripts/coletar_prospeccao.js (service_role), uma vez por dia.
-- Leitura: qualquer usuário autenticado (dado público do PNCP e do Compras.gov). anon não lê.
--
-- É um cache enxuto de fonte pública: o robô apaga o que venceu (data_ref < hoje) e o que não
-- voltou na coleta completa do dia. Por isso service_role pode apagar (diferente das sanções).
-- LGPD: fornecedor só com CNPJ (check de 14 dígitos); pessoa física não é gravada.
-- ============================================================================
begin;

create table if not exists public.prospeccao_itens (
  id text primary key check (length(id) between 5 and 300),
  tipo text not null check (tipo in ('pca', 'irp', 'ata', 'contrato')),
  fonte text not null check (fonte in ('pncp', 'pgc', 'comprasgov_arp')),
  plataforma text check (plataforma is null or length(plataforma) <= 120),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  orgao_cnpj text check (orgao_cnpj is null or orgao_cnpj ~ '^[0-9]{14}$'),
  orgao_nome text check (orgao_nome is null or length(orgao_nome) <= 300),
  unidade_codigo text check (unidade_codigo is null or length(unidade_codigo) <= 30),
  unidade_nome text check (unidade_nome is null or length(unidade_nome) <= 300),
  municipio text check (municipio is null or length(municipio) <= 120),
  objeto text check (objeto is null or length(objeto) <= 1000),
  descricao text check (descricao is null or length(descricao) <= 600),
  catmat text check (catmat is null or catmat ~ '^[0-9]{1,12}$'),
  quantidade numeric,
  valor_unitario numeric,
  valor_total numeric,
  data_inicio date,
  -- A data que importa para o fornecedor: PCA = data desejada; IRP = prazo de manifestação;
  -- ata = fim da vigência; contrato = fim da vigência.
  data_ref date,
  fornecedor_cnpj text check (fornecedor_cnpj is null or fornecedor_cnpj ~ '^[0-9]{14}$'),
  fornecedor_nome text check (fornecedor_nome is null or length(fornecedor_nome) <= 300),
  saldo numeric,
  maximo_adesao numeric,
  permite_adesao boolean,
  link text not null check (link ~ '^https://(pncp\.gov\.br|dadosabertos\.compras\.gov\.br|contratos\.comprasnet\.gov\.br)/' and length(link) <= 500),
  -- Texto minúsculo e sem acento (objeto + item + órgão), montado pelo robô para o ILIKE da busca.
  busca text not null default '' check (length(busca) <= 2000),
  coletado_em timestamptz not null default now(),
  check (fornecedor_nome is null or fornecedor_cnpj is not null)
);

-- A tela filtra sempre por tipo e quase sempre por UF e janela de data.
create index if not exists prospeccao_itens_tipo_uf_data_idx on public.prospeccao_itens (tipo, uf, data_ref);
create index if not exists prospeccao_itens_catmat_idx on public.prospeccao_itens (catmat) where catmat is not null;
-- v4 (23/11/2026): UF "Todas" estourava o statement_timeout de 8 s do papel authenticated (503 na tela). Sem UF o índice
-- acima não entrega a ordem da tela (uf fica no meio), então o banco lia o tipo inteiro na janela e ordenava. Este índice
-- tem a mesma ordem do order= da função (data_ref.asc,valor_total.desc.nullslast): sem palavra o banco para nas 201 linhas.
-- Em produção, criar antes com "create index concurrently" (fora de transação) para não travar a gravação do robô.
create index if not exists prospeccao_itens_tipo_data_valor_idx on public.prospeccao_itens (tipo, data_ref, valor_total desc nulls last);
-- admin_saude_robos() (admin_painel.sql) faz max(coletado_em) na tabela toda: sem índice era varredura completa e
-- statement timeout no painel admin. Com o índice o max lê uma entrada só. Em produção, também com "concurrently".
create index if not exists prospeccao_itens_coletado_em_idx on public.prospeccao_itens (coletado_em desc);
-- v5 (23/11/2026): a limpeza do robô (data_ref < hoje, sem tipo) não tinha índice que começasse por data_ref e estourava o
-- statement timeout (57014). Em produção, criar antes com supabase/prospeccao_indice_data_ref.sql (concurrently).
create index if not exists prospeccao_itens_data_ref_idx on public.prospeccao_itens (data_ref);
-- shortcut: o ILIKE em busca faz varredura das linhas do tipo na janela de datas (medido: ~0,6 s em 900 mil linhas).
-- Índice gin_trgm_ops NÃO ajuda aqui: sob RLS o Postgres só usa no índice operador leakproof, e o ILIKE não é (o plano
-- ignora o índice). Por isso a busca com palavra passou para a função security definer buscar_prospeccao (v5, abaixo).

-- LGPD: razão social de MEI vem com o CPF do titular ("FULANA DE TAL 97048143215"). Limpeza única e idempotente
-- do que já foi gravado (só toca linha que ainda tem CPF), depois o CHECK recusa CPF daqui para frente. Mesma forma
-- da regex de netlify/functions/_cpf.js (lá \s cobre mais: o robô sempre limpa antes do CHECK).
update public.prospeccao_itens set fornecedor_nome = nullif(btrim(regexp_replace(regexp_replace(fornecedor_nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '')
 where fornecedor_nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
alter table public.prospeccao_itens drop constraint if exists prospeccao_itens_fornecedor_sem_cpf;
alter table public.prospeccao_itens add constraint prospeccao_itens_fornecedor_sem_cpf check (fornecedor_nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');

-- v2 (20/11/2026): adesões já usadas (Compras.gov 5_consultarAdesoesItem), número da ata e nome do item para a
-- busca por texto priorizar o início da descrição. add column if not exists: idempotente; o robô preenche.
alter table public.prospeccao_itens add column if not exists ata_numero text;
alter table public.prospeccao_itens add column if not exists adesoes_usadas numeric;
alter table public.prospeccao_itens add column if not exists adesoes_em timestamptz;
alter table public.prospeccao_itens add column if not exists busca_nome text not null default '';
alter table public.prospeccao_itens drop constraint if exists prospeccao_itens_v2_check;
alter table public.prospeccao_itens add constraint prospeccao_itens_v2_check check (
  (ata_numero is null or length(ata_numero) <= 40) and (adesoes_usadas is null or adesoes_usadas >= 0) and length(busca_nome) <= 200);
-- Linhas gravadas antes da v2: nome = 90 primeiros caracteres da descrição + 90 do objeto, minúsculo e sem acento, até o robô regravar.
update public.prospeccao_itens
   set busca_nome = btrim(left(translate(lower(coalesce(descricao, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), 90) || ' '
                       || left(translate(lower(coalesce(objeto, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), 90))
 where busca_nome = '' and coalesce(descricao, objeto) is not null;
-- Acento quebrado que a fonte devolve (UTF-8 lido como Windows-1252, "SAÃšDE"): o robô corrige ao gravar; as linhas
-- antigas são corrigidas na próxima coleta (upsert pela mesma chave).

alter table public.prospeccao_itens enable row level security;
revoke all on public.prospeccao_itens from anon, authenticated;
grant select on public.prospeccao_itens to authenticated;
revoke truncate on public.prospeccao_itens from service_role;
grant select, insert, update, delete on public.prospeccao_itens to service_role;

-- Leitura só para cliente aprovado (conta pendente/suspensa com JWT válido não lê). security definer porque a RLS de
-- clientes só mostra a própria linha; stable + search_path vazio. Mesmo corpo em prospeccao.sql e historico_licitacoes.sql.
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

drop policy if exists prospeccao_itens_select_autenticado on public.prospeccao_itens;
-- (select ...) vira InitPlan: a função roda uma vez por consulta, não uma vez por linha lida (era o maior custo do 503
-- com UF "Todas": centenas de milhares de chamadas security definer por busca).
create policy prospeccao_itens_select_autenticado on public.prospeccao_itens
  for select to authenticated using ((select public.cliente_aprovado()));
-- Sem policy de escrita: só service_role (bypassrls) grava.

-- v3 (22/11/2026): resumo da cobertura da coleta (quando cada UF e tipo fechou a última coleta completa), gravado pelo
-- robô em dados_robo (chaves prospeccao_cobertura_<grupo>). A tela e o Status das Ferramentas leem para explicar o vazio
-- ("ainda não temos o plano de compras desse estado"). Só essas chaves; o progresso do robô (prospeccao_estado_*) não.
drop policy if exists dados_robo_select_prospeccao_cobertura on public.dados_robo;
create policy dados_robo_select_prospeccao_cobertura on public.dados_robo for select to authenticated
  using ((select public.cliente_aprovado()) and chave like 'prospeccao\_cobertura\_%');
grant select on public.dados_robo to authenticated;

-- v5 (23/11/2026): busca por palavra com UF "Todas" seguia estourando os 8 s mesmo com o índice v4: sob RLS o ILIKE
-- (não leakproof) não entra em índice, e o banco lia o tipo inteiro na janela. A busca com palavra passa por esta função
-- security definer (sem RLS por dentro, então o trigram vale) e /api/prospeccao a chama via /rpc. A leitura direta da
-- tabela pelo PostgREST continua igual, com as policies de sempre. Em produção, criar os dois índices antes, cada um
-- sozinho com "create index concurrently" (fora de transação), para não travar a gravação do robô.
-- v7 (23/11/2026): os índices trigram/prefixo da v5/v6 em prospeccao_itens saíram deste arquivo (a busca agora usa
-- prospeccao_busca, abaixo). Em produção eles são apagados por prospeccao_busca_producao.sql, passo 5, depois da carga.

-- v7 (23/11/2026): o nível "inicio" com 8 frases e UF "Todas" levava 6–18 s em produção (statement_timeout de 8 s, tela
-- "Não foi possível consultar"). Causa: cada linha candidata custava uma leitura aleatória do heap de 1,2 GB, que não cabe
-- no cache (shared_buffers 224 MB); o índice cobrindo da v6 não salvava porque o robô regrava toda linha por dia
-- (coletado_em) e o visibility map nunca fica "all-visible" (index-only vira heap fetch).
-- Saída: cópia estreita só com o que a busca filtra/ordena, mantida por trigger (nada muda no robô). As linhas dela só mudam
-- quando muda um campo da busca, então o VM fica "all-visible" e a busca é index-only: anda no índice já na ordem da tela
-- (data_ref, valor_total) e para nas 201; no pior caso lê a janela inteira do índice em sequência, nunca linha a linha.
-- Medido em 1,3 M linhas sintéticas, frio (supabase/prospeccao_busca_producao.sql tem a tabela de tempos).
--   nome   = lower(busca_nome) (o "inicio" é 'palavra%' no começo dele)
--   texto  = palavras distintas de busca (só [a-z0-9], 2+ letras). Mesmo resultado do '%palavra%' em busca: a palavra da
--            busca é [a-z0-9]+, então só pode casar dentro de uma palavra do texto. Sem repetição o texto fica ~30% menor.
create table if not exists public.prospeccao_busca (
  id text primary key,
  tipo text not null,
  uf text,
  catmat text,
  data_ref date,
  valor_total numeric,
  nome text not null default '',
  texto text not null default ''
);
-- autovacuum cedo (1% de linhas mudadas) para o VM voltar a "all-visible" logo depois da coleta do dia.
alter table public.prospeccao_busca set (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_insert_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.02);
alter table public.prospeccao_busca enable row level security;
-- Só a função buscar_prospeccao (security definer) lê; ninguém grava direto (só o trigger, como dono). A policy existe pela
-- regra do diretório, mas sem grant nenhum papel do PostgREST chega à tabela.
revoke all on public.prospeccao_busca from public, anon, authenticated, service_role;
drop policy if exists prospeccao_busca_select_aprovado on public.prospeccao_busca;
create policy prospeccao_busca_select_aprovado on public.prospeccao_busca for select to authenticated using ((select public.cliente_aprovado()));
-- Mesma ordem do order by da busca, com tudo que o filtro lê incluído (index-only). Um com UF na frente para a busca por UF.
-- Numa tabela vazia o create é instantâneo; em produção a carga vem depois (prospeccao_busca_producao.sql).
create index if not exists prospeccao_busca_tipo_data_idx on public.prospeccao_busca (tipo, data_ref, valor_total desc nulls last) include (uf, catmat, id, nome, texto);
create index if not exists prospeccao_busca_tipo_uf_data_idx on public.prospeccao_busca (tipo, uf, data_ref, valor_total desc nulls last) include (catmat, id, nome, texto);

create or replace function public.prospeccao_palavras(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(string_agg(w, ' ' order by w), '')
    from (select distinct w from regexp_split_to_table(lower(coalesce(t, '')), '[^a-z0-9]+') w where length(w) >= 2) s
$$;

-- Trigger por comando (transition tables): um insert/delete em lote na cópia por lote do robô (500 linhas), não um por linha.
-- No upsert diário só entram as linhas em que um campo da busca mudou; coletado_em sozinho não toca a cópia.
create or replace function public.prospeccao_busca_sincronizar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.prospeccao_busca b using velhas o where b.id = o.id;
  elsif tg_op = 'UPDATE' then
    delete from public.prospeccao_busca b using velhas o where b.id = o.id and not exists (select 1 from novas n where n.id = o.id);
    insert into public.prospeccao_busca (id, tipo, uf, catmat, data_ref, valor_total, nome, texto)
    select n.id, n.tipo, n.uf, n.catmat, n.data_ref, n.valor_total, lower(n.busca_nome), public.prospeccao_palavras(n.busca)
      from novas n left join velhas o on o.id = n.id
     where o.id is null or (o.tipo, o.uf, o.catmat, o.data_ref, o.valor_total, o.busca_nome, o.busca)
                           is distinct from (n.tipo, n.uf, n.catmat, n.data_ref, n.valor_total, n.busca_nome, n.busca)
    on conflict (id) do update set tipo = excluded.tipo, uf = excluded.uf, catmat = excluded.catmat, data_ref = excluded.data_ref,
      valor_total = excluded.valor_total, nome = excluded.nome, texto = excluded.texto;
  else
    insert into public.prospeccao_busca (id, tipo, uf, catmat, data_ref, valor_total, nome, texto)
    select n.id, n.tipo, n.uf, n.catmat, n.data_ref, n.valor_total, lower(n.busca_nome), public.prospeccao_palavras(n.busca) from novas n
    on conflict (id) do update set tipo = excluded.tipo, uf = excluded.uf, catmat = excluded.catmat, data_ref = excluded.data_ref,
      valor_total = excluded.valor_total, nome = excluded.nome, texto = excluded.texto;
  end if;
  return null;
end;
$$;
revoke all on function public.prospeccao_busca_sincronizar() from public, anon, authenticated, service_role;
drop trigger if exists prospeccao_busca_ins on public.prospeccao_itens;
drop trigger if exists prospeccao_busca_upd on public.prospeccao_itens;
drop trigger if exists prospeccao_busca_del on public.prospeccao_itens;
create trigger prospeccao_busca_ins after insert on public.prospeccao_itens referencing new table as novas
  for each statement execute function public.prospeccao_busca_sincronizar();
create trigger prospeccao_busca_upd after update on public.prospeccao_itens referencing old table as velhas new table as novas
  for each statement execute function public.prospeccao_busca_sincronizar();
create trigger prospeccao_busca_del after delete on public.prospeccao_itens referencing old table as velhas
  for each statement execute function public.prospeccao_busca_sincronizar();

-- Carga inicial em lotes (produção: prospeccao_busca_producao.sql). Copia o que ainda não está na cópia; "do nothing"
-- porque a linha que o trigger já gravou é mais nova. Lote 0 linhas = acabou: apaga sobra (linha que o robô apagou durante
-- a carga) e, se os dois índices da busca existem e estão válidos, marca a cópia como pronta (dados_robo
-- prospeccao_busca_pronta). Até lá a busca usa prospeccao_itens. Em produção a carga roda sem os índices (inserir num
-- índice de 600 MB fora de ordem é 5x mais lento) e eles vêm depois com "create index concurrently".
create or replace function public.prospeccao_busca_carregar(p_lote int default 100000) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.prospeccao_busca (id, tipo, uf, catmat, data_ref, valor_total, nome, texto)
  select p.id, p.tipo, p.uf, p.catmat, p.data_ref, p.valor_total, lower(p.busca_nome), public.prospeccao_palavras(p.busca)
    from public.prospeccao_itens p
   where not exists (select 1 from public.prospeccao_busca b where b.id = p.id)
   limit greatest(1, least(p_lote, 500000))
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    delete from public.prospeccao_busca b where not exists (select 1 from public.prospeccao_itens p where p.id = b.id);
    if (select count(*) from pg_catalog.pg_index x where x.indisvalid and x.indexrelid in
         (pg_catalog.to_regclass('public.prospeccao_busca_tipo_data_idx'), pg_catalog.to_regclass('public.prospeccao_busca_tipo_uf_data_idx'))) = 2 then
      insert into public.dados_robo (chave, dado) values ('prospeccao_busca_pronta', jsonb_build_object('em', now()))
        on conflict (chave) do update set dado = excluded.dado, atualizado_em = now();
    end if;
  end if;
  return n;
end;
$$;
revoke all on function public.prospeccao_busca_carregar(int) from public, anon, authenticated, service_role;
-- Banco novo (tabela vazia, como o ambiente de teste): nada a copiar, a cópia já nasce pronta.
insert into public.dados_robo (chave, dado)
select 'prospeccao_busca_pronta', jsonb_build_object('em', now())
 where not exists (select 1 from public.prospeccao_itens) on conflict (chave) do nothing;

-- Mesmos três níveis e mesma regra de netlify/functions/prospeccao.js (frase = todas as palavras; frases somam):
--   inicio  busca_nome começa pela 1a palavra e tem as demais
--   nome    casa em busca_nome, mas não no início
--   espec   casa só em busca (fora de busca_nome)
-- SQL montado com quote_literal sobre palavras validadas aqui ([a-z0-9], sem curinga do LIKE): o planejador vê constantes.
-- Por dentro roda como dono (sem RLS), então a função repete a barreira das policies: cliente aprovado e plano com o recurso.
-- v7: filtra e ordena na cópia estreita prospeccao_busca (index-only, ver acima) e só lê de prospeccao_itens as <= 201
-- linhas devolvidas, pelo id. Enquanto a carga inicial não termina (sem prospeccao_busca_pronta), usa prospeccao_itens.
create or replace function public.buscar_prospeccao(p_tipo text, p_uf text, p_catmat text, p_de date, p_ate date,
  p_frases jsonb, p_nivel text, p_limite int)
returns setof public.prospeccao_itens
language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb; w text; k bigint;
  b text; n text; i text; ob text := ''; o_n text := ''; oi text := ''; cond text; filtro text := '';
  pronta boolean := exists (select 1 from public.dados_robo where chave = 'prospeccao_busca_pronta');
  tabela text := case when pronta then 'public.prospeccao_busca' else 'public.prospeccao_itens' end;
  c_nome text := case when pronta then 'nome' else 'busca_nome' end;
  c_texto text := case when pronta then 'texto' else 'busca' end;
begin
  if not (public.cliente_aprovado() and public.eu_posso('prospeccao')) then return; end if;
  if p_tipo is null or p_tipo not in ('pca', 'irp', 'ata', 'contrato') or p_nivel is null or p_nivel not in ('inicio', 'nome', 'espec')
     or p_de is null or p_limite is null or p_limite not between 1 and 201
     or (p_uf is not null and p_uf !~ '^[A-Z]{2}$') or (p_catmat is not null and p_catmat !~ '^[0-9]{1,12}$')
     or jsonb_typeof(p_frases) is distinct from 'array' or jsonb_array_length(p_frases) not between 1 and 8 then
    raise exception 'buscar_prospeccao: parâmetros inválidos' using errcode = '22023';
  end if;
  for f in select value from jsonb_array_elements(p_frases) loop
    if jsonb_typeof(f) <> 'array' or jsonb_array_length(f) not between 1 and 5 then
      raise exception 'buscar_prospeccao: frase inválida' using errcode = '22023';
    end if;
    b := ''; n := ''; i := '';
    for w, k in select value, ordinality from jsonb_array_elements_text(f) with ordinality loop
      if w !~ '^[a-z0-9]+$' or length(w) not between 2 and 300 then raise exception 'buscar_prospeccao: palavra inválida' using errcode = '22023'; end if;
      -- LIKE e não ILIKE: nome/texto (e busca/busca_nome, gravados pelo robô) já são minúsculos; LIKE é mais barato.
      b := b || ' and ' || c_texto || ' like ' || quote_literal('%' || w || '%');
      n := n || ' and ' || c_nome || ' like ' || quote_literal('%' || w || '%');
      i := i || ' and ' || c_nome || ' like ' || quote_literal(case when k = 1 then w || '%' else '%' || w || '%' end);
    end loop;
    ob := ob || ' or (' || substr(b, 6) || ')';
    o_n := o_n || ' or (' || substr(n, 6) || ')';
    oi := oi || ' or (' || substr(i, 6) || ')';
  end loop;
  ob := '(' || substr(ob, 5) || ')'; o_n := '(' || substr(o_n, 5) || ')'; oi := '(' || substr(oi, 5) || ')';
  cond := case p_nivel when 'inicio' then oi when 'nome' then o_n || ' and not ' || oi else ob || ' and not ' || o_n end;
  if p_uf is not null then filtro := filtro || ' and uf = ' || quote_literal(p_uf); end if;
  if p_catmat is not null then filtro := filtro || ' and catmat = ' || quote_literal(p_catmat); end if;
  if p_ate is not null then filtro := filtro || ' and data_ref <= ' || quote_literal(p_ate) || '::date'; end if;
  return query execute 'select p.* from public.prospeccao_itens p join (select id, data_ref, valor_total from ' || tabela
    || ' where tipo = ' || quote_literal(p_tipo) || ' and data_ref >= ' || quote_literal(p_de) || '::date' || filtro || ' and ' || cond
    || ' order by data_ref asc, valor_total desc nulls last limit ' || p_limite || ') s on s.id = p.id'
    || ' order by s.data_ref asc, s.valor_total desc nulls last';
end;
$$;
revoke all on function public.buscar_prospeccao(text, text, text, date, date, jsonb, text, int) from public, anon;
grant execute on function public.buscar_prospeccao(text, text, text, date, date, jsonb, text, int) to authenticated;

commit;
