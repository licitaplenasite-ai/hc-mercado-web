-- Teste de orcamento_obra_recurso.sql: quem tem o Orçamento de obra. Dados fictícios e rollback (nada fica no banco).
-- E escolheu Empresa (em teste), V assina o Essencial, A tem Assessoria ativa.
begin;
insert into auth.users(id,email) values
 ('e3000000-0000-4000-8000-000000000001','oo-e@qa.invalid'),('e3000000-0000-4000-8000-000000000002','oo-v@qa.invalid'),
 ('e3000000-0000-4000-8000-000000000003','oo-a@qa.invalid');
insert into public.clientes(id,nome,email,status,plano) values
 ('e3000000-0000-4000-8000-000000000001','QA E','oo-e@qa.invalid','aprovado','empresa'),
 ('e3000000-0000-4000-8000-000000000002','QA V','oo-v@qa.invalid','aprovado','empresa'),
 ('e3000000-0000-4000-8000-000000000003','QA A','oo-a@qa.invalid','aprovado','assessoria');
update public.assinaturas set plano='essencial', situacao='ativa', vence_em=current_date+30 where usuario_id='e3000000-0000-4000-8000-000000000002';
update public.assinaturas set situacao='ativa', vence_em=current_date+30 where usuario_id='e3000000-0000-4000-8000-000000000003';

do $$
declare v text;
begin
 select string_agg(plano||'='||permitido, ',' order by plano) into v from public.plano_recursos where recurso='orcamento_obra';
 if v<>'assessoria=true,dono=true,empresa=true,essencial=false,gratis=false,teste=true' then raise exception 'plano_recursos do orcamento_obra: %',v; end if;
 if not (public.plano_efetivo_titular('e3000000-0000-4000-8000-000000000001')->'recursos'->'orcamento_obra'->>'permitido')::boolean then raise exception 'Empresa em teste sem Orçamento de obra'; end if;
 if (public.plano_efetivo_titular('e3000000-0000-4000-8000-000000000002')->'recursos'->'orcamento_obra'->>'permitido')::boolean then raise exception 'Essencial com Orçamento de obra'; end if;
 if not (public.plano_efetivo_titular('e3000000-0000-4000-8000-000000000003')->'recursos'->'orcamento_obra'->>'permitido')::boolean then raise exception 'Assessoria sem Orçamento de obra'; end if;
end $$;

-- A tela lê pelo meu_plano(); cliente não grava a liberação.
set local role authenticated;
do $$
begin
 perform set_config('request.jwt.claim.sub','e3000000-0000-4000-8000-000000000002',true);
 if (public.meu_plano()->'recursos'->'orcamento_obra'->>'permitido')::boolean then raise exception 'meu_plano do Essencial libera o Orçamento de obra'; end if;
 if public.eu_posso('orcamento_obra') then raise exception 'eu_posso libera o Essencial'; end if;
 perform set_config('request.jwt.claim.sub','e3000000-0000-4000-8000-000000000001',true);
 if not public.eu_posso('orcamento_obra') then raise exception 'eu_posso nega o Empresa'; end if;
 begin update public.plano_recursos set permitido=true where recurso='orcamento_obra' and plano='essencial'; raise exception 'cliente liberou o recurso';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
