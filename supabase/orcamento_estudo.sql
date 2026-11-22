-- ============================================================================
-- LicitaPlena — estudo contínuo de quem ganha e quem perde em obra (Orçamentista, fase 2).
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente. Roda depois de pregoes_gravados.sql,
-- sinapi_todas_ufs.sql (cliente_aprovado()) e planos_e_recursos.sql (admin_planos_autorizado()).
--
-- 1) orcamento_estudo_disputas / _estatisticas: o robô semanal scripts/estudo_obras.js lê os dados abertos do
--    Compras.gov (repositório de propostas + compras do PNCP) e guarda uma linha por concorrência de obra concluída,
--    SEM CNPJ e SEM nome de empresa, e as estatísticas por UF, região, tipo de obra e faixa de valor. A tela do
--    Orçamentista mostra "o que costuma acontecer". Escrita: service_role. Leitura: cliente aprovado.
-- 2) Motivos de recusa (DESLIGADO por padrão): o motivo exato só aparece no chat do Compras.gov. Quando um cliente
--    grava o pregão pela extensão (modo "Gravar pregão", pregoes_gravados_mensagens), o texto PÚBLICO do agente de
--    contratação sobre a recusa pode ir, sem dado pessoal, para orcamento_motivos_recusa — só se:
--      a) o dono ligou (orcamento_motivos_config.ligado, pela RPC admin_ligar_motivos_recusa, com 2 fatores), e
--      b) quem gravou aceitou "Ajudar a melhorar o Auditor" (orcamento_motivos_consentimento), revogável a qualquer hora.
--    O robô tira CNPJ, CPF, e-mail, telefone e nomes de empresa antes de gravar; não guarda quem gravou nem o fornecedor.
--    Texto para a política de privacidade: docs/orcamento-obra/privacidade-motivos-recusa.md.
-- ============================================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.orcamento_estudo_disputas (
  id_compra text primary key check (id_compra ~ '^[0-9]{17}$'),
  uf text check (uf ~ '^[A-Z]{2}$'),
  tipo_obra text not null check (tipo_obra ~ '^[a-z_]{3,30}$'),
  faixa_valor text not null check (faixa_valor in ('ate_1mi', '1a5mi', '5a20mi', '20a100mi', 'acima_100mi')),
  valor_estimado numeric(16, 2) not null check (valor_estimado > 0),
  participantes integer not null check (participantes between 1 and 10000),
  vencedor_me_epp boolean,
  desconto_vencedor numeric(6, 2) not null check (desconto_vencedor between -10 and 70),
  recusadas_mais_baratas integer not null default 0 check (recusadas_mais_baratas >= 0),
  -- Desconto de cada proposta recusada mais barata que a vencedora (para a taxa de recusa por faixa).
  descontos_recusadas numeric(6, 2)[] not null default '{}',
  -- {"faixa": [propostas, recusadas]} com faixas de desconto 0a10, 10a20, 20a25, 25, 25a30, acima_30.
  propostas_por_faixa jsonb not null default '{}'::jsonb check (jsonb_typeof(propostas_por_faixa) = 'object'),
  -- Contagem por código de situacao_proposta (o MGI não publica dicionário: 2 = recusada, conferido no estudo).
  situacoes jsonb not null default '{}'::jsonb check (jsonb_typeof(situacoes) = 'object'),
  modo_disputa text check (modo_disputa is null or length(modo_disputa) <= 60),
  data_resultado date,
  fonte text not null check (fonte in ('comprasgov', 'amostra_20261122')),
  atualizado_em timestamptz not null default now()
);
create index if not exists orcamento_estudo_disputas_uf on public.orcamento_estudo_disputas (uf, tipo_obra);

-- recorte = "BR|*|*", "regiao:N|reforma|*", "uf:AM|reforma|1a5mi"...
create table if not exists public.orcamento_estudo_estatisticas (
  recorte text primary key check (recorte ~ '^(BR|regiao:[A-Z]{1,2}|uf:[A-Z]{2})\|[a-z_*]{1,30}\|[a-z0-9_*]{1,20}$'),
  n integer not null check (n >= 1),
  dados jsonb not null check (jsonb_typeof(dados) = 'object'),
  periodo_inicio date,
  periodo_fim date,
  atualizado_em timestamptz not null default now()
);

-- ---------- motivos de recusa (desligado por padrão) ----------
create table if not exists public.orcamento_motivos_config (
  id boolean primary key default true check (id),
  ligado boolean not null default false,
  alterado_por uuid references auth.users (id) on delete set null,
  alterado_em timestamptz
);
insert into public.orcamento_motivos_config (id, ligado) values (true, false) on conflict (id) do nothing;

create table if not exists public.orcamento_motivos_consentimento (
  usuario_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  -- Versão do texto que a pessoa leu ao aceitar (docs/orcamento-obra/privacidade-motivos-recusa.md).
  versao_texto text not null check (versao_texto ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  aceito_em timestamptz not null default now()
);

create table if not exists public.orcamento_motivos_recusa (
  -- md5 da mensagem de origem (pregoes_gravados_mensagens.chave): a mesma mensagem não entra duas vezes.
  chave text primary key check (chave ~ '^[0-9a-f]{32}$'),
  tipo text not null check (tipo in ('recusa', 'desclassificacao', 'inabilitacao')),
  categoria text not null check (categoria in ('prazo', 'cpu', 'encargos', 'bdi', 'inexequivel', 'preco_acima', 'planilha', 'habilitacao', 'documento', 'outro')),
  -- Texto público do agente de contratação, já sem CNPJ, CPF, e-mail, telefone e nome de empresa.
  motivo text not null check (length(motivo) between 5 and 1000 and motivo !~ '[0-9]{2}\.?[0-9]{3}\.?[0-9]{3}/?[0-9]{4}-?[0-9]{2}' and motivo !~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}' and motivo !~ '@'),
  tipo_obra text check (tipo_obra is null or tipo_obra ~ '^[a-z_]{3,30}$'),
  data date,
  coletado_em timestamptz not null default now()
);

alter table public.orcamento_estudo_disputas enable row level security;
alter table public.orcamento_estudo_estatisticas enable row level security;
alter table public.orcamento_motivos_config enable row level security;
alter table public.orcamento_motivos_consentimento enable row level security;
alter table public.orcamento_motivos_recusa enable row level security;
revoke all on public.orcamento_estudo_disputas, public.orcamento_estudo_estatisticas, public.orcamento_motivos_config,
  public.orcamento_motivos_consentimento, public.orcamento_motivos_recusa from anon, authenticated;
grant select on public.orcamento_estudo_disputas, public.orcamento_estudo_estatisticas, public.orcamento_motivos_config, public.orcamento_motivos_recusa to authenticated;
grant select, insert, delete on public.orcamento_motivos_consentimento to authenticated;
revoke truncate on public.orcamento_estudo_disputas, public.orcamento_estudo_estatisticas, public.orcamento_motivos_config,
  public.orcamento_motivos_consentimento, public.orcamento_motivos_recusa from service_role;
grant select, insert, update, delete on public.orcamento_estudo_disputas, public.orcamento_estudo_estatisticas, public.orcamento_motivos_recusa to service_role;
grant select on public.orcamento_motivos_config, public.orcamento_motivos_consentimento to service_role;

drop policy if exists orcamento_estudo_disputas_select_aprovado on public.orcamento_estudo_disputas;
create policy orcamento_estudo_disputas_select_aprovado on public.orcamento_estudo_disputas for select to authenticated using (public.cliente_aprovado());
drop policy if exists orcamento_estudo_estatisticas_select_aprovado on public.orcamento_estudo_estatisticas;
create policy orcamento_estudo_estatisticas_select_aprovado on public.orcamento_estudo_estatisticas for select to authenticated using (public.cliente_aprovado());
drop policy if exists orcamento_motivos_recusa_select_aprovado on public.orcamento_motivos_recusa;
create policy orcamento_motivos_recusa_select_aprovado on public.orcamento_motivos_recusa for select to authenticated using (public.cliente_aprovado());
drop policy if exists orcamento_motivos_config_select_autenticado on public.orcamento_motivos_config;
create policy orcamento_motivos_config_select_autenticado on public.orcamento_motivos_config for select to authenticated using (true);
-- Cada um vê, dá e retira só o próprio aceite; aceitar só com a coleta ligada pelo dono.
drop policy if exists orcamento_motivos_consentimento_select_proprio on public.orcamento_motivos_consentimento;
create policy orcamento_motivos_consentimento_select_proprio on public.orcamento_motivos_consentimento for select to authenticated using (usuario_id = auth.uid());
drop policy if exists orcamento_motivos_consentimento_insert_proprio on public.orcamento_motivos_consentimento;
create policy orcamento_motivos_consentimento_insert_proprio on public.orcamento_motivos_consentimento for insert to authenticated
  with check (usuario_id = auth.uid() and public.cliente_aprovado() and (select ligado from public.orcamento_motivos_config where id));
drop policy if exists orcamento_motivos_consentimento_delete_proprio on public.orcamento_motivos_consentimento;
create policy orcamento_motivos_consentimento_delete_proprio on public.orcamento_motivos_consentimento for delete to authenticated using (usuario_id = auth.uid());

-- Dono liga ou desliga a coleta. Desligar não apaga o que já foi coletado (já está sem dado pessoal).
create or replace function public.admin_ligar_motivos_recusa(p_ligado boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.admin_planos_autorizado() then raise exception 'Só o dono, com login de 2 fatores, liga a coleta.' using errcode = '42501'; end if;
  update orcamento_motivos_config set ligado = coalesce(p_ligado, false), alterado_por = auth.uid(), alterado_em = now() where id;
end $$;
revoke all on function public.admin_ligar_motivos_recusa(boolean) from public, anon;
grant execute on function public.admin_ligar_motivos_recusa(boolean) to authenticated;

-- Para o robô: mensagens de recusa ainda não coletadas, só de quem aceitou e só com a coleta ligada.
-- Devolve também a descrição do item (para saber se é obra) e os nomes dos participantes (para o robô apagar do texto).
create or replace function public.orcamento_motivos_para_coletar(p_limite integer default 500)
returns table (chave text, tipo text, texto text, motivo text, data_hora timestamp, descricao_item text, nomes text[])
language sql stable security definer set search_path = public, pg_temp as $$
  select m.chave, m.tipo, m.texto, m.motivo, m.data_hora,
         g.itens -> m.numero_item::text ->> 'descricao',
         array(select p.nome from pregoes_gravados_propostas p where p.id_compra = m.id_compra and p.nome is not null and p.nome <> 'Pessoa física')
  from pregoes_gravados_mensagens m
  join pregoes_gravados g on g.id_compra = m.id_compra
  where (select ligado from orcamento_motivos_config where id)
    and m.tipo in ('recusa', 'desclassificacao', 'inabilitacao')
    and not exists (select 1 from orcamento_motivos_recusa r where r.chave = m.chave)
    and exists (select 1 from pregoes_gravados_mensagens_leitores l join orcamento_motivos_consentimento c on c.usuario_id = l.gravado_por where l.chave = m.chave)
  order by m.gravado_em
  limit least(greatest(coalesce(p_limite, 500), 1), 2000)
$$;
revoke all on function public.orcamento_motivos_para_coletar(integer) from public, anon, authenticated;
grant execute on function public.orcamento_motivos_para_coletar(integer) to service_role;

commit;
