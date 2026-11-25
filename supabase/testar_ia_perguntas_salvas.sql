-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Banco local (ambiente-teste) com ia_perguntas_salvas.sql aplicado. Fixtures e rollback.
-- RLS simulada com "set local role" + request.jwt.claim.sub: A grava e lê só as suas; B não vê, não apaga e não grava
-- em nome de A; ninguém edita; CPF e repetida são recusados. (A mesma prova roda no npm test: scripts/ia_perguntas_salvas_sql.test.js.)
begin;
insert into auth.users(id,email) values
 ('fb000000-0000-4000-8000-000000000001','plena-a@qa.invalid'),('fb000000-0000-4000-8000-000000000002','plena-b@qa.invalid');

set local role authenticated;
set local request.jwt.claim.sub = 'fb000000-0000-4000-8000-000000000001';
insert into public.ia_perguntas_salvas(texto) values ('Qual a garantia contratual?');
do $$ begin
  insert into public.ia_perguntas_salvas(texto) values ('CPF 123.456.789-09');
  raise exception 'Gravou CPF';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.ia_perguntas_salvas(texto) values ('Qual a garantia contratual?');
  raise exception 'Gravou pergunta repetida';
exception when unique_violation then null; end $$;
do $$ begin
  update public.ia_perguntas_salvas set texto = 'mudou';
  raise exception 'Editou pergunta salva';
exception when insufficient_privilege then null; end $$;

set local request.jwt.claim.sub = 'fb000000-0000-4000-8000-000000000002';
do $$ begin
  if exists (select 1 from public.ia_perguntas_salvas) then raise exception 'B viu a pergunta de A'; end if;
  insert into public.ia_perguntas_salvas(usuario_id,texto) values ('fb000000-0000-4000-8000-000000000001','Falsa em nome de A');
  raise exception 'B gravou em nome de A';
exception when insufficient_privilege then null; end $$;
delete from public.ia_perguntas_salvas;

reset role;
do $$ begin
  if (select count(*) from public.ia_perguntas_salvas where usuario_id = 'fb000000-0000-4000-8000-000000000001') <> 1 then raise exception 'B apagou a pergunta de A'; end if;
end $$;
rollback;
