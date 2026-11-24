-- Teste de funil_previsao.sql. Fixtures sintéticas e rollback (nada fica no banco).
-- RLS simulada com "set local role authenticated" + request.jwt.claim.sub; não prova a API HTTP.
-- Org A: operador f2..01, leitura f2..02. Org B: gestor f2..03.
begin;
insert into auth.users(id,email) values
 ('f2000000-0000-4000-8000-000000000001','prev-o@qa.invalid'),('f2000000-0000-4000-8000-000000000002','prev-l@qa.invalid'),
 ('f2000000-0000-4000-8000-000000000003','prev-b@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f2000000-0000-4000-8000-000000000001','QA prev O','prev-o@qa.invalid','aprovado'),
 ('f2000000-0000-4000-8000-000000000002','QA prev L','prev-l@qa.invalid','aprovado'),
 ('f2000000-0000-4000-8000-000000000003','QA prev B','prev-b@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f2000000-0000-4000-8000-00000000000a','QA prev org A','f2000000-0000-4000-8000-000000000001'),
 ('f2000000-0000-4000-8000-00000000000b','QA prev org B','f2000000-0000-4000-8000-000000000003');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f2000000-0000-4000-8000-00000000000a','f2000000-0000-4000-8000-000000000001','operador',null),
 ('f2000000-0000-4000-8000-00000000000a','f2000000-0000-4000-8000-000000000002','leitura',null),
 ('f2000000-0000-4000-8000-00000000000b','f2000000-0000-4000-8000-000000000003','gestor',null);
insert into public.operacao_funil_etapas(id,organizacao_id,nome,ordem,status_sistema,chave_sistema) values
 ('f2000000-0000-4000-8000-00000000001a','f2000000-0000-4000-8000-00000000000a','Participando',1,'preparacao','participando'),
 ('f2000000-0000-4000-8000-00000000002a','f2000000-0000-4000-8000-00000000000a','Habilitação',2,'habilitacao',null);

set local role authenticated;
do $$
declare sis uuid:='f2000000-0000-4000-8000-00000000001a'; pers uuid:='f2000000-0000-4000-8000-00000000002a'; n int; v smallint;
begin
 -- Operador grava a chance na etapa do sistema e na personalizada; vazio volta ao padrão.
 perform set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000001',true);
 update public.operacao_funil_etapas set probabilidade=25 where id=sis;
 update public.operacao_funil_etapas set probabilidade=70 where id=pers;
 select probabilidade into v from public.operacao_funil_etapas where id=sis;
 if v is distinct from 25::smallint then raise exception 'Operador não gravou a chance da etapa do sistema'; end if;
 update public.operacao_funil_etapas set probabilidade=null where id=pers;
 select probabilidade into v from public.operacao_funil_etapas where id=pers;
 if v is not null then raise exception 'Chance vazia não voltou ao padrão'; end if;
 update public.operacao_funil_etapas set probabilidade=0 where id=pers;
 update public.operacao_funil_etapas set probabilidade=100 where id=pers;
 -- Fora de 0 a 100: recusado.
 begin update public.operacao_funil_etapas set probabilidade=101 where id=pers; raise exception 'Chance 101 aceita';
 exception when check_violation then null; end;
 begin update public.operacao_funil_etapas set probabilidade=-1 where id=pers; raise exception 'Chance negativa aceita';
 exception when check_violation then null; end;
 -- Leitura vê a chance, mas não altera.
 perform set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000002',true);
 select probabilidade into v from public.operacao_funil_etapas where id=sis;
 if v is distinct from 25::smallint then raise exception 'Leitura não vê a chance'; end if;
 update public.operacao_funil_etapas set probabilidade=90 where id=sis;
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'Leitura alterou a chance'; end if;
 -- Outra organização não vê nem altera.
 perform set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000003',true);
 select count(*) into n from public.operacao_funil_etapas where organizacao_id='f2000000-0000-4000-8000-00000000000a';
 if n <> 0 then raise exception 'Outra organização vê as etapas'; end if;
 update public.operacao_funil_etapas set probabilidade=90 where id=sis;
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'Outra organização alterou a chance'; end if;
end $$;
reset role;
rollback;
