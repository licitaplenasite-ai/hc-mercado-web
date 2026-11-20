-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Banco local (ambiente-teste) com ia_conversas.sql aplicado. Fixtures e rollback.
-- RLS simulada com "set local role" + request.jwt.claim.sub: A grava e lê só o seu; B não vê, não apaga e não grava
-- em nome de A; ninguém edita; CPF é recusado; empresa de outra organização é recusada; chat-ia está no recurso ia.
begin;
insert into auth.users(id,email) values
 ('fa000000-0000-4000-8000-000000000001','chat-a@qa.invalid'),('fa000000-0000-4000-8000-000000000002','chat-b@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('fa000000-0000-4000-8000-000000000001','QA chat A','chat-a@qa.invalid','aprovado'),('fa000000-0000-4000-8000-000000000002','QA chat B','chat-b@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('fa000000-0000-4000-8000-0000000000a1','Org QA chat A','fa000000-0000-4000-8000-000000000001'),
 ('fa000000-0000-4000-8000-0000000000b1','Org QA chat B','fa000000-0000-4000-8000-000000000002');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('fa000000-0000-4000-8000-0000000000a2','fa000000-0000-4000-8000-0000000000a1','Empresa QA chat A','11222333000181'),
 ('fa000000-0000-4000-8000-0000000000b2','fa000000-0000-4000-8000-0000000000b1','Empresa QA chat B','11444777000161');
insert into public.operacao_membros(organizacao_id,usuario_id,papel) values
 ('fa000000-0000-4000-8000-0000000000a1','fa000000-0000-4000-8000-000000000001','gestor'),
 ('fa000000-0000-4000-8000-0000000000b1','fa000000-0000-4000-8000-000000000002','gestor');

do $$ begin
  if not exists (select 1 from public.recursos_plano where codigo = 'ia' and 'chat-ia' = any (funcoes)) then raise exception 'chat-ia fora do recurso ia'; end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'fa000000-0000-4000-8000-000000000001';
insert into public.ia_conversas(conversa_id,empresa_id,pergunta,resposta) values
 ('fa000000-0000-4000-8000-0000000000c1','fa000000-0000-4000-8000-0000000000a2','Qual o prazo do recurso?','3 dias úteis.');
do $$ begin
  insert into public.ia_conversas(conversa_id,empresa_id,pergunta,resposta) values
   ('fa000000-0000-4000-8000-0000000000c1','fa000000-0000-4000-8000-0000000000b2','x?','y');
  raise exception 'Gravou com empresa de outra organização';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.ia_conversas(usuario_id,conversa_id,pergunta,resposta) values
   ('fa000000-0000-4000-8000-000000000002','fa000000-0000-4000-8000-0000000000c1','x?','y');
  raise exception 'Gravou em nome de outro usuário';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.ia_conversas(conversa_id,pergunta,resposta) values ('fa000000-0000-4000-8000-0000000000c1','Meu CPF é 123.456.789-09','ok');
  raise exception 'CPF aceito';
exception when check_violation then null; end $$;
do $$ begin
  update public.ia_conversas set resposta = 'editada';
  raise exception 'Usuário editou o histórico';
exception when insufficient_privilege then null; end $$;
do $$ begin if (select count(*) from public.ia_conversas) <> 1 then raise exception 'A não vê o próprio histórico'; end if; end $$;
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'fa000000-0000-4000-8000-000000000002';
do $$ begin if exists (select 1 from public.ia_conversas) then raise exception 'B vê histórico de A'; end if; end $$;
delete from public.ia_conversas;
reset role;
do $$ begin if (select count(*) from public.ia_conversas where usuario_id = 'fa000000-0000-4000-8000-000000000001') <> 1 then raise exception 'B apagou histórico de A'; end if; end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'fa000000-0000-4000-8000-000000000001';
delete from public.ia_conversas;
reset role;
do $$ begin if exists (select 1 from public.ia_conversas where usuario_id = 'fa000000-0000-4000-8000-000000000001') then raise exception 'A não apagou o próprio histórico'; end if; end $$;

set local role anon;
do $$ begin
  perform 1 from public.ia_conversas;
  raise exception 'anon leu ia_conversas';
exception when insufficient_privilege then null; end $$;
reset role;
select 'testar_ia_conversas: ok';
rollback;
