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
create extension if not exists pg_trgm;
create index if not exists prospeccao_itens_busca_trgm_idx on public.prospeccao_itens using gin (busca gin_trgm_ops);
create index if not exists prospeccao_itens_busca_nome_trgm_idx on public.prospeccao_itens using gin (busca_nome gin_trgm_ops);

-- Mesmos três níveis e mesma regra de netlify/functions/prospeccao.js (frase = todas as palavras; frases somam):
--   inicio  busca_nome começa pela 1a palavra e tem as demais
--   nome    casa em busca_nome, mas não no início
--   espec   casa só em busca (fora de busca_nome)
-- SQL montado com quote_literal sobre palavras validadas aqui ([a-z0-9]): o planejador vê constantes e usa o trigram.
-- Por dentro roda como dono (sem RLS), então a função repete a barreira das policies: cliente aprovado e plano com o recurso.
create or replace function public.buscar_prospeccao(p_tipo text, p_uf text, p_catmat text, p_de date, p_ate date,
  p_frases jsonb, p_nivel text, p_limite int)
returns setof public.prospeccao_itens
language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb; w text; k bigint;
  b text; n text; i text; ob text := ''; o_n text := ''; oi text := ''; cond text; filtro text := '';
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
      b := b || ' and busca ilike ' || quote_literal('%' || w || '%');
      n := n || ' and busca_nome ilike ' || quote_literal('%' || w || '%');
      i := i || ' and busca_nome ilike ' || quote_literal(case when k = 1 then '' else '%' end || w || '%');
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
  return query execute 'select * from public.prospeccao_itens where tipo = ' || quote_literal(p_tipo)
    || ' and data_ref >= ' || quote_literal(p_de) || '::date' || filtro || ' and ' || cond
    || ' order by data_ref asc, valor_total desc nulls last limit ' || p_limite;
end;
$$;
revoke all on function public.buscar_prospeccao(text, text, text, date, date, jsonb, text, int) from public, anon;
grant execute on function public.buscar_prospeccao(text, text, text, date, date, jsonb, text, int) to authenticated;

commit;
