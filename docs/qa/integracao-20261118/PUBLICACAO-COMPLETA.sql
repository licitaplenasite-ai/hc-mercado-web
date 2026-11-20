-- LicitaPlena — PUBLICAÇÃO COMPLETA DO BANCO (gerado em 20/11/2026 a partir dos arquivos do repositório)
-- Ordem: 01-aplicar.sql + 36 arquivos novos. Todos idempotentes: se algo parar no meio, corrija e rode o arquivo inteiro de novo.
-- Ensaio: docs/qa/integracao-20261118/testar-dezembro.cjs (2 rodadas, 02-verificar 81/81). Depois de rodar, confira com 02-verificar.sql.
-- ANTES: backup do banco (Supabase → Database → Backups).

-- ========== 01-aplicar.sql ==========
-- 01-aplicar.sql — gerado por testar-aplicar.cjs --gerar em 2026-11-18. NÃO editar à mão.
-- Projeto Supabase lsqjamqvmrcyrvowndiu. Rodar inteiro no SQL Editor, uma vez, na janela combinada.
-- Junta, nesta ordem, os arquivos de supabase/ abaixo (SHA-256 do arquivo original, bytes brutos):
--   832158202ec9e57baf38d49a9a6761bbccd10fcce3fc77d85f83b0a3defead9e  identificacao_empresa.sql
--   49ccfae6c012a9826872806f5cb5d2e4cd75d29f23abb284fc79ca2ea30abb17  seguranca_operacao.sql
--   7b2ef8ed7676e45acd9708b56d95bb5b6d39ec44ecc54455d796daa2e148131f  kit_documentos.sql
--   f5a8da7bcfaca55e9a331b7c6b051ae778394467e12aa049af899399bba43d0a  kit_documentos_escala_proposta.sql
--   e0b1b44e0c3fd293bed63a3a85cc629007908044006b817d875b5f4199e672b9  importacao_item_pncp.sql
--   7b90ba129c59b38d46d46a881e6053ade549327a593a6da25555b74073b5e270  endurecer_rpc_servidor.sql
--   c309aec4e6d5ceb15a8055b7141cfa7f4b9bd4e902821091da9dd5193c9ef5fd  rls_e_limite_de_uso.sql
-- Ajustes feitos só aqui (os originais não mudam):
--   * begin;/commit; de cada arquivo removidos: tudo roda numa transação só (abaixo).
--   * importacao_item_pncp.sql: "drop policy if exists origem_pncp_leitura" antes do create policy.
--   * rls_e_limite_de_uso.sql: só o revoke de incrementar_uso e o grant da linha seguinte (service_role).
--   * lock_timeout/statement_timeout locais para não travar produção esperando lock.
-- Nenhum arquivo usa CREATE INDEX CONCURRENTLY, VACUUM ou outro comando proibido em transação.
-- Qualquer erro: nada fica gravado. Rode "rollback;" e pare (ver ROTEIRO-BANCO.md).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ===================== identificacao_empresa.sql =====================
-- Identificação conferida por empresa. Aplicação LOCAL; pode ser reaplicada.
-- Requer acesso_empresa_convites.sql. Não cria bucket; restringe a ACL da função interna de trigger.
-- (begin do arquivo original removido)
do $$ begin
 if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null or to_regprocedure('public.acesso_arquivo_operacao(text)') is null then raise exception 'Instale primeiro o isolamento por empresa'; end if;
 if not exists(select 1 from storage.buckets where id='operacao-documentos' and public=false) then raise exception 'Bucket privado obrigatório'; end if;
end $$;
create table if not exists public.operacao_identificacao_empresa(
 empresa_id uuid primary key, organizacao_id uuid not null,
 dados_confirmados jsonb not null, proveniencia jsonb not null default '[]',
 confirmado_por uuid not null references auth.users(id), confirmado_em timestamptz not null default now(),
 versao bigint not null default 1, invalidado_em timestamptz,
 foreign key(empresa_id,organizacao_id) references public.operacao_empresas(id,organizacao_id) on delete cascade,
 check(jsonb_typeof(dados_confirmados)='object'),check(jsonb_typeof(proveniencia)='array')
);
alter table public.operacao_identificacao_empresa enable row level security;
drop policy if exists identificacao_empresa_leitura on public.operacao_identificacao_empresa;
create policy identificacao_empresa_leitura on public.operacao_identificacao_empresa for select to authenticated using(public.pode_acessar_empresa_operacao(organizacao_id,empresa_id));
revoke all on public.operacao_identificacao_empresa from anon,authenticated;
grant select on public.operacao_identificacao_empresa to authenticated;
grant all on public.operacao_identificacao_empresa to service_role;
create or replace function public.invalidar_identificacao_empresa() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_TABLE_SCHEMA='storage' then
 update public.operacao_identificacao_empresa p set invalidado_em=now() where exists(select 1 from jsonb_array_elements(p.proveniencia) x where x->>'arquivoCaminho'=old.name);
 elsif TG_TABLE_NAME='operacao_empresas' then
 if old.razao_social is distinct from new.razao_social or old.cnpj is distinct from new.cnpj then update public.operacao_identificacao_empresa set invalidado_em=now() where empresa_id=old.id; end if;
 else
 update public.operacao_identificacao_empresa p set invalidado_em=now() where exists(select 1 from jsonb_array_elements(p.proveniencia) x where x->>'documentoId'=old.id::text);
 end if; return null;
end $$;
-- Função interna: os triggers executam sem conceder chamada direta aos papéis da aplicação.
revoke all on function public.invalidar_identificacao_empresa() from public,anon,authenticated,service_role;
drop trigger if exists identificacao_documento_alterado on public.operacao_documentos;
create trigger identificacao_documento_alterado after update or delete on public.operacao_documentos for each row execute function public.invalidar_identificacao_empresa();
drop trigger if exists identificacao_arquivo_alterado on storage.objects;
create trigger identificacao_arquivo_alterado after update or delete on storage.objects for each row when(old.bucket_id='operacao-documentos') execute function public.invalidar_identificacao_empresa();
drop trigger if exists identificacao_cadastro_alterado on public.operacao_empresas;
create trigger identificacao_cadastro_alterado after update on public.operacao_empresas for each row execute function public.invalidar_identificacao_empresa();
create or replace function public.confirmar_identificacao_empresa(p_empresa uuid,p_usuario uuid,p_razao text,p_cnpj text,p_dados jsonb,p_proveniencia jsonb) returns public.operacao_identificacao_empresa language plpgsql security definer set search_path=public as $$
declare e public.operacao_empresas; r public.operacao_identificacao_empresa; x jsonb;
begin
 select * into e from public.operacao_empresas where id=p_empresa for update;
 if e.id is null or not exists(select 1 from public.operacao_membros m where m.organizacao_id=e.organizacao_id and m.usuario_id=p_usuario and (m.empresa_id is null or m.empresa_id=e.id)) then raise exception 'Empresa indisponível'; end if;
 if e.razao_social<>p_razao or regexp_replace(e.cnpj,'\D','','g')<>regexp_replace(p_cnpj,'\D','','g') then raise exception 'Cadastro divergente'; end if;
 if jsonb_typeof(p_dados)<>'object' or (p_dados - array['endereco','representante','cargo'])<>'{}'::jsonb or jsonb_typeof(p_proveniencia)<>'array' or jsonb_array_length(p_proveniencia)>3 or (select count(distinct entrada.valor->>'documentoId') from jsonb_array_elements(p_proveniencia) as entrada(valor))>2 then raise exception 'Dados inválidos'; end if;
 if p_dados->>'endereco' is null or p_dados->>'representante' is null or p_dados->>'cargo' is null or length(trim(p_dados->>'endereco')) not between 1 and 500 or length(trim(p_dados->>'representante')) not between 1 and 180 or length(trim(p_dados->>'cargo')) not between 1 and 120 then raise exception 'Dados incompletos'; end if;
 for x in select * from jsonb_array_elements(p_proveniencia) loop
 if not exists(select 1 from public.operacao_documentos d where d.id=(x->>'documentoId')::uuid and d.empresa_id=e.id and d.organizacao_id=e.organizacao_id and d.arquivo_caminho=x->>'arquivoCaminho' and d.arquivo_caminho like e.organizacao_id::text||'/'||e.id::text||'/%') or coalesce(x->>'hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Documento inválido'; end if;
 end loop;
 insert into public.operacao_identificacao_empresa(empresa_id,organizacao_id,dados_confirmados,proveniencia,confirmado_por) values(e.id,e.organizacao_id,p_dados,p_proveniencia,p_usuario)
 on conflict(empresa_id) do update set dados_confirmados=excluded.dados_confirmados,proveniencia=excluded.proveniencia,confirmado_por=excluded.confirmado_por,confirmado_em=now(),invalidado_em=null,versao=operacao_identificacao_empresa.versao+1 returning * into r;
 return r;
end $$;
revoke all on function public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb) to service_role;
-- Gate de prontidão consultado com o JWT do usuário; ausência ou regressão fecha a rota.
create or replace function public.identificacao_empresa_habilitada() returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null
 and exists(select 1 from storage.buckets where id='operacao-documentos' and public=false)
 and (select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('operacao_empresas','operacao_documentos','operacao_identificacao_empresa') and c.relrowsecurity)
 and exists(select 1 from pg_policies where schemaname='public' and tablename='operacao_documentos' and policyname='operacao_documentos_da_empresa' and qual like '%pode_acessar_empresa_operacao%' and with_check like '%pode_acessar_empresa_operacao%')
 and not exists(select 1 from pg_policies where schemaname='public' and tablename='operacao_documentos' and policyname<>'operacao_documentos_da_empresa')
 and exists(select 1 from pg_policies where schemaname='public' and tablename='operacao_empresas' and policyname='operacao_empresas_leitura' and qual like '%pode_acessar_empresa_operacao%')
 and (select count(*)=4 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'operacao_arquivos_%' and coalesce(qual,with_check) like '%acesso_arquivo_operacao%')
 and not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname not in ('operacao_arquivos_atualizacao','operacao_arquivos_envio','operacao_arquivos_exclusao','operacao_arquivos_leitura'));
$$;
revoke all on function public.identificacao_empresa_habilitada() from public,anon;
grant execute on function public.identificacao_empresa_habilitada() to authenticated;
-- (commit do arquivo original removido)

-- Atualiza o cache local do PostgREST após criação da tabela/RPC.
notify pgrst, 'reload schema';

-- ===================== seguranca_operacao.sql =====================
-- Segurança operacional incremental e idempotente. Execute no SQL Editor após
-- acesso_empresa_convites.sql e identificacao_empresa.sql. Não apaga dados.
-- (begin do arquivo original removido)

create or replace function public.pode_escrever_org_operacao(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.operacao_membros m where m.organizacao_id=p_org
  and m.usuario_id=auth.uid() and m.empresa_id is null and m.papel in ('gestor','operador'));
$$;
create or replace function public.pode_escrever_empresa_operacao(p_org uuid,p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.operacao_empresas e join public.operacao_membros m on m.organizacao_id=e.organizacao_id
  where e.id=p_empresa and e.organizacao_id=p_org and m.usuario_id=auth.uid()
  and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id));
$$;
create or replace function public.pode_escrever_processo_operacao(p_org uuid,p_processo uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.operacao_processos p where p.id=p_processo and p.organizacao_id=p_org
  and public.pode_escrever_empresa_operacao(p.organizacao_id,p.empresa_id));
$$;
create or replace function public.arquivo_no_escopo_operacao(p_caminho text,p_org uuid,p_empresa uuid)
returns boolean language sql immutable set search_path = '' as $$
 select p_caminho is null or (p_caminho like p_org::text||'/'||p_empresa::text||'/%'
  and length(split_part(p_caminho,'/',3))>0);
$$;
create or replace function public.escrita_arquivo_operacao(p_caminho text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
 if coalesce(array_length(string_to_array(p_caminho,'/'),1),0)<3 or length(split_part(p_caminho,'/',3))=0 then return false; end if;
 return public.pode_escrever_empresa_operacao(split_part(p_caminho,'/',1)::uuid,split_part(p_caminho,'/',2)::uuid);
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.pode_escrever_org_operacao(uuid),public.pode_escrever_empresa_operacao(uuid,uuid),public.pode_escrever_processo_operacao(uuid,uuid),public.arquivo_no_escopo_operacao(text,uuid,uuid),public.escrita_arquivo_operacao(text) from public,anon;
grant execute on function public.pode_escrever_org_operacao(uuid),public.pode_escrever_empresa_operacao(uuid,uuid),public.pode_escrever_processo_operacao(uuid,uuid),public.arquivo_no_escopo_operacao(text,uuid,uuid),public.escrita_arquivo_operacao(text) to authenticated;
revoke all on function public.bootstrap_operacao(),public.eh_membro_operacao(uuid) from public,anon;
grant execute on function public.bootstrap_operacao(),public.eh_membro_operacao(uuid) to authenticated;

-- Sem migração silenciosa: relações/arquivos legados inconsistentes exigem revisão.
do $$ begin
 if exists(select 1 from public.operacao_documentos d join public.operacao_empresas e on e.id=d.empresa_id where d.organizacao_id<>e.organizacao_id or not public.arquivo_no_escopo_operacao(d.arquivo_caminho,d.organizacao_id,d.empresa_id))
 or exists(select 1 from public.operacao_processos p join public.operacao_empresas e on e.id=p.empresa_id where p.organizacao_id<>e.organizacao_id)
 or exists(select 1 from public.operacao_agenda a join public.operacao_empresas e on e.id=a.empresa_id where a.organizacao_id<>e.organizacao_id)
 or exists(select 1 from public.operacao_prazos_processo a join public.operacao_processos p on p.id=a.processo_id where a.organizacao_id<>p.organizacao_id)
 or exists(select 1 from public.operacao_empenhos a join public.operacao_processos p on p.id=a.processo_id where a.organizacao_id<>p.organizacao_id)
 or exists(select 1 from public.operacao_anexos_processo a join public.operacao_processos p on p.id=a.processo_id where a.organizacao_id<>p.organizacao_id or not public.arquivo_no_escopo_operacao(a.arquivo_caminho,p.organizacao_id,p.empresa_id))
 then raise exception 'Escopo legado inconsistente: revise organização, empresa e caminhos dos documentos/processos antes de aplicar a segurança'; end if;
end $$;

-- FKs compostas impedem vínculos cruzados também no backend que ignora RLS.
do $$ declare r record; begin
 for r in select * from (values
 ('operacao_documentos','empresa_id','operacao_empresas'),
 ('operacao_processos','empresa_id','operacao_empresas'),
 ('operacao_agenda','empresa_id','operacao_empresas'),
 ('operacao_prazos_processo','processo_id','operacao_processos'),
 ('operacao_empenhos','processo_id','operacao_processos')
 ) as t(tabela,coluna,pai) loop
 if not exists(select 1 from pg_constraint where conrelid=('public.'||r.tabela)::regclass and conname=r.tabela||'_escopo_fk') then
 execute format('alter table public.%I add constraint %I foreign key (%I,organizacao_id) references public.%I(id,organizacao_id) on delete cascade',r.tabela,r.tabela||'_escopo_fk',r.coluna,r.pai);
 end if;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.operacao_documentos'::regclass and conname='operacao_documentos_arquivo_escopo') then
 alter table public.operacao_documentos add constraint operacao_documentos_arquivo_escopo check(public.arquivo_no_escopo_operacao(arquivo_caminho,organizacao_id,empresa_id));
 end if;
end $$;
grant execute on function public.arquivo_no_escopo_operacao(text,uuid,uuid) to service_role;

-- Transferir um grafo com arquivos exige uma operação própria, ainda inexistente.
create or replace function public.preservar_escopo_operacao()
returns trigger language plpgsql set search_path = '' as $$
begin
 if old.organizacao_id is distinct from new.organizacao_id or old.empresa_id is distinct from new.empresa_id then
 raise exception 'Escopo não pode ser transferido; crie um novo documento ou processo no CNPJ correto';
 end if;
 return new;
end $$;
drop trigger if exists preservar_escopo_operacao on public.operacao_documentos;
create trigger preservar_escopo_operacao before update on public.operacao_documentos for each row execute function public.preservar_escopo_operacao();
drop trigger if exists preservar_escopo_operacao on public.operacao_processos;
create trigger preservar_escopo_operacao before update on public.operacao_processos for each row execute function public.preservar_escopo_operacao();

create or replace function public.validar_arquivo_processo_operacao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.operacao_processos p where p.id=new.processo_id and p.organizacao_id=new.organizacao_id and public.arquivo_no_escopo_operacao(new.arquivo_caminho,p.organizacao_id,p.empresa_id)) then
 raise exception 'Arquivo fora do escopo do processo';
 end if;
 return new;
end $$;
revoke all on function public.preservar_escopo_operacao(),public.validar_arquivo_processo_operacao() from public,anon,authenticated,service_role;
drop trigger if exists validar_arquivo_processo_operacao on public.operacao_anexos_processo;
create trigger validar_arquivo_processo_operacao before insert or update on public.operacao_anexos_processo for each row execute function public.validar_arquivo_processo_operacao();

-- SELECT conserva o acesso existente. Escrita exige papel e o mesmo escopo.
drop policy if exists operacao_empresas_escrita on public.operacao_empresas;
create policy operacao_empresas_escrita on public.operacao_empresas for all to authenticated
 using(public.pode_escrever_org_operacao(organizacao_id)) with check(public.pode_escrever_org_operacao(organizacao_id));
drop policy if exists operacao_tipos_escrita on public.operacao_tipos_documento;
create policy operacao_tipos_escrita on public.operacao_tipos_documento for all to authenticated
 using(organizacao_id is not null and public.pode_escrever_org_operacao(organizacao_id))
 with check(organizacao_id is not null and public.pode_escrever_org_operacao(organizacao_id));

-- Substitui todas as policies amplas conhecidas; não afeta tabelas públicas/robô.
do $$
declare r record; leitura text; escrita text; checagem text;
begin
 for r in select * from (values
  ('operacao_documentos','operacao_documentos_da_empresa','empresa'),
  ('operacao_agenda','operacao_agenda_da_empresa','empresa'),
  ('operacao_processos','operacao_processos_da_empresa','empresa'),
  ('operacao_prazos_processo','operacao_prazos_da_empresa','processo'),
  ('operacao_empenhos','operacao_empenhos_da_empresa','processo'),
  ('operacao_itens_resultado','operacao_itens_da_empresa','processo'),
  ('operacao_ocorrencias','operacao_ocorrencias_da_empresa','processo'),
  ('operacao_contratos','operacao_contratos_da_empresa','processo'),
  ('operacao_anexos_processo','operacao_anexos_da_empresa','processo'),
  ('operacao_renovacoes_documento','operacao_renovacoes_da_empresa','documento')
 ) as t(tabela,politica,escopo) loop
  if r.escopo='documento' then
   leitura='exists(select 1 from public.operacao_documentos d where d.id=documento_id and public.pode_acessar_empresa_operacao(d.organizacao_id,d.empresa_id))';
   escrita=replace(leitura,'pode_acessar_empresa_operacao','pode_escrever_empresa_operacao');
  else
   leitura=format('public.pode_acessar_%s_operacao(organizacao_id,%I)',r.escopo,r.escopo||'_id');
   escrita=replace(leitura,'pode_acessar_','pode_escrever_');
  end if;
  checagem=escrita;
  if r.tabela='operacao_documentos' then
   checagem=checagem||' and public.arquivo_no_escopo_operacao(arquivo_caminho,organizacao_id,empresa_id)';
  elsif r.tabela='operacao_anexos_processo' then
   checagem=checagem||' and exists(select 1 from public.operacao_processos p where p.id=processo_id and p.organizacao_id=operacao_anexos_processo.organizacao_id and public.arquivo_no_escopo_operacao(arquivo_caminho,p.organizacao_id,p.empresa_id))';
  end if;
  execute format('drop policy if exists %I on public.%I',r.politica,r.tabela);
  execute format('drop policy if exists %I on public.%I',r.politica||'_escrita',r.tabela);
  execute format('create policy %I on public.%I for select to authenticated using (%s)',r.politica,r.tabela,leitura);
  execute format('create policy %I on public.%I for all to authenticated using (%s) with check (%s)',r.politica||'_escrita',r.tabela,escrita,checagem);
 end loop;
end $$;
drop policy if exists operacao_arquivos_envio on storage.objects;
drop policy if exists operacao_arquivos_atualizacao on storage.objects;
drop policy if exists operacao_arquivos_exclusao on storage.objects;
create policy operacao_arquivos_envio on storage.objects for insert to authenticated
 with check(bucket_id='operacao-documentos' and public.escrita_arquivo_operacao(name));
create policy operacao_arquivos_atualizacao on storage.objects for update to authenticated
 using(bucket_id='operacao-documentos' and public.escrita_arquivo_operacao(name))
 with check(bucket_id='operacao-documentos' and public.escrita_arquivo_operacao(name));
create policy operacao_arquivos_exclusao on storage.objects for delete to authenticated
 using(bucket_id='operacao-documentos' and public.escrita_arquivo_operacao(name));

-- O backend informa o usuário: validar seu papel também ao ignorar RLS.
create or replace function public.confirmar_identificacao_empresa(p_empresa uuid,p_usuario uuid,p_razao text,p_cnpj text,p_dados jsonb,p_proveniencia jsonb) returns public.operacao_identificacao_empresa language plpgsql security definer set search_path=public as $$
declare e public.operacao_empresas; r public.operacao_identificacao_empresa; x jsonb;
begin
 select * into e from public.operacao_empresas where id=p_empresa for update;
 if e.id is null or not exists(select 1 from public.operacao_membros m where m.organizacao_id=e.organizacao_id and m.usuario_id=p_usuario and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)) then raise exception 'Empresa indisponível'; end if;
 if e.razao_social<>p_razao or regexp_replace(e.cnpj,'\D','','g')<>regexp_replace(p_cnpj,'\D','','g') then raise exception 'Cadastro divergente'; end if;
 if jsonb_typeof(p_dados)<>'object' or (p_dados - array['endereco','representante','cargo'])<>'{}'::jsonb or jsonb_typeof(p_proveniencia)<>'array' or jsonb_array_length(p_proveniencia)>3 or (select count(distinct entrada.valor->>'documentoId') from jsonb_array_elements(p_proveniencia) as entrada(valor))>2 then raise exception 'Dados inválidos'; end if;
 if p_dados->>'endereco' is null or p_dados->>'representante' is null or p_dados->>'cargo' is null or length(trim(p_dados->>'endereco')) not between 1 and 500 or length(trim(p_dados->>'representante')) not between 1 and 180 or length(trim(p_dados->>'cargo')) not between 1 and 120 then raise exception 'Dados incompletos'; end if;
 for x in select * from jsonb_array_elements(p_proveniencia) loop
 if not exists(select 1 from public.operacao_documentos d where d.id=(x->>'documentoId')::uuid and d.empresa_id=e.id and d.organizacao_id=e.organizacao_id and d.arquivo_caminho=x->>'arquivoCaminho' and d.arquivo_caminho like e.organizacao_id::text||'/'||e.id::text||'/%') or coalesce(x->>'hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Documento inválido'; end if;
 end loop;
 insert into public.operacao_identificacao_empresa(empresa_id,organizacao_id,dados_confirmados,proveniencia,confirmado_por) values(e.id,e.organizacao_id,p_dados,p_proveniencia,p_usuario)
 on conflict(empresa_id) do update set dados_confirmados=excluded.dados_confirmados,proveniencia=excluded.proveniencia,confirmado_por=excluded.confirmado_por,confirmado_em=now(),invalidado_em=null,versao=operacao_identificacao_empresa.versao+1 returning * into r;
 return r;
end $$;
revoke all on function public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb) to service_role;


-- Prontidão: definições esperadas, e não só a presença dos nomes das policies.
-- Qualquer policy adicional nas tabelas protegidas fecha o gate.
create or replace function public.identificacao_empresa_habilitada()
returns boolean language sql stable security definer set search_path = public as $$
 with esperado(tabela,nome,comando,qual,checagem) as (values
 ('operacao_empresas','operacao_empresas_leitura','SELECT','pode_acessar_empresa_operacao(organizacao_id, id)',null),
 ('operacao_empresas','operacao_empresas_escrita','ALL','pode_escrever_org_operacao(organizacao_id)','pode_escrever_org_operacao(organizacao_id)'),
 ('operacao_documentos','operacao_documentos_da_empresa','SELECT','pode_acessar_empresa_operacao(organizacao_id, empresa_id)',null),
 ('operacao_documentos','operacao_documentos_da_empresa_escrita','ALL','pode_escrever_empresa_operacao(organizacao_id, empresa_id)','(pode_escrever_empresa_operacao(organizacao_id, empresa_id) AND arquivo_no_escopo_operacao(arquivo_caminho, organizacao_id, empresa_id))'),
 ('objects','operacao_arquivos_leitura','SELECT','((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))',null),
 ('objects','operacao_arquivos_envio','INSERT',null,'((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))'),
 ('objects','operacao_arquivos_atualizacao','UPDATE','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))'),
 ('objects','operacao_arquivos_exclusao','DELETE','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))',null)
 ), atual as (select * from pg_policies where (schemaname='public' and tablename in ('operacao_documentos','operacao_empresas')) or (schemaname='storage' and tablename='objects'))
 select auth.uid() is not null
 and exists(select 1 from storage.buckets where id='operacao-documentos' and public=false)
 and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity)
 and (select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('operacao_empresas','operacao_documentos','operacao_identificacao_empresa') and c.relrowsecurity)
 and not exists(select 1 from esperado e full join atual a on a.tablename=e.tabela and a.policyname=e.nome
  where e.nome is null or a.policyname is null or a.cmd<>e.comando or a.permissive<>'PERMISSIVE'
   or a.qual is distinct from e.qual or a.with_check is distinct from e.checagem
   or a.roles is distinct from case when e.nome in ('operacao_empresas_leitura','operacao_arquivos_leitura') then array['public']::name[] else array['authenticated']::name[] end)
 and not exists(select 1 from (values
 ('pode_escrever_org_operacao','c5fa4a20c0df119753f8f2efd99b4264'),
 ('pode_escrever_empresa_operacao','c5e91057ee05d745a22bd2fc89c80322'),
 ('pode_escrever_processo_operacao','7de47c8d343558a2dc2180ad2a4daffc'),
 ('arquivo_no_escopo_operacao','c727f040598b92b257a5322118447d6f'),
 ('escrita_arquivo_operacao','d95ab917f9d1faf6270e16d85dda42fd')
 ) as f(nome,hash) where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.nome and md5(replace(p.prosrc,chr(13),''))=f.hash));
$$;
revoke all on function public.identificacao_empresa_habilitada() from public,anon;
grant execute on function public.identificacao_empresa_habilitada() to authenticated;
notify pgrst, 'reload schema';
-- (commit do arquivo original removido)

-- ===================== kit_documentos.sql =====================
-- Peças de declaração/proposta por empresa. Idempotente; aplicar no SQL Editor
-- somente após identificacao_empresa.sql e seguranca_operacao.sql. Sem dados reais.
-- (begin do arquivo original removido)
create unique index if not exists operacao_processos_id_empresa_org_idx
 on public.operacao_processos(id,empresa_id,organizacao_id);
create table if not exists public.operacao_kit_documentos(
 id uuid primary key,organizacao_id uuid not null,empresa_id uuid not null,processo_id uuid not null,
 tipo text not null check(tipo in ('declaracao','proposta')),dados jsonb not null check(jsonb_typeof(dados)='object'),
 versao integer not null default 1 check(versao>0),
 criado_por uuid not null references auth.users(id),criado_em timestamptz not null default now(),
 atualizado_por uuid not null references auth.users(id),atualizado_em timestamptz not null default now(),
 revisao_hash text,revisao_previa jsonb,revisao_versao integer,
 revisado_por uuid references auth.users(id),revisado_em timestamptz,
 foreign key(processo_id,empresa_id,organizacao_id) references public.operacao_processos(id,empresa_id,organizacao_id),
 check((revisao_hash is null and revisao_previa is null and revisao_versao is null and revisado_por is null and revisado_em is null)
  or (revisao_hash is not null and revisao_hash ~ '^[a-f0-9]{64}$' and revisao_previa is not null and jsonb_typeof(revisao_previa)='object' and revisao_versao is not null and revisao_versao=versao and revisado_por is not null and revisado_em is not null))
);
alter table public.operacao_kit_documentos enable row level security;
create index if not exists operacao_kit_documentos_escopo_idx on public.operacao_kit_documentos(organizacao_id,empresa_id,processo_id,atualizado_em desc);
drop policy if exists operacao_kit_documentos_select_empresa on public.operacao_kit_documentos;
create policy operacao_kit_documentos_select_empresa on public.operacao_kit_documentos for select to authenticated
 using(public.pode_acessar_empresa_operacao(organizacao_id,empresa_id)
  and exists(select 1 from public.clientes c where c.id=auth.uid() and c.status='aprovado')
  and exists(select 1 from public.operacao_empresas e where e.id=operacao_kit_documentos.empresa_id and e.organizacao_id=operacao_kit_documentos.organizacao_id and e.ativo));

create or replace function public.kit_documento_escopo_imutavel() returns trigger
 language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if row(new.id,new.organizacao_id,new.empresa_id,new.processo_id,new.tipo,new.criado_por,new.criado_em)
  is distinct from row(old.id,old.organizacao_id,old.empresa_id,old.processo_id,old.tipo,old.criado_por,old.criado_em)
 then raise sqlstate 'PT409' using message='Escopo e autoria da peça são imutáveis';end if;
 return new;
end $$;
drop trigger if exists kit_documento_escopo_imutavel on public.operacao_kit_documentos;
create trigger kit_documento_escopo_imutavel before update on public.operacao_kit_documentos
 for each row execute function public.kit_documento_escopo_imutavel();

create or replace function public.gravar_kit_documento(
 p_documento uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid,p_usuario uuid,
 p_versao integer,p_tipo text,p_acao text,p_dados jsonb,p_hash text default null,p_previa jsonb default null
) returns public.operacao_kit_documentos language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare d public.operacao_kit_documentos;v jsonb;x record;item_id text;limite integer;
begin
 if p_documento is null or p_usuario is null or p_versao is null or p_versao<0 or p_versao>2147483646
  or p_tipo is null or p_tipo not in ('declaracao','proposta') or p_acao is null or p_acao not in ('salvar','confirmarRevisao')
 then raise sqlstate 'PT400' using message='Solicitação inválida';end if;
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id
  join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
  where c.id=p_usuario and c.status='aprovado' and m.papel in ('gestor','operador')
   and e.ativo and e.id=p_empresa and e.organizacao_id=p_organizacao and (m.empresa_id is null or m.empresa_id=e.id))
 then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 if not exists(select 1 from public.operacao_processos p where p.id=p_processo and p.empresa_id=p_empresa and p.organizacao_id=p_organizacao)
 then raise sqlstate 'PT404' using message='Processo indisponível';end if;

 if p_dados is null or jsonb_typeof(p_dados)<>'object' or p_dados-array[p_tipo]<>'{}'::jsonb or jsonb_typeof(p_dados->p_tipo) is distinct from 'object' or length(p_dados::text)>50000
 then raise sqlstate 'PT400' using message='Dados inválidos';end if;
 v:=p_dados->p_tipo;
 if (p_tipo='declaracao' and v-array['titulo','texto','fonte']<>'{}'::jsonb)
  or (p_tipo='proposta' and v-array['itemIds','unidades','validade','prazoEntrega','pagamento']<>'{}'::jsonb)
 then raise sqlstate 'PT400' using message='Campo não permitido';end if;
 for x in select key,value from jsonb_each(v) where key not in ('itemIds','unidades') loop
  limite:=case x.key when 'titulo' then 180 when 'texto' then 20000 when 'fonte' then 1000 else 500 end;
  if jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>limite or regexp_replace(x.value#>>'{}',E'[\t\n\r]','','g') ~ '[[:cntrl:]]'
  then raise sqlstate 'PT400' using message='Texto inválido';end if;
 end loop;
 if p_tipo='proposta' then
  if (v?'itemIds' and jsonb_typeof(v->'itemIds')<>'array') or (v?'unidades' and jsonb_typeof(v->'unidades')<>'object')
  then raise sqlstate 'PT400' using message='Itens e unidades inválidos';end if;
  if jsonb_array_length(coalesce(v->'itemIds','[]'))>50
  or (select count(*)<>count(distinct lower(value#>>'{}')) from jsonb_array_elements(coalesce(v->'itemIds','[]')))
  then raise sqlstate 'PT400' using message='Itens duplicados ou excessivos';end if;
  for x in select value from jsonb_array_elements(coalesce(v->'itemIds','[]')) loop
   item_id:=x.value#>>'{}';
   if jsonb_typeof(x.value)<>'string' or item_id !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   then raise sqlstate 'PT400' using message='Item inválido';end if;
   if not exists(select 1 from public.operacao_itens_resultado i where i.id=item_id::uuid and i.processo_id=p_processo and i.organizacao_id=p_organizacao)
   then raise sqlstate 'PT404' using message='Item indisponível';end if;
  end loop;
  for x in select key,value from jsonb_each(coalesce(v->'unidades','{}')) loop
   if not (coalesce(v->'itemIds','[]') ? x.key) or jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>40 or regexp_replace(x.value#>>'{}',E'[\t\n\r]','','g') ~ '[[:cntrl:]]'
   then raise sqlstate 'PT400' using message='Unidade inválida';end if;
  end loop;
 end if;

 if p_acao='salvar' and p_versao=0 then
  insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por)
   values(p_documento,p_organizacao,p_empresa,p_processo,p_tipo,p_dados,p_usuario,p_usuario)
   on conflict(id) do nothing returning * into d;
  if d.id is not null then return d;end if;
 end if;
 select * into d from public.operacao_kit_documentos where id=p_documento for update;
 if d.id is null then raise sqlstate 'PT404' using message='Documento indisponível';end if;
 if d.organizacao_id<>p_organizacao or d.empresa_id<>p_empresa or d.processo_id<>p_processo or d.tipo<>p_tipo
 then raise sqlstate 'PT409' using message='Escopo ou tipo divergente';end if;
 -- A mesma intenção só é recuperável antes da primeira edição e pelo seu autor.
 if p_acao='salvar' and p_versao=0 and d.versao=1 and d.criado_por=p_usuario and d.dados=p_dados then return d;end if;
 if d.versao<>p_versao then raise sqlstate 'PT409' using message='Versão alterada';end if;
 if p_acao='salvar' then
  update public.operacao_kit_documentos set dados=p_dados,versao=versao+1,atualizado_por=p_usuario,atualizado_em=clock_timestamp(),
   revisao_hash=null,revisao_previa=null,revisao_versao=null,revisado_por=null,revisado_em=null
   where id=p_documento and versao=p_versao returning * into d;
 else
  if d.dados<>p_dados then raise sqlstate 'PT409' using message='Dados alterados';end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_previa is null or jsonb_typeof(p_previa)<>'object'
   or p_previa-array['texto','fontes']<>'{}'::jsonb or jsonb_typeof(p_previa->'texto') is distinct from 'string'
   or length(p_previa->>'texto') not between 1 and 1000000 or jsonb_typeof(p_previa->'fontes') is distinct from 'array'
  then raise sqlstate 'PT400' using message='Revisão inválida';end if;
  if jsonb_array_length(p_previa->'fontes')>10 or exists(select 1 from jsonb_array_elements(p_previa->'fontes') f where jsonb_typeof(f)<>'string' or length(f#>>'{}')>2000)
  then raise sqlstate 'PT400' using message='Fontes da revisão inválidas';end if;
  update public.operacao_kit_documentos set revisao_hash=p_hash,revisao_previa=p_previa,revisao_versao=versao,revisado_por=p_usuario,revisado_em=clock_timestamp()
   where id=p_documento and versao=p_versao returning * into d;
 end if;
 if d.id is null then raise sqlstate 'PT409' using message='Versão alterada';end if;
 return d;
end $$;
-- Defaults do ambiente podem conceder acesso a outros papéis: normaliza só os três objetos do kit, preservando seus donos.
do $acl_kit$
declare objeto record;papel record;
begin
 for objeto in
  select 'table public.operacao_kit_documentos' as alvo,c.relowner as dono,
   coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner)) as acl
  from pg_catalog.pg_class c where c.oid='public.operacao_kit_documentos'::pg_catalog.regclass
  union all
  select 'function '||p.oid::pg_catalog.regprocedure::text,p.proowner,
   coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
  from pg_catalog.pg_proc p where p.oid in (
   'public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'::pg_catalog.regprocedure,
   'public.kit_documento_escopo_imutavel()'::pg_catalog.regprocedure
  )
 loop
  for papel in select distinct a.grantee from pg_catalog.aclexplode(objeto.acl) a where a.grantee<>objeto.dono loop
   execute pg_catalog.format('revoke all on %s from %s',objeto.alvo,
    case when papel.grantee=0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(papel.grantee)) end);
  end loop;
 end loop;
end
$acl_kit$;
grant select on public.operacao_kit_documentos to authenticated,service_role;
grant execute on function public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb) to service_role;
-- (commit do arquivo original removido)
notify pgrst,'reload schema';

-- ===================== kit_documentos_escala_proposta.sql =====================
-- PREPARADO LOCALMENTE. NÃO APLICADO. Requer kit_documentos.sql existente.
-- Substitui apenas RPC, mantém grants existentes e todo isolamento/CAS.
-- Candidato técnico de 1000 itens: não certificação comercial.
-- (begin do arquivo original removido)
create or replace function public.gravar_kit_documento(
 p_documento uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid,p_usuario uuid,
 p_versao integer,p_tipo text,p_acao text,p_dados jsonb,p_hash text default null,p_previa jsonb default null
) returns public.operacao_kit_documentos language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare d public.operacao_kit_documentos;v jsonb;x record;item_id text;limite integer;
begin
 if p_documento is null or p_usuario is null or p_versao is null or p_versao<0 or p_versao>2147483646
  or p_tipo is null or p_tipo not in ('declaracao','proposta') or p_acao is null or p_acao not in ('salvar','confirmarRevisao')
 then raise sqlstate 'PT400' using message='Solicitação inválida';end if;
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id
  join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
  where c.id=p_usuario and c.status='aprovado' and m.papel in ('gestor','operador')
   and e.ativo and e.id=p_empresa and e.organizacao_id=p_organizacao and (m.empresa_id is null or m.empresa_id=e.id))
 then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 if not exists(select 1 from public.operacao_processos p where p.id=p_processo and p.empresa_id=p_empresa and p.organizacao_id=p_organizacao)
 then raise sqlstate 'PT404' using message='Processo indisponível';end if;

 if p_dados is null or jsonb_typeof(p_dados)<>'object' or p_dados-array[p_tipo]<>'{}'::jsonb or jsonb_typeof(p_dados->p_tipo) is distinct from 'object' or (p_tipo='declaracao' and length(p_dados::text)>50000)
 then raise sqlstate 'PT400' using message='Dados inválidos';end if;
 v:=p_dados->p_tipo;
 if (p_tipo='declaracao' and v-array['titulo','texto','fonte']<>'{}'::jsonb)
  or (p_tipo='proposta' and v-array['itemIds','unidades','validade','prazoEntrega','pagamento']<>'{}'::jsonb)
 then raise sqlstate 'PT400' using message='Campo não permitido';end if;
 for x in select key,value from jsonb_each(v) where key not in ('itemIds','unidades') loop
  limite:=case x.key when 'titulo' then 180 when 'texto' then 20000 when 'fonte' then 1000 else 500 end;
  if jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>limite or regexp_replace(x.value#>>'{}',E'[\t\n\r]','','g') ~ '[[:cntrl:]]'
  then raise sqlstate 'PT400' using message='Texto inválido';end if;
 end loop;
 if p_tipo='proposta' then
  if (v?'itemIds' and jsonb_typeof(v->'itemIds')<>'array') or (v?'unidades' and jsonb_typeof(v->'unidades')<>'object')
  then raise sqlstate 'PT400' using message='Itens e unidades inválidos';end if;
  if jsonb_array_length(coalesce(v->'itemIds','[]'))>1000
  or (select count(*)<>count(distinct lower(value#>>'{}')) from jsonb_array_elements(coalesce(v->'itemIds','[]')))
  then raise sqlstate 'PT400' using message='Itens duplicados ou excessivos';end if;
  for x in select value from jsonb_array_elements(coalesce(v->'itemIds','[]')) loop
   item_id:=x.value#>>'{}';
   if jsonb_typeof(x.value)<>'string' or item_id !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   then raise sqlstate 'PT400' using message='Item inválido';end if;
   if not exists(select 1 from public.operacao_itens_resultado i where i.id=item_id::uuid and i.processo_id=p_processo and i.organizacao_id=p_organizacao)
   then raise sqlstate 'PT404' using message='Item indisponível';end if;
  end loop;
  for x in select key,value from jsonb_each(coalesce(v->'unidades','{}')) loop
   if not (coalesce(v->'itemIds','[]') ? x.key) or jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>40 or regexp_replace(x.value#>>'{}',E'[\t\n\r]','','g') ~ '[[:cntrl:]]'
   then raise sqlstate 'PT400' using message='Unidade inválida';end if;
  end loop;
 end if;

 -- Mesmo orçamento semântico de _kit_proposta_limites.js, valores UTF-8.
 if p_tipo='proposta' and (
  128 + jsonb_array_length(coalesce(v->'itemIds','[]')) * 128
  + octet_length(convert_to(coalesce(v->>'validade',''),'UTF8'))
  + octet_length(convert_to(coalesce(v->>'prazoEntrega',''),'UTF8'))
  + octet_length(convert_to(coalesce(v->>'pagamento',''),'UTF8'))
  + coalesce((select sum(octet_length(convert_to(i,'UTF8')) + octet_length(convert_to(coalesce(v->'unidades'->>i,''),'UTF8'))) from jsonb_array_elements_text(coalesce(v->'itemIds','[]')) as selecionado(i)),0)
 ) > 524288 then raise sqlstate 'PT400' using message='Rascunho excede o tamanho suportado'; end if;
 if p_acao='salvar' and p_versao=0 then
  insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por)
   values(p_documento,p_organizacao,p_empresa,p_processo,p_tipo,p_dados,p_usuario,p_usuario)
   on conflict(id) do nothing returning * into d;
  if d.id is not null then return d;end if;
 end if;
 select * into d from public.operacao_kit_documentos where id=p_documento for update;
 if d.id is null then raise sqlstate 'PT404' using message='Documento indisponível';end if;
 if d.organizacao_id<>p_organizacao or d.empresa_id<>p_empresa or d.processo_id<>p_processo or d.tipo<>p_tipo
 then raise sqlstate 'PT409' using message='Escopo ou tipo divergente';end if;
 -- A mesma intenção só é recuperável antes da primeira edição e pelo seu autor.
 if p_acao='salvar' and p_versao=0 and d.versao=1 and d.criado_por=p_usuario and d.dados=p_dados then return d;end if;
 if d.versao<>p_versao then raise sqlstate 'PT409' using message='Versão alterada';end if;
 if p_acao='salvar' then
  update public.operacao_kit_documentos set dados=p_dados,versao=versao+1,atualizado_por=p_usuario,atualizado_em=clock_timestamp(),
   revisao_hash=null,revisao_previa=null,revisao_versao=null,revisado_por=null,revisado_em=null
   where id=p_documento and versao=p_versao returning * into d;
 else
  if d.dados<>p_dados then raise sqlstate 'PT409' using message='Dados alterados';end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_previa is null or jsonb_typeof(p_previa)<>'object'
   or p_previa-array['texto','fontes']<>'{}'::jsonb or jsonb_typeof(p_previa->'texto') is distinct from 'string'
   or length(p_previa->>'texto') not between 1 and 1000000 or jsonb_typeof(p_previa->'fontes') is distinct from 'array'
  then raise sqlstate 'PT400' using message='Revisão inválida';end if;
  if p_tipo='proposta' and octet_length(convert_to(p_previa->>'texto','UTF8'))>2000000 then raise sqlstate 'PT400' using message='Prévia excede o tamanho suportado'; end if;
  if jsonb_array_length(p_previa->'fontes')>10 or exists(select 1 from jsonb_array_elements(p_previa->'fontes') f where jsonb_typeof(f)<>'string' or length(f#>>'{}')>2000)
  then raise sqlstate 'PT400' using message='Fontes da revisão inválidas';end if;
  update public.operacao_kit_documentos set revisao_hash=p_hash,revisao_previa=p_previa,revisao_versao=versao,revisado_por=p_usuario,revisado_em=clock_timestamp()
   where id=p_documento and versao=p_versao returning * into d;
 end if;
 if d.id is null then raise sqlstate 'PT409' using message='Versão alterada';end if;
 return d;
end $$;
-- (commit do arquivo original removido)
notify pgrst,'reload schema';

-- ===================== importacao_item_pncp.sql =====================
-- PREPARADO LOCALMENTE / NÃO APLICADO. Após schema operação e kit.
-- (begin do arquivo original removido)
create unique index if not exists operacao_itens_id_org_proc_idx on public.operacao_itens_resultado(id,organizacao_id,processo_id);
create table if not exists public.operacao_origens_pncp(
 item_id uuid primary key,organizacao_id uuid not null,processo_id uuid not null,empresa_id uuid not null,
 compra text not null,numero_item integer not null check(numero_item>0),url text not null,
 hash_aplicado text not null,hash_atual text not null,estado text not null check(estado in('importado','fonte_alterada')),
 observado_em timestamptz not null default now(),
 unique(processo_id,compra,numero_item),
 foreign key(item_id,organizacao_id,processo_id) references public.operacao_itens_resultado(id,organizacao_id,processo_id),
 foreign key(processo_id,empresa_id,organizacao_id) references public.operacao_processos(id,empresa_id,organizacao_id)
);
create table if not exists public.operacao_observacoes_pncp(
 item_id uuid not null references public.operacao_origens_pncp(item_id),hash text not null check(hash~'^[a-f0-9]{64}$'),
 snapshot jsonb not null check(octet_length(snapshot::text)<=400000),observado_em timestamptz not null default now(),
 primary key(item_id,hash)
);
create table if not exists public.operacao_cadencia_pncp(origem text primary key,proxima timestamptz not null);
alter table public.operacao_origens_pncp enable row level security;
alter table public.operacao_observacoes_pncp enable row level security;
alter table public.operacao_cadencia_pncp enable row level security;
revoke all on public.operacao_origens_pncp,public.operacao_observacoes_pncp,public.operacao_cadencia_pncp from public,anon,authenticated;
grant select on public.operacao_origens_pncp to authenticated;
-- (ajuste: idempotência)
drop policy if exists origem_pncp_leitura on public.operacao_origens_pncp;
create policy origem_pncp_leitura on public.operacao_origens_pncp for select to authenticated using(
 exists(select 1 from public.operacao_membros m join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
 join public.clientes c on c.id=m.usuario_id where c.id=auth.uid() and c.status='aprovado' and e.ativo
 and e.id=operacao_origens_pncp.empresa_id and e.organizacao_id=operacao_origens_pncp.organizacao_id and (m.empresa_id is null or m.empresa_id=e.id))
);
create or replace function public.reservar_importacao_pncp(p_usuario uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id
 join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
 join public.operacao_processos p on p.empresa_id=e.id and p.organizacao_id=e.organizacao_id
 where c.id=p_usuario and c.status='aprovado' and m.papel in('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)
 and e.id=p_empresa and e.ativo and e.organizacao_id=p_organizacao and p.id=p_processo) then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 perform pg_advisory_xact_lock(hashtext('importacao-item-pncp-origem'));
 if exists(select 1 from public.operacao_cadencia_pncp where origem='pncp' and proxima>clock_timestamp()) then return false;end if;
 insert into public.operacao_cadencia_pncp values('pncp',clock_timestamp()+interval '7 seconds') on conflict(origem) do update set proxima=excluded.proxima;
 return true;
end $$;
create or replace function public.gravar_importacao_pncp(p_usuario uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid,
 p_compra text,p_numero integer,p_url text,p_hash text,p_item jsonb,p_snapshot jsonb,p_referencia jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare origem public.operacao_origens_pncp; item uuid; estado_saida text; processo public.operacao_processos;
begin
 select * into processo from public.operacao_processos where id=p_processo and empresa_id=p_empresa and organizacao_id=p_organizacao for update;
 if processo.id is null then raise sqlstate 'PT404' using message='Processo indisponível';end if;
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
 where c.id=p_usuario and c.status='aprovado' and m.papel in('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)
 and e.id=p_empresa and e.ativo and e.organizacao_id=p_organizacao) then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 if p_referencia is distinct from jsonb_build_object('url_origem',nullif(processo.url_origem,''),'origem_externa_id',nullif(processo.origem_externa_id,''),'numero',nullif(processo.numero,'')) then raise sqlstate 'PT409' using message='Referência do processo alterada';end if;
 if p_compra is null or p_compra!~'^\d{14}-1-[1-9]\d*/\d{4}$' or p_numero not between 1 and 1000000
 or p_url is distinct from 'https://pncp.gov.br/api/pncp/v1/orgaos/'||split_part(p_compra,'-',1)||'/compras/'||split_part(p_compra,'/',2)||'/'||split_part(split_part(p_compra,'-',3),'/',1)||'/itens/'||p_numero::text
 or p_hash is null or p_hash!~'^[a-f0-9]{64}$' or jsonb_typeof(p_item) is distinct from 'object' or p_item-array['numero','descricao','quantidade','unidade']<>'{}'::jsonb
 or p_item->>'numero' is distinct from p_numero::text or jsonb_typeof(p_item->'descricao') is distinct from 'string' or jsonb_typeof(p_item->'unidade') is distinct from 'string' or jsonb_typeof(p_item->'quantidade') is distinct from 'string' or length(p_item->>'descricao') not between 1 and 10000
 or length(p_item->>'unidade') not between 1 and 100 or (p_item->>'quantidade')!~'^(0|[1-9]\d{0,11})(\.\d{1,3})?$'
 or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>400000
 then raise sqlstate 'PT400' using message='Observação inválida';end if;
 if (p_item->>'quantidade')::numeric<=0 then raise sqlstate 'PT400' using message='Quantidade inválida';end if;
 select * into origem from public.operacao_origens_pncp where processo_id=p_processo and compra=p_compra and numero_item=p_numero for update;
 if origem.item_id is null then
  -- Não ligar automaticamente lançamento manual por identificador textual.
  if exists(select 1 from public.operacao_itens_resultado where processo_id=p_processo and organizacao_id=p_organizacao and tipo='item' and identificador=p_numero::text)
  then return jsonb_build_object('estado','colisao_manual');end if;
  insert into public.operacao_itens_resultado(organizacao_id,processo_id,tipo,identificador,descricao,quantidade,fonte_oficial)
  values(p_organizacao,p_processo,'item',p_numero::text,p_item->>'descricao',(p_item->>'quantidade')::numeric,p_url) returning id into item;
  insert into public.operacao_origens_pncp(item_id,organizacao_id,processo_id,empresa_id,compra,numero_item,url,hash_aplicado,hash_atual,estado)
  values(item,p_organizacao,p_processo,p_empresa,p_compra,p_numero,p_url,p_hash,p_hash,'importado');estado_saida:='importado';
 else
  item:=origem.item_id;estado_saida:=case when origem.hash_aplicado=p_hash then 'inalterado' else 'fonte_alterada' end;
  update public.operacao_origens_pncp set hash_atual=p_hash,estado=case when origem.hash_aplicado=p_hash then 'importado' else 'fonte_alterada' end,observado_em=clock_timestamp() where item_id=item;
  -- Oferta, marca/modelo, quantidade e texto do cadastro permanecem intocados.
 end if;
 insert into public.operacao_observacoes_pncp(item_id,hash,snapshot) values(item,p_hash,p_snapshot) on conflict(item_id,hash) do nothing;
 return jsonb_build_object('itemId',item,'estado',estado_saida,'hash',p_hash,'observadoEm',clock_timestamp());
end $$;
revoke all on function public.reservar_importacao_pncp(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reservar_importacao_pncp(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb) to service_role;
-- (commit do arquivo original removido)
notify pgrst,'reload schema';

-- ===================== endurecer_rpc_servidor.sql =====================
-- ============================================================================
-- Endurecimento de RPC usada só pelos robôs SICAF — 17/11/2026
-- Idempotente: seguro rodar mais de uma vez. Rodar no SQL Editor do Supabase.
--
-- Por quê: o Security Advisor do Supabase (projeto LICITAPLENA) mostrou que
-- `anon` e `authenticated` executam selecionar_sicaf_para_enriquecimento
-- (SECURITY DEFINER) via /rest/v1/rpc. Sem login, qualquer pessoa listava até
-- 200 CNPJs por chamada da base de prospecção. A função não tem outro .sql no
-- repositório (veio do projeto Radar SICAF); quem chama é robô com service_role.
-- A correção equivalente de incrementar_uso está em rls_e_limite_de_uso.sql.
-- ============================================================================

revoke execute on function public.selecionar_sicaf_para_enriquecimento(integer, text) from public, anon, authenticated;
grant execute on function public.selecionar_sicaf_para_enriquecimento(integer, text) to service_role;

-- Conferência: as duas linhas devem mostrar anon=false e authenticated=false.
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute')  as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('incrementar_uso', 'selecionar_sicaf_para_enriquecimento');

-- ===================== rls_e_limite_de_uso.sql (só incrementar_uso) =====================
-- Front não chama esta RPC; só netlify/functions/_auth.js, com SUPABASE_SERVICE_ROLE_KEY.
revoke all on function public.incrementar_uso(uuid, text) from public, anon, authenticated;
grant execute on function public.incrementar_uso(uuid, text) to service_role;

commit;


-- ========== operacao_itens_proposta.sql ==========
-- Premissas e preços por item da proposta (espec. dezembro, seção 3).
-- Idempotente; rodar no SQL Editor depois do 01-aplicar.sql (precisa de
-- importacao_item_pncp.sql aplicado). Só acrescenta colunas: não apaga dados.
-- Regra 1 da espec.: nada aqui toca atualizado_em, oferta (valor_*) nem marca/modelo.
begin;

alter table public.operacao_processos
  add column if not exists margem_minima_percentual numeric(7,3)
    check (margem_minima_percentual is null or margem_minima_percentual between 0 and 99.999);

alter table public.operacao_itens_resultado
  add column if not exists unidade text
    check (unidade is null or length(unidade) between 1 and 100),
  add column if not exists fabricante text
    check (fabricante is null or length(fabricante) <= 500),
  add column if not exists custo_unitario numeric(15,2)
    check (custo_unitario is null or custo_unitario >= 0),
  add column if not exists valor_unitario_minimo numeric(15,2)
    check (valor_unitario_minimo is null or valor_unitario_minimo > 0),
  add column if not exists codigo_catalogo text
    check (codigo_catalogo is null or codigo_catalogo ~ '^\d{1,12}$'),
  add column if not exists preco_referencia numeric(15,4)
    check (preco_referencia is null or preco_referencia > 0),
  add column if not exists preco_referencia_em timestamptz;

-- Copia unidade e CATMAT/CATSER da observação PNCP só para campo vazio do item.
-- Valor fora do formato é ignorado (não derruba a importação).
create or replace function public.preencher_item_observacao_pncp(p_item uuid, p_snapshot jsonb)
returns void language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  u text := nullif(btrim(p_snapshot->'item'->>'unidade'), '');
  c text := btrim(p_snapshot->'raw'->>'catalogoCodigoItem');
begin
  if length(u) > 100 then u := null; end if;
  if c !~ '^\d{1,12}$' then c := null; end if;
  if u is null and c is null then return; end if;
  update public.operacao_itens_resultado
     set unidade = coalesce(unidade, u), codigo_catalogo = coalesce(codigo_catalogo, c)
   where id = p_item
     and ((unidade is null and u is not null) or (codigo_catalogo is null and c is not null));
end $$;

create or replace function public.operacao_observacao_pncp_preencher_item()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  perform public.preencher_item_observacao_pncp(new.item_id, new.snapshot);
  return null;
end $$;

revoke all on function public.preencher_item_observacao_pncp(uuid, jsonb),
  public.operacao_observacao_pncp_preencher_item() from public, anon, authenticated;

drop trigger if exists operacao_observacao_pncp_preencher_item on public.operacao_observacoes_pncp;
create trigger operacao_observacao_pncp_preencher_item after insert on public.operacao_observacoes_pncp
  for each row execute function public.operacao_observacao_pncp_preencher_item();

-- Itens já importados: a observação mais recente com valor válido vence.
do $$ declare o record; begin
  for o in select item_id, snapshot from public.operacao_observacoes_pncp order by observado_em desc loop
    perform public.preencher_item_observacao_pncp(o.item_id, o.snapshot);
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';


-- ========== operacao_funil_etapas.sql ==========
-- Funil com etapas editáveis por organização (espec. dezembro, seção 1).
-- Idempotente; rodar no SQL Editor depois do 01-aplicar.sql e de
-- operacao_itens_proposta.sql. Só acrescenta: operacao_processos.status segue
-- valendo; etapa_id é opcional e, sem etapas, o painel cai em KANBAN_COLUNAS.
begin;

create table if not exists public.operacao_funil_etapas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  nome text not null check (nome = btrim(nome) and length(nome) between 1 and 40),
  ordem smallint not null check (ordem between 0 and 99),
  -- Check de operacao_processos.status (operacao_licitacoes.sql), sem 'arquivado'.
  status_sistema text not null check (status_sistema in ('triagem','preparacao','proposta_enviada','sessao','habilitacao','recurso','homologado','contratado','perdido')),
  chave_sistema text check (chave_sistema in ('interesse','participando','ganhei','perdi')),
  cor text not null default '#64748b' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  criado_em timestamptz not null default now(),
  unique (id, organizacao_id),
  constraint operacao_funil_etapas_protegida_coerente check (case chave_sistema
    when 'interesse' then status_sistema = 'triagem'
    when 'participando' then status_sistema = 'preparacao'
    when 'ganhei' then status_sistema = 'homologado'
    when 'perdi' then status_sistema = 'perdido'
    else true end)
);
create unique index if not exists operacao_funil_etapas_chave_idx
  on public.operacao_funil_etapas (organizacao_id, chave_sistema) where chave_sistema is not null;
create unique index if not exists operacao_funil_etapas_nome_idx
  on public.operacao_funil_etapas (organizacao_id, lower(nome));

alter table public.operacao_processos add column if not exists etapa_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.operacao_processos'::regclass and conname = 'operacao_processos_etapa_fk') then
    alter table public.operacao_processos add constraint operacao_processos_etapa_fk
      foreign key (etapa_id, organizacao_id) references public.operacao_funil_etapas(id, organizacao_id)
      on delete set null (etapa_id);
  end if;
end $$;
create index if not exists operacao_processos_etapa_idx on public.operacao_processos (etapa_id) where etapa_id is not null;

-- Protegidas: não saem e só mudam nome, cor e ordem. Personalizadas não trocam de
-- organização nem viram protegidas; "conta como" só muda sem processo na etapa.
create or replace function public.operacao_funil_etapas_proteger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('operacao_funil_etapas:' || new.organizacao_id::text));
    if (select count(*) from public.operacao_funil_etapas where organizacao_id = new.organizacao_id) >= 20 then
      raise exception 'Limite de 20 etapas no funil' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Exclusão em cascata da organização precisa passar.
    if old.chave_sistema is not null and exists (select 1 from public.operacao_organizacoes where id = old.organizacao_id) then
      raise exception 'Etapa do sistema não pode ser excluída' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.organizacao_id is distinct from old.organizacao_id
     or new.chave_sistema is distinct from old.chave_sistema or new.criado_em is distinct from old.criado_em then
    raise exception 'Só nome, cor, ordem e estágio da etapa podem mudar' using errcode = 'P0001';
  end if;
  if new.status_sistema is distinct from old.status_sistema then
    if old.chave_sistema is not null then
      raise exception 'Etapa do sistema só muda nome, cor e ordem' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.operacao_processos where etapa_id = old.id) then
      raise exception 'Etapa em uso: mova os processos antes de mudar o estágio' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists operacao_funil_etapas_proteger on public.operacao_funil_etapas;
create trigger operacao_funil_etapas_proteger before insert or update or delete on public.operacao_funil_etapas
  for each row execute function public.operacao_funil_etapas_proteger();

-- Status mudado por fora do funil (robô, dossiê) solta a etapa; etapa nova tem
-- de ser da mesma organização e do mesmo estágio do status.
create or replace function public.operacao_processos_etapa_coerente()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if new.etapa_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.etapa_id is not distinct from old.etapa_id then
    new.etapa_id := null;
    return new;
  end if;
  select status_sistema into v_status from public.operacao_funil_etapas
   where id = new.etapa_id and organizacao_id = new.organizacao_id;
  if v_status is null then
    raise exception 'Etapa indisponível para esta organização' using errcode = '23503';
  end if;
  if v_status <> new.status then
    raise exception 'Etapa incompatível com o status do processo' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists operacao_processos_etapa_coerente on public.operacao_processos;
create trigger operacao_processos_etapa_coerente before insert or update of status, etapa_id, organizacao_id on public.operacao_processos
  for each row execute function public.operacao_processos_etapa_coerente();

revoke all on function public.operacao_funil_etapas_proteger(), public.operacao_processos_etapa_coerente()
  from public, anon, authenticated, service_role;

-- Leitura cria as 4 protegidas na primeira vez; vale também para papel leitura.
create or replace function public.garantir_etapas_funil(p_org uuid)
returns setof public.operacao_funil_etapas language plpgsql security definer set search_path = '' as $$
begin
  if p_org is null or not public.tem_vinculo_operacao(p_org) then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;
  insert into public.operacao_funil_etapas (organizacao_id, nome, ordem, status_sistema, chave_sistema, cor)
  select p_org, v.nome, v.ordem, v.status, v.chave, v.cor
    from (values ('Tenho interesse', 0, 'triagem', 'interesse', '#64748b'),
                 ('Participando', 1, 'preparacao', 'participando', '#2563eb'),
                 ('Ganhei', 2, 'homologado', 'ganhei', '#16a34a'),
                 ('Perdi', 3, 'perdido', 'perdi', '#dc2626')) as v(nome, ordem, status, chave, cor)
   where not exists (select 1 from public.operacao_funil_etapas e where e.organizacao_id = p_org and e.chave_sistema = v.chave)
  on conflict do nothing;
  -- on conflict cobre corrida e nome já usado por etapa personalizada: o segundo caso precisa de ação do usuário.
  if (select count(*) from public.operacao_funil_etapas where organizacao_id = p_org and chave_sistema is not null) <> 4 then
    raise exception 'Renomeie a etapa personalizada com nome de etapa do sistema' using errcode = '23505';
  end if;
  return query select * from public.operacao_funil_etapas where organizacao_id = p_org order by ordem, criado_em, id;
end $$;

-- Invoker: a RLS de escrita vale; a lista tem de trazer todas as etapas, uma vez cada.
create or replace function public.reordenar_etapas_funil(p_org uuid, p_ids uuid[])
returns setof public.operacao_funil_etapas language plpgsql security invoker set search_path = '' as $$
begin
  if p_org is null or not public.pode_escrever_org_operacao(p_org) then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('operacao_funil_etapas:' || p_org::text));
  if p_ids is null
     or pg_catalog.cardinality(p_ids) <> (select count(distinct x) from pg_catalog.unnest(p_ids) as x)
     or pg_catalog.cardinality(p_ids) <> (select count(*) from public.operacao_funil_etapas where organizacao_id = p_org)
     or exists (select 1 from pg_catalog.unnest(p_ids) as x
                 where not exists (select 1 from public.operacao_funil_etapas e where e.id = x and e.organizacao_id = p_org)) then
    raise exception 'Envie todas as etapas do funil, sem repetir' using errcode = '22023';
  end if;
  update public.operacao_funil_etapas e set ordem = o.n - 1
    from pg_catalog.unnest(p_ids) with ordinality as o(id, n)
   where e.id = o.id and e.organizacao_id = p_org and e.ordem <> o.n - 1;
  return query select * from public.operacao_funil_etapas where organizacao_id = p_org order by ordem, criado_em, id;
end $$;

revoke all on function public.garantir_etapas_funil(uuid), public.reordenar_etapas_funil(uuid, uuid[]) from public, anon;
grant execute on function public.garantir_etapas_funil(uuid), public.reordenar_etapas_funil(uuid, uuid[]) to authenticated, service_role;

alter table public.operacao_funil_etapas enable row level security;
revoke all on public.operacao_funil_etapas from public, anon, authenticated;
grant select, insert, update, delete on public.operacao_funil_etapas to authenticated;
grant all on public.operacao_funil_etapas to service_role;
drop policy if exists operacao_funil_etapas_leitura on public.operacao_funil_etapas;
drop policy if exists operacao_funil_etapas_escrita on public.operacao_funil_etapas;
create policy operacao_funil_etapas_leitura on public.operacao_funil_etapas for select to authenticated
  using (public.tem_vinculo_operacao(organizacao_id));
create policy operacao_funil_etapas_escrita on public.operacao_funil_etapas for all to authenticated
  using (public.pode_escrever_org_operacao(organizacao_id)) with check (public.pode_escrever_org_operacao(organizacao_id));

commit;
notify pgrst, 'reload schema';


-- ========== operacao_portal_cliente.sql ==========
-- Portal do cliente com aceite por item (espec. dezembro, seção 2).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql e do
-- operacao_itens_proposta.sql. Só cria objetos novos: não altera nem apaga dados existentes.
-- Não reaproveita convites: o token só existe no link; o banco guarda o sha256 (hex).
-- Tudo passa por RPC security definer chamada só pelo servidor (service_role).
begin;

create table if not exists public.operacao_links_cliente (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null,
  processo_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  rotulo text not null check (length(rotulo) between 2 and 120),
  mostrar_minimo boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  revogado_por uuid references auth.users(id) on delete set null,
  ultimo_acesso_em timestamptz,
  check (expira_em > criado_em and expira_em <= criado_em + interval '60 days'),
  check (revogado_por is null or revogado_em is not null),
  unique (id, organizacao_id, processo_id),
  foreign key (processo_id, empresa_id, organizacao_id)
    references public.operacao_processos(id, empresa_id, organizacao_id) on delete cascade
);
create index if not exists operacao_links_cliente_processo_idx
  on public.operacao_links_cliente (processo_id) where revogado_em is null;

create table if not exists public.operacao_aceites_item (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null,
  organizacao_id uuid not null,
  processo_id uuid not null,
  item_id uuid not null,
  decisao text not null check (decisao in ('aprovado', 'recusado')),
  observacao text check (observacao is null or length(observacao) <= 1000),
  visto jsonb not null check (jsonb_typeof(visto) = 'object'),
  versao text not null check (versao ~ '^[0-9a-f]{32}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz not null default now()
);
-- Aceite é prova do cliente: nunca some em cascata. Troca os FKs antigos (cascade, nome padrão)
-- pelos de nome fixo com restrict; rodar de novo só recria os mesmos.
alter table public.operacao_aceites_item
  drop constraint if exists operacao_aceites_item_link_id_organizacao_id_processo_id_fkey,
  drop constraint if exists operacao_aceites_item_item_id_organizacao_id_processo_id_fkey,
  drop constraint if exists operacao_aceites_item_link_fk,
  drop constraint if exists operacao_aceites_item_item_fk;
alter table public.operacao_aceites_item
  add constraint operacao_aceites_item_link_fk foreign key (link_id, organizacao_id, processo_id)
    references public.operacao_links_cliente(id, organizacao_id, processo_id) on delete restrict,
  add constraint operacao_aceites_item_item_fk foreign key (item_id, organizacao_id, processo_id)
    references public.operacao_itens_resultado(id, organizacao_id, processo_id) on delete restrict;
create index if not exists operacao_aceites_item_link_idx
  on public.operacao_aceites_item (link_id, item_id, criado_em desc);
create index if not exists operacao_aceites_item_item_idx on public.operacao_aceites_item (item_id);
create index if not exists operacao_aceites_item_processo_idx
  on public.operacao_aceites_item (processo_id, criado_em desc);

-- Eventos sem link conhecido (token inexistente, limite por IP) ficam com organização nula
-- e, por isso, invisíveis para authenticated.
create table if not exists public.operacao_portal_auditoria (
  id bigint generated always as identity primary key,
  evento text not null check (evento in ('link_criado', 'link_revogado', 'acesso', 'resposta', 'negado', 'limite')),
  link_id uuid references public.operacao_links_cliente(id) on delete set null,
  organizacao_id uuid,
  processo_id uuid,
  usuario_id uuid,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  detalhe jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists operacao_portal_auditoria_processo_idx
  on public.operacao_portal_auditoria (processo_id, criado_em desc);
create index if not exists operacao_portal_auditoria_expurgo_idx
  on public.operacao_portal_auditoria (criado_em) where evento in ('acesso', 'negado', 'limite');

create table if not exists public.operacao_portal_limite (
  chave text not null,
  janela timestamptz not null,
  contagem integer not null default 1,
  primary key (chave, janela)
);
create index if not exists operacao_portal_limite_janela_idx on public.operacao_portal_limite (janela);

-- Histórico só cresce: correção é um novo aceite, nunca edição nem exclusão (vale até para o dono
-- das tabelas e para a service_role, que ignoram RLS).
create or replace function public.operacao_aceite_item_imutavel()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'Aceite do cliente não pode ser alterado nem apagado' using errcode = 'P0001';
end $$;
drop trigger if exists operacao_aceite_item_imutavel on public.operacao_aceites_item;
create trigger operacao_aceite_item_imutavel before update or delete on public.operacao_aceites_item
  for each row execute function public.operacao_aceite_item_imutavel();
drop trigger if exists operacao_aceite_item_sem_truncate on public.operacao_aceites_item;
create trigger operacao_aceite_item_sem_truncate before truncate on public.operacao_aceites_item
  for each statement execute function public.operacao_aceite_item_imutavel();

-- Item ou link com aceite: o restrict já barra, mas com mensagem de FK. Este gatilho dá o texto que a
-- tela mostra. Processo excluído chega aqui pela cascata para itens e links. 23503 = FK (PostgREST: 409).
-- security definer: quem apaga pode não enxergar os aceites pela RLS, e a conferência precisa ver todos.
create or replace function public.operacao_bloquear_exclusao_com_aceite()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if (tg_table_name = 'operacao_itens_resultado' and exists (select 1 from public.operacao_aceites_item where item_id = old.id))
     or (tg_table_name = 'operacao_links_cliente' and exists (select 1 from public.operacao_aceites_item where link_id = old.id)) then
    raise exception 'Este item tem respostas do cliente; arquive em vez de excluir.' using errcode = '23503';
  end if;
  return old;
end $$;
drop trigger if exists operacao_itens_bloquear_exclusao_com_aceite on public.operacao_itens_resultado;
create trigger operacao_itens_bloquear_exclusao_com_aceite before delete on public.operacao_itens_resultado
  for each row execute function public.operacao_bloquear_exclusao_com_aceite();
drop trigger if exists operacao_links_bloquear_exclusao_com_aceite on public.operacao_links_cliente;
create trigger operacao_links_bloquear_exclusao_com_aceite before delete on public.operacao_links_cliente
  for each row execute function public.operacao_bloquear_exclusao_com_aceite();

alter table public.operacao_links_cliente enable row level security;
alter table public.operacao_aceites_item enable row level security;
alter table public.operacao_portal_auditoria enable row level security;
alter table public.operacao_portal_limite enable row level security;
revoke all on public.operacao_links_cliente, public.operacao_aceites_item,
  public.operacao_portal_auditoria, public.operacao_portal_limite from public, anon, authenticated;
-- A service_role recebe tudo por default privileges do Supabase: aceite e auditoria não se apagam pela API.
-- A limpeza de 'acesso'/'negado' antigos roda dentro das RPCs (dono das tabelas), não pela service_role.
revoke delete, truncate on public.operacao_aceites_item, public.operacao_portal_auditoria from service_role;
-- Leitura do painel: só colunas sem token_hash/ip_hash.
grant select (id, organizacao_id, empresa_id, processo_id, rotulo, mostrar_minimo, criado_por, criado_em,
  expira_em, revogado_em, revogado_por, ultimo_acesso_em) on public.operacao_links_cliente to authenticated;
grant select (id, link_id, organizacao_id, processo_id, item_id, decisao, observacao, visto, versao, criado_em)
  on public.operacao_aceites_item to authenticated;
grant select (id, evento, link_id, organizacao_id, processo_id, usuario_id, detalhe, criado_em)
  on public.operacao_portal_auditoria to authenticated;
drop policy if exists operacao_links_cliente_leitura_processo on public.operacao_links_cliente;
drop policy if exists operacao_aceites_item_leitura_processo on public.operacao_aceites_item;
drop policy if exists operacao_portal_auditoria_leitura_processo on public.operacao_portal_auditoria;
create policy operacao_links_cliente_leitura_processo on public.operacao_links_cliente
  for select to authenticated using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_aceites_item_leitura_processo on public.operacao_aceites_item
  for select to authenticated using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_portal_auditoria_leitura_processo on public.operacao_portal_auditoria
  for select to authenticated using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));

-- ===== Auxiliares internas (sem execute para nenhum papel da API) =====

-- O que o cliente vê de um item; a versão é o md5 deste jsonb (texto canônico do jsonb).
create or replace function public.portal_visto_item(i public.operacao_itens_resultado, p_minimo boolean)
returns jsonb language sql stable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object('identificador', i.identificador, 'descricao', i.descricao,
    'quantidade', i.quantidade, 'unidade', i.unidade, 'valor_unitario_proposta', i.valor_unitario_proposta,
    'marca', i.marca, 'modelo', i.modelo, 'fabricante', i.fabricante)
  || case when p_minimo then jsonb_build_object('valor_unitario_minimo', i.valor_unitario_minimo) else '{}'::jsonb end;
$$;

create or replace function public.portal_contar(p_chave text, p_janela timestamptz)
returns integer language sql set search_path = pg_catalog, pg_temp as $$
  insert into public.operacao_portal_limite as l (chave, janela, contagem) values (p_chave, p_janela, 1)
  on conflict (chave, janela) do update set contagem = l.contagem + 1 returning contagem;
$$;

-- Conta a chamada e diz se algum limite estourou. Auditoria 'limite' só no primeiro estouro
-- de cada janela, para o próprio abuso não encher a tabela.
create or replace function public.portal_estourou(p_ip text, p_chave_token text, p_max_token integer)
returns boolean language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  minuto timestamptz := date_trunc('minute', now());
  n integer;
begin
  n := public.portal_contar('ip:' || p_ip, minuto);
  if n > 60 then
    if n = 61 then insert into public.operacao_portal_auditoria (evento, ip_hash, detalhe)
      values ('limite', p_ip, '{"motivo":"ip_minuto"}'); end if;
    return true;
  end if;
  if coalesce((select contagem from public.operacao_portal_limite
      where chave = 'falha:' || p_ip and janela = date_trunc('hour', now())), 0) >= 20 then
    return true;
  end if;
  n := public.portal_contar(p_chave_token, minuto);
  if n > p_max_token then
    if n = p_max_token + 1 then insert into public.operacao_portal_auditoria (evento, ip_hash, detalhe)
      values ('limite', p_ip, jsonb_build_object('motivo', split_part(p_chave_token, ':', 1) || '_minuto')); end if;
    return true;
  end if;
  return false;
end $$;

-- Retenção (LGPD), em lote pequeno a cada chamada das duas RPCs públicas: contadores com mais de 1 dia
-- e eventos 'acesso'/'negado'/'limite' com mais de 180 dias. 'resposta', 'link_criado' e 'link_revogado'
-- ficam: são o histórico do contrato com o cliente.
create or replace function public.portal_limpar()
returns void language sql set search_path = pg_catalog, pg_temp as $$
  delete from public.operacao_portal_limite where ctid in (
    select ctid from public.operacao_portal_limite where janela < now() - interval '1 day' limit 100);
  delete from public.operacao_portal_auditoria where id in (
    select id from public.operacao_portal_auditoria
     where evento in ('acesso', 'negado', 'limite') and criado_em < now() - interval '180 days' limit 100);
$$;

-- Auditoria 'negado' com teto global de 1000 por hora: acima disso só conta (contador 'global:negado'),
-- para IPs rotativos não encherem a tabela. O primeiro estouro da hora vira um evento 'limite'.
create or replace function public.portal_negar(l public.operacao_links_cliente, p_ip text, p_motivo text)
returns void language plpgsql set search_path = pg_catalog, pg_temp as $$
declare n integer := public.portal_contar('global:negado', date_trunc('hour', now()));
begin
  if n <= 1000 then
    insert into public.operacao_portal_auditoria (evento, link_id, organizacao_id, processo_id, ip_hash, detalhe)
      values ('negado', l.id, l.organizacao_id, l.processo_id, p_ip, jsonb_build_object('motivo', p_motivo));
  elsif n = 1001 then
    insert into public.operacao_portal_auditoria (evento, detalhe) values ('limite', '{"motivo":"negado_global_hora"}');
  end if;
end $$;

-- Link utilizável ou null. Falha conta para o limite por IP e é auditada.
-- Quem criou o link precisa continuar com acesso de gestão ao processo (membro gestor/operador da empresa,
-- cadastro aprovado): saiu da organização ou foi suspenso, os links dele param de valer.
create or replace function public.portal_link_valido(p_token_hash text, p_ip text)
returns public.operacao_links_cliente language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  l public.operacao_links_cliente;
  n integer;
  motivo text;
begin
  if p_token_hash ~ '^[0-9a-f]{64}$' then
    select k.* into l from public.operacao_links_cliente k
      join public.operacao_empresas e on e.id = k.empresa_id and e.organizacao_id = k.organizacao_id
      where k.token_hash = p_token_hash and e.ativo;
  end if;
  motivo := case when l.id is null then 'inexistente' when l.revogado_em is not null then 'revogado'
    when l.expira_em <= now() then 'expirado'
    when public.portal_autorizar_gestao(l.criado_por, l.empresa_id, l.processo_id) is null then 'criador_sem_acesso' end;
  if motivo is null then return l; end if;
  n := public.portal_contar('falha:' || p_ip, date_trunc('hour', now()));
  if n = 20 then insert into public.operacao_portal_auditoria (evento, ip_hash, detalhe)
    values ('limite', p_ip, '{"motivo":"falhas_hora"}'); end if;
  perform public.portal_negar(l, p_ip, motivo);
  return null;
end $$;

-- Mesmo critério de reservar_importacao_pncp; devolve a organização do processo.
create or replace function public.portal_autorizar_gestao(p_usuario uuid, p_empresa uuid, p_processo uuid)
returns uuid language sql stable set search_path = pg_catalog, pg_temp as $$
  select p.organizacao_id from public.clientes c
    join public.operacao_membros m on m.usuario_id = c.id
    join public.operacao_empresas e on e.organizacao_id = m.organizacao_id
    join public.operacao_processos p on p.empresa_id = e.id and p.organizacao_id = e.organizacao_id
   where c.id = p_usuario and c.status = 'aprovado' and m.papel in ('gestor', 'operador')
     and (m.empresa_id is null or m.empresa_id = e.id) and e.id = p_empresa and e.ativo and p.id = p_processo
   limit 1;
$$;

revoke all on function public.operacao_aceite_item_imutavel(),
  public.portal_visto_item(public.operacao_itens_resultado, boolean),
  public.portal_contar(text, timestamptz),
  public.portal_estourou(text, text, integer),
  public.portal_link_valido(text, text),
  public.portal_limpar(),
  public.portal_negar(public.operacao_links_cliente, text, text),
  public.operacao_bloquear_exclusao_com_aceite(),
  public.portal_autorizar_gestao(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ===== RPCs (só service_role) =====

create or replace function public.criar_link_cliente(p_usuario uuid, p_empresa uuid, p_processo uuid,
  p_token_hash text, p_rotulo text, p_dias integer, p_mostrar_minimo boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  org uuid := public.portal_autorizar_gestao(p_usuario, p_empresa, p_processo);
  l public.operacao_links_cliente;
begin
  if org is null then raise sqlstate 'PT403' using message = 'Acesso não autorizado'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_dias is null or p_dias not between 1 and 60
     or length(btrim(p_rotulo)) is null or length(btrim(p_rotulo)) not between 2 and 120 or p_mostrar_minimo is null then
    raise sqlstate 'PT400' using message = 'Dados do link inválidos';
  end if;
  -- Serializa a contagem de links ativos do processo.
  perform 1 from public.operacao_processos where id = p_processo for update;
  if (select count(*) from public.operacao_links_cliente
       where processo_id = p_processo and revogado_em is null and expira_em > now()) >= 5 then
    raise sqlstate 'PT409' using message = 'Limite de 5 links ativos por processo';
  end if;
  insert into public.operacao_links_cliente (organizacao_id, empresa_id, processo_id, token_hash, rotulo,
    mostrar_minimo, criado_por, expira_em)
  values (org, p_empresa, p_processo, p_token_hash, btrim(p_rotulo), p_mostrar_minimo, p_usuario,
    now() + make_interval(days => p_dias))
  returning * into l;
  insert into public.operacao_portal_auditoria (evento, link_id, organizacao_id, processo_id, usuario_id, detalhe)
    values ('link_criado', l.id, org, p_processo, p_usuario,
      jsonb_build_object('dias', p_dias, 'mostrar_minimo', p_mostrar_minimo));
  return jsonb_build_object('id', l.id, 'expira_em', l.expira_em);
end $$;

create or replace function public.revogar_link_cliente(p_usuario uuid, p_link uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare l public.operacao_links_cliente;
begin
  select * into l from public.operacao_links_cliente where id = p_link for update;
  if l.id is null or public.portal_autorizar_gestao(p_usuario, l.empresa_id, l.processo_id) is null then
    raise sqlstate 'PT403' using message = 'Acesso não autorizado';
  end if;
  if l.revogado_em is null then
    update public.operacao_links_cliente set revogado_em = now(), revogado_por = p_usuario
      where id = l.id returning * into l;
    insert into public.operacao_portal_auditoria (evento, link_id, organizacao_id, processo_id, usuario_id)
      values ('link_revogado', l.id, l.organizacao_id, l.processo_id, p_usuario);
  end if;
  return jsonb_build_object('id', l.id, 'revogado_em', l.revogado_em);
end $$;

-- Público via servidor. Link inválido de qualquer tipo devolve null (mesma resposta).
create or replace function public.portal_ler(p_token_hash text, p_ip_hash text, p_pagina integer default 1)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  l public.operacao_links_cliente;
  pagina integer := greatest(coalesce(p_pagina, 1), 1);
  saida jsonb;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then raise sqlstate 'PT400' using message = 'Origem inválida'; end if;
  perform public.portal_limpar();
  if public.portal_estourou(p_ip_hash, 'ler:' || coalesce(p_token_hash, ''), 30) then
    return '{"limite":true}'::jsonb;
  end if;
  l := public.portal_link_valido(p_token_hash, p_ip_hash);
  if l.id is null then return null; end if;
  update public.operacao_links_cliente set ultimo_acesso_em = now() where id = l.id;
  insert into public.operacao_portal_auditoria (evento, link_id, organizacao_id, processo_id, ip_hash, detalhe)
    values ('acesso', l.id, l.organizacao_id, l.processo_id, p_ip_hash, jsonb_build_object('pagina', pagina));

  select jsonb_build_object(
    'empresa', jsonb_build_object('razao_social', e.razao_social),
    'processo', jsonb_build_object('numero', p.numero, 'objeto', p.objeto, 'orgao', p.orgao,
      'modalidade', p.modalidade, 'data_sessao', p.data_sessao, 'url_origem', p.url_origem),
    'expira_em', l.expira_em,
    'mostrar_minimo', l.mostrar_minimo,
    'pagina', pagina,
    'por_pagina', 200,
    'total_itens', (select count(*) from public.operacao_itens_resultado
      where processo_id = l.processo_id and organizacao_id = l.organizacao_id),
    'itens', coalesce((
      select jsonb_agg(v.visto || jsonb_build_object('id', v.id, 'versao', md5(v.visto::text), 'resposta', (
          select jsonb_build_object('decisao', a.decisao, 'observacao', a.observacao,
            'versao', a.versao, 'criado_em', a.criado_em)
            from public.operacao_aceites_item a where a.link_id = l.id and a.item_id = v.id
           order by a.criado_em desc, a.id desc limit 1)) order by v.ordem)
        from (select i.id, public.portal_visto_item(i, l.mostrar_minimo) visto,
                     row_number() over (order by i.tipo, length(i.identificador), i.identificador, i.id) ordem
                from public.operacao_itens_resultado i
               where i.processo_id = l.processo_id and i.organizacao_id = l.organizacao_id
               order by i.tipo, length(i.identificador), i.identificador, i.id
               offset (pagina - 1) * 200 limit 200) v), '[]'::jsonb),
    'aceites', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', h.item_id, 'identificador', h.visto->>'identificador',
          'decisao', h.decisao, 'observacao', h.observacao, 'criado_em', h.criado_em) order by h.criado_em desc, h.id desc)
        from (select * from public.operacao_aceites_item where link_id = l.id
               order by criado_em desc, id desc limit 50) h), '[]'::jsonb))
  into saida
  from public.operacao_processos p
  join public.operacao_empresas e on e.id = p.empresa_id and e.organizacao_id = p.organizacao_id
  where p.id = l.processo_id and p.organizacao_id = l.organizacao_id;
  return saida;
end $$;

-- Recusa auditada de portal_responder: devolve {erro, codigo} em vez de raise, para o COMMIT gravar o
-- contador de limite e o 'negado'. codigo: 'invalido' (HTTP 400) ou 'proibido' (HTTP 403).
create or replace function public.portal_recusar(l public.operacao_links_cliente, p_ip text, p_codigo text, p_erro text)
returns jsonb language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  perform public.portal_negar(l, p_ip, 'resposta_' || p_codigo);
  return jsonb_build_object('erro', p_erro, 'codigo', p_codigo);
end $$;
revoke all on function public.portal_recusar(public.operacao_links_cliente, text, text, text)
  from public, anon, authenticated, service_role;

-- p_respostas: [{"item_id":uuid,"decisao":"aprovado|recusado","versao":md5,"observacao":texto?}]
-- Tudo ou nada: versão divergente ou resposta inválida em qualquer item não grava nenhum.
-- Idempotente: a mesma resposta (link, item, versão, decisão e observação) repetida em até 10 minutos
-- não grava de novo (reenvio, duplo clique, duas abas). O lock do link serializa envios simultâneos.
create or replace function public.portal_responder(p_token_hash text, p_respostas jsonb, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  l public.operacao_links_cliente;
  r jsonb;
  i public.operacao_itens_resultado;
  item uuid;
  visto jsonb;
  vistos jsonb := '{}'::jsonb;
  divergentes jsonb := '[]'::jsonb;
  vistos_ids uuid[] := '{}';
  gravados integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('erro', 'Origem inválida', 'codigo', 'invalido');
  end if;
  perform public.portal_limpar();
  if public.portal_estourou(p_ip_hash, 'resp:' || coalesce(p_token_hash, ''), 10) then
    return '{"limite":true}'::jsonb;
  end if;
  l := public.portal_link_valido(p_token_hash, p_ip_hash);
  if l.id is null then return null; end if;
  perform 1 from public.operacao_links_cliente where id = l.id for update;
  if jsonb_typeof(p_respostas) is distinct from 'array' or jsonb_array_length(p_respostas) not between 1 and 200 then
    return public.portal_recusar(l, p_ip_hash, 'invalido', 'Envie de 1 a 200 respostas');
  end if;
  for r in select * from jsonb_array_elements(p_respostas) loop
    if jsonb_typeof(r) is distinct from 'object' or r - array['item_id', 'decisao', 'versao', 'observacao'] <> '{}'::jsonb
       or jsonb_typeof(r->'item_id') is distinct from 'string'
       or (r->>'item_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or (r->>'decisao') is null or (r->>'decisao') not in ('aprovado', 'recusado')
       or jsonb_typeof(r->'versao') is distinct from 'string' or (r->>'versao') !~ '^[0-9a-f]{32}$'
       or (r ? 'observacao' and jsonb_typeof(r->'observacao') not in ('string', 'null'))
       or length(r->>'observacao') > 1000 then
      return public.portal_recusar(l, p_ip_hash, 'invalido', 'Resposta inválida');
    end if;
    item := (r->>'item_id')::uuid;
    if item = any(vistos_ids) then return public.portal_recusar(l, p_ip_hash, 'invalido', 'Item repetido'); end if;
    vistos_ids := vistos_ids || item;
    select * into i from public.operacao_itens_resultado where id = item for share;
    if i.id is null or i.processo_id is distinct from l.processo_id or i.organizacao_id is distinct from l.organizacao_id then
      return public.portal_recusar(l, p_ip_hash, 'proibido', 'Item fora do processo do link');
    end if;
    visto := public.portal_visto_item(i, l.mostrar_minimo);
    if md5(visto::text) <> r->>'versao' then divergentes := divergentes || to_jsonb(item); end if;
    vistos := vistos || jsonb_build_object(item::text, visto);
  end loop;
  if jsonb_array_length(divergentes) > 0 then
    return jsonb_build_object('ok', false, 'divergentes', divergentes);
  end if;
  insert into public.operacao_aceites_item (link_id, organizacao_id, processo_id, item_id, decisao, observacao, visto, versao, ip_hash)
  select l.id, l.organizacao_id, l.processo_id, n.item_id, n.decisao, n.observacao, vistos->(n.item_id::text), n.versao, p_ip_hash
    from (select (e->>'item_id')::uuid item_id, e->>'decisao' decisao, nullif(btrim(e->>'observacao'), '') observacao,
                 e->>'versao' versao
            from jsonb_array_elements(p_respostas) e) n
   where not exists (select 1 from public.operacao_aceites_item a
                      where a.link_id = l.id and a.item_id = n.item_id and a.versao = n.versao and a.decisao = n.decisao
                        and a.observacao is not distinct from n.observacao and a.criado_em > now() - interval '10 minutes');
  get diagnostics gravados = row_count;
  update public.operacao_links_cliente set ultimo_acesso_em = now() where id = l.id;
  if gravados > 0 then
    insert into public.operacao_portal_auditoria (evento, link_id, organizacao_id, processo_id, ip_hash, detalhe)
      values ('resposta', l.id, l.organizacao_id, l.processo_id, p_ip_hash, jsonb_build_object('quantidade', gravados));
  end if;
  return jsonb_build_object('ok', true, 'gravados', gravados, 'repetidos', jsonb_array_length(p_respostas) - gravados);
end $$;

revoke all on function public.criar_link_cliente(uuid, uuid, uuid, text, text, integer, boolean),
  public.revogar_link_cliente(uuid, uuid),
  public.portal_ler(text, text, integer),
  public.portal_responder(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.criar_link_cliente(uuid, uuid, uuid, text, text, integer, boolean),
  public.revogar_link_cliente(uuid, uuid),
  public.portal_ler(text, text, integer),
  public.portal_responder(text, jsonb, text) to service_role;

commit;
notify pgrst, 'reload schema';


-- ========== operacao_perfil_empresa.sql ==========
-- Perfil da empresa e premissas padrão de preço (esteira, tarefa E1).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql.
-- Só cria objetos novos: não altera nem apaga dados existentes.
-- Logo no bucket privado operacao-documentos em {org}/{empresa}/perfil/...: as policies atuais
-- de storage.objects já cobrem; NÃO criar policy nova lá (fecha identificacao_empresa_habilitada()).
begin;
do $$ begin
 if to_regprocedure('public.pode_escrever_empresa_operacao(uuid,uuid)') is null
  or to_regprocedure('public.arquivo_no_escopo_operacao(text,uuid,uuid)') is null
  or to_regprocedure('public.preservar_escopo_operacao()') is null then
  raise exception 'Aplique antes seguranca_operacao.sql (01-aplicar.sql)';
 end if;
end $$;

create table if not exists public.operacao_perfil_empresa (
  empresa_id uuid primary key,
  organizacao_id uuid not null,
  nome_fantasia text check (nome_fantasia is null or length(nome_fantasia) between 1 and 180),
  telefone text check (telefone is null or length(telefone) between 8 and 30),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  inscricao_estadual text check (inscricao_estadual is null or length(inscricao_estadual) between 1 and 30),
  inscricao_municipal text check (inscricao_municipal is null or length(inscricao_municipal) between 1 and 30),
  porte text check (porte in ('mei', 'me', 'epp', 'demais')),
  regime_tributario text check (regime_tributario in ('mei', 'simples', 'presumido', 'real')),
  aliquota_efetiva numeric(7,3) check (aliquota_efetiva between 0 and 100),
  tributos_fonte text not null default 'manual' check (length(tributos_fonte) between 1 and 40),
  cpf_representante text check (cpf_representante ~ '^[0-9]{11}$'),
  banco jsonb check (banco is null or jsonb_typeof(banco) = 'object'),
  proposta_padrao jsonb not null default '{}'::jsonb check (jsonb_typeof(proposta_padrao) = 'object'
    and (proposta_padrao - array['validade', 'pagamento', 'prazo_entrega']) = '{}'::jsonb),
  logo_caminho text,
  logo_hash text check (logo_hash ~ '^[0-9a-f]{64}$'),
  versao bigint not null default 1,
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  check ((logo_caminho is null) = (logo_hash is null)),
  check (public.arquivo_no_escopo_operacao(logo_caminho, organizacao_id, empresa_id)
    and (logo_caminho is null or split_part(logo_caminho, '/', 3) = 'perfil')),
  foreign key (empresa_id, organizacao_id)
    references public.operacao_empresas(id, organizacao_id) on delete cascade
);
comment on table public.operacao_perfil_empresa is
  'Perfil da empresa (preenchido uma vez). LGPD: cpf_representante e banco NUNCA vão para IA nem para logs. '
  'Leitura só para gestor/operador (pode_escrever_empresa_operacao): o papel leitura não vê CPF nem dados bancários.';

create table if not exists public.operacao_premissas_empresa (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null,
  -- '*' vale para qualquer segmento/UF; segmento guardado já normalizado (minúsculas, sem bordas).
  segmento text not null default '*' check (length(segmento) between 1 and 80 and segmento = lower(btrim(segmento))),
  uf text not null default '*' check (uf = '*' or uf ~ '^[A-Z]{2}$'),
  tributos_percentual numeric(7,3) check (tributos_percentual between 0 and 100),
  frete_percentual numeric(7,3) check (frete_percentual between 0 and 100),
  garantia_percentual numeric(7,3) check (garantia_percentual between 0 and 100),
  margem_percentual numeric(7,3) check (margem_percentual between 0 and 100),
  margem_minima_percentual numeric(7,3) check (margem_minima_percentual between 0 and 100),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  check (margem_minima_percentual <= margem_percentual),
  unique (empresa_id, segmento, uf),
  foreign key (empresa_id, organizacao_id)
    references public.operacao_empresas(id, organizacao_id) on delete cascade
);

-- versao sobe a cada UPDATE; quem grava é o JWT (o servidor com service_role informa atualizado_por).
create or replace function public.carimbar_perfil_empresa()
returns trigger language plpgsql set search_path = '' as $$
begin
 new.atualizado_em := now();
 new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
 new.versao := case when TG_OP = 'UPDATE' then old.versao + 1 else 1 end;
 return new;
end $$;
drop trigger if exists carimbar_perfil_empresa on public.operacao_perfil_empresa;
create trigger carimbar_perfil_empresa before insert or update on public.operacao_perfil_empresa
  for each row execute function public.carimbar_perfil_empresa();

create or replace function public.limitar_premissas_empresa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 new.atualizado_em := now();
 new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
 if TG_OP = 'INSERT' then
  -- Serializa inserções da mesma empresa para a contagem não furar o teto.
  perform pg_advisory_xact_lock(hashtext('premissas:' || new.empresa_id::text));
  if (select count(*) from public.operacao_premissas_empresa where empresa_id = new.empresa_id) >= 50 then
   raise exception 'Limite de 50 premissas por empresa' using errcode = 'P0001';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists limitar_premissas_empresa on public.operacao_premissas_empresa;
create trigger limitar_premissas_empresa before insert or update on public.operacao_premissas_empresa
  for each row execute function public.limitar_premissas_empresa();

-- O Padrão (*|*) alimenta a esteira: usuário (JWT) não apaga, só edita. Apagar a empresa ainda leva
-- tudo em cascata (a empresa já não existe quando a cascata chega aqui); service_role sem JWT passa.
create or replace function public.proteger_premissa_padrao()
returns trigger language plpgsql set search_path = '' as $$
begin
 if old.segmento = '*' and old.uf = '*' and auth.uid() is not null
    and exists (select 1 from public.operacao_empresas e where e.id = old.empresa_id) then
  raise exception 'A premissa Padrão não pode ser removida; edite os valores' using errcode = 'P0001';
 end if;
 return old;
end $$;
revoke all on function public.proteger_premissa_padrao() from public, anon, authenticated, service_role;
drop trigger if exists proteger_premissa_padrao on public.operacao_premissas_empresa;
create trigger proteger_premissa_padrao before delete on public.operacao_premissas_empresa
  for each row execute function public.proteger_premissa_padrao();

-- UF da sede: a esteira compara com a UF das certidões pedidas (marcarIncomuns). O robô lê só esta coluna.
alter table public.operacao_perfil_empresa
  add column if not exists uf_sede text check (uf_sede ~ '^[A-Z]{2}$');

-- Caminho da logo igual à regra da Function (tipoCaminhoLogo): <org>/<empresa>/perfil/logo-<hash>.(png|jpg|jpeg),
-- com o hash do nome igual a logo_hash. Barra '..', outra pasta ou outro nome.
alter table public.operacao_perfil_empresa drop constraint if exists operacao_perfil_empresa_logo_caminho_check;
alter table public.operacao_perfil_empresa add constraint operacao_perfil_empresa_logo_caminho_check
  check (logo_caminho is null or logo_caminho ~ ('^' || organizacao_id::text || '/' || empresa_id::text
    || '/perfil/logo-' || logo_hash || '\.(png|jpe?g)$'));

-- Escopo não muda depois de criado (mesma regra de documentos e processos).
drop trigger if exists preservar_escopo_operacao on public.operacao_perfil_empresa;
create trigger preservar_escopo_operacao before update on public.operacao_perfil_empresa
  for each row execute function public.preservar_escopo_operacao();
drop trigger if exists preservar_escopo_operacao on public.operacao_premissas_empresa;
create trigger preservar_escopo_operacao before update on public.operacao_premissas_empresa
  for each row execute function public.preservar_escopo_operacao();
revoke all on function public.carimbar_perfil_empresa(), public.limitar_premissas_empresa()
  from public, anon, authenticated, service_role;

-- Mais específica primeiro: (seg+UF) > (seg+*) > (*+UF) > (*+*). Invoker: respeita a RLS.
create or replace function public.premissa_aplicavel(p_empresa uuid, p_segmento text, p_uf text)
returns public.operacao_premissas_empresa language sql stable set search_path = '' as $$
 select p.* from public.operacao_premissas_empresa p
 where p.empresa_id = p_empresa
   and p.segmento in (lower(btrim(p_segmento)), '*')
   and p.uf in (upper(btrim(p_uf)), '*')
 order by (p.segmento <> '*') desc, (p.uf <> '*') desc
 limit 1;
$$;
revoke all on function public.premissa_aplicavel(uuid, text, text) from public, anon;
grant execute on function public.premissa_aplicavel(uuid, text, text) to authenticated, service_role;

alter table public.operacao_perfil_empresa enable row level security;
alter table public.operacao_premissas_empresa enable row level security;
revoke all on public.operacao_perfil_empresa, public.operacao_premissas_empresa from public, anon, authenticated;
grant select, insert, update, delete on public.operacao_perfil_empresa, public.operacao_premissas_empresa to authenticated;
grant all on public.operacao_perfil_empresa, public.operacao_premissas_empresa to service_role;
drop policy if exists operacao_perfil_empresa_leitura on public.operacao_perfil_empresa;
drop policy if exists operacao_perfil_empresa_escrita on public.operacao_perfil_empresa;
drop policy if exists operacao_premissas_empresa_leitura on public.operacao_premissas_empresa;
drop policy if exists operacao_premissas_empresa_escrita on public.operacao_premissas_empresa;
-- LGPD: CPF e banco não ficam visíveis para o papel leitura (ver comentário da tabela).
create policy operacao_perfil_empresa_leitura on public.operacao_perfil_empresa for select to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_perfil_empresa_escrita on public.operacao_perfil_empresa for all to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_premissas_empresa_leitura on public.operacao_premissas_empresa for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_premissas_empresa_escrita on public.operacao_premissas_empresa for all to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));

notify pgrst, 'reload schema';
commit;


-- ========== operacao_exigencias.sql ==========
-- Exigências do edital por processo + situação calculada (esteira, tarefa E3).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql.
-- Só cria objetos novos: não altera nem apaga dados existentes.
-- Quem grava as exigências é o robô (service_role). O usuário só responde (coluna resposta).
begin;
do $$ begin
 if to_regprocedure('public.pode_acessar_processo_operacao(uuid,uuid)') is null
  or to_regprocedure('public.pode_escrever_processo_operacao(uuid,uuid)') is null
  or to_regclass('public.operacao_processos_id_empresa_org_idx') is null then
  raise exception 'Aplique antes o 01-aplicar.sql';
 end if;
end $$;

create table if not exists public.operacao_exigencias_processo (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null,
  processo_id uuid not null,
  codigo text not null check (length(codigo) between 1 and 40),
  -- Mesmas 11 categorias de netlify/functions/_exigencias.js.
  categoria text not null check (categoria in ('juridica', 'fiscal', 'tecnica', 'economica', 'declaracao',
    'proposta', 'amostra', 'visita', 'garantia', 'credenciamento', 'execucao')),
  texto text not null check (length(texto) between 1 and 2000),
  documento text check (documento is null or length(documento) between 1 and 300),
  pagina integer check (pagina > 0),
  trecho text check (length(trecho) <= 1200),
  origem text not null check (origem in ('ambas', 'ia', 'ia_sem_trecho', 'leitura_deterministica', 'segunda_passada', 'manual')),
  incomum boolean not null default false,
  motivo_incomum text check (length(motivo_incomum) <= 500),
  -- Casa com operacao_documentos.tipo da mesma empresa (sem diferenciar caixa e bordas); nulo = "conferir".
  tipo_documento text check (tipo_documento is null or length(tipo_documento) between 1 and 120),
  modelo_declaracao text check (modelo_declaracao is null or length(modelo_declaracao) between 1 and 120),
  resposta text not null default 'pendente' check (resposta in ('pendente', 'atendo', 'nao_se_aplica', 'vou_providenciar')),
  respondido_por uuid references auth.users(id) on delete set null,
  respondido_em timestamptz,
  gerado_em timestamptz not null default now(),
  unique (processo_id, codigo),
  foreign key (processo_id, empresa_id, organizacao_id)
    references public.operacao_processos(id, empresa_id, organizacao_id) on delete cascade
);
-- Modelo literal do anexo do edital para a declaração (texto externo, gravado só pelo robô; o usuário não tem grant).
-- Fonte = {documento, pagina}. Colunas novas por alter: a tabela já existe nos bancos aplicados antes.
alter table public.operacao_exigencias_processo add column if not exists modelo_texto text
  check (modelo_texto is null or length(modelo_texto) between 1 and 20000);
alter table public.operacao_exigencias_processo add column if not exists modelo_fonte jsonb
  check (modelo_fonte is null or jsonb_typeof(modelo_fonte) = 'object');
create index if not exists operacao_exigencias_processo_empresa_tipo_idx
  on public.operacao_exigencias_processo (empresa_id, tipo_documento);

-- Quem respondeu sai do JWT; o usuário não tem grant nessas colunas.
create or replace function public.carimbar_resposta_exigencia()
returns trigger language plpgsql set search_path = '' as $$
begin
 if new.resposta is distinct from old.resposta then
  new.respondido_por := coalesce(auth.uid(), new.respondido_por);
  new.respondido_em := now();
 end if;
 return new;
end $$;
revoke all on function public.carimbar_resposta_exigencia() from public, anon, authenticated, service_role;
drop trigger if exists carimbar_resposta_exigencia on public.operacao_exigencias_processo;
create trigger carimbar_resposta_exigencia before update on public.operacao_exigencias_processo
  for each row execute function public.carimbar_resposta_exigencia();

alter table public.operacao_exigencias_processo enable row level security;
revoke all on public.operacao_exigencias_processo from public, anon, authenticated;
grant select on public.operacao_exigencias_processo to authenticated;
grant update (resposta) on public.operacao_exigencias_processo to authenticated;
grant all on public.operacao_exigencias_processo to service_role;
drop policy if exists operacao_exigencias_leitura on public.operacao_exigencias_processo;
drop policy if exists operacao_exigencias_resposta on public.operacao_exigencias_processo;
create policy operacao_exigencias_leitura on public.operacao_exigencias_processo for select to authenticated
  using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_exigencias_resposta on public.operacao_exigencias_processo for update to authenticated
  using (public.pode_escrever_processo_operacao(organizacao_id, processo_id))
  with check (public.pode_escrever_processo_operacao(organizacao_id, processo_id));

-- Calculada na leitura: o vencimento muda com o tempo. Invoker: RLS de cada tabela vale.
-- Documento = o mais recente (emissão, depois cadastro) do mesmo tipo na mesma empresa.
-- drop antes: e.* ganhou colunas no meio da lista e "create or replace" não aceita isso. Grants refeitos abaixo.
drop view if exists public.operacao_exigencias_situacao;
create or replace view public.operacao_exigencias_situacao with (security_invoker = on) as
select e.*, d.id as documento_empresa_id, d.titulo as documento_empresa_titulo, d.vencimento as documento_vencimento,
  case
   when e.tipo_documento is null then 'conferir'
   when d.id is null then 'falta'
   when d.vencimento < coalesce((p.data_sessao at time zone 'America/Sao_Paulo')::date, current_date) then 'vence_antes_da_sessao'
   else 'vigente'
  end as situacao
from public.operacao_exigencias_processo e
join public.operacao_processos p on p.id = e.processo_id and p.organizacao_id = e.organizacao_id
left join lateral (
  select x.id, x.titulo, x.vencimento from public.operacao_documentos x
  where x.empresa_id = e.empresa_id and x.organizacao_id = e.organizacao_id and lower(btrim(x.tipo)) = lower(btrim(e.tipo_documento))
  order by x.emissao desc nulls last, x.criado_em desc
  limit 1
) d on true;
revoke all on public.operacao_exigencias_situacao from public, anon, authenticated;
grant select on public.operacao_exigencias_situacao to authenticated, service_role;

notify pgrst, 'reload schema';
commit;


-- ========== operacao_esteira.sql ==========
-- Esteira automática do edital: tarefas, gatilho de interesse e origem 'interesse' na fila (tarefa E2).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql, operacao_itens_proposta.sql,
-- operacao_perfil_empresa.sql e fila_dossies.sql. Não apaga dados; só acrescenta colunas e objetos.
-- Regra fixa: o gatilho NUNCA toca operacao_processos.atualizado_em (controle de concorrência do kit e do checklist).
begin;
do $$ begin
 if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null
  or to_regclass('public.operacao_processos_id_empresa_org_idx') is null
  or to_regprocedure('public.premissa_aplicavel(uuid,text,text)') is null
  or to_regclass('public.fila_dossies') is null
  or not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'operacao_processos' and column_name = 'margem_minima_percentual') then
  raise exception 'Aplique antes 01-aplicar.sql, operacao_itens_proposta.sql, operacao_perfil_empresa.sql e fila_dossies.sql';
 end if;
end $$;

-- Uma linha por etapa do robô (scripts/esteira_processos.js). Só o service_role e o gatilho escrevem.
create table if not exists public.operacao_esteira_tarefas (
  organizacao_id uuid not null,
  empresa_id uuid not null,
  processo_id uuid not null,
  etapa text not null,
  estado text not null default 'pendente' check (estado in ('pendente', 'executando', 'feito', 'aguardando_leitura', 'falhou')),
  tentativas integer not null default 0 check (tentativas >= 0),
  proximo_em timestamptz not null default now(),
  detalhe jsonb not null default '{}'::jsonb check (jsonb_typeof(detalhe) = 'object'),
  erro text check (length(erro) <= 2000),
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  primary key (processo_id, etapa),
  foreign key (processo_id, empresa_id, organizacao_id)
    references public.operacao_processos(id, empresa_id, organizacao_id) on delete cascade
);
-- Etapas aceitas ('historico' = licitação anterior; 'resultado' e 'contrato' = etapas 7 e 8, scripts/esteira_contratos.js). Recriada por nome para a
-- reaplicação trocar a regra antiga (que vinha inline no create table) sem apagar linha nenhuma.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid = 'public.operacao_esteira_tarefas'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%etapa%' loop
  execute format('alter table public.operacao_esteira_tarefas drop constraint %I', c.conname);
 end loop;
end $$;
alter table public.operacao_esteira_tarefas add constraint operacao_esteira_tarefas_etapa_check
  check (etapa in ('itens', 'exigencias', 'cruzamento', 'historico', 'resultado', 'contrato'));
create index if not exists operacao_esteira_tarefas_fila_idx
  on public.operacao_esteira_tarefas (proximo_em) where estado in ('pendente', 'aguardando_leitura');

alter table public.operacao_esteira_tarefas enable row level security;
revoke all on public.operacao_esteira_tarefas from public, anon, authenticated;
grant select on public.operacao_esteira_tarefas to authenticated;
grant all on public.operacao_esteira_tarefas to service_role;
drop policy if exists operacao_esteira_tarefas_leitura on public.operacao_esteira_tarefas;
create policy operacao_esteira_tarefas_leitura on public.operacao_esteira_tarefas for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));

-- Fila de dossiês: 'interesse' entra junto dos valores existentes ('clique', 'boletim').
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid = 'public.fila_dossies'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%origem%' loop
  execute format('alter table public.fila_dossies drop constraint %I', c.conname);
 end loop;
end $$;
alter table public.fila_dossies add constraint fila_dossies_origem_check
  check (origem in ('clique', 'boletim', 'interesse'));

-- De onde vieram as premissas do processo; nulo = ninguém informou.
alter table public.operacao_processos
  add column if not exists premissas_fonte text check (premissas_fonte in ('manual', 'padrao')),
  add column if not exists premissas_aplicadas_em timestamptz;

create or replace function public.iniciar_esteira_processo()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
 v_uf text := '*';
 v_obs constant text := 'calculado pela regra legal; confira o edital';
 p public.operacao_premissas_empresa;
 d date;
 n int := 0;
 v_venc timestamptz;
 cat record;
 v_primeira boolean;
 v_interesse boolean;
begin
 -- (a) Premissas padrão só quando as 5 do processo estão vazias; digitada à mão nunca é sobrescrita.
 if new.frete is null and new.tributos_percentual is null and new.garantia_percentual is null
    and new.margem_percentual is null and new.margem_minima_percentual is null then
  -- O processo não guarda UF; o painel não grava edital.uf. A UF vem do edital coletado, se ainda estiver lá.
  if to_regclass('public.oportunidades_abertas') is not null then
   select coalesce(max(upper(btrim(o.uf))), '*') into v_uf from public.oportunidades_abertas o
    where o.numero_controle_pncp = new.origem_externa_id;
   if v_uf !~ '^[A-Z]{2}$' then v_uf := '*'; end if;
  end if;
  p := public.premissa_aplicavel(new.empresa_id, '*', v_uf);
  if p.id is not null then
   update public.operacao_processos set
     frete = case when new.valor_estimado is not null and p.frete_percentual is not null
                  then round(new.valor_estimado * p.frete_percentual / 100, 2) end,
     tributos_percentual = p.tributos_percentual,
     garantia_percentual = p.garantia_percentual,
     margem_percentual = p.margem_percentual,
     -- O processo aceita até 99,999 (operacao_itens_proposta.sql); 100 não pode derrubar o cadastro.
     margem_minima_percentual = case when p.margem_minima_percentual < 100 then p.margem_minima_percentual end,
     premissas_fonte = 'padrao', premissas_aplicadas_em = now()
   where id = new.id and frete is null and tributos_percentual is null and garantia_percentual is null
     and margem_percentual is null and margem_minima_percentual is null;
  end if;
 end if;

 -- (b) Art. 164 da Lei 14.133: 3 dias úteis antes da abertura, sem feriados (estimativa).
 if new.data_sessao is not null then
  d := (new.data_sessao at time zone 'America/Sao_Paulo')::date;
  while n < 3 loop
   d := d - 1;
   if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  v_venc := (d + time '23:59') at time zone 'America/Sao_Paulo';
  for cat in select * from (values ('impugnacao', 'Impugnação'), ('esclarecimento', 'Esclarecimento')) v(categoria, titulo) loop
   insert into public.operacao_prazos_processo (organizacao_id, processo_id, categoria, titulo, vencimento, observacoes)
   select new.organizacao_id, new.id, cat.categoria, cat.titulo, v_venc, v_obs
   where not exists (select 1 from public.operacao_prazos_processo x
                      where x.processo_id = new.id and x.categoria = cat.categoria and x.observacoes = v_obs);
  end loop;
 end if;

 -- (c) Tarefas do robô e o edital na fila. Primeira entrada = o processo ainda não tinha tarefas
 -- (INSERT ou primeira vez no Funil); troca de status depois disso não sobe prioridade de novo.
 -- Serializa a mesma organização para a contagem do teto não furar com inserções paralelas.
 perform pg_advisory_xact_lock(hashtext('esteira:' || new.organizacao_id::text));
 v_primeira := not exists (select 1 from public.operacao_esteira_tarefas t where t.processo_id = new.id);
 insert into public.operacao_esteira_tarefas (organizacao_id, empresa_id, processo_id, etapa, criado_por)
 select new.organizacao_id, new.empresa_id, new.id, e, coalesce(auth.uid(), new.criado_por)
   from unnest(array['itens', 'exigencias', 'cruzamento', 'historico', 'resultado', 'contrato']) e
 on conflict do nothing;
 -- 'interesse' (lê todos os anexos, passa à frente na IA) só para edital que o robô coletou e com teto
 -- de 20 processos novos por organização em 24 h; fora disso entra como 'clique', sem rebaixar quem já está.
 v_interesse := v_primeira and (select count(distinct t.processo_id) from public.operacao_esteira_tarefas t
   where t.organizacao_id = new.organizacao_id and t.criado_em > now() - interval '1 day') <= 20;
 if v_interesse and to_regclass('public.oportunidades_abertas') is not null then
  v_interesse := exists (select 1 from public.oportunidades_abertas o where o.numero_controle_pncp = new.origem_externa_id);
 end if;
 if v_interesse then
  insert into public.fila_dossies (numero_controle_pncp, origem) values (new.origem_externa_id, 'interesse')
  on conflict (numero_controle_pncp) do update set origem = 'interesse'
   where public.fila_dossies.origem <> 'interesse';
 else
  insert into public.fila_dossies (numero_controle_pncp, origem) values (new.origem_externa_id, 'clique')
  on conflict (numero_controle_pncp) do nothing;
 end if;
 return null;
end $$;
revoke all on function public.iniciar_esteira_processo() from public, anon, authenticated, service_role;

-- Só processo com ID do PNCP e status ativo; status final não dispara e não apaga nada.
drop trigger if exists iniciar_esteira_processo on public.operacao_processos;
create trigger iniciar_esteira_processo after insert or update of status on public.operacao_processos
  for each row when (new.origem_externa_id ~ '^\d{14}-1-\d+/\d{4}$' and new.status not in ('arquivado', 'perdido', 'contratado'))
  execute function public.iniciar_esteira_processo();

-- Autor do processo vem do JWT: o cliente não forja criado_por (o robô com service_role mantém o informado).
create or replace function public.carimbar_criador_processo()
returns trigger language plpgsql set search_path = '' as $$
begin
 new.criado_por := coalesce(auth.uid(), new.criado_por);
 return new;
end $$;
revoke all on function public.carimbar_criador_processo() from public, anon, authenticated, service_role;
drop trigger if exists carimbar_criador_processo on public.operacao_processos;
create trigger carimbar_criador_processo before insert on public.operacao_processos
  for each row execute function public.carimbar_criador_processo();

-- "Tentar de novo" do checklist: gestor/operador devolve à fila uma etapa que falhou.
-- Teto de 3 recolocações por processo/etapa por dia (horário de Brasília), contadas em detalhe.recolocacoes.
-- Processo inexistente, de outra organização ou papel leitura recebem o mesmo erro (não revela se existe).
create or replace function public.esteira_tentar_de_novo(p_processo uuid, p_etapa text)
returns void language plpgsql security definer set search_path = '' as $$
declare
 t public.operacao_esteira_tarefas;
 v_hoje text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
 v_n int;
begin
 select * into t from public.operacao_esteira_tarefas where processo_id = p_processo and etapa = p_etapa for update;
 if t.processo_id is null or not public.pode_escrever_empresa_operacao(t.organizacao_id, t.empresa_id) then
  raise exception 'Seu acesso não permite tentar de novo esta etapa' using errcode = '42501';
 end if;
 if t.estado <> 'falhou' then
  raise exception 'Só uma etapa que falhou pode ser tentada de novo' using errcode = 'P0001';
 end if;
 v_n := case when t.detalhe->'recolocacoes'->>'dia' = v_hoje
             then coalesce((t.detalhe->'recolocacoes'->>'total')::int, 0) else 0 end;
 if v_n >= 3 then
  raise exception 'Esta etapa já foi tentada de novo 3 vezes hoje. Tente amanhã ou fale com o suporte' using errcode = 'P0001';
 end if;
 update public.operacao_esteira_tarefas
    set estado = 'pendente', tentativas = 0, proximo_em = now(), erro = null,
        detalhe = t.detalhe || jsonb_build_object('recolocacoes', jsonb_build_object('dia', v_hoje, 'total', v_n + 1))
  where processo_id = p_processo and etapa = p_etapa;
end $$;
revoke all on function public.esteira_tentar_de_novo(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.esteira_tentar_de_novo(uuid, text) to authenticated;

-- O robô regrava detalhe inteiro; a contagem de recolocações sobrevive para o teto diário não zerar.
create or replace function public.preservar_recolocacoes_esteira()
returns trigger language plpgsql set search_path = '' as $$
begin
 if old.detalhe ? 'recolocacoes' and not new.detalhe ? 'recolocacoes' then
  new.detalhe := new.detalhe || jsonb_build_object('recolocacoes', old.detalhe->'recolocacoes');
 end if;
 return new;
end $$;
revoke all on function public.preservar_recolocacoes_esteira() from public, anon, authenticated, service_role;
drop trigger if exists preservar_recolocacoes_esteira on public.operacao_esteira_tarefas;
create trigger preservar_recolocacoes_esteira before update of detalhe on public.operacao_esteira_tarefas
  for each row execute function public.preservar_recolocacoes_esteira();

-- Processos que já tinham tarefas antes das etapas 7 e 8 ganham as duas (idempotente; não mexe em operacao_processos).
insert into public.operacao_esteira_tarefas (organizacao_id, empresa_id, processo_id, etapa, criado_por)
select t.organizacao_id, t.empresa_id, t.processo_id, e, t.criado_por
  from public.operacao_esteira_tarefas t cross join unnest(array['resultado', 'contrato']) e
 where t.etapa = 'itens'
on conflict do nothing;

notify pgrst, 'reload schema';
commit;


-- ========== operacao_kit_modelos.sql ==========
-- Kit: código do modelo da declaração e formato da proposta (esteira, tarefa E11).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql (kit_documentos.sql).
-- Não altera gravar_kit_documento (assinatura e corpo conferidos pelo 02/verificar_kit_prepublicacao)
-- nem cria policy, trigger ou grant de escrita na tabela do kit: o gate do kit continua igual.
begin;
do $$ begin
 if to_regclass('public.operacao_kit_documentos') is null
  or to_regprocedure('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)') is null then
  raise exception 'Aplique antes kit_documentos.sql (01-aplicar.sql)';
 end if;
end $$;

-- modelo_codigo: código da biblioteca (declaracoes-modelos.js), 'edital' (texto literal do edital) ou 'livre'.
-- Nulo = peça antiga/manual, exibida como 'livre'. Só declaração tem modelo.
alter table public.operacao_kit_documentos add column if not exists modelo_codigo text;
-- formato: 1 = proposta em texto corrido (todas as peças existentes); 2 = proposta em tabela.
-- O add com default 1 fixa as linhas existentes em 1; só as peças criadas depois nascem em 2.
alter table public.operacao_kit_documentos add column if not exists formato smallint not null default 1;
alter table public.operacao_kit_documentos alter column formato set default 2;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='operacao_kit_documentos_modelo_codigo_chk'
  and conrelid='public.operacao_kit_documentos'::regclass) then
  alter table public.operacao_kit_documentos add constraint operacao_kit_documentos_modelo_codigo_chk
   check (modelo_codigo is null or (tipo='declaracao' and modelo_codigo ~ '^(edital|livre|[A-Z][A-Z0-9_]{1,59})$'));
 end if;
 if not exists(select 1 from pg_constraint where conname='operacao_kit_documentos_formato_chk'
  and conrelid='public.operacao_kit_documentos'::regclass) then
  alter table public.operacao_kit_documentos add constraint operacao_kit_documentos_formato_chk check (formato in (1,2));
 end if;
end $$;

-- Rascunho novo de declaração com modelo, numa transação: a validação, o escopo, a autoria e a
-- idempotência por id continuam todos em gravar_kit_documento; aqui só se carimba modelo_codigo.
-- Não toca atualizado_em (o carimbo é a mesma intenção da criação).
create or replace function public.gravar_kit_declaracao_modelo(
 p_documento uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid,p_usuario uuid,p_dados jsonb,p_modelo text
) returns public.operacao_kit_documentos language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare d public.operacao_kit_documentos;
begin
 if p_modelo is null or p_modelo !~ '^(edital|livre|[A-Z][A-Z0-9_]{1,59})$'
 then raise sqlstate 'PT400' using message='Modelo inválido';end if;
 d:=public.gravar_kit_documento(p_documento,p_empresa,p_processo,p_organizacao,p_usuario,0,'declaracao','salvar',p_dados);
 if d.modelo_codigo is null then
  update public.operacao_kit_documentos set modelo_codigo=p_modelo where id=d.id returning * into d;
 elsif d.modelo_codigo<>p_modelo then
  raise sqlstate 'PT409' using message='Modelo divergente';
 end if;
 return d;
end $$;
revoke all on function public.gravar_kit_declaracao_modelo(uuid,uuid,uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.gravar_kit_declaracao_modelo(uuid,uuid,uuid,uuid,uuid,jsonb,text) to service_role;

notify pgrst, 'reload schema';
commit;


-- ========== importacao_item_pncp_numero_int32.sql ==========
-- Importação de itens do PNCP: aceita qualquer numeroItem do PNCP (inteiro de 32 bits, 1..2147483647).
-- Motivo: compras da Licitanet (ex. 04274064000131-1-000035/2026) usam números como 8184615, e o limite antigo
-- (1..1000000) respondia HTTP 400 e deixava a tarefa "itens" da esteira pendente para sempre.
-- numero_item (operacao_origens_pncp) e p_numero já são integer: nenhuma coluna muda.
-- Idempotente: só troca o corpo de gravar_importacao_pncp (mesma assinatura e permissões); o resto do corpo é
-- idêntico ao de importacao_item_pncp.sql. Aplicar DEPOIS de importacao_item_pncp.sql (ou do 01-aplicar.sql).
begin;
set local lock_timeout = '5s';
create or replace function public.gravar_importacao_pncp(p_usuario uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid,
 p_compra text,p_numero integer,p_url text,p_hash text,p_item jsonb,p_snapshot jsonb,p_referencia jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare origem public.operacao_origens_pncp; item uuid; estado_saida text; processo public.operacao_processos;
begin
 select * into processo from public.operacao_processos where id=p_processo and empresa_id=p_empresa and organizacao_id=p_organizacao for update;
 if processo.id is null then raise sqlstate 'PT404' using message='Processo indisponível';end if;
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
 where c.id=p_usuario and c.status='aprovado' and m.papel in('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)
 and e.id=p_empresa and e.ativo and e.organizacao_id=p_organizacao) then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 if p_referencia is distinct from jsonb_build_object('url_origem',nullif(processo.url_origem,''),'origem_externa_id',nullif(processo.origem_externa_id,''),'numero',nullif(processo.numero,'')) then raise sqlstate 'PT409' using message='Referência do processo alterada';end if;
 if p_compra is null or p_compra!~'^\d{14}-1-[1-9]\d*/\d{4}$' or p_numero not between 1 and 2147483647
 or p_url is distinct from 'https://pncp.gov.br/api/pncp/v1/orgaos/'||split_part(p_compra,'-',1)||'/compras/'||split_part(p_compra,'/',2)||'/'||split_part(split_part(p_compra,'-',3),'/',1)||'/itens/'||p_numero::text
 or p_hash is null or p_hash!~'^[a-f0-9]{64}$' or jsonb_typeof(p_item) is distinct from 'object' or p_item-array['numero','descricao','quantidade','unidade']<>'{}'::jsonb
 or p_item->>'numero' is distinct from p_numero::text or jsonb_typeof(p_item->'descricao') is distinct from 'string' or jsonb_typeof(p_item->'unidade') is distinct from 'string' or jsonb_typeof(p_item->'quantidade') is distinct from 'string' or length(p_item->>'descricao') not between 1 and 10000
 or length(p_item->>'unidade') not between 1 and 100 or (p_item->>'quantidade')!~'^(0|[1-9]\d{0,11})(\.\d{1,3})?$'
 or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>400000
 then raise sqlstate 'PT400' using message='Observação inválida';end if;
 if (p_item->>'quantidade')::numeric<=0 then raise sqlstate 'PT400' using message='Quantidade inválida';end if;
 select * into origem from public.operacao_origens_pncp where processo_id=p_processo and compra=p_compra and numero_item=p_numero for update;
 if origem.item_id is null then
  -- Não ligar automaticamente lançamento manual por identificador textual.
  if exists(select 1 from public.operacao_itens_resultado where processo_id=p_processo and organizacao_id=p_organizacao and tipo='item' and identificador=p_numero::text)
  then return jsonb_build_object('estado','colisao_manual');end if;
  insert into public.operacao_itens_resultado(organizacao_id,processo_id,tipo,identificador,descricao,quantidade,fonte_oficial)
  values(p_organizacao,p_processo,'item',p_numero::text,p_item->>'descricao',(p_item->>'quantidade')::numeric,p_url) returning id into item;
  insert into public.operacao_origens_pncp(item_id,organizacao_id,processo_id,empresa_id,compra,numero_item,url,hash_aplicado,hash_atual,estado)
  values(item,p_organizacao,p_processo,p_empresa,p_compra,p_numero,p_url,p_hash,p_hash,'importado');estado_saida:='importado';
 else
  item:=origem.item_id;estado_saida:=case when origem.hash_aplicado=p_hash then 'inalterado' else 'fonte_alterada' end;
  update public.operacao_origens_pncp set hash_atual=p_hash,estado=case when origem.hash_aplicado=p_hash then 'importado' else 'fonte_alterada' end,observado_em=clock_timestamp() where item_id=item;
  -- Oferta, marca/modelo, quantidade e texto do cadastro permanecem intocados.
 end if;
 insert into public.operacao_observacoes_pncp(item_id,hash,snapshot) values(item,p_hash,p_snapshot) on conflict(item_id,hash) do nothing;
 return jsonb_build_object('itemId',item,'estado',estado_saida,'hash',p_hash,'observadoEm',clock_timestamp());
end $$;
revoke all on function public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb) to service_role;
commit;
notify pgrst,'reload schema';


-- ========== operacao_itens_numero_ordem.sql ==========
-- Ordem dos itens do processo pelo número (edital com mais de 100 itens).
-- A paginação era por id (uuid aleatório): a 1ª página não trazia os menores números. numero_ordem é o
-- identificador quando ele é só dígitos (até 18, cabe em bigint), senão null; a lista pagina por
-- (numero_ordem nulls last, id). Coluna gerada: não passa por gatilho e não toca atualizado_em (o revisaoHash
-- do kit usa atualizado_em; peça revisada continua válida). O select fixo do kit não lê esta coluna.
-- Idempotente. Aplicar depois de operacao_acompanhamento.sql (tabela) e antes de publicar o código que ordena por ela.
begin;
set local lock_timeout = '5s';
alter table public.operacao_itens_resultado add column if not exists numero_ordem bigint
  generated always as (case when identificador ~ '^[0-9]{1,18}$' then identificador::bigint end) stored;
create index if not exists operacao_itens_resultado_ordem_idx
  on public.operacao_itens_resultado (processo_id, organizacao_id, numero_ordem, id);
commit;
notify pgrst,'reload schema';


-- ========== operacao_catalogo_produtos.sql ==========
-- Catálogo de produtos da empresa (custo, marca, modelo, fabricante, fornecedor, foto).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql.
-- Só cria objetos novos: não altera nem apaga dados existentes.
-- Foto no bucket privado operacao-documentos em {org}/{empresa}/catalogo/<sha256>.(png|jpg|jpeg): as policies
-- atuais de storage.objects já cobrem (escrita_arquivo_operacao); NÃO criar policy nova lá.
begin;
do $$ begin
 if to_regprocedure('public.pode_escrever_empresa_operacao(uuid,uuid)') is null
  or to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null
  or to_regprocedure('public.preservar_escopo_operacao()') is null then
  raise exception 'Aplique antes seguranca_operacao.sql (01-aplicar.sql)';
 end if;
end $$;

create table if not exists public.operacao_catalogo_produtos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null,
  nome text not null check (length(btrim(nome)) between 1 and 300),
  descricao text check (descricao is null or length(descricao) <= 5000),
  marca text check (marca is null or length(marca) <= 200),
  modelo text check (modelo is null or length(modelo) <= 200),
  -- Mesmos limites de operacao_itens_resultado: o "Usar do catálogo" copia sem cortar.
  fabricante text check (fabricante is null or length(fabricante) <= 500),
  unidade text check (unidade is null or length(unidade) between 1 and 100),
  custo_unitario numeric(15,2) check (custo_unitario is null or custo_unitario >= 0),
  fornecedor_nome text check (fornecedor_nome is null or length(fornecedor_nome) <= 200),
  fornecedor_contato text check (fornecedor_contato is null or length(fornecedor_contato) <= 300),
  codigo_interno text check (codigo_interno is null or length(btrim(codigo_interno)) between 1 and 60),
  foto_caminho text,
  foto_hash text check (foto_hash ~ '^[0-9a-f]{64}$'),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  check ((foto_caminho is null) = (foto_hash is null)),
  -- Só <org>/<empresa>/catalogo/<foto_hash>.(png|jpg|jpeg): barra '..', outra empresa e nome livre.
  check (foto_caminho is null or foto_caminho ~ ('^' || organizacao_id::text || '/' || empresa_id::text
    || '/catalogo/' || foto_hash || '\.(png|jpe?g)$')),
  foreign key (empresa_id, organizacao_id)
    references public.operacao_empresas(id, organizacao_id) on delete cascade
);
-- Preço de referência do mercado (o que órgãos pagaram, ex.: mediana da Pesquisa de Preços do Compras.gov).
-- NÃO é custo: custo_unitario continua sendo o que o fornecedor cobra do usuário. Fonte e data andam juntas com o preço.
alter table public.operacao_catalogo_produtos add column if not exists preco_referencia numeric(15,2) check (preco_referencia is null or preco_referencia > 0);
alter table public.operacao_catalogo_produtos add column if not exists referencia_fonte text check (referencia_fonte is null or length(btrim(referencia_fonte)) between 1 and 300);
alter table public.operacao_catalogo_produtos add column if not exists referencia_em date;
do $$ begin
 if not exists (select 1 from pg_constraint where conname = 'operacao_catalogo_produtos_referencia_completa') then
  alter table public.operacao_catalogo_produtos add constraint operacao_catalogo_produtos_referencia_completa
   check ((preco_referencia is null) = (referencia_fonte is null) and (preco_referencia is null) = (referencia_em is null));
 end if;
end $$;
-- Código interno é a chave da planilha quando o id não vem: um por empresa.
create unique index if not exists operacao_catalogo_produtos_codigo_idx
  on public.operacao_catalogo_produtos (empresa_id, codigo_interno) where codigo_interno is not null;
-- shortcut: btree cobre ordenação e prefixo; a busca "contém" roda no navegador (até 5.000 linhas). pg_trgm se o teto subir.
create index if not exists operacao_catalogo_produtos_busca_idx
  on public.operacao_catalogo_produtos (empresa_id, lower(nome), lower(marca));

create or replace function public.carimbar_catalogo_produto()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 new.atualizado_em := now();
 new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
 if TG_OP = 'INSERT' then
  new.criado_em := now();
  -- Serializa inserções da mesma empresa para a contagem não furar o teto.
  perform pg_advisory_xact_lock(hashtext('catalogo:' || new.empresa_id::text));
  if (select count(*) from public.operacao_catalogo_produtos where empresa_id = new.empresa_id) >= 5000 then
   raise exception 'Limite de 5.000 produtos por empresa no catálogo' using errcode = 'P0001';
  end if;
 else
  new.criado_em := old.criado_em;
 end if;
 return new;
end $$;
revoke all on function public.carimbar_catalogo_produto() from public, anon, authenticated, service_role;
drop trigger if exists carimbar_catalogo_produto on public.operacao_catalogo_produtos;
create trigger carimbar_catalogo_produto before insert or update on public.operacao_catalogo_produtos
  for each row execute function public.carimbar_catalogo_produto();
drop trigger if exists preservar_escopo_operacao on public.operacao_catalogo_produtos;
create trigger preservar_escopo_operacao before update on public.operacao_catalogo_produtos
  for each row execute function public.preservar_escopo_operacao();

alter table public.operacao_catalogo_produtos enable row level security;
revoke all on public.operacao_catalogo_produtos from public, anon, authenticated;
grant select, insert, update, delete on public.operacao_catalogo_produtos to authenticated;
grant all on public.operacao_catalogo_produtos to service_role;
drop policy if exists operacao_catalogo_produtos_leitura on public.operacao_catalogo_produtos;
drop policy if exists operacao_catalogo_produtos_escrita on public.operacao_catalogo_produtos;
create policy operacao_catalogo_produtos_leitura on public.operacao_catalogo_produtos for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_catalogo_produtos_escrita on public.operacao_catalogo_produtos for all to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));

notify pgrst, 'reload schema';
commit;


-- ========== historico_licitacoes.sql ==========
-- Licitação anterior (etapa 1): contratações anteriores do mesmo órgão e do mesmo produto, preservadas.
-- Idempotente, transação única; rodar no SQL Editor DEPOIS de operacao_esteira.sql. Não apaga dados.
-- Dado público (PNCP, Compras.gov dados abertos, arquivo semanal de propostas), compartilhado entre todas
-- as organizações: um pregão lido para um cliente serve aos outros. Nunca guarda CPF: fornecedor pessoa
-- física fica sem documento e com o nome "Pessoa física"; MEI aparece pela razão social pública, sem o CPF que ela traz no fim.
-- Escrita só pelo service_role (robô scripts/esteira_processos.js e a função /api/licitacao-anterior).
-- Tamanho medido no ambiente local (nov/2026, SUFRAMA 58 itens + café da Marinha): 1.690 participações = 0,73 MB com
-- índices (~430 bytes cada); as 4 tabelas somaram 1,0 MB. Um edital de 60 itens com 4 pregões anteriores fica perto de
-- 0,8 MB: 500 processos assim ~400 MB, então o teto por item (30 propostas) e por compras (12) importam no plano grátis.
begin;
do $$ begin
 if to_regclass('public.operacao_esteira_tarefas') is null then
  raise exception 'Aplique antes operacao_esteira.sql';
 end if;
end $$;

-- Uma linha por contratação. id_compra = id do Compras.gov (17 dígitos: UASG + modalidade + número + ano);
-- compra de outra plataforma usa o número de controle do PNCP.
create table if not exists public.historico_compras (
  id_compra text primary key check (length(id_compra) between 8 and 40),
  numero_controle_pncp text,
  orgao_cnpj text check (orgao_cnpj ~ '^\d{14}$'),
  orgao_nome text check (length(orgao_nome) <= 300),
  uasg text check (uasg ~ '^\d{1,8}$'),
  unidade_nome text check (length(unidade_nome) <= 300),
  ano integer check (ano between 2000 and 2100),
  numero text check (length(numero) <= 40),
  modalidade text check (length(modalidade) <= 80),
  plataforma text check (length(plataforma) <= 80),
  situacao text check (length(situacao) <= 80),
  objeto text check (length(objeto) <= 1000),
  data_publicacao date,
  link_origem text check (length(link_origem) <= 500),
  link_pncp text check (length(link_pncp) <= 500),
  atualizado_em timestamptz not null default now()
);
create index if not exists historico_compras_uasg_idx on public.historico_compras (uasg, ano desc);
create index if not exists historico_compras_orgao_idx on public.historico_compras (orgao_cnpj, ano desc);

create table if not exists public.historico_itens (
  id_compra text not null references public.historico_compras(id_compra) on delete cascade,
  numero_item integer not null check (numero_item > 0),
  catmat text check (catmat ~ '^\d{1,12}$'),
  pdm text check (pdm ~ '^\d{1,12}$'),
  descricao text check (length(descricao) <= 600),
  quantidade numeric,
  unidade text check (length(unidade) <= 60),
  valor_estimado numeric,
  situacao_item text check (length(situacao_item) <= 80),
  tem_resultado boolean,
  atualizado_em timestamptz not null default now(),
  primary key (id_compra, numero_item)
);
create index if not exists historico_itens_catmat_idx on public.historico_itens (catmat) where catmat is not null;

-- Uma linha por fornecedor no item. Cada fonte grava só as suas colunas (upsert por coluna):
-- PNCP /resultados (ordem, situação, homologado, motivo do cancelamento), arquivo de propostas
-- (classificação e valores de todos os participantes) e Pesquisa de Preços (marca do vencedor).
create table if not exists public.historico_participacoes (
  id_compra text not null,
  numero_item integer not null,
  fornecedor_chave text not null check (length(fornecedor_chave) between 1 and 40),
  fornecedor_ni text check (fornecedor_ni ~ '^\d{14}$'),
  fornecedor_nome text check (length(fornecedor_nome) <= 300),
  porte text check (length(porte) <= 40),
  uf text check (uf ~ '^[A-Z]{2}$'),
  ordem_classificacao integer,
  situacao_resultado text check (length(situacao_resultado) <= 80),
  valor_homologado numeric,
  quantidade_homologada numeric,
  data_resultado date,
  motivo_cancelamento text check (length(motivo_cancelamento) <= 1000),
  classificacao integer,
  valor_proposta numeric,
  valor_lance numeric,
  valor_negociado numeric,
  marca text check (length(marca) <= 120),
  marca_declarada text check (length(marca_declarada) <= 120),
  atualizado_em timestamptz not null default now(),
  primary key (id_compra, numero_item, fornecedor_chave),
  foreign key (id_compra, numero_item) references public.historico_itens(id_compra, numero_item) on delete cascade
);
-- Etapa 2 (análise por CNPJ do concorrente): onde ele disputou, ganhou e perdeu.
create index if not exists historico_participacoes_ni_idx on public.historico_participacoes (fornecedor_ni) where fornecedor_ni is not null;

-- ComprasNet antigo (pregões até 2023, páginas públicas sem captcha: FornecedorResultadoDecreto.asp e termojulg.asp,
-- lidas pelo robô com ritmo baixo; netlify/functions/_comprasnet_antigo.js). Colunas só aditivas, nada é apagado.
--   historico_compras.fonte / fonte_lida_em: de onde veio a leitura e quando (link_origem fica com a página pública do pregão);
--   historico_itens.motivo_situacao / tem_recurso: motivo literal de item cancelado/fracassado no termo de adjudicação;
--   historico_participacoes: fabricante, modelo e descrição do objeto ofertado pelo vencedor (a marca já tem coluna).
alter table public.historico_compras add column if not exists fonte text check (length(fonte) <= 40);
alter table public.historico_compras add column if not exists fonte_lida_em timestamptz;
alter table public.historico_itens add column if not exists motivo_situacao text check (length(motivo_situacao) <= 1000 and motivo_situacao !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
alter table public.historico_itens add column if not exists tem_recurso boolean;
alter table public.historico_participacoes add column if not exists fabricante text check (length(fabricante) <= 120);
alter table public.historico_participacoes add column if not exists modelo text check (length(modelo) <= 120);
alter table public.historico_participacoes add column if not exists descricao_ofertada text check (length(descricao_ofertada) <= 600 and descricao_ofertada !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');

-- Links antigos (revisão de segurança 19/11/2026, M2): link_origem/link_pncp vinham do cadastro do órgão no PNCP e
-- alguns eram de plataformas parceiras ou de qualquer host. A tela já bloqueia (linkOficial); aqui o banco também limpa.
-- Só https nos hosts oficiais, sem usuário nem porta; o resto vira null (o robô recoloca o link do Compras.gov na
-- próxima leitura). Idempotente: a segunda rodada não encontra mais nada para mudar.
update public.historico_compras set
  link_origem = case when link_origem ~* '^https://(pncp\.gov\.br|dadosabertos\.compras\.gov\.br|contratos\.comprasnet\.gov\.br|cnetmobile\.estaleiro\.serpro\.gov\.br|(www\.)?comprasnet\.gov\.br)([/?#]|$)' then link_origem end,
  link_pncp = case when link_pncp ~* '^https://(pncp\.gov\.br|dadosabertos\.compras\.gov\.br|contratos\.comprasnet\.gov\.br|cnetmobile\.estaleiro\.serpro\.gov\.br|(www\.)?comprasnet\.gov\.br)([/?#]|$)' then link_pncp end
 where (link_origem is not null and link_origem !~* '^https://(pncp\.gov\.br|dadosabertos\.compras\.gov\.br|contratos\.comprasnet\.gov\.br|cnetmobile\.estaleiro\.serpro\.gov\.br|(www\.)?comprasnet\.gov\.br)([/?#]|$)')
    or (link_pncp is not null and link_pncp !~* '^https://(pncp\.gov\.br|dadosabertos\.compras\.gov\.br|contratos\.comprasnet\.gov\.br|cnetmobile\.estaleiro\.serpro\.gov\.br|(www\.)?comprasnet\.gov\.br)([/?#]|$)');

-- Consulta avulsa (tela de pesquisa): cache por UASG + produto + período e fila do robô para completar
-- os participantes pelo arquivo de propostas (a função no Cloudflare não baixa os 90 MB do mês).
create table if not exists public.historico_consultas (
  chave text primary key check (length(chave) <= 300),
  uasg text not null check (uasg ~ '^\d{1,8}$'),
  catmat text check (catmat ~ '^\d{1,12}$'),
  palavras text check (length(palavras) <= 120),
  desde_ano integer not null,
  compras text[] not null default '{}',
  casamentos jsonb not null default '[]'::jsonb check (jsonb_typeof(casamentos) = 'array'),
  situacao text not null default 'parcial' check (situacao in ('parcial', 'completo', 'falhou')),
  erro text check (length(erro) <= 300),
  gerado_em timestamptz not null default now()
);
create index if not exists historico_consultas_fila_idx on public.historico_consultas (gerado_em) where situacao = 'parcial';

-- LGPD: razão social de MEI vem com o CPF do titular ("FULANA DE TAL 97048143215"). Limpeza única e idempotente
-- do que já foi gravado (só toca linha que ainda tem CPF), depois o CHECK recusa CPF daqui para frente. Mesma forma
-- da regex de netlify/functions/_cpf.js (lá \s cobre mais: o robô sempre limpa antes do CHECK).
update public.historico_participacoes set fornecedor_nome = nullif(btrim(regexp_replace(regexp_replace(fornecedor_nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '')
 where fornecedor_nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
alter table public.historico_participacoes drop constraint if exists historico_participacoes_nome_sem_cpf;
alter table public.historico_participacoes add constraint historico_participacoes_nome_sem_cpf check (fornecedor_nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');

-- LGPD: marca/fabricante/modelo também são texto livre do fornecedor. Limpeza idempotente (só linha com CPF) e CHECK.
do $$ declare c text; begin
 foreach c in array array['marca', 'marca_declarada', 'fabricante', 'modelo'] loop
  execute format($f$update public.historico_participacoes set %1$I = nullif(btrim(regexp_replace(regexp_replace(%1$I, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '')
   where %1$I ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'$f$, c);
  execute format('alter table public.historico_participacoes drop constraint if exists %I', 'historico_participacoes_' || c || '_sem_cpf');
  execute format($f$alter table public.historico_participacoes add constraint %I check (%I !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y')$f$, 'historico_participacoes_' || c || '_sem_cpf', c);
 end loop;
end $$;

-- Leitura só para cliente aprovado (conta pendente/suspensa com JWT válido não lê). security definer porque a RLS de
-- clientes só mostra a própria linha; stable + search_path vazio. Mesmo corpo em prospeccao.sql e historico_licitacoes.sql.
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

do $$ declare t text; begin
 foreach t in array array['historico_compras', 'historico_itens', 'historico_participacoes'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select on public.%I to authenticated', t);
  execute format('grant all on public.%I to service_role', t);
  execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
  -- Dado público de compras governamentais: qualquer cliente aprovado lê; ninguém além do servidor escreve.
  execute format('create policy %I on public.%I for select to authenticated using (public.cliente_aprovado())', t || '_leitura', t);
 end loop;
end $$;

-- Cache das consultas avulsas: só a função (service_role) e o robô leem. Nenhuma tela lê direto (guarda quem
-- perguntou o quê e casamentos internos); o resultado chega pela função /api/licitacao-anterior.
alter table public.historico_consultas enable row level security;
revoke all on public.historico_consultas from public, anon, authenticated;
grant all on public.historico_consultas to service_role;
drop policy if exists historico_consultas_leitura on public.historico_consultas;

-- Processos que já estavam na esteira antes desta etapa existir ganham a tarefa 'historico' (uma vez).
insert into public.operacao_esteira_tarefas (organizacao_id, empresa_id, processo_id, etapa, criado_por)
select distinct t.organizacao_id, t.empresa_id, t.processo_id, 'historico', t.criado_por
  from public.operacao_esteira_tarefas t
  join public.operacao_processos p on p.id = t.processo_id
 where p.status not in ('arquivado', 'perdido', 'contratado')
on conflict do nothing;

notify pgrst, 'reload schema';
commit;


-- ========== sancoes_empresas.sql ==========
-- ============================================================================
-- LicitaPlena — sanções de empresas (CEIS e CNEP da CGU), carga diária.
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única;
-- só cria objetos novos (não altera nem apaga dados de outras tabelas).
-- Escrita: só o robô scripts/coletar_sancoes_cgu.js (service_role). Leitura: qualquer
-- usuário autenticado (dado público da CGU). anon não lê.
--
-- LGPD: só pessoa jurídica. O check de 14 dígitos barra CPF mesmo que o robô falhe.
-- Histórico: o que sumiu do arquivo do dia fica fora_da_lista = true. Prazo de guarda: fora da lista há mais
-- de 5 anos é apagado por sancoes_empresas_expurgar() (só service_role; chamada pelo robô). Ver
-- politica-privacidade.html, "Dados públicos de licitações e de terceiros".
-- ============================================================================
begin;

create table if not exists public.sancoes_empresas (
  cadastro text not null check (cadastro in ('CEIS', 'CNEP')),
  codigo_sancao text not null check (codigo_sancao ~ '^[0-9]{1,40}$'),
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  razao_social text check (razao_social is null or length(razao_social) <= 300),
  tipo_sancao text check (tipo_sancao is null or length(tipo_sancao) <= 300),
  orgao_sancionador text check (orgao_sancionador is null or length(orgao_sancionador) <= 300),
  uf_orgao text check (uf_orgao is null or uf_orgao ~ '^[A-Z]{2}$'),
  esfera_orgao text check (esfera_orgao is null or length(esfera_orgao) <= 60),
  abrangencia text check (abrangencia is null or length(abrangencia) <= 300),
  data_inicio date,
  data_fim date,
  data_publicacao date,
  fundamentacao text check (fundamentacao is null or length(fundamentacao) <= 1000),
  numero_processo text check (numero_processo is null or length(numero_processo) <= 200),
  valor_multa numeric(18, 2),
  -- Data do arquivo da CGU que trouxe a linha pela última vez.
  data_carga date not null,
  fora_da_lista boolean not null default false,
  fora_da_lista_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (cadastro, codigo_sancao),
  check (fora_da_lista or fora_da_lista_em is null)
);

create index if not exists sancoes_empresas_cnpj_idx on public.sancoes_empresas (cnpj);
-- O robô procura a última carga e marca sumiço por cadastro + data.
create index if not exists sancoes_empresas_carga_idx on public.sancoes_empresas (cadastro, data_carga);

-- atualizado_em no servidor (o upsert do robô não manda a coluna).
create or replace function public.sancoes_empresas_tocar() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists sancoes_empresas_tocar on public.sancoes_empresas;
create trigger sancoes_empresas_tocar before update on public.sancoes_empresas
  for each row execute function public.sancoes_empresas_tocar();
revoke all on function public.sancoes_empresas_tocar() from public, anon, authenticated;

-- LGPD: razão social de MEI vem com o CPF do titular ("FULANA DE TAL 97048143215"). Limpeza única e idempotente
-- do que já foi gravado (só toca linha que ainda tem CPF), depois o CHECK recusa CPF daqui para frente. Mesma forma
-- da regex de netlify/functions/_cpf.js (lá \s cobre mais: o robô sempre limpa antes do CHECK).
update public.sancoes_empresas set razao_social = nullif(btrim(regexp_replace(regexp_replace(razao_social, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '')
 where razao_social ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
alter table public.sancoes_empresas drop constraint if exists sancoes_empresas_razao_sem_cpf;
alter table public.sancoes_empresas add constraint sancoes_empresas_razao_sem_cpf check (razao_social !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');

-- Prazo de guarda: sanção fora da lista da CGU há mais de 5 anos sai. Security definer porque o service_role
-- não tem delete na tabela (nenhum outro caminho apaga histórico). Devolve quantas linhas saíram.
create or replace function public.sancoes_empresas_expurgar() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.sancoes_empresas where fora_da_lista and fora_da_lista_em < now() - interval '5 years';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sancoes_empresas_expurgar() from public, anon, authenticated;
grant execute on function public.sancoes_empresas_expurgar() to service_role;

alter table public.sancoes_empresas enable row level security;
revoke all on public.sancoes_empresas from anon, authenticated;
grant select on public.sancoes_empresas to authenticated;
revoke delete, truncate on public.sancoes_empresas from service_role;
grant select, insert, update on public.sancoes_empresas to service_role;

drop policy if exists sancoes_empresas_select_autenticado on public.sancoes_empresas;
create policy sancoes_empresas_select_autenticado on public.sancoes_empresas
  for select to authenticated using (true);
-- Sem policy de escrita: só service_role (bypassrls) grava. Sem delete direto para ninguém: só o expurgo de 5 anos.

commit;


-- ========== pregoes_gravados.sql ==========
-- ============================================================================
-- LicitaPlena — pregões gravados pela extensão (modo "Gravar pregão no LicitaPlena").
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente (pode rodar de novo sem apagar nada).
-- Dado PÚBLICO lido pela aba do próprio usuário na página pública do Compras.gov ("Acompanhar
-- Contratação") ou na ata do ComprasNet antigo: participantes, propostas, marca/modelo, lances e chat do
-- pregoeiro. Por ser público e caro de obter (captcha a cada abertura), fica compartilhado: uma vez
-- gravado, qualquer cliente logado lê sem abrir o portal de novo.
--   Leitura: qualquer usuário autenticado, só as colunas públicas (anon não lê; quem gravou não aparece).
--   Escrita: só a RPC gravar_pregao_gravado, executável apenas pelo service_role
--            (netlify/functions/pregao-gravado.js, que valida o pedido, o login e o cadastro aprovado antes).
-- Nunca CPF: participante sem CNPJ fica como "pf:<n>" com nome "Pessoa física"; CHECKs recusam CPF em
-- texto (com ou sem pontuação). Quem gravou fica em gravado_por/atualizado_por e nas leituras (só service_role).
-- Valores consolidados de várias leituras, com selo "não verificado": ver a seção de 19/11/2026 abaixo.
-- ============================================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.pregoes_gravados (
  id_compra text primary key check (id_compra ~ '^[0-9]{17}$'),
  fonte text not null check (fonte in ('comprasgov', 'comprasnet')),
  url text check (char_length(url) <= 500),
  uasg text check (uasg ~ '^[0-9]{6}$'),
  orgao text check (char_length(orgao) <= 300),
  numero text check (numero ~ '^[0-9]{1,5}$'),
  ano int check (ano between 1990 and 2100),
  modalidade text check (char_length(modalidade) <= 80),
  -- {"<número do item>": {descricao, situacao, quantidade, valor_estimado, unidade, propostas_lidas_em}}
  itens jsonb not null default '{}'::jsonb check (jsonb_typeof(itens) = 'object'),
  gravado_por uuid references auth.users(id) on delete set null,
  gravado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.pregoes_gravados_propostas (
  id_compra text not null references public.pregoes_gravados(id_compra) on delete cascade,
  numero_item int not null check (numero_item between 1 and 99999),
  fornecedor_chave text not null check (fornecedor_chave ~ '^([0-9]{14}|pf:[0-9]{1,4})$'),
  cnpj text check (cnpj ~ '^[0-9]{14}$' and cnpj = fornecedor_chave),
  nome text check (char_length(nome) <= 300),
  uf text check (uf ~ '^[A-Z]{2}$'),
  me_epp boolean,
  situacao text check (char_length(situacao) <= 120),
  valor_ofertado numeric(20, 4),
  valor_negociado numeric(20, 4),
  valor_proposta numeric(20, 4),
  valor_total numeric(22, 4),
  quantidade numeric(20, 4),
  marca text check (char_length(marca) <= 200),
  fabricante text check (char_length(fabricante) <= 200),
  modelo text check (char_length(modelo) <= 200),
  lances jsonb not null default '[]'::jsonb check (jsonb_typeof(lances) = 'array'),
  chat_lido boolean not null default false,
  proposta_lida boolean not null default false,
  gravado_por uuid references auth.users(id) on delete set null,
  gravado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  primary key (id_compra, numero_item, fornecedor_chave),
  constraint pregoes_gravados_propostas_pf check ((cnpj is null) = (fornecedor_chave like 'pf:%') and (cnpj is not null or nome = 'Pessoa física'))
);
create index if not exists pregoes_gravados_propostas_cnpj_idx on public.pregoes_gravados_propostas (cnpj) where cnpj is not null;

create table if not exists public.pregoes_gravados_mensagens (
  -- md5(compra|item|fornecedor|data_hora|texto): gravar a mesma página duas vezes não duplica.
  chave text primary key check (chave ~ '^[0-9a-f]{32}$'),
  id_compra text not null references public.pregoes_gravados(id_compra) on delete cascade,
  numero_item int not null check (numero_item between 0 and 99999), -- 0 = mensagem da compra, sem item
  fornecedor_chave text check (fornecedor_chave ~ '^([0-9]{14}|pf:[0-9]{1,4})$'),
  data_hora timestamp, -- horário de Brasília como o portal mostra
  autor text check (char_length(autor) <= 40),
  texto text not null check (char_length(texto) between 1 and 4000 and texto !~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}'),
  tipo text not null check (tipo in ('recusa', 'desclassificacao', 'inabilitacao', 'convocacao', 'habilitacao', 'adjudicacao', 'aceite', 'outro')),
  motivo text check (char_length(motivo) <= 2000 and motivo !~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}'),
  gravado_por uuid references auth.users(id) on delete set null,
  gravado_em timestamptz not null default now()
);
create index if not exists pregoes_gravados_mensagens_compra_idx on public.pregoes_gravados_mensagens (id_compra, numero_item, data_hora);


-- ----------------------------------------------------------------------------
-- Revisão de segurança 19/11/2026 (A1, A2, M3, B6). Qualquer cliente aprovado grava; sem estas regras, a
-- leitura de um sobrescrevia a do outro (coalesce(novo, antigo)) e um cliente mal-intencionado podia trocar
-- vencedor, valor ou marca de um pregão real para todos. Agora:
--   - cada usuário grava a SUA leitura em pregoes_gravados_leituras (a dele só substitui a dele);
--   - o valor mostrado em pregoes_gravados / _propostas / itens é CONSOLIDADO das leituras, campo a campo:
--     vence o valor com mais organizações (grupo) concordando; empate -> o lido primeiro. Logo, uma leitura
--     posterior isolada nunca troca um valor já gravado; trocar exige 2+ organizações; campo vazio é preenchido
--     pela primeira leitura que o trouxer;
--   - leituras_concordantes = nº de organizações cuja leitura não contradiz o consolidado; a tela mostra
--     "lido por usuário, não verificado" enquanto for < 2. origem = 'usuario' em tudo que vem da extensão;
--   - mensagens: dedupe por md5 como antes, nunca apagadas por outra leitura; quem leu fica em
--     pregoes_gravados_mensagens_leitores;
--   - expurgar_pregoes_gravados_por(usuario) tira tudo que aquele usuário trouxe e recalcula o resto.
-- grupo = organização do usuário (operacao_membros, a de menor id se tiver várias) ou o próprio usuário.
-- ----------------------------------------------------------------------------

alter table public.pregoes_gravados add column if not exists origem text not null default 'usuario' check (origem = 'usuario');
alter table public.pregoes_gravados add column if not exists fonte_sem_https boolean not null default false;
alter table public.pregoes_gravados add column if not exists leituras_concordantes int not null default 1;
alter table public.pregoes_gravados_propostas add column if not exists origem text not null default 'usuario' check (origem = 'usuario');
alter table public.pregoes_gravados_propostas add column if not exists leituras_concordantes int not null default 1;
alter table public.pregoes_gravados_mensagens add column if not exists origem text not null default 'usuario' check (origem = 'usuario');
alter table public.pregoes_gravados_mensagens add column if not exists leituras_concordantes int not null default 1;

-- A2: CPF (com ou sem pontuação, espaço ou "/") nunca no texto. Limpeza única e idempotente ANTES do CHECK,
-- mesma regex de netlify/functions/_cpf.js. A chave md5 das mensagens limpas não muda (dedupe futuro usa o
-- texto já mascarado pelo servidor, então uma releitura daquela mensagem pode gerar uma linha nova mascarada).
update public.pregoes_gravados_propostas set nome = regexp_replace(nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', '***.***.***-**', 'g')
  where nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
update public.pregoes_gravados_mensagens set texto = regexp_replace(texto, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', '***.***.***-**', 'g')
  where texto ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
update public.pregoes_gravados_mensagens set motivo = regexp_replace(motivo, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', '***.***.***-**', 'g')
  where motivo ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
alter table public.pregoes_gravados_propostas drop constraint if exists pregoes_gravados_propostas_nome_check;
alter table public.pregoes_gravados_propostas add constraint pregoes_gravados_propostas_nome_check
  check (char_length(nome) <= 300 and nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
alter table public.pregoes_gravados_mensagens drop constraint if exists pregoes_gravados_mensagens_texto_check;
alter table public.pregoes_gravados_mensagens add constraint pregoes_gravados_mensagens_texto_check
  check (char_length(texto) between 1 and 4000 and texto !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
alter table public.pregoes_gravados_mensagens drop constraint if exists pregoes_gravados_mensagens_motivo_check;
alter table public.pregoes_gravados_mensagens add constraint pregoes_gravados_mensagens_motivo_check
  check (char_length(motivo) <= 2000 and motivo !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');

-- Uma linha por (alvo, usuário). alvo 'compra' = cabeçalho (numero_item 0, fornecedor ''), 'item' = dados do
-- item (fornecedor ''), 'proposta' = um participante. dados usa os nomes das colunas consolidadas.
create table if not exists public.pregoes_gravados_leituras (
  id_compra text not null references public.pregoes_gravados(id_compra) on delete cascade,
  alvo text not null check (alvo in ('compra', 'item', 'proposta')),
  numero_item int not null default 0 check (numero_item between 0 and 99999),
  fornecedor_chave text not null default '' check (fornecedor_chave ~ '^([0-9]{14}|pf:[0-9]{1,4})?$'),
  gravado_por uuid not null,
  grupo uuid not null,
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and coalesce(dados->>'nome', '') !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'),
  sem_https boolean not null default false, -- B6: lida de página http (ata do ComprasNet antigo)
  lido_em timestamptz not null default clock_timestamp(), -- primeira leitura: decide empate e não muda na releitura
  atualizado_em timestamptz not null default clock_timestamp(),
  primary key (id_compra, alvo, numero_item, fornecedor_chave, gravado_por)
);
create index if not exists pregoes_gravados_leituras_usuario_idx on public.pregoes_gravados_leituras (gravado_por);

create table if not exists public.pregoes_gravados_mensagens_leitores (
  chave text not null references public.pregoes_gravados_mensagens(chave) on delete cascade,
  gravado_por uuid not null,
  grupo uuid not null,
  lido_em timestamptz not null default clock_timestamp(),
  primary key (chave, gravado_por)
);
create index if not exists pregoes_gravados_mensagens_leitores_usuario_idx on public.pregoes_gravados_mensagens_leitores (gravado_por);

alter table public.pregoes_gravados enable row level security;
alter table public.pregoes_gravados_propostas enable row level security;
alter table public.pregoes_gravados_mensagens enable row level security;
alter table public.pregoes_gravados_leituras enable row level security;
alter table public.pregoes_gravados_mensagens_leitores enable row level security;
revoke all on public.pregoes_gravados, public.pregoes_gravados_propostas, public.pregoes_gravados_mensagens,
  public.pregoes_gravados_leituras, public.pregoes_gravados_mensagens_leitores from anon;
revoke all on public.pregoes_gravados, public.pregoes_gravados_propostas, public.pregoes_gravados_mensagens,
  public.pregoes_gravados_leituras, public.pregoes_gravados_mensagens_leitores from authenticated;
-- M3: leitura por coluna, sem quem gravou (gravado_por/atualizado_por). Leituras e leitores: só service_role.
grant select (id_compra, fonte, url, uasg, orgao, numero, ano, modalidade, itens, origem, fonte_sem_https, leituras_concordantes, gravado_em, atualizado_em)
  on public.pregoes_gravados to authenticated;
grant select (id_compra, numero_item, fornecedor_chave, cnpj, nome, uf, me_epp, situacao, valor_ofertado, valor_negociado, valor_proposta, valor_total,
  quantidade, marca, fabricante, modelo, lances, chat_lido, proposta_lida, origem, leituras_concordantes, gravado_em, atualizado_em)
  on public.pregoes_gravados_propostas to authenticated;
grant select (chave, id_compra, numero_item, fornecedor_chave, data_hora, autor, texto, tipo, motivo, origem, leituras_concordantes, gravado_em)
  on public.pregoes_gravados_mensagens to authenticated;
drop policy if exists pregoes_gravados_select_autenticado on public.pregoes_gravados;
create policy pregoes_gravados_select_autenticado on public.pregoes_gravados for select to authenticated using (true);
drop policy if exists pregoes_gravados_propostas_select_autenticado on public.pregoes_gravados_propostas;
create policy pregoes_gravados_propostas_select_autenticado on public.pregoes_gravados_propostas for select to authenticated using (true);
drop policy if exists pregoes_gravados_mensagens_select_autenticado on public.pregoes_gravados_mensagens;
create policy pregoes_gravados_mensagens_select_autenticado on public.pregoes_gravados_mensagens for select to authenticated using (true);

create or replace function public.pregoes_gravados_grupo(p_usuario uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select organizacao_id from operacao_membros where usuario_id = p_usuario order by organizacao_id limit 1), p_usuario)
$$;

-- Consolidado de um alvo, campo a campo, + '_concordantes'. Bandeiras "já lido" (chat_lido, proposta_lida,
-- propostas_lidas) não votam: só passam a verdadeiro (bool_or no recálculo).
create or replace function public.pregoes_gravados_consolidar(p_compra text, p_alvo text, p_item int, p_forn text)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with l as (
    select grupo, dados, lido_em from pregoes_gravados_leituras
    where id_compra = p_compra and alvo = p_alvo and numero_item = p_item and fornecedor_chave = p_forn
  ), votos as (
    select distinct on (e.key) e.key, e.value
    from l, jsonb_each(l.dados) e
    where e.value <> 'null'::jsonb and e.key <> all (array['chat_lido', 'proposta_lida', 'propostas_lidas'])
    group by e.key, e.value
    order by e.key, count(distinct l.grupo) desc, min(l.lido_em), e.value::text
  ), c as (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) v from votos)
  select c.v || jsonb_build_object('_concordantes', (
    -- Leitura vazia (só o número do item) não conta como confirmação.
    select count(distinct l.grupo) from l where exists (
      select 1 from jsonb_each(l.dados) e where e.value <> 'null'::jsonb and e.key <> all (array['chat_lido', 'proposta_lida', 'propostas_lidas'])
    ) and not exists (
      select 1 from jsonb_each(l.dados) e
      where e.value <> 'null'::jsonb and e.key <> all (array['chat_lido', 'proposta_lida', 'propostas_lidas']) and c.v->e.key is distinct from e.value)))
  from c
$$;

-- Refaz o consolidado da compra inteira a partir das leituras (determinístico: mesma entrada, mesmo resultado).
-- shortcut: recalcula a compra toda a cada gravação; se um pregão passar de alguns milhares de propostas, recalcular só o item gravado.
create or replace function public.pregoes_gravados_recalcular(p_compra text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not exists (select 1 from pregoes_gravados_leituras where id_compra = p_compra) then
    delete from pregoes_gravados where id_compra = p_compra; -- cascata leva propostas, mensagens e leitores
    return;
  end if;
  v := pregoes_gravados_consolidar(p_compra, 'compra', 0, '');
  update pregoes_gravados t set fonte = coalesce(v->>'fonte', t.fonte), url = v->>'url', uasg = v->>'uasg', orgao = v->>'orgao',
    numero = v->>'numero', ano = (v->>'ano')::int, modalidade = v->>'modalidade', leituras_concordantes = (v->>'_concordantes')::int,
    fonte_sem_https = exists (select 1 from pregoes_gravados_leituras l where l.id_compra = p_compra and l.sem_https),
    itens = coalesce((
      select jsonb_object_agg(k.numero_item::text, (x.c - '_concordantes') || jsonb_build_object('leituras_concordantes', (x.c->>'_concordantes')::int)
        || case when k.lidas is null then '{}'::jsonb else jsonb_build_object('propostas_lidas_em', k.lidas) end)
      from (select numero_item, min(lido_em) filter (where (dados->>'propostas_lidas')::boolean) lidas
            from pregoes_gravados_leituras where id_compra = p_compra and alvo = 'item' group by numero_item) k
      cross join lateral pregoes_gravados_consolidar(p_compra, 'item', k.numero_item, '') as x(c)), '{}'::jsonb)
  where t.id_compra = p_compra;

  delete from pregoes_gravados_propostas p where p.id_compra = p_compra and not exists (
    select 1 from pregoes_gravados_leituras l where l.id_compra = p.id_compra and l.alvo = 'proposta'
      and l.numero_item = p.numero_item and l.fornecedor_chave = p.fornecedor_chave);
  insert into pregoes_gravados_propostas as t (id_compra, numero_item, fornecedor_chave, cnpj, nome, uf, me_epp, situacao,
    valor_ofertado, valor_negociado, valor_proposta, valor_total, quantidade, marca, fabricante, modelo, lances,
    chat_lido, proposta_lida, gravado_por, gravado_em, atualizado_por, leituras_concordantes)
  select p_compra, k.numero_item, k.fornecedor_chave, case when k.fornecedor_chave like 'pf:%' then null else k.fornecedor_chave end,
    case when k.fornecedor_chave like 'pf:%' then 'Pessoa física' else r.nome end, r.uf, r.me_epp, r.situacao,
    r.valor_ofertado, r.valor_negociado, r.valor_proposta, r.valor_total, r.quantidade, r.marca, r.fabricante, r.modelo, coalesce(r.lances, '[]'::jsonb),
    k.chat, k.proposta, k.primeiro, k.primeiro_em, k.ultimo, (x.c->>'_concordantes')::int
  from (select numero_item, fornecedor_chave, bool_or(coalesce((dados->>'chat_lido')::boolean, false)) chat,
          bool_or(coalesce((dados->>'proposta_lida')::boolean, false)) proposta,
          (array_agg(gravado_por order by lido_em))[1] primeiro, min(lido_em) primeiro_em, (array_agg(gravado_por order by atualizado_em desc))[1] ultimo
        from pregoes_gravados_leituras where id_compra = p_compra and alvo = 'proposta' group by numero_item, fornecedor_chave) k
  cross join lateral pregoes_gravados_consolidar(p_compra, 'proposta', k.numero_item, k.fornecedor_chave) as x(c)
  cross join lateral jsonb_populate_record(null::pregoes_gravados_propostas, x.c) r
  on conflict (id_compra, numero_item, fornecedor_chave) do update set
    nome = excluded.nome, uf = excluded.uf, me_epp = excluded.me_epp, situacao = excluded.situacao,
    valor_ofertado = excluded.valor_ofertado, valor_negociado = excluded.valor_negociado, valor_proposta = excluded.valor_proposta,
    valor_total = excluded.valor_total, quantidade = excluded.quantidade, marca = excluded.marca, fabricante = excluded.fabricante,
    modelo = excluded.modelo, lances = excluded.lances, chat_lido = excluded.chat_lido, proposta_lida = excluded.proposta_lida,
    gravado_por = excluded.gravado_por, gravado_em = excluded.gravado_em, atualizado_por = excluded.atualizado_por,
    leituras_concordantes = excluded.leituras_concordantes, atualizado_em = now();

  -- Mensagem só sai quando ninguém mais a leu (expurgo); gravação normal nunca apaga mensagem.
  delete from pregoes_gravados_mensagens m where m.id_compra = p_compra
    and not exists (select 1 from pregoes_gravados_mensagens_leitores l where l.chave = m.chave);
  update pregoes_gravados_mensagens m set leituras_concordantes = (select count(distinct l.grupo) from pregoes_gravados_mensagens_leitores l where l.chave = m.chave)
  where m.id_compra = p_compra;
end $$;

-- Uma página lida por vez (normalmente 1 item). A leitura do usuário mescla com a leitura anterior DELE
-- (campo ausente agora não apaga o que ele já trouxe); o consolidado é refeito a partir de todas as leituras.
create or replace function public.gravar_pregao_gravado(p_dados jsonb, p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_compra text := p_dados->>'compra';
  v_grupo uuid;
  v_sem boolean := coalesce((p_dados->>'semHttps')::boolean, false) or coalesce(p_dados->>'url' like 'http:%', false);
  n_prop int;
  n_msg int;
begin
  if p_usuario is null then raise exception 'Usuário obrigatório.'; end if;
  v_grupo := pregoes_gravados_grupo(p_usuario);
  insert into pregoes_gravados as t (id_compra, fonte, gravado_por, atualizado_por) values (v_compra, p_dados->>'fonte', p_usuario, p_usuario)
  on conflict (id_compra) do update set atualizado_por = excluded.atualizado_por, atualizado_em = now();

  insert into pregoes_gravados_leituras as t (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, sem_https)
  values (v_compra, 'compra', 0, '', p_usuario, v_grupo, jsonb_strip_nulls(jsonb_build_object('fonte', p_dados->'fonte', 'url', p_dados->'url',
    'uasg', p_dados#>'{cabecalho,uasg}', 'orgao', p_dados#>'{cabecalho,orgao}', 'numero', p_dados#>'{cabecalho,numero}',
    'ano', p_dados#>'{cabecalho,ano}', 'modalidade', p_dados#>'{cabecalho,modalidade}')), v_sem)
  on conflict (id_compra, alvo, numero_item, fornecedor_chave, gravado_por) do update set dados = t.dados || excluded.dados,
    grupo = excluded.grupo, sem_https = t.sem_https or excluded.sem_https, atualizado_em = clock_timestamp();

  insert into pregoes_gravados_leituras as t (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, sem_https)
  select v_compra, 'item', (i->>'numero')::int, '', p_usuario, v_grupo, jsonb_strip_nulls(jsonb_build_object('descricao', i->'descricao',
    'situacao', i->'situacao', 'quantidade', i->'quantidade', 'valor_estimado', i->'valorEstimado', 'unidade', i->'unidade',
    'propostas_lidas', case when (i->>'propostasLidas')::boolean then true end)), v_sem
  from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) i
  on conflict (id_compra, alvo, numero_item, fornecedor_chave, gravado_por) do update set dados = t.dados || excluded.dados,
    grupo = excluded.grupo, sem_https = t.sem_https or excluded.sem_https, atualizado_em = clock_timestamp();

  insert into pregoes_gravados_leituras as t (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, sem_https)
  select v_compra, 'proposta', (i->>'numero')::int, p->>'chave', p_usuario, v_grupo, jsonb_strip_nulls(jsonb_build_object(
    'nome', case when p->>'chave' like 'pf:%' then null else p->'nome' end, 'uf', p->'uf', 'me_epp', p->'meEpp', 'situacao', p->'situacao',
    'valor_ofertado', p->'valorOfertado', 'valor_negociado', p->'valorNegociado', 'valor_proposta', p->'valorProposta',
    'valor_total', p->'valorTotal', 'quantidade', p->'quantidade', 'marca', p->'marca', 'fabricante', p->'fabricante', 'modelo', p->'modelo',
    'lances', case when jsonb_array_length(coalesce(p->'lances', '[]'::jsonb)) > 0 then p->'lances' end,
    'chat_lido', case when (p->>'chatLido')::boolean then true end, 'proposta_lida', case when (p->>'propostaLida')::boolean then true end)), v_sem
  from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) i, jsonb_array_elements(coalesce(i->'propostas', '[]'::jsonb)) p
  on conflict (id_compra, alvo, numero_item, fornecedor_chave, gravado_por) do update set dados = t.dados || excluded.dados,
    grupo = excluded.grupo, sem_https = t.sem_https or excluded.sem_https, atualizado_em = clock_timestamp();
  get diagnostics n_prop = row_count;

  insert into pregoes_gravados_mensagens (chave, id_compra, numero_item, fornecedor_chave, data_hora, autor, texto, tipo, motivo, gravado_por)
  select md5(concat_ws('|', v_compra, m.n, m.j->>'fornecedor', m.j->>'dataHora', m.j->>'texto')), v_compra, m.n, m.j->>'fornecedor',
    (m.j->>'dataHora')::timestamp, m.j->>'autor', m.j->>'texto', m.j->>'tipo', m.j->>'motivo', p_usuario
  from (select (i->>'numero')::int n, x j from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) i, jsonb_array_elements(coalesce(i->'mensagens', '[]'::jsonb)) x
        union all select 0, x from jsonb_array_elements(coalesce(p_dados->'mensagens', '[]'::jsonb)) x) m
  on conflict (chave) do nothing;
  get diagnostics n_msg = row_count;
  insert into pregoes_gravados_mensagens_leitores (chave, gravado_por, grupo)
  select distinct md5(concat_ws('|', v_compra, m.n, m.j->>'fornecedor', m.j->>'dataHora', m.j->>'texto')), p_usuario, v_grupo
  from (select (i->>'numero')::int n, x j from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) i, jsonb_array_elements(coalesce(i->'mensagens', '[]'::jsonb)) x
        union all select 0, x from jsonb_array_elements(coalesce(p_dados->'mensagens', '[]'::jsonb)) x) m
  on conflict (chave, gravado_por) do nothing;

  perform pregoes_gravados_recalcular(v_compra);
  return jsonb_build_object('propostas', n_prop, 'mensagens_novas', n_msg);
end $$;

-- Expurgo (conta abusiva): tira as leituras e as mensagens que só aquele usuário trouxe e recalcula o resto.
-- Rodar pelo SQL Editor ou service_role: select public.expurgar_pregoes_gravados_por('<uuid>');
create or replace function public.expurgar_pregoes_gravados_por(p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_compras text[]; n_l int; n_m int; c text;
begin
  if p_usuario is null then raise exception 'Usuário obrigatório.'; end if;
  select array_agg(distinct id_compra) into v_compras from (
    select id_compra from pregoes_gravados_leituras where gravado_por = p_usuario
    union select m.id_compra from pregoes_gravados_mensagens_leitores l join pregoes_gravados_mensagens m using (chave) where l.gravado_por = p_usuario) x;
  delete from pregoes_gravados_leituras where gravado_por = p_usuario;
  get diagnostics n_l = row_count;
  delete from pregoes_gravados_mensagens_leitores where gravado_por = p_usuario;
  get diagnostics n_m = row_count;
  foreach c in array coalesce(v_compras, '{}'::text[]) loop perform pregoes_gravados_recalcular(c); end loop;
  update pregoes_gravados set gravado_por = null where gravado_por = p_usuario;
  update pregoes_gravados set atualizado_por = null where atualizado_por = p_usuario;
  update pregoes_gravados_mensagens set gravado_por = null where gravado_por = p_usuario;
  return jsonb_build_object('leituras', n_l, 'mensagens_lidas', n_m, 'compras', coalesce(array_length(v_compras, 1), 0));
end $$;

revoke all on function public.gravar_pregao_gravado(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.gravar_pregao_gravado(jsonb, uuid) to service_role;
revoke all on function public.expurgar_pregoes_gravados_por(uuid) from public, anon, authenticated;
grant execute on function public.expurgar_pregoes_gravados_por(uuid) to service_role;
revoke all on function public.pregoes_gravados_grupo(uuid) from public, anon, authenticated;
revoke all on function public.pregoes_gravados_consolidar(text, text, int, text) from public, anon, authenticated;
revoke all on function public.pregoes_gravados_recalcular(text) from public, anon, authenticated;

-- Dados gravados antes desta versão viram UMA leitura de quem gravou (ou de um leitor "legado" nulo), para
-- não perder nada. Idempotente: só compra/item/proposta/mensagem ainda sem leitura.
insert into public.pregoes_gravados_leituras (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, sem_https, lido_em)
select g.id_compra, 'compra', 0, '', u.id, public.pregoes_gravados_grupo(u.id),
  jsonb_strip_nulls(jsonb_build_object('fonte', g.fonte, 'url', g.url, 'uasg', g.uasg, 'orgao', g.orgao, 'numero', g.numero, 'ano', g.ano, 'modalidade', g.modalidade)),
  coalesce(g.url like 'http:%', false), g.gravado_em
from public.pregoes_gravados g, lateral (select coalesce(g.gravado_por, g.atualizado_por, '00000000-0000-0000-0000-000000000000'::uuid) id) u
where not exists (select 1 from public.pregoes_gravados_leituras l where l.id_compra = g.id_compra and l.alvo = 'compra');
insert into public.pregoes_gravados_leituras (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, lido_em)
select g.id_compra, 'item', e.key::int, '', u.id, public.pregoes_gravados_grupo(u.id),
  (e.value - 'propostas_lidas_em' - 'leituras_concordantes') || case when e.value ? 'propostas_lidas_em' then '{"propostas_lidas": true}'::jsonb else '{}'::jsonb end,
  coalesce((e.value->>'propostas_lidas_em')::timestamptz, g.gravado_em)
from public.pregoes_gravados g, jsonb_each(g.itens) e,
  lateral (select coalesce(g.gravado_por, g.atualizado_por, '00000000-0000-0000-0000-000000000000'::uuid) id) u
where e.key ~ '^[0-9]{1,5}$' and not exists (select 1 from public.pregoes_gravados_leituras l where l.id_compra = g.id_compra and l.alvo = 'item' and l.numero_item = e.key::int);
insert into public.pregoes_gravados_leituras (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, lido_em)
select p.id_compra, 'proposta', p.numero_item, p.fornecedor_chave, u.id, public.pregoes_gravados_grupo(u.id),
  jsonb_strip_nulls(jsonb_build_object('nome', case when p.cnpj is null then null else p.nome end, 'uf', p.uf, 'me_epp', p.me_epp, 'situacao', p.situacao,
    'valor_ofertado', p.valor_ofertado, 'valor_negociado', p.valor_negociado, 'valor_proposta', p.valor_proposta, 'valor_total', p.valor_total,
    'quantidade', p.quantidade, 'marca', p.marca, 'fabricante', p.fabricante, 'modelo', p.modelo,
    'lances', case when jsonb_array_length(p.lances) > 0 then p.lances end, 'chat_lido', p.chat_lido, 'proposta_lida', p.proposta_lida)), p.gravado_em
from public.pregoes_gravados_propostas p, lateral (select coalesce(p.gravado_por, p.atualizado_por, '00000000-0000-0000-0000-000000000000'::uuid) id) u
where not exists (select 1 from public.pregoes_gravados_leituras l where l.id_compra = p.id_compra and l.alvo = 'proposta'
  and l.numero_item = p.numero_item and l.fornecedor_chave = p.fornecedor_chave);
insert into public.pregoes_gravados_mensagens_leitores (chave, gravado_por, grupo, lido_em)
select m.chave, u.id, public.pregoes_gravados_grupo(u.id), m.gravado_em
from public.pregoes_gravados_mensagens m, lateral (select coalesce(m.gravado_por, '00000000-0000-0000-0000-000000000000'::uuid) id) u
where not exists (select 1 from public.pregoes_gravados_mensagens_leitores l where l.chave = m.chave);
-- shortcut: recalcula todas as compras a cada execução do arquivo (base pequena: só o que usuários gravaram à mão).
select public.pregoes_gravados_recalcular(id_compra) from public.pregoes_gravados;

commit;


-- ========== extensao_diagnosticos.sql ==========
-- ============================================================================
-- LicitaPlena — diagnósticos enviados pela extensão ("Enviar diagnóstico", extensao-leitura/diagnostico.mjs).
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente.
-- Quando um fluxo da extensão não reconhece a página do portal, o usuário pode mandar só a ESTRUTURA da página
-- (tags, classes, ids, data-test, rótulos de campo) para a equipe ajustar os seletores. Sem valores digitados,
-- sem texto corrido, sem CPF (netlify/functions/extensao-diagnostico.js filtra antes; o CHECK abaixo é a 2ª trava).
--   Leitura e escrita: só service_role (a equipe lê pelo SQL Editor). Nenhuma policy para authenticated/anon.
--   Retenção: 90 dias (apague com o delete do fim do arquivo quando quiser limpar).
-- ============================================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.extensao_diagnosticos (
  id bigint generated always as identity primary key,
  enviado_por uuid references auth.users(id) on delete set null,
  enviado_em timestamptz not null default now(),
  fluxo text not null check (fluxo in ('gravar', 'preencher', 'acompanhar')),
  motivo text check (char_length(motivo) <= 40),
  versao_extensao text check (versao_extensao ~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,3}$'),
  host text not null check (host in ('cnetmobile.estaleiro.serpro.gov.br', 'comprasnet.gov.br', 'www.comprasnet.gov.br')),
  caminho text not null check (char_length(caminho) <= 300),
  estrutura jsonb not null check (jsonb_typeof(estrutura) = 'object' and pg_column_size(estrutura) <= 1500000),
  -- Mesma forma de CPF de _cpf.js: nada parecido com CPF entra, nem dentro do JSON.
  check (estrutura::text !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y')
);
create index if not exists extensao_diagnosticos_enviado_em on public.extensao_diagnosticos (enviado_em desc);

alter table public.extensao_diagnosticos enable row level security;
revoke all on public.extensao_diagnosticos from anon, authenticated;

commit;

-- Limpeza manual (retenção de 90 dias):
-- delete from public.extensao_diagnosticos where enviado_em < now() - interval '90 days';


-- ========== prospeccao.sql ==========
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
-- shortcut: o ILIKE em busca faz varredura dentro de (tipo, uf); com dezenas de milhares de linhas por UF é rápido.
-- Se a tabela passar de algumas centenas de milhares, criar índice gin_trgm_ops em busca (extensão pg_trgm).

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
create policy prospeccao_itens_select_autenticado on public.prospeccao_itens
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (bypassrls) grava.

commit;


-- ========== analise_cnpj.sql ==========
-- Análise por CNPJ (tela "Analisar concorrente" do painel): onde a empresa disputou, ganhou e perdeu.
-- Idempotente, transação única; rodar no SQL Editor DEPOIS de historico_licitacoes.sql (e, se existir,
-- de pregoes_gravados.sql, que ganha aqui um índice por fornecedor). Não apaga dados.
-- Reaproveita as tabelas historico_* (dado público, compartilhado entre organizações) e acrescenta:
--   historico_compras.uf                  UF da unidade compradora (para "participações por estado");
--   historico_participacoes.situacao_proposta  código cru do arquivo semanal de propostas do Compras.gov.
--      O governo não publica o dicionário. Medido em set-out/2026 (29.208 linhas): "6" só aparece no 1º
--      colocado que venceu; "2" aparece sem posição (proposta recusada no julgamento) ou no 1º colocado de
--      item que terminou Fracassado. A tela trata "2" como "recusada (desclassificação ou inabilitação, o
--      arquivo não distingue)" e nunca inventa o motivo.
--   historico_cnpj_consultas              cache + fila por CNPJ: a função /api/analise-cnpj (Cloudflare,
--      50 subrequisições) coleta o começo e o robô da esteira completa o resto (compras do PNCP e o arquivo
--      de propostas mês a mês, que tem as disputas PERDIDAS).
--   analise_cnpj_participacoes(cnpj)      RPC de leitura (security invoker: vale a RLS de quem chama).
--   historico_participacoes_podar(...)    teto de linhas por CNPJ e prazo de guarda (robô, service_role).
--   historico_limpar_cache(dias)          prazo de guarda do cache de consultas: 30 dias (robô, service_role).
-- A fila (historico_cnpj_consultas) guarda quem pediu (solicitante = organização ou usuário), para o teto por
-- organização; por isso nenhuma tela lê a tabela direto: o estado chega pela função /api/analise-cnpj.
-- Escrita só pelo service_role (função e robô). CPF nunca entra: fornecedor_ni só aceita 14 dígitos.
begin;
do $$ begin
 if to_regclass('public.historico_participacoes') is null then
  raise exception 'Aplique antes historico_licitacoes.sql';
 end if;
end $$;

alter table public.historico_compras add column if not exists uf text check (uf ~ '^[A-Z]{2}$');
alter table public.historico_participacoes add column if not exists situacao_proposta text check (situacao_proposta ~ '^\d{1,3}$');

create table if not exists public.historico_cnpj_consultas (
  cnpj text primary key check (cnpj ~ '^\d{14}$'),
  nome text check (length(nome) <= 300),
  situacao text not null default 'parcial' check (situacao in ('parcial', 'completo', 'falhou')),
  total_pncp integer,
  compras_pendentes text[] not null default '{}',
  meses_pendentes text[] not null default '{}',
  meses_lidos text[] not null default '{}',
  erro text check (length(erro) <= 300),
  gerado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.historico_cnpj_consultas add column if not exists solicitante uuid;
alter table public.historico_cnpj_consultas add column if not exists tentativas integer not null default 0 check (tentativas >= 0);
alter table public.historico_cnpj_consultas add column if not exists mes_falhas text check (mes_falhas ~ '^\d{4}-\d{2}$');
-- Última vez que um usuário pediu este CNPJ (análise nova ou releitura do cache): o robô atende primeiro quem está
-- esperando (scripts/analise_cnpj.js) e depois a fila por ordem de chegada, para a fila antiga nunca ficar parada.
alter table public.historico_cnpj_consultas add column if not exists pedido_em timestamptz;
create index if not exists historico_cnpj_consultas_pedido_idx on public.historico_cnpj_consultas (pedido_em desc) where situacao = 'parcial';
create index if not exists historico_cnpj_consultas_solicitante_idx on public.historico_cnpj_consultas (solicitante, gerado_em);
-- LGPD: nome do PNCP pode ser razão social de MEI com o CPF do titular. Limpeza única e idempotente, depois CHECK.
update public.historico_cnpj_consultas set nome = nullif(btrim(regexp_replace(regexp_replace(nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '')
 where nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
alter table public.historico_cnpj_consultas drop constraint if exists historico_cnpj_consultas_nome_sem_cpf;
alter table public.historico_cnpj_consultas add constraint historico_cnpj_consultas_nome_sem_cpf check (nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
create index if not exists historico_cnpj_consultas_fila_idx on public.historico_cnpj_consultas (gerado_em) where situacao = 'parcial';

alter table public.historico_cnpj_consultas enable row level security;
revoke all on public.historico_cnpj_consultas from public, anon, authenticated;
grant all on public.historico_cnpj_consultas to service_role;
-- Sem leitura para logado: a fila guarda quem pediu. A tela recebe o estado pela função (service_role).
drop policy if exists historico_cnpj_consultas_leitura on public.historico_cnpj_consultas;

-- Motivos gravados pela extensão, por fornecedor (a tela lê pregoes_gravados_mensagens por CNPJ).
do $$ begin
 if to_regclass('public.pregoes_gravados_mensagens') is not null then
  create index if not exists pregoes_gravados_mensagens_fornecedor_idx on public.pregoes_gravados_mensagens (fornecedor_chave) where fornecedor_chave is not null;
 end if;
end $$;

-- Uma linha por item em que o CNPJ aparece, com o item, a compra e o vencedor do item (para comparar preço).
-- Vencedor: 1º do PNCP válido, senão 1º do arquivo de propostas, senão a linha sem posição com valor
-- homologado ou marca (dados abertos fora de SRP / Pesquisa de Preços, que só trazem o vencedor).
create or replace function public.analise_cnpj_participacoes(p_cnpj text)
returns table (
  id_compra text, numero_item integer, classificacao integer, ordem_classificacao integer, situacao_resultado text,
  situacao_proposta text, valor_homologado numeric, quantidade_homologada numeric, valor_proposta numeric, valor_lance numeric,
  valor_negociado numeric, data_resultado date, motivo_cancelamento text, marca text,
  descricao text, quantidade numeric, unidade text, catmat text, situacao_item text, valor_estimado numeric,
  orgao_nome text, unidade_nome text, uasg text, uf text, modalidade text, numero text, ano integer, plataforma text,
  data_publicacao date, link_origem text, link_pncp text,
  vencedor_ni text, vencedor_nome text, vencedor_valor numeric)
language sql stable security invoker set search_path = public as $$
  select p.id_compra, p.numero_item, p.classificacao, p.ordem_classificacao, p.situacao_resultado,
         p.situacao_proposta, p.valor_homologado, p.quantidade_homologada, p.valor_proposta, p.valor_lance,
         p.valor_negociado, p.data_resultado, p.motivo_cancelamento, p.marca,
         i.descricao, i.quantidade, i.unidade, i.catmat, i.situacao_item, i.valor_estimado,
         c.orgao_nome, c.unidade_nome, c.uasg, c.uf, c.modalidade, c.numero, c.ano, c.plataforma,
         c.data_publicacao, c.link_origem, c.link_pncp,
         v.fornecedor_ni, v.fornecedor_nome, coalesce(v.valor_homologado, v.valor_negociado, v.valor_lance, v.valor_proposta)
    from public.historico_participacoes p
    join public.historico_itens i on i.id_compra = p.id_compra and i.numero_item = p.numero_item
    join public.historico_compras c on c.id_compra = p.id_compra
    left join lateral (
      select w.fornecedor_ni, w.fornecedor_nome, w.valor_homologado, w.valor_negociado, w.valor_lance, w.valor_proposta
        from public.historico_participacoes w
       where w.id_compra = p.id_compra and w.numero_item = p.numero_item
         and coalesce(w.situacao_resultado, '') !~* 'cancel' and coalesce(w.situacao_proposta, '') <> '2'
         and (w.ordem_classificacao = 1 or w.classificacao = 1
              or (w.ordem_classificacao is null and w.classificacao is null and (w.valor_homologado is not null or w.marca_declarada is not null)))
       order by case when w.ordem_classificacao = 1 then 0 when w.classificacao = 1 then 1 else 2 end
       limit 1) v on true
   where p_cnpj ~ '^\d{14}$' and p.fornecedor_ni = p_cnpj
   order by coalesce(p.data_resultado, c.data_publicacao) desc nulls last, p.id_compra, p.numero_item
$$;
revoke all on function public.analise_cnpj_participacoes(text) from public, anon;
grant execute on function public.analise_cnpj_participacoes(text) to authenticated, service_role;

-- Teto por CNPJ em historico_participacoes (o arquivo de propostas de 24 meses de um fornecedor grande passa de
-- dezenas de milhares de linhas): guarda as p_max_linhas mais recentes e nada mais velho que p_meses (mínimo 37,
-- os 3 anos da "Licitação anterior", que lê as mesmas linhas). Devolve o tamanho por CNPJ para o log do robô.
create or replace function public.historico_participacoes_podar(p_cnpjs text[], p_max_linhas integer default 5000, p_meses integer default 37)
returns table (cnpj text, linhas bigint, apagadas bigint)
language plpgsql security definer set search_path = '' as $$
declare c text; n bigint;
begin
  foreach c in array coalesce(p_cnpjs, '{}') loop
    continue when c !~ '^\d{14}$';
    with ordenadas as (
      select p.ctid as linha, row_number() over (order by coalesce(p.data_resultado, h.data_publicacao) desc nulls last, p.atualizado_em desc) as pos,
             coalesce(p.data_resultado, h.data_publicacao) as quando
        from public.historico_participacoes p
        left join public.historico_compras h on h.id_compra = p.id_compra
       where p.fornecedor_ni = c)
    delete from public.historico_participacoes p using ordenadas o
     where p.ctid = o.linha and (o.pos > greatest(p_max_linhas, 100) or o.quando < (current_date - make_interval(months => greatest(p_meses, 37))));
    get diagnostics n = row_count;
    cnpj := c; apagadas := n;
    select count(*) into linhas from public.historico_participacoes x where x.fornecedor_ni = c;
    return next;
  end loop;
end $$;
revoke all on function public.historico_participacoes_podar(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.historico_participacoes_podar(text[], integer, integer) to service_role;

-- Prazo de guarda do cache de consultas (politica-privacidade.html): apaga o que foi gerado há mais de p_dias
-- (mínimo 8, acima da validade de 7 dias do cache). Os dados públicos das compras ficam; só o cache sai.
create or replace function public.historico_limpar_cache(p_dias integer default 30)
returns integer language plpgsql security definer set search_path = '' as $$
declare a integer; b integer; corte timestamptz := now() - make_interval(days => greatest(coalesce(p_dias, 30), 8));
begin
  delete from public.historico_consultas where gerado_em < corte;
  get diagnostics a = row_count;
  delete from public.historico_cnpj_consultas where gerado_em < corte;
  get diagnostics b = row_count;
  return a + b;
end $$;
revoke all on function public.historico_limpar_cache(integer) from public, anon, authenticated;
grant execute on function public.historico_limpar_cache(integer) to service_role;

notify pgrst, 'reload schema';
commit;


-- ========== filtros_salvos.sql ==========
-- Filtros salvos com nome, "sem interesse" por edital e hora do aviso dos lembretes (painel: Encontrar Licitações).
-- Aditivo e idempotente: não toca clientes.boletim_filtro (o filtro do Boletim continua como está).
-- Cada conta lê e grava só as próprias linhas (RLS); anon não tem acesso. Teste: testar_filtros_salvos.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.filtros_salvos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 60),
  filtro jsonb not null check (jsonb_typeof(filtro) = 'object' and octet_length(filtro::text) <= 4000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists filtros_salvos_nome_unico on public.filtros_salvos (cliente_id, lower(btrim(nome)));

create table if not exists public.editais_sem_interesse (
  cliente_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero_controle text not null check (length(numero_controle) between 1 and 120),
  objeto_resumo text check (objeto_resumo is null or length(objeto_resumo) <= 200),
  criado_em timestamptz not null default now(),
  primary key (cliente_id, numero_controle)
);

-- Tetos por conta (a tabela não cresce sem fim): 20 filtros e 5.000 descartes.
create or replace function public.limitar_filtros_salvos() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'filtros_salvos' then
    if tg_op = 'INSERT' and (select count(*) from public.filtros_salvos where cliente_id = new.cliente_id) >= 20 then
      raise exception 'Limite de 20 filtros salvos por conta.' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' then new.atualizado_em := now(); end if;
  elsif (select count(*) from public.editais_sem_interesse where cliente_id = new.cliente_id) >= 5000 then
    raise exception 'Limite de 5000 editais descartados por conta.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists filtros_salvos_limite on public.filtros_salvos;
create trigger filtros_salvos_limite before insert or update on public.filtros_salvos for each row execute function public.limitar_filtros_salvos();
drop trigger if exists sem_interesse_limite on public.editais_sem_interesse;
create trigger sem_interesse_limite before insert on public.editais_sem_interesse for each row execute function public.limitar_filtros_salvos();

alter table public.filtros_salvos enable row level security;
alter table public.editais_sem_interesse enable row level security;
drop policy if exists filtros_salvos_proprios on public.filtros_salvos;
create policy filtros_salvos_proprios on public.filtros_salvos for all to authenticated
  using (cliente_id = auth.uid()) with check (cliente_id = auth.uid());
drop policy if exists sem_interesse_proprios on public.editais_sem_interesse;
create policy sem_interesse_proprios on public.editais_sem_interesse for all to authenticated
  using (cliente_id = auth.uid()) with check (cliente_id = auth.uid());
revoke all on public.filtros_salvos, public.editais_sem_interesse from public, anon;
grant select, insert, update, delete on public.filtros_salvos, public.editais_sem_interesse to authenticated;
grant all on public.filtros_salvos, public.editais_sem_interesse to service_role;

-- Lembretes: hora do aviso (Brasília) e carimbo do envio. Só se a tabela existe (o ensaio PGlite não a tem).
do $$
begin
  if to_regclass('public.lembretes') is not null then
    alter table public.lembretes add column if not exists hora_aviso smallint not null default 8;
    alter table public.lembretes add column if not exists enviado_em timestamptz;
    if not exists (select 1 from pg_constraint where conname = 'lembretes_hora_aviso_valida') then
      alter table public.lembretes add constraint lembretes_hora_aviso_valida check (hora_aviso between 0 and 23);
    end if;
  end if;
end $$;
commit;


-- ========== operacao_contratos_publicos.sql ==========
-- Contrato, empenho e pagamento vindos de fontes públicas (etapa 8 da esteira; scripts/esteira_contratos.js).
-- PNCP (contrato, termos/aditivos, empenhos) e Contratos.gov.br (empenhado, liquidado, pago, faturas). Sem login.
-- Idempotente, transação única; rodar depois do 01-aplicar.sql e do operacao_esteira.sql. Não apaga dados.
-- Só o robô (service_role) escreve; o usuário só lê, pela mesma regra de empresa das tarefas da esteira.
-- É a cópia pública: o cadastro manual do usuário continua em operacao_contratos / operacao_empenhos.
begin;
do $$ begin
 if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null
  or to_regclass('public.operacao_processos_id_empresa_org_idx') is null
  or to_regclass('public.operacao_esteira_tarefas') is null then
  raise exception 'Aplique antes 01-aplicar.sql e operacao_esteira.sql';
 end if;
end $$;

create table if not exists public.operacao_contratos_publicos (
  organizacao_id uuid not null,
  empresa_id uuid not null,
  processo_id uuid not null,
  chave text not null check (length(chave) between 3 and 80), -- numeroControlePNCP do instrumento, ou 'cg:<id>' só no Contratos.gov
  tipo text not null default 'contrato' check (tipo in ('contrato', 'empenho', 'outro')),
  numero text check (length(numero) <= 60),
  objeto text check (length(objeto) <= 1000),
  fornecedor_cnpj text check (fornecedor_cnpj ~ '^\d{14}$'),
  fornecedor_nome text check (length(fornecedor_nome) <= 300),
  assinatura date,
  vigencia_inicio date,
  vigencia_fim date,
  valor_global numeric(15,2),
  valor_empenhado numeric(15,2),
  valor_liquidado numeric(15,2),  -- sem check: o Siafi publica estorno (valor negativo)
  valor_pago numeric(15,2),
  a_pagar numeric(15,2),          -- liquidado e ainda não pago
  liquidado_sem_pagamento_desde date, -- liquidação mais antiga ainda sem pagamento (null = data não publicada ou em dia)
  aditivos jsonb not null default '[]'::jsonb check (jsonb_typeof(aditivos) = 'array' and octet_length(aditivos::text) <= 200000),
  empenhos jsonb not null default '[]'::jsonb check (jsonb_typeof(empenhos) = 'array' and octet_length(empenhos::text) <= 200000),
  faturas jsonb not null default '[]'::jsonb check (jsonb_typeof(faturas) = 'array' and octet_length(faturas::text) <= 400000),
  fontes jsonb not null default '{}'::jsonb check (jsonb_typeof(fontes) = 'object'),
  contratos_gov_id bigint,
  consultado_em timestamptz not null default now(),
  primary key (processo_id, chave),
  foreign key (processo_id, empresa_id, organizacao_id)
    references public.operacao_processos(id, empresa_id, organizacao_id) on delete cascade
);
create index if not exists operacao_contratos_publicos_empresa_idx on public.operacao_contratos_publicos (empresa_id, vigencia_fim);

alter table public.operacao_contratos_publicos enable row level security;
revoke all on public.operacao_contratos_publicos from public, anon, authenticated;
grant select on public.operacao_contratos_publicos to authenticated;
grant all on public.operacao_contratos_publicos to service_role;
drop policy if exists operacao_contratos_publicos_leitura on public.operacao_contratos_publicos;
create policy operacao_contratos_publicos_leitura on public.operacao_contratos_publicos for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));

notify pgrst, 'reload schema';
commit;


-- ========== operacao_execucao_fases.sql ==========
-- Execução do contrato em fases (Potencial → Empenhado → Entregue → Faturado → Recebido), aba "Empenhos e execução"
-- de processos.html. Guarda só o que a PESSOA lança quando a fonte oficial não trouxe: entrega, nota fiscal e recebimento.
-- Empenho manual continua em operacao_empenhos; contrato manual em operacao_contratos; o oficial em operacao_contratos_publicos.
-- A conta das fases (maior valor entre oficial e lançado, em centavos) fica em contrato-publico.js (fasesExecucao).
-- Idempotente (pode rodar mais de uma vez no SQL Editor do Supabase), transação única, não apaga dados.
-- Rodar depois do 01-aplicar.sql (que já traz operacao_acompanhamento.sql e seguranca_operacao.sql).
begin;
do $$ begin
 if to_regprocedure('public.pode_acessar_processo_operacao(uuid,uuid)') is null
  or to_regprocedure('public.pode_escrever_processo_operacao(uuid,uuid)') is null
  or to_regclass('public.operacao_processos_id_org_idx') is null then
  raise exception 'Aplique antes 01-aplicar.sql (operacao_acompanhamento.sql e seguranca_operacao.sql)';
 end if;
end $$;

create table if not exists public.operacao_execucao_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  processo_id uuid not null,
  tipo text not null check (tipo in ('entrega', 'nota', 'recebimento')),
  ocorrido_em date not null,
  valor numeric(15,2) not null check (valor > 0),
  referencia text check (length(referencia) <= 100), -- número da nota fiscal, do termo de recebimento ou do empenho
  observacoes text check (length(observacoes) <= 2000),
  criado_em timestamptz not null default now(),
  foreign key (processo_id, organizacao_id) references public.operacao_processos(id, organizacao_id) on delete cascade
);
create index if not exists operacao_execucao_eventos_processo_idx on public.operacao_execucao_eventos (processo_id, ocorrido_em);

-- Mesma regra das outras tabelas do processo (seguranca_operacao.sql): lê quem acessa a empresa; escreve gestor/operador.
alter table public.operacao_execucao_eventos enable row level security;
revoke all on public.operacao_execucao_eventos from public, anon;
grant select, insert, update, delete on public.operacao_execucao_eventos to authenticated;
grant all on public.operacao_execucao_eventos to service_role;
drop policy if exists operacao_execucao_eventos_da_empresa on public.operacao_execucao_eventos;
drop policy if exists operacao_execucao_eventos_da_empresa_escrita on public.operacao_execucao_eventos;
create policy operacao_execucao_eventos_da_empresa on public.operacao_execucao_eventos for select to authenticated
  using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_execucao_eventos_da_empresa_escrita on public.operacao_execucao_eventos for all to authenticated
  using (public.pode_escrever_processo_operacao(organizacao_id, processo_id))
  with check (public.pode_escrever_processo_operacao(organizacao_id, processo_id));

notify pgrst, 'reload schema';
commit;


-- ========== painel_dashboard_rapido.sql ==========
-- Painel: "Visão geral do mercado" rápida e RPCs do dashboard fechadas para anon.
-- Idempotente: seguro rodar mais de uma vez no SQL Editor do Supabase.
--
-- Por quê (produção, 19/11/2026): dashboard_estados_distintos e dashboard_segmentos_top rodam como invoker
-- sobre public.contratos (100k+ linhas, RLS) e estouravam o statement timeout (57014), inclusive chamadas
-- com a chave pública anon, que nem enxerga linha nenhuma e não deveria poder executá-las.
-- Correção: o robô scripts/atualizar_dados.js (service_role) grava o resumo pronto em
-- public.dados_robo, chave 'dashboard_mercado'; o painel lê essa linha primeiro e só cai nas RPCs se ela
-- não existir. Nenhuma função nova: o resumo é calculado no robô com a base que ele já tem em memória.
--
-- O que este arquivo faz (só acrescenta / restringe; não altera nem remove policies existentes, que em
-- produção podem ter outros nomes):
--   1) policy ADICIONAL de select para authenticated só na chave 'dashboard_mercado' de dados_robo;
--   2) revoke execute das 3 funções dashboard_* de anon e public, mantendo authenticated e service_role.
-- Ordem no roteiro: aplicar ANTES de publicar o painel novo (o painel antigo continua funcionando para
-- authenticated); depois rodar o robô uma vez para criar a linha 'dashboard_mercado'.
-- Depende de: public.dados_robo e das funções dashboard_* (painel_objetos_sem_sql.sql / produção).

drop policy if exists dados_robo_select_dashboard_mercado on public.dados_robo;
create policy dados_robo_select_dashboard_mercado on public.dados_robo for select to authenticated
  using (chave = 'dashboard_mercado');

grant select on public.dados_robo to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.dashboard_estados_distintos()',
    'public.dashboard_estados_top(integer)',
    'public.dashboard_segmentos_top(integer)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from anon, public', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
end $$;

-- Conferência (deve dar false, true, true para cada função):
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--        has_function_privilege('service_role', p.oid, 'execute') as service_role
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname like 'dashboard\_%';


-- ========== sinapi.sql ==========
-- ============================================================================
-- LicitaPlena — SINAPI (preços de insumos e custos de composições da CAIXA, por UF).
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única;
-- só cria objetos novos (não altera nem apaga dados de outras tabelas).
-- Escrita: só o robô scripts/coletar_sinapi.js (service_role), uma vez por mês.
-- Leitura: cliente aprovado (cliente_aprovado()), pela tela sinapi.html. anon não lê.
--
-- Cache da referência mais recente: uma linha por (UF, tipo, desonerado, código). O robô faz upsert e depois
-- apaga, da UF que carregou, o que ficou com referência anterior (código que saiu do SINAPI). Dado público.
-- ============================================================================
begin;

create table if not exists public.sinapi_precos (
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  tipo text not null check (tipo in ('insumo', 'composicao')),
  desonerado boolean not null,
  codigo text not null check (codigo ~ '^[0-9]{1,10}$'),
  descricao text not null check (length(descricao) between 1 and 2000),
  unidade text check (unidade is null or length(unidade) <= 30),
  -- Insumo: classificação (MATERIAL, SERVIÇOS...); composição: grupo (Acessibilidade, Alvenaria...).
  grupo text check (grupo is null or length(grupo) <= 200),
  -- Insumo: origem do preço (C = coletado, CR = coeficiente de representatividade, AS = atribuído de SP).
  origem text check (origem is null or length(origem) <= 10),
  preco numeric(14, 2) not null check (preco > 0),
  -- Mês de referência da CAIXA (sempre dia 1).
  referencia date not null check (extract(day from referencia) = 1),
  -- Descrição minúscula e sem acento, montada pelo robô para o ILIKE da busca.
  busca text not null default '' check (length(busca) <= 2000),
  coletado_em timestamptz not null default now(),
  primary key (uf, tipo, desonerado, codigo)
);
-- shortcut: a busca por texto faz ILIKE dentro de (uf, tipo, desonerado) da chave primária: ~5 mil insumos ou
-- ~11 mil composições por UF, rápido sem índice. Com muitas UFs e lentidão, criar índice gin_trgm_ops em busca.

alter table public.sinapi_precos enable row level security;
revoke all on public.sinapi_precos from anon, authenticated;
grant select on public.sinapi_precos to authenticated;
revoke truncate on public.sinapi_precos from service_role;
grant select, insert, update, delete on public.sinapi_precos to service_role;

-- Mesmo corpo de prospeccao.sql e historico_licitacoes.sql: este arquivo roda sozinho.
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

drop policy if exists sinapi_precos_select_aprovado on public.sinapi_precos;
create policy sinapi_precos_select_aprovado on public.sinapi_precos
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (bypassrls) grava.

commit;


-- ========== analise_cnpj_v2.sql ==========
-- Análise por CNPJ, parte 2 (tela "Analisar concorrente"): dados cadastrais da Receita e contratos por fornecedor.
-- Idempotente, transação única; rodar DEPOIS de analise_cnpj.sql (e de historico_licitacoes.sql, que cria
-- cliente_aprovado()). Não apaga dados.
--   empresas_cadastro               cache da base aberta de CNPJ da Receita (BrasilAPI; minhareceita.org de reserva):
--      situação, porte, natureza, abertura, capital social, CNAE principal/secundários e sócios. Sócio guarda SÓ
--      nome como publicado, qualificação e data de entrada: CPF nunca entra (a Receita já mascara; o CHECK barra).
--   historico_contratos_fornecedor  contratos publicados no PNCP por fornecedor (busca PNCP com o filtro de
--      fornecedor), com a UF da UNIDADE contratante (a sub-rogada, se houver), não a da sede do órgão: um contrato
--      da UFAM em Manaus conta AM mesmo com o órgão federal. Contrato federal ganha empenhado, liquidado, pago e
--      faturado (notas fiscais/faturas) pelo Contratos.gov.br, preenchidos pelo robô (scripts/analise_cnpj.js).
--   historico_cnpj_consultas.contratos_*  estado da leitura de contratos na fila do robô.
-- Dado público: qualquer cliente aprovado lê (cliente_aprovado()); só service_role (função e robô) escreve.
begin;
do $$ begin
 if to_regclass('public.historico_cnpj_consultas') is null or to_regprocedure('public.cliente_aprovado()') is null then
  raise exception 'Aplique antes historico_licitacoes.sql e analise_cnpj.sql';
 end if;
end $$;

create table if not exists public.empresas_cadastro (
  cnpj text primary key check (cnpj ~ '^\d{14}$'),
  razao_social text check (length(razao_social) <= 300),
  nome_fantasia text check (length(nome_fantasia) <= 300),
  situacao text check (length(situacao) <= 60),
  data_situacao date,
  motivo_situacao text check (length(motivo_situacao) <= 200),
  situacao_especial text check (length(situacao_especial) <= 200),
  porte text check (length(porte) <= 60),
  natureza_juridica text check (length(natureza_juridica) <= 200),
  data_abertura date,
  capital_social numeric(18,2),
  opcao_simples boolean,
  opcao_mei boolean,
  cnae_principal jsonb check (cnae_principal is null or jsonb_typeof(cnae_principal) = 'object'),
  cnaes_secundarios jsonb not null default '[]'::jsonb check (jsonb_typeof(cnaes_secundarios) = 'array' and octet_length(cnaes_secundarios::text) <= 60000),
  socios jsonb not null default '[]'::jsonb check (jsonb_typeof(socios) = 'array' and octet_length(socios::text) <= 60000),
  municipio text check (length(municipio) <= 120),
  uf text check (uf ~ '^[A-Z]{2}$'),
  fonte text not null check (fonte in ('brasilapi', 'minhareceita')),
  consultado_em timestamptz not null default now()
);
-- LGPD: nenhum CPF (nem em nome de MEI, nem em sócio). Mesma regex de _cpf.js, mais o pedaço mascarado que a Receita
-- põe no nome do MEI ("FULANA ***75059***", ver CPF_MASCARADO em _analise_cnpj.js). Limpeza única antes do CHECK.
update public.empresas_cadastro set razao_social = nullif(btrim(regexp_replace(regexp_replace(razao_social, '\*+[0-9.-]*[0-9][0-9.-]*\*+', ' ', 'g'), '\s+', ' ', 'g')), '')
 where razao_social ~ '\*+[0-9.-]*[0-9][0-9.-]*\*+';
update public.empresas_cadastro set nome_fantasia = nullif(btrim(regexp_replace(regexp_replace(nome_fantasia, '\*+[0-9.-]*[0-9][0-9.-]*\*+', ' ', 'g'), '\s+', ' ', 'g')), '')
 where nome_fantasia ~ '\*+[0-9.-]*[0-9][0-9.-]*\*+';
alter table public.empresas_cadastro drop constraint if exists empresas_cadastro_sem_cpf;
alter table public.empresas_cadastro add constraint empresas_cadastro_sem_cpf check (
  coalesce(razao_social, '') !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'
  and coalesce(nome_fantasia, '') !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'
  and socios::text !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'
  and socios::text !~* 'cpf'
  and coalesce(razao_social, '') || coalesce(nome_fantasia, '') || socios::text !~ '\*[0-9.-]*[0-9][0-9.-]*\*');
create index if not exists empresas_cadastro_consultado_idx on public.empresas_cadastro (consultado_em);

create table if not exists public.historico_contratos_fornecedor (
  numero_controle_pncp text primary key check (numero_controle_pncp ~ '^\d{14}-2-\d+/\d{4}$'),
  fornecedor_ni text not null check (fornecedor_ni ~ '^\d{14}$'),
  fornecedor_nome text check (length(fornecedor_nome) <= 300),
  orgao_cnpj text check (orgao_cnpj ~ '^\d{14}$'),
  orgao_nome text check (length(orgao_nome) <= 300),
  unidade_codigo text check (length(unidade_codigo) <= 20),
  unidade_nome text check (length(unidade_nome) <= 300),
  municipio text check (length(municipio) <= 120),
  uf text check (uf ~ '^[A-Z]{2}$'),
  esfera text check (esfera in ('F', 'E', 'M', 'D', 'N')),
  tipo text check (length(tipo) <= 80),
  numero text check (length(numero) <= 60),
  ano integer,
  objeto text check (length(objeto) <= 1000),
  data_assinatura date,
  vigencia_inicio date,
  vigencia_fim date,
  valor_global numeric(18,2),
  valor_empenhado numeric(18,2),
  valor_liquidado numeric(18,2),
  valor_pago numeric(18,2),
  valor_faturado numeric(18,2),
  contratos_gov_id bigint,
  gov_consultado_em timestamptz,
  link_pncp text check (link_pncp ~ '^https://pncp\.gov\.br/'),
  atualizado_em timestamptz not null default now()
);
create index if not exists historico_contratos_fornecedor_ni_idx on public.historico_contratos_fornecedor (fornecedor_ni, data_assinatura desc);
create index if not exists historico_contratos_fornecedor_gov_idx on public.historico_contratos_fornecedor (fornecedor_ni, gov_consultado_em nulls first) where esfera = 'F';

do $$ declare t text; begin
 foreach t in array array['empresas_cadastro', 'historico_contratos_fornecedor'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select on public.%I to authenticated', t);
  execute format('grant all on public.%I to service_role', t);
  execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
  execute format('create policy %I on public.%I for select to authenticated using (public.cliente_aprovado())', t || '_leitura', t);
 end loop;
end $$;

-- Fila: contratos lidos (todas as páginas do PNCP) e quantos o PNCP lista. Sem contratos_lidos_em o robô lê.
alter table public.historico_cnpj_consultas add column if not exists contratos_total integer;
alter table public.historico_cnpj_consultas add column if not exists contratos_lidos_em timestamptz;

-- Prazo de guarda do cache cadastral: o que não é consultado há mais de p_dias (mínimo 31, acima da validade de 30
-- dias) sai. Os contratos são dado público de compras e ficam (como as tabelas historico_*).
create or replace function public.empresas_cadastro_limpar(p_dias integer default 180)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.empresas_cadastro where consultado_em < now() - make_interval(days => greatest(coalesce(p_dias, 180), 31));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.empresas_cadastro_limpar(integer) from public, anon, authenticated;
grant execute on function public.empresas_cadastro_limpar(integer) to service_role;

notify pgrst, 'reload schema';
commit;


-- ========== analise_cnpj_v3.sql ==========
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


-- ========== decisao_oportunidade.sql ==========
-- Aplicar em homologação antes de habilitar DECISAO_CLIENTE_ATIVA=1.
begin;
create table if not exists public.decisoes_oportunidade (
 id uuid primary key default gen_random_uuid(),
 usuario_id uuid not null references auth.users(id),
 empresa_id uuid not null references public.operacao_empresas(id),
 destinatario text not null, edital text not null, objeto text not null,
 empresa_nome text not null, empresa_cnpj text not null,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 criado_em timestamptz not null default now(), expira_em timestamptz not null default now()+interval '7 days',
 envio_status text not null default 'preparado' check(envio_status in ('preparado','enviado','falhou','incerto')),
 decisao text check(decisao in ('participar','nao_participar')), respondido_em timestamptz, nome_declarado text
);
alter table public.decisoes_oportunidade enable row level security;
revoke all on public.decisoes_oportunidade from public,anon,authenticated;
grant all on public.decisoes_oportunidade to service_role;

create or replace function public.criar_decisao_oportunidade(p_usuario uuid,p_empresa uuid,p_destino text,p_edital text,p_objeto text,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.operacao_empresas;
begin
 select x.* into e from public.operacao_empresas x join public.operacao_membros m on m.organizacao_id=x.organizacao_id
 join public.clientes c on c.id=m.usuario_id and c.status='aprovado'
 where x.id=p_empresa and m.usuario_id=p_usuario and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=x.id);
 if e.id is null then return jsonb_build_object('ok',false); end if;
 if length(p_destino)>254 or length(p_edital)>100 or length(p_objeto)>1000 then raise exception 'Entrada inválida'; end if;
 insert into public.decisoes_oportunidade(usuario_id,empresa_id,destinatario,edital,objeto,empresa_nome,empresa_cnpj,token_hash)
 values(p_usuario,e.id,p_destino,p_edital,p_objeto,e.razao_social,coalesce(e.cnpj,''),p_hash);
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.responder_decisao_oportunidade(p_hash text,p_decisao text default null,p_nome text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.decisoes_oportunidade;
begin
 select * into r from public.decisoes_oportunidade where token_hash=p_hash for update;
 if r.id is null or r.expira_em<=now() or r.envio_status='falhou' then return null; end if;
 if p_decisao is not null then
  if p_decisao not in ('participar','nao_participar') or p_nome is null or length(trim(p_nome))<2 or length(p_nome)>100 then raise exception 'Decisão inválida'; end if;
  if r.decisao is not null and r.decisao<>p_decisao then return jsonb_build_object('conflito',true); end if;
  if r.decisao is null then
   update public.decisoes_oportunidade set decisao=p_decisao,nome_declarado=trim(p_nome),respondido_em=now() where id=r.id returning * into r;
  end if;
 end if;
 return jsonb_build_object('empresa',r.empresa_nome,'cnpj',r.empresa_cnpj,'edital',r.edital,'objeto',r.objeto,'decisao',r.decisao,'respondidoEm',r.respondido_em,'expiraEm',r.expira_em);
end $$;

create or replace function public.listar_decisoes_oportunidade(p_usuario uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
 select d.id,d.empresa_nome,d.edital,d.objeto,d.destinatario,d.decisao,d.respondido_em,d.nome_declarado,d.expira_em,d.envio_status
 from public.decisoes_oportunidade d
 where d.usuario_id=p_usuario and exists(select 1 from public.operacao_empresas e join public.operacao_membros m on m.organizacao_id=e.organizacao_id join public.clientes c on c.id=m.usuario_id and c.status='aprovado'
 where e.id=d.empresa_id and m.usuario_id=p_usuario and (m.empresa_id is null or m.empresa_id=e.id))
 order by d.criado_em desc limit 100) x;
$$;
create or replace function public.marcar_envio_decisao(p_hash text,p_usuario uuid,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('enviado','falhou','incerto') then return false; end if;
 update public.decisoes_oportunidade set envio_status=p_status where token_hash=p_hash and usuario_id=p_usuario and envio_status='preparado';
 return found;
end $$;
revoke all on function public.marcar_envio_decisao(text,uuid,text) from public,anon,authenticated;
grant execute on function public.marcar_envio_decisao(text,uuid,text) to service_role;
revoke all on function public.criar_decisao_oportunidade(uuid,uuid,text,text,text,text), public.responder_decisao_oportunidade(text,text,text), public.listar_decisoes_oportunidade(uuid) from public,anon,authenticated;
grant execute on function public.criar_decisao_oportunidade(uuid,uuid,text,text,text,text), public.responder_decisao_oportunidade(text,text,text), public.listar_decisoes_oportunidade(uuid) to service_role;
commit;


-- ========== seguranca_aprovacao_20261119.sql ==========
-- Segurança do status do cadastro (teste de ataque local de 19/11/2026: A1, A2, M1, M3, M4, M5 e B1).
-- Idempotente: seguro rodar mais de uma vez no SQL Editor do Supabase. Não apaga dados.
-- Rodar DEPOIS de todos os outros .sql (acesso_empresa_convites, seguranca_operacao, pregoes_gravados,
-- operacao_perfil_empresa, painel_*...): este arquivo redefine funções e policies que eles criam. Se um deles
-- for rodado de novo, rode este outra vez em seguida.
-- Teste: supabase/testar_seguranca_aprovacao.sql.
begin;

-- Mesmo corpo de historico_licitacoes.sql / prospeccao.sql / sinapi.sql (redefinido para este arquivo não depender da ordem).
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

-- Quem aprova cadastros: owner administrativo ou, em produção, admin_tem_permissao('aprovar_cadastros') com MFA
-- (a mesma regra da policy admin_atualiza_qualquer_registro de clientes, que não tem .sql no repositório).
create or replace function public.pode_aprovar_cadastros() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if auth.uid() is null then return false; end if;
  if public.eh_owner_admin_operacao(auth.uid()) then return true; end if;
  if to_regprocedure('public.admin_tem_permissao(text)') is not null then
    execute $q$select public.admin_tem_permissao('aprovar_cadastros') and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'$q$ into v;
  end if;
  return coalesce(v, false);
end $$;
revoke all on function public.pode_aprovar_cadastros() from public, anon;
grant execute on function public.pode_aprovar_cadastros() to authenticated, service_role;

-- A1/B1: pelo PostgREST (papel authenticated) a pessoa só muda o PERFIL do próprio cadastro. status, plano,
-- aprovado_em, aprovado_por e observacoes_admin só mudam por quem aprova cadastros ou por função security definer
-- (aceitar_convite_empresa_operacao, criar_cliente_no_cadastro), que roda como dono e por isso tem current_user
-- diferente de authenticated. Antes havia exceção para quem tinha operacao_membros.empresa_id: o operador
-- suspenso se reaprovava. GRANT por coluna não serve aqui: o admin.html aprova pelo mesmo papel authenticated.
create or replace function public.proteger_status_cliente_operacao()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if auth.uid() is distinct from new.id or public.pode_aprovar_cadastros() then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.status, 'pendente') <> 'pendente' or new.plano is not null or new.aprovado_em is not null
      or new.aprovado_por is not null or new.observacoes_admin is not null then
      raise exception 'A aprovação do cadastro depende do administrador' using errcode = '42501';
    end if;
  elsif (new.status, new.plano, new.aprovado_em, new.aprovado_por, new.observacoes_admin)
    is distinct from (old.status, old.plano, old.aprovado_em, old.aprovado_por, old.observacoes_admin) then
    raise exception 'A aprovação do cadastro depende do administrador' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists proteger_status_cliente_operacao on public.clientes;
create trigger proteger_status_cliente_operacao before insert or update on public.clientes
  for each row execute function public.proteger_status_cliente_operacao();

-- A2: toda a RLS e o Storage do CRM passam por estas funções; agora exigem cadastro aprovado.
-- Corpos iguais aos de acesso_empresa_convites.sql e seguranca_operacao.sql + "and public.cliente_aprovado()".
-- pode_acessar_processo_operacao, acesso_arquivo_operacao, pode_escrever_processo_operacao e
-- escrita_arquivo_operacao chamam estas e herdam a checagem.
create or replace function public.eh_membro_operacao(p_organizacao_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.cliente_aprovado() and exists (select 1 from public.operacao_membros m
    where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid()
      and m.empresa_id is null);
$$;
create or replace function public.tem_vinculo_operacao(p_organizacao_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.cliente_aprovado() and exists (select 1 from public.operacao_membros m
    where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid());
$$;
create or replace function public.pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.cliente_aprovado() and exists (select 1 from public.operacao_empresas e
    join public.operacao_membros m on m.organizacao_id = e.organizacao_id
    where e.id = p_empresa and e.organizacao_id = p_org and m.usuario_id = auth.uid()
      and (m.empresa_id is null or m.empresa_id = e.id));
$$;
create or replace function public.pode_escrever_org_operacao(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select public.cliente_aprovado() and exists(select 1 from public.operacao_membros m where m.organizacao_id=p_org
  and m.usuario_id=auth.uid() and m.empresa_id is null and m.papel in ('gestor','operador'));
$$;
create or replace function public.pode_escrever_empresa_operacao(p_org uuid,p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select public.cliente_aprovado() and exists(select 1 from public.operacao_empresas e join public.operacao_membros m on m.organizacao_id=e.organizacao_id
  where e.id=p_empresa and e.organizacao_id=p_org and m.usuario_id=auth.uid()
  and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id));
$$;
revoke all on function public.eh_membro_operacao(uuid), public.tem_vinculo_operacao(uuid),
  public.pode_acessar_empresa_operacao(uuid,uuid), public.pode_escrever_org_operacao(uuid),
  public.pode_escrever_empresa_operacao(uuid,uuid) from public, anon;
grant execute on function public.eh_membro_operacao(uuid), public.tem_vinculo_operacao(uuid),
  public.pode_acessar_empresa_operacao(uuid,uuid), public.pode_escrever_org_operacao(uuid),
  public.pode_escrever_empresa_operacao(uuid,uuid) to authenticated;

-- O gate do servidor (identificacao_empresa_habilitada, seguranca_operacao.sql) fixa o md5 do corpo destas funções:
-- mesmo texto de lá, só com os hashes dos dois corpos novos acima. Sem isso a identificação da empresa fecharia (503).
create or replace function public.identificacao_empresa_habilitada()
returns boolean language sql stable security definer set search_path = public as $$
 with esperado(tabela,nome,comando,qual,checagem) as (values
 ('operacao_empresas','operacao_empresas_leitura','SELECT','pode_acessar_empresa_operacao(organizacao_id, id)',null),
 ('operacao_empresas','operacao_empresas_escrita','ALL','pode_escrever_org_operacao(organizacao_id)','pode_escrever_org_operacao(organizacao_id)'),
 ('operacao_documentos','operacao_documentos_da_empresa','SELECT','pode_acessar_empresa_operacao(organizacao_id, empresa_id)',null),
 ('operacao_documentos','operacao_documentos_da_empresa_escrita','ALL','pode_escrever_empresa_operacao(organizacao_id, empresa_id)','(pode_escrever_empresa_operacao(organizacao_id, empresa_id) AND arquivo_no_escopo_operacao(arquivo_caminho, organizacao_id, empresa_id))'),
 ('objects','operacao_arquivos_leitura','SELECT','((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))',null),
 ('objects','operacao_arquivos_envio','INSERT',null,'((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))'),
 ('objects','operacao_arquivos_atualizacao','UPDATE','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))'),
 ('objects','operacao_arquivos_exclusao','DELETE','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))',null)
 ), atual as (select * from pg_policies where (schemaname='public' and tablename in ('operacao_documentos','operacao_empresas')) or (schemaname='storage' and tablename='objects'))
 select auth.uid() is not null
 and exists(select 1 from storage.buckets where id='operacao-documentos' and public=false)
 and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity)
 and (select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('operacao_empresas','operacao_documentos','operacao_identificacao_empresa') and c.relrowsecurity)
 and not exists(select 1 from esperado e full join atual a on a.tablename=e.tabela and a.policyname=e.nome
  where e.nome is null or a.policyname is null or a.cmd<>e.comando or a.permissive<>'PERMISSIVE'
   or a.qual is distinct from e.qual or a.with_check is distinct from e.checagem
   or a.roles is distinct from case when e.nome in ('operacao_empresas_leitura','operacao_arquivos_leitura') then array['public']::name[] else array['authenticated']::name[] end)
 and not exists(select 1 from (values
 ('pode_escrever_org_operacao','2fd046964d53ddcf911e544620be10f5'),
 ('pode_escrever_empresa_operacao','af9e82d298241750c0fd69fa06799ad3'),
 ('pode_escrever_processo_operacao','7de47c8d343558a2dc2180ad2a4daffc'),
 ('arquivo_no_escopo_operacao','c727f040598b92b257a5322118447d6f'),
 ('escrita_arquivo_operacao','d95ab917f9d1faf6270e16d85dda42fd')
 ) as f(nome,hash) where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.nome and md5(replace(p.prosrc,chr(13),''))=f.hash));
$$;
revoke all on function public.identificacao_empresa_habilitada() from public,anon;
grant execute on function public.identificacao_empresa_habilitada() to authenticated;

-- M1: bases pagas só para cadastro aprovado. A busca pública da landing (busca-publica, convenios-publico) lê com
-- a chave de serviço e não depende destas policies. Cada policy de SELECT existente (os nomes de produção podem
-- diferir dos do repositório) passa a ser "to authenticated" e ganha "cliente_aprovado() and (<condição antiga>)".
-- dados_robo: o admin.html lê config_admin; quem aprova cadastros continua lendo mesmo sem linha em clientes.
do $$
declare t text; p record; cond text;
begin
  foreach t in array array['pregoes_gravados', 'pregoes_gravados_propostas', 'pregoes_gravados_mensagens',
    'oportunidades_abertas', 'dossies_editais', 'sancoes_empresas', 'contratos', 'mercado_atas',
    'comprasgov_resultados', 'dados_robo', 'empresas_cadastro', 'historico_contratos_fornecedor', 'extensao_diagnosticos'] loop
    continue when to_regclass('public.' || t) is null;
    cond := case when t = 'dados_robo' then '(public.cliente_aprovado() or public.pode_aprovar_cadastros())'
      else 'public.cliente_aprovado()' end;
    for p in select policyname, qual from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT' and permissive = 'PERMISSIVE' loop
      continue when p.qual like '%cliente_aprovado()%';
      execute format('alter policy %I on public.%I to authenticated using (%s and (%s))', p.policyname, t, cond, p.qual);
    end loop;
  end loop;
end $$;
-- RPCs do painel: as dashboard_* são invoker (a RLS de contratos acima já zera para o pendente);
-- resumo_inteligencia_mercado também é invoker, mas estava executável por anon.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname = 'resumo_inteligencia_mercado' or p.proname like 'dashboard\_%') loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- M3: CPF do representante fora do alcance do navegador. authenticated lê todas as colunas do perfil menos
-- cpf_representante; grava a coluna normalmente (INSERT/UPDATE intactos). O servidor (empresa-identificacao.js,
-- kit-documentos.js) confere o papel com o token do usuário e lê o CPF com a chave de serviço: mascarado para o
-- operador, completo para o gestor que pede e para a exportação das declarações.
do $$
declare cols text;
begin
  if to_regclass('public.operacao_perfil_empresa') is null then return; end if;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'operacao_perfil_empresa' and column_name <> 'cpf_representante';
  revoke select on public.operacao_perfil_empresa from authenticated;
  revoke select (cpf_representante) on public.operacao_perfil_empresa from authenticated;
  execute format('grant select (%s) on public.operacao_perfil_empresa to authenticated', cols);
end $$;

-- M4: tipo e tamanho no bucket privado (vale também para o upload direto do navegador). Tipos que as telas enviam:
-- documentos e anexos (PDF, Word, Excel, imagem), logo e foto do catálogo (PNG/JPEG). 15 MiB por arquivo.
do $$
begin
  if exists (select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set file_size_limit = 15728640, allowed_mime_types = array[
      'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet']
    where id = 'operacao-documentos';
  end if;
end $$;

-- M5: teto diário por IP dos proxies públicos (pncp-*, comprasgov-*), que o painel chama sem token.
-- chave = HMAC-SHA256 do IP feito no servidor (nunca o IP puro). Guarda só ontem e hoje (minimização, LGPD).
create table if not exists public.uso_ip_diario (
  chave text not null check (chave ~ '^[0-9a-f]{64}$'),
  funcao text not null check (length(funcao) between 1 and 60),
  dia date not null default current_date,
  contagem integer not null default 0,
  primary key (chave, funcao, dia)
);
alter table public.uso_ip_diario enable row level security;
revoke all on public.uso_ip_diario from public, anon, authenticated;
create or replace function public.incrementar_uso_ip(p_chave text, p_funcao text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.uso_ip_diario (chave, funcao, dia, contagem) values (p_chave, p_funcao, current_date, 1)
  on conflict (chave, funcao, dia) do update set contagem = public.uso_ip_diario.contagem + 1
  returning contagem into n;
  if random() < 0.01 then delete from public.uso_ip_diario where dia < current_date - 1; end if;
  return n;
end $$;
revoke all on function public.incrementar_uso_ip(text, text) from public, anon, authenticated;
grant execute on function public.incrementar_uso_ip(text, text) to service_role;

notify pgrst, 'reload schema';
commit;


-- ========== operacao_monitor_edital.sql ==========
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


-- ========== boletim_por_empresa.sql ==========
-- Boletim e jornais por empresa (CNPJ): cada empresa da organização tem o seu filtro do Boletim, e os
-- filtros salvos (jornais) podem pertencer a uma empresa. Aditivo e idempotente; rodar DEPOIS de
-- filtros_salvos.sql e seguranca_aprovacao_20261119.sql. Não apaga clientes.boletim_filtro: o filtro antigo
-- da conta vira o da empresa ativa no primeiro acesso ao painel (painel.html, carregarFiltroBoletimConta),
-- e o robô de e-mail continua usando o cadastro antigo para quem ainda não tem filtro por empresa.
-- Teste: testar_boletim_por_empresa.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
  if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null or to_regclass('public.filtros_salvos') is null then
    raise exception 'Aplique antes seguranca_aprovacao_20261119.sql e filtros_salvos.sql';
  end if;
end $$;

create table if not exists public.boletim_filtros_empresa (
  empresa_id uuid primary key references public.operacao_empresas(id) on delete cascade,
  organizacao_id uuid not null,
  -- Quem salvou por último recebe o e-mail do Boletim desta empresa (scripts/boletim_editais.py).
  cliente_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  filtro jsonb not null,
  atualizado_em timestamptz not null default now()
);
-- Mesmo formato de clientes.boletim_filtro (ufs + palavrasRaw obrigatórios).
alter table public.boletim_filtros_empresa drop constraint if exists boletim_filtros_empresa_filtro_valido;
alter table public.boletim_filtros_empresa add constraint boletim_filtros_empresa_filtro_valido check (
  jsonb_typeof(filtro) = 'object' and filtro ?& array['ufs', 'palavrasRaw'] and jsonb_typeof(filtro->'ufs') = 'array'
  and jsonb_typeof(filtro->'palavrasRaw') = 'string' and jsonb_array_length(filtro->'ufs') <= 27
  and length(btrim(filtro->>'palavrasRaw')) between 1 and 1000 and octet_length(filtro::text) <= 4000);
create index if not exists boletim_filtros_empresa_org_idx on public.boletim_filtros_empresa (organizacao_id);

-- A empresa precisa ser da organização informada (a policy confere o par organização + empresa).
create or replace function public.boletim_filtro_empresa_coerente() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.operacao_empresas e where e.id = new.empresa_id and e.organizacao_id = new.organizacao_id) then
    raise exception 'Empresa não pertence à organização.' using errcode = 'check_violation';
  end if;
  new.atualizado_em := now();
  new.cliente_id := coalesce(auth.uid(), new.cliente_id);
  return new;
end $$;
drop trigger if exists boletim_filtros_empresa_coerente on public.boletim_filtros_empresa;
create trigger boletim_filtros_empresa_coerente before insert or update on public.boletim_filtros_empresa
  for each row execute function public.boletim_filtro_empresa_coerente();

alter table public.boletim_filtros_empresa enable row level security;
drop policy if exists boletim_filtros_empresa_leitura on public.boletim_filtros_empresa;
create policy boletim_filtros_empresa_leitura on public.boletim_filtros_empresa for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists boletim_filtros_empresa_escrita on public.boletim_filtros_empresa;
create policy boletim_filtros_empresa_escrita on public.boletim_filtros_empresa for all to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
revoke all on public.boletim_filtros_empresa from public, anon;
grant select, insert, update, delete on public.boletim_filtros_empresa to authenticated;
grant all on public.boletim_filtros_empresa to service_role;

-- Jornais (filtros salvos) por empresa: empresa_id opcional; sem empresa = filtro da conta (vale para todas).
alter table public.filtros_salvos add column if not exists empresa_id uuid references public.operacao_empresas(id) on delete cascade;
drop index if exists public.filtros_salvos_nome_unico;
create unique index if not exists filtros_salvos_nome_empresa_unico
  on public.filtros_salvos (cliente_id, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(nome)));
drop policy if exists filtros_salvos_proprios on public.filtros_salvos;
create policy filtros_salvos_proprios on public.filtros_salvos for all to authenticated
  using (cliente_id = auth.uid() and public.cliente_aprovado())
  with check (cliente_id = auth.uid() and public.cliente_aprovado() and (empresa_id is null or exists (
    select 1 from public.operacao_empresas e where e.id = empresa_id and public.pode_acessar_empresa_operacao(e.organizacao_id, e.id))));
notify pgrst, 'reload schema';
commit;


-- ========== operacao_funil_checklist.sql ==========
-- Funil: checklist padrão por etapa, marcações por processo e favoritas (modelo Siga Pregão, item 15 da análise).
-- Idempotente; rodar no SQL Editor depois de operacao_licitacoes.sql, seguranca_operacao.sql e operacao_funil_etapas.sql.
-- Só acrescenta colunas: nenhuma tabela nova. A RLS que já existe vale para elas:
--  * operacao_funil_etapas.tarefas: escrita só por pode_escrever_org_operacao (mesma regra de renomear etapa);
--  * operacao_processos.checklist_funil / favorito: escrita por pode_escrever_empresa_operacao, leitura por pode_acessar_empresa_operacao.
-- Não tocam atualizado_em (controle de concorrência do kit e do checklist do edital) nem disparam a esteira (gatilho só em "update of status").
begin;
do $$ begin
 if to_regclass('public.operacao_funil_etapas') is null or to_regclass('public.operacao_processos') is null then
  raise exception 'Aplique antes operacao_licitacoes.sql e operacao_funil_etapas.sql';
 end if;
end $$;

-- Nulo = a empresa não mexeu: o painel usa as tarefas padrão do estágio. Lista de {id, titulo, link?, esteira?}, até 30.
alter table public.operacao_funil_etapas add column if not exists tarefas jsonb;
alter table public.operacao_funil_etapas drop constraint if exists operacao_funil_etapas_tarefas_validas;
alter table public.operacao_funil_etapas add constraint operacao_funil_etapas_tarefas_validas
  check (tarefas is null or (jsonb_typeof(tarefas) = 'array' and jsonb_array_length(tarefas) <= 30 and pg_column_size(tarefas) <= 16384));

-- Tarefa marcada: {id_da_tarefa: data em que marcou}.
alter table public.operacao_processos add column if not exists checklist_funil jsonb not null default '{}'::jsonb;
alter table public.operacao_processos drop constraint if exists operacao_processos_checklist_funil_valido;
alter table public.operacao_processos add constraint operacao_processos_checklist_funil_valido
  check (jsonb_typeof(checklist_funil) = 'object' and pg_column_size(checklist_funil) <= 16384);
alter table public.operacao_processos add column if not exists favorito boolean not null default false;

notify pgrst, 'reload schema';
commit;


-- ========== funil_quadros.sql ==========
-- Quadros: kanbans livres por empresa (CNPJ), com colunas próprias e cartões que podem apontar para um processo do funil.
-- Referência: "Negócios > Quadros" do Siga Pregão (_historico/siga-pregao-canal-analise-20261119.md); aqui o quadro não
-- substitui o Funil (operacao_funil_etapas): serve para tarefas e rotinas que não cabem nas etapas da licitação.
-- Idempotente; rodar no SQL Editor depois de operacao_licitacoes.sql, seguranca_operacao.sql e seguranca_aprovacao_20261119.sql.
-- Teste: supabase/testar_funil_quadros.sql.
-- Leitura: pode_acessar_empresa_operacao; escrita: pode_escrever_empresa_operacao (as duas já exigem cliente_aprovado()).
begin;
do $$ begin
 if to_regclass('public.operacao_empresas') is null or to_regclass('public.operacao_processos') is null
    or to_regprocedure('public.pode_escrever_empresa_operacao(uuid,uuid)') is null then
  raise exception 'Aplique antes operacao_licitacoes.sql e seguranca_operacao.sql';
 end if;
end $$;

create table if not exists public.operacao_quadros (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  empresa_id uuid not null references public.operacao_empresas(id) on delete cascade,
  nome text not null check (nome = btrim(nome) and length(nome) between 1 and 60),
  criado_por uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (id, organizacao_id, empresa_id)
);
create index if not exists operacao_quadros_empresa_idx on public.operacao_quadros (empresa_id, criado_em);

create table if not exists public.operacao_quadros_colunas (
  id uuid primary key default gen_random_uuid(),
  quadro_id uuid not null,
  organizacao_id uuid not null,
  empresa_id uuid not null,
  nome text not null check (nome = btrim(nome) and length(nome) between 1 and 40),
  -- Fracionária: mover = 1 update com a média dos vizinhos, sem renumerar a lista.
  ordem double precision not null default 0,
  cor text not null default '#64748b' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  criado_em timestamptz not null default now(),
  unique (id, quadro_id, organizacao_id, empresa_id),
  foreign key (quadro_id, organizacao_id, empresa_id) references public.operacao_quadros(id, organizacao_id, empresa_id) on delete cascade
);
create index if not exists operacao_quadros_colunas_quadro_idx on public.operacao_quadros_colunas (quadro_id, ordem);

create table if not exists public.operacao_quadros_cartoes (
  id uuid primary key default gen_random_uuid(),
  quadro_id uuid not null,
  coluna_id uuid not null,
  organizacao_id uuid not null,
  empresa_id uuid not null,
  titulo text not null check (titulo = btrim(titulo) and length(titulo) between 1 and 200),
  descricao text check (descricao is null or length(descricao) <= 4000),
  processo_id uuid references public.operacao_processos(id) on delete set null,
  prazo date,
  ordem double precision not null default 0,
  criado_por uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Coluna com cartão não sai (NO ACTION: apagar o quadro inteiro ainda leva tudo pela cascata abaixo, no mesmo comando).
  foreign key (coluna_id, quadro_id, organizacao_id, empresa_id) references public.operacao_quadros_colunas(id, quadro_id, organizacao_id, empresa_id),
  foreign key (quadro_id, organizacao_id, empresa_id) references public.operacao_quadros(id, organizacao_id, empresa_id) on delete cascade
);
create index if not exists operacao_quadros_cartoes_coluna_idx on public.operacao_quadros_cartoes (coluna_id, ordem);
create index if not exists operacao_quadros_cartoes_quadro_idx on public.operacao_quadros_cartoes (quadro_id);
create index if not exists operacao_quadros_cartoes_processo_idx on public.operacao_quadros_cartoes (processo_id) where processo_id is not null;

-- Limites, dono imutável e coerência empresa/organização/processo. Definer: conta linhas que a RLS esconderia.
create or replace function public.operacao_quadros_proteger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limite int; v_total int; v_chave text;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.organizacao_id is distinct from old.organizacao_id
       or new.empresa_id is distinct from old.empresa_id or new.criado_em is distinct from old.criado_em
       or (tg_table_name <> 'operacao_quadros' and to_jsonb(new) ->> 'quadro_id' is distinct from to_jsonb(old) ->> 'quadro_id') then
      raise exception 'Quadro, empresa e organização não mudam' using errcode = 'P0001';
    end if;
  else
    if not exists (select 1 from public.operacao_empresas e where e.id = new.empresa_id and e.organizacao_id = new.organizacao_id) then
      raise exception 'Empresa fora da organização' using errcode = '23503';
    end if;
    if tg_table_name = 'operacao_quadros' then
      v_chave := 'operacao_quadros:' || new.empresa_id::text; v_limite := 30;
    else
      v_chave := tg_table_name || ':' || (to_jsonb(new) ->> 'quadro_id'); v_limite := case tg_table_name when 'operacao_quadros_colunas' then 20 else 500 end;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_chave));
    if tg_table_name = 'operacao_quadros' then
      select count(*) into v_total from public.operacao_quadros where empresa_id = new.empresa_id;
    elsif tg_table_name = 'operacao_quadros_colunas' then
      select count(*) into v_total from public.operacao_quadros_colunas where quadro_id = (to_jsonb(new) ->> 'quadro_id')::uuid;
    else
      select count(*) into v_total from public.operacao_quadros_cartoes where quadro_id = (to_jsonb(new) ->> 'quadro_id')::uuid;
    end if;
    if v_total >= v_limite then
      raise exception 'Limite de % atingido', v_limite using errcode = 'P0001';
    end if;
  end if;
  if tg_table_name = 'operacao_quadros_cartoes' then
    if new.processo_id is not null and not exists (select 1 from public.operacao_processos p
        where p.id = new.processo_id and p.empresa_id = new.empresa_id and p.organizacao_id = new.organizacao_id) then
      raise exception 'Processo de outra empresa' using errcode = '23503';
    end if;
    if tg_op = 'UPDATE' then new.atualizado_em := now(); end if;
  end if;
  return new;
end $$;
revoke all on function public.operacao_quadros_proteger() from public, anon, authenticated, service_role;

drop trigger if exists operacao_quadros_proteger on public.operacao_quadros;
create trigger operacao_quadros_proteger before insert or update on public.operacao_quadros
  for each row execute function public.operacao_quadros_proteger();
drop trigger if exists operacao_quadros_colunas_proteger on public.operacao_quadros_colunas;
create trigger operacao_quadros_colunas_proteger before insert or update on public.operacao_quadros_colunas
  for each row execute function public.operacao_quadros_proteger();
drop trigger if exists operacao_quadros_cartoes_proteger on public.operacao_quadros_cartoes;
create trigger operacao_quadros_cartoes_proteger before insert or update on public.operacao_quadros_cartoes
  for each row execute function public.operacao_quadros_proteger();

do $$
declare t text;
begin
  foreach t in array array['operacao_quadros', 'operacao_quadros_colunas', 'operacao_quadros_cartoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
    execute format('drop policy if exists %I on public.%I', t || '_escrita', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))', t || '_leitura', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id)) with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))', t || '_escrita', t);
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';


-- ========== planos_e_recursos.sql ==========
-- LicitaPlena: planos com regras automáticas (Grátis, Teste, Empresa, Assessoria, Dono), assinaturas,
-- pagamentos (preparado, sem integração) e funções do painel de administração.
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

-- Valores iniciais da proposta (pente-fino-cobranca-concorrentes-20261119.md, 4.1 e 4.2). "do nothing": o que o dono
-- editar depois não volta ao padrão quando este arquivo roda de novo.
insert into public.planos (codigo, nome, descricao, max_cnpjs, max_usuarios, max_processos, preco_mensal_centavos, preco_anual_centavos, dias_teste, escolhivel_no_cadastro, ordem) values
  ('gratis', 'Grátis', 'Busca e boletim de 1 CNPJ, 3 processos no CRM, sem proposta nem análise por CNPJ.', 1, 1, 3, 0, null, null, false, 1),
  ('teste', 'Teste grátis', '14 dias sem cartão. Vale o menor limite entre o plano escolhido e esta linha.', 3, 5, null, 0, null, 14, false, 2),
  ('empresa', 'Empresa', 'Para a empresa que licita: 1 CNPJ e 3 usuários.', 1, 3, null, 14900, 149000, null, true, 3),
  ('assessoria', 'Assessoria', 'Para assessorias e consultores: até 10 CNPJs e 5 usuários.', 10, 5, null, 29900, 299000, null, true, 4),
  ('dono', 'Dono (ilimitado)', 'Conta do proprietário do LicitaPlena.', null, null, null, null, null, null, false, 9)
on conflict (codigo) do nothing;
insert into public.recursos_plano (codigo, nome, funcoes) values
  ('ia', 'Inteligência artificial (resumo, busca e fornecedor com IA)', array['ia-edital', 'monte-busca-ia', 'fornecedor-ia']),
  ('analise_cnpj', 'Análise por CNPJ (concorrente)', array['analise-cnpj', 'analise-cnpj-buscar', 'analise-cnpj-cadastro']),
  ('proposta', 'Proposta e declarações', array['kit-documentos']),
  ('robo_lances', 'Extensão do Compras.gov e robô de lances', array['pregao-gravado', 'pregao-gravado-leitura', 'proposta-lote']),
  ('licitacao_anterior', 'Licitação anterior do órgão', array['licitacao-anterior', 'licitacao-anterior-orgaos'])
on conflict (codigo) do nothing;
insert into public.plano_recursos (plano, recurso, permitido, limite_diario) values
  ('gratis', 'ia', true, 3), ('gratis', 'analise_cnpj', false, null), ('gratis', 'proposta', false, null),
  ('gratis', 'robo_lances', false, null), ('gratis', 'licitacao_anterior', true, 2),
  ('teste', 'ia', true, 15), ('teste', 'analise_cnpj', true, 3), ('teste', 'proposta', true, null),
  ('teste', 'robo_lances', true, null), ('teste', 'licitacao_anterior', true, null),
  ('empresa', 'ia', true, null), ('empresa', 'analise_cnpj', true, null), ('empresa', 'proposta', true, null),
  ('empresa', 'robo_lances', true, null), ('empresa', 'licitacao_anterior', true, null),
  ('assessoria', 'ia', true, null), ('assessoria', 'analise_cnpj', true, null), ('assessoria', 'proposta', true, null),
  ('assessoria', 'robo_lances', true, null), ('assessoria', 'licitacao_anterior', true, null),
  ('dono', 'ia', true, null), ('dono', 'analise_cnpj', true, null), ('dono', 'proposta', true, null),
  ('dono', 'robo_lances', true, null), ('dono', 'licitacao_anterior', true, null)
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
  ciclo text check (ciclo in ('mensal', 'anual')),
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
create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.clientes(id) on delete set null,   -- registro fiscal fica mesmo se a conta sair
  cliente_email text,
  plano text references public.planos(codigo) on update cascade,
  ciclo text check (ciclo in ('mensal', 'anual')),
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
create index if not exists pagamentos_usuario_idx on public.pagamentos (usuario_id, criado_em desc);
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
  v_max_c integer; v_max_u integer; v_max_p integer; v_rec jsonb;
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
      -- Vencimento com 5 dias de tolerância; teste vencido, vencida, suspensa e cancelada caem para o Grátis.
      v_efetivo := case
        when a.situacao = 'ativa' and (a.vence_em is null or a.vence_em + 5 >= current_date) then a.plano
        when a.situacao = 'teste' and (a.teste_ate is null or a.teste_ate > now()) then a.plano
        else 'gratis' end;
      v_teste := a.situacao = 'teste' and v_efetivo = a.plano;
    end if;
  end if;
  select * into p from public.planos where codigo = v_efetivo;
  if not found then v_efetivo := 'gratis'; v_teste := false; select * into p from public.planos where codigo = 'gratis'; end if;
  v_max_c := p.max_cnpjs; v_max_u := p.max_usuarios; v_max_p := p.max_processos;
  if v_teste then
    -- least() ignora vazio (sem limite): vale o menor entre o plano escolhido e a linha Teste.
    select * into t from public.planos where codigo = 'teste';
    v_max_c := least(v_max_c, t.max_cnpjs); v_max_u := least(v_max_u, t.max_usuarios); v_max_p := least(v_max_p, t.max_processos);
  end if;
  if v_tem and v_efetivo = a.plano then
    v_max_c := coalesce(a.max_cnpjs, v_max_c); v_max_u := coalesce(a.max_usuarios, v_max_u); v_max_p := coalesce(a.max_processos, v_max_p);
  end if;
  select coalesce(jsonb_object_agg(r.codigo, jsonb_build_object(
      'nome', r.nome,
      'permitido', v_efetivo = 'dono' or (coalesce(pr.permitido, false) and (not v_teste or coalesce(tr.permitido, false))),
      'limite_diario', case when v_teste then least(pr.limite_diario, tr.limite_diario) else pr.limite_diario end)), '{}'::jsonb)
    into v_rec
    from public.recursos_plano r
    left join public.plano_recursos pr on pr.plano = v_efetivo and pr.recurso = r.codigo
    left join public.plano_recursos tr on tr.plano = 'teste' and tr.recurso = r.codigo;
  return jsonb_build_object('plano', v_efetivo, 'nome', p.nome, 'plano_contratado', v_contratado,
    'nome_contratado', (select nome from public.planos where codigo = v_contratado),
    'situacao', v_situacao, 'em_teste', v_teste, 'teste_ate', a.teste_ate, 'vence_em', a.vence_em,
    'plano_solicitado', a.plano_solicitado,
    'max_cnpjs', v_max_c, 'max_usuarios', v_max_u, 'max_processos', v_max_p, 'recursos', v_rec);
end $$;

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
  return v || jsonb_build_object('eh_titular', v_tit = v_usuario,
    'uso', jsonb_build_object(
      'cnpjs', (select count(*) from public.operacao_empresas where organizacao_id = v_org and ativo),
      'usuarios', (select count(distinct usuario_id) from public.operacao_membros where organizacao_id = v_org),
      'processos', (select count(*) from public.operacao_processos where organizacao_id = v_org and status <> 'arquivado'),
      'hoje', (select coalesce(jsonb_object_agg(r.codigo, (select coalesce(sum(u.contagem), 0) from public.uso_diario u
          where u.usuario_id = v_usuario and u.dia = current_date and u.funcao = any (r.funcoes))), '{}'::jsonb) from public.recursos_plano r)),
    'planos_disponiveis', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome, 'max_cnpjs', max_cnpjs,
        'preco_mensal_centavos', preco_mensal_centavos, 'preco_anual_centavos', preco_anual_centavos) order by ordem), '[]'::jsonb)
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
declare v jsonb; v_rec text; v_r jsonb; v_lim integer := p_limite_padrao; n integer;
begin
  if p_usuario_id is null or p_funcao is null then raise exception 'Parâmetros inválidos'; end if;
  v := public.plano_efetivo_titular(public.titular_do_usuario(p_usuario_id));
  select codigo into v_rec from public.recursos_plano where p_funcao = any (funcoes) order by codigo limit 1;
  if v_rec is not null then
    v_r := v -> 'recursos' -> v_rec;
    if not coalesce((v_r ->> 'permitido')::boolean, false) then
      return jsonb_build_object('permitido', false, 'motivo', 'plano', 'recurso', v_rec, 'nome_recurso', v_r ->> 'nome', 'plano', v ->> 'nome');
    end if;
    v_lim := coalesce((v_r ->> 'limite_diario')::integer, p_limite_padrao);
  end if;
  n := public.incrementar_uso(p_usuario_id, p_funcao);
  -- Limite do plano vale para o recurso inteiro (ex.: Grátis = 3 de IA/dia somando resumo, pergunta, fornecedor e chat),
  -- igual ao "hoje" de meu_plano. Sem limite no plano, cada rota segue com o próprio padrão.
  if v_rec is not null and (v_r ->> 'limite_diario') is not null then
    select coalesce(sum(u.contagem), 0)::integer into n from public.uso_diario u
      where u.usuario_id = p_usuario_id and u.dia = current_date and u.funcao = any (select unnest(r.funcoes) from public.recursos_plano r where r.codigo = v_rec);
  end if;
  return jsonb_build_object('permitido', v_lim is null or n <= v_lim, 'contagem', n, 'limite', v_lim, 'recurso', v_rec, 'plano', v ->> 'nome');
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
  v_plano := case
    when lower(coalesce(new.plano, '')) in ('gratis', 'empresa', 'assessoria') then lower(new.plano)
    when exists (select 1 from public.planos where codigo = v_pedido and ativo and escolhivel_no_cadastro) then v_pedido
    else 'assessoria' end; -- sem escolha: teste com até 3 CNPJs, como a cota antiga
  select dias_teste into v_dias from public.planos where codigo = 'teste';
  insert into public.assinaturas (usuario_id, plano, situacao, teste_ate, atualizado_por)
    values (new.id, v_plano, 'teste', case when new.status = 'aprovado' then now() + make_interval(days => coalesce(v_dias, 14)) end, 'cadastro')
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
  v_inicio := greatest(current_date, coalesce(case when a.situacao = 'ativa' then a.vence_em end, current_date));
  v_fim := (v_inicio + case g.ciclo when 'anual' then interval '1 year' else interval '1 month' end)::date;
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
      'uso_30d', (select coalesce(sum(u.contagem), 0) from public.uso_diario u where u.usuario_id = c.id and u.dia > current_date - 30)) as x
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
      'valor_centavos', 'max_cnpjs', 'max_usuarios', 'max_processos', 'observacoes')) > 0 then raise exception 'Campo não permitido'; end if;
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
  if not exists (select 1 from public.planos where codigo = n.plano) then raise exception 'Plano inexistente'; end if;
  if n.plano = 'dono' and not public.eh_owner_admin_operacao(p_usuario) then raise exception 'O plano Dono é só do proprietário'; end if;
  if n.plano = 'teste' then raise exception 'Teste é uma situação, não um plano: escolha o plano e a situação "teste"'; end if;
  if n.plano is distinct from a.plano then n.plano_solicitado := null; end if;
  update public.assinaturas set plano = n.plano, situacao = n.situacao, teste_ate = n.teste_ate, vence_em = n.vence_em, ciclo = n.ciclo,
    valor_centavos = n.valor_centavos, max_cnpjs = n.max_cnpjs, max_usuarios = n.max_usuarios, max_processos = n.max_processos,
    observacoes = n.observacoes, plano_solicitado = n.plano_solicitado, atualizado_em = now(), atualizado_por = public.admin_email_atual()
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
    ('nome', 'descricao', 'max_cnpjs', 'max_usuarios', 'max_processos', 'preco_mensal_centavos', 'preco_anual_centavos', 'dias_teste', 'escolhivel_no_cadastro', 'ativo')) > 0
    then raise exception 'Campo não permitido'; end if;
  update public.planos set
    nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
    descricao = case when p_dados ? 'descricao' then coalesce(p_dados ->> 'descricao', '') else descricao end,
    max_cnpjs = case when p_dados ? 'max_cnpjs' then (p_dados ->> 'max_cnpjs')::integer else max_cnpjs end,
    max_usuarios = case when p_dados ? 'max_usuarios' then (p_dados ->> 'max_usuarios')::integer else max_usuarios end,
    max_processos = case when p_dados ? 'max_processos' then (p_dados ->> 'max_processos')::integer else max_processos end,
    preco_mensal_centavos = case when p_dados ? 'preco_mensal_centavos' then (p_dados ->> 'preco_mensal_centavos')::integer else preco_mensal_centavos end,
    preco_anual_centavos = case when p_dados ? 'preco_anual_centavos' then (p_dados ->> 'preco_anual_centavos')::integer else preco_anual_centavos end,
    dias_teste = case when p_dados ? 'dias_teste' then (p_dados ->> 'dias_teste')::integer else dias_teste end,
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
      'recurso', coalesce((select r.codigo from public.recursos_plano r where u.funcao = any (r.funcoes) order by r.codigo limit 1), 'outros'),
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
    'ativas', (select count(*) from public.assinaturas a join public.clientes c on c.id = a.usuario_id where c.status = 'aprovado' and a.situacao = 'ativa' and (a.vence_em is null or a.vence_em + 5 >= current_date)),
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
        from public.assinaturas a join public.clientes c on c.id = a.usuario_id where a.situacao = 'ativa' and a.vence_em < current_date
      union all
      select jsonb_build_object('tipo', 'plano_solicitado', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', a.plano_solicitado_em, 'plano', a.plano_solicitado)
        from public.assinaturas a join public.clientes c on c.id = a.usuario_id where a.plano_solicitado is not null
      union all
      select jsonb_build_object('tipo', 'pendente', 'usuario_id', c.id, 'nome', coalesce(c.nome, c.email), 'quando', c.criado_em)
        from public.clientes c where c.status = 'pendente' and c.criado_em < now() - interval '24 hours'
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
    (select case v_ciclo when 'anual' then preco_anual_centavos else preco_mensal_centavos end from public.planos where codigo = v_plano));
  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor'; end if;
  insert into public.pagamentos (usuario_id, cliente_email, plano, ciclo, valor_centavos, metodo, vencimento, referencia, gateway, observacoes, criado_por)
    values (p_usuario, (select email from public.clientes where id = p_usuario), v_plano, v_ciclo, v_valor,
      coalesce(p_dados ->> 'metodo', 'pix'), coalesce((p_dados ->> 'vencimento')::date, current_date), p_dados ->> 'referencia', 'pix_manual',
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


-- ========== pecas_juridicas.sql ==========
-- ============================================================================
-- LicitaPlena — Banco de peças reais (Jurídico & Dúvidas): esclarecimentos, impugnações, intenções de recurso,
-- recursos e contrarrazões publicados no ComprasNet antigo (com a resposta/decisão do pregoeiro) e, da Lei 14.133,
-- os que os órgãos anexam às contratações no PNCP.
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única;
-- só cria objetos novos (não altera nem apaga dados de outras tabelas).
-- Escrita: só os robôs scripts/coletar_pecas_juridicas.js e scripts/coletar_pecas_pncp.js (service_role). Leitura: cliente aprovado (cliente_aprovado()),
-- pela aba "Banco de peças reais" do painel. anon não lê.
-- LGPD: o robô apaga CPF, e-mail, telefone, RG, OAB e nomes de pessoas antes de gravar; o CHECK abaixo recusa CPF
-- (mesma regra de netlify/functions/_cpf.js). Ficam empresa, CNPJ e órgão (dado público de pessoa jurídica).
-- ============================================================================
begin;

create table if not exists public.pecas_juridicas (
  id text primary key check (id ~ '^(cn|pncp)-[0-9A-Za-z-]{3,120}$'),
  tipo text not null check (tipo in ('esclarecimento', 'impugnacao', 'intencao_recurso', 'recurso', 'contrarrazao')),
  pregao text check (pregao is null or pregao ~ '^[0-9]{1,6}/[0-9]{4}$'),
  uasg text check (uasg is null or uasg ~ '^[0-9]{5,6}$'),
  orgao text check (orgao is null or length(orgao) <= 300),
  prgcod text check (prgcod is null or prgcod ~ '^[0-9]{3,12}$'),
  item integer check (item is null or item between 0 and 100000),
  data date,
  empresa_cnpj text check (empresa_cnpj is null or empresa_cnpj ~ '^[0-9]{14}$'),
  empresa_nome text check (empresa_nome is null or (length(empresa_nome) <= 300 and empresa_nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y')),
  texto text not null check (length(texto) between 1 and 60000 and texto !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'),
  resposta text check (resposta is null or (length(resposta) <= 60000 and resposta !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y')),
  -- Cabeçalho da decisão no portal ("NÃO PROCEDE", "PROCEDE"...), quando há.
  resultado text check (resultado is null or length(resultado) <= 200),
  lei text check (lei is null or lei in ('14133', '10520', '8666', '13303')),
  url text check (url is null or url ~ '^https://(www\.comprasnet\.gov\.br|pncp\.gov\.br)/'),
  -- Texto minúsculo e sem acento (peça + resposta + órgão + empresa), montado pelo robô para o ILIKE da busca.
  busca text not null default '' check (length(busca) <= 20000),
  coletado_em timestamptz not null default now()
);
-- shortcut: ILIKE por palavra em busca, filtrado por tipo e ordenado por data, com limite de 30 linhas na tela. Com
-- dezenas de milhares de peças e lentidão, criar extensão pg_trgm e índice gin (busca gin_trgm_ops).
-- Peças da Lei 14.133 anexadas no PNCP (scripts/coletar_pecas_pncp.js): id "pncp-..." e link para pncp.gov.br. Em banco
-- que já tinha a tabela, troca os dois CHECKs antigos (só ComprasNet) pelos novos.
alter table public.pecas_juridicas drop constraint if exists pecas_juridicas_id_check;
alter table public.pecas_juridicas add constraint pecas_juridicas_id_check check (id ~ '^(cn|pncp)-[0-9A-Za-z-]{3,120}$');
alter table public.pecas_juridicas drop constraint if exists pecas_juridicas_url_check;
alter table public.pecas_juridicas add constraint pecas_juridicas_url_check check (url is null or url ~ '^https://(www\.comprasnet\.gov\.br|pncp\.gov\.br)/');
create index if not exists pecas_juridicas_tipo_data_idx on public.pecas_juridicas (tipo, data desc);

alter table public.pecas_juridicas enable row level security;
revoke all on public.pecas_juridicas from anon, authenticated;
grant select on public.pecas_juridicas to authenticated;
revoke truncate on public.pecas_juridicas from service_role;
grant select, insert, update, delete on public.pecas_juridicas to service_role;

-- Mesmo corpo de prospeccao.sql, historico_licitacoes.sql e sinapi.sql: este arquivo roda sozinho.
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

drop policy if exists pecas_juridicas_select_aprovado on public.pecas_juridicas;
create policy pecas_juridicas_select_aprovado on public.pecas_juridicas
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (bypassrls) grava.

commit;


-- ========== avisos_celular.sql ==========
-- LicitaPlena — Aviso no celular (Web Push). Seguro rodar mais de uma vez (idempotente). Rodar no SQL Editor do Supabase.
--
-- avisos_celular_inscricoes: um aparelho/navegador inscrito por linha (endpoint do serviço de push + chaves públicas
--   do aparelho). Grava só pela rota /api/avisos-celular (chave de serviço, endpoint validado contra a lista de
--   serviços de push conhecidos); o próprio usuário lê e apaga as suas. Ninguém lê a de outro.
-- avisos_celular_preferencias: que tipos de aviso a conta quer (sem linha = todos ligados). Grava pela rota.
-- avisos_celular_enviados: o que o robô (scripts/avisos_celular.js) já mandou para quem. A chave primária é a
--   reserva: duas rodadas ao mesmo tempo não mandam o mesmo aviso duas vezes. Só a chave de serviço acessa.

create table if not exists public.avisos_celular_inscricoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,88}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22,24}$'),
  aparelho text check (length(aparelho) <= 120),
  criado_em timestamptz not null default now()
);
create index if not exists avisos_celular_inscricoes_usuario_idx on public.avisos_celular_inscricoes (usuario_id);
alter table public.avisos_celular_inscricoes enable row level security;
drop policy if exists avisos_celular_inscricoes_select_proprio on public.avisos_celular_inscricoes;
create policy avisos_celular_inscricoes_select_proprio on public.avisos_celular_inscricoes for select to authenticated using (auth.uid() = usuario_id);
drop policy if exists avisos_celular_inscricoes_delete_proprio on public.avisos_celular_inscricoes;
create policy avisos_celular_inscricoes_delete_proprio on public.avisos_celular_inscricoes for delete to authenticated using (auth.uid() = usuario_id);
revoke insert, update on public.avisos_celular_inscricoes from anon, authenticated;

create table if not exists public.avisos_celular_preferencias (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  edital boolean not null default true,
  prazo boolean not null default true,
  pregoeiro boolean not null default true,
  certidao boolean not null default true,
  atualizado_em timestamptz not null default now()
);
-- Oportunidade nova do boletim (scripts/avisos_celular.js lê logs_boletim). Banco que já tinha a tabela ganha a coluna.
alter table public.avisos_celular_preferencias add column if not exists boletim boolean not null default true;
alter table public.avisos_celular_preferencias enable row level security;
drop policy if exists avisos_celular_preferencias_select_proprio on public.avisos_celular_preferencias;
create policy avisos_celular_preferencias_select_proprio on public.avisos_celular_preferencias for select to authenticated using (auth.uid() = usuario_id);
revoke insert, update, delete on public.avisos_celular_preferencias from anon, authenticated;

create table if not exists public.avisos_celular_enviados (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  chave text not null check (length(chave) <= 200),
  enviado_em timestamptz not null default now(),
  primary key (usuario_id, chave)
);
create index if not exists avisos_celular_enviados_data_idx on public.avisos_celular_enviados (enviado_em);
alter table public.avisos_celular_enviados enable row level security;
-- Sem policy: anon/authenticated não leem nem gravam; só service_role (que ignora RLS).
revoke all on public.avisos_celular_enviados from anon, authenticated;


-- ========== ia_conversas.sql ==========
-- LicitaPlena — Histórico do chat com IA (botão "IA · BETA", netlify/functions/chat-ia.js). Seguro rodar mais de uma vez
-- (idempotente). Rodar no SQL Editor do Supabase DEPOIS de seguranca_aprovacao_20261119.sql e planos_e_recursos.sql.
-- Teste: testar_ia_conversas.sql.
--
-- ia_conversas: uma linha por pergunta/resposta, só quando o usuário liga "Salvar histórico" no chat (padrão: desligado).
--   A rota grava com o TOKEN DO USUÁRIO (sem chave de serviço): a policy de insert exige dono = auth.uid() e, se houver
--   empresa, que ele tenha acesso a ela. Cada um lê e apaga só o seu; ninguém edita. CPF é recusado pelo CHECK (a rota
--   já troca CPF por ***.***.***-** antes de gravar; mesma regra de _cpf.js).
-- Também inclui a função "chat-ia" no recurso "ia" do plano (mesma cota diária por plano das outras ferramentas de IA).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
  if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null then
    raise exception 'Aplique antes seguranca_aprovacao_20261119.sql';
  end if;
end $$;

create table if not exists public.ia_conversas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversa_id uuid not null,
  empresa_id uuid references public.operacao_empresas(id) on delete set null,
  pergunta text not null check (length(pergunta) between 1 and 1000),
  resposta text not null check (length(resposta) between 1 and 4000),
  fontes jsonb not null default '[]'::jsonb check (jsonb_typeof(fontes) = 'array' and octet_length(fontes::text) <= 6000),
  criado_em timestamptz not null default now()
);
alter table public.ia_conversas drop constraint if exists ia_conversas_sem_cpf;
alter table public.ia_conversas add constraint ia_conversas_sem_cpf check (
  pergunta !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y' and resposta !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
create index if not exists ia_conversas_usuario_data_idx on public.ia_conversas (usuario_id, criado_em desc);
create index if not exists ia_conversas_empresa_idx on public.ia_conversas (empresa_id) where empresa_id is not null;

alter table public.ia_conversas enable row level security;
revoke all on public.ia_conversas from anon;
revoke update on public.ia_conversas from authenticated;
grant select, insert, delete on public.ia_conversas to authenticated;
drop policy if exists ia_conversas_select_proprio on public.ia_conversas;
create policy ia_conversas_select_proprio on public.ia_conversas for select to authenticated using (auth.uid() = usuario_id);
drop policy if exists ia_conversas_insert_proprio on public.ia_conversas;
create policy ia_conversas_insert_proprio on public.ia_conversas for insert to authenticated with check (
  auth.uid() = usuario_id and (empresa_id is null or exists (
    select 1 from public.operacao_empresas e where e.id = empresa_id and public.pode_acessar_empresa_operacao(e.organizacao_id, e.id))));
drop policy if exists ia_conversas_delete_proprio on public.ia_conversas;
create policy ia_conversas_delete_proprio on public.ia_conversas for delete to authenticated using (auth.uid() = usuario_id);

-- Cota pelo plano: "chat-ia" entra no recurso "ia" (sem a tabela de planos, a rota usa o contador antigo).
do $$ begin
  if to_regclass('public.recursos_plano') is not null then
    update public.recursos_plano set funcoes = array_append(funcoes, 'chat-ia') where codigo = 'ia' and not ('chat-ia' = any (funcoes));
  end if;
end $$;
commit;


-- ========== pagometro.sql ==========
-- ============================================================================
-- LicitaPlena — Pagômetro (BETA): "este ente costuma pagar em dia?".
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única;
-- só cria objetos novos (não altera nem apaga dados de outras tabelas).
-- Escrita: só a função /api/pagometro (netlify/functions/pagometro.js, service_role), cache por ente.
-- Leitura: cliente aprovado (cliente_aprovado()). anon não lê.
--
-- Dado público: o RREO Anexo 7 (Restos a Pagar) que o próprio município/estado declara ao Tesouro (SICONFI).
-- Uma linha por ente; a função refaz a coleta quando a linha tem mais de 15 dias. Sem dado pessoal.
-- Metodologia: _historico/pagometro-metodologia-20261120.md. Teste: supabase/testar_pagometro.sql.
-- ============================================================================
begin;

create table if not exists public.pagometro_entes (
  -- Código IBGE: 7 dígitos = município, 2 dígitos = estado ou DF.
  id_ente text primary key check (id_ente ~ '^([0-9]{2}|[0-9]{7})$'),
  esfera text not null check (esfera in ('M', 'E')),
  nome text check (nome is null or length(nome) <= 300),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  exercicio integer check (exercicio is null or exercicio between 2015 and 2100),
  semaforo text not null check (semaforo in ('verde', 'amarelo', 'vermelho', 'sem_dados')),
  -- devido, pago, cancelado, antigos (R$) e as taxas taxaPago, taxaCancelado, taxaAntigo (0 a 1).
  indicadores jsonb not null default '{}' check (jsonb_typeof(indicadores) = 'object'),
  fonte text not null check (fonte like 'https://apidatalake.tesouro.gov.br/%' and length(fonte) <= 500),
  coletado_em timestamptz not null default now(),
  check ((esfera = 'M') = (length(id_ente) = 7)),
  check (semaforo = 'sem_dados' or exercicio is not null)
);

alter table public.pagometro_entes enable row level security;
revoke all on public.pagometro_entes from anon, authenticated;
grant select on public.pagometro_entes to authenticated;
revoke delete, truncate on public.pagometro_entes from service_role;
grant select, insert, update on public.pagometro_entes to service_role;

-- Mesmo corpo de sinapi.sql, prospeccao.sql e historico_licitacoes.sql: este arquivo roda sozinho.
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

drop policy if exists pagometro_entes_select_aprovado on public.pagometro_entes;
create policy pagometro_entes_select_aprovado on public.pagometro_entes
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (bypassrls) grava. Sem delete: a linha é sobrescrita pelo upsert.

-- Prazo médio de pagamento em dias (24 e 36 meses): fila que a função abre e o robô
-- scripts/coletar_pagometro_prazos.js completa. chave "F:<UG>" (federal, Portal da Transparência) ou
-- "M:<IBGE>" (município de SP, TCE-SP). Dias nulos = amostra pequena ou sem dado; nunca estimado.
create table if not exists public.pagometro_prazos (
  chave text primary key check (chave ~ '^(F:[0-9]{6}|M:[0-9]{7})$'),
  fonte text not null check (fonte in ('transparencia', 'tce-sp')),
  situacao text not null check (situacao in ('pendente', 'pronto', 'falhou')),
  nome text check (nome is null or length(nome) <= 300),
  dias_24m integer check (dias_24m is null or dias_24m between 0 and 3650),
  amostra_24m integer not null default 0 check (amostra_24m >= 0),
  dias_36m integer check (dias_36m is null or dias_36m between 0 and 3650),
  amostra_36m integer not null default 0 check (amostra_36m >= 0),
  erro text check (erro is null or length(erro) <= 300),
  pedido_em timestamptz not null default now(),
  coletado_em timestamptz
);
create index if not exists pagometro_prazos_fila_idx on public.pagometro_prazos (pedido_em) where situacao = 'pendente';

alter table public.pagometro_prazos enable row level security;
revoke all on public.pagometro_prazos from anon, authenticated;
grant select on public.pagometro_prazos to authenticated;
revoke delete, truncate on public.pagometro_prazos from service_role;
grant select, insert, update on public.pagometro_prazos to service_role;

drop policy if exists pagometro_prazos_select_aprovado on public.pagometro_prazos;
create policy pagometro_prazos_select_aprovado on public.pagometro_prazos
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (função e robô) grava.

commit;


-- ========== funil_v3.sql ==========
-- Funil v3 (mapa do Siga Pregão, lista "FALTA" itens 1, 5, 6 e 9). Idempotente, transação única; não apaga dados.
-- Rodar no SQL Editor DEPOIS de operacao_acompanhamento.sql, operacao_funil_checklist.sql, operacao_monitor_edital.sql,
-- boletim_por_empresa.sql e seguranca_aprovacao_20261119.sql. Teste: testar_funil_v3.sql.
--  1. Tarefas avançadas no card: operacao_processos.tarefas_card = {secoes:[{id,nome,tarefas:[...]}], datas:{ata,aviso_recurso}}.
--     Cada tarefa: id, titulo, quando (data e hora, vai para a agenda), responsavel, exige (documento|resposta),
--     auto (prazo da Lei 14.133 calculado no navegador a partir das datas do processo), feita_em, resposta, anexo_id.
--     Nulo = modelo padrão (mesma convenção do checklist). A tarefa que exige prova só fecha com ela: o CHECK confere a
--     resposta escrita e o gatilho confere que o anexo existe em operacao_anexos_processo do MESMO processo.
--     Modelos de tarefas da empresa: operacao_funil_modelos_tarefas; o escolhido em operacao_funil_preferencias vale
--     para toda licitação que entra no Funil (gatilho de INSERT).
--  5. Prospecta: prospecta_sugerir() (só service_role, chamado por scripts/boletim_editais.py) põe no Funil as melhores do
--     boletim, sem duplicar (índice único da origem), com o limite diário e a nota mínima que a empresa ligou.
--  6. Metas e nicho por empresa: operacao_funil_preferencias.meta / nichos / oportunidades_dia.
--  9. Monitor por item: operacao_processos.monitor_itens (até 10). A citação do CNPJ no chat é feita pelo robô
--     scripts/monitor_processos.js com o CNPJ que a empresa já tem cadastrado: nada pessoal novo é guardado.
-- Nunca guarda CPF: resposta, título e responsável recusam número no formato de CPF (mesma regra do chat gravado).
begin;
set local lock_timeout = '5s';
do $$ begin
 if to_regclass('public.operacao_anexos_processo') is null or to_regclass('public.operacao_monitor_processos') is null
  or to_regclass('public.boletim_filtros_empresa') is null
  or to_regprocedure('public.pode_escrever_empresa_operacao(uuid,uuid)') is null then
  raise exception 'Aplique antes operacao_acompanhamento.sql, operacao_monitor_edital.sql, boletim_por_empresa.sql e seguranca_aprovacao_20261119.sql';
 end if;
end $$;

-- ---------- 1. Tarefas do card ----------
create or replace function public.funil_secoes_validas(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare s jsonb; t jsonb; n int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 12 or octet_length(p::text) > 60000 then return false; end if;
  for s in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(s) <> 'object' or coalesce(s->>'id', '') !~ '^[a-z0-9-]{1,40}$'
      or length(btrim(coalesce(s->>'nome', ''))) not between 1 and 80 or jsonb_typeof(s->'tarefas') is distinct from 'array' then
      return false;
    end if;
    for t in select value from jsonb_array_elements(s->'tarefas') loop
      n := n + 1;
      if n > 60 or jsonb_typeof(t) <> 'object' or coalesce(t->>'id', '') !~ '^[a-z0-9-]{1,40}$'
        or length(btrim(coalesce(t->>'titulo', ''))) not between 1 and 160
        or coalesce(t->>'exige', 'nada') not in ('nada', 'documento', 'resposta')
        or coalesce(t->>'auto', 'nada') not in ('nada', 'esclarecimento', 'impugnacao', 'disputa', 'recurso', 'contrarrazao')
        or (t ? 'quando' and coalesce(t->>'quando', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$')
        or (t ? 'feita_em' and coalesce(t->>'feita_em', '') !~ '^\d{4}-\d{2}-\d{2}T')
        or (t ? 'anexo_id' and coalesce(t->>'anexo_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        or length(coalesce(t->>'responsavel', '')) > 80 or length(coalesce(t->>'resposta', '')) > 2000
        or concat_ws(' ', t->>'titulo', t->>'responsavel', t->>'resposta') ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'
        -- Pergunta só fecha com resposta escrita.
        or (t->>'exige' = 'resposta' and t ? 'feita_em' and length(btrim(coalesce(t->>'resposta', ''))) = 0)
      then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create or replace function public.funil_tarefas_card_valido(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or (jsonb_typeof(p) = 'object' and (p - array['secoes', 'datas']) = '{}'::jsonb
    and public.funil_secoes_validas(coalesce(p->'secoes', '[]'::jsonb))
    and (not p ? 'datas' or (jsonb_typeof(p->'datas') = 'object' and ((p->'datas') - array['ata', 'aviso_recurso']) = '{}'::jsonb
      and coalesce(p->'datas'->>'ata', '2000-01-01') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(p->'datas'->>'aviso_recurso', '2000-01-01') ~ '^\d{4}-\d{2}-\d{2}$')))
$$;

alter table public.operacao_processos add column if not exists tarefas_card jsonb;
alter table public.operacao_processos drop constraint if exists operacao_processos_tarefas_card_valido;
alter table public.operacao_processos add constraint operacao_processos_tarefas_card_valido check (public.funil_tarefas_card_valido(tarefas_card));

-- 9. Itens que o monitor acompanha (aviso só desses itens quando a lista não está vazia).
alter table public.operacao_processos add column if not exists monitor_itens integer[] not null default '{}';
alter table public.operacao_processos drop constraint if exists operacao_processos_monitor_itens_validos;
alter table public.operacao_processos add constraint operacao_processos_monitor_itens_validos
  check (cardinality(monitor_itens) <= 10 and 0 < all(monitor_itens) and 100000 > all(monitor_itens));

-- 5. Sugestão do Prospecta: nota (selo "Sugerida") e quando entrou (limite diário). Aceitar = nota nula; dispensar = arquivar.
alter table public.operacao_processos add column if not exists sugerida_nota smallint;
alter table public.operacao_processos add column if not exists sugerida_em timestamptz;
alter table public.operacao_processos drop constraint if exists operacao_processos_sugerida_nota_valida;
alter table public.operacao_processos add constraint operacao_processos_sugerida_nota_valida check (sugerida_nota between 0 and 100);

-- Modelos de tarefas da empresa (sem marcação, resposta nem anexo: só a estrutura).
create table if not exists public.operacao_funil_modelos_tarefas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null references public.operacao_empresas(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 60),
  secoes jsonb not null,
  criado_em timestamptz not null default now()
);
alter table public.operacao_funil_modelos_tarefas drop constraint if exists operacao_funil_modelos_tarefas_secoes_validas;
alter table public.operacao_funil_modelos_tarefas add constraint operacao_funil_modelos_tarefas_secoes_validas check (
  public.funil_secoes_validas(secoes)
  and not jsonb_path_exists(secoes, '$[*].tarefas[*] ? (exists(@.feita_em) || exists(@.resposta) || exists(@.anexo_id))'));
create unique index if not exists operacao_funil_modelos_tarefas_nome_idx on public.operacao_funil_modelos_tarefas (empresa_id, lower(btrim(nome)));

-- ---------- 5 e 6. Preferências da empresa: modelo ao adicionar, Prospecta, meta e nichos ----------
create table if not exists public.operacao_funil_preferencias (
  empresa_id uuid primary key references public.operacao_empresas(id) on delete cascade,
  organizacao_id uuid not null,
  modelo_tarefas text not null default 'padrao'
    check (modelo_tarefas in ('padrao', 'nenhum') or modelo_tarefas ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  prospecta_ativo boolean not null default false,
  prospecta_limite smallint not null default 3 check (prospecta_limite between 1 and 10),
  prospecta_nota_minima smallint not null default 60 check (prospecta_nota_minima between 0 and 100),
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 4000),
  nichos jsonb not null default '[]'::jsonb check (jsonb_typeof(nichos) = 'array' and jsonb_array_length(nichos) <= 20 and octet_length(nichos::text) <= 16000),
  oportunidades_dia smallint not null default 10 check (oportunidades_dia between 0 and 200),
  atualizado_em timestamptz not null default now()
);

-- Organização + empresa coerentes (a policy confere o par).
create or replace function public.funil_empresa_coerente() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.operacao_empresas e where e.id = new.empresa_id and e.organizacao_id = new.organizacao_id) then
    raise exception 'Empresa não pertence à organização.' using errcode = 'check_violation';
  end if;
  if tg_table_name = 'operacao_funil_preferencias' then new.atualizado_em := now(); end if;
  return new;
end $$;
drop trigger if exists operacao_funil_preferencias_coerente on public.operacao_funil_preferencias;
create trigger operacao_funil_preferencias_coerente before insert or update on public.operacao_funil_preferencias
  for each row execute function public.funil_empresa_coerente();
drop trigger if exists operacao_funil_modelos_tarefas_coerente on public.operacao_funil_modelos_tarefas;
create trigger operacao_funil_modelos_tarefas_coerente before insert or update on public.operacao_funil_modelos_tarefas
  for each row execute function public.funil_empresa_coerente();

-- Licitação nova no Funil recebe o modelo escolhido pela empresa ("nenhum" = lista vazia; "padrao" = nulo).
create or replace function public.funil_aplicar_modelo_tarefas() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_pref text; v_secoes jsonb;
begin
  if new.tarefas_card is not null then return new; end if;
  select f.modelo_tarefas into v_pref from public.operacao_funil_preferencias f
    where f.empresa_id = new.empresa_id and f.organizacao_id = new.organizacao_id;
  if v_pref = 'nenhum' then
    new.tarefas_card := '{"secoes": []}'::jsonb;
  elsif v_pref ~ '^[0-9a-f-]{36}$' then
    select m.secoes into v_secoes from public.operacao_funil_modelos_tarefas m where m.id = v_pref::uuid and m.empresa_id = new.empresa_id;
    if v_secoes is not null then new.tarefas_card := jsonb_build_object('secoes', v_secoes); end if;
  end if;
  return new;
end $$;
-- Tarefa que exige documento só fecha com anexo do mesmo processo (o anexo passa pela RLS de operacao_anexos_processo).
create or replace function public.funil_tarefas_card_prova() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t jsonb;
begin
  if new.tarefas_card is null then return new; end if;
  for t in select x.value from jsonb_array_elements(coalesce(new.tarefas_card->'secoes', '[]'::jsonb)) s,
      jsonb_array_elements(s.value->'tarefas') x loop
    if t->>'exige' = 'documento' and t ? 'feita_em' and not exists (select 1 from public.operacao_anexos_processo a
        where a.id = (t->>'anexo_id')::uuid and a.processo_id = new.id and a.organizacao_id = new.organizacao_id) then
      raise exception 'A tarefa "%" só fecha com o documento anexado.', left(t->>'titulo', 80) using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end $$;
-- Gatilhos BEFORE rodam em ordem alfabética: primeiro o modelo, depois a prova.
drop trigger if exists funil_a_modelo_tarefas on public.operacao_processos;
create trigger funil_a_modelo_tarefas before insert on public.operacao_processos
  for each row execute function public.funil_aplicar_modelo_tarefas();
drop trigger if exists funil_b_prova_tarefas on public.operacao_processos;
create trigger funil_b_prova_tarefas before insert or update of tarefas_card on public.operacao_processos
  for each row execute function public.funil_tarefas_card_prova();

alter table public.operacao_funil_preferencias enable row level security;
alter table public.operacao_funil_modelos_tarefas enable row level security;
revoke all on public.operacao_funil_preferencias, public.operacao_funil_modelos_tarefas from public, anon, authenticated;
grant select, insert, update, delete on public.operacao_funil_preferencias, public.operacao_funil_modelos_tarefas to authenticated;
grant all on public.operacao_funil_preferencias, public.operacao_funil_modelos_tarefas to service_role;
drop policy if exists operacao_funil_preferencias_leitura on public.operacao_funil_preferencias;
create policy operacao_funil_preferencias_leitura on public.operacao_funil_preferencias for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_preferencias_escrita on public.operacao_funil_preferencias;
create policy operacao_funil_preferencias_escrita on public.operacao_funil_preferencias for insert to authenticated
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_preferencias_alteracao on public.operacao_funil_preferencias;
create policy operacao_funil_preferencias_alteracao on public.operacao_funil_preferencias for update to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_preferencias_exclusao on public.operacao_funil_preferencias;
create policy operacao_funil_preferencias_exclusao on public.operacao_funil_preferencias for delete to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_modelos_tarefas_leitura on public.operacao_funil_modelos_tarefas;
create policy operacao_funil_modelos_tarefas_leitura on public.operacao_funil_modelos_tarefas for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_modelos_tarefas_escrita on public.operacao_funil_modelos_tarefas;
create policy operacao_funil_modelos_tarefas_escrita on public.operacao_funil_modelos_tarefas for insert to authenticated
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_modelos_tarefas_alteracao on public.operacao_funil_modelos_tarefas;
create policy operacao_funil_modelos_tarefas_alteracao on public.operacao_funil_modelos_tarefas for update to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_funil_modelos_tarefas_exclusao on public.operacao_funil_modelos_tarefas;
create policy operacao_funil_modelos_tarefas_exclusao on public.operacao_funil_modelos_tarefas for delete to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));

-- ---------- 5. Prospecta: o robô do boletim põe as melhores no Funil ----------
-- p_itens: [{numero_controle, objeto, orgao, modalidade, link, valor, publicacao (AAAA-MM-DD),
--            encerramento (AAAA-MM-DDTHH:MM:SS, Brasília), nota}] já ordenados da melhor para a pior.
-- Só entra quem tem nota >= mínima, até o limite do dia, na primeira etapa (triagem), sem duplicar. Devolve quantas entraram.
create or replace function public.prospecta_sugerir(p_empresa uuid, p_itens jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  f public.operacao_funil_preferencias; it jsonb; v_id uuid; v_ja int; n int := 0; v_nota int; v_dono uuid;
  v_hoje timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 200 then raise exception 'Lista inválida'; end if;
  select * into f from public.operacao_funil_preferencias where empresa_id = p_empresa;
  if f.empresa_id is null or not f.prospecta_ativo then return 0; end if;
  if not exists (select 1 from public.operacao_empresas e where e.id = p_empresa and e.organizacao_id = f.organizacao_id and e.ativo) then return 0; end if;
  select b.cliente_id into v_dono from public.boletim_filtros_empresa b where b.empresa_id = p_empresa;
  select count(*) into v_ja from public.operacao_processos p where p.empresa_id = p_empresa and p.sugerida_em >= v_hoje;
  for it in select value from jsonb_array_elements(p_itens) loop
    exit when v_ja + n >= f.prospecta_limite;
    v_nota := case when coalesce(it->>'nota', '') ~ '^\d{1,3}$' then (it->>'nota')::int end;
    continue when v_nota is null or v_nota > 100 or v_nota < f.prospecta_nota_minima
      or coalesce(it->>'numero_controle', '') !~ '^\d{14}-\d-\d{6}/\d{4}$';
    v_id := null;
    insert into public.operacao_processos (organizacao_id, empresa_id, origem_externa_id, objeto, orgao, modalidade, url_origem,
      valor_estimado, data_publicacao, status, criado_por, sugerida_nota, sugerida_em)
    values (f.organizacao_id, p_empresa, it->>'numero_controle',
      left(coalesce(nullif(btrim(it->>'objeto'), ''), 'Licitação sugerida pelo Prospecta'), 1000),
      left(nullif(btrim(it->>'orgao'), ''), 300), left(nullif(btrim(it->>'modalidade'), ''), 120),
      case when it->>'link' ~ '^https://\S+$' and length(it->>'link') <= 500 then it->>'link' end,
      case when coalesce(it->>'valor', '') ~ '^\d{1,13}(\.\d{1,2})?$' then (it->>'valor')::numeric end,
      case when coalesce(it->>'publicacao', '') ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'publicacao')::date end,
      'triagem', v_dono, v_nota, now())
    on conflict (organizacao_id, empresa_id, origem_externa_id) where origem_externa_id is not null do nothing
    returning id into v_id;
    continue when v_id is null;
    n := n + 1;
    if coalesce(it->>'encerramento', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$' then
      insert into public.operacao_prazos_processo (organizacao_id, processo_id, categoria, titulo, vencimento)
      values (f.organizacao_id, v_id, 'proposta', 'Prazo de propostas (Boletim)', (left(it->>'encerramento', 16) || ':00-03')::timestamptz);
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.prospecta_sugerir(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.prospecta_sugerir(uuid, jsonb) to service_role;
revoke all on function public.funil_aplicar_modelo_tarefas(), public.funil_tarefas_card_prova(), public.funil_empresa_coerente() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;


-- ========== documentos_pastas.sql ==========
-- LicitaPlena — Pastas dos documentos da empresa e documentos escolhidos no processo (card do funil/processo).
-- Seguro rodar mais de uma vez (idempotente). Rodar no SQL Editor do Supabase, DEPOIS de seguranca_aprovacao_20261119.sql.
--
-- operacao_documento_pastas: em que pasta (texto livre, ex.: "Habilitação jurídica", "Fiscal") fica cada documento de
--   operacao_documentos. Tabela à parte de propósito: mudar a pasta NÃO é "alterar o documento" (um update em
--   operacao_documentos dispara invalidar_identificacao_empresa e derrubaria a identificação confirmada).
-- operacao_processo_documentos: documentos já salvos que a pessoa escolheu para um processo (sem novo upload).
-- Nas duas, organização e empresa vêm do próprio documento (trigger); o processo precisa ser da mesma empresa.
-- RLS: mesma regra dos documentos (pode_acessar_empresa_operacao). anon não lê nem grava.
-- Teste: testar_documentos_pastas.sql.
begin;
do $$ begin
  if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null then
    raise exception 'Aplique antes seguranca_aprovacao_20261119.sql';
  end if;
end $$;

create table if not exists public.operacao_documento_pastas (
  documento_id uuid primary key references public.operacao_documentos(id) on delete cascade,
  organizacao_id uuid not null,
  empresa_id uuid not null,
  pasta text not null check (length(btrim(pasta)) between 1 and 60 and pasta !~ '[/\\<>]'),
  atualizado_em timestamptz not null default now()
);
create index if not exists operacao_documento_pastas_empresa_idx on public.operacao_documento_pastas (empresa_id);

create table if not exists public.operacao_processo_documentos (
  processo_id uuid not null references public.operacao_processos(id) on delete cascade,
  documento_id uuid not null references public.operacao_documentos(id) on delete cascade,
  organizacao_id uuid not null,
  empresa_id uuid not null,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  primary key (processo_id, documento_id)
);
create index if not exists operacao_processo_documentos_documento_idx on public.operacao_processo_documentos (documento_id);

-- security invoker: o documento é lido com a RLS de quem grava; documento que a pessoa não vê não entra.
create or replace function public.operacao_documento_vinculo_coerente() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_org uuid; v_emp uuid;
begin
  select d.organizacao_id, d.empresa_id into v_org, v_emp from public.operacao_documentos d where d.id = new.documento_id;
  if v_org is null then raise exception 'Documento indisponível.' using errcode = 'check_violation'; end if;
  new.organizacao_id := v_org;
  new.empresa_id := v_emp;
  if TG_TABLE_NAME = 'operacao_processo_documentos' then
    if not exists (select 1 from public.operacao_processos p where p.id = new.processo_id and p.empresa_id = v_emp and p.organizacao_id = v_org) then
      raise exception 'O documento é de outra empresa, não deste processo.' using errcode = 'check_violation';
    end if;
  else
    new.pasta := btrim(new.pasta);
    new.atualizado_em := now();
  end if;
  return new;
end $$;
revoke all on function public.operacao_documento_vinculo_coerente() from public, anon;

drop trigger if exists operacao_documento_pastas_coerente on public.operacao_documento_pastas;
create trigger operacao_documento_pastas_coerente before insert or update on public.operacao_documento_pastas
  for each row execute function public.operacao_documento_vinculo_coerente();
drop trigger if exists operacao_processo_documentos_coerente on public.operacao_processo_documentos;
create trigger operacao_processo_documentos_coerente before insert or update on public.operacao_processo_documentos
  for each row execute function public.operacao_documento_vinculo_coerente();

alter table public.operacao_documento_pastas enable row level security;
alter table public.operacao_processo_documentos enable row level security;
revoke all on public.operacao_documento_pastas, public.operacao_processo_documentos from anon;
grant select, insert, update, delete on public.operacao_documento_pastas, public.operacao_processo_documentos to authenticated;

drop policy if exists operacao_documento_pastas_da_empresa on public.operacao_documento_pastas;
create policy operacao_documento_pastas_da_empresa on public.operacao_documento_pastas
  for all to authenticated using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
drop policy if exists operacao_processo_documentos_da_empresa on public.operacao_processo_documentos;
create policy operacao_processo_documentos_da_empresa on public.operacao_processo_documentos
  for all to authenticated using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));

commit;

