-- Escolha dos itens em que a empresa vai participar (edital com centenas de itens; a empresa entra em poucos).
-- participar: true = entra na proposta e na planilha do portal; false = item guardado, fora da proposta.
--   Itens que já existem ficam true (nada muda no que já estava na proposta). Item NOVO importado do PNCP
--   começa false: a pessoa marca "Vou participar" na lista. Item cadastrado à mão segue true (padrão da coluna).
-- tipo_beneficio: tipoBeneficio do PNCP por item (1 exclusivo ME/EPP, 2 subcontratação ME/EPP,
--   3 cota reservada ME/EPP, 4 sem benefício, 5 não se aplica). Vem da observação PNCP; null = sem informação.
-- Nenhuma das duas colunas toca atualizado_em (o revisaoHash do kit usa atualizado_em) nem o select fixo do kit.
-- Idempotente, transação única, não apaga dados. Rodar depois de importacao_item_pncp.sql (01-aplicar.sql).
begin;
set local lock_timeout = '5s';
alter table public.operacao_itens_resultado
  add column if not exists participar boolean not null default true,
  add column if not exists tipo_beneficio smallint
    check (tipo_beneficio is null or tipo_beneficio between 1 and 99);

-- Item novo do edital: começa fora da proposta. Só na criação da origem (reimportar não mexe na escolha).
create or replace function public.operacao_origem_pncp_participar_inicial()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  update public.operacao_itens_resultado set participar = false where id = new.item_id;
  return null;
end $$;

-- tipoBeneficio da observação mais nova vale (é dado do edital). Valor fora do formato é ignorado.
create or replace function public.preencher_beneficio_pncp(p_item uuid, p_snapshot jsonb)
returns void language plpgsql set search_path = pg_catalog, pg_temp as $$
declare t text := p_snapshot->'raw'->>'tipoBeneficio';
begin
  if t is null or t !~ '^[1-9][0-9]?$' then return; end if;
  update public.operacao_itens_resultado set tipo_beneficio = t::smallint
   where id = p_item and tipo_beneficio is distinct from t::smallint;
end $$;

create or replace function public.operacao_observacao_pncp_beneficio()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  perform public.preencher_beneficio_pncp(new.item_id, new.snapshot);
  return null;
end $$;

revoke all on function public.operacao_origem_pncp_participar_inicial(), public.preencher_beneficio_pncp(uuid, jsonb),
  public.operacao_observacao_pncp_beneficio() from public, anon, authenticated;

drop trigger if exists operacao_origem_pncp_participar_inicial on public.operacao_origens_pncp;
create trigger operacao_origem_pncp_participar_inicial after insert on public.operacao_origens_pncp
  for each row execute function public.operacao_origem_pncp_participar_inicial();
drop trigger if exists operacao_observacao_pncp_beneficio on public.operacao_observacoes_pncp;
create trigger operacao_observacao_pncp_beneficio after insert on public.operacao_observacoes_pncp
  for each row execute function public.operacao_observacao_pncp_beneficio();

-- Itens já importados: a observação mais recente com valor válido vence (a mais antiga roda primeiro).
do $$ declare o record; begin
  for o in select item_id, snapshot from public.operacao_observacoes_pncp order by observado_em asc loop
    perform public.preencher_beneficio_pncp(o.item_id, o.snapshot);
  end loop;
end $$;

create index if not exists operacao_itens_resultado_participar_idx
  on public.operacao_itens_resultado (processo_id, organizacao_id) where participar;
commit;
notify pgrst, 'reload schema';
