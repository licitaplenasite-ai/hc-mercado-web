-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Banco local/clone com operacao_licitacoes.sql, seguranca_operacao.sql,
-- seguranca_aprovacao_20261119.sql e funil_quadros.sql aplicados. Fixtures sintéticas e rollback no fim.
-- RLS simulada com "set local role authenticated" + request.jwt.claim.sub; não prova a API HTTP (o e2e-quadros.cjs prova).
-- Gestor A (org inteira) f4..01, operador restrito à empresa A1 f4..02, leitura f4..04, gestor B f4..03.
begin;
insert into auth.users(id,email) values
 ('f4000000-0000-4000-8000-000000000001','quadro-a@qa.invalid'),('f4000000-0000-4000-8000-000000000002','quadro-r@qa.invalid'),
 ('f4000000-0000-4000-8000-000000000003','quadro-b@qa.invalid'),('f4000000-0000-4000-8000-000000000004','quadro-l@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f4000000-0000-4000-8000-000000000001','QA quadro A','quadro-a@qa.invalid','aprovado'),
 ('f4000000-0000-4000-8000-000000000002','QA quadro R','quadro-r@qa.invalid','aprovado'),
 ('f4000000-0000-4000-8000-000000000003','QA quadro B','quadro-b@qa.invalid','aprovado'),
 ('f4000000-0000-4000-8000-000000000004','QA quadro L','quadro-l@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f4000000-0000-4000-8000-00000000000a','QA quadro A','f4000000-0000-4000-8000-000000000001'),
 ('f4000000-0000-4000-8000-00000000000b','QA quadro B','f4000000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('f4000000-0000-4000-8000-00000000001a','f4000000-0000-4000-8000-00000000000a','QA quadro empresa A1','41222333000181'),
 ('f4000000-0000-4000-8000-00000000002a','f4000000-0000-4000-8000-00000000000a','QA quadro empresa A2','41222333000262'),
 ('f4000000-0000-4000-8000-00000000001b','f4000000-0000-4000-8000-00000000000b','QA quadro empresa B','42333444000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-000000000001','gestor',null),
 ('f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-000000000002','operador','f4000000-0000-4000-8000-00000000001a'),
 ('f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-000000000004','leitura',null),
 ('f4000000-0000-4000-8000-00000000000b','f4000000-0000-4000-8000-000000000003','gestor',null);
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto) values
 ('f4000000-0000-4000-8000-00000000003a','f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-00000000001a','QA processo A1'),
 ('f4000000-0000-4000-8000-00000000004a','f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-00000000002a','QA processo A2');

set local role authenticated;
-- Gestor A: cria, move, protege coluna com cartão, limites e coerência.
select set_config('request.jwt.claim.sub','f4000000-0000-4000-8000-000000000001',true);
do $$
declare
 oa uuid:='f4000000-0000-4000-8000-00000000000a'; e1 uuid:='f4000000-0000-4000-8000-00000000001a'; e2 uuid:='f4000000-0000-4000-8000-00000000002a';
 q uuid; q2 uuid; c1 uuid; c2 uuid; cx uuid; k uuid; n int;
begin
 insert into public.operacao_quadros(id,organizacao_id,empresa_id,nome) values('f4000000-0000-4000-8000-00000000005a',oa,e1,'Rotina da semana') returning id into q;
 insert into public.operacao_quadros(id,organizacao_id,empresa_id,nome) values('f4000000-0000-4000-8000-00000000006a',oa,e2,'Quadro da A2') returning id into q2;
 if (select criado_por from public.operacao_quadros where id=q)<>'f4000000-0000-4000-8000-000000000001' then raise exception 'criado_por não veio de auth.uid()';end if;
 insert into public.operacao_quadros_colunas(quadro_id,organizacao_id,empresa_id,nome,ordem) values(q,oa,e1,'A fazer',1) returning id into c1;
 insert into public.operacao_quadros_colunas(quadro_id,organizacao_id,empresa_id,nome,ordem) values(q,oa,e1,'Feito',2) returning id into c2;
 insert into public.operacao_quadros_colunas(quadro_id,organizacao_id,empresa_id,nome,ordem) values(q2,oa,e2,'Outra',1) returning id into cx;
 insert into public.operacao_quadros_cartoes(quadro_id,coluna_id,organizacao_id,empresa_id,titulo,processo_id,ordem)
  values(q,c1,oa,e1,'Cotar papel','f4000000-0000-4000-8000-00000000003a',1) returning id into k;

 -- Mover dentro do quadro: ok; para coluna de outro quadro: a FK composta barra.
 update public.operacao_quadros_cartoes set coluna_id=c2, ordem=0.5 where id=k;
 if (select coluna_id from public.operacao_quadros_cartoes where id=k)<>c2 then raise exception 'Cartão não moveu';end if;
 begin update public.operacao_quadros_cartoes set coluna_id=cx where id=k; raise exception 'Cartão foi para coluna de outro quadro'; exception when foreign_key_violation then null; end;
 begin update public.operacao_quadros_cartoes set quadro_id=q2, coluna_id=cx where id=k; raise exception 'Cartão trocou de quadro'; exception when raise_exception then if sqlerrm not like 'Quadro, empresa%' then raise; end if; end;
 begin update public.operacao_quadros set empresa_id=e2 where id=q; raise exception 'Quadro trocou de empresa'; exception when raise_exception then if sqlerrm not like 'Quadro, empresa%' then raise; end if; end;
 -- Processo de outra empresa (mesma organização) não entra no cartão.
 begin update public.operacao_quadros_cartoes set processo_id='f4000000-0000-4000-8000-00000000004a' where id=k; raise exception 'Processo da A2 aceito no quadro da A1'; exception when foreign_key_violation then if sqlerrm not like 'Processo de outra%' then raise; end if; end;
 -- Coluna com cartão não sai (sem perda silenciosa); vazia sai.
 begin delete from public.operacao_quadros_colunas where id=c2; raise exception 'Apagou coluna com cartão'; exception when foreign_key_violation then null; end;
 delete from public.operacao_quadros_colunas where id=c1;
 -- Validação de nome e limite de 20 colunas.
 begin insert into public.operacao_quadros(organizacao_id,empresa_id,nome) values(oa,e1,'  '); raise exception 'Nome vazio aceito'; exception when check_violation then null; end;
 for n in 1..19 loop insert into public.operacao_quadros_colunas(quadro_id,organizacao_id,empresa_id,nome,ordem) values(q,oa,e1,'Col '||n,10+n); end loop;
 begin insert into public.operacao_quadros_colunas(quadro_id,organizacao_id,empresa_id,nome) values(q,oa,e1,'Col 21'); raise exception '21ª coluna aceita'; exception when raise_exception then if sqlerrm not like 'Limite de 20%' then raise; end if; end;
 delete from public.operacao_quadros_colunas where quadro_id=q and nome like 'Col %';
 -- Processo apagado solta o cartão, não o apaga.
 update public.operacao_quadros_cartoes set processo_id='f4000000-0000-4000-8000-00000000003a' where id=k;
 if (select count(*) from public.operacao_quadros where organizacao_id=oa)<>2 then raise exception 'Gestor não vê os 2 quadros';end if;
end $$;

-- Operador restrito à A1: escreve na A1, não lê nem escreve na A2.
select set_config('request.jwt.claim.sub','f4000000-0000-4000-8000-000000000002',true);
do $$
declare oa uuid:='f4000000-0000-4000-8000-00000000000a'; n int;
begin
 if (select count(*) from public.operacao_quadros)<>1 then raise exception 'Restrito vê quadro de outra empresa';end if;
 if exists(select 1 from public.operacao_quadros_colunas where empresa_id='f4000000-0000-4000-8000-00000000002a') then raise exception 'Restrito vê coluna da A2';end if;
 update public.operacao_quadros set nome='Rotina (R)' where id='f4000000-0000-4000-8000-00000000005a'; get diagnostics n=row_count;
 if n<>1 then raise exception 'Restrito não renomeou quadro da própria empresa';end if;
 begin insert into public.operacao_quadros(organizacao_id,empresa_id,nome) values(oa,'f4000000-0000-4000-8000-00000000002a','Invasão'); raise exception 'Restrito criou quadro na A2'; exception when insufficient_privilege then null; end;
 delete from public.operacao_quadros where id='f4000000-0000-4000-8000-00000000006a'; get diagnostics n=row_count;
 if n<>0 then raise exception 'Restrito apagou quadro da A2';end if;
end $$;

-- Papel leitura: lê, não escreve.
select set_config('request.jwt.claim.sub','f4000000-0000-4000-8000-000000000004',true);
do $$
declare n int;
begin
 if (select count(*) from public.operacao_quadros)<>2 or (select count(*) from public.operacao_quadros_cartoes)<>1 then raise exception 'Leitura não lê';end if;
 update public.operacao_quadros_cartoes set titulo='mexido'; get diagnostics n=row_count;
 if n<>0 then raise exception 'Leitura alterou cartão';end if;
 begin insert into public.operacao_quadros(organizacao_id,empresa_id,nome) values('f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-00000000001a','Da leitura'); raise exception 'Leitura criou quadro'; exception when insufficient_privilege then null; end;
end $$;

-- Gestor de outra organização: não vê nem injeta.
select set_config('request.jwt.claim.sub','f4000000-0000-4000-8000-000000000003',true);
do $$
begin
 if exists(select 1 from public.operacao_quadros) or exists(select 1 from public.operacao_quadros_cartoes) then raise exception 'B lê quadros de A';end if;
 begin insert into public.operacao_quadros(organizacao_id,empresa_id,nome) values('f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-00000000001a','Injetado'); raise exception 'B criou quadro em A'; exception when insufficient_privilege then null; end;
 -- Empresa de A com organização de B: o gatilho barra antes da RLS.
 begin insert into public.operacao_quadros(organizacao_id,empresa_id,nome) values('f4000000-0000-4000-8000-00000000000b','f4000000-0000-4000-8000-00000000001a','Cruzado'); raise exception 'Quadro cruzado aceito'; exception when foreign_key_violation then null; end;
end $$;

reset role;
do $$
declare t text;
begin
 foreach t in array array['operacao_quadros','operacao_quadros_colunas','operacao_quadros_cartoes'] loop
  if has_table_privilege('anon','public.'||t,'SELECT') or not has_table_privilege('authenticated','public.'||t,'INSERT') then raise exception 'ACL inválida em %',t;end if;
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS desligada em %',t;end if;
 end loop;
 if has_function_privilege('authenticated','public.operacao_quadros_proteger()','EXECUTE') then raise exception 'Função do gatilho executável';end if;
 if not exists(select 1 from pg_proc p where p.proname='operacao_quadros_proteger' and p.prosecdef
   and exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then raise exception 'Gatilho sem definer/search_path';end if;
 -- Processo apagado solta o cartão; empresa apagada leva quadro, colunas e cartões (cascata no mesmo comando).
 delete from public.operacao_processos where id='f4000000-0000-4000-8000-00000000003a';
 if (select processo_id from public.operacao_quadros_cartoes where quadro_id='f4000000-0000-4000-8000-00000000005a') is not null then raise exception 'Cartão não soltou o processo';end if;
 delete from public.operacao_quadros where id='f4000000-0000-4000-8000-00000000005a';
 if exists(select 1 from public.operacao_quadros_cartoes where quadro_id='f4000000-0000-4000-8000-00000000005a') then raise exception 'Apagar quadro não levou os cartões';end if;
 delete from public.operacao_organizacoes where id='f4000000-0000-4000-8000-00000000000a';
 if exists(select 1 from public.operacao_quadros where organizacao_id='f4000000-0000-4000-8000-00000000000a') then raise exception 'Cascata da organização falhou';end if;
 raise notice 'testar_funil_quadros: ok';
end $$;
rollback;
