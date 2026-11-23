-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Banco local/clone com operacao_licitacoes.sql, acesso_empresa_convites.sql,
-- identificacao_empresa.sql, seguranca_operacao.sql e empresa_editar.sql aplicados. Fixtures sintéticas e rollback no fim.
-- RLS simulada com "set local role authenticated" + request.jwt.claim.sub.
-- Gestor A f6..01, operador A f6..02, leitura A f6..04, gestor B (outra org) f6..03.
begin;
insert into auth.users(id,email) values
 ('f6000000-0000-4000-8000-000000000001','ed-a@qa.invalid'),('f6000000-0000-4000-8000-000000000002','ed-o@qa.invalid'),
 ('f6000000-0000-4000-8000-000000000003','ed-b@qa.invalid'),('f6000000-0000-4000-8000-000000000004','ed-l@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f6000000-0000-4000-8000-000000000001','QA ed A','ed-a@qa.invalid','aprovado'),
 ('f6000000-0000-4000-8000-000000000002','QA ed O','ed-o@qa.invalid','aprovado'),
 ('f6000000-0000-4000-8000-000000000003','QA ed B','ed-b@qa.invalid','aprovado'),
 ('f6000000-0000-4000-8000-000000000004','QA ed L','ed-l@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f6000000-0000-4000-8000-00000000000a','QA ed A','f6000000-0000-4000-8000-000000000001'),
 ('f6000000-0000-4000-8000-00000000000b','QA ed B','f6000000-0000-4000-8000-000000000003');
-- CNPJ de 13 dígitos (o caso real: faltava um zero; o certo é 01222333000128) gravado como veio do cadastro antigo.
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000000a','QA ed empresa A','1222333000128'),
 ('f6000000-0000-4000-8000-00000000002a','f6000000-0000-4000-8000-00000000000a','QA ed empresa A2','11222333000181'),
 ('f6000000-0000-4000-8000-00000000001b','f6000000-0000-4000-8000-00000000000b','QA ed empresa B','52222333000169');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-000000000001','gestor',null),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-000000000002','operador',null),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-000000000004','leitura',null),
 ('f6000000-0000-4000-8000-00000000000b','f6000000-0000-4000-8000-000000000003','gestor',null);
insert into public.operacao_identificacao_empresa(empresa_id,organizacao_id,dados_confirmados,confirmado_por) values
 ('f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000000a','{"endereco":"Rua QA, 1","representante":"Pessoa QA","cargo":"Sócia"}','f6000000-0000-4000-8000-000000000001');

do $$ begin
 if not public.cnpj_valido('11222333000181') or public.cnpj_valido('11222333000182') or public.cnpj_valido('1222333000128') or not public.cnpj_valido('01222333000128')
   or public.cnpj_valido('11111111111111') or public.cnpj_valido(null) or public.cnpj_valido('11.222.333/0001-81') then raise exception 'cnpj_valido errado'; end if;
end $$;

set local role authenticated;
-- Operador: a RLS deixa gravar, a guarda recusa razão social/CNPJ; o responsável continua livre.
select set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000002',true);
do $$ declare n int; begin
 begin update public.operacao_empresas set cnpj='01222333000128' where id='f6000000-0000-4000-8000-00000000001a'; raise exception 'Operador corrigiu CNPJ'; exception when insufficient_privilege then null; end;
 begin update public.operacao_empresas set razao_social='Outra' where id='f6000000-0000-4000-8000-00000000001a'; raise exception 'Operador corrigiu razão'; exception when insufficient_privilege then null; end;
 update public.operacao_empresas set responsavel='Resp QA' where id='f6000000-0000-4000-8000-00000000001a'; get diagnostics n=row_count;
 if n<>1 then raise exception 'Operador não gravou o responsável'; end if;
end $$;

-- Leitura e gestor de outra org: a RLS nem enxerga a linha para gravar.
select set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000004',true);
do $$ declare n int; begin
 update public.operacao_empresas set cnpj='01222333000128' where id='f6000000-0000-4000-8000-00000000001a'; get diagnostics n=row_count;
 if n<>0 then raise exception 'Leitura corrigiu CNPJ'; end if;
end $$;
select set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000003',true);
do $$ declare n int; begin
 update public.operacao_empresas set cnpj='01222333000128' where id='f6000000-0000-4000-8000-00000000001a'; get diagnostics n=row_count;
 if n<>0 then raise exception 'Gestor B corrigiu CNPJ de A'; end if;
end $$;

-- Gestor A: CNPJ com dígito errado ou 13 dígitos é recusado; o certo grava só dígitos e invalida a identificação.
select set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000001',true);
do $$ declare n int; begin
 begin update public.operacao_empresas set cnpj='01222333000129' where id='f6000000-0000-4000-8000-00000000001a'; raise exception 'DV errado aceito'; exception when invalid_parameter_value then null; end;
 begin update public.operacao_empresas set cnpj=' 1222333000130' where id='f6000000-0000-4000-8000-00000000001a'; raise exception '13 dígitos aceito'; exception when invalid_parameter_value then null; end;
 begin update public.operacao_empresas set cnpj=null where id='f6000000-0000-4000-8000-00000000001a'; raise exception 'CNPJ vazio aceito'; exception when invalid_parameter_value then null; end;
 begin update public.operacao_empresas set razao_social='   ' where id='f6000000-0000-4000-8000-00000000001a'; raise exception 'Razão vazia aceita'; exception when invalid_parameter_value then null; end;
 if (select invalidado_em from public.operacao_identificacao_empresa where empresa_id='f6000000-0000-4000-8000-00000000001a') is not null then raise exception 'Tentativa recusada invalidou'; end if;
 update public.operacao_empresas set cnpj='01.222.333/0001-28', razao_social='  QA ed empresa A Ltda ' where id='f6000000-0000-4000-8000-00000000001a'; get diagnostics n=row_count;
 if n<>1 then raise exception 'Gestor não corrigiu'; end if;
 if (select cnpj||'|'||razao_social from public.operacao_empresas where id='f6000000-0000-4000-8000-00000000001a')<>'01222333000128|QA ed empresa A Ltda' then raise exception 'Não normalizou'; end if;
 if (select invalidado_em from public.operacao_identificacao_empresa where empresa_id='f6000000-0000-4000-8000-00000000001a') is null then raise exception 'Identificação não invalidada'; end if;
 -- Os dados anteriores continuam guardados para a tela pré-preencher.
 if (select dados_confirmados->>'representante' from public.operacao_identificacao_empresa where empresa_id='f6000000-0000-4000-8000-00000000001a')<>'Pessoa QA' then raise exception 'Dados anteriores perdidos'; end if;
 -- CNPJ de outra empresa da mesma conta: o índice único recusa.
 begin update public.operacao_empresas set cnpj='11222333000181' where id='f6000000-0000-4000-8000-00000000001a'; raise exception 'CNPJ repetido aceito'; exception when unique_violation then null; end;
end $$;

reset role;
select set_config('request.jwt.claim.sub','',true);
-- Chave de serviço / SQL Editor (sem auth.uid()): correção administrativa passa.
do $$ begin
 update public.operacao_empresas set cnpj='1222333000128' where id='f6000000-0000-4000-8000-00000000001a';
 if has_function_privilege('authenticated','public.operacao_empresas_guarda_cadastro()','EXECUTE') then raise exception 'Função do gatilho executável'; end if;
 if has_function_privilege('anon','public.cnpj_valido(text)','EXECUTE') then raise exception 'cnpj_valido aberto ao anon'; end if;
end $$;
select 'testar_empresa_editar: ok';
rollback;
