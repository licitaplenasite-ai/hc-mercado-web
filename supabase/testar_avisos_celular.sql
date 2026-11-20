-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Banco local (ambiente-teste) com avisos_celular.sql aplicado. Fixtures e rollback.
-- RLS simulada com "set local role" + request.jwt.claim.sub: f9..01 só vê/apaga a própria inscrição; não grava direto.
begin;
insert into auth.users(id,email) values
 ('f9000000-0000-4000-8000-000000000001','avisos-a@qa.invalid'),('f9000000-0000-4000-8000-000000000002','avisos-b@qa.invalid');
set local role service_role;
insert into public.avisos_celular_inscricoes(usuario_id,endpoint,p256dh,auth) values
 ('f9000000-0000-4000-8000-000000000001','https://fcm.googleapis.com/fcm/send/qa-a',repeat('A',87),repeat('B',22)),
 ('f9000000-0000-4000-8000-000000000002','https://fcm.googleapis.com/fcm/send/qa-b',repeat('A',87),repeat('B',22));
insert into public.avisos_celular_enviados(usuario_id,chave) values ('f9000000-0000-4000-8000-000000000001','mud:x');
insert into public.avisos_celular_enviados(usuario_id,chave) values ('f9000000-0000-4000-8000-000000000001','mud:x') on conflict do nothing;
do $$ begin
 if (select count(*) from public.avisos_celular_enviados)<>1 then raise exception 'Reserva duplicou'; end if;
 begin insert into public.avisos_celular_inscricoes(usuario_id,endpoint,p256dh,auth) values
  ('f9000000-0000-4000-8000-000000000001','http://exemplo.invalid/x',repeat('A',87),repeat('B',22));
  raise exception 'Endpoint sem https aceito'; exception when check_violation then null; end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'f9000000-0000-4000-8000-000000000001';
do $$ begin
 if (select count(*) from public.avisos_celular_inscricoes)<>1 then raise exception 'Usuário vê inscrição de outro'; end if;
 if exists (select 1 from public.avisos_celular_enviados) then raise exception 'Usuário lê enviados'; end if;
exception when insufficient_privilege then null; end $$;
do $$ begin
 insert into public.avisos_celular_inscricoes(usuario_id,endpoint,p256dh,auth) values
  ('f9000000-0000-4000-8000-000000000001','https://fcm.googleapis.com/fcm/send/qa-c',repeat('A',87),repeat('B',22));
 raise exception 'Usuário gravou inscrição direto (deve passar pela rota)';
exception when insufficient_privilege then null; end $$;
do $$ begin
 insert into public.avisos_celular_preferencias(usuario_id) values ('f9000000-0000-4000-8000-000000000001');
 raise exception 'Usuário gravou preferência direto';
exception when insufficient_privilege then null; end $$;
delete from public.avisos_celular_inscricoes where endpoint like '%qa-b';
delete from public.avisos_celular_inscricoes where endpoint like '%qa-a';
reset role;
do $$ begin
 if (select count(*) from public.avisos_celular_inscricoes where endpoint like '%qa-b')<>1 then raise exception 'Usuário apagou inscrição de outro'; end if;
 if exists (select 1 from public.avisos_celular_inscricoes where endpoint like '%qa-a') then raise exception 'Usuário não apagou a própria'; end if;
 -- Aviso do boletim: coluna nova nasce ligada (preferência gravada antes dela continua recebendo).
 insert into public.avisos_celular_preferencias(usuario_id) values ('f9000000-0000-4000-8000-000000000001');
 if not (select boletim from public.avisos_celular_preferencias where usuario_id='f9000000-0000-4000-8000-000000000001') then raise exception 'boletim nasceu desligado'; end if;
end $$;
select 'testar_avisos_celular: ok';
rollback;
