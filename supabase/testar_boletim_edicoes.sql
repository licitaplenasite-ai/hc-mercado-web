-- Teste de boletim_edicoes.sql. Dados fictícios e rollback. Papéis com "set local role".
begin;
insert into auth.users(id,email) values ('00000000-0000-4000-8000-0000000bb001','a@example.invalid'),('00000000-0000-4000-8000-0000000bb002','b@example.invalid');
do $$
declare a uuid := '00000000-0000-4000-8000-0000000bb001'; b uuid := '00000000-0000-4000-8000-0000000bb002';
begin
  insert into public.boletim_edicoes(cliente_id, edicao, empresa, quantidade, numeros) values (a, '2026-11-19', 'Empresa A', 2, '{x1,x2}'), (b, '2026-11-19', 'Empresa B', 1, '{y1}');
  begin insert into public.boletim_edicoes(cliente_id, edicao) values (a, '2026-11-19'); raise exception 'edição repetida aceita';
  exception when unique_violation then null; end;
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  if (select count(*) from public.boletim_edicoes) <> 1 or (select empresa from public.boletim_edicoes) <> 'Empresa A' then raise exception 'vazou entre contas'; end if;
  begin insert into public.boletim_edicoes(cliente_id, edicao) values (a, '2026-11-20'); raise exception 'cliente gravou edição';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform 1 from public.boletim_edicoes; raise exception 'anon leu';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
rollback;
