-- Teste de operacao_itens_participar.sql (só ambiente de teste, tudo em rollback).
-- Requer 01-aplicar.sql (importação PNCP) e operacao_itens_participar.sql.
begin;
do $$
declare
 u uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
 res jsonb; item uuid; manual uuid; antes timestamptz; r public.operacao_itens_resultado;
 compra text:='04274064000131-1-36/2026';
 url text:='https://pncp.gov.br/api/pncp/v1/orgaos/04274064000131/compras/2026/36/itens/';
 ref jsonb:=jsonb_build_object('url_origem',null,'origem_externa_id',null,'numero','QA-PART');
 it jsonb:=jsonb_build_object('numero',1,'descricao','Item fictício exclusivo','quantidade','2','unidade','UN');
begin
 insert into auth.users(id,email) values(u,u||'@qa.invalid');
 insert into public.clientes(id,nome,email,status) values(u,'QA participar',u||'@qa.invalid','aprovado') on conflict(id) do update set status='aprovado';
 insert into public.operacao_organizacoes(id,nome,owner_id) values(o,'QA participar',u);
 insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values(e,o,'QA participar','11222333000181');
 insert into public.operacao_membros(organizacao_id,usuario_id,papel) values(o,u,'gestor');
 insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,numero) values(p,o,e,'QA fictício','QA-PART');

 -- Item manual: entra na proposta como antes (padrão true), sem benefício.
 insert into public.operacao_itens_resultado(organizacao_id,processo_id,identificador) values(o,p,'Manual 1') returning id into manual;
 select * into r from public.operacao_itens_resultado where id=manual;
 if r.participar is distinct from true or r.tipo_beneficio is not null then raise exception 'item manual: participar=% tipo=%',r.participar,r.tipo_beneficio;end if;

 -- Item novo do edital: começa fora da proposta, com o tipoBeneficio do PNCP.
 res:=public.gravar_importacao_pncp(u,e,p,o,compra,1,url||'1',repeat('a',64),it,jsonb_build_object('raw',jsonb_build_object('tipoBeneficio',1)),ref);
 if res->>'estado'<>'importado' then raise exception 'não importou: %',res;end if;
 item:=(res->>'itemId')::uuid;
 select * into r from public.operacao_itens_resultado where id=item;
 if r.participar is distinct from false or r.tipo_beneficio is distinct from 1::smallint then raise exception 'importado: participar=% tipo=%',r.participar,r.tipo_beneficio;end if;

 -- A pessoa marca; reimportar com fonte alterada atualiza o benefício e NÃO mexe na escolha nem em atualizado_em.
 update public.operacao_itens_resultado set participar=true where id=item;
 select atualizado_em into antes from public.operacao_itens_resultado where id=item;
 res:=public.gravar_importacao_pncp(u,e,p,o,compra,1,url||'1',repeat('b',64),it,jsonb_build_object('raw',jsonb_build_object('tipoBeneficio','3')),ref);
 if res->>'estado'<>'fonte_alterada' then raise exception 'reimportação: %',res;end if;
 select * into r from public.operacao_itens_resultado where id=item;
 if r.participar is distinct from true then raise exception 'reimportação desmarcou o item';end if;
 if r.tipo_beneficio is distinct from 3::smallint then raise exception 'benefício não atualizado: %',r.tipo_beneficio;end if;
 if r.atualizado_em is distinct from antes then raise exception 'atualizado_em mudou';end if;

 -- Valor fora do formato é ignorado (não derruba a importação nem apaga o benefício).
 res:=public.gravar_importacao_pncp(u,e,p,o,compra,1,url||'1',repeat('c',64),it,jsonb_build_object('raw',jsonb_build_object('tipoBeneficio','x')),ref);
 if (select tipo_beneficio from public.operacao_itens_resultado where id=item) is distinct from 3::smallint then raise exception 'benefício inválido gravado';end if;
 begin
  update public.operacao_itens_resultado set tipo_beneficio=0 where id=item;
  raise exception 'tipo_beneficio 0 aceito';
 exception when check_violation then null;end;
 begin
  update public.operacao_itens_resultado set participar=null where id=item;
  raise exception 'participar null aceito';
 exception when not_null_violation then null;end;
 raise notice 'testar_itens_participar: ok';
end $$;
rollback;
