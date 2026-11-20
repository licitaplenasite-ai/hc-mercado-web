-- Teste de pecas_juridicas.sql. Dados fictícios e rollback. Papéis com "set local role"; não prova a API HTTP.
-- Peça do ComprasNet antigo (cn-) e da Lei 14.133 no PNCP (pncp-); link só para os dois portais; CPF recusado;
-- leitura só para cliente aprovado; escrita só pela chave de serviço (robôs).
begin;
insert into auth.users(id,email) values ('c0d00000-0000-4000-8000-000000000001','pj-a@qa.invalid'),('c0d00000-0000-4000-8000-000000000002','pj-p@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('c0d00000-0000-4000-8000-000000000001','QA pj A','pj-a@qa.invalid','aprovado'),
 ('c0d00000-0000-4000-8000-000000000002','QA pj P','pj-p@qa.invalid','pendente');
insert into public.pecas_juridicas(id,tipo,texto,lei,url) values
 ('cn-1099276-qa-111','esclarecimento','Pedido fictício','10520','https://www.comprasnet.gov.br/livre/pregao/ata2.asp?x=1'),
 ('pncp-89971758000180-2026-1381-10','esclarecimento','Pedido fictício da 14.133','14133','https://pncp.gov.br/app/editais/89971758000180/2026/1381');
do $$ begin
  begin insert into public.pecas_juridicas(id,tipo,texto,url) values ('pncp-1-2-3-4','recurso','x','https://evil.com/x'); raise exception 'link fora dos portais aceito';
  exception when check_violation then null; end;
  begin insert into public.pecas_juridicas(id,tipo,texto) values ('xx-1-2-3','recurso','x'); raise exception 'id sem prefixo aceito';
  exception when check_violation then null; end;
  begin insert into public.pecas_juridicas(id,tipo,texto) values ('pncp-1-2-3-5','recurso','CPF 123.456.789-09'); raise exception 'CPF aceito';
  exception when check_violation then null; end;
end $$;
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub','c0d00000-0000-4000-8000-000000000001',true);
  if (select count(*) from public.pecas_juridicas where id like 'pncp-89971758000180%' or id = 'cn-1099276-qa-111') <> 2 then raise exception 'aprovado não leu as duas fontes'; end if;
  begin insert into public.pecas_juridicas(id,tipo,texto) values ('pncp-9-9-9-9','recurso','x'); raise exception 'cliente gravou peça';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','c0d00000-0000-4000-8000-000000000002',true);
  if (select count(*) from public.pecas_juridicas) <> 0 then raise exception 'pendente leu peças'; end if;
end $$;
reset role;
select 'testar_pecas_juridicas: ok';
rollback;
