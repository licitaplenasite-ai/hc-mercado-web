-- Teste de operacao_itens_entrega.sql. Fixtures sintéticas e rollback (nada fica no banco).
-- RLS simulada com "set local role authenticated" + request.jwt.claim.sub; não prova a API HTTP.
-- Org A: operador e9..01, leitura e9..02. Org B: gestor e9..03.
begin;
insert into auth.users(id,email) values
 ('e9000000-0000-4000-8000-000000000001','ent-o@qa.invalid'),('e9000000-0000-4000-8000-000000000002','ent-l@qa.invalid'),
 ('e9000000-0000-4000-8000-000000000003','ent-b@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('e9000000-0000-4000-8000-000000000001','QA ent O','ent-o@qa.invalid','aprovado'),
 ('e9000000-0000-4000-8000-000000000002','QA ent L','ent-l@qa.invalid','aprovado'),
 ('e9000000-0000-4000-8000-000000000003','QA ent B','ent-b@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('e9000000-0000-4000-8000-00000000000a','QA ent org A','e9000000-0000-4000-8000-000000000001'),
 ('e9000000-0000-4000-8000-00000000000b','QA ent org B','e9000000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('e9000000-0000-4000-8000-00000000001a','e9000000-0000-4000-8000-00000000000a','QA ent empresa A','11222333000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('e9000000-0000-4000-8000-00000000000a','e9000000-0000-4000-8000-000000000001','operador',null),
 ('e9000000-0000-4000-8000-00000000000a','e9000000-0000-4000-8000-000000000002','leitura',null),
 ('e9000000-0000-4000-8000-00000000000b','e9000000-0000-4000-8000-000000000003','gestor',null);
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,numero) values
 ('e9000000-0000-4000-8000-00000000002a','e9000000-0000-4000-8000-00000000000a','e9000000-0000-4000-8000-00000000001a','QA fictício','QA-ENT');
insert into public.operacao_itens_resultado(id,organizacao_id,processo_id,tipo,identificador,situacao) values
 ('e9000000-0000-4000-8000-00000000003a','e9000000-0000-4000-8000-00000000000a','e9000000-0000-4000-8000-00000000002a','item','1','ganho');

set local role authenticated;
do $$
declare it uuid:='e9000000-0000-4000-8000-00000000003a'; n int; r public.operacao_itens_resultado;
begin
 -- Operador grava o passo, a data e o rastreio.
 perform set_config('request.jwt.claim.sub','e9000000-0000-4000-8000-000000000001',true);
 update public.operacao_itens_resultado set entrega_situacao='enviado',comprado_em='2026-11-20',enviado_em='2026-11-21',rastreio='https://rastreio.exemplo/AA123' where id=it;
 select * into r from public.operacao_itens_resultado where id=it;
 if r.entrega_situacao is distinct from 'enviado' or r.enviado_em is distinct from date '2026-11-21' then raise exception 'Operador não gravou o andamento'; end if;
 -- Passo fora da lista e rastreio vazio: recusados.
 begin update public.operacao_itens_resultado set entrega_situacao='perdido' where id=it; raise exception 'Passo inválido aceito';
 exception when check_violation then null; end;
 begin update public.operacao_itens_resultado set rastreio='  ' where id=it; raise exception 'Rastreio vazio aceito';
 exception when check_violation then null; end;
 -- Leitura vê, mas não altera.
 perform set_config('request.jwt.claim.sub','e9000000-0000-4000-8000-000000000002',true);
 select count(*) into n from public.operacao_itens_resultado where id=it;
 if n<>1 then raise exception 'Leitura não vê o item'; end if;
 update public.operacao_itens_resultado set entrega_situacao='entregue' where id=it;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Leitura alterou o andamento'; end if;
 -- Outra organização nem vê nem altera.
 perform set_config('request.jwt.claim.sub','e9000000-0000-4000-8000-000000000003',true);
 select count(*) into n from public.operacao_itens_resultado where id=it;
 if n<>0 then raise exception 'Outra organização viu o item'; end if;
 update public.operacao_itens_resultado set entrega_situacao='entregue' where id=it;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Outra organização alterou o andamento'; end if;
 raise notice 'testar_itens_entrega: ok';
end $$;
rollback;
