-- Teste de cache_consultas_publicas.sql. Dados fictícios e rollback (nada fica no banco).
-- Papéis simulados com "set local role"; não prova a API HTTP do PostgREST.
begin;
set local role service_role;
insert into public.cache_consultas_publicas(chave,fonte,termo,corpo)
values ('marcas-produto|qa papel||||1|','precos','qa papel','{"ok":true,"itens":[]}');
select public.registrar_busca_termo('precos','qa detergente');
select public.registrar_busca_termo('precos','qa detergente');
select public.registrar_busca_termo('precos','qa cadeira');
do $$ begin
 if (select contagem from public.buscas_termos where termo='qa detergente' and dia=current_date)<>2 then raise exception 'contagem não somou'; end if;
 if (select termo from public.termos_mais_buscados('precos',30,1))<>'qa detergente' then raise exception 'mais buscado errado'; end if;
 begin perform public.registrar_busca_termo('precos','cpf 12345678901'); raise exception 'termo com CPF/CNPJ aceito';
 exception when check_violation then null; end;
 begin insert into public.cache_consultas_publicas(chave,fonte,termo,corpo) values('x|y','pncp','qa','{}'); raise exception 'fonte inválida aceita';
 exception when check_violation then null; end;
end $$;
reset role;
insert into auth.users(id,email) values ('c9300000-0000-4000-8000-000000000001','cc-a@qa.invalid'),('c9300000-0000-4000-8000-000000000002','cc-p@qa.invalid');
insert into public.clientes(id,nome,email,status) values ('c9300000-0000-4000-8000-000000000001','QA cc A','cc-a@qa.invalid','aprovado'),('c9300000-0000-4000-8000-000000000002','QA cc P','cc-p@qa.invalid','pendente');
set local role anon;
do $$ begin
 begin perform 1 from public.cache_consultas_publicas; raise exception 'anon leu o cache';
 exception when insufficient_privilege then null; end;
 begin perform public.registrar_busca_termo('precos','qa anon'); raise exception 'anon registrou busca';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9300000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.cache_consultas_publicas where termo like 'qa%')<>0 then raise exception 'pendente leu o cache'; end if;
end $$;
select set_config('request.jwt.claim.sub','c9300000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.cache_consultas_publicas where termo like 'qa%')<>1 then raise exception 'aprovado não lê o cache'; end if;
 begin perform 1 from public.buscas_termos; raise exception 'cliente leu as buscas';
 exception when insufficient_privilege then null; end;
 begin perform public.registrar_busca_termo('precos','qa cliente'); raise exception 'cliente registrou busca direto';
 exception when insufficient_privilege then null; end;
 begin perform public.termos_mais_buscados('precos',30,10); raise exception 'cliente leu os mais buscados';
 exception when insufficient_privilege then null; end;
 begin insert into public.cache_consultas_publicas(chave,fonte,termo,corpo) values('qa|x','precos','qa','{}'); raise exception 'cliente gravou no cache';
 exception when insufficient_privilege then null; end;
 begin update public.cache_consultas_publicas set corpo='{}'; raise exception 'cliente alterou o cache';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
