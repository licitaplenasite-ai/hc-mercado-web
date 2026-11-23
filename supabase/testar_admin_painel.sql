-- Teste de admin_painel.sql: resumo do boletim, busca, limpeza de 30 dias e saúde dos robôs. Dados fictícios e rollback.
-- D dono (owner, 2 fatores simulados com aal2), C cliente comum.
begin;
set local timezone = 'America/Sao_Paulo';
insert into auth.users(id,email) values
 ('e3000000-0000-4000-8000-000000000001','ap-d@qa.invalid'),('e3000000-0000-4000-8000-000000000002','ap-c@qa.invalid'),
 ('e3000000-0000-4000-8000-000000000003','ap-s@qa.invalid');
insert into public.admins(email,nome,role) values ('ap-d@qa.invalid','QA dono','owner');
insert into public.clientes(id,nome,email,status) values
 ('e3000000-0000-4000-8000-000000000002','QA Cliente Boletim','ap-c@qa.invalid','aprovado'),
 ('e3000000-0000-4000-8000-000000000003','QA Sem Envio','ap-s@qa.invalid','aprovado');
insert into public.logs_boletim(cliente_id,cliente_email,cliente_nome,status,quantidade_editais,mensagem_erro,executado_em) values
 ('e3000000-0000-4000-8000-000000000002','ap-c@qa.invalid','QA Cliente Boletim','enviado',4,null,now()),
 ('e3000000-0000-4000-8000-000000000002','ap-c@qa.invalid','QA Cliente Boletim','erro',0,'timed out',now() - interval '1 minute'),
 ('e3000000-0000-4000-8000-000000000002','ap-c@qa.invalid','QA Cliente Boletim','enviado',2,null,now() - interval '40 days');

-- Robô: só a chave de serviço grava o batimento; o do boletim apaga o registro com mais de 30 dias e nada de cliente.
do $$
declare v jsonb;
begin
 v := public.robo_registrar_sucesso('boletim');
 if (v->>'registros_apagados')::int < 1 then raise exception 'limpeza de 30 dias não apagou: %',v; end if;
 if exists (select 1 from public.logs_boletim where cliente_email='ap-c@qa.invalid' and executado_em < now() - interval '30 days') then raise exception 'ficou registro velho'; end if;
 if (select count(*) from public.logs_boletim where cliente_email='ap-c@qa.invalid') <> 2 then raise exception 'apagou registro recente'; end if;
 if not exists (select 1 from public.clientes where email='ap-c@qa.invalid') then raise exception 'apagou cliente'; end if;
 perform public.robo_registrar_sucesso('cobranca');
 begin perform public.robo_registrar_sucesso('robo_inventado'); raise exception 'aceitou robô fora da lista';
 exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$
declare d uuid:='e3000000-0000-4000-8000-000000000001'; c uuid:='e3000000-0000-4000-8000-000000000002'; v jsonb; hoje jsonb;
begin
 -- Cliente comum (mesmo com 2 fatores) não lê nada disso nem grava batimento.
 perform set_config('request.jwt.claim.sub',c::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',c,'aal','aal2')::text,true);
 begin perform public.admin_boletim_resumo(14); raise exception 'cliente leu o resumo do boletim';
 exception when insufficient_privilege then null; end;
 begin perform public.admin_saude_robos(); raise exception 'cliente leu a saúde dos robôs';
 exception when insufficient_privilege then null; end;
 begin perform public.robo_registrar_sucesso('pncp'); raise exception 'cliente gravou batimento';
 exception when insufficient_privilege then null; end;
 begin perform count(*) from public.logs_boletim; raise exception 'cliente leu logs_boletim direto';
 exception when insufficient_privilege then null; end;
 -- Dono sem 2 fatores: recusado.
 perform set_config('request.jwt.claim.sub',d::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',d,'aal','aal1')::text,true);
 begin perform public.admin_boletim_buscar('ap-c'); raise exception 'dono sem 2 fatores buscou';
 exception when insufficient_privilege then null; end;
 -- Dono com 2 fatores: um resumo por dia, detalhe só da falha, busca por e-mail e por nome.
 perform set_config('request.jwt.claims',json_build_object('sub',d,'aal','aal2')::text,true);
 v := public.admin_boletim_resumo(14);
 select x into hoje from jsonb_array_elements(v->'dias') x where (x->>'dia')::date = current_date;
 if hoje is null or (hoje->>'enviados')::int < 1 or (hoje->>'falhas')::int < 1 then raise exception 'resumo de hoje: %',v->'dias'; end if;
 if (hoje->>'sem_envio')::int < 1 then raise exception 'cliente sem envio não contou: %',hoje; end if;
 if jsonb_array_length(v->'dias') <> (select count(distinct (x->>'dia')) from jsonb_array_elements(v->'dias') x) then raise exception 'mais de uma linha por dia'; end if;
 if not exists (select 1 from jsonb_array_elements(v->'falhas') f where f->>'email'='ap-c@qa.invalid' and f->>'mensagem_erro'='timed out') then raise exception 'falha sem detalhe: %',v->'falhas'; end if;
 if exists (select 1 from jsonb_array_elements(v->'falhas') f where f ? 'quantidade_editais') then raise exception 'falhas trazem envio bom'; end if;
 if jsonb_array_length(public.admin_boletim_buscar('ap-c@qa')) <> 2 then raise exception 'busca por e-mail'; end if;
 if jsonb_array_length(public.admin_boletim_buscar('cliente boletim')) <> 2 then raise exception 'busca por nome'; end if;
 if jsonb_array_length(public.admin_boletim_buscar('%')) <> 0 then raise exception 'busca curta ou curinga devolveu linhas'; end if;
 -- Saúde: batimento da cobrança, boletim pelo batimento, cobertura e normas para revisar.
 v := public.admin_saude_robos();
 if v->'robos'->>'cobranca' is null or v->'robos'->>'boletim' is null then raise exception 'saúde sem batimento: %',v->'robos'; end if;
 if jsonb_typeof(v->'ufs_com_falha') <> 'array' or jsonb_typeof(v->'cobertura_por_uf') <> 'object' or (v->>'normas_para_revisar') is null then raise exception 'saúde incompleta: %',v; end if;
end $$;
reset role;
rollback;
