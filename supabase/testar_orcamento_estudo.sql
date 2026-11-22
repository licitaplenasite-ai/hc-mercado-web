-- Teste de orcamento_estudo.sql: estatísticas legíveis por cliente aprovado e motivos de recusa DESLIGADOS por padrão.
-- Dados fictícios e rollback. Papéis simulados com "set local role" + request.jwt.claims; não prova a API HTTP.
-- A e B clientes aprovados, P pendente, D dono (owner). A aceita ajudar; B não.
begin;
insert into auth.users(id,email) values ('e5000000-0000-4000-8000-000000000001','oe-a@qa.invalid'),('e5000000-0000-4000-8000-000000000002','oe-b@qa.invalid'),
 ('e5000000-0000-4000-8000-000000000003','oe-p@qa.invalid'),('e5000000-0000-4000-8000-000000000004','oe-d@qa.invalid');
insert into public.admins(email,nome,role) values ('oe-d@qa.invalid','QA dono estudo','owner');
insert into public.clientes(id,nome,email,status) values ('e5000000-0000-4000-8000-000000000001','QA A','oe-a@qa.invalid','aprovado'),('e5000000-0000-4000-8000-000000000002','QA B','oe-b@qa.invalid','aprovado'),
 ('e5000000-0000-4000-8000-000000000003','QA P','oe-p@qa.invalid','pendente'),('e5000000-0000-4000-8000-000000000004','QA D','oe-d@qa.invalid','aprovado');

-- Robô grava disputas e estatísticas; recortes e checks.
set local role service_role;
insert into public.orcamento_estudo_disputas(id_compra,uf,tipo_obra,faixa_valor,valor_estimado,participantes,desconto_vencedor,recusadas_mais_baratas,fonte)
values ('99999999999999901','AM','reforma','ate_1mi',500000,12,18.5,2,'comprasgov');
insert into public.orcamento_estudo_estatisticas(recorte,n,dados) values ('uf:AM|reforma|*',24,'{"desconto_mediana":17.4}'),('BR|*|*',1466,'{"desconto_mediana":18.4}');
do $$ begin
 begin insert into public.orcamento_estudo_estatisticas(recorte,n,dados) values ('uf:AM; drop table x|*|*',1,'{}'); raise exception 'recorte inválido aceito';
 exception when check_violation then null; end;
 begin insert into public.orcamento_estudo_disputas(id_compra,tipo_obra,faixa_valor,valor_estimado,participantes,desconto_vencedor,fonte) values ('1','reforma','ate_1mi',1,1,1,'comprasgov'); raise exception 'id_compra inválido aceito';
 exception when check_violation then null; end;
 begin insert into public.orcamento_estudo_disputas(id_compra,tipo_obra,faixa_valor,valor_estimado,participantes,desconto_vencedor,fonte) values ('99999999999999902','reforma','ate_1mi',1,1,1,'blog'); raise exception 'fonte inválida aceita';
 exception when check_violation then null; end;
 if (select ligado from public.orcamento_motivos_config) then raise exception 'coleta de motivos nasceu ligada'; end if;
end $$;
reset role;

-- Um pregão gravado pela extensão com uma recusa, lido por A e por B.
set local role service_role;
select public.gravar_pregao_gravado('{"compra":"99999999999999903","fonte":"comprasgov","url":"https://cnetmobile.estaleiro.serpro.gov.br/x",
  "cabecalho":{"uasg":"999999","orgao":"ORGAO QA","numero":"90001","ano":2026,"modalidade":"Concorrência Eletrônica"},
  "itens":[{"numero":1,"descricao":"Reforma do prédio sede","situacao":"Homologado","propostasLidas":true,
    "propostas":[{"chave":"11222333000181","cnpj":"11222333000181","nome":"ALFA QA LTDA","valorOfertado":10}],
    "mensagens":[{"fornecedor":"11222333000181","dataHora":"2026-10-07T09:44:00","autor":"orgao","texto":"Recusada a proposta da ALFA QA LTDA: CPU incompleta.","tipo":"recusa","motivo":"CPU incompleta."}]}]}'::jsonb,
  'e5000000-0000-4000-8000-000000000002');
do $$ begin
 -- Desligado: nada sai para o robô, mesmo com mensagem de recusa gravada.
 if (select count(*) from public.orcamento_motivos_para_coletar(100))<>0 then raise exception 'coleta desligada devolveu motivo'; end if;
end $$;
reset role;

-- Cliente aprovado: lê estatísticas; não aceita enquanto desligado; não liga; não lê aceite alheio.
set local role authenticated;
do $$ begin
 perform set_config('request.jwt.claim.sub','e5000000-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims',json_build_object('sub','e5000000-0000-4000-8000-000000000001','aal','aal2')::text,true);
 if (select n from public.orcamento_estudo_estatisticas where recorte='uf:AM|reforma|*')<>24 then raise exception 'aprovado não lê estatística'; end if;
 if (select count(*) from public.orcamento_estudo_disputas where id_compra='99999999999999901')<>1 then raise exception 'aprovado não lê disputa'; end if;
 if (select ligado from public.orcamento_motivos_config) then raise exception 'config deveria vir desligada'; end if;
 begin insert into public.orcamento_motivos_consentimento(versao_texto) values ('2026-11-22'); raise exception 'aceitou com a coleta desligada';
 exception when insufficient_privilege then null; end;
 begin perform public.admin_ligar_motivos_recusa(true); raise exception 'cliente ligou a coleta';
 exception when insufficient_privilege then null; end;
 begin update public.orcamento_motivos_config set ligado=true; raise exception 'cliente mexeu na config';
 exception when insufficient_privilege then null; end;
 begin insert into public.orcamento_estudo_estatisticas(recorte,n,dados) values ('BR|x|*',1,'{}'); raise exception 'cliente gravou estatística';
 exception when insufficient_privilege then null; end;
 begin perform * from public.orcamento_motivos_para_coletar(10); raise exception 'cliente chamou a função do robô';
 exception when insufficient_privilege then null; end;
end $$;
-- Pendente não lê o estudo.
do $$ begin
 perform set_config('request.jwt.claim.sub','e5000000-0000-4000-8000-000000000003',true);
 if (select count(*) from public.orcamento_estudo_estatisticas)<>0 then raise exception 'pendente leu estatística'; end if;
end $$;
-- Dono com 2 fatores liga a coleta.
do $$ begin
 perform set_config('request.jwt.claim.sub','e5000000-0000-4000-8000-000000000004',true);
 perform set_config('request.jwt.claims',json_build_object('sub','e5000000-0000-4000-8000-000000000004','aal','aal2')::text,true);
 perform public.admin_ligar_motivos_recusa(true);
end $$;
-- B aceita (A não): agora pode; não aceita em nome de outro.
do $$ begin
 perform set_config('request.jwt.claim.sub','e5000000-0000-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims',json_build_object('sub','e5000000-0000-4000-8000-000000000002','aal','aal1')::text,true);
 begin insert into public.orcamento_motivos_consentimento(usuario_id,versao_texto) values ('e5000000-0000-4000-8000-000000000001','2026-11-22'); raise exception 'aceitou por outro';
 exception when insufficient_privilege then null; end;
 insert into public.orcamento_motivos_consentimento(versao_texto) values ('2026-11-22');
 if (select count(*) from public.orcamento_motivos_consentimento)<>1 then raise exception 'não vê o próprio aceite'; end if;
end $$;
do $$ begin
 perform set_config('request.jwt.claim.sub','e5000000-0000-4000-8000-000000000001',true);
 if (select count(*) from public.orcamento_motivos_consentimento)<>0 then raise exception 'A viu o aceite de B'; end if;
end $$;
reset role;

-- Ligado + aceite de quem gravou: o robô recebe a mensagem, com a descrição do item e os nomes para apagar.
set local role service_role;
do $$ declare r record; begin
 select * into r from public.orcamento_motivos_para_coletar(100) where descricao_item='Reforma do prédio sede';
 if r.chave is null then raise exception 'ligado e com aceite não devolveu a recusa'; end if;
 if not ('ALFA QA LTDA' = any(r.nomes)) then raise exception 'nomes para apagar não vieram'; end if;
 insert into public.orcamento_motivos_recusa(chave,tipo,categoria,motivo,tipo_obra) values (r.chave,'recusa','cpu','Recusada a proposta da [empresa]: CPU incompleta.','reforma');
 if (select count(*) from public.orcamento_motivos_para_coletar(100) where descricao_item='Reforma do prédio sede')<>0 then raise exception 'mensagem já coletada voltou'; end if;
 begin insert into public.orcamento_motivos_recusa(chave,tipo,categoria,motivo) values (md5('x'),'recusa','cpu','CNPJ 11222333000181 recusado'); raise exception 'motivo com CNPJ aceito';
 exception when check_violation then null; end;
 begin insert into public.orcamento_motivos_recusa(chave,tipo,categoria,motivo) values (md5('y'),'recusa','cpu','fale com a@b.com'); raise exception 'motivo com e-mail aceito';
 exception when check_violation then null; end;
end $$;
reset role;
-- B retira o aceite; a próxima recusa não vai mais.
set local role authenticated;
do $$ begin
 perform set_config('request.jwt.claim.sub','e5000000-0000-4000-8000-000000000002',true);
 delete from public.orcamento_motivos_consentimento;
end $$;
reset role;
set local role service_role;
delete from public.orcamento_motivos_recusa where motivo like 'Recusada a proposta da [empresa]%';
do $$ begin
 if (select count(*) from public.orcamento_motivos_para_coletar(100) where descricao_item='Reforma do prédio sede')<>0 then raise exception 'aceite retirado e a mensagem ainda sai'; end if;
end $$;
reset role;
rollback;
