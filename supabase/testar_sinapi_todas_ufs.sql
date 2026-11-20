-- Teste de sinapi_todas_ufs.sql. Dados fictícios e rollback (nada fica no banco).
-- Papéis simulados com "set local role"; não prova a API HTTP do PostgREST.
begin;
do $$ begin
 if to_regclass('public.sinapi_precos') is not null then raise exception 'sinapi_precos antiga não foi apagada'; end if;
end $$;
set local role service_role;
insert into public.sinapi_itens(tipo,codigo,descricao,unidade,referencia,busca) values
 ('insumo','990001','QA areia média','M3','2026-09-01','qa areia media'),
 ('composicao','990002','QA alvenaria','M2','2026-09-01','qa alvenaria');
insert into public.sinapi_custos(uf,tipo,codigo,preco_sd,preco_cd,referencia) values
 ('AC','insumo','990001',120.50,118.00,'2026-09-01'),('PB','insumo','990001',99.00,null,'2026-09-01'),
 ('AC','composicao','990002',88.10,80.00,'2026-09-01');
insert into public.sinapi_composicao_itens(composicao,item_tipo,item_codigo,descricao,unidade,coeficiente,referencia) values
 ('990002','insumo','990001','QA areia média','M3',0.25,'2026-09-01');
-- Mesmo caminho do robô: upsert com a referência nova (a 990002 saiu do SINAPI), depois limpeza da anterior.
insert into public.sinapi_itens(tipo,codigo,descricao,unidade,referencia,busca) values
 ('insumo','990001','QA areia média','M3','2026-10-01','qa areia media')
 on conflict (tipo,codigo) do update set referencia=excluded.referencia;
insert into public.sinapi_custos(uf,tipo,codigo,preco_sd,preco_cd,referencia) values
 ('AC','insumo','990001',125.00,121.00,'2026-10-01')
 on conflict (uf,tipo,codigo) do update set preco_sd=excluded.preco_sd,preco_cd=excluded.preco_cd,referencia=excluded.referencia;
delete from public.sinapi_custos where uf in ('AC','PB') and referencia<'2026-10-01';
delete from public.sinapi_composicao_itens where referencia<'2026-10-01';
delete from public.sinapi_itens where referencia<'2026-10-01';
do $$ begin
 if (select count(*) from public.sinapi_itens where codigo like '99000_')<>1 then raise exception 'limpeza de itens errada'; end if;
 if (select count(*) from public.sinapi_custos where codigo like '99000_')<>1 then raise exception 'cascade/limpeza de custos errada'; end if;
 if (select preco_cd from public.sinapi_custos where uf='AC' and codigo='990001')<>121.00 then raise exception 'upsert não atualizou'; end if;
 if (select count(*) from public.sinapi_composicao_itens where composicao='990002')<>0 then raise exception 'analítico antigo ficou'; end if;
 begin insert into public.sinapi_custos(uf,tipo,codigo,preco_sd,preco_cd,referencia) values('AC','insumo','990009',1,1,'2026-10-01'); raise exception 'custo sem item aceito';
 exception when foreign_key_violation then null; end;
 begin insert into public.sinapi_custos(uf,tipo,codigo,preco_sd,preco_cd,referencia) values('AM','insumo','990001',null,null,'2026-10-01'); raise exception 'custo sem preço aceito';
 exception when check_violation then null; end;
 begin insert into public.sinapi_custos(uf,tipo,codigo,preco_sd,referencia) values('AM','insumo','990001',0,'2026-10-01'); raise exception 'preço zero aceito';
 exception when check_violation then null; end;
 begin insert into public.sinapi_itens(tipo,codigo,descricao,referencia) values('insumo','abc','x','2026-10-01'); raise exception 'código não numérico aceito';
 exception when check_violation then null; end;
 begin insert into public.sinapi_itens(tipo,codigo,descricao,referencia) values('servico','1','x','2026-10-01'); raise exception 'tipo inválido aceito';
 exception when check_violation then null; end;
 begin insert into public.sinapi_itens(tipo,codigo,descricao,referencia) values('insumo','1','x','2026-10-15'); raise exception 'referência fora do dia 1 aceita';
 exception when check_violation then null; end;
 begin insert into public.sinapi_composicao_itens(composicao,item_tipo,item_codigo,descricao,coeficiente,referencia) values('1','insumo','2','x',-1,'2026-10-01'); raise exception 'coeficiente negativo aceito';
 exception when check_violation then null; end;
end $$;
insert into public.sinapi_composicao_itens(composicao,item_tipo,item_codigo,descricao,unidade,coeficiente,referencia) values
 ('990003','insumo','990001','QA areia média','M3',0.5,'2026-10-01');
reset role;
insert into auth.users(id,email) values ('c9100000-0000-4000-8000-000000000001','sin-a@qa.invalid'),('c9100000-0000-4000-8000-000000000002','sin-p@qa.invalid');
insert into public.clientes(id,nome,email,status) values ('c9100000-0000-4000-8000-000000000001','QA sin A','sin-a@qa.invalid','aprovado'),('c9100000-0000-4000-8000-000000000002','QA sin P','sin-p@qa.invalid','pendente');
set local role anon;
do $$ begin
 begin perform 1 from public.sinapi_itens; raise exception 'anon leu itens';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.sinapi_custos; raise exception 'anon leu custos';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.sinapi_composicao_itens; raise exception 'anon leu analítico';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9100000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.sinapi_itens where codigo like '99000_')<>0 then raise exception 'cliente pendente leu itens'; end if;
 if (select count(*) from public.sinapi_custos where codigo like '99000_')<>0 then raise exception 'cliente pendente leu custos'; end if;
 if (select count(*) from public.sinapi_composicao_itens where composicao='990003')<>0 then raise exception 'cliente pendente leu analítico'; end if;
end $$;
select set_config('request.jwt.claim.sub','c9100000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.sinapi_itens i join public.sinapi_custos c using (tipo,codigo) where c.uf='AC' and i.codigo='990001')<>1 then raise exception 'cliente aprovado não lê'; end if;
 if (select count(*) from public.sinapi_composicao_itens where composicao='990003')<>1 then raise exception 'cliente aprovado não lê analítico'; end if;
 begin insert into public.sinapi_itens(tipo,codigo,descricao,referencia) values('insumo','2','x','2026-10-01'); raise exception 'autenticado gravou';
 exception when insufficient_privilege then null; end;
 begin update public.sinapi_custos set preco_sd=1; raise exception 'autenticado alterou';
 exception when insufficient_privilege then null; end;
 begin delete from public.sinapi_composicao_itens; raise exception 'autenticado apagou';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
