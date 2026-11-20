-- Teste de documentos_pastas.sql. Dados fictícios e rollback. Papéis com "set local role"; não prova a API HTTP.
-- G gestor da org (2 empresas), O operador só da empresa 1, X de outra organização.
begin;
insert into auth.users(id,email) values
 ('d0c00000-0000-4000-8000-000000000001','dp-g@qa.invalid'),('d0c00000-0000-4000-8000-000000000002','dp-o@qa.invalid'),
 ('d0c00000-0000-4000-8000-000000000003','dp-x@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('d0c00000-0000-4000-8000-000000000001','QA dp G','dp-g@qa.invalid','aprovado'),
 ('d0c00000-0000-4000-8000-000000000002','QA dp O','dp-o@qa.invalid','aprovado'),
 ('d0c00000-0000-4000-8000-000000000003','QA dp X','dp-x@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('d0c00000-0000-4000-8000-00000000000a','QA dp org','d0c00000-0000-4000-8000-000000000001'),
 ('d0c00000-0000-4000-8000-00000000000b','QA dp outra','d0c00000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('d0c00000-0000-4000-8000-00000000001a','d0c00000-0000-4000-8000-00000000000a','QA DP UM','11222333000181'),
 ('d0c00000-0000-4000-8000-00000000002a','d0c00000-0000-4000-8000-00000000000a','QA DP DOIS','11444777000161'),
 ('d0c00000-0000-4000-8000-00000000003a','d0c00000-0000-4000-8000-00000000000b','QA DP OUTRA','33000167000101');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('d0c00000-0000-4000-8000-00000000000a','d0c00000-0000-4000-8000-000000000001','gestor',null),
 ('d0c00000-0000-4000-8000-00000000000a','d0c00000-0000-4000-8000-000000000002','operador','d0c00000-0000-4000-8000-00000000001a'),
 ('d0c00000-0000-4000-8000-00000000000b','d0c00000-0000-4000-8000-000000000003','gestor',null)
 on conflict do nothing;
insert into public.operacao_documentos(id,organizacao_id,empresa_id,tipo) values
 ('d0c00000-0000-4000-8000-0000000000d1','d0c00000-0000-4000-8000-00000000000a','d0c00000-0000-4000-8000-00000000001a','CND Federal'),
 ('d0c00000-0000-4000-8000-0000000000d2','d0c00000-0000-4000-8000-00000000000a','d0c00000-0000-4000-8000-00000000002a','Contrato social'),
 ('d0c00000-0000-4000-8000-0000000000d3','d0c00000-0000-4000-8000-00000000000b','d0c00000-0000-4000-8000-00000000003a','CNDT');
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto) values
 ('d0c00000-0000-4000-8000-0000000000f1','d0c00000-0000-4000-8000-00000000000a','d0c00000-0000-4000-8000-00000000001a','QA processo 1');
do $$
declare g uuid := 'd0c00000-0000-4000-8000-000000000001'; o uuid := 'd0c00000-0000-4000-8000-000000000002'; x uuid := 'd0c00000-0000-4000-8000-000000000003';
  d1 uuid := 'd0c00000-0000-4000-8000-0000000000d1'; d2 uuid := 'd0c00000-0000-4000-8000-0000000000d2'; d3 uuid := 'd0c00000-0000-4000-8000-0000000000d3';
  p1 uuid := 'd0c00000-0000-4000-8000-0000000000f1'; outra uuid := 'd0c00000-0000-4000-8000-00000000000b'; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  -- Gestor: pasta nos documentos das 2 empresas; organização/empresa vêm do documento, não do que a tela manda.
  insert into public.operacao_documento_pastas(documento_id, organizacao_id, empresa_id, pasta) values (d1, outra, outra, '  Fiscal ');
  insert into public.operacao_documento_pastas(documento_id, organizacao_id, empresa_id, pasta) values (d2, outra, outra, 'Jurídica');
  if (select pasta || '|' || empresa_id from public.operacao_documento_pastas where documento_id = d1) <> 'Fiscal|d0c00000-0000-4000-8000-00000000001a' then raise exception 'pasta/escopo errado'; end if;
  begin insert into public.operacao_documento_pastas(documento_id, organizacao_id, empresa_id, pasta) values (d3, outra, outra, 'X'); raise exception 'pasta em documento de outra organização';
  exception when check_violation or insufficient_privilege then null; end;
  begin update public.operacao_documento_pastas set pasta = 'a/b' where documento_id = d1; raise exception 'pasta com barra aceita';
  exception when check_violation then null; end;
  -- Documento escolhido no processo: só da mesma empresa do processo.
  insert into public.operacao_processo_documentos(processo_id, documento_id, organizacao_id, empresa_id) values (p1, d1, outra, outra);
  begin insert into public.operacao_processo_documentos(processo_id, documento_id, organizacao_id, empresa_id) values (p1, d2, outra, outra); raise exception 'documento de outra empresa no processo';
  exception when check_violation then null; end;
  begin insert into public.operacao_processo_documentos(processo_id, documento_id, organizacao_id, empresa_id) values (p1, d3, outra, outra); raise exception 'documento de outra organização no processo';
  exception when check_violation or insufficient_privilege then null; end;
  -- Operador só da empresa 1: vê a pasta e o vínculo dela, não a da empresa 2.
  perform set_config('request.jwt.claim.sub', o::text, true);
  select count(*) into n from public.operacao_documento_pastas;
  if n <> 1 then raise exception 'operador viu % pastas (esperado 1)', n; end if;
  update public.operacao_documento_pastas set pasta = 'Outra' where documento_id = d2; get diagnostics n = row_count;
  if n <> 0 then raise exception 'operador mudou pasta de empresa sem acesso'; end if;
  if (select count(*) from public.operacao_processo_documentos) <> 1 then raise exception 'operador não vê o documento do processo'; end if;
  -- Outra organização não vê nada.
  perform set_config('request.jwt.claim.sub', x::text, true);
  if (select count(*) from public.operacao_documento_pastas) + (select count(*) from public.operacao_processo_documentos) <> 0 then raise exception 'vazou entre organizações'; end if;
  reset role;
  set local role anon;
  begin perform 1 from public.operacao_processo_documentos; raise exception 'anon leu';
  exception when insufficient_privilege then null; end;
  reset role;
  -- Documento apagado leva junto pasta e vínculo.
  delete from public.operacao_documentos where id = d1;
  if exists (select 1 from public.operacao_processo_documentos where documento_id = d1) or exists (select 1 from public.operacao_documento_pastas where documento_id = d1) then raise exception 'sobrou vínculo de documento apagado'; end if;
end $$;
select 'testar_documentos_pastas: ok';
rollback;
