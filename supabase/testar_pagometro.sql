-- Teste de pagometro.sql. Dados fictícios e rollback (nada fica no banco).
-- Papéis simulados com "set local role"; não prova a API HTTP do PostgREST.
begin;
set local role service_role;
insert into public.pagometro_entes(id_ente,esfera,nome,uf,exercicio,semaforo,indicadores,fonte) values
 ('9999901','M','QA Prefeitura','ZZ',2025,'verde','{"taxaPago":0.95}','https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?id_ente=9999901'),
 ('99','E',null,null,null,'sem_dados','{}','https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?id_ente=99');
-- Upsert pela chave (mesmo caminho da função: on conflict).
insert into public.pagometro_entes(id_ente,esfera,nome,uf,exercicio,semaforo,indicadores,fonte) values
 ('9999901','M','QA Prefeitura','ZZ',2025,'vermelho','{"taxaPago":0.5}','https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?id_ente=9999901')
 on conflict (id_ente) do update set semaforo=excluded.semaforo,indicadores=excluded.indicadores,coletado_em=now();
do $$ begin
 if (select count(*) from public.pagometro_entes where id_ente in ('9999901','99'))<>2 then raise exception 'upsert duplicou'; end if;
 if (select semaforo from public.pagometro_entes where id_ente='9999901')<>'vermelho' then raise exception 'upsert não atualizou'; end if;
 begin insert into public.pagometro_entes(id_ente,esfera,exercicio,semaforo,fonte) values('123','M',2025,'verde','https://apidatalake.tesouro.gov.br/x'); raise exception 'código de 3 dígitos aceito';
 exception when check_violation then null; end;
 begin insert into public.pagometro_entes(id_ente,esfera,exercicio,semaforo,fonte) values('9999902','E',2025,'verde','https://apidatalake.tesouro.gov.br/x'); raise exception 'município com esfera E aceito';
 exception when check_violation then null; end;
 begin insert into public.pagometro_entes(id_ente,esfera,exercicio,semaforo,fonte) values('9999903','M',2025,'azul','https://apidatalake.tesouro.gov.br/x'); raise exception 'semáforo inválido aceito';
 exception when check_violation then null; end;
 begin insert into public.pagometro_entes(id_ente,esfera,exercicio,semaforo,fonte) values('9999904','M',2025,'verde','https://exemplo.invalid/x'); raise exception 'fonte fora do Tesouro aceita';
 exception when check_violation then null; end;
 begin insert into public.pagometro_entes(id_ente,esfera,semaforo,fonte) values('9999905','M','verde','https://apidatalake.tesouro.gov.br/x'); raise exception 'nota sem exercício aceita';
 exception when check_violation then null; end;
 begin delete from public.pagometro_entes where id_ente='99'; raise exception 'service_role apagou';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into auth.users(id,email) values ('c9200000-0000-4000-8000-000000000001','pag-a@qa.invalid'),('c9200000-0000-4000-8000-000000000002','pag-p@qa.invalid');
insert into public.clientes(id,nome,email,status) values ('c9200000-0000-4000-8000-000000000001','QA pag A','pag-a@qa.invalid','aprovado'),('c9200000-0000-4000-8000-000000000002','QA pag P','pag-p@qa.invalid','pendente');
set local role anon;
do $$ begin
 begin perform 1 from public.pagometro_entes; raise exception 'anon leu';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9200000-0000-4000-8000-000000000002',true);
do $$ begin if (select count(*) from public.pagometro_entes where id_ente in ('9999901','99'))<>0 then raise exception 'cliente pendente leu'; end if; end $$;
select set_config('request.jwt.claim.sub','c9200000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.pagometro_entes where id_ente in ('9999901','99'))<>2 then raise exception 'cliente aprovado não lê'; end if;
 begin insert into public.pagometro_entes(id_ente,esfera,exercicio,semaforo,fonte) values('9999906','M',2025,'verde','https://apidatalake.tesouro.gov.br/x'); raise exception 'autenticado gravou';
 exception when insufficient_privilege then null; end;
 begin update public.pagometro_entes set semaforo='verde' where id_ente='9999901'; raise exception 'autenticado alterou';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Prazo de pagamento: fila e resultado.
set local role service_role;
insert into public.pagometro_prazos(chave,fonte,situacao) values ('M:9999901','tce-sp','pendente'),('F:999999','transparencia','pendente');
update public.pagometro_prazos set situacao='pronto',dias_24m=31,amostra_24m=40,dias_36m=29,amostra_36m=60,coletado_em=now() where chave='M:9999901';
do $$ begin
 if (select dias_36m from public.pagometro_prazos where chave='M:9999901')<>29 then raise exception 'prazo não gravou'; end if;
 begin insert into public.pagometro_prazos(chave,fonte,situacao) values('E:35','tce-sp','pendente'); raise exception 'chave estadual aceita';
 exception when check_violation then null; end;
 begin insert into public.pagometro_prazos(chave,fonte,situacao) values('F:12345','transparencia','pendente'); raise exception 'UG de 5 dígitos aceita';
 exception when check_violation then null; end;
 begin update public.pagometro_prazos set dias_24m=-1 where chave='M:9999901'; raise exception 'dias negativos aceitos';
 exception when check_violation then null; end;
 begin update public.pagometro_prazos set situacao='estimado' where chave='M:9999901'; raise exception 'situação inválida aceita';
 exception when check_violation then null; end;
 begin delete from public.pagometro_prazos where chave='F:999999'; raise exception 'service_role apagou prazo';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9200000-0000-4000-8000-000000000002',true);
do $$ begin if (select count(*) from public.pagometro_prazos where chave in ('M:9999901','F:999999'))<>0 then raise exception 'pendente leu prazo'; end if; end $$;
select set_config('request.jwt.claim.sub','c9200000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.pagometro_prazos where chave in ('M:9999901','F:999999'))<>2 then raise exception 'aprovado não lê prazo'; end if;
 begin update public.pagometro_prazos set dias_24m=1 where chave='M:9999901'; raise exception 'autenticado alterou prazo';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if has_table_privilege('anon','public.pagometro_prazos','SELECT') then raise exception 'anon lê prazos'; end if;
 if has_table_privilege('anon','public.pagometro_entes','SELECT') then raise exception 'anon lê o Pagômetro'; end if;
 if has_function_privilege('anon','public.cliente_aprovado()','EXECUTE') then raise exception 'anon executa cliente_aprovado'; end if;
end $$;
rollback;
