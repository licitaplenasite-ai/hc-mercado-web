-- Teste de boletim_por_empresa.sql. Dados fictícios e rollback. Papéis com "set local role"; não prova a API HTTP.
-- G gestor da org (vê as 2 empresas), O operador só da empresa 1, X de outra organização.
begin;
insert into auth.users(id,email) values
 ('b0e00000-0000-4000-8000-000000000001','be-g@qa.invalid'),('b0e00000-0000-4000-8000-000000000002','be-o@qa.invalid'),
 ('b0e00000-0000-4000-8000-000000000003','be-x@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('b0e00000-0000-4000-8000-000000000001','QA be G','be-g@qa.invalid','aprovado'),
 ('b0e00000-0000-4000-8000-000000000002','QA be O','be-o@qa.invalid','aprovado'),
 ('b0e00000-0000-4000-8000-000000000003','QA be X','be-x@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('b0e00000-0000-4000-8000-00000000000a','QA be org','b0e00000-0000-4000-8000-000000000001'),
 ('b0e00000-0000-4000-8000-00000000000b','QA be outra','b0e00000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('b0e00000-0000-4000-8000-00000000001a','b0e00000-0000-4000-8000-00000000000a','QA HCM','11222333000181'),
 ('b0e00000-0000-4000-8000-00000000002a','b0e00000-0000-4000-8000-00000000000a','QA RYMO','11444777000161'),
 ('b0e00000-0000-4000-8000-00000000003a','b0e00000-0000-4000-8000-00000000000b','QA outra','33000167000101');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('b0e00000-0000-4000-8000-00000000000a','b0e00000-0000-4000-8000-000000000001','gestor',null),
 ('b0e00000-0000-4000-8000-00000000000a','b0e00000-0000-4000-8000-000000000002','operador','b0e00000-0000-4000-8000-00000000001a'),
 ('b0e00000-0000-4000-8000-00000000000b','b0e00000-0000-4000-8000-000000000003','gestor',null)
 on conflict do nothing;
do $$
declare g uuid := 'b0e00000-0000-4000-8000-000000000001'; o uuid := 'b0e00000-0000-4000-8000-000000000002'; x uuid := 'b0e00000-0000-4000-8000-000000000003';
  org uuid := 'b0e00000-0000-4000-8000-00000000000a'; e1 uuid := 'b0e00000-0000-4000-8000-00000000001a'; e2 uuid := 'b0e00000-0000-4000-8000-00000000002a';
  e3 uuid := 'b0e00000-0000-4000-8000-00000000003a'; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  insert into public.boletim_filtros_empresa(empresa_id, organizacao_id, filtro) values (e1, org, '{"ufs":["AM"],"palavrasRaw":"limpeza"}');
  insert into public.boletim_filtros_empresa(empresa_id, organizacao_id, filtro) values (e2, org, '{"ufs":["SP"],"palavrasRaw":"café"}');
  if (select filtro->>'palavrasRaw' from public.boletim_filtros_empresa where empresa_id = e2) <> 'café' then raise exception 'filtro por empresa não separado'; end if;
  begin insert into public.boletim_filtros_empresa(empresa_id, organizacao_id, filtro) values (e3, org, '{"ufs":[],"palavrasRaw":"x"}'); raise exception 'empresa de outra org aceita';
  exception when check_violation or insufficient_privilege then null; end;
  begin insert into public.boletim_filtros_empresa(empresa_id, organizacao_id, filtro) values (e3, 'b0e00000-0000-4000-8000-00000000000b', '{"ufs":[],"palavrasRaw":"x"}'); raise exception 'gravou em empresa de outra organização';
  exception when check_violation or insufficient_privilege then null; end;
  begin update public.boletim_filtros_empresa set filtro = '{"ufs":[]}' where empresa_id = e1; raise exception 'filtro sem palavras aceito';
  exception when check_violation then null; end;
  -- Jornal de empresa: mesmo nome pode existir em empresas diferentes.
  insert into public.filtros_salvos(nome, filtro, empresa_id) values ('Jornal', '{}', e1), ('Jornal', '{}', e2), ('Jornal', '{}', null);
  begin insert into public.filtros_salvos(nome, filtro, empresa_id) values ('jornal ', '{}', e1); raise exception 'nome repetido na mesma empresa';
  exception when unique_violation then null; end;
  -- Operador restrito vê só a empresa 1 e não grava na 2.
  perform set_config('request.jwt.claim.sub', o::text, true);
  select count(*) into n from public.boletim_filtros_empresa;
  if n <> 1 then raise exception 'operador viu % filtros (esperado 1)', n; end if;
  update public.boletim_filtros_empresa set filtro = '{"ufs":["AM"],"palavrasRaw":"outra"}' where empresa_id = e2; get diagnostics n = row_count;
  if n <> 0 then raise exception 'operador alterou empresa sem acesso'; end if;
  begin insert into public.filtros_salvos(nome, filtro, empresa_id) values ('x', '{}', e2); raise exception 'jornal em empresa sem acesso';
  exception when insufficient_privilege then null; end;
  -- Outra organização não vê nada.
  perform set_config('request.jwt.claim.sub', x::text, true);
  if (select count(*) from public.boletim_filtros_empresa) <> 0 then raise exception 'vazou entre organizações'; end if;
  reset role;
  if (select cliente_id from public.boletim_filtros_empresa where empresa_id = e1) <> g then raise exception 'dono do e-mail errado'; end if;
  set local role anon;
  begin perform 1 from public.boletim_filtros_empresa; raise exception 'anon leu';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
rollback;
