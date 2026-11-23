-- Teste de planos_e_recursos.sql: regras automáticas de plano como asserts. Dados fictícios e rollback.
-- Papéis simulados com "set local role" + request.jwt.claim.sub / request.jwt.claims (aal2 do admin).
-- E empresa (1 CNPJ), A assessoria em teste (até 3), V teste vencido (só boletim) e depois Essencial, M membro de A,
-- D dono (owner), X outra org. 21/11: cota de IA mensal por CNPJ, troca para IA barata, teto de abuso e extras.
begin;
-- current_date do teste no dia de Brasília, igual a public.hoje_brasilia() das funções (o banco roda em UTC).
set local timezone = 'America/Sao_Paulo';
insert into auth.users(id,email) values
 ('e2000000-0000-4000-8000-000000000001','pl-e@qa.invalid'),('e2000000-0000-4000-8000-000000000002','pl-a@qa.invalid'),
 ('e2000000-0000-4000-8000-000000000003','pl-v@qa.invalid'),('e2000000-0000-4000-8000-000000000004','pl-m@qa.invalid'),
 ('e2000000-0000-4000-8000-000000000005','pl-d@qa.invalid'),('e2000000-0000-4000-8000-000000000006','pl-x@qa.invalid');
insert into public.admins(email,nome,role) values ('pl-d@qa.invalid','QA dono','owner');
insert into public.clientes(id,nome,email,status,plano) values
 ('e2000000-0000-4000-8000-000000000001','QA E','pl-e@qa.invalid','aprovado','empresa'),
 ('e2000000-0000-4000-8000-000000000002','QA A','pl-a@qa.invalid','aprovado','assessoria'),
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
 vo uuid:='e2000000-0000-4000-8000-00000000000b'; d uuid:='e2000000-0000-4000-8000-00000000000d'; v jsonb; n int; f text;
begin
 -- Cadastro cria a assinatura: E escolheu Empresa; A escolheu Assessoria; M sem escolha testa a Assessoria; pendente X sem prazo.
 if (select plano||'/'||situacao from public.assinaturas where usuario_id='e2000000-0000-4000-8000-000000000001')<>'empresa/teste' then raise exception 'assinatura de E'; end if;
 if (select plano from public.assinaturas where usuario_id='e2000000-0000-4000-8000-000000000002')<>'assessoria' then raise exception 'assinatura de A'; end if;
 if (select plano from public.assinaturas where usuario_id='e2000000-0000-4000-8000-000000000004')<>'assessoria' then raise exception 'teste sem escolha não é Assessoria'; end if;
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
 -- Durante o teste V salva empresa e processos; o teste vence: só boletim, nada apagado, nenhuma ferramenta.
 insert into public.operacao_empresas(id,organizacao_id,razao_social) values ('e2000000-0000-4000-8000-0000000000b1',vo,'QA V1');
 insert into public.operacao_processos(organizacao_id,empresa_id,objeto) select vo,'e2000000-0000-4000-8000-0000000000b1','QA p'||g from generate_series(1,3) g;
 update public.operacao_processos set status='arquivado' where organizacao_id=vo and objeto='QA p1';
 update public.assinaturas set teste_ate=now()-interval '1 day' where usuario_id='e2000000-0000-4000-8000-000000000003';
 v := public.plano_efetivo_titular('e2000000-0000-4000-8000-000000000003');
 if v->>'plano'<>'gratis' or not (v->>'bloqueado')::boolean or (v->>'max_processos')::int<>0 then raise exception 'teste vencido não travou: %',v; end if;
 if (select count(*) from public.operacao_processos where organizacao_id=vo)<>3 then raise exception 'teste vencido apagou processos'; end if;
 begin insert into public.operacao_processos(organizacao_id,empresa_id,objeto) values (vo,'e2000000-0000-4000-8000-0000000000b1','QA p4'); raise exception 'teste vencido criou processo';
 exception when raise_exception then if sqlerrm not like 'Limite de 0 processos%' then raise; end if; end;
 begin update public.operacao_processos set status='triagem' where organizacao_id=vo and objeto='QA p1'; raise exception 'teste vencido desarquivou';
 exception when raise_exception then if sqlerrm not like 'Limite de 0 processos%' then raise; end if; end;
 foreach f in array array['ia-edital','chat-ia','analise-cnpj','kit-documentos','sancoes','pregao-gravado-leitura'] loop
  v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000003',f,40);
  if (v->>'permitido')::boolean or v->>'motivo'<>'assinatura' then raise exception 'teste vencido usou %: %',f,v; end if;
 end loop;
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000003','enviar_duvida',10);
 if not (v->>'permitido')::boolean then raise exception 'teste vencido não manda dúvida ao suporte: %',v; end if;
 -- V assina o Essencial: 15 processos, IA sim; chat, análise por CNPJ, proposta, extensão e licitação anterior não.
 update public.assinaturas set plano='essencial', situacao='ativa', vence_em=current_date+30 where usuario_id='e2000000-0000-4000-8000-000000000003';
 v := public.plano_efetivo_titular('e2000000-0000-4000-8000-000000000003');
 if v->>'plano'<>'essencial' or (v->>'max_processos')::int<>15 or (v->>'max_usuarios')::int<>1 or (v->>'ia_mes')::int<>300 then raise exception 'Essencial: %',v; end if;
 foreach f in array array['chat-ia','analise-cnpj','kit-documentos','pregao-gravado','licitacao-anterior','proposta-lote'] loop
  v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000003',f,40);
  if (v->>'permitido')::boolean or v->>'motivo'<>'plano' then raise exception 'Essencial usou %: %',f,v; end if;
 end loop;
 foreach f in array array['mercado','pesquisa_precos','prospeccao','convenios','licitacao_anterior'] loop
  if (public.plano_efetivo_titular('e2000000-0000-4000-8000-000000000003')->'recursos'->f->>'permitido')::boolean then raise exception 'Essencial tem %',f; end if;
 end loop;
 -- Uso justo por mês: a cota do Essencial (reduzida a 2 só neste teste) acaba e a IA continua, na opção barata.
 update public.planos set ia_mes_por_cnpj=2 where codigo='essencial';
 for n in 1..2 loop
  v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000003','ia-edital',40);
  if not (v->>'permitido')::boolean or (v->>'economico')::boolean then raise exception 'IA % dentro da cota: %',n,v; end if;
 end loop;
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000003','fornecedor-ia',20);
 if not (v->>'permitido')::boolean or not (v->>'economico')::boolean then raise exception 'passou da cota e não trocou para IA barata: %',v; end if;
 -- Teto de abuso (100 por pessoa por dia, somando as rotas de IA): aí sim bloqueia.
 insert into public.uso_diario(usuario_id,funcao,dia,contagem) values ('e2000000-0000-4000-8000-000000000003','monte-busca-ia',current_date,97);
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000003','ia-edital',40);
 if (v->>'permitido')::boolean or (v->>'limite')::int<>100 then raise exception 'teto de abuso: %',v; end if;
 -- Teste grátis: 3 análises por CNPJ/dia; busca por nome e cadastro da mesma análise não gastam essa cota.
 for n in 1..3 loop
  v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000001','analise-cnpj-buscar',100);
  v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000001','analise-cnpj-cadastro',100);
  if not (v->>'permitido')::boolean or (v->>'limite')::int<>100 then raise exception 'cadastro da análise: %',v; end if;
  v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000001','analise-cnpj',20);
  if not (v->>'permitido')::boolean or (v->>'contagem')::int<>n then raise exception 'análise % do Teste grátis: %',n,v; end if;
 end loop;
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000001','analise-cnpj',20);
 if (v->>'permitido')::boolean then raise exception 'Teste grátis passou de 3 análises por CNPJ/dia'; end if;
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000003','analise-cnpj-cadastro',100);
 if (v->>'permitido')::boolean or v->>'motivo'<>'plano' then raise exception 'Grátis usou cadastro da análise: %',v; end if;
 -- Rota sem recurso: só o limite da rota. Membro conta no plano do titular.
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000004','sancoes',100);
 if not (v->>'permitido')::boolean or (v->>'limite')::int<>100 then raise exception 'rota sem recurso: %',v; end if;
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000004','ia-edital',40);
 if (v->>'limite')::int<>100 or v->>'plano'<>'Assessoria' then raise exception 'membro não herdou o teste do titular: %',v; end if;
 -- Cota mensal é da organização (CNPJs somados): uso do membro M entra na conta do titular A.
 n := public.uso_ia_mes_titular('e2000000-0000-4000-8000-000000000002');
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000004','chat-ia',15);
 if public.uso_ia_mes_titular('e2000000-0000-4000-8000-000000000002')<>n+1 then raise exception 'uso do membro fora da cota da organização'; end if;
 if (public.plano_efetivo_titular('e2000000-0000-4000-8000-000000000002')->>'ia_mes')::int<>2400 then raise exception 'Assessoria em teste: 800 x 3 CNPJs'; end if;
 update public.planos set ia_mes_por_cnpj=0 where codigo='assessoria';
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000004','ia-edital',40);
 if not (v->>'economico')::boolean then raise exception 'organização passou da cota e não trocou: %',v; end if;
 -- Lance assistido é extra: nem o Empresa nem o teste têm. Ler o pregão continua no Empresa.
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000001','proposta-lote',300);
 if (v->>'permitido')::boolean or v->>'recurso'<>'lance_assistido' then raise exception 'lance sem o extra: %',v; end if;
 v := public.consumir_uso_plano('e2000000-0000-4000-8000-000000000001','pregao-gravado-leitura',300);
 if not (v->>'permitido')::boolean then raise exception 'ler o pregão saiu do Empresa: %',v; end if;
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
 if v ? 'ia_mes' then raise exception 'cliente vê a cota de IA: %',v; end if;
 if not public.eu_posso('prospeccao') then raise exception 'Empresa em teste sem Prospecção'; end if;
 perform set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000003',true);
 if public.eu_posso('prospeccao') then raise exception 'Essencial lê Prospecção'; end if;
 begin update public.assinaturas set extras='{lance_assistido}' where usuario_id='e2000000-0000-4000-8000-000000000003'; raise exception 'cliente ligou extra';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',e::text,true);
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
 if (select situacao||'/'||valor_centavos from public.pagamentos where usuario_id=a)<>'pago/69700' then raise exception 'pagamento manual'; end if;
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
-- Fora do papel authenticated (para ler plano_efetivo_titular), com o dono ainda nas claims (aal2).
do $$
declare a uuid:='e2000000-0000-4000-8000-000000000002';
begin
 -- Extras ligados pelo admin: Lance assistido libera o preenchimento; IA extra só no mês dela; extra inválido não entra.
 perform public.admin_definir_assinatura('e2000000-0000-4000-8000-000000000001','{"extras":["lance_assistido"]}');
 if not (public.plano_efetivo_titular('e2000000-0000-4000-8000-000000000001')->'recursos'->'lance_assistido'->>'permitido')::boolean then raise exception 'extra Lance não ligou'; end if;
 begin perform public.admin_definir_assinatura('e2000000-0000-4000-8000-000000000001','{"extras":["robo_magico"]}'); raise exception 'extra inválido entrou';
 exception when check_violation then null; end;
 perform public.admin_definir_assinatura(a,jsonb_build_object('ia_extra_usos',1000,'ia_extra_mes',current_date));
 if (public.plano_efetivo_titular(a)->>'ia_mes')::int<>1000 then raise exception 'IA extra do mês: %',public.plano_efetivo_titular(a); end if;
 perform public.admin_definir_assinatura(a,jsonb_build_object('ia_extra_mes',(current_date-interval '1 month')::date));
 if (public.plano_efetivo_titular(a)->>'ia_mes')::int<>0 then raise exception 'IA extra de outro mês ainda vale'; end if;
end $$;
do $$
begin
 begin insert into public.operacao_membros(organizacao_id,usuario_id,papel) values ('e2000000-0000-4000-8000-00000000000a','e2000000-0000-4000-8000-000000000006','leitura'); raise exception 'passou do limite de usuários';
 exception when raise_exception then if sqlerrm not like 'Limite de 2 usuários%' then raise; end if; end;
end $$;

-- 22/11: carência da cobrança (padrão 3 dias, config_cobranca). Dentro dela tudo continua, com aviso; depois, só boletim.
do $$
declare a uuid:='e2000000-0000-4000-8000-000000000002'; v jsonb;
begin
 if public.carencia_cobranca()<>3 then raise exception 'carência padrão: %',public.carencia_cobranca(); end if;
 update public.assinaturas set vence_em=current_date-3 where usuario_id=a;
 v:=public.plano_efetivo_titular(a);
 if v->>'plano'<>'assessoria' or not (v->>'em_carencia')::boolean or (v->>'carencia_ate')::date<>current_date then raise exception 'carência de 3 dias: %',v; end if;
 update public.assinaturas set vence_em=current_date-4 where usuario_id=a;
 v:=public.plano_efetivo_titular(a);
 if v->>'plano'<>'gratis' or not (v->>'bloqueado')::boolean or (v->>'em_carencia')::boolean then raise exception 'vencida não caiu para Teste encerrado: %',v; end if;
 -- Em dia: sem aviso de carência.
 update public.assinaturas set vence_em=current_date where usuario_id=a;
 if (public.plano_efetivo_titular(a)->>'em_carencia')::boolean then raise exception 'em dia marcou carência'; end if;
end $$;
-- 22/11: ciclo semestral, pedido de compra com Pix manual, liberação só pelo dono com 2 fatores, vencimento e
-- isolamento (o cliente só vê os pedidos dele). P = titular novo (Empresa), Q = outro titular, D = dono.
insert into auth.users(id,email) values
 ('e2000000-0000-4000-8000-000000000011','pl-p@qa.invalid'),('e2000000-0000-4000-8000-000000000012','pl-q@qa.invalid');
insert into public.clientes(id,nome,email,empresa,status,plano) values
 ('e2000000-0000-4000-8000-000000000011','QA P','pl-p@qa.invalid','QA P LTDA','aprovado','empresa'),
 ('e2000000-0000-4000-8000-000000000012','QA Q','pl-q@qa.invalid','QA Q LTDA','aprovado','assessoria');
do $$
begin
 -- Preços semestrais (6 x mensal x 0,9, real inteiro) e extras com a mesma regra.
 if (select string_agg(codigo||'='||preco_semestral_centavos||'/'||preco_anual_centavos, ',' order by ordem) from public.planos where codigo in ('essencial','empresa','assessoria'))
   <>'essencial=68600/127000,empresa=134500/249000,assessoria=376400/697000' then raise exception 'preços semestrais: %',
   (select string_agg(codigo||'='||preco_semestral_centavos, ',') from public.planos); end if;
 if (select string_agg(codigo||'='||preco_semestral_centavos||'/'||preco_anual_centavos, ',' order by codigo) from public.precos_extras)
   <>'cnpj_extra=107500/199000,ia_extra=26500/49000,lance_assistido=52400/97000,pacote_operacao=26500/49000' then raise exception 'preços dos extras'; end if;
 if public.valor_do_pedido('empresa','semestral','{}',0)<>134500 then raise exception 'Empresa semestral'; end if;
 if public.valor_do_pedido('empresa','mensal','{lance_assistido,ia_extra}',0)<>24900+9700+4900 then raise exception 'Empresa com extras'; end if;
 -- Assessoria: Lance por CNPJ (3 + 1 extra = 4) e CNPJ extra anual.
 if public.valor_do_pedido('assessoria','anual','{lance_assistido}',1)<>697000+199000+4*97000 then raise exception 'Assessoria com CNPJ extra e Lance: %',public.valor_do_pedido('assessoria','anual','{lance_assistido}',1); end if;
end $$;
set local role authenticated;
do $$
declare p uuid:='e2000000-0000-4000-8000-000000000011'; q uuid:='e2000000-0000-4000-8000-000000000012'; v jsonb; n int;
begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',p,'aal','aal1')::text,true);
 begin perform public.pedir_assinatura('empresa','trimestral'); raise exception 'ciclo inválido aceito';
 exception when raise_exception then if sqlerrm not like 'Escolha mensal%' then raise; end if; end;
 begin perform public.pedir_assinatura('dono','mensal'); raise exception 'pediu plano Dono';
 exception when raise_exception then if sqlerrm not like 'Plano indisponível%' then raise; end if; end;
 begin perform public.pedir_assinatura('empresa','mensal','{}',2); raise exception 'CNPJ extra fora da Assessoria';
 exception when raise_exception then if sqlerrm not like 'CNPJ extra%' then raise; end if; end;
 begin perform public.pedir_assinatura('empresa','mensal','{robo_magico}'); raise exception 'extra inválido no pedido';
 exception when raise_exception then if sqlerrm not like 'Extra inválido%' then raise; end if; end;
 -- Pedido novo substitui o anterior em aberto; o valor vem do banco.
 perform public.pedir_assinatura('essencial','mensal');
 v := public.pedir_assinatura('empresa','semestral');
 if (v->>'valor_centavos')::int<>134500 or v->>'situacao'<>'aguardando' then raise exception 'pedido Empresa semestral: %',v; end if;
 if (select count(*) from public.pedidos where situacao='aguardando')<>1 or (select count(*) from public.pedidos)<>2 then raise exception 'pedido anterior não foi substituído'; end if;
 -- Cliente não grava nem muda pedido direto, não libera e não chama a lista do admin.
 begin insert into public.pedidos(usuario_id,plano,ciclo,valor_centavos) values (p,'empresa','anual',1); raise exception 'cliente gravou pedido';
 exception when insufficient_privilege then null; end;
 begin update public.pedidos set valor_centavos=1 where usuario_id=p; raise exception 'cliente mudou o valor';
 exception when insufficient_privilege then null; end;
 begin perform public.admin_decidir_pedido((v->>'id')::uuid,'liberar'); raise exception 'cliente liberou o próprio pedido';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',json_build_object('sub',p,'aal','aal2')::text,true);
 begin perform public.admin_decidir_pedido((v->>'id')::uuid,'liberar'); raise exception 'cliente com 2 fatores liberou';
 exception when insufficient_privilege then null; end;
 begin perform public.admin_listar_pedidos(); raise exception 'cliente listou pedidos de todos';
 exception when insufficient_privilege then null; end;
 -- Q faz o pedido dele; cada um só vê o seu.
 perform set_config('request.jwt.claim.sub',q::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',q,'aal','aal1')::text,true);
 perform public.pedir_assinatura('assessoria','anual','{lance_assistido}',1);
 select count(*) into n from public.pedidos;
 if n<>1 or exists (select 1 from public.pedidos where usuario_id<>q) then raise exception 'Q vê pedido de outra conta'; end if;
 perform set_config('request.jwt.claim.sub',p::text,true);
 if exists (select 1 from public.pedidos where usuario_id<>p) then raise exception 'P vê pedido de outra conta'; end if;
 -- Membro de outra organização não pede pelo titular.
 perform set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000004',true);
 begin perform public.pedir_assinatura('empresa','mensal'); raise exception 'membro pediu assinatura';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Dono (fora do papel authenticated, para achar os pedidos de todos): sem 2 fatores não libera; com 2 fatores libera, recusa e pede correção (com motivo).
do $$
declare d uuid:='e2000000-0000-4000-8000-000000000005'; p uuid:='e2000000-0000-4000-8000-000000000011'; q uuid:='e2000000-0000-4000-8000-000000000012';
 gp uuid; gq uuid; v jsonb; l jsonb;
begin
 perform set_config('request.jwt.claim.sub',d::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',d,'aal','aal1')::text,true);
 select id into gp from public.pedidos where usuario_id=p and situacao='aguardando';
 begin perform public.admin_decidir_pedido(gp,'liberar'); raise exception 'dono sem 2 fatores liberou';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',json_build_object('sub',d,'aal','aal2')::text,true);
 l := public.admin_listar_pedidos();
 if jsonb_array_length(l->'pedidos')<3 or (l->'pedidos'->0->>'situacao')<>'aguardando' or (l->'pedidos'->0->>'empresa') is null then raise exception 'lista do admin: %',l; end if;
 if exists (select 1 from jsonb_array_elements(public.admin_resumo()->'avisos') x where x->>'tipo'='pedido_aguardando' and x->>'usuario_id'=p::text) is not true then raise exception 'aviso de pedido'; end if;
 begin perform public.admin_decidir_pedido(gp,'recusar',''); raise exception 'recusou sem motivo';
 exception when raise_exception then if sqlerrm not like 'Escreva o motivo%' then raise; end if; end;
 v := public.admin_decidir_pedido(gp,'correcao','Valor do Pix diferente do pedido');
 if v->>'situacao'<>'correcao' then raise exception 'pedir correção'; end if;
 v := public.admin_decidir_pedido(gp,'liberar');
 if v->>'situacao'<>'liberado' or (v->>'vence_em')::date<>(current_date+interval '6 months')::date then raise exception 'liberação semestral: %',v; end if;
 begin perform public.admin_decidir_pedido(gp,'liberar'); raise exception 'liberou duas vezes';
 exception when raise_exception then if sqlerrm not like 'Este pedido já foi%' then raise; end if; end;
 if (select plano||'/'||situacao||'/'||ciclo||'/'||valor_centavos||'/'||vence_em from public.assinaturas where usuario_id=p)
   <>'empresa/ativa/semestral/134500/'||(current_date+interval '6 months')::date then raise exception 'assinatura de P: %',(select to_jsonb(a) from public.assinaturas a where usuario_id=p); end if;
 if (select metodo||'/'||gateway||'/'||situacao||'/'||ciclo||'/'||valor_centavos from public.pagamentos where usuario_id=p)<>'pix/pix_manual/pago/semestral/134500' then raise exception 'pagamento de P'; end if;
 -- Assessoria anual com 1 CNPJ extra e Lance: 12 meses, 4 CNPJs, extra ligado.
 select id into gq from public.pedidos where usuario_id=q and situacao='aguardando';
 v := public.admin_decidir_pedido(gq,'liberar');
 if (select max_cnpjs||'/'||array_to_string(extras,',')||'/'||vence_em from public.assinaturas where usuario_id=q)<>'4/lance_assistido/'||(current_date+interval '1 year')::date then raise exception 'assinatura de Q: %',(select to_jsonb(a) from public.assinaturas a where usuario_id=q); end if;
 -- Renovação antes de vencer soma ao vencimento atual.
 update public.assinaturas set vence_em=current_date+3 where usuario_id=p;
 if not exists (select 1 from jsonb_array_elements(public.admin_listar_pedidos()->'vencendo') x where x->>'usuario_id'=p::text) then raise exception 'P não está em vencendo'; end if;
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',p,'aal','aal1')::text,true);
 perform public.pedir_assinatura('empresa','mensal','{ia_extra}');
 perform set_config('request.jwt.claim.sub',d::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',d,'aal','aal2')::text,true);
 select id into gp from public.pedidos where usuario_id=p and situacao='aguardando';
 v := public.admin_decidir_pedido(gp,'liberar');
 if (v->>'vence_em')::date<>(current_date+3+interval '1 month')::date then raise exception 'renovação não somou: %',v; end if;
 -- Recusar com motivo: o cliente vê o motivo.
 perform set_config('request.jwt.claim.sub',q::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',q,'aal','aal1')::text,true);
 perform public.pedir_assinatura('assessoria','mensal');
 perform set_config('request.jwt.claim.sub',d::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',d,'aal','aal2')::text,true);
 select id into gq from public.pedidos where usuario_id=q and situacao='aguardando';
 perform public.admin_decidir_pedido(gq,'recusar','Pix não encontrado');
end $$;
-- O cliente vê o motivo da recusa no pedido dele.
set local role authenticated;
do $$
begin
 perform set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000012',true);
 if (select motivo from public.pedidos where situacao='recusado')<>'Pix não encontrado' then raise exception 'cliente não vê o motivo'; end if;
end $$;
reset role;
do $$
declare p uuid:='e2000000-0000-4000-8000-000000000011';
begin
 -- IA extra comprada no ciclo vale todo mês até o vencimento (Empresa 1.000 + 500).
 if (public.plano_efetivo_titular(p)->>'ia_mes')::int<>1500 then raise exception 'IA extra do ciclo: %',public.plano_efetivo_titular(p)->>'ia_mes'; end if;
 update public.assinaturas set ia_extra_mes=(current_date-interval '2 months')::date where usuario_id=p;
 if (public.plano_efetivo_titular(p)->>'ia_mes')::int<>1500 then raise exception 'IA extra sumiu antes do vencimento'; end if;
 update public.assinaturas set ia_extra_ate=current_date-1 where usuario_id=p;
 if (public.plano_efetivo_titular(p)->>'ia_mes')::int<>1000 then raise exception 'IA extra depois do vencimento'; end if;
 -- Vencida e não renovada: igual ao teste vencido, só boletim.
 update public.assinaturas set vence_em=current_date-6 where usuario_id=p;
 if public.plano_efetivo_titular(p)->>'plano'<>'gratis' or not (public.plano_efetivo_titular(p)->>'bloqueado')::boolean then raise exception 'semestral vencido não travou'; end if;
 -- admin_registrar_pagamento entende o semestral.
 perform set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000005',true);
 perform set_config('request.jwt.claims',json_build_object('sub','e2000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
 perform public.admin_registrar_pagamento(p,'{"plano":"essencial","ciclo":"semestral"}');
 if not exists (select 1 from public.pagamentos where usuario_id=p and situacao='pendente' and valor_centavos=68600 and ciclo='semestral') then raise exception 'cobrança semestral manual'; end if;
end $$;
-- 22/11: Cobrança. R = titular Essencial mensal; o robô bloqueia depois da carência, a trava vale nas rotas
-- (consumir_uso_plano) e nos limites; renovar volta tudo; só o dono com 2 fatores vê e mexe; nada é apagado.
insert into auth.users(id,email) values ('e2000000-0000-4000-8000-000000000031','pl-r@qa.invalid');
insert into public.clientes(id,nome,email,status,plano,telefone) values ('e2000000-0000-4000-8000-000000000031','QA R','pl-r@qa.invalid','aprovado','essencial','92999990000');
do $$
declare r uuid:='e2000000-0000-4000-8000-000000000031'; d uuid:='e2000000-0000-4000-8000-000000000005'; v jsonb; n integer;
begin
 update public.assinaturas set plano='essencial', situacao='ativa', ciclo='mensal', valor_centavos=12700, vence_em=current_date-2 where usuario_id=r;
 -- Na carência: rota de IA continua liberada.
 if not (public.consumir_uso_plano(r,'ia-edital',10)->>'permitido')::boolean then raise exception 'carência travou a rota'; end if;
 -- Cliente não chama o robô nem a lista do admin.
 perform set_config('request.jwt.claim.sub',r::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',r,'aal','aal1')::text,true);
 set local role authenticated;
 begin perform public.cobranca_rodar_diario(); raise exception 'cliente rodou o robô'; exception when insufficient_privilege then null; end;
 begin perform public.admin_cobranca(); raise exception 'cliente viu a cobrança'; exception when insufficient_privilege then null; end;
 begin perform public.admin_definir_carencia(10); raise exception 'cliente mudou a carência'; exception when insufficient_privilege then null; end;
 reset role;
 -- Dono com 2 fatores: R aparece em atraso, há 2 dias, valor R$ 127.
 perform set_config('request.jwt.claim.sub',d::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',d,'aal','aal2')::text,true);
 set local role authenticated;
 v:=public.admin_cobranca();
 reset role;
 if not exists (select 1 from jsonb_array_elements(v->'em_atraso') x where x->>'usuario_id'=r::text and (x->>'dias_atraso')::int=2
   and (x->>'valor_centavos')::int=12700 and x->>'plano_nome'='Essencial' and x->>'telefone'='92999990000') then raise exception 'em atraso: %',v->'em_atraso'; end if;
 if (v->>'em_atraso_centavos')::int<12700 then raise exception 'total em atraso: %',v; end if;
 -- Robô: dentro da carência não bloqueia.
 v:=public.cobranca_rodar_diario();
 if (select situacao from public.assinaturas where usuario_id=r)<>'ativa' then raise exception 'robô bloqueou na carência'; end if;
 -- Passou da carência: robô marca vencida uma vez, a rota recusa e os dados continuam.
 update public.assinaturas set vence_em=current_date-4 where usuario_id=r;
 v:=public.cobranca_rodar_diario();
 if not exists (select 1 from jsonb_array_elements(v->'bloqueados') x where x->>'usuario_id'=r::text and x->>'email'='pl-r@qa.invalid') then raise exception 'robô não bloqueou: %',v; end if;
 if (select situacao from public.assinaturas where usuario_id=r)<>'vencida' then raise exception 'situação depois do robô'; end if;
 if exists (select 1 from jsonb_array_elements(public.cobranca_rodar_diario()->'bloqueados') x where x->>'usuario_id'=r::text) then raise exception 'bloqueou duas vezes'; end if;
 if (public.consumir_uso_plano(r,'ia-edital',10)->>'permitido')::boolean then raise exception 'bloqueado usou a rota'; end if;
 if public.plano_efetivo_titular(r)->>'plano'<>'gratis' or public.plano_efetivo_titular(r)->>'situacao'<>'vencida' then raise exception 'bloqueado: %',public.plano_efetivo_titular(r); end if;
 if not exists (select 1 from public.clientes where id=r) then raise exception 'apagou o cliente'; end if;
 select count(*) into n from public.assinaturas_historico where usuario_id=r and acao='bloqueio_por_atraso';
 if n<>1 then raise exception 'histórico do bloqueio: %',n; end if;
 -- Lembretes: vence em 3 dias e vence hoje.
 update public.assinaturas set situacao='ativa', vence_em=current_date+3 where usuario_id=r;
 if not exists (select 1 from jsonb_array_elements(public.cobranca_rodar_diario()->'lembretes') x where x->>'usuario_id'=r::text and x->>'tipo'='vence_em_3_dias') then raise exception 'lembrete 3 dias'; end if;
 update public.assinaturas set vence_em=current_date where usuario_id=r;
 if not exists (select 1 from jsonb_array_elements(public.cobranca_rodar_diario()->'lembretes') x where x->>'usuario_id'=r::text and x->>'tipo'='vence_hoje') then raise exception 'lembrete hoje'; end if;
 -- Dono muda a carência para 7: vencida há 5 dias volta a usar (na carência).
 update public.assinaturas set situacao='ativa', vence_em=current_date-5 where usuario_id=r;
 set local role authenticated;
 begin perform public.admin_definir_carencia(31); raise exception 'aceitou 31 dias'; exception when raise_exception then if sqlerrm not like 'A carência vai de 0 a 30%' then raise; end if; end;
 perform public.admin_definir_carencia(7);
 reset role;
 if public.plano_efetivo_titular(r)->>'plano'<>'essencial' then raise exception 'carência de 7 dias não valeu'; end if;
 -- Bloqueado há menos de 30 dias + Recebi: renovar = ativa por 1 mês a partir do VENCIMENTO ORIGINAL (carência 7:
 -- venceu há 20, bloqueado há 13), pelo mesmo ponto único do pagamento.
 update public.assinaturas set situacao='vencida', vence_em=current_date-20 where usuario_id=r;
 set local role authenticated;
 v:=public.admin_renovar_assinatura(r);
 reset role;
 if (select situacao||'/'||plano||'/'||vence_em from public.assinaturas where usuario_id=r)<>'ativa/essencial/'||(current_date-20+interval '1 month')::date then raise exception 'renovar bloqueado < 30 dias: %',(select to_jsonb(a) from public.assinaturas a where usuario_id=r); end if;
 if not exists (select 1 from public.pagamentos where usuario_id=r and situacao='pago' and valor_centavos=12700 and referencia='Renovação') then raise exception 'pagamento da renovação'; end if;
 if public.plano_efetivo_titular(r)->>'plano'<>'essencial' then raise exception 'renovado continua travado'; end if;
 -- Pagou na carência (venceu há 2 dias): renova do vencimento original, sem ganhar os 2 dias.
 update public.assinaturas set situacao='ativa', vence_em=current_date-2 where usuario_id=r;
 set local role authenticated; perform public.admin_renovar_assinatura(r); reset role;
 if (select vence_em from public.assinaturas where usuario_id=r)<>(current_date-2+interval '1 month')::date then raise exception 'renovar na carência: %',(select vence_em from public.assinaturas where usuario_id=r); end if;
 -- Bloqueado há mais de 30 dias (venceu há 60, carência 7): ciclo novo a partir do dia do pagamento.
 update public.assinaturas set situacao='vencida', vence_em=current_date-60 where usuario_id=r;
 set local role authenticated; perform public.admin_renovar_assinatura(r); reset role;
 if (select vence_em from public.assinaturas where usuario_id=r)<>(current_date+interval '1 month')::date then raise exception 'renovar bloqueado > 30 dias: %',(select vence_em from public.assinaturas where usuario_id=r); end if;
 -- Bloqueado há 28 dias, mas o mês contado do vencimento original já passou: também começa hoje (senão voltaria vencido).
 update public.assinaturas set situacao='vencida', vence_em=current_date-35 where usuario_id=r;
 set local role authenticated; perform public.admin_renovar_assinatura(r); reset role;
 if (select vence_em from public.assinaturas where usuario_id=r)<>(current_date+interval '1 month')::date then raise exception 'renovar com período passado: %',(select vence_em from public.assinaturas where usuario_id=r); end if;
end $$;
-- 22/11: fuso. Relógio simulado em 22/11/2026 às 22h de Brasília (01h de 23/11 em UTC): tudo conta o dia 22.
create or replace function public.agora_brasilia() returns timestamp
language sql stable set search_path = public as $$ select '2026-11-23 01:00:00+00'::timestamptz at time zone 'America/Sao_Paulo' $$;
update public.config_cobranca set carencia_dias = 3 where id = 1;
do $$
declare r uuid:='e2000000-0000-4000-8000-000000000031'; v jsonb;
begin
 if public.hoje_brasilia()<>'2026-11-22' then raise exception '22h de Brasília virou: %',public.hoje_brasilia(); end if;
 if ('2026-11-23 01:00:00+00'::timestamptz at time zone 'UTC')::date<>'2026-11-23' then raise exception 'em UTC seria dia 23'; end if;
 -- Vence hoje (22): admin e robô dizem "vence hoje", não "em atraso".
 update public.assinaturas set situacao='ativa', vence_em='2026-11-22' where usuario_id=r;
 set local role authenticated; v:=public.admin_cobranca(); reset role;
 if v->>'hoje'<>'2026-11-22' or not exists (select 1 from jsonb_array_elements(v->'vence_hoje') x where x->>'usuario_id'=r::text) then raise exception 'vence hoje às 22h: %',v; end if;
 if not exists (select 1 from jsonb_array_elements(public.cobranca_rodar_diario()->'lembretes') x where x->>'usuario_id'=r::text and x->>'tipo'='vence_hoje') then raise exception 'lembrete vence hoje às 22h'; end if;
 if (public.plano_efetivo_titular(r)->>'em_carencia')::boolean then raise exception 'vence hoje às 22h entrou na carência'; end if;
 -- Vencendo em 7 dias (29) entra; 30 não.
 update public.assinaturas set vence_em='2026-11-29' where usuario_id=r;
 set local role authenticated; v:=public.admin_cobranca(); reset role;
 if not exists (select 1 from jsonb_array_elements(v->'vencendo') x where x->>'usuario_id'=r::text) then raise exception 'vencendo em 7 dias às 22h'; end if;
 update public.assinaturas set vence_em='2026-11-30' where usuario_id=r;
 set local role authenticated; v:=public.admin_cobranca(); reset role;
 if exists (select 1 from jsonb_array_elements(v->'vencendo') x where x->>'usuario_id'=r::text) then raise exception 'vencendo em 8 dias às 22h'; end if;
 -- Último dia da carência (venceu 19, carência 3 até 22): continua usando e o robô não bloqueia.
 update public.assinaturas set vence_em='2026-11-19' where usuario_id=r;
 v:=public.plano_efetivo_titular(r);
 if v->>'plano'<>'essencial' or not (v->>'em_carencia')::boolean then raise exception 'carência às 22h: %',v; end if;
 perform public.cobranca_rodar_diario();
 if (select situacao from public.assinaturas where usuario_id=r)<>'ativa' then raise exception 'robô bloqueou às 22h no último dia da carência'; end if;
 -- Pagou às 22h na carência: renova do vencimento original (19/12).
 set local role authenticated; perform public.admin_renovar_assinatura(r); reset role;
 if (select vence_em from public.assinaturas where usuario_id=r)<>'2026-12-19' then raise exception 'renovar às 22h: %',(select vence_em from public.assinaturas where usuario_id=r); end if;
end $$;
rollback;
