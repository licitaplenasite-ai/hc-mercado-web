-- Teste de analise_cnpj_v3.sql. Fixtures sintéticas e rollback (nada fica no banco).
-- RLS simulada com "set local role" e request.jwt.claim.sub; não prova a API HTTP.
begin;
insert into public.historico_compras(id_compra, plataforma) values ('15814205000232022', 'ComprasNet (antigo)');
insert into public.historico_itens(id_compra, numero_item, motivo_situacao, situacao_item) values
 ('15814205000232022', 1, 'Fornecedor não enviou a documentação de habilitação', 'Cancelado no julgamento'),
 ('15814205000232022', 2, null, 'Homologado');
insert into public.historico_participacoes(id_compra, numero_item, fornecedor_chave, fornecedor_ni, marca_declarada) values
 ('15814205000232022', 1, '12345678000195', '12345678000195', null),
 ('15814205000232022', 2, '12345678000195', '12345678000195', 'MELITTA'),
 ('15814205000232022', 1, '11444777000161', '11444777000161', null);

insert into auth.users(id,email) values ('c9300000-0000-4000-8000-000000000001','acn3-a@qa.invalid'),('c9300000-0000-4000-8000-000000000002','acn3-p@qa.invalid');
insert into public.clientes(id,nome,email,status) values ('c9300000-0000-4000-8000-000000000001','QA acn3 A','acn3-a@qa.invalid','aprovado'),('c9300000-0000-4000-8000-000000000002','QA acn3 P','acn3-p@qa.invalid','pendente');
set local role authenticated;
select set_config('request.jwt.claim.sub','c9300000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.analise_cnpj_detalhes('12345678000195')) <> 2 then raise exception 'detalhes do CNPJ: esperado 2 linhas'; end if;
 if (select motivo_situacao from public.analise_cnpj_detalhes('12345678000195') where numero_item = 1) <> 'Fornecedor não enviou a documentação de habilitação' then raise exception 'motivo literal alterado'; end if;
 if (select count(*) from public.analise_cnpj_detalhes('11444777000161')) <> 1 then raise exception 'outro CNPJ: motivo do item deveria aparecer'; end if;
 if (select count(*) from public.analise_cnpj_detalhes('123')) <> 0 then raise exception 'CNPJ inválido devolveu linhas'; end if;
 begin
  update public.historico_participacoes set marca_consultada_em = now();
  raise exception 'logado marcou consulta';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','c9300000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.analise_cnpj_detalhes('12345678000195')) <> 0 then raise exception 'pendente leu detalhes'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 perform 1 from public.analise_cnpj_detalhes('12345678000195');
 raise exception 'anon executou a RPC';
exception when insufficient_privilege then null; end $$;
reset role;
rollback;
