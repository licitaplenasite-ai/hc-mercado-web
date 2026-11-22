-- Agente "Contador" (formação de preço com tributos de hoje e da Reforma). 22/11/2026.
-- 1) Cache compartilhado de dado PÚBLICO: classificação sugerida por descrição de item do edital e resultado da
--    calculadora oficial da Receita por NCM/NBS + cClassTrib + ano. Só a rota /api/contador (chave de serviço) lê e grava.
-- 2) Resumo do Contador no item (contador_resumo): custos, tributos e preço final, para a proposta usar depois.
--    A RLS de operacao_itens_resultado (lê quem acessa o processo; escreve gestor/operador) já cobre a coluna.
-- 3) Recurso "contador" nos planos: Empresa, Assessoria, Teste e Dono; fora do Essencial e do Teste encerrado.
--    contador-ia também entra no recurso "ia" para somar no uso justo mensal de IA (uso_ia_mes_titular).
-- Idempotente (pode rodar mais de uma vez no SQL Editor), transação única, não apaga dados.
-- Rodar DEPOIS de planos_e_recursos.sql e de operacao_itens_proposta.sql. A tabela oficial fica em dados_robo
-- (chave rtc_classificacoes), gravada pelo robô scripts/copiar_tabelas_rtc.js.
begin;

create table if not exists public.contador_classificacoes (
  chave text primary key check (chave ~ '^[a-f0-9]{64}$'),             -- sha256 da descrição normalizada
  tipo text not null check (tipo in ('bem', 'servico')),
  codigo text not null check (codigo ~ '^[0-9]{8,9}$'),                -- NCM (8) ou NBS (9)
  cclasstrib text not null check (cclasstrib ~ '^[0-9]{6}$'),
  motivo text not null default '' check (length(motivo) <= 600),
  versao_db text check (versao_db is null or length(versao_db) <= 20),
  usos integer not null default 1 check (usos >= 1),
  criado_em timestamptz not null default now()
);
create table if not exists public.contador_oficial (
  chave text primary key check (chave ~ '^(ncm|nbs):[0-9]{8,9}\|[0-9]{6}\|20[2-3][0-9]$'),
  resultado jsonb not null check (jsonb_typeof(resultado) = 'object' and pg_column_size(resultado) < 8000),
  versao_db text check (versao_db is null or length(versao_db) <= 20),
  criado_em timestamptz not null default now()
);
alter table public.contador_classificacoes enable row level security;
alter table public.contador_oficial enable row level security;
-- Sem policy: só a chave de serviço (rota /api/contador). Navegador não lê nem grava.
revoke all on public.contador_classificacoes, public.contador_oficial from public, anon, authenticated;
grant select, insert, update on public.contador_classificacoes, public.contador_oficial to service_role;

alter table public.operacao_itens_resultado add column if not exists contador_resumo jsonb;
alter table public.operacao_itens_resultado drop constraint if exists operacao_itens_contador_resumo_ok;
alter table public.operacao_itens_resultado add constraint operacao_itens_contador_resumo_ok
  check (contador_resumo is null or (jsonb_typeof(contador_resumo) = 'object' and pg_column_size(contador_resumo) < 12000));

do $$
begin
  if to_regclass('public.recursos_plano') is null then
    raise notice 'planos_e_recursos.sql ainda não rodou: recurso contador não criado.';
    return;
  end if;
  insert into public.recursos_plano (codigo, nome, funcoes) values
    ('contador', 'Contador (formação de preço com tributos)', array['contador-ia', 'contador-calculo'])
  on conflict (codigo) do nothing;
  update public.recursos_plano set funcoes = array_append(funcoes, 'contador-ia')
    where codigo = 'ia' and not ('contador-ia' = any (funcoes));
  -- limite_diario vazio = limite da própria rota (contador.js). "do nothing": o que o dono editar no admin fica.
  insert into public.plano_recursos (plano, recurso, permitido, limite_diario)
  select p.codigo, 'contador', p.codigo in ('teste', 'empresa', 'assessoria', 'dono'), null
  from public.planos p where p.codigo in ('gratis', 'teste', 'essencial', 'empresa', 'assessoria', 'dono')
  on conflict (plano, recurso) do nothing;
end $$;
commit;
notify pgrst, 'reload schema';
