-- Teste de contador.sql. Dados fictícios e rollback (nada fica no banco).
-- Papéis simulados com "set local role"; não prova a API HTTP do PostgREST.
begin;
insert into auth.users(id,email) values ('c4000000-0000-4000-8000-000000000001','ct-e@qa.invalid'),('c4000000-0000-4000-8000-000000000002','ct-s@qa.invalid');
insert into public.clientes(id,nome,email,status,plano) values
 ('c4000000-0000-4000-8000-000000000001','QA ct E','ct-e@qa.invalid','aprovado','empresa'),
 ('c4000000-0000-4000-8000-000000000002','QA ct S','ct-s@qa.invalid','aprovado','essencial');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('c4000000-0000-4000-8000-00000000000e','QA ct org E','c4000000-0000-4000-8000-000000000001'),
 ('c4000000-0000-4000-8000-00000000000f','QA ct org S','c4000000-0000-4000-8000-000000000002');
insert into public.operacao_membros(organizacao_id,usuario_id,papel) values
 ('c4000000-0000-4000-8000-00000000000e','c4000000-0000-4000-8000-000000000001','gestor'),
 ('c4000000-0000-4000-8000-00000000000f','c4000000-0000-4000-8000-000000000002','gestor');
update public.assinaturas set plano='essencial', situacao='ativa', teste_ate=null where usuario_id='c4000000-0000-4000-8000-000000000002';
do $$
declare v jsonb;
begin
 if not exists (select 1 from public.recursos_plano where codigo='contador' and funcoes @> array['contador-ia','contador-calculo']) then raise exception 'recurso contador ausente'; end if;
 if not exists (select 1 from public.recursos_plano where codigo='ia' and 'contador-ia' = any (funcoes)) then raise exception 'contador-ia fora do uso justo de IA'; end if;
 if (select count(*) from public.recursos_plano where 'contador-ia' = any (funcoes)) <> 2 then raise exception 'contador-ia duplicado'; end if;
 if exists (select 1 from public.plano_recursos where recurso='contador' and plano in ('gratis','essencial') and permitido) then raise exception 'Essencial ou teste encerrado com Contador'; end if;
 if (select count(*) from public.plano_recursos where recurso='contador' and plano in ('teste','empresa','assessoria','dono') and permitido) <> 4 then raise exception 'plano pago sem Contador'; end if;
 -- Empresa usa (a regra do recurso mais específico ganha: contador, não ia); Essencial recebe "plano".
 v := public.consumir_uso_plano('c4000000-0000-4000-8000-000000000001','contador-ia',40);
 if not (v->>'permitido')::boolean or v->>'recurso'<>'contador' then raise exception 'Empresa barrado no Contador: %',v; end if;
 v := public.consumir_uso_plano('c4000000-0000-4000-8000-000000000002','contador-calculo',40);
 if (v->>'permitido')::boolean or v->>'motivo'<>'plano' then raise exception 'Essencial usou o Contador: %',v; end if;
 -- Uso de contador-ia soma no mês de IA.
 if public.uso_ia_mes_titular('c4000000-0000-4000-8000-000000000001') < 1 then raise exception 'contador-ia não contou na IA do mês'; end if;
end $$;
-- Resumo no item: objeto pequeno aceito; lista ou objeto enorme recusado.
insert into public.operacao_empresas(id,organizacao_id,razao_social) values ('c4000000-0000-4000-8000-0000000000e1','c4000000-0000-4000-8000-00000000000e','QA ct E1');
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto) values ('c4000000-0000-4000-8000-0000000000e2','c4000000-0000-4000-8000-00000000000e','c4000000-0000-4000-8000-0000000000e1','QA ct p');
insert into public.operacao_itens_resultado(id,organizacao_id,processo_id,tipo,identificador) values ('c4000000-0000-4000-8000-0000000000e3','c4000000-0000-4000-8000-00000000000e','c4000000-0000-4000-8000-0000000000e2','item','1');
do $$ begin
 update public.operacao_itens_resultado set contador_resumo='{"precoFinal":"305.85","ano":2027}' where id='c4000000-0000-4000-8000-0000000000e3';
 begin update public.operacao_itens_resultado set contador_resumo='[1,2]' where id='c4000000-0000-4000-8000-0000000000e3'; raise exception 'lista aceita';
 exception when check_violation then null; end;
 begin update public.operacao_itens_resultado set contador_resumo=jsonb_build_object('x',repeat('a',20000)) where id='c4000000-0000-4000-8000-0000000000e3'; raise exception 'resumo enorme aceito';
 exception when check_violation then null; end;
end $$;
-- Caches: service_role grava; anon e autenticado não leem.
set local role service_role;
insert into public.contador_classificacoes(chave,tipo,codigo,cclasstrib,motivo) values (repeat('a',64),'bem','10063021','200003','Arroz: Anexo I');
insert into public.contador_oficial(chave,resultado) values ('ncm:10063021|200003|2027','{"estado":"CALCULO_SIMULADO"}');
do $$ begin
 begin insert into public.contador_oficial(chave,resultado) values ('ncm:1006|200003|2027','{}'); raise exception 'chave inválida aceita';
 exception when check_violation then null; end;
 begin insert into public.contador_classificacoes(chave,tipo,codigo,cclasstrib) values (repeat('b',64),'outro','10063021','200003'); raise exception 'tipo inválido aceito';
 exception when check_violation then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.contador_oficial; raise exception 'anon leu cache oficial';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','c4000000-0000-4000-8000-000000000001',true);
do $$ begin
 begin perform 1 from public.contador_classificacoes; raise exception 'autenticado leu cache de classificação';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
