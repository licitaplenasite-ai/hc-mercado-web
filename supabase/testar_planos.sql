-- Teste de planos_e_recursos.sql: regras automáticas de plano como asserts. Dados fictícios e rollback.
-- Papéis simulados com "set local role" + request.jwt.claim.sub / request.jwt.claims (aal2 do admin).
-- E empresa (1 CNPJ), A assessoria em teste (até 3), V teste vencido (Grátis), M membro de A, D dono (owner), X outra org.
begin;
insert into auth.users(id,email) values
 ('e2000000-0000-4000-8000-000000000001','pl-e@qa.invalid'),('e2000000-0000-4000-8000-000000000002','pl-a@qa.invalid'),
 ('e2000000-0000-4000-8000-000000000003','pl-v@qa.invalid'),('e2000000-0000-4000-8000-000000000004','pl-m@qa.invalid'),
 ('e2000000-0000-4000-8000-000000000005','pl-d@qa.invalid'),('e2000000-0000-4000-8000-000000000006','pl-x@qa.invalid');
insert into public.admins(email,nome,role) values ('pl-d@qa.invalid','QA dono','owner');
insert into public.clientes(id,nome,email,status,plano) values
 ('e2000000-0000-4000-8000-000000000001','QA E','pl-e@qa.invalid','aprovado','empresa'),
 ('e2000000-0000-4000-8000-000000000002','QA A','pl-a@qa.invalid','aprovado',null),
 ('e2000000-0000-4000-8000-000000000003','QA V','pl-v@qa.invalid','aprovado','empresa'),
 ('e2000000-0000-4000-8000-000000000004','QA M','pl-m@qa.invalid','aprovado',null),
 ('e2000000-0000-4000-8000-000000000005','QA D','pl-d@qa.invalid','aprovado',null),
 ('e2000000-0000-4000-8000-000000000006','QA X','pl-x@qa.invalid','pendente',null);
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('e2000000-0000-4000-8000-00000000000e','QA org E','e2000000-0000-4000-8000-000000000001'),
 ('e2000000-0000-4000-8000-00000000000a','QA org A','e2000000-0000-4000-8000-000000000002'),
 ('e2000000-0000-4000-8000-00000000000b','QA org V','e2000000-0000-4000-8000-000000000003'),
 ('e2000000-0000-4000-8000-00000000000d','QA org D','e2000000-0000-4000-8000-000000000005');
insert into public.operacao_membros(organizacao_id,usuario_id,papel) values
 ('e2000000-0000-4000-8000-00000000000e','e2000000-0000-4000-8000-000000000001','gestor'),
 ('e2000000-0000-4000-8000-00000000000a','e2000000-0000-4000-8000-000000000002','gestor'),
 ('e2000000-0000-4000-8000-00000000000a','e2000000-0000-4000-8000-000000000004','operador'),
 ('e2000000-0000-4000-8000-00000000000b','e2000000-0000-4000-8000-000000000003','gestor');

do $$
declare e uuid:='e2000000-0000-4000-8000-00000000000e'; a uuid:='e2000000-0000-4000-8000-00000000000a';
 vo uuid:='e2000000-0000-4000-8000-00000000000b'; d uuid:='e2000000-0000-4000-8000-00000000000d'; v jsonb; n int;
begin
 -- Cadastro cria a assinatura: E escolheu Empresa; A sem escolha vira Assessoria; pendente X fica sem prazo.
 if (select plano||'/'||situacao from public.assinaturas where usuario_id='e2000000-0000-4000-8000-000000000001')<>'empresa/teste' then raise exception 'assinatura de E'; end if;
 if (select plano from public.assinaturas where usuario_id='e2000000-0000-4000-8000-000000000002')<>'assessoria' then raise exception 'assinatura de A'; end if;
 if (select teste_ate from public.assinaturas where usuario_id='e2000000-0000-4000-8000-000000000006') is not null then raise exception 'teste de pendente começou'; end if;
 if (select teste_ate from public.assinaturas where usuario_id='e2000000-0000-4000-8000-000000000001') < now()+interval '13 days' then raise exception 'teste de 14 dias'; end if;
 -- Empresa: 1 CNPJ (o 2º falha); em teste com Empresa continua 1.
 insert into public.operacao_empresas(organizacao_id,razao_social) values (e,'QA E1');
 begin insert into public.operacao_empresas(organizacao_id,razao_social) values (e,'QA E2'); raise exception 'Empresa cadastrou 2º CNPJ';
 exception when raise_exception then if sqlerrm not like 'Limite de 1 CNPJs%' then raise; end if; end;
 -- Assessoria em teste: menor entre 10 e 3 = 3.
 insert into public.operacao_empresas(organizacao_id,razao_social) select a,'QA A'||g from generate_series(1,3) g;
 begin insert into public.operacao_empresas(organizacao_id,razao_social) values (a,'QA A4'); raise exception 'teste passou de 3 CNPJs';
 exception when raise_exception then if sqlerrm not like 'Limite de 3 CNPJs%' then raise; end if; end;
 -- Dono: sem limite.
 insert into public.operacao_empresas(organizacao_id,razao_social) select d,'QA D'||g from generate_series(1,12) g;
 -- Teste vencido cai no Grátis: 3 processos ativos, IA 3/dia, sem análise por CNPJ.
 update public.assinaturas set teste_ate=now()-interval '1 day' where usuario_id='e2000000-0000-4000-8000-000000000003';
 v := public.plano_efetivo_titular('e2000000-0000-4000-8000-000000000003');
 if v->>'plano'<>'gratis' or (v->>'max_processos')::int<>3 then raise exception 'teste vencido não virou Grátis: %',v; end if;
 insert into public.operacao_empresas(id,organizacao_id,razao_social) values ('e2000000-0000-4000-8000-0000000000b1',vo,'QA V1');
 insert into public.operacao_processos(organizacao_id,empresa_id,objeto) select vo,'e2000000-0000-4000-8000-0000000000b1','QA p'||g from generate_series(1,3) g;
 begin insert into public.operacao_processos(organizacao_id,empresa_id,objeto) values (vo,'e2000000-0000-4000-8000-0000000000b1','QA p4'); raise exception 'Grátis passou de 3 processos';
 exception when raise_exception then if sqlerrm not like 'Limite de 3 processos%' then raise; end if; end;
 update public.operacao_processos set status='arquivado' where organizacao_id=vo and objeto='QA p1';
 insert into public.operacao_processos(organizacao_id,empresa_id,objeto) values (vo,'e2000000-0000-4000-8000-0000000000b1','QA p4');
 begin update public.operacao_processos set status='triagem' where organizacao_id=vo and objeto='QA p1'; raise exception 'desarquivar passou do limite';
 exception when raise_exception then if sqlerrm not like 'Limite de 3 processos%' then raise; end if; end;
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000003','analise-cnpj',10);
 if (v->>'permitido')::boolean or v->>'motivo'<>'plano' then raise exception 'Grátis usou análise por CNPJ: %',v; end if;
 for n in 1..3 loop v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000003','ia-edital',40); end loop;
 if not (v->>'permitido')::boolean or (v->>'limite')::int<>3 then raise exception 'IA do Grátis: %',v; end if;
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000003','ia-edital',40);
 if (v->>'permitido')::boolean then raise exception 'Grátis passou de 3 IA/dia'; end if;
 -- Rota sem recurso: só o limite da rota. Membro conta no plano do titular.
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000004','sancoes',100);
 if not (v->>'permitido')::boolean or (v->>'limite')::int<>100 then raise exception 'rota sem recurso: %',v; end if;
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000004','ia-edital',40);
 if (v->>'limite')::int<>15 then raise exception 'membro não herdou o teste do titular: %',v; end if;
end $$;

-- Usuário comum: não muda plano, não chama admin, não vê plano de outra organização, não grava 2º CNPJ por API.
set local role authenticated;
do $$
declare e uuid:='e2000000-0000-4000-8000-000000000001'; v jsonb;
begin
 perform set_config('request.jwt.claim.sub',e::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',e,'aal','aal2')::text,true);
 begin insert into public.operacao_empresas(organizacao_id,razao_social) values ('e2000000-0000-4000-8000-00000000000e','QA E2 via API'); raise exception 'E criou 2º CNPJ como authenticated';
 exception when raise_exception then if sqlerrm not like 'Limite de 1 CNPJs%' then raise; end if; end;
 begin update public.assinaturas set plano='assessoria', max_cnpjs=99 where usuario_id=e; raise exception 'cliente alterou a própria assinatura';
 exception when insufficient_privilege then null; end;
 begin insert into public.plano_recursos(plano,recurso) values ('gratis','proposta'); raise exception 'cliente gravou plano_recursos';
 exception when insufficient_privilege then null; end;
 begin perform public.admin_definir_assinatura(e,'{"plano":"assessoria"}'); raise exception 'cliente chamou admin_definir_assinatura';
 exception when insufficient_privilege then null; end;
 begin perform public.admin_listar_contas(); raise exception 'cliente listou contas';
 exception when insufficient_privilege then null; end;
 begin perform public.consumir_uso_plano(e,'ia-edital',40); raise exception 'cliente chamou consumir_uso_plano';
 exception when insufficient_privilege then null; end;
 if public.organizacao_pode('e2000000-0000-4000-8000-00000000000a','ia') then raise exception 'organizacao_pode respondeu para outra org'; end if;
 v := public.meu_plano();
 if v->>'plano'<>'empresa' or (v->>'max_cnpjs')::int<>1 or (v->'uso'->>'cnpjs')::int<>1 then raise exception 'meu_plano de E: %',v; end if;
 if (select count(*) from public.assinaturas)<>1 then raise exception 'cliente vê assinatura de outro'; end if;
 perform public.solicitar_plano('assessoria');
 if (select plano_solicitado from public.assinaturas)<>'assessoria' then raise exception 'pedido de plano'; end if;
 -- Membro: herda o plano do titular e não pede plano em nome dele.
 perform set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000004',true);
 if public.meu_plano()->>'plano'<>'assessoria' then raise exception 'membro não vê o plano do titular'; end if;
 begin perform public.solicitar_plano('empresa'); raise exception 'membro pediu plano';
 exception when insufficient_privilege then null; end;
end $$;

-- Dono: sem 2 fatores não muda plano; com 2 fatores muda, não rebaixa abaixo do uso, registra histórico e pagamento.
do $$
declare d uuid:='e2000000-0000-4000-8000-000000000005'; a uuid:='e2000000-0000-4000-8000-000000000002'; v jsonb; g uuid;
begin
 perform set_config('request.jwt.claim.sub',d::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',d,'aal','aal1')::text,true);
 begin perform public.admin_definir_assinatura(a,'{"plano":"empresa"}'); raise exception 'dono sem 2 fatores mudou plano';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',json_build_object('sub',d,'aal','aal2')::text,true);
 if public.meu_plano()->>'plano'<>'dono' then raise exception 'dono sem plano Dono'; end if;
 begin perform public.admin_definir_assinatura(a,'{"plano":"empresa","situacao":"ativa"}'); raise exception 'rebaixou abaixo do uso';
 exception when raise_exception then if sqlerrm not like 'A conta tem 3 CNPJs ativos%' then raise; end if; end;
 begin perform public.admin_definir_assinatura(a,'{"plano":"dono"}'); raise exception 'deu plano Dono a cliente';
 exception when raise_exception then null; end;
 v := public.admin_definir_assinatura(a,'{"plano":"assessoria","situacao":"ativa","max_cnpjs":5}');
 if (v->>'max_cnpjs')::int<>5 or v->>'plano'<>'assessoria' then raise exception 'ajuste de CNPJs: %',v; end if;
 -- Membro novo além do limite de usuários (ajuste 2: titular + operador já ocupam).
 perform public.admin_definir_assinatura(a,'{"max_usuarios":2}');
 begin perform public.admin_definir_assinatura(a,'{"max_usuarios":1}'); raise exception 'rebaixou usuários abaixo do uso';
 exception when raise_exception then if sqlerrm not like 'A conta tem 2 usuários%' then raise; end if; end;
 if jsonb_array_length(public.admin_historico_assinatura(a))<2 then raise exception 'histórico não registrou'; end if;
 v := public.admin_registrar_pagamento(a,'{"ciclo":"mensal","pago":true}');
 if (select situacao||'/'||valor_centavos from public.pagamentos where usuario_id=a)<>'pago/29900' then raise exception 'pagamento manual'; end if;
 g := (v->>'pagamento')::uuid;
 if (public.admin_atualizar_pagamento(g,'pago')->>'ja_aplicado')::boolean is not true then raise exception 'pagamento aplicado duas vezes'; end if;
 if (select vence_em from public.assinaturas where usuario_id=a)<>(current_date+interval '1 month')::date then raise exception 'vencimento após pagamento'; end if;
 perform public.admin_definir_status_cliente(a,'suspenso');
 if (select status from public.clientes where id=a)<>'rejeitado' or (select x->'efetivo'->>'plano' from jsonb_array_elements(public.admin_listar_contas()) x where x->>'id'=a::text)<>'gratis' then raise exception 'suspensão'; end if;
 perform public.admin_definir_status_cliente(a,'reativar');
 if (select x->'efetivo'->>'plano' from jsonb_array_elements(public.admin_listar_contas()) x where x->>'id'=a::text)<>'assessoria' then raise exception 'reativação'; end if;
 if (public.admin_resumo()->>'pendentes')::int<1 then raise exception 'resumo sem pendente'; end if;
end $$;
reset role;
do $$
begin
 begin insert into public.operacao_membros(organizacao_id,usuario_id,papel) values ('e2000000-0000-4000-8000-00000000000a','e2000000-0000-4000-8000-000000000006','leitura'); raise exception 'passou do limite de usuários';
 exception when raise_exception then if sqlerrm not like 'Limite de 2 usuários%' then raise; end if; end;
end $$;

-- Vencida há mais de 5 dias = Grátis; dentro da tolerância continua.
do $$
declare a uuid:='e2000000-0000-4000-8000-000000000002';
begin
 update public.assinaturas set vence_em=current_date-5 where usuario_id=a;
 if public.plano_efetivo_titular(a)->>'plano'<>'assessoria' then raise exception 'tolerância de 5 dias'; end if;
 update public.assinaturas set vence_em=current_date-6 where usuario_id=a;
 if public.plano_efetivo_titular(a)->>'plano'<>'gratis' then raise exception 'vencida não caiu para Grátis'; end if;
end $$;
rollback;
