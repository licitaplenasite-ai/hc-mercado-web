-- LicitaPlena: planos com regras automáticas (Teste encerrado, Teste, Essencial, Empresa, Assessoria, Dono), assinaturas,
-- extras, pagamentos (preparado, sem integração) e funções do painel de administração.
-- 21/11/2026 (_historico/PLANOS-E-CUSTOS-20261121.html): fim do Grátis para sempre (teste vencido = só boletim), plano
-- Essencial, preços novos, IA com uso justo por mês e por CNPJ (passou da cota = IA mais barata) e extras por assinatura.
-- Arquitetura: _historico/arquitetura-planos-admin-20261119.md. Teste: supabase/testar_planos.sql.
-- Idempotente: seguro rodar mais de uma vez no SQL Editor. Não apaga dados; não mexe em empresas, processos,
-- documentos nem membros. Rodar DEPOIS de seguranca_aprovacao_20261119.sql. Se limite_cnpjs_operacao.sql ou
-- acesso_empresa_convites.sql forem rodados de novo, rode este outra vez em seguida (ele redefine o trigger de CNPJs
-- e limite_cnpjs_operacao()).
begin;

-- ---------------------------------------------------------------------------------------------------------------
-- 1) Catálogo: planos, recursos e a tabela única plano x recurso. Leitura pública (é a página de preços);
--    escrita só pelas funções do admin (owner com 2 fatores) ou pelo SQL Editor.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.planos (
  codigo text primary key check (codigo ~ '^[a-z_]{2,30}$'),
  nome text not null check (length(nome) between 2 and 60),
  descricao text not null default '',
  max_cnpjs integer check (max_cnpjs is null or max_cnpjs >= 1),       -- vazio = sem limite
  max_usuarios integer check (max_usuarios is null or max_usuarios >= 1),
  max_processos integer check (max_processos is null or max_processos >= 0), -- processos não arquivados
  preco_mensal_centavos integer check (preco_mensal_centavos is null or preco_mensal_centavos >= 0),
  preco_anual_centavos integer check (preco_anual_centavos is null or preco_anual_centavos >= 0),
  dias_teste integer check (dias_teste is null or dias_teste between 1 and 90),
  ia_mes_por_cnpj integer check (ia_mes_por_cnpj is null or ia_mes_por_cnpj >= 0), -- uso justo de IA por mês; vazio = sem cota
  escolhivel_no_cadastro boolean not null default false,
  ordem integer not null default 0,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.recursos_plano (
  codigo text primary key check (codigo ~ '^[a-z_]{2,30}$'),
  nome text not null,
  funcoes text[] not null default '{}'  -- nomes usados em uso_diario.funcao pelas rotas /api (verificarLimiteDiario)
);
create table if not exists public.plano_recursos (
  plano text not null references public.planos(codigo) on update cascade on delete cascade,
  recurso text not null references public.recursos_plano(codigo) on update cascade on delete cascade,
  permitido boolean not null default true,
  limite_diario integer check (limite_diario is null or limite_diario >= 0), -- vazio = limite padrão da rota
  primary key (plano, recurso)
);
alter table public.planos enable row level security;
alter table public.recursos_plano enable row level security;
alter table public.plano_recursos enable row level security;
revoke all on public.planos, public.recursos_plano, public.plano_recursos from anon, authenticated;
grant select on public.planos, public.recursos_plano, public.plano_recursos to anon, authenticated;
drop policy if exists planos_select_publico on public.planos;
create policy planos_select_publico on public.planos for select to anon, authenticated using (ativo);
drop policy if exists recursos_plano_select_publico on public.recursos_plano;
create policy recursos_plano_select_publico on public.recursos_plano for select to anon, authenticated using (true);
drop policy if exists plano_recursos_select_publico on public.plano_recursos;
create policy plano_recursos_select_publico on public.plano_recursos for select to anon, authenticated using (true);

-- Banco que já tinha os planos de 19/11 (sem a linha Essencial): aplica uma vez os valores aprovados em 21/11. Depois
-- disso o que o dono editar no admin não volta ao padrão quando este arquivo roda de novo.
alter table public.planos add column if not exists ia_mes_por_cnpj integer check (ia_mes_por_cnpj is null or ia_mes_por_cnpj >= 0);
-- 22/11: ciclo semestral (6 meses com 10% de desconto, pago de uma vez). Preenchido logo depois dos valores iniciais.
alter table public.planos add column if not exists preco_semestral_centavos integer check (preco_semestral_centavos is null or preco_semestral_centavos >= 0);
do $$
begin
  if exists (select 1 from public.planos) and not exists (select 1 from public.planos where codigo = 'essencial') then
    update public.planos set nome = 'Teste encerrado', max_processos = 0, ia_mes_por_cnpj = 0,
      descricao = 'O teste de 14 dias terminou sem assinatura: só o boletim por e-mail continua. Os dados ficam guardados.' where codigo = 'gratis';
    update public.planos set descricao = '14 dias sem cartão, com tudo do plano Empresa. Vale o menor limite entre o plano escolhido e esta linha.' where codigo = 'teste';
    update public.planos set preco_mensal_centavos = 24900, preco_anual_centavos = 249000, ia_mes_por_cnpj = 1000, ordem = 4,
      descricao = 'Para a empresa que licita: 1 CNPJ, 3 pessoas e tudo liberado. Lance assistido é extra.' where codigo = 'empresa';
    update public.planos set preco_mensal_centavos = 69700, preco_anual_centavos = 697000, max_cnpjs = 3, max_usuarios = 6, ia_mes_por_cnpj = 800, ordem = 5,
      descricao = 'Para assessorias: 3 CNPJs e 6 pessoas, com tudo do Empresa para cada CNPJ. CNPJ extra: R$ 199 por mês.' where codigo = 'assessoria';
    -- Teste encerrado não usa nenhuma ferramenta; no teste e nos planos pagos a IA passa a ter só o teto diário de abuso.
    update public.plano_recursos set permitido = false, limite_diario = null where plano = 'gratis';
    update public.plano_recursos set limite_diario = null where plano = 'teste' and recurso = 'ia';
    update public.plano_recursos set limite_diario = 100 where plano in ('empresa', 'assessoria') and recurso = 'ia' and limite_diario is null;
  end if;
end $$;

-- Valores iniciais (instalação nova). "do nothing": o que o dono editar depois não volta ao padrão.
-- Anual = 10 vezes o mensal (2 meses grátis). Preço de fundador (30% por 12 meses) = valor_centavos da assinatura.
insert into public.planos (codigo, nome, descricao, max_cnpjs, max_usuarios, max_processos, preco_mensal_centavos, preco_anual_centavos, dias_teste, escolhivel_no_cadastro, ordem, ia_mes_por_cnpj) values
  ('gratis', 'Teste encerrado', 'O teste de 14 dias terminou sem assinatura: só o boletim por e-mail continua. Os dados ficam guardados.', 1, 1, 0, 0, null, null, false, 1, 0),
  ('teste', 'Teste grátis', '14 dias sem cartão, com tudo do plano Empresa. Vale o menor limite entre o plano escolhido e esta linha.', 3, 5, null, 0, null, 14, false, 2, null),
  ('essencial', 'Essencial', 'Para começar: 1 CNPJ, 1 pessoa e até 15 processos. Resumo e Pergunte ao Edital, empresas e documentos, agenda, Jurídico, SINAPI, BDI e Mão de obra.', 1, 1, 15, 12700, 127000, null, true, 3, 300),
  ('empresa', 'Empresa', 'Para a empresa que licita: 1 CNPJ, 3 pessoas e tudo liberado. Lance assistido é extra.', 1, 3, null, 24900, 249000, null, true, 4, 1000),
  ('assessoria', 'Assessoria', 'Para assessorias: 3 CNPJs e 6 pessoas, com tudo do Empresa para cada CNPJ. CNPJ extra: R$ 199 por mês.', 3, 6, null, 69700, 697000, null, true, 5, 800),
  ('dono', 'Dono (ilimitado)', 'Conta do proprietário do LicitaPlena.', null, null, null, null, null, null, false, 9, null)
on conflict (codigo) do nothing;
-- Semestral = 6 x mensal x 0,9, arredondado para real inteiro (Essencial 686, Empresa 1.345, Assessoria 3.764). Só onde
-- ainda está vazio: o que o dono editar no admin não volta ao padrão.
update public.planos set preco_semestral_centavos = round(preco_mensal_centavos * 5.4 / 100.0)::integer * 100
  where preco_semestral_centavos is null and preco_mensal_centavos > 0;
-- Recursos sem rota /api (funcoes vazio) valem pela tela e, onde dá, pela RLS (Prospecção, seção 4).
insert into public.recursos_plano (codigo, nome, funcoes) values
  ('ia', 'Inteligência artificial (resumo, busca e fornecedor com IA)', array['ia-edital', 'monte-busca-ia', 'fornecedor-ia']),
  ('chat_ia', 'Chat com IA', array['chat-ia']),
  ('analise_cnpj', 'Análise por CNPJ (concorrente)', array['analise-cnpj', 'analise-cnpj-buscar', 'analise-cnpj-cadastro']),
  ('proposta', 'Proposta e declarações', array['kit-documentos']),
  ('robo_lances', 'Extensão do Compras.gov (ler o pregão)', array['pregao-gravado', 'pregao-gravado-leitura']),
  ('lance_assistido', 'Lance assistido (extra)', array['proposta-lote']),
  ('pacote_operacao', 'Pacote Operação (extra: monitor do chat)', '{}'),
  ('licitacao_anterior', 'Licitação anterior do órgão', array['licitacao-anterior', 'licitacao-anterior-orgaos']),
  ('pesquisa_precos', 'Pesquisa de Preços', '{}'),
  ('mercado', 'Inteligência de Mercado e Marcas', '{}'),
  ('prospeccao', 'Prospecção', '{}'),
  ('convenios', 'Convênios e Emendas', '{}')
on conflict (codigo) do nothing;
-- O preenchimento da proposta pela extensão ("Lance") virou extra pago à parte; ler o pregão continua nos planos.
update public.recursos_plano set nome = 'Extensão do Compras.gov (ler o pregão)', funcoes = array_remove(funcoes, 'proposta-lote')
  where codigo = 'robo_lances' and 'proposta-lote' = any (funcoes);
-- limite_diario da IA = teto de abuso por pessoa por dia, alto e invisível no uso normal (a cota de verdade é mensal).
insert into public.plano_recursos (plano, recurso, permitido, limite_diario)
select p.plano, r.recurso,
  case
    when p.plano = 'gratis' then false
    when p.plano = 'dono' then true
    when r.recurso in ('lance_assistido', 'pacote_operacao') then false   -- só como extra da assinatura
    when p.plano = 'essencial' then r.recurso = 'ia'
    else true end,
  case
    when p.plano = 'teste' and r.recurso = 'analise_cnpj' then 3          -- análise por CNPJ no teste: 3 por dia
    when p.plano in ('essencial', 'empresa', 'assessoria') and r.recurso in ('ia', 'chat_ia') then 100 end
from (values ('gratis'), ('teste'), ('essencial'), ('empresa'), ('assessoria'), ('dono')) p(plano)
cross join (values ('ia'), ('chat_ia'), ('analise_cnpj'), ('proposta'), ('robo_lances'), ('lance_assistido'), ('pacote_operacao'),
  ('licitacao_anterior'), ('pesquisa_precos'), ('mercado'), ('prospeccao'), ('convenios')) r(recurso)
where exists (select 1 from public.planos where codigo = p.plano)
on conflict (plano, recurso) do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 2) Assinatura (uma por titular = dono da organização), pagamentos e histórico. O titular só LÊ o que é dele;
--    ninguém grava pelo navegador. Colaborador convidado herda o plano do titular da organização.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.assinaturas (
  usuario_id uuid primary key references public.clientes(id) on delete cascade,
  plano text not null references public.planos(codigo) on update cascade,
  situacao text not null default 'teste' check (situacao in ('teste', 'ativa', 'vencida', 'suspensa', 'cancelada')),
  teste_ate timestamptz,
  ciclo text check (ciclo in ('mensal', 'semestral', 'anual')),
  valor_centavos integer check (valor_centavos is null or valor_centavos >= 0),
  vence_em date,
  max_cnpjs integer check (max_cnpjs is null or max_cnpjs >= 1),        -- ajuste do dono; vazio = o do plano
  max_usuarios integer check (max_usuarios is null or max_usuarios >= 1),
  max_processos integer check (max_processos is null or max_processos >= 0),
  plano_solicitado text references public.planos(codigo) on update cascade,
  plano_solicitado_em timestamptz,
  -- Pontos de ligação do pagamento (Asaas ou Inter PJ), ainda sem uso.
  gateway text check (gateway in ('pix_manual', 'asaas', 'inter')),
  gateway_cliente_id text,
  gateway_assinatura_id text,
  observacoes text check (length(observacoes) <= 2000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
-- Extras contratados à parte (o admin liga na assinatura): Lance assistido e Pacote Operação. IA extra = usos a mais
-- só no mês de ia_extra_mes (1º dia do mês); no mês seguinte some sozinho, sem rotina para zerar.
alter table public.assinaturas add column if not exists extras text[] not null default '{}';
alter table public.assinaturas add column if not exists ia_extra_usos integer check (ia_extra_usos is null or ia_extra_usos >= 0);
alter table public.assinaturas add column if not exists ia_extra_mes date;
alter table public.assinaturas drop constraint if exists assinaturas_extras_validos;
alter table public.assinaturas add constraint assinaturas_extras_validos check (extras <@ array['lance_assistido', 'pacote_operacao']::text[]);
-- IA extra comprada junto com o ciclo (pedido semestral ou anual): os usos a mais valem todo mês até esta data.
alter table public.assinaturas add column if not exists ia_extra_ate date;
alter table public.assinaturas drop constraint if exists assinaturas_ciclo_check;
alter table public.assinaturas add constraint assinaturas_ciclo_check check (ciclo in ('mensal', 'semestral', 'anual'));
create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.clientes(id) on delete set null,   -- registro fiscal fica mesmo se a conta sair
  cliente_email text,
  plano text references public.planos(codigo) on update cascade,
  ciclo text check (ciclo in ('mensal', 'semestral', 'anual')),
  valor_centavos integer not null check (valor_centavos > 0),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'pago', 'cancelado', 'estornado', 'vencido')),
  metodo text not null default 'pix' check (metodo in ('pix', 'boleto', 'cartao', 'manual')),
  vencimento date,
  pago_em timestamptz,
  periodo_inicio date,
  periodo_fim date,
  referencia text check (length(referencia) <= 200),
  gateway text check (gateway in ('pix_manual', 'asaas', 'inter')),
  gateway_cobranca_id text unique,  -- o webhook acha o pagamento por aqui; único = entrega repetida não duplica
  observacoes text check (length(observacoes) <= 2000),
  criado_em timestamptz not null default now(),
  criado_por text
);
alter table public.pagamentos drop constraint if exists pagamentos_ciclo_check;
alter table public.pagamentos add constraint pagamentos_ciclo_check check (ciclo in ('mensal', 'semestral', 'anual'));
create index if not exists pagamentos_usuario_idx on public.pagamentos (usuario_id, criado_em desc);
-- 22/11: preços dos extras por ciclo (CNPJ extra, Lance assistido, Pacote Operação, IA extra). Mesma regra dos planos:
-- semestral = 6 x mensal x 0,9 e anual = 10 x mensal, em real inteiro. Leitura pública (tela de planos).
create table if not exists public.precos_extras (
  codigo text primary key check (codigo in ('cnpj_extra', 'lance_assistido', 'pacote_operacao', 'ia_extra')),
  nome text not null,
  por_cnpj boolean not null default false,  -- Lance assistido e Pacote Operação: cobrados por CNPJ do plano
  preco_mensal_centavos integer not null check (preco_mensal_centavos > 0),
  preco_semestral_centavos integer not null check (preco_semestral_centavos > 0),
  preco_anual_centavos integer not null check (preco_anual_centavos > 0)
);
insert into public.precos_extras (codigo, nome, por_cnpj, preco_mensal_centavos, preco_semestral_centavos, preco_anual_centavos) values
  ('cnpj_extra', 'CNPJ extra (Assessoria)', false, 19900, 107500, 199000),
  ('lance_assistido', 'Lance assistido', true, 9700, 52400, 97000),
  ('pacote_operacao', 'Pacote Operação', true, 4900, 26500, 49000),
  ('ia_extra', 'IA extra (mais 500 leituras por mês)', false, 4900, 26500, 49000)
on conflict (codigo) do nothing;
alter table public.precos_extras enable row level security;
revoke all on public.precos_extras from anon, authenticated;
grant select on public.precos_extras to anon, authenticated;
drop policy if exists precos_extras_select_publico on public.precos_extras;
create policy precos_extras_select_publico on public.precos_extras for select to anon, authenticated using (true);

-- Pedido de compra (tela assinar.html): o cliente escolhe plano, ciclo e extras; o valor é calculado AQUI, nunca no
-- navegador. O dono confere o Pix na conta e libera no admin (admin_decidir_pedido, 2 fatores). Pagamento manual,
-- sem gateway. O cliente só lê os pedidos dele; ninguém grava pelo navegador.
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.clientes(id) on delete cascade,
  plano text not null references public.planos(codigo) on update cascade,
  ciclo text not null check (ciclo in ('mensal', 'semestral', 'anual')),
  extras text[] not null default '{}' check (extras <@ array['lance_assistido', 'pacote_operacao', 'ia_extra']::text[]),
  cnpjs_extras integer not null default 0 check (cnpjs_extras between 0 and 20),
  valor_centavos integer not null check (valor_centavos > 0),
  situacao text not null default 'aguardando' check (situacao in ('aguardando', 'liberado', 'recusado', 'correcao', 'cancelado')),
  motivo text check (length(motivo) <= 500),
  pagamento_id uuid references public.pagamentos(id) on delete set null,
  criado_em timestamptz not null default now(),
  decidido_em timestamptz,
  decidido_por text
);
create index if not exists pedidos_usuario_idx on public.pedidos (usuario_id, criado_em desc);
create index if not exists pedidos_situacao_idx on public.pedidos (situacao, criado_em desc);
alter table public.pedidos enable row level security;
revoke all on public.pedidos from anon, authenticated;
grant select on public.pedidos to authenticated;
drop policy if exists pedidos_select_proprio on public.pedidos;
create policy pedidos_select_proprio on public.pedidos for select to authenticated using (usuario_id = (select auth.uid()));
create table if not exists public.assinaturas_historico (
  id bigint generated always as identity primary key,
  usuario_id uuid not null,
  acao text not null,
  antes jsonb,
  depois jsonb,
  feito_por text,
  feito_em timestamptz not null default now()
);
create index if not exists assinaturas_historico_usuario_idx on public.assinaturas_historico (usuario_id, feito_em desc);
alter table public.assinaturas enable row level security;
alter table public.pagamentos enable row level security;
alter table public.assinaturas_historico enable row level security;
revoke all on public.assinaturas, public.pagamentos, public.assinaturas_historico from anon, authenticated;
grant select on public.assinaturas, public.pagamentos to authenticated;
drop policy if exists assinaturas_select_proprio on public.assinaturas;
create policy assinaturas_select_proprio on public.assinaturas for select to authenticated using (usuario_id = (select auth.uid()));
drop policy if exists pagamentos_select_proprio on public.pagamentos;
create policy pagamentos_select_proprio on public.pagamentos for select to authenticated using (usuario_id = (select auth.uid()));
-- assinaturas_historico: sem policy = só funções security definer e service_role.

-- 22/11: carência da cobrança. Depois do vencimento a conta continua com tudo por N dias (padrão 3, o dono muda no
-- admin, aba Cobrança) com aviso fixo; passou disso, plano_efetivo_titular cai para "Teste encerrado" (só boletim).
-- Nada é apagado. Linha única; leitura liberada a quem está logado (é só um número); escrita só por admin_definir_carencia.
create table if not exists public.config_cobranca (
  id integer primary key default 1 check (id = 1),
  carencia_dias integer not null default 3 check (carencia_dias between 0 and 30),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
insert into public.config_cobranca (id) values (1) on conflict (id) do nothing;
alter table public.config_cobranca enable row level security;
revoke all on public.config_cobranca from anon, authenticated;
grant select on public.config_cobranca to authenticated;
drop policy if exists config_cobranca_select_autenticado on public.config_cobranca;
create policy config_cobranca_select_autenticado on public.config_cobranca for select to authenticated using (true);
create or replace function public.carencia_cobranca() returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select carencia_dias from public.config_cobranca where id = 1), 3)
$$;
revoke all on function public.carencia_cobranca() from public, anon;
grant execute on function public.carencia_cobranca() to authenticated, service_role;
-- 22/11: o banco roda em UTC e depois das 21h de Brasília current_date já é o dia seguinte. Assinatura, carência,
-- bloqueio, "vence hoje", "vencendo" e o robô de cobrança contam o dia de Brasília. agora_brasilia() fica separada
-- só para o teste SQL simular o relógio (testar_planos.sql troca ela dentro da transação e desfaz no rollback).
create or replace function public.agora_brasilia() returns timestamp
language sql stable set search_path = public as $$ select now() at time zone 'America/Sao_Paulo' $$;
create or replace function public.hoje_brasilia() returns date
language sql stable set search_path = public as $$ select public.agora_brasilia()::date $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3) O cálculo do plano: uma função só, usada por triggers, RLS, rotas /api e telas.
-- ---------------------------------------------------------------------------------------------------------------
-- Owner administrativo com 2 fatores na sessão (aal2 vem do JWT; mesmo dado que auth.jwt() lê).
create or replace function public.admin_planos_autorizado() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.eh_owner_admin_operacao(auth.uid())
    and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2';
$$;

create or replace function public.titular_do_usuario(p_usuario uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.owner_id from public.operacao_organizacoes o where o.owner_id = p_usuario limit 1),
    (select o.owner_id from public.operacao_membros m join public.operacao_organizacoes o on o.id = m.organizacao_id
      where m.usuario_id = p_usuario order by m.criado_em limit 1),
    p_usuario);
$$;

create or replace function public.plano_efetivo_titular(p_titular uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a public.assinaturas%rowtype; p public.planos%rowtype; t public.planos%rowtype;
  v_tem boolean := false; v_contratado text; v_efetivo text; v_teste boolean := false; v_situacao text;
  v_max_c integer; v_max_u integer; v_max_p integer; v_rec jsonb; v_ia_cnpj integer; v_ia_mes integer;
begin
  if p_titular is not null and public.eh_owner_admin_operacao(p_titular) then
    v_contratado := 'dono'; v_efetivo := 'dono'; v_situacao := 'ativa';
  else
    select * into a from public.assinaturas where usuario_id = p_titular;
    v_tem := found;
    if not v_tem then
      -- Dono de organização sem linha em clientes (caso legado): regras do teste, como a cota antiga de 3 CNPJs.
      v_contratado := 'teste'; v_efetivo := 'teste'; v_situacao := 'sem_assinatura';
    else
      v_contratado := a.plano; v_situacao := a.situacao;
      -- Vencimento com 5 dias de tolerância; teste vencido, vencida, suspensa e cancelada caem para "Teste encerrado"
      -- (código gratis): só o boletim por e-mail continua; nada é apagado.
      v_efetivo := case
        when a.situacao = 'ativa' and (a.vence_em is null or a.vence_em + public.carencia_cobranca() >= public.hoje_brasilia()) then a.plano
        when a.situacao = 'teste' and (a.teste_ate is null or a.teste_ate > now()) then a.plano
        else 'gratis' end;
      v_teste := a.situacao = 'teste' and v_efetivo = a.plano;
    end if;
  end if;
  select * into p from public.planos where codigo = v_efetivo;
  if not found then v_efetivo := 'gratis'; v_teste := false; select * into p from public.planos where codigo = 'gratis'; end if;
  v_max_c := p.max_cnpjs; v_max_u := p.max_usuarios; v_max_p := p.max_processos; v_ia_cnpj := p.ia_mes_por_cnpj;
  if v_teste then
    -- least() ignora vazio (sem limite): vale o menor entre o plano escolhido e a linha Teste.
    select * into t from public.planos where codigo = 'teste';
    v_max_c := least(v_max_c, t.max_cnpjs); v_max_u := least(v_max_u, t.max_usuarios); v_max_p := least(v_max_p, t.max_processos);
    v_ia_cnpj := least(v_ia_cnpj, t.ia_mes_por_cnpj);
  end if;
  if v_tem and v_efetivo = a.plano then
    v_max_c := coalesce(a.max_cnpjs, v_max_c); v_max_u := coalesce(a.max_usuarios, v_max_u); v_max_p := coalesce(a.max_processos, v_max_p);
  end if;
  -- Uso justo de IA do mês: por CNPJ e somado (Assessoria 800 x 3; o CNPJ extra é o ajuste max_cnpjs e soma mais 800),
  -- mais a IA extra do mês corrente. Vazio = sem cota (Dono).
  v_ia_mes := v_ia_cnpj * greatest(coalesce(v_max_c, 1), 1);
  if v_ia_mes is not null and v_tem and v_efetivo = a.plano
     and (a.ia_extra_mes = date_trunc('month', current_date)::date or a.ia_extra_ate >= current_date) then
    v_ia_mes := v_ia_mes + coalesce(a.ia_extra_usos, 0);
  end if;
  select coalesce(jsonb_object_agg(r.codigo, jsonb_build_object(
      'nome', r.nome,
      'permitido', v_efetivo = 'dono' or (coalesce(pr.permitido, false) and (not v_teste or coalesce(tr.permitido, false)))
        -- Extra ligado na assinatura (Lance assistido, Pacote Operação) vale em qualquer plano, menos no teste encerrado.
        or (v_tem and v_efetivo <> 'gratis' and coalesce(r.codigo = any (a.extras), false)),
      'limite_diario', case when v_teste then least(pr.limite_diario, tr.limite_diario) else pr.limite_diario end)), '{}'::jsonb)
    into v_rec
    from public.recursos_plano r
    left join public.plano_recursos pr on pr.plano = v_efetivo and pr.recurso = r.codigo
    left join public.plano_recursos tr on tr.plano = 'teste' and tr.recurso = r.codigo;
  return jsonb_build_object('plano', v_efetivo, 'nome', p.nome, 'plano_contratado', v_contratado,
    'nome_contratado', (select nome from public.planos where codigo = v_contratado),
    'situacao', v_situacao, 'em_teste', v_teste, 'teste_ate', a.teste_ate, 'vence_em', a.vence_em,
    'plano_solicitado', a.plano_solicitado, 'bloqueado', v_efetivo = 'gratis',
    'em_carencia', coalesce(a.situacao = 'ativa' and a.vence_em < public.hoje_brasilia() and v_efetivo <> 'gratis', false),
    'carencia_ate', case when a.situacao in ('ativa', 'vencida') and a.vence_em is not null then a.vence_em + public.carencia_cobranca() end, 'extras', coalesce(to_jsonb(a.extras), '[]'::jsonb),
    'max_cnpjs', v_max_c, 'max_usuarios', v_max_u, 'max_processos', v_max_p, 'ia_mes', v_ia_mes, 'recursos', v_rec);
end $$;

-- IA usada no mês pela organização inteira do titular (ele e todos os membros), em todas as rotas de IA.
-- shortcut: membro de duas organizações conta nas duas; trocar por organizacao_id em uso_diario se isso virar problema.
create or replace function public.uso_ia_mes_titular(p_titular uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(u.contagem), 0)::integer from public.uso_diario u
  where u.dia >= date_trunc('month', current_date)::date
    and u.funcao = any (select unnest(r.funcoes) from public.recursos_plano r where r.codigo in ('ia', 'chat_ia'))
    and u.usuario_id in (select p_titular union
      select m.usuario_id from public.operacao_membros m join public.operacao_organizacoes o on o.id = m.organizacao_id where o.owner_id = p_titular);
$$;
revoke all on function public.uso_ia_mes_titular(uuid) from public, anon, authenticated;
grant execute on function public.uso_ia_mes_titular(uuid) to service_role;

-- Interna: a organização pode usar o recurso, ou cabe mais um CNPJ / usuário / processo?
create or replace function public.pode_organizacao(p_org uuid, p_o_que text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; n integer; v_lim integer;
begin
  v := public.plano_efetivo_titular((select owner_id from public.operacao_organizacoes where id = p_org));
  if p_o_que in ('novo_cnpj', 'novo_usuario', 'novo_processo') then
    v_lim := (v ->> case p_o_que when 'novo_cnpj' then 'max_cnpjs' when 'novo_usuario' then 'max_usuarios' else 'max_processos' end)::integer;
    if v_lim is null then return true; end if;
    if p_o_que = 'novo_cnpj' then
      select count(*) into n from public.operacao_empresas where organizacao_id = p_org and ativo;
    elsif p_o_que = 'novo_usuario' then
      select count(distinct usuario_id) into n from public.operacao_membros where organizacao_id = p_org;
    else
      select count(*) into n from public.operacao_processos where organizacao_id = p_org and status <> 'arquivado';
    end if;
    return n < v_lim;
  end if;
  return coalesce((v -> 'recursos' -> p_o_que ->> 'permitido')::boolean, false);
end $$;

-- Para RLS e telas: só responde a quem tem vínculo com a organização (não revela o plano de outra).
create or replace function public.organizacao_pode(p_org uuid, p_o_que text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tem_vinculo_operacao(p_org) and public.pode_organizacao(p_org, p_o_que);
$$;

-- Para RLS de telas sem rota /api (Prospecção): o plano de quem está logado inclui o recurso? Só fala de si mesmo.
create or replace function public.eu_posso(p_recurso text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and coalesce((public.plano_efetivo_titular(public.titular_do_usuario(auth.uid())) -> 'recursos' -> p_recurso ->> 'permitido')::boolean, false);
$$;
revoke all on function public.eu_posso(text) from public, anon;
grant execute on function public.eu_posso(text) to authenticated;

revoke all on function public.admin_planos_autorizado(), public.titular_do_usuario(uuid), public.plano_efetivo_titular(uuid),
  public.pode_organizacao(uuid, text), public.organizacao_pode(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_planos_autorizado(), public.organizacao_pode(uuid, text) to authenticated;
grant execute on function public.titular_do_usuario(uuid), public.plano_efetivo_titular(uuid), public.pode_organizacao(uuid, text) to service_role;

-- O que a pessoa logada pode usar, com o uso de agora (telas: painel, operacao, sistema).
create or replace function public.meu_plano() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_usuario uuid := auth.uid(); v_tit uuid; v jsonb; v_org uuid;
begin
  if v_usuario is null then raise exception 'Sessão inválida' using errcode = '42501'; end if;
  v_tit := public.titular_do_usuario(v_usuario);
  v := public.plano_efetivo_titular(v_tit);
  select id into v_org from public.operacao_organizacoes where owner_id = v_tit order by criado_em limit 1;
  -- O cliente não vê número de cota de IA ("uso justo"): ia_mes fica só no servidor e no admin.
  return (v - 'ia_mes') || jsonb_build_object('eh_titular', v_tit = v_usuario,
    'uso', jsonb_build_object(
      'cnpjs', (select count(*) from public.operacao_empresas where organizacao_id = v_org and ativo),
      'usuarios', (select count(distinct usuario_id) from public.operacao_membros where organizacao_id = v_org),
      'processos', (select count(*) from public.operacao_processos where organizacao_id = v_org and status <> 'arquivado'),
      'hoje', (select coalesce(jsonb_object_agg(r.codigo, (select coalesce(sum(u.contagem), 0) from public.uso_diario u
          where u.usuario_id = v_usuario and u.dia = current_date and u.funcao = any (r.funcoes)
            and u.funcao not in ('analise-cnpj-buscar', 'analise-cnpj-cadastro'))), '{}'::jsonb) from public.recursos_plano r)),
    'planos_disponiveis', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome, 'descricao', descricao, 'max_cnpjs', max_cnpjs,
        'preco_mensal_centavos', preco_mensal_centavos, 'preco_semestral_centavos', preco_semestral_centavos,
        'preco_anual_centavos', preco_anual_centavos) order by ordem), '[]'::jsonb)
      from public.planos where ativo and escolhivel_no_cadastro));
end $$;
revoke all on function public.meu_plano() from public, anon;
grant execute on function public.meu_plano() to authenticated;

-- Pedido de plano (no fim do teste ou para mudar): só registra; quem muda é o admin.
create or replace function public.solicitar_plano(p_plano text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_usuario uuid := auth.uid(); a public.assinaturas%rowtype;
begin
  if v_usuario is null then raise exception 'Sessão inválida' using errcode = '42501'; end if;
  if public.titular_do_usuario(v_usuario) <> v_usuario then raise exception 'Só o titular da conta pode pedir mudança de plano' using errcode = '42501'; end if;
  if not exists (select 1 from public.planos where codigo = p_plano and ativo and escolhivel_no_cadastro) then raise exception 'Plano indisponível'; end if;
  update public.assinaturas set plano_solicitado = p_plano, plano_solicitado_em = now(), atualizado_em = now()
    where usuario_id = v_usuario returning * into a;
  if not found then raise exception 'Assinatura não encontrada'; end if;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por) values (v_usuario, 'plano_solicitado', jsonb_build_object('plano', p_plano), 'cliente');
  return jsonb_build_object('plano_solicitado', a.plano_solicitado, 'plano_solicitado_em', a.plano_solicitado_em);
end $$;
revoke all on function public.solicitar_plano(text) from public, anon;
grant execute on function public.solicitar_plano(text) to authenticated;

-- Rotas /api (verificarLimiteDiario, só chave de serviço): o plano inclui o recurso da rota? Limite do plano ou da rota.
create or replace function public.consumir_uso_plano(p_usuario_id uuid, p_funcao text, p_limite_padrao integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_rec text; v_r jsonb; v_lim integer := p_limite_padrao; n integer; v_tit uuid; v_economico boolean := false;
  -- Busca por nome e cadastro da Receita fazem parte da mesma análise por CNPJ: conferem o plano, mas não gastam a
  -- cota do recurso (ficam no limite da própria rota). Senão o Teste grátis (3/dia) só dava 1 CNPJ novo por dia.
  v_aux boolean := p_funcao in ('analise-cnpj-buscar', 'analise-cnpj-cadastro');
begin
  if p_usuario_id is null or p_funcao is null then raise exception 'Parâmetros inválidos'; end if;
  v_tit := public.titular_do_usuario(p_usuario_id);
  v := public.plano_efetivo_titular(v_tit);
  -- Teste encerrado: nenhuma ferramenta (o boletim é do robô e não passa por aqui). Dúvida ao suporte continua.
  if coalesce((v ->> 'bloqueado')::boolean, false) and p_funcao <> 'enviar_duvida' then
    return jsonb_build_object('permitido', false, 'motivo', 'assinatura', 'plano', v ->> 'nome');
  end if;
  -- A lista mais curta ganha: chat-ia está em "ia" (ia_conversas.sql) e em "chat_ia"; vale a regra do Chat.
  select codigo into v_rec from public.recursos_plano where p_funcao = any (funcoes) order by cardinality(funcoes), codigo limit 1;
  if v_rec is not null then
    v_r := v -> 'recursos' -> v_rec;
    if not coalesce((v_r ->> 'permitido')::boolean, false) then
      return jsonb_build_object('permitido', false, 'motivo', 'plano', 'recurso', v_rec, 'nome_recurso', v_r ->> 'nome', 'plano', v ->> 'nome');
    end if;
    if not v_aux then v_lim := coalesce((v_r ->> 'limite_diario')::integer, p_limite_padrao); end if;
  end if;
  n := public.incrementar_uso(p_usuario_id, p_funcao);
  -- Limite do plano vale para o recurso inteiro (ex.: Grátis = 3 de IA/dia somando resumo, pergunta, fornecedor e chat),
  -- igual ao "hoje" de meu_plano. Sem limite no plano, cada rota segue com o próprio padrão.
  if v_rec is not null and not v_aux and (v_r ->> 'limite_diario') is not null then
    select coalesce(sum(u.contagem), 0)::integer into n from public.uso_diario u
      where u.usuario_id = p_usuario_id and u.dia = current_date and u.funcao = any (select unnest(r.funcoes) from public.recursos_plano r where r.codigo = v_rec)
        and u.funcao not in ('analise-cnpj-buscar', 'analise-cnpj-cadastro');
  end if;
  -- Uso justo: passou da IA do mês da organização, não bloqueia; a rota troca para a IA mais barata.
  if v_rec in ('ia', 'chat_ia') and (v ->> 'ia_mes') is not null then
    v_economico := public.uso_ia_mes_titular(v_tit) > (v ->> 'ia_mes')::integer;
  end if;
  return jsonb_build_object('permitido', v_lim is null or n <= v_lim, 'contagem', n, 'limite', v_lim, 'recurso', v_rec, 'plano', v ->> 'nome',
    'economico', v_economico);
end $$;
revoke all on function public.consumir_uso_plano(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consumir_uso_plano(uuid, text, integer) to service_role;

-- A tela "Minhas empresas" já chama esta função: agora devolve o limite do plano (vazio = sem limite).
create or replace function public.limite_cnpjs_operacao() returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  return (public.plano_efetivo_titular(public.titular_do_usuario(auth.uid())) ->> 'max_cnpjs')::integer;
end $$;
revoke all on function public.limite_cnpjs_operacao() from public, anon;
grant execute on function public.limite_cnpjs_operacao() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4) Garantias no banco: CNPJs, usuários e processos (vale para tela, /api e SQL).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.verificar_limite_cnpjs_operacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v jsonb;
begin
  if not new.ativo then return new; end if;
  if tg_op = 'UPDATE' then
    if old.ativo and old.organizacao_id = new.organizacao_id then return new; end if;
  end if;
  -- O bloqueio na organização serializa dois cadastros simultâneos.
  select owner_id into v_owner from public.operacao_organizacoes where id = new.organizacao_id for update;
  if v_owner is null then raise exception 'Organização não encontrada'; end if;
  if not public.pode_organizacao(new.organizacao_id, 'novo_cnpj') then
    v := public.plano_efetivo_titular(v_owner);
    raise exception 'Limite de % CNPJs ativos atingido para esta conta', v ->> 'max_cnpjs'
      using errcode = 'P0001', hint = 'Plano ' || (v ->> 'nome') || '. Para mais empresas, peça a mudança de plano.';
  end if;
  return new;
end $$;
drop trigger if exists operacao_empresas_limite_cnpjs on public.operacao_empresas;
create trigger operacao_empresas_limite_cnpjs before insert or update of ativo, organizacao_id on public.operacao_empresas
  for each row execute function public.verificar_limite_cnpjs_operacao();

create or replace function public.verificar_limite_usuarios_operacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform 1 from public.operacao_organizacoes where id = new.organizacao_id for update;
  if exists (select 1 from public.operacao_membros where organizacao_id = new.organizacao_id and usuario_id = new.usuario_id) then return new; end if;
  if not public.pode_organizacao(new.organizacao_id, 'novo_usuario') then
    v := public.plano_efetivo_titular((select owner_id from public.operacao_organizacoes where id = new.organizacao_id));
    raise exception 'Limite de % usuários atingido para esta conta', v ->> 'max_usuarios'
      using errcode = 'P0001', hint = 'Plano ' || (v ->> 'nome') || '.';
  end if;
  return new;
end $$;
drop trigger if exists operacao_membros_limite_usuarios on public.operacao_membros;
create trigger operacao_membros_limite_usuarios before insert on public.operacao_membros
  for each row execute function public.verificar_limite_usuarios_operacao();

create or replace function public.verificar_limite_processos_operacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if new.status = 'arquivado' then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'arquivado' then return new; end if;
  perform 1 from public.operacao_organizacoes where id = new.organizacao_id for update;
  if not public.pode_organizacao(new.organizacao_id, 'novo_processo') then
    v := public.plano_efetivo_titular((select owner_id from public.operacao_organizacoes where id = new.organizacao_id));
    raise exception 'Limite de % processos ativos atingido para esta conta', v ->> 'max_processos'
      using errcode = 'P0001', hint = 'Plano ' || (v ->> 'nome') || '. Arquive um processo ou peça a mudança de plano.';
  end if;
  return new;
end $$;
drop trigger if exists operacao_processos_limite_plano on public.operacao_processos;
create trigger operacao_processos_limite_plano before insert or update of status on public.operacao_processos
  for each row execute function public.verificar_limite_processos_operacao();

-- RLS: o navegador grava processos direto (Funil). Policy restritiva = a mesma regra antes de chegar ao trigger.
drop policy if exists operacao_processos_plano_permite on public.operacao_processos;
create policy operacao_processos_plano_permite on public.operacao_processos as restrictive for insert to authenticated
  with check (public.organizacao_pode(organizacao_id, 'novo_processo'));

-- Prospecção (prospeccao.html e /api/prospeccao leem com o token do usuário): fora do plano, a tabela some para a
-- conta. Restritiva = soma-se à policy de leitura de prospeccao.sql. (select ...) roda uma vez por consulta, não por linha.
do $$
begin
  if to_regclass('public.prospeccao_itens') is not null then
    drop policy if exists prospeccao_itens_select_plano on public.prospeccao_itens;
    create policy prospeccao_itens_select_plano on public.prospeccao_itens as restrictive for select to authenticated
      using ((select public.eu_posso('prospeccao')));
  end if;
end $$;

-- Proposta e declarações: a rota kit-documentos confere o recurso "proposta" por consumir_uso_plano. Sem trigger nem
-- policy em operacao_kit_documentos: o gate do kit (02-verificar) exige a tabela exatamente como kit_documentos.sql deixa.
drop trigger if exists operacao_kit_documentos_plano on public.operacao_kit_documentos;
drop function if exists public.verificar_plano_kit_documentos();

-- ---------------------------------------------------------------------------------------------------------------
-- 5) Cadastro -> teste. A assinatura nasce com o cadastro; o prazo do teste começa na aprovação.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.criar_assinatura_do_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pedido text; v_plano text; v_dias integer;
begin
  -- to_jsonb: lê o metadado do cadastro sem depender da coluna existir (ensaio sem Auth real).
  select to_jsonb(u) -> 'raw_user_meta_data' ->> 'plano_desejado' into v_pedido from auth.users u where u.id = new.id;
  v_pedido := case
    when lower(coalesce(new.plano, '')) in ('essencial', 'empresa', 'assessoria') then lower(new.plano)
    when exists (select 1 from public.planos where codigo = v_pedido and ativo and escolhivel_no_cadastro) then v_pedido end;
  -- Teste de 14 dias = tudo do plano Empresa (21/11): quem pediu Essencial testa o Empresa e o pedido fica anotado
  -- para o admin. Quem pediu Assessoria, ou não escolheu (convidado, conta antiga), testa a Assessoria, que tem tudo do
  -- Empresa e até 3 CNPJs pela linha Teste, como a cota antiga.
  v_plano := case when v_pedido in ('essencial', 'empresa') then 'empresa' else 'assessoria' end;
  select dias_teste into v_dias from public.planos where codigo = 'teste';
  insert into public.assinaturas (usuario_id, plano, situacao, teste_ate, plano_solicitado, plano_solicitado_em, atualizado_por)
    values (new.id, v_plano, 'teste', case when new.status = 'aprovado' then now() + make_interval(days => coalesce(v_dias, 14)) end,
      nullif(v_pedido, v_plano), case when v_pedido <> v_plano then now() end, 'cadastro')
    on conflict (usuario_id) do nothing;
  update public.clientes set plano = v_plano where id = new.id and plano is distinct from v_plano;
  return new;
end $$;
drop trigger if exists clientes_criar_assinatura on public.clientes;
create trigger clientes_criar_assinatura after insert on public.clientes
  for each row execute function public.criar_assinatura_do_cliente();

create or replace function public.iniciar_teste_na_aprovacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_dias integer;
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    select dias_teste into v_dias from public.planos where codigo = 'teste';
    update public.assinaturas set teste_ate = now() + make_interval(days => coalesce(v_dias, 14)), atualizado_em = now()
      where usuario_id = new.id and situacao = 'teste' and teste_ate is null;
  end if;
  return new;
end $$;
drop trigger if exists clientes_iniciar_teste on public.clientes;
create trigger clientes_iniciar_teste after update of status on public.clientes
  for each row execute function public.iniciar_teste_na_aprovacao();

revoke all on function public.verificar_limite_usuarios_operacao(), public.verificar_limite_processos_operacao(),
  public.criar_assinatura_do_cliente(), public.iniciar_teste_na_aprovacao() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 6) Migração das contas existentes (só quem ainda não tem assinatura; nada é apagado).
-- ---------------------------------------------------------------------------------------------------------------
with base as (
  select c.id, c.status, c.plano as plano_antigo, l.limite, public.eh_owner_admin_operacao(c.id) as owner,
    (select count(*) from public.operacao_organizacoes o join public.operacao_empresas e on e.organizacao_id = o.id and e.ativo where o.owner_id = c.id)::int as ativos,
    (select count(distinct m.usuario_id) from public.operacao_organizacoes o join public.operacao_membros m on m.organizacao_id = o.id where o.owner_id = c.id)::int as usuarios
  from public.clientes c left join public.operacao_limites_cnpj l on l.usuario_id = c.id
  where not exists (select 1 from public.assinaturas a where a.usuario_id = c.id)
), escolha as (
  select b.*, case
    when b.owner then 'dono'
    when lower(trim(coalesce(b.plano_antigo, ''))) in ('gratis', 'empresa', 'assessoria') then lower(trim(b.plano_antigo))
    when b.limite = 1 then 'empresa'
    when b.limite is not null then 'assessoria'
    when b.ativos > 1 then 'assessoria'
    else 'empresa' end as plano
  from base b
)
insert into public.assinaturas (usuario_id, plano, situacao, max_cnpjs, max_usuarios, observacoes, atualizado_por)
select e.id, e.plano, case when e.status = 'aprovado' or e.owner then 'ativa' else 'teste' end,
  case when e.plano <> 'dono' and (e.ativos > coalesce(p.max_cnpjs, e.ativos) or (e.plano = 'assessoria' and e.limite > 1))
    then greatest(e.ativos, coalesce(e.limite, 0)) end,
  case when e.plano <> 'dono' and e.usuarios > coalesce(p.max_usuarios, e.usuarios) then e.usuarios end,
  'Migração de 19/11/2026. Plano anterior: ' || coalesce(nullif(e.plano_antigo, ''), 'vazio') || coalesce('; cota de CNPJs anterior: ' || e.limite, ''),
  'migracao'
from escolha e join public.planos p on p.codigo = e.plano
on conflict (usuario_id) do nothing;
update public.clientes c set plano = a.plano from public.assinaturas a where a.usuario_id = c.id and c.plano is distinct from a.plano;

-- ---------------------------------------------------------------------------------------------------------------
-- 7) Pagamento confirmado: ponto ÚNICO de ligação com o gateway (admin hoje; webhook do Asaas/Inter depois).
--    Idempotente: pagar de novo o mesmo registro não estende o prazo duas vezes.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.aplicar_pagamento_confirmado(p_pagamento uuid, p_feito_por text default 'servidor') returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.pagamentos%rowtype; a public.assinaturas%rowtype; v_inicio date; v_fim date;
begin
  select * into g from public.pagamentos where id = p_pagamento for update;
  if not found then raise exception 'Pagamento não encontrado'; end if;
  if g.situacao = 'pago' then return jsonb_build_object('ja_aplicado', true, 'pagamento', g.id); end if;
  if g.situacao <> 'pendente' then raise exception 'Pagamento % não pode ser confirmado', g.situacao; end if;
  if g.usuario_id is null or g.plano is null or g.ciclo is null then raise exception 'Pagamento sem conta, plano ou ciclo'; end if;
  select * into a from public.assinaturas where usuario_id = g.usuario_id for update;
  if not found then raise exception 'Assinatura não encontrada'; end if;
  v_inicio := greatest(public.hoje_brasilia(), coalesce(case when a.situacao = 'ativa' then a.vence_em end, public.hoje_brasilia()));
  v_fim := (v_inicio + case g.ciclo when 'anual' then interval '1 year' when 'semestral' then interval '6 months' else interval '1 month' end)::date;
  update public.pagamentos set situacao = 'pago', pago_em = coalesce(pago_em, now()), periodo_inicio = v_inicio, periodo_fim = v_fim where id = g.id;
  update public.assinaturas set plano = g.plano, situacao = 'ativa', ciclo = g.ciclo, valor_centavos = g.valor_centavos,
    vence_em = v_fim, plano_solicitado = null, atualizado_em = now(), atualizado_por = p_feito_por where usuario_id = g.usuario_id;
  update public.clientes set plano = g.plano where id = g.usuario_id and plano is distinct from g.plano;
  insert into public.assinaturas_historico (usuario_id, acao, antes, depois, feito_por)
    values (g.usuario_id, 'pagamento_confirmado', to_jsonb(a), jsonb_build_object('pagamento', g.id, 'plano', g.plano, 'vence_em', v_fim), p_feito_por);
  return jsonb_build_object('ja_aplicado', false, 'pagamento', g.id, 'vence_em', v_fim);
end $$;
revoke all on function public.aplicar_pagamento_confirmado(uuid, text) from public, anon, authenticated;
grant execute on function public.aplicar_pagamento_confirmado(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 8) Painel de administração. Listar/aprovar: quem aprova cadastros. Plano, limites e financeiro: owner com 2 fatores.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_email_atual() returns text
language sql stable security definer set search_path = public as $$ select email from auth.users where id = auth.uid() $$;

create or replace function public.admin_listar_contas() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(x order by x ->> 'criado_em' desc), '[]'::jsonb) from (
    select (to_jsonb(c) - 'boletim_filtro') || jsonb_build_object(
      'assinatura', to_jsonb(a),
      'titular_id', t.tit, 'titular_nome', case when t.tit <> c.id then (select coalesce(nullif(nome, ''), email) from public.clientes where id = t.tit) end,
      'efetivo', public.plano_efetivo_titular(t.tit) - 'recursos',
      'cnpjs_ativos', (select count(*) from public.operacao_organizacoes o join public.operacao_empresas e on e.organizacao_id = o.id and e.ativo where o.owner_id = c.id),
      'usuarios', (select count(distinct m.usuario_id) from public.operacao_organizacoes o join public.operacao_membros m on m.organizacao_id = o.id where o.owner_id = c.id),
      'processos_ativos', (select count(*) from public.operacao_organizacoes o join public.operacao_processos p on p.organizacao_id = o.id and p.status <> 'arquivado' where o.owner_id = c.id),
      'uso_hoje', (select coalesce(sum(u.contagem), 0) from public.uso_diario u where u.usuario_id = c.id and u.dia = current_date),
      'uso_30d', (select coalesce(sum(u.contagem), 0) from public.uso_diario u where u.usuario_id = c.id and u.dia > current_date - 30),
      'ia_mes_uso', case when t.tit = c.id then public.uso_ia_mes_titular(c.id) end) as x
    from public.clientes c
    left join public.assinaturas a on a.usuario_id = c.id
    cross join lateral (select public.titular_do_usuario(c.id) as tit) t) s);
end $$;

create or replace function public.admin_empresas_da_conta(p_usuario uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  return jsonb_build_object(
    'empresas', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'ativo', e.ativo, 'criado_em', e.criado_em) order by e.ativo desc, e.razao_social), '[]'::jsonb)
      from public.operacao_organizacoes o join public.operacao_empresas e on e.organizacao_id = o.id where o.owner_id = p_usuario),
    'membros', (select coalesce(jsonb_agg(jsonb_build_object('nome', c.nome, 'email', coalesce(c.email, u.email), 'papel', m.papel,
        'empresa', (select razao_social from public.operacao_empresas where id = m.empresa_id)) order by m.criado_em), '[]'::jsonb)
      from public.operacao_organizacoes o join public.operacao_membros m on m.organizacao_id = o.id
      left join public.clientes c on c.id = m.usuario_id left join auth.users u on u.id = m.usuario_id where o.owner_id = p_usuario));
end $$;

-- Aprovar, reprovar, voltar para pendente, suspender (= login bloqueado + assinatura suspensa) e reativar.
create or replace function public.admin_definir_status_cliente(p_usuario uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes%rowtype; v_status text;
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  if p_status not in ('pendente', 'aprovado', 'rejeitado', 'suspenso', 'reativar') then raise exception 'Situação inválida'; end if;
  if p_status in ('suspenso', 'reativar') and not public.admin_planos_autorizado() then
    raise exception 'Suspender e reativar exigem o proprietário com 2 fatores' using errcode = '42501';
  end if;
  if public.eh_owner_admin_operacao(p_usuario) and p_status <> 'aprovado' and p_status <> 'reativar' then raise exception 'A conta do proprietário não pode ser bloqueada'; end if;
  v_status := case p_status when 'suspenso' then 'rejeitado' when 'reativar' then 'aprovado' else p_status end;
  update public.clientes set status = v_status,
    aprovado_em = case when v_status = 'aprovado' then coalesce(aprovado_em, now()) end,
    aprovado_por = case when v_status = 'aprovado' then coalesce(aprovado_por, public.admin_email_atual()) end
    where id = p_usuario returning * into c;
  if not found then raise exception 'Cliente não encontrado'; end if;
  if p_status = 'suspenso' then
    update public.assinaturas set situacao = 'suspensa', atualizado_em = now(), atualizado_por = public.admin_email_atual() where usuario_id = p_usuario;
  elsif p_status = 'reativar' then
    update public.assinaturas set situacao = 'ativa', atualizado_em = now(), atualizado_por = public.admin_email_atual() where usuario_id = p_usuario and situacao = 'suspensa';
  end if;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por)
    values (p_usuario, 'status_' || p_status, jsonb_build_object('status', c.status), public.admin_email_atual());
  return jsonb_build_object('status', c.status);
end $$;

-- Plano e limites de uma conta. p_dados: plano, situacao, teste_ate, vence_em, ciclo, valor_centavos, max_cnpjs,
-- max_usuarios, max_processos, observacoes. Chave ausente = mantém; null = limpa (ajuste volta ao do plano).
create or replace function public.admin_definir_assinatura(p_usuario uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.assinaturas%rowtype; n public.assinaturas%rowtype; v jsonb; v_uso jsonb;
begin
  if not public.admin_planos_autorizado() then raise exception 'Mudar plano exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  if jsonb_typeof(p_dados) is distinct from 'object' then raise exception 'Dados inválidos'; end if;
  if (select count(*) from jsonb_object_keys(p_dados) k where k not in ('plano', 'situacao', 'teste_ate', 'vence_em', 'ciclo',
      'valor_centavos', 'max_cnpjs', 'max_usuarios', 'max_processos', 'observacoes', 'extras', 'ia_extra_usos', 'ia_extra_mes')) > 0 then raise exception 'Campo não permitido'; end if;
  if p_dados ? 'extras' and jsonb_typeof(p_dados -> 'extras') not in ('array', 'null') then raise exception 'Extras inválidos'; end if;
  select * into a from public.assinaturas where usuario_id = p_usuario for update;
  if not found then raise exception 'Assinatura não encontrada'; end if;
  n := a;
  if p_dados ? 'plano' then n.plano := p_dados ->> 'plano'; end if;
  if p_dados ? 'situacao' then n.situacao := p_dados ->> 'situacao'; end if;
  if p_dados ? 'teste_ate' then n.teste_ate := (p_dados ->> 'teste_ate')::timestamptz; end if;
  if p_dados ? 'vence_em' then n.vence_em := (p_dados ->> 'vence_em')::date; end if;
  if p_dados ? 'ciclo' then n.ciclo := nullif(p_dados ->> 'ciclo', ''); end if;
  if p_dados ? 'valor_centavos' then n.valor_centavos := (p_dados ->> 'valor_centavos')::integer; end if;
  if p_dados ? 'max_cnpjs' then n.max_cnpjs := (p_dados ->> 'max_cnpjs')::integer; end if;
  if p_dados ? 'max_usuarios' then n.max_usuarios := (p_dados ->> 'max_usuarios')::integer; end if;
  if p_dados ? 'max_processos' then n.max_processos := (p_dados ->> 'max_processos')::integer; end if;
  if p_dados ? 'observacoes' then n.observacoes := p_dados ->> 'observacoes'; end if;
  if p_dados ? 'extras' then n.extras := coalesce(array(select jsonb_array_elements_text(p_dados -> 'extras')), '{}'); end if;
  if p_dados ? 'ia_extra_usos' then n.ia_extra_usos := (p_dados ->> 'ia_extra_usos')::integer; end if;
  -- IA extra vale para o mês informado (qualquer dia dele vira o 1º dia do mês).
  if p_dados ? 'ia_extra_mes' then n.ia_extra_mes := date_trunc('month', (p_dados ->> 'ia_extra_mes')::date)::date; end if;
  if not exists (select 1 from public.planos where codigo = n.plano) then raise exception 'Plano inexistente'; end if;
  if n.plano = 'dono' and not public.eh_owner_admin_operacao(p_usuario) then raise exception 'O plano Dono é só do proprietário'; end if;
  if n.plano = 'teste' then raise exception 'Teste é uma situação, não um plano: escolha o plano e a situação "teste"'; end if;
  if n.plano is distinct from a.plano then n.plano_solicitado := null; end if;
  update public.assinaturas set plano = n.plano, situacao = n.situacao, teste_ate = n.teste_ate, vence_em = n.vence_em, ciclo = n.ciclo,
    valor_centavos = n.valor_centavos, max_cnpjs = n.max_cnpjs, max_usuarios = n.max_usuarios, max_processos = n.max_processos,
    observacoes = n.observacoes, plano_solicitado = n.plano_solicitado, extras = n.extras, ia_extra_usos = n.ia_extra_usos,
    ia_extra_mes = n.ia_extra_mes, atualizado_em = now(), atualizado_por = public.admin_email_atual()
    where usuario_id = p_usuario;
  -- Não rebaixa abaixo do que a conta já usa (o dono desativa empresas ou usuários antes).
  v := public.plano_efetivo_titular(p_usuario);
  select jsonb_build_object(
    'cnpjs', (select count(*) from public.operacao_organizacoes o join public.operacao_empresas e on e.organizacao_id = o.id and e.ativo where o.owner_id = p_usuario),
    'usuarios', (select count(distinct m.usuario_id) from public.operacao_organizacoes o join public.operacao_membros m on m.organizacao_id = o.id where o.owner_id = p_usuario))
    into v_uso;
  if (v ->> 'plano') = n.plano and (v ->> 'max_cnpjs') is not null and (v_uso ->> 'cnpjs')::int > (v ->> 'max_cnpjs')::int then
    raise exception 'A conta tem % CNPJs ativos e o plano permite %. Desative empresas antes ou ajuste o limite.', v_uso ->> 'cnpjs', v ->> 'max_cnpjs';
  end if;
  if (v ->> 'plano') = n.plano and (v ->> 'max_usuarios') is not null and (v_uso ->> 'usuarios')::int > (v ->> 'max_usuarios')::int then
    raise exception 'A conta tem % usuários e o plano permite %. Revogue acessos antes ou ajuste o limite.', v_uso ->> 'usuarios', v ->> 'max_usuarios';
  end if;
  update public.clientes set plano = n.plano where id = p_usuario and plano is distinct from n.plano;
  insert into public.assinaturas_historico (usuario_id, acao, antes, depois, feito_por)
    values (p_usuario, 'assinatura_alterada', to_jsonb(a), (select to_jsonb(x) from public.assinaturas x where x.usuario_id = p_usuario), public.admin_email_atual());
  return v;
end $$;

create or replace function public.admin_salvar_plano(p_codigo text, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  if jsonb_typeof(p_dados) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_dados) k where k not in
    ('nome', 'descricao', 'max_cnpjs', 'max_usuarios', 'max_processos', 'preco_mensal_centavos', 'preco_semestral_centavos', 'preco_anual_centavos', 'dias_teste', 'escolhivel_no_cadastro', 'ativo', 'ia_mes_por_cnpj')) > 0
    then raise exception 'Campo não permitido'; end if;
  update public.planos set
    nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
    descricao = case when p_dados ? 'descricao' then coalesce(p_dados ->> 'descricao', '') else descricao end,
    max_cnpjs = case when p_dados ? 'max_cnpjs' then (p_dados ->> 'max_cnpjs')::integer else max_cnpjs end,
    max_usuarios = case when p_dados ? 'max_usuarios' then (p_dados ->> 'max_usuarios')::integer else max_usuarios end,
    max_processos = case when p_dados ? 'max_processos' then (p_dados ->> 'max_processos')::integer else max_processos end,
    preco_mensal_centavos = case when p_dados ? 'preco_mensal_centavos' then (p_dados ->> 'preco_mensal_centavos')::integer else preco_mensal_centavos end,
    preco_semestral_centavos = case when p_dados ? 'preco_semestral_centavos' then (p_dados ->> 'preco_semestral_centavos')::integer else preco_semestral_centavos end,
    preco_anual_centavos = case when p_dados ? 'preco_anual_centavos' then (p_dados ->> 'preco_anual_centavos')::integer else preco_anual_centavos end,
    dias_teste = case when p_dados ? 'dias_teste' then (p_dados ->> 'dias_teste')::integer else dias_teste end,
    ia_mes_por_cnpj = case when p_dados ? 'ia_mes_por_cnpj' then (p_dados ->> 'ia_mes_por_cnpj')::integer else ia_mes_por_cnpj end,
    escolhivel_no_cadastro = case when p_dados ? 'escolhivel_no_cadastro' then (p_dados ->> 'escolhivel_no_cadastro')::boolean else escolhivel_no_cadastro end,
    ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end,
    atualizado_em = now()
  where codigo = p_codigo;
  if not found then raise exception 'Plano inexistente'; end if;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por) values (auth.uid(), 'plano_editado:' || p_codigo, p_dados, public.admin_email_atual());
end $$;

create or replace function public.admin_salvar_plano_recurso(p_plano text, p_recurso text, p_permitido boolean, p_limite integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  insert into public.plano_recursos (plano, recurso, permitido, limite_diario) values (p_plano, p_recurso, coalesce(p_permitido, false), p_limite)
    on conflict (plano, recurso) do update set permitido = excluded.permitido, limite_diario = excluded.limite_diario;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por)
    values (auth.uid(), 'recurso_editado:' || p_plano, jsonb_build_object('recurso', p_recurso, 'permitido', p_permitido, 'limite_diario', p_limite), public.admin_email_atual());
end $$;

create or replace function public.admin_uso(p_dias integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(x order by (x ->> 'total')::int desc), '[]'::jsonb) from (
    select jsonb_build_object('usuario_id', u.usuario_id, 'nome', coalesce(c.nome, c.email), 'email', c.email,
      'recurso', coalesce((select r.codigo from public.recursos_plano r where u.funcao = any (r.funcoes) order by cardinality(r.funcoes), r.codigo limit 1), 'outros'),
      'funcao', u.funcao, 'total', sum(u.contagem), 'hoje', sum(u.contagem) filter (where u.dia = current_date)) as x
    from public.uso_diario u left join public.clientes c on c.id = u.usuario_id
    where u.dia > current_date - least(greatest(coalesce(p_dias, 30), 1), 366)
    group by u.usuario_id, c.nome, c.email, u.funcao) s);
end $$;

create or replace function public.admin_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pendentes', (select count(*) from public.clientes where status = 'pendente'),
    'em_teste', (select count(*) from public.assinaturas a join public.clientes c on c.id = a.usuario_id where c.status = 'aprovado' and a.situacao = 'teste' and (a.teste_ate is null or a.teste_ate > now())),
    'ativas', (select count(*) from public.assinaturas a join public.clientes c on c.id = a.usuario_id where c.status = 'aprovado' and a.situacao = 'ativa' and (a.vence_em is null or a.vence_em + 5 >= public.hoje_brasilia())),
    'suspensas', (select count(*) from public.assinaturas where situacao = 'suspensa'),
    'por_plano', (select coalesce(jsonb_object_agg(plano, n), '{}'::jsonb) from (select plano, count(*) n from public.assinaturas group by plano) s),
    'avisos', (select coalesce(jsonb_agg(x order by x ->> 'quando'), '[]'::jsonb) from (
      select jsonb_build_object('tipo', 'teste_vencendo', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', a.teste_ate) x
        from public.assinaturas a join public.clientes c on c.id = a.usuario_id
        where a.situacao = 'teste' and a.teste_ate between now() and now() + interval '3 days'
      union all
      select jsonb_build_object('tipo', 'teste_vencido', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', a.teste_ate)
        from public.assinaturas a join public.clientes c on c.id = a.usuario_id
        where a.situacao = 'teste' and a.teste_ate < now() and a.teste_ate > now() - interval '30 days'
      union all
      select jsonb_build_object('tipo', 'vencida', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', a.vence_em)
        from public.assinaturas a join public.clientes c on c.id = a.usuario_id where a.situacao = 'ativa' and a.vence_em < public.hoje_brasilia()
      union all
      select jsonb_build_object('tipo', 'plano_solicitado', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', a.plano_solicitado_em, 'plano', a.plano_solicitado)
        from public.assinaturas a join public.clientes c on c.id = a.usuario_id where a.plano_solicitado is not null
      union all
      select jsonb_build_object('tipo', 'pendente', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', c.criado_em)
        from public.clientes c where c.status = 'pendente' and c.criado_em < now() - interval '24 hours'
      union all
      select jsonb_build_object('tipo', 'pedido_aguardando', 'usuario_id', p.usuario_id, 'nome', coalesce(c.nome, c.email), 'quando', p.criado_em, 'plano', p.plano)
        from public.pedidos p join public.clientes c on c.id = p.usuario_id where p.situacao = 'aguardando'
      union all
      select jsonb_build_object('tipo', 'pagamento_pendente', 'usuario_id', g.usuario_id, 'nome', coalesce(g.cliente_email, ''), 'quando', g.vencimento)
        from public.pagamentos g where g.situacao = 'pendente') s));
end $$;

-- Financeiro (preparado, sem gateway). Registrar cobrança manual; se já recebida, confirma na mesma chamada.
create or replace function public.admin_registrar_pagamento(p_usuario uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g uuid; v_plano text; v_ciclo text; v_valor integer;
begin
  if not public.admin_planos_autorizado() then raise exception 'Financeiro exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  v_plano := coalesce(p_dados ->> 'plano', (select plano from public.assinaturas where usuario_id = p_usuario));
  v_ciclo := coalesce(p_dados ->> 'ciclo', 'mensal');
  v_valor := coalesce((p_dados ->> 'valor_centavos')::integer,
    (select case v_ciclo when 'anual' then preco_anual_centavos when 'semestral' then preco_semestral_centavos else preco_mensal_centavos end from public.planos where codigo = v_plano));
  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor'; end if;
  insert into public.pagamentos (usuario_id, cliente_email, plano, ciclo, valor_centavos, metodo, vencimento, referencia, gateway, observacoes, criado_por)
    values (p_usuario, (select email from public.clientes where id = p_usuario), v_plano, v_ciclo, v_valor,
      coalesce(p_dados ->> 'metodo', 'pix'), coalesce((p_dados ->> 'vencimento')::date, public.hoje_brasilia()), p_dados ->> 'referencia', 'pix_manual',
      p_dados ->> 'observacoes', public.admin_email_atual())
    returning id into g;
  if coalesce((p_dados ->> 'pago')::boolean, false) then
    return public.aplicar_pagamento_confirmado(g, public.admin_email_atual());
  end if;
  return jsonb_build_object('pagamento', g);
end $$;

create or replace function public.admin_atualizar_pagamento(p_pagamento uuid, p_situacao text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Financeiro exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  if p_situacao = 'pago' then return public.aplicar_pagamento_confirmado(p_pagamento, public.admin_email_atual()); end if;
  if p_situacao not in ('cancelado', 'estornado', 'vencido') then raise exception 'Situação inválida'; end if;
  update public.pagamentos set situacao = p_situacao where id = p_pagamento and situacao in ('pendente', 'pago');
  if not found then raise exception 'Pagamento não encontrado ou já encerrado'; end if;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por)
    select usuario_id, 'pagamento_' || p_situacao, jsonb_build_object('pagamento', id), public.admin_email_atual() from public.pagamentos where id = p_pagamento;
  return jsonb_build_object('pagamento', p_pagamento, 'situacao', p_situacao);
end $$;

create or replace function public.admin_listar_pagamentos(p_usuario uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Financeiro exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object('nome', c.nome) order by g.criado_em desc), '[]'::jsonb)
    from public.pagamentos g left join public.clientes c on c.id = g.usuario_id where p_usuario is null or g.usuario_id = p_usuario);
end $$;

create or replace function public.admin_historico_assinatura(p_usuario uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_aprovar_cadastros() then raise exception 'Acesso restrito à administração' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('acao', acao, 'depois', depois, 'feito_por', feito_por, 'feito_em', feito_em) order by feito_em desc), '[]'::jsonb)
    from (select * from public.assinaturas_historico where usuario_id = p_usuario order by feito_em desc limit 100) h);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9) Pedido de compra e pagamento manual por Pix (22/11). Cliente pede (pedir_assinatura); o dono libera, recusa ou
--    pede correção (admin_decidir_pedido, 2 fatores). Liberar = pagamento manual/pix confirmado pelo ponto único
--    aplicar_pagamento_confirmado (vence_em em 1, 6 ou 12 meses; renovação soma ao vencimento atual).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.preco_extra_no_ciclo(p_codigo text, p_ciclo text) returns integer
language sql stable security definer set search_path = public as $$
  select case p_ciclo when 'mensal' then preco_mensal_centavos when 'semestral' then preco_semestral_centavos
    when 'anual' then preco_anual_centavos end from public.precos_extras where codigo = p_codigo;
$$;
-- Valor do pedido em centavos. Lance assistido e Pacote Operação: por CNPJ (do plano + extras). Vazio = combinação inválida.
create or replace function public.valor_do_pedido(p_plano text, p_ciclo text, p_extras text[], p_cnpjs_extras integer) returns integer
language sql stable security definer set search_path = public as $$
  select p.preco + coalesce(p_cnpjs_extras, 0) * public.preco_extra_no_ciclo('cnpj_extra', p_ciclo)
    + coalesce((select sum(public.preco_extra_no_ciclo(e.codigo, p_ciclo) * case when e.por_cnpj then p.cnpjs + coalesce(p_cnpjs_extras, 0) else 1 end)
        from public.precos_extras e where e.codigo = any (coalesce(p_extras, '{}'))), 0)::integer
  from (select case p_ciclo when 'mensal' then preco_mensal_centavos when 'semestral' then preco_semestral_centavos
      when 'anual' then preco_anual_centavos end as preco, coalesce(max_cnpjs, 1) as cnpjs
    from public.planos where codigo = p_plano) p;
$$;

create or replace function public.pedir_assinatura(p_plano text, p_ciclo text, p_extras text[] default '{}', p_cnpjs_extras integer default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_usuario uuid := auth.uid(); v_extras text[]; v_valor integer; g public.pedidos%rowtype;
begin
  if v_usuario is null then raise exception 'Sessão inválida' using errcode = '42501'; end if;
  if public.titular_do_usuario(v_usuario) <> v_usuario then raise exception 'Só o titular da conta pode assinar' using errcode = '42501'; end if;
  if not exists (select 1 from public.assinaturas where usuario_id = v_usuario) then raise exception 'Assinatura não encontrada'; end if;
  if not exists (select 1 from public.planos where codigo = p_plano and ativo and escolhivel_no_cadastro) then raise exception 'Plano indisponível'; end if;
  if p_ciclo is null or p_ciclo not in ('mensal', 'semestral', 'anual') then raise exception 'Escolha mensal, semestral ou anual'; end if;
  v_extras := array(select distinct x from unnest(coalesce(p_extras, '{}')) x order by x);
  if not v_extras <@ array['lance_assistido', 'pacote_operacao', 'ia_extra']::text[] then raise exception 'Extra inválido'; end if;
  if coalesce(p_cnpjs_extras, 0) not between 0 and 20 then raise exception 'Número de CNPJs extras inválido'; end if;
  if coalesce(p_cnpjs_extras, 0) > 0 and p_plano <> 'assessoria' then raise exception 'CNPJ extra é só na Assessoria'; end if;
  -- Contra clique repetido ou abuso: até 10 pedidos por dia por conta.
  if (select count(*) from public.pedidos where usuario_id = v_usuario and criado_em > now() - interval '1 day') >= 10 then
    raise exception 'Muitos pedidos hoje. Fale com a equipe.';
  end if;
  v_valor := public.valor_do_pedido(p_plano, p_ciclo, v_extras, coalesce(p_cnpjs_extras, 0));
  if v_valor is null or v_valor <= 0 then raise exception 'Preço do plano não cadastrado. Fale com a equipe.'; end if;
  -- Um pedido em aberto por conta: o novo substitui o anterior ainda não pago.
  update public.pedidos set situacao = 'cancelado', decidido_em = now(), decidido_por = 'cliente'
    where usuario_id = v_usuario and situacao in ('aguardando', 'correcao');
  insert into public.pedidos (usuario_id, plano, ciclo, extras, cnpjs_extras, valor_centavos)
    values (v_usuario, p_plano, p_ciclo, v_extras, coalesce(p_cnpjs_extras, 0), v_valor) returning * into g;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por) values (v_usuario, 'pedido_criado', to_jsonb(g), 'cliente');
  return to_jsonb(g);
end $$;
revoke all on function public.valor_do_pedido(text, text, text[], integer), public.preco_extra_no_ciclo(text, text) from public, anon;
grant execute on function public.valor_do_pedido(text, text, text[], integer), public.preco_extra_no_ciclo(text, text) to authenticated;
revoke all on function public.pedir_assinatura(text, text, text[], integer) from public, anon;
grant execute on function public.pedir_assinatura(text, text, text[], integer) to authenticated;

-- Dono decide: 'liberar' (Recebi o Pix), 'recusar' ou 'correcao' (os dois com motivo, que o cliente vê).
create or replace function public.admin_decidir_pedido(p_pedido uuid, p_acao text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.pedidos%rowtype; p public.planos%rowtype; v_plano_antes text; v_pag uuid; v jsonb; v_venc date;
begin
  if not public.admin_planos_autorizado() then raise exception 'Liberar pedido exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  if p_acao is null or p_acao not in ('liberar', 'recusar', 'correcao') then raise exception 'Ação inválida'; end if;
  select * into g from public.pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if g.situacao not in ('aguardando', 'correcao') then raise exception 'Este pedido já foi %', g.situacao; end if;
  if p_acao <> 'liberar' then
    if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo para o cliente'; end if;
    update public.pedidos set situacao = case p_acao when 'recusar' then 'recusado' else 'correcao' end, motivo = left(trim(p_motivo), 500),
      decidido_em = now(), decidido_por = public.admin_email_atual() where id = g.id returning * into g;
    insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por) values (g.usuario_id, 'pedido_' || g.situacao, to_jsonb(g), public.admin_email_atual());
    return to_jsonb(g);
  end if;
  select * into p from public.planos where codigo = g.plano;
  select plano into v_plano_antes from public.assinaturas where usuario_id = g.usuario_id;
  insert into public.pagamentos (usuario_id, cliente_email, plano, ciclo, valor_centavos, metodo, vencimento, referencia, gateway, observacoes, criado_por)
    values (g.usuario_id, (select email from public.clientes where id = g.usuario_id), g.plano, g.ciclo, g.valor_centavos, 'pix', public.hoje_brasilia(),
      'Pedido ' || left(g.id::text, 8), 'pix_manual', 'Pix manual conferido pelo dono', public.admin_email_atual())
    returning id into v_pag;
  v := public.aplicar_pagamento_confirmado(v_pag, public.admin_email_atual());
  v_venc := (v ->> 'vence_em')::date;
  -- O pedido define a assinatura inteira: extras, CNPJs a mais e IA extra até o fim do período pago. Sem CNPJ extra,
  -- um ajuste manual do dono continua, a não ser que o plano mude (aí volta ao do plano).
  update public.assinaturas set extras = array_remove(g.extras, 'ia_extra'),
    max_cnpjs = case when g.cnpjs_extras > 0 then coalesce(p.max_cnpjs, 1) + g.cnpjs_extras
      when v_plano_antes is distinct from g.plano then null else max_cnpjs end,
    ia_extra_usos = case when 'ia_extra' = any (g.extras) then 500 else ia_extra_usos end,
    ia_extra_mes = case when 'ia_extra' = any (g.extras) then date_trunc('month', current_date)::date else ia_extra_mes end,
    ia_extra_ate = case when 'ia_extra' = any (g.extras) then v_venc end,
    gateway = 'pix_manual'
    where usuario_id = g.usuario_id;
  update public.pedidos set situacao = 'liberado', pagamento_id = v_pag, decidido_em = now(), decidido_por = public.admin_email_atual()
    where id = g.id returning * into g;
  insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por) values (g.usuario_id, 'pedido_liberado', to_jsonb(g), public.admin_email_atual());
  return to_jsonb(g) || jsonb_build_object('vence_em', v_venc);
end $$;

-- Pedidos (os em aberto primeiro) e assinaturas que vencem nos próximos 7 dias, para o dono cobrar a renovação.
create or replace function public.admin_listar_pedidos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Financeiro exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pedidos', (select coalesce(jsonb_agg(x order by (x ->> 'situacao') not in ('aguardando', 'correcao'), x ->> 'criado_em' desc), '[]'::jsonb) from (
      select to_jsonb(g) || jsonb_build_object('nome', c.nome, 'email', c.email, 'telefone', c.telefone,
        'empresa', coalesce((select e.razao_social from public.operacao_organizacoes o join public.operacao_empresas e on e.organizacao_id = o.id and e.ativo
          where o.owner_id = g.usuario_id order by e.criado_em limit 1), c.empresa),
        'cnpj', coalesce((select e.cnpj from public.operacao_organizacoes o join public.operacao_empresas e on e.organizacao_id = o.id and e.ativo
          where o.owner_id = g.usuario_id and e.cnpj is not null order by e.criado_em limit 1), c.cnpj),
        'plano_nome', (select nome from public.planos where codigo = g.plano)) as x
      from (select * from public.pedidos order by criado_em desc limit 300) g left join public.clientes c on c.id = g.usuario_id) s),
    'vencendo', (select coalesce(jsonb_agg(jsonb_build_object('usuario_id', a.usuario_id, 'nome', c.nome, 'email', c.email, 'telefone', c.telefone,
        'empresa', c.empresa, 'plano', a.plano, 'plano_nome', p.nome, 'ciclo', a.ciclo, 'valor_centavos', a.valor_centavos, 'vence_em', a.vence_em) order by a.vence_em), '[]'::jsonb)
      from public.assinaturas a join public.clientes c on c.id = a.usuario_id left join public.planos p on p.codigo = a.plano
      where a.situacao = 'ativa' and a.vence_em between public.hoje_brasilia() and public.hoje_brasilia() + 7));
end $$;
-- ---------------------------------------------------------------------------------------------------------------
-- 10) Cobrança (22/11): o dono acompanha todo dia no admin (aba Cobrança). Vencendo em 7 dias, vence hoje, em atraso
--     (na carência) e bloqueados; totais do mês; "Recebi: renovar" usa o mesmo caminho da liberação de pedido.
--     O robô diário (scripts/cobranca_diaria.py) marca como vencida quem passou da carência e manda os lembretes.
-- ---------------------------------------------------------------------------------------------------------------
-- Valor de referência da conta: o último pago (valor_centavos) ou, sem ele, o preço do plano no ciclo.
create or replace function public.valor_cobranca(a public.assinaturas) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(a.valor_centavos, (select case coalesce(a.ciclo, 'mensal') when 'anual' then preco_anual_centavos
    when 'semestral' then preco_semestral_centavos else preco_mensal_centavos end from public.planos where codigo = a.plano))
$$;
revoke all on function public.valor_cobranca(public.assinaturas) from public, anon, authenticated;

create or replace function public.admin_cobranca() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_car integer := public.carencia_cobranca(); v_mes date := date_trunc('month', public.hoje_brasilia())::date; v jsonb;
begin
  if not public.admin_planos_autorizado() then raise exception 'Cobrança exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  with contas as (
      select a.usuario_id, c.nome, c.email, c.telefone, c.empresa, a.plano, p.nome as plano_nome, a.ciclo,
        public.valor_cobranca(a) as valor_centavos, a.vence_em, a.situacao, public.hoje_brasilia() - a.vence_em as dias_atraso,
        a.vence_em + v_car as carencia_ate,
        case when a.situacao = 'vencida' or a.vence_em + v_car < public.hoje_brasilia() then 'bloqueado'
          when a.vence_em = public.hoje_brasilia() then 'vence_hoje'
          when a.vence_em > public.hoje_brasilia() and a.vence_em <= public.hoje_brasilia() + 7 then 'vencendo'
          when a.vence_em < public.hoje_brasilia() then 'em_atraso' end as grupo
      from public.assinaturas a join public.clientes c on c.id = a.usuario_id left join public.planos p on p.codigo = a.plano
      where a.situacao in ('ativa', 'vencida') and a.vence_em is not null and not public.eh_owner_admin_operacao(a.usuario_id))
  select jsonb_build_object('carencia_dias', v_car, 'hoje', public.hoje_brasilia(),
      'vencendo', (select coalesce(jsonb_agg(to_jsonb(x) order by x.vence_em), '[]') from contas x where x.grupo = 'vencendo'),
      'vence_hoje', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nome), '[]') from contas x where x.grupo = 'vence_hoje'),
      'em_atraso', (select coalesce(jsonb_agg(to_jsonb(x) order by x.vence_em), '[]') from contas x where x.grupo = 'em_atraso'),
      'bloqueados', (select coalesce(jsonb_agg(to_jsonb(x) order by x.vence_em desc), '[]') from contas x where x.grupo = 'bloqueado'),
      -- A receber: vence de hoje até o fim do mês. Em atraso: na carência ou bloqueado por falta de pagamento.
      'a_receber_centavos', (select coalesce(sum(x.valor_centavos), 0) from contas x where x.vence_em >= public.hoje_brasilia()
        and x.vence_em < (v_mes + interval '1 month')::date),
      'recebido_centavos', (select coalesce(sum(g.valor_centavos), 0) from public.pagamentos g where g.situacao = 'pago'
        and g.pago_em >= v_mes and g.pago_em < v_mes + interval '1 month'),
      'em_atraso_centavos', (select coalesce(sum(x.valor_centavos), 0) from contas x where x.grupo in ('em_atraso', 'bloqueado')))
    into v from (select 1) um;
  return v;
end $$;

create or replace function public.admin_definir_carencia(p_dias integer) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Cobrança exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  if p_dias is null or p_dias < 0 or p_dias > 30 then raise exception 'A carência vai de 0 a 30 dias'; end if;
  update public.config_cobranca set carencia_dias = p_dias, atualizado_em = now(), atualizado_por = public.admin_email_atual() where id = 1;
  return p_dias;
end $$;

-- "Recebi: renovar": com pedido em aberto, libera o pedido (extras e ciclo dele); sem pedido, renova o mesmo plano,
-- ciclo e valor pelo ponto único aplicar_pagamento_confirmado (atraso ou bloqueado renova a partir de hoje).
create or replace function public.admin_renovar_assinatura(p_usuario uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.assinaturas%rowtype; v_pedido uuid; v_pag uuid; v_valor integer;
begin
  if not public.admin_planos_autorizado() then raise exception 'Renovar exige o proprietário com 2 fatores' using errcode = '42501'; end if;
  select id into v_pedido from public.pedidos where usuario_id = p_usuario and situacao in ('aguardando', 'correcao') order by criado_em desc limit 1;
  if v_pedido is not null then return public.admin_decidir_pedido(v_pedido, 'liberar'); end if;
  select * into a from public.assinaturas where usuario_id = p_usuario;
  if not found or a.situacao not in ('ativa', 'vencida') then raise exception 'Conta sem assinatura paga para renovar'; end if;
  v_valor := public.valor_cobranca(a);
  if coalesce(v_valor, 0) <= 0 then raise exception 'Conta sem valor de cobrança'; end if;
  insert into public.pagamentos (usuario_id, cliente_email, plano, ciclo, valor_centavos, metodo, vencimento, referencia, gateway, observacoes, criado_por)
    values (a.usuario_id, (select email from public.clientes where id = a.usuario_id), a.plano, coalesce(a.ciclo, 'mensal'), v_valor, 'pix',
      public.hoje_brasilia(), 'Renovação', 'pix_manual', 'Renovação conferida pelo dono (Cobrança)', public.admin_email_atual())
    returning id into v_pag;
  return public.aplicar_pagamento_confirmado(v_pag, public.admin_email_atual());
end $$;
revoke all on function public.admin_cobranca(), public.admin_definir_carencia(integer), public.admin_renovar_assinatura(uuid) from public, anon;
grant execute on function public.admin_cobranca(), public.admin_definir_carencia(integer), public.admin_renovar_assinatura(uuid) to authenticated;

-- Robô diário (chave de serviço): marca "vencida" quem passou da carência e devolve quem recebe lembrete hoje
-- (vence em 3 dias, vence hoje, bloqueado agora). Rodar duas vezes no dia não bloqueia nem lista o bloqueio de novo.
create or replace function public.cobranca_rodar_diario() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_car integer := public.carencia_cobranca(); v_bloq jsonb;
begin
  with b as (
    update public.assinaturas a set situacao = 'vencida', atualizado_em = now(), atualizado_por = 'robo-cobranca'
      where a.situacao = 'ativa' and a.vence_em is not null and a.vence_em + v_car < public.hoje_brasilia()
        and not public.eh_owner_admin_operacao(a.usuario_id)
      returning a.*),
  h as (insert into public.assinaturas_historico (usuario_id, acao, depois, feito_por)
      select b.usuario_id, 'bloqueio_por_atraso', jsonb_build_object('vence_em', b.vence_em, 'carencia_dias', v_car), 'robo-cobranca' from b returning 1)
  select coalesce(jsonb_agg(jsonb_build_object('usuario_id', b.usuario_id, 'email', c.email, 'nome', c.nome, 'plano_nome', p.nome,
      'valor_centavos', public.valor_cobranca(b), 'vence_em', b.vence_em, 'tipo', 'bloqueado')), '[]') into v_bloq
    from b join public.clientes c on c.id = b.usuario_id left join public.planos p on p.codigo = b.plano;
  return jsonb_build_object('carencia_dias', v_car, 'bloqueados', v_bloq,
    'lembretes', (select coalesce(jsonb_agg(jsonb_build_object('usuario_id', a.usuario_id, 'email', c.email, 'nome', c.nome, 'plano_nome', p.nome,
        'valor_centavos', public.valor_cobranca(a), 'vence_em', a.vence_em, 'carencia_ate', a.vence_em + v_car,
        'tipo', case when a.vence_em = public.hoje_brasilia() then 'vence_hoje' else 'vence_em_3_dias' end)), '[]')
      from public.assinaturas a join public.clientes c on c.id = a.usuario_id left join public.planos p on p.codigo = a.plano
      where a.situacao = 'ativa' and a.vence_em in (public.hoje_brasilia(), public.hoje_brasilia() + 3) and not public.eh_owner_admin_operacao(a.usuario_id)));
end $$;
revoke all on function public.cobranca_rodar_diario() from public, anon, authenticated;
grant execute on function public.cobranca_rodar_diario() to service_role;

revoke all on function public.admin_decidir_pedido(uuid, text, text), public.admin_listar_pedidos() from public, anon;
grant execute on function public.admin_decidir_pedido(uuid, text, text), public.admin_listar_pedidos() to authenticated;

revoke all on function public.admin_email_atual(), public.admin_listar_contas(), public.admin_empresas_da_conta(uuid),
  public.admin_definir_status_cliente(uuid, text), public.admin_definir_assinatura(uuid, jsonb), public.admin_salvar_plano(text, jsonb),
  public.admin_salvar_plano_recurso(text, text, boolean, integer), public.admin_uso(integer), public.admin_resumo(),
  public.admin_registrar_pagamento(uuid, jsonb), public.admin_atualizar_pagamento(uuid, text), public.admin_listar_pagamentos(uuid),
  public.admin_historico_assinatura(uuid) from public, anon;
revoke all on function public.admin_email_atual() from authenticated;
grant execute on function public.admin_listar_contas(), public.admin_empresas_da_conta(uuid),
  public.admin_definir_status_cliente(uuid, text), public.admin_definir_assinatura(uuid, jsonb), public.admin_salvar_plano(text, jsonb),
  public.admin_salvar_plano_recurso(text, text, boolean, integer), public.admin_uso(integer), public.admin_resumo(),
  public.admin_registrar_pagamento(uuid, jsonb), public.admin_atualizar_pagamento(uuid, text), public.admin_listar_pagamentos(uuid),
  public.admin_historico_assinatura(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
