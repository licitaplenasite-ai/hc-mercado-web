-- Andamento do item depois de ganhar (processos.html > processo > Participação e resultado):
-- Aguardando compra → Comprado → Enviado → Entregue, com a data de cada passo e rastreio/link.
-- Só acrescenta colunas em operacao_itens_resultado: a RLS da tabela (seguranca_operacao.sql: lê quem acessa o
-- processo; escreve gestor/operador) já cobre. A regra de passos/datas fica em operacao-acompanhamento.js (andamentoItem).
-- Idempotente (pode rodar mais de uma vez no SQL Editor), transação única, não apaga dados.
-- Rodar depois do 01-aplicar.sql.
begin;
alter table public.operacao_itens_resultado
  add column if not exists entrega_situacao text
    check (entrega_situacao is null or entrega_situacao in ('aguardando_compra', 'comprado', 'enviado', 'entregue')),
  add column if not exists comprado_em date,
  add column if not exists enviado_em date,
  add column if not exists entregue_em date,
  add column if not exists rastreio text
    check (rastreio is null or length(btrim(rastreio)) between 1 and 500);
commit;
notify pgrst, 'reload schema';
