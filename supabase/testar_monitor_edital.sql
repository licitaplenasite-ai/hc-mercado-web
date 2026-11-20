-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Banco local (ambiente-teste) com operacao_esteira.sql e
-- operacao_monitor_edital.sql aplicados. Fixtures sintéticas e rollback.
-- RLS simulada com "set local role" + request.jwt.claim.sub. Gestor f8..01 (org inteira), operador f8..02 só da empresa B,
-- f8..03 de outra organização.
begin;
insert into auth.users(id,email) values
 ('f8000000-0000-4000-8000-000000000001','monitor-a@qa.invalid'),('f8000000-0000-4000-8000-000000000002','monitor-b@qa.invalid'),
 ('f8000000-0000-4000-8000-000000000003','monitor-x@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f8000000-0000-4000-8000-000000000001','QA monitor A','monitor-a@qa.invalid','aprovado'),
 ('f8000000-0000-4000-8000-000000000002','QA monitor B','monitor-b@qa.invalid','aprovado'),
 ('f8000000-0000-4000-8000-000000000003','QA monitor X','monitor-x@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f8000000-0000-4000-8000-00000000000a','QA monitor','f8000000-0000-4000-8000-000000000001'),
 ('f8000000-0000-4000-8000-00000000000b','QA monitor outra','f8000000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('f8000000-0000-4000-8000-00000000001a','f8000000-0000-4000-8000-00000000000a','QA monitor empresa A','11222333000181'),
 ('f8000000-0000-4000-8000-00000000001b','f8000000-0000-4000-8000-00000000000a','QA monitor empresa B','22333444000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f8000000-0000-4000-8000-00000000000a','f8000000-0000-4000-8000-000000000001','gestor',null),
 ('f8000000-0000-4000-8000-00000000000a','f8000000-0000-4000-8000-000000000002','operador','f8000000-0000-4000-8000-00000000001b'),
 ('f8000000-0000-4000-8000-00000000000b','f8000000-0000-4000-8000-000000000003','gestor',null);
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,origem_externa_id,status) values
 ('f8000000-0000-4000-8000-000000000021','f8000000-0000-4000-8000-00000000000a','f8000000-0000-4000-8000-00000000001a','QA A','11222333000181-1-000001/2026','triagem');

-- O robô (service_role) grava; a mesma chave não duplica.
set local role service_role;
insert into public.operacao_monitor_processos(processo_id,organizacao_id,empresa_id,numero_controle_pncp,situacao) values
 ('f8000000-0000-4000-8000-000000000021','f8000000-0000-4000-8000-00000000000a','f8000000-0000-4000-8000-00000000001a','11222333000181-1-000001/2026','Divulgada no PNCP');
insert into public.operacao_monitor_mudancas(organizacao_id,empresa_id,processo_id,chave,tipo,resumo,fonte) values
 ('f8000000-0000-4000-8000-00000000000a','f8000000-0000-4000-8000-00000000001a','f8000000-0000-4000-8000-000000000021','situacao|x','situacao','A situação mudou.','pncp');
insert into public.operacao_monitor_mudancas(organizacao_id,empresa_id,processo_id,chave,tipo,resumo,fonte) values
 ('f8000000-0000-4000-8000-00000000000a','f8000000-0000-4000-8000-00000000001a','f8000000-0000-4000-8000-000000000021','situacao|x','situacao','De novo.','pncp')
 on conflict (processo_id,chave) do nothing;
do $$ begin
 if (select count(*) from public.operacao_monitor_mudancas where processo_id='f8000000-0000-4000-8000-000000000021')<>1 then raise exception 'Chave duplicou';end if;
 begin insert into public.operacao_monitor_mudancas(organizacao_id,empresa_id,processo_id,chave,tipo,resumo,fonte) values
  ('f8000000-0000-4000-8000-00000000000a','f8000000-0000-4000-8000-00000000001b','f8000000-0000-4000-8000-000000000021','y','situacao','x','pncp');
  raise exception 'Empresa trocada aceita'; exception when foreign_key_violation then null; end;
 begin insert into public.operacao_monitor_mudancas(organizacao_id,empresa_id,processo_id,chave,tipo,resumo,fonte) values
  ('f8000000-0000-4000-8000-00000000000a','f8000000-0000-4000-8000-00000000001a','f8000000-0000-4000-8000-000000000021','z','inventado','x','pncp');
  raise exception 'Tipo inválido aceito'; exception when check_violation then null; end;
end $$;

-- Gestor lê; não escreve.
set local role authenticated;
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.operacao_monitor_mudancas)<>1 or (select count(*) from public.operacao_monitor_processos)<>1 then raise exception 'Gestor não leu';end if;
 begin update public.operacao_monitor_mudancas set avisado_em=now(); raise exception 'Usuário reservou e-mail'; exception when insufficient_privilege then null; end;
 begin insert into public.operacao_monitor_processos(processo_id,organizacao_id,empresa_id) values
  ('f8000000-0000-4000-8000-000000000021','f8000000-0000-4000-8000-00000000000a','f8000000-0000-4000-8000-00000000001a');
  raise exception 'Usuário inseriu monitor'; exception when insufficient_privilege then null; end;
end $$;
-- Operador restrito à empresa B e gestor de outra org não leem a A.
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000002',true);
do $$ begin if exists(select 1 from public.operacao_monitor_mudancas) or exists(select 1 from public.operacao_monitor_processos) then raise exception 'Operador da B leu a A';end if; end $$;
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000003',true);
do $$ begin if exists(select 1 from public.operacao_monitor_mudancas) then raise exception 'Outra org leu';end if; end $$;
set local role anon;
do $$ begin
 begin perform 1 from public.operacao_monitor_mudancas; raise exception 'anon leu'; exception when insufficient_privilege then null; end;
 raise notice 'testar_monitor_edital: ok';
end $$;
rollback;
