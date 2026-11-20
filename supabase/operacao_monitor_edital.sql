-- "Mudou algo no edital?": monitor por processo (robô scripts/monitor_processos.js, a cada hora).
-- Idempotente, transação única; rodar no SQL Editor depois de operacao_esteira.sql (usa as mesmas funções e o
-- mesmo índice de chave composta). Não apaga dados; só cria tabelas, índices e políticas.
--   operacao_monitor_processos  uma linha por processo acompanhado: situação atual, datas, "verificado em" e o
--                               retrato usado na comparação (o que o robô viu na última vez).
--   operacao_monitor_mudancas   histórico do que mudou, em linguagem simples. Uma linha por mudança; a chave
--                               (processo_id, chave) torna a gravação idempotente (rodar de novo não duplica).
-- Leitura: quem acessa a empresa (pode_acessar_empresa_operacao). Escrita: só service_role (o robô e o envio
-- de e-mail em scripts/lembretes_licitacoes.py). Nunca toca operacao_processos (atualizado_em é controle de
-- concorrência do kit).
begin;
do $$ begin
 if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null
  or to_regclass('public.operacao_processos_id_empresa_org_idx') is null then
  raise exception 'Aplique antes 01-aplicar.sql e operacao_esteira.sql';
 end if;
end $$;

create table if not exists public.operacao_monitor_processos (
  processo_id uuid primary key,
  organizacao_id uuid not null,
  empresa_id uuid not null,
  numero_controle_pncp text check (numero_controle_pncp ~ '^[0-9]{14}-[0-9]-[0-9]{6}/[0-9]{4}$'),
  id_compra text check (id_compra ~ '^[0-9]{17}$'),
  situacao text check (length(situacao) <= 120),
  abertura_propostas timestamptz,
  encerramento_propostas timestamptz,
  retrato jsonb not null default '{}'::jsonb check (jsonb_typeof(retrato) = 'object'),
  verificado_em timestamptz,
  proximo_em timestamptz not null default now(),
  erro text check (length(erro) <= 300),
  criado_em timestamptz not null default now(),
  foreign key (processo_id, empresa_id, organizacao_id)
    references public.operacao_processos(id, empresa_id, organizacao_id) on delete cascade
);
create index if not exists operacao_monitor_processos_fila_idx on public.operacao_monitor_processos (proximo_em);

create table if not exists public.operacao_monitor_mudancas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null,
  processo_id uuid not null,
  chave text not null check (length(chave) between 1 and 200),
  tipo text not null check (tipo in ('situacao', 'data', 'arquivo_novo', 'arquivo_retificado', 'arquivo_removido',
    'aviso', 'esclarecimento', 'impugnacao', 'retificacao', 'item_alterado', 'item_cancelado', 'resultado', 'chat', 'outro')),
  resumo text not null check (length(resumo) between 1 and 600),
  detalhe jsonb not null default '{}'::jsonb check (jsonb_typeof(detalhe) = 'object'),
  fonte text not null check (fonte in ('pncp', 'comprasgov', 'extensao')),
  ocorrido_em timestamptz,
  detectado_em timestamptz not null default now(),
  -- false = já existia quando o monitor começou (entra no histórico, sem alerta nem e-mail).
  alerta boolean not null default true,
  -- Reserva do e-mail (PATCH condicional avisado_em=is.null): só uma rodada envia.
  avisado_em timestamptz,
  unique (processo_id, chave),
  foreign key (processo_id, empresa_id, organizacao_id)
    references public.operacao_processos(id, empresa_id, organizacao_id) on delete cascade
);
create index if not exists operacao_monitor_mudancas_processo_idx on public.operacao_monitor_mudancas (processo_id, detectado_em desc);
create index if not exists operacao_monitor_mudancas_aviso_idx on public.operacao_monitor_mudancas (detectado_em) where alerta and avisado_em is null;

alter table public.operacao_monitor_processos enable row level security;
alter table public.operacao_monitor_mudancas enable row level security;
revoke all on public.operacao_monitor_processos, public.operacao_monitor_mudancas from public, anon, authenticated;
grant select on public.operacao_monitor_processos, public.operacao_monitor_mudancas to authenticated;
grant all on public.operacao_monitor_processos, public.operacao_monitor_mudancas to service_role;
drop policy if exists operacao_monitor_processos_leitura on public.operacao_monitor_processos;
create policy operacao_monitor_processos_leitura on public.operacao_monitor_processos for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_monitor_mudancas_leitura on public.operacao_monitor_mudancas;
create policy operacao_monitor_mudancas_leitura on public.operacao_monitor_mudancas for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
commit;
