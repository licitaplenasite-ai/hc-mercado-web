-- Teste de bases_preco.sql. Dados fictícios e rollback (nada fica no banco).
-- Papéis simulados com "set local role"; não prova a API HTTP do PostgREST.
begin;
set local role service_role;
insert into public.bases_preco_versoes(base,abrangencia,data_base,versao,desonerado,arredondamento,casas_decimais,fonte,situacao,itens)
values ('SINAPI','BR','2026-09-01','2026-09','ambos','edital',2,'QA CAIXA','precos',2),
       ('SICRO','AM','2026-07-01','07/2026','nao_informado','arredondar',2,'QA DNIT','precos',1),
       ('ORSE','BR','2026-08-01','2026-08','nao_informado','edital',null,'QA CEHOP','catalogo',0);
insert into public.bases_preco_partes(versao_id,parte,conteudo)
select id,'precos:AM:99','{"insumo|990001":[10.5,9.8],"composicao|990002":[20,null]}'::jsonb from public.bases_preco_versoes where base='SINAPI' and data_base='2026-09-01'
union all
select id,'precos:AM:10','{"composicao|104658":[269.08,250]}'::jsonb from public.bases_preco_versoes where base='SINAPI' and data_base='2026-09-01'
union all
select id,'analitico:99','{"990002":[["insumo","990001",0.25]]}'::jsonb from public.bases_preco_versoes where base='SINAPI' and data_base='2026-09-01';
-- Retificação regrava a mesma versão (mesma chave), não cria outra.
insert into public.bases_preco_versoes(base,abrangencia,data_base,versao,desonerado,arredondamento,fonte,situacao)
values ('SINAPI','BR','2026-09-01','2026-09 Retificação 01','ambos','edital','QA CAIXA','precos')
on conflict (base,abrangencia,data_base) do update set versao=excluded.versao;
do $$
declare v bigint; r jsonb;
begin
 if (select count(*) from public.bases_preco_versoes where base='SINAPI' and abrangencia='BR')<>1 then raise exception 'retificação duplicou a versão'; end if;
 if (select versao from public.bases_preco_versoes where base='SINAPI' and abrangencia='BR')<>'2026-09 Retificação 01' then raise exception 'retificação não regravou'; end if;
 select id into v from public.bases_preco_versoes where base='SINAPI' and abrangencia='BR';
 r := public.bases_preco_buscar(v,'precos:AM',array['insumo|990001','composicao|104658','insumo|880000']);
 if r <> '{"insumo|990001":[10.5,9.8],"composicao|104658":[269.08,250]}'::jsonb then raise exception 'buscar devolveu %', r; end if;
 r := public.bases_preco_buscar(v,'analitico',array['990002']);
 if r->'990002'->0->>1 <> '990001' then raise exception 'analítico: %', r; end if;
 if public.bases_preco_buscar(v,'precos:AC',array['insumo|990001'])<>'{}'::jsonb then raise exception 'UF sem parte deveria vir vazia'; end if;
 begin insert into public.bases_preco_versoes(base,abrangencia,data_base,versao,desonerado,arredondamento,fonte,situacao) values('SINAPI','BR','2026-10-15','x','ambos','edital','QA','precos'); raise exception 'data-base fora do dia 1 aceita';
 exception when check_violation then null; end;
 begin insert into public.bases_preco_versoes(base,abrangencia,data_base,versao,desonerado,arredondamento,fonte,situacao) values('SINAPI','BR','2026-10-01','x','talvez','edital','QA','precos'); raise exception 'desonerado inválido aceito';
 exception when check_violation then null; end;
 begin insert into public.bases_preco_versoes(base,abrangencia,data_base,versao,desonerado,arredondamento,fonte,situacao) values('SINAPI','BR','2026-10-01','x','ambos','chutar','QA','precos'); raise exception 'arredondamento inválido aceito';
 exception when check_violation then null; end;
 begin insert into public.bases_preco_versoes(base,abrangencia,data_base,versao,desonerado,arredondamento,fonte,situacao,fonte_url) values('SINAPI','BR','2026-10-01','x','ambos','edital','QA','precos','javascript:alert(1)'); raise exception 'link não http aceito';
 exception when check_violation then null; end;
 begin insert into public.bases_preco_partes(versao_id,parte,conteudo) values(v,'precos:AM:99;drop','{}'); raise exception 'parte inválida aceita';
 exception when check_violation then null; end;
 begin insert into public.bases_preco_partes(versao_id,parte,conteudo) values(v,'itens:12','[]'); raise exception 'conteúdo que não é objeto aceito';
 exception when check_violation then null; end;
end $$;
reset role;
insert into auth.users(id,email) values ('c9200000-0000-4000-8000-000000000001','bp-a@qa.invalid'),('c9200000-0000-4000-8000-000000000002','bp-p@qa.invalid');
insert into public.clientes(id,nome,email,status) values ('c9200000-0000-4000-8000-000000000001','QA bp A','bp-a@qa.invalid','aprovado'),('c9200000-0000-4000-8000-000000000002','QA bp P','bp-p@qa.invalid','pendente');
set local role anon;
do $$ begin
 begin perform 1 from public.bases_preco_versoes; raise exception 'anon leu versões';
 exception when insufficient_privilege then null; end;
 begin perform public.bases_preco_buscar(1,'precos:AM',array['x']); raise exception 'anon chamou buscar';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9200000-0000-4000-8000-000000000002',true);
do $$ declare v bigint; begin
 if (select count(*) from public.bases_preco_versoes where fonte like 'QA%')<>0 then raise exception 'pendente leu versões'; end if;
 select id into v from public.bases_preco_versoes where fonte like 'QA%' limit 1;
 if (select count(*) from public.bases_preco_partes where conteudo ? 'insumo|990001')<>0 then raise exception 'pendente leu partes'; end if;
end $$;
select set_config('request.jwt.claim.sub','c9200000-0000-4000-8000-000000000001',true);
do $$ declare v bigint; begin
 if (select count(*) from public.bases_preco_versoes where fonte like 'QA%')<>3 then raise exception 'aprovado não lê versões'; end if;
 select id into v from public.bases_preco_versoes where base='SINAPI' and abrangencia='BR';
 if public.bases_preco_buscar(v,'precos:AM',array['insumo|990001'])<>'{"insumo|990001":[10.5,9.8]}'::jsonb then raise exception 'aprovado não busca'; end if;
 begin insert into public.bases_preco_versoes(base,abrangencia,data_base,versao,desonerado,arredondamento,fonte,situacao) values('X1','BR','2026-10-01','x','ambos','edital','QA','precos'); raise exception 'autenticado gravou versão';
 exception when insufficient_privilege then null; end;
 begin update public.bases_preco_partes set conteudo='{}'; raise exception 'autenticado alterou parte';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Retenção do robô: apagar a versão leva as partes (cascade).
set local role service_role;
delete from public.bases_preco_versoes where base='SINAPI' and abrangencia='BR' and fonte like 'QA%';
do $$ begin
 if exists (select 1 from public.bases_preco_partes where conteudo ? 'insumo|990001') then raise exception 'partes ficaram órfãs'; end if;
end $$;
reset role;
rollback;
