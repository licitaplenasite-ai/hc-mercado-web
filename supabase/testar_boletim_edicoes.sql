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

-- Número da edição: único, automático e o mesmo quando a rodada seguinte do dia atualiza a linha.
do $$
declare a uuid := '00000000-0000-4000-8000-0000000bb001'; n1 bigint; n2 bigint; n3 bigint;
begin
  select numero into n1 from public.boletim_edicoes where cliente_id = a and edicao = '2026-11-19';
  select numero into n2 from public.boletim_edicoes where cliente_id <> a and edicao = '2026-11-19';
  if n1 is null or n2 is null or n1 = n2 then raise exception 'edição sem número próprio'; end if;
  insert into public.boletim_edicoes(cliente_id, edicao, quantidade) values (a, '2026-11-19', 5)
    on conflict (cliente_id, edicao, filtro_id) do update set quantidade = excluded.quantidade;
  select numero into n3 from public.boletim_edicoes where cliente_id = a and edicao = '2026-11-19';
  if n3 <> n1 then raise exception 'rodada do mesmo dia trocou o número da edição'; end if;
  begin insert into public.boletim_edicoes(cliente_id, edicao, filtro_id, numero) values (a, '2026-11-20', 'x', n2);
    raise exception 'número de edição repetido aceito';
  exception when unique_violation then null; end;
end $$;

-- Código do cliente: dado pelo banco no cadastro, fixo depois (nem o próprio cliente nem o admin mudam).
do $$
declare c1 uuid := '00000000-0000-4000-8000-0000000bb003'; c2 uuid := '00000000-0000-4000-8000-0000000bb004'; k1 bigint; k2 bigint;
begin
  insert into auth.users(id, email) values (c1, 'c1@example.invalid'), (c2, 'c2@example.invalid');
  insert into public.clientes(id, nome, email, codigo) values (c1, 'QA código 1', 'c1@example.invalid', 1);
  insert into public.clientes(id, nome, email) values (c2, 'QA código 2', 'c2@example.invalid');
  select codigo into k1 from public.clientes where id = c1;
  select codigo into k2 from public.clientes where id = c2;
  if k1 is null or k1 = 1 or k2 is null or k2 = k1 then raise exception 'código do cliente não veio da sequência: % %', k1, k2; end if;
  update public.clientes set codigo = 7, nome = 'QA código 1b' where id = c1;
  if (select codigo from public.clientes where id = c1) <> k1 then raise exception 'código do cliente mudou no update'; end if;
  perform set_config('request.jwt.claim.sub', c1::text, true);
  set local role authenticated;
  begin update public.clientes set codigo = 9 where id = c1;
  exception when insufficient_privilege then null; end;
  reset role;
  if (select codigo from public.clientes where id = c1) <> k1 then raise exception 'cliente trocou o próprio código'; end if;
end $$;
rollback;
