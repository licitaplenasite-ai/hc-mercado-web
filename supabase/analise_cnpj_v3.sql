-- Análise por CNPJ, parte 3 (tela "Analisar concorrente"): marcas, motivos literais e relatório exportável.
-- Idempotente, transação única; rodar DEPOIS de historico_licitacoes.sql, analise_cnpj.sql e analise_cnpj_v2.sql.
-- Não apaga dados. Acrescenta:
--   historico_participacoes.marca_consultada_em  quando o robô (scripts/analise_cnpj.js, etapa "marcas e motivos")
--      já procurou a marca desta linha: Pesquisa de Preços do Compras.gov (por CATMAT + id da compra, a fonte não
--      filtra por fornecedor) ou, em pregão até 2023, as páginas públicas sem captcha do ComprasNet antigo
--      (FornecedorResultadoDecreto/termojulg, que trazem também o motivo literal de item cancelado/fracassado).
--      Linha consultada sem marca achada não é procurada de novo (o cache é a própria tabela historico_*).
--   analise_cnpj_detalhes(cnpj)   RPC de leitura (security invoker: vale a RLS de quem chama), só das linhas em que
--      existe algum detalhe: motivo do item (termo de adjudicação), recurso, marca declarada, fabricante e modelo.
--      A tela junta com analise_cnpj_participacoes por (id_compra, numero_item); a RPC antiga não muda de formato.
--   índice de pecas_juridicas por empresa_cnpj (se pecas_juridicas.sql já foi aplicado): a tela lê os recursos e
--      intenções de recurso da empresa com a decisão do pregoeiro (texto literal publicado no ComprasNet).
-- Dado público: qualquer cliente aprovado lê (cliente_aprovado()); só service_role (robô) escreve.
begin;
do $$ begin
 if to_regclass('public.historico_cnpj_consultas') is null or to_regclass('public.empresas_cadastro') is null then
  raise exception 'Aplique antes historico_licitacoes.sql, analise_cnpj.sql e analise_cnpj_v2.sql';
 end if;
end $$;

alter table public.historico_participacoes add column if not exists marca_consultada_em timestamptz;
create index if not exists historico_participacoes_marca_pendente_idx on public.historico_participacoes (fornecedor_ni)
  where fornecedor_ni is not null and marca_consultada_em is null;

do $$ begin
 if to_regclass('public.pecas_juridicas') is not null then
  create index if not exists pecas_juridicas_empresa_idx on public.pecas_juridicas (empresa_cnpj, data desc) where empresa_cnpj is not null;
 end if;
end $$;

create or replace function public.analise_cnpj_detalhes(p_cnpj text)
returns table (id_compra text, numero_item integer, motivo_situacao text, tem_recurso boolean,
  marca_declarada text, fabricante text, modelo text)
language sql stable security invoker set search_path = public as $$
  select p.id_compra, p.numero_item, i.motivo_situacao, i.tem_recurso, p.marca_declarada, p.fabricante, p.modelo
    from public.historico_participacoes p
    join public.historico_itens i on i.id_compra = p.id_compra and i.numero_item = p.numero_item
   where p_cnpj ~ '^\d{14}$' and p.fornecedor_ni = p_cnpj
     and (i.motivo_situacao is not null or i.tem_recurso or p.marca_declarada is not null or p.fabricante is not null or p.modelo is not null)
   order by p.id_compra, p.numero_item
$$;
revoke all on function public.analise_cnpj_detalhes(text) from public, anon;
grant execute on function public.analise_cnpj_detalhes(text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
