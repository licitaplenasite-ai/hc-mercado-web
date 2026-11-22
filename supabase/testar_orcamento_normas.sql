-- Teste de orcamento_normas.sql: o robô cria novidade, só o dono com 2 fatores decide. Dados fictícios e rollback.
-- C cliente aprovado, D dono (owner). Papéis simulados com "set local role" + request.jwt.claims.
begin;
insert into auth.users(id,email) values ('e4000000-0000-4000-8000-000000000001','nn-c@qa.invalid'),('e4000000-0000-4000-8000-000000000002','nn-d@qa.invalid');
insert into public.admins(email,nome,role) values ('nn-d@qa.invalid','QA dono normas','owner');
insert into public.clientes(id,nome,email,status) values ('e4000000-0000-4000-8000-000000000001','QA C','nn-c@qa.invalid','aprovado'),('e4000000-0000-4000-8000-000000000002','QA D','nn-d@qa.invalid','aprovado');

-- Robô: insere; o mesmo link de novo não duplica nem apaga a decisão.
set local role service_role;
insert into public.orcamento_normas_novidades(fonte,titulo,link,publicado_em,termos,resumo)
values ('TCU','QA ACÓRDÃO 1/2026','https://qa.invalid/acordao-1','2026-11-18','{BDI}','QA BDI de obra'),
       ('SEGES-IN','QA IN 2','https://qa.invalid/in-2',null,'{}',null);
insert into public.orcamento_normas_novidades(fonte,titulo,link) values ('TCU','QA repetido','https://qa.invalid/acordao-1') on conflict (link) do nothing;
do $$ begin
 if (select count(*) from public.orcamento_normas_novidades where link like 'https://qa.invalid/%')<>2 then raise exception 'link repetido duplicou'; end if;
 if (select situacao from public.orcamento_normas_novidades where link='https://qa.invalid/acordao-1')<>'para_revisar' then raise exception 'novidade não nasce para revisar'; end if;
 begin insert into public.orcamento_normas_novidades(fonte,titulo,link) values ('BLOG','x','https://qa.invalid/b'); raise exception 'fonte não oficial aceita';
 exception when check_violation then null; end;
 begin insert into public.orcamento_normas_novidades(fonte,titulo,link) values ('TCU','x','http://qa.invalid/sem-https'); raise exception 'link sem https aceito';
 exception when check_violation then null; end;
 begin insert into public.orcamento_normas_novidades(fonte,titulo,link,situacao) values ('TCU','x','https://qa.invalid/c','aprovada'); raise exception 'aprovada sem revisão aceita';
 exception when check_violation then null; end;
end $$;
reset role;

-- Cliente comum: não lê a fila nem decide.
set local role authenticated;
do $$ declare v bigint; begin
 perform set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims',json_build_object('sub','e4000000-0000-4000-8000-000000000001','aal','aal2')::text,true);
 if (select count(*) from public.orcamento_normas_novidades)<>0 then raise exception 'cliente leu a fila do dono'; end if;
 begin perform public.revisar_novidade_norma(1,'aprovada','bdi_faixa','x'); raise exception 'cliente decidiu novidade';
 exception when insufficient_privilege then null; end;
 begin update public.orcamento_normas_novidades set situacao='aprovada'; raise exception 'cliente alterou direto';
 exception when insufficient_privilege then null; end;
end $$;
-- Dono sem 2 fatores (aal1): também não.
do $$ begin
 perform set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims',json_build_object('sub','e4000000-0000-4000-8000-000000000002','aal','aal1')::text,true);
 if (select count(*) from public.orcamento_normas_novidades)<>0 then raise exception 'dono sem 2 fatores leu'; end if;
 begin perform public.revisar_novidade_norma(1,'aprovada','bdi_faixa','x'); raise exception 'dono sem 2 fatores decidiu';
 exception when insufficient_privilege then null; end;
end $$;
-- Dono com 2 fatores: lê, aprova com a regra, descarta; não decide duas vezes; aprovar exige a regra.
do $$ declare a bigint; b bigint; begin
 perform set_config('request.jwt.claims',json_build_object('sub','e4000000-0000-4000-8000-000000000002','aal','aal2')::text,true);
 select id into a from public.orcamento_normas_novidades where link='https://qa.invalid/acordao-1';
 select id into b from public.orcamento_normas_novidades where link='https://qa.invalid/in-2';
 if a is null or b is null then raise exception 'dono não lê a fila'; end if;
 begin perform public.revisar_novidade_norma(a,'aprovada','',''); raise exception 'aprovou sem dizer a regra';
 exception when invalid_parameter_value then null; end;
 begin perform public.revisar_novidade_norma(a,'talvez','bdi_faixa',''); raise exception 'decisão inválida aceita';
 exception when invalid_parameter_value then null; end;
 perform public.revisar_novidade_norma(a,'aprovada','BDI_Faixa',' muda a faixa ');
 perform public.revisar_novidade_norma(b,'descartada',null,'não é obra');
 begin perform public.revisar_novidade_norma(a,'descartada',null,''); raise exception 'decidiu duas vezes';
 exception when no_data_found then null; end;
 if (select regra||'|'||nota||'|'||(revisado_por::text) from public.orcamento_normas_novidades where id=a)<>'bdi_faixa|muda a faixa|e4000000-0000-4000-8000-000000000002' then raise exception 'aprovação gravada errada'; end if;
 if (select situacao from public.orcamento_normas_novidades where id=b)<>'descartada' then raise exception 'descarte não gravou'; end if;
end $$;
reset role;
-- O robô de novo com o mesmo link não volta a decisão.
set local role service_role;
insert into public.orcamento_normas_novidades(fonte,titulo,link) values ('TCU','QA de novo','https://qa.invalid/acordao-1') on conflict (link) do nothing;
do $$ begin
 if (select situacao from public.orcamento_normas_novidades where link='https://qa.invalid/acordao-1')<>'aprovada' then raise exception 'robô desfez a decisão'; end if;
end $$;
reset role;
rollback;
