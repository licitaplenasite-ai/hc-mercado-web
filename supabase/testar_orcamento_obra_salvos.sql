-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Banco local/clone com operacao_licitacoes.sql, seguranca_operacao.sql,
-- seguranca_aprovacao_20261119.sql e orcamento_obra_salvos.sql aplicados. Fixtures sintéticas e rollback no fim.
-- RLS simulada com "set local role authenticated" + request.jwt.claim.sub; não prova a API HTTP (o e2e-orcamento-obra.cjs prova).
-- Gestor A (org inteira) f5..01, operador restrito à empresa A1 f5..02, leitura f5..04, gestor B (outra org) f5..03.
begin;
insert into auth.users(id,email) values
 ('f5000000-0000-4000-8000-000000000001','orc-a@qa.invalid'),('f5000000-0000-4000-8000-000000000002','orc-r@qa.invalid'),
 ('f5000000-0000-4000-8000-000000000003','orc-b@qa.invalid'),('f5000000-0000-4000-8000-000000000004','orc-l@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f5000000-0000-4000-8000-000000000001','QA orc A','orc-a@qa.invalid','aprovado'),
 ('f5000000-0000-4000-8000-000000000002','QA orc R','orc-r@qa.invalid','aprovado'),
 ('f5000000-0000-4000-8000-000000000003','QA orc B','orc-b@qa.invalid','aprovado'),
 ('f5000000-0000-4000-8000-000000000004','QA orc L','orc-l@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f5000000-0000-4000-8000-00000000000a','QA orc A','f5000000-0000-4000-8000-000000000001'),
 ('f5000000-0000-4000-8000-00000000000b','QA orc B','f5000000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('f5000000-0000-4000-8000-00000000001a','f5000000-0000-4000-8000-00000000000a','QA orc empresa A1','51222333000181'),
 ('f5000000-0000-4000-8000-00000000002a','f5000000-0000-4000-8000-00000000000a','QA orc empresa A2','51222333000262'),
 ('f5000000-0000-4000-8000-00000000001b','f5000000-0000-4000-8000-00000000000b','QA orc empresa B','52333444000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f5000000-0000-4000-8000-00000000000a','f5000000-0000-4000-8000-000000000001','gestor',null),
 ('f5000000-0000-4000-8000-00000000000a','f5000000-0000-4000-8000-000000000002','operador','f5000000-0000-4000-8000-00000000001a'),
 ('f5000000-0000-4000-8000-00000000000a','f5000000-0000-4000-8000-000000000004','leitura',null),
 ('f5000000-0000-4000-8000-00000000000b','f5000000-0000-4000-8000-000000000003','gestor',null);

set local role authenticated;
-- Gestor A: cria nas duas empresas; versão sobe a cada mudança; dono imutável; documento validado.
select set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000001',true);
do $$
declare
 oa uuid:='f5000000-0000-4000-8000-00000000000a'; e1 uuid:='f5000000-0000-4000-8000-00000000001a'; e2 uuid:='f5000000-0000-4000-8000-00000000002a';
 o uuid; v int; n int;
begin
 insert into public.orcamento_obra_salvos(id,organizacao_id,empresa_id,titulo,documento,valor_global,versao,criado_por)
  values('f5000000-0000-4000-8000-00000000005a',oa,e1,'Santo Antônio','{"versao":2,"leitura":{"itens":[]}}',849986.63,77,'f5000000-0000-4000-8000-000000000003') returning id, versao into o, v;
 if v<>1 then raise exception 'Versão inicial veio do cliente (%)',v;end if;
 if (select criado_por from public.orcamento_obra_salvos where id=o)<>'f5000000-0000-4000-8000-000000000001' then raise exception 'criado_por não veio de auth.uid()';end if;
 insert into public.orcamento_obra_salvos(id,organizacao_id,empresa_id,titulo,documento) values('f5000000-0000-4000-8000-00000000006a',oa,e2,'Da A2','{}');

 -- Gravar com a versão que eu abri: 1 linha e versão 2. Gravar de novo com a versão velha (outra aba): 0 linhas.
 update public.orcamento_obra_salvos set documento='{"versao":2,"x":1}', versao=999 where id=o and versao=1; get diagnostics n=row_count;
 if n<>1 or (select versao from public.orcamento_obra_salvos where id=o)<>2 then raise exception 'Versão não subiu para 2';end if;
 update public.orcamento_obra_salvos set documento='{"versao":2,"x":2}' where id=o and versao=1; get diagnostics n=row_count;
 if n<>0 then raise exception 'Gravou por cima de versão mais nova';end if;

 begin update public.orcamento_obra_salvos set empresa_id=e2 where id=o; raise exception 'Orçamento trocou de empresa'; exception when raise_exception then if sqlerrm not like 'Orçamento, empresa%' then raise; end if; end;
 begin update public.orcamento_obra_salvos set criado_por='f5000000-0000-4000-8000-000000000003' where id=o; raise exception 'Dono trocou'; exception when raise_exception then if sqlerrm not like 'Orçamento, empresa%' then raise; end if; end;
 -- Documento: só objeto, até 6 MB; título não vazio.
 begin insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento) values(oa,e1,'Lista','[]'); raise exception 'Documento lista aceito'; exception when check_violation then null; end;
 begin insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento) values(oa,e1,'Grande',jsonb_build_object('x',repeat('a',6291456))); raise exception 'Documento acima de 6 MB aceito'; exception when check_violation then null; end;
 begin insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento) values(oa,e1,'  ','{}'); raise exception 'Título vazio aceito'; exception when check_violation then null; end;
 begin insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento,valor_global) values(oa,e1,'Neg','{}',-1); raise exception 'Valor negativo aceito'; exception when check_violation then null; end;
 -- Limite de 200 por empresa (já há 1 na A1).
 insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento) select oa,e1,'Lote '||g,'{}' from generate_series(1,199) g;
 begin insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento) values(oa,e1,'201º','{}'); raise exception '201º orçamento aceito'; exception when raise_exception then if sqlerrm not like 'Limite de 200%' then raise; end if; end;
 delete from public.orcamento_obra_salvos where titulo like 'Lote %';
 if (select count(*) from public.orcamento_obra_salvos)<>2 then raise exception 'Gestor não vê os 2 orçamentos';end if;
end $$;

-- Operador restrito à A1: lê e grava na A1; não lê nem grava na A2.
select set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000002',true);
do $$
declare n int;
begin
 if (select count(*) from public.orcamento_obra_salvos)<>1 then raise exception 'Restrito vê orçamento de outra empresa';end if;
 update public.orcamento_obra_salvos set titulo='Santo Antônio (R)' where id='f5000000-0000-4000-8000-00000000005a'; get diagnostics n=row_count;
 if n<>1 then raise exception 'Restrito não gravou na própria empresa';end if;
 if (select atualizado_por from public.orcamento_obra_salvos where id='f5000000-0000-4000-8000-00000000005a')<>'f5000000-0000-4000-8000-000000000002' then raise exception 'atualizado_por errado';end if;
 begin insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento) values('f5000000-0000-4000-8000-00000000000a','f5000000-0000-4000-8000-00000000002a','Invasão','{}'); raise exception 'Restrito criou na A2'; exception when insufficient_privilege then null; end;
 delete from public.orcamento_obra_salvos where id='f5000000-0000-4000-8000-00000000006a'; get diagnostics n=row_count;
 if n<>0 then raise exception 'Restrito apagou orçamento da A2';end if;
end $$;

-- Papel leitura: lê, não grava nem apaga.
select set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000004',true);
do $$
declare n int;
begin
 if (select count(*) from public.orcamento_obra_salvos)<>2 then raise exception 'Leitura não lê';end if;
 update public.orcamento_obra_salvos set titulo='mexido'; get diagnostics n=row_count;
 if n<>0 then raise exception 'Leitura alterou orçamento';end if;
 delete from public.orcamento_obra_salvos; get diagnostics n=row_count;
 if n<>0 then raise exception 'Leitura apagou orçamento';end if;
 begin insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento) values('f5000000-0000-4000-8000-00000000000a','f5000000-0000-4000-8000-00000000001a','Da leitura','{}'); raise exception 'Leitura criou orçamento'; exception when insufficient_privilege then null; end;
end $$;

-- Gestor de outra organização: não vê, não mexe, não injeta.
select set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000003',true);
do $$
declare n int;
begin
 if exists(select 1 from public.orcamento_obra_salvos) then raise exception 'B lê orçamento de A';end if;
 update public.orcamento_obra_salvos set titulo='hack'; get diagnostics n=row_count;
 if n<>0 then raise exception 'B alterou orçamento de A';end if;
 begin insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento) values('f5000000-0000-4000-8000-00000000000a','f5000000-0000-4000-8000-00000000001a','Injetado','{}'); raise exception 'B criou em A'; exception when insufficient_privilege then null; end;
 -- Empresa de A com organização de B: o gatilho barra antes da RLS.
 begin insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento) values('f5000000-0000-4000-8000-00000000000b','f5000000-0000-4000-8000-00000000001a','Cruzado','{}'); raise exception 'Orçamento cruzado aceito'; exception when foreign_key_violation then null; end;
 insert into public.orcamento_obra_salvos(organizacao_id,empresa_id,titulo,documento) values('f5000000-0000-4000-8000-00000000000b','f5000000-0000-4000-8000-00000000001b','Da B','{}');
 if (select count(*) from public.orcamento_obra_salvos)<>1 then raise exception 'B não vê o próprio';end if;
end $$;

-- Gestor A não vê o da B.
select set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000001',true);
do $$ begin
 if exists(select 1 from public.orcamento_obra_salvos where organizacao_id='f5000000-0000-4000-8000-00000000000b') then raise exception 'A lê orçamento de B';end if;
end $$;

reset role;
-- Sem login (anon): nem permissão de tabela.
do $$ begin
 if has_table_privilege('anon','public.orcamento_obra_salvos','SELECT') or not has_table_privilege('authenticated','public.orcamento_obra_salvos','INSERT') then raise exception 'ACL inválida';end if;
 if not (select relrowsecurity from pg_class where oid='public.orcamento_obra_salvos'::regclass) then raise exception 'RLS desligada';end if;
 if has_function_privilege('authenticated','public.orcamento_obra_salvos_proteger()','EXECUTE') then raise exception 'Função do gatilho executável';end if;
 if not exists(select 1 from pg_proc p where p.proname='orcamento_obra_salvos_proteger' and p.prosecdef
   and exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then raise exception 'Gatilho sem definer/search_path';end if;
 -- Empresa apagada leva os orçamentos dela.
 delete from public.operacao_empresas where id='f5000000-0000-4000-8000-00000000002a';
 if exists(select 1 from public.orcamento_obra_salvos where empresa_id='f5000000-0000-4000-8000-00000000002a') then raise exception 'Cascata da empresa falhou';end if;
end $$;
select 'testar_orcamento_obra_salvos: ok';
rollback;
