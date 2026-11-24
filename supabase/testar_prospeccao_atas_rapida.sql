-- Teste de prospeccao_atas_rapida.sql (índices trigram só das atas em prospeccao_busca). Dados fictícios e rollback.
-- Prova que o índice só muda o PLANO, nunca o resultado: para cada busca (8 frases, palavra rara, palavra de 2 letras,
-- nada casa; UF Todas e AM; níveis inicio/nome/espec) compara buscar_prospeccao com o plano antigo (sem bitmap = índice
-- btree/varredura, como antes) e com o plano novo forçado (bitmap no GIN): mesmos itens, mesma ordem.
-- Empate exato de (data_ref, valor_total) não tem ordem definida em nenhum dos dois planos (nem antes): no corte das 201
-- linhas, o grupo empatado da última posição é comparado pela contagem, não pelos ids.
-- Rodar no banco local (ambiente-teste) DEPOIS de prospeccao.sql e prospeccao_atas_rapida.sql (ou sem este: o teste cria
-- os índices dentro da transação, que volta no rollback).
begin;
create extension if not exists pg_trgm;
-- Mesmo comando do prospeccao.sql (if not exists: no banco local já existem).
create index if not exists prospeccao_busca_ata_texto_trgm_idx on public.prospeccao_busca using gin (texto gin_trgm_ops) where tipo = 'ata';
create index if not exists prospeccao_busca_ata_nome_trgm_idx on public.prospeccao_busca using gin (nome gin_trgm_ops) where tipo = 'ata';

-- 20 mil atas determinísticas (md5), vocabulário com frequência desigual (palavras comuns e raras), 10% sem valor.
create temp table qa_vocab on commit drop as
select array['material','limpeza','papel','a4','toner','hospitalar','expediente','evento','show','fogo','permanente','moveis',
  'cadeira','mesa','luva','seringa','cafe','acucar','gasolina','pneu','cimento','tinta','lampada','cabo','servico','registro',
  'preco','aquisicao','secretaria','saude','educacao','obra','reforma','locacao','som','palco','tv','kit','zqraro1','zqraro2'] v;
insert into public.prospeccao_itens (id, tipo, fonte, uf, data_ref, valor_total, link, busca, busca_nome)
select 'ata:QAR-' || g, 'ata', 'pncp', (array['AM','SP','RJ','MG'])[1 + g % 4], current_date + 31 + (g % 300),
       case when g % 10 = 0 then null else (g * 7919 % 100000) / 100.0 end,
       'https://pncp.gov.br/app/atas/qar/' || g,
       (select string_agg(v[1 + floor(power(array_length(v, 1), ('x' || substr(md5(g || ':' || j), 1, 8))::bit(32)::bigint / 4294967296.0))::int], ' ')
          from qa_vocab, generate_series(1, 25) j),
       (select string_agg(v[1 + floor(power(array_length(v, 1), ('x' || substr(md5(g || '#' || j), 1, 8))::bit(32)::bigint / 4294967296.0))::int], ' ')
          from qa_vocab, generate_series(1, 6) j)
  from generate_series(1, 20000) g;
analyze public.prospeccao_busca;
-- A busca só lê a cópia prospeccao_busca com a marca de pronta (banco novo já nasce com ela; aqui garante).
insert into public.dados_robo (chave, dado) values ('prospeccao_busca_pronta', '{}'::jsonb) on conflict (chave) do nothing;

insert into auth.users(id,email) values ('c9100000-0000-4000-8000-000000000001','pro-atas@qa.invalid') on conflict do nothing;
insert into public.clientes(id,nome,email,status) values ('c9100000-0000-4000-8000-000000000001','QA atas','pro-atas@qa.invalid','aprovado')
  on conflict (id) do update set status = 'aprovado';
select set_config('request.jwt.claim.sub','c9100000-0000-4000-8000-000000000001',true);

create function public.qa_plano(q text) returns text language plpgsql as $f$
declare l text; r text := ''; begin for l in execute 'explain ' || q loop r := r || l || ' '; end loop; return r; end $f$;
-- O plano novo usa mesmo o GIN (senão o teste compararia o plano antigo com ele mesmo).
do $$ declare p text; begin
  set local enable_indexscan = off; set local enable_indexonlyscan = off; set local enable_seqscan = off;
  p := public.qa_plano('select id from public.prospeccao_busca where tipo = ''ata'' and data_ref >= current_date + 30'
    || ' and texto like ''%zqraro1%'' order by data_ref, valor_total desc nulls last limit 201');
  if p !~ 'prospeccao_busca_ata_texto_trgm_idx' then raise exception 'plano novo não usou o GIN do texto: %', p; end if;
  p := public.qa_plano('select id from public.prospeccao_busca where tipo = ''ata'' and data_ref >= current_date + 30'
    || ' and nome like ''zqraro1%'' order by data_ref, valor_total desc nulls last limit 201');
  if p !~ 'prospeccao_busca_ata_nome_trgm_idx' then raise exception 'plano novo não usou o GIN do nome: %', p; end if;
  reset enable_indexscan; reset enable_indexonlyscan; reset enable_seqscan;
end $$;

do $$
declare
  fr jsonb; nv text; uf text; lim int; antes text[]; depois text[]; ultimo text; total int := 0; comparadas int := 0;
begin
  if not (public.cliente_aprovado() and public.eu_posso('prospeccao')) then
    raise exception 'cliente de teste sem acesso à prospecção (o teste não provaria nada)';
  end if;
  for fr in select value from jsonb_array_elements('[
      [["expediente"],["limpeza"],["materia","hospitalar"],["evento"],["fogo"],["show"],["materia","permanente"],["movei"]],
      [["zqraro1"]], [["zqraro2","a4"]], [["pape","a4"]], [["a4"]], [["tv"]], [["kit","som"]],
      [["qqxyzw"],["kkwwpp","a4"]], [["zqraro1"],["zqraro2"],["cimento","tinta"],["tv"]]]'::jsonb) loop
    foreach uf in array array[null, 'AM'] loop
      foreach nv in array array['inicio', 'nome', 'espec'] loop
        foreach lim in array array[201, 7] loop
          -- Plano antigo: sem bitmap (o GIN só entra por bitmap).
          perform set_config('enable_bitmapscan', 'off', true);
          select array_agg(coalesce(b.data_ref::text, '-') || '|' || coalesce(b.valor_total::text, '-') || '|' || b.id order by b.ordinality) into antes
            from public.buscar_prospeccao('ata', uf, null, current_date + 30, null, fr, nv, lim) with ordinality b
           where b.id like 'ata:QAR-%';
          -- Plano novo forçado: só bitmap (GIN).
          perform set_config('enable_bitmapscan', 'on', true);
          perform set_config('enable_indexscan', 'off', true); perform set_config('enable_indexonlyscan', 'off', true);
          perform set_config('enable_seqscan', 'off', true);
          select array_agg(coalesce(b.data_ref::text, '-') || '|' || coalesce(b.valor_total::text, '-') || '|' || b.id order by b.ordinality) into depois
            from public.buscar_prospeccao('ata', uf, null, current_date + 30, null, fr, nv, lim) with ordinality b
           where b.id like 'ata:QAR-%';
          perform set_config('enable_indexscan', 'on', true); perform set_config('enable_indexonlyscan', 'on', true);
          perform set_config('enable_seqscan', 'on', true);
          antes := coalesce(antes, '{}'); depois := coalesce(depois, '{}');
          if cardinality(antes) <> cardinality(depois) then
            raise exception 'quantidade diferente (% x %): % % % lim %', cardinality(antes), cardinality(depois), fr, uf, nv, lim;
          end if;
          -- Mesma sequência de chaves de ordenação (data_ref, valor_total).
          if (select array_agg(split_part(x, '|', 1) || '|' || split_part(x, '|', 2) order by o) from unnest(antes) with ordinality u(x, o))
             is distinct from (select array_agg(split_part(x, '|', 1) || '|' || split_part(x, '|', 2) order by o) from unnest(depois) with ordinality u(x, o)) then
            raise exception 'ordem diferente: % % % lim %', fr, uf, nv, lim;
          end if;
          -- Mesmos itens; no corte, o grupo empatado da última chave só pela contagem (já igual acima).
          ultimo := case when cardinality(antes) = lim then split_part(antes[lim], '|', 1) || '|' || split_part(antes[lim], '|', 2) end;
          if (select array_agg(x order by x) from unnest(antes) x where ultimo is null or not x like ultimo || '|%')
             is distinct from (select array_agg(x order by x) from unnest(depois) x where ultimo is null or not x like ultimo || '|%') then
            raise exception 'itens diferentes: % % % lim %', fr, uf, nv, lim;
          end if;
          total := total + cardinality(antes); comparadas := comparadas + 1;
        end loop;
      end loop;
    end loop;
  end loop;
  -- Sem linhas o teste não provaria nada.
  if total < 1000 then raise exception 'poucas linhas comparadas (%): dados de teste não casaram', total; end if;
  raise notice 'prospeccao_atas_rapida: % buscas, % linhas, mesmo resultado com e sem o índice trigram', comparadas, total;
end $$;
rollback;
