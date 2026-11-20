-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Banco local (ambiente-teste) com funil_v3.sql aplicado. Fixtures sintéticas e rollback.
-- RLS simulada com "set local role" + request.jwt.claim.sub. Gestor f9..01 (org inteira), operador f9..02 só da empresa B,
-- f9..03 gestor de outra organização.
begin;
insert into auth.users(id,email) values
 ('f9000000-0000-4000-8000-000000000001','funil3-a@qa.invalid'),('f9000000-0000-4000-8000-000000000002','funil3-b@qa.invalid'),
 ('f9000000-0000-4000-8000-000000000003','funil3-x@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f9000000-0000-4000-8000-000000000001','QA funil3 A','funil3-a@qa.invalid','aprovado'),
 ('f9000000-0000-4000-8000-000000000002','QA funil3 B','funil3-b@qa.invalid','aprovado'),
 ('f9000000-0000-4000-8000-000000000003','QA funil3 X','funil3-x@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f9000000-0000-4000-8000-00000000000a','QA funil3','f9000000-0000-4000-8000-000000000001'),
 ('f9000000-0000-4000-8000-00000000000b','QA funil3 outra','f9000000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('f9000000-0000-4000-8000-00000000001a','f9000000-0000-4000-8000-00000000000a','QA funil3 empresa A','11222333000181'),
 ('f9000000-0000-4000-8000-00000000001b','f9000000-0000-4000-8000-00000000000a','QA funil3 empresa B','22333444000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f9000000-0000-4000-8000-00000000000a','f9000000-0000-4000-8000-000000000001','gestor',null),
 ('f9000000-0000-4000-8000-00000000000a','f9000000-0000-4000-8000-000000000002','operador','f9000000-0000-4000-8000-00000000001b'),
 ('f9000000-0000-4000-8000-00000000000b','f9000000-0000-4000-8000-000000000003','gestor',null);
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,origem_externa_id,status) values
 ('f9000000-0000-4000-8000-000000000021','f9000000-0000-4000-8000-00000000000a','f9000000-0000-4000-8000-00000000001a','QA A','11222333000181-1-000001/2026','triagem');
insert into public.operacao_anexos_processo(id,organizacao_id,processo_id,tipo,titulo,arquivo_caminho,arquivo_nome) values
 ('f9000000-0000-4000-8000-000000000031','f9000000-0000-4000-8000-00000000000a','f9000000-0000-4000-8000-000000000021','outro','Proposta',
  'f9000000-0000-4000-8000-00000000000a/f9000000-0000-4000-8000-00000000001a/f9000000-0000-4000-8000-000000000021/proposta.pdf','proposta.pdf');

set local role authenticated;
select set_config('request.jwt.claim.sub','f9000000-0000-4000-8000-000000000001',true);
do $$
declare ok jsonb := '{"secoes":[{"id":"s1","nome":"Leitura","tarefas":[{"id":"t1","titulo":"Ler o edital","quando":"2026-12-01T10:00"},
  {"id":"t2","titulo":"Resumir","exige":"resposta"},{"id":"t3","titulo":"Anexar proposta","exige":"documento"},
  {"id":"t4","titulo":"Impugnar","auto":"impugnacao"}]}],"datas":{"aviso_recurso":"2026-12-10"}}';
begin
 update public.operacao_processos set tarefas_card = ok where id='f9000000-0000-4000-8000-000000000021';
 if not found then raise exception 'Gestor não gravou tarefas'; end if;
 -- Pergunta sem resposta não fecha.
 begin update public.operacao_processos set tarefas_card = jsonb_set(ok,'{secoes,0,tarefas,1,feita_em}','"2026-11-20T10:00:00Z"')
   where id='f9000000-0000-4000-8000-000000000021'; raise exception 'Fechou sem resposta'; exception when check_violation then null; end;
 update public.operacao_processos set tarefas_card = jsonb_set(jsonb_set(ok,'{secoes,0,tarefas,1,feita_em}','"2026-11-20T10:00:00Z"'),'{secoes,0,tarefas,1,resposta}','"Prazo de entrega 10 dias"')
   where id='f9000000-0000-4000-8000-000000000021';
 -- CPF na resposta é recusado.
 begin update public.operacao_processos set tarefas_card = jsonb_set(jsonb_set(ok,'{secoes,0,tarefas,1,feita_em}','"2026-11-20T10:00:00Z"'),'{secoes,0,tarefas,1,resposta}','"Falar com 123.456.789-09"')
   where id='f9000000-0000-4000-8000-000000000021'; raise exception 'Aceitou CPF'; exception when check_violation then null; end;
 -- Documento só fecha com anexo do mesmo processo.
 begin update public.operacao_processos set tarefas_card = jsonb_set(ok,'{secoes,0,tarefas,2,feita_em}','"2026-11-20T10:00:00Z"')
   where id='f9000000-0000-4000-8000-000000000021'; raise exception 'Fechou sem anexo'; exception when check_violation then null; end;
 begin update public.operacao_processos set tarefas_card = jsonb_set(jsonb_set(ok,'{secoes,0,tarefas,2,feita_em}','"2026-11-20T10:00:00Z"'),'{secoes,0,tarefas,2,anexo_id}','"f9000000-0000-4000-8000-000000000099"')
   where id='f9000000-0000-4000-8000-000000000021'; raise exception 'Fechou com anexo inexistente'; exception when check_violation then null; end;
 update public.operacao_processos set tarefas_card = jsonb_set(jsonb_set(ok,'{secoes,0,tarefas,2,feita_em}','"2026-11-20T10:00:00Z"'),'{secoes,0,tarefas,2,anexo_id}','"f9000000-0000-4000-8000-000000000031"')
   where id='f9000000-0000-4000-8000-000000000021';
 begin update public.operacao_processos set tarefas_card = '{"secoes":[],"outro":1}' where id='f9000000-0000-4000-8000-000000000021';
   raise exception 'Aceitou chave estranha'; exception when check_violation then null; end;
 begin update public.operacao_processos set monitor_itens = array[1,2,3,4,5,6,7,8,9,10,11] where id='f9000000-0000-4000-8000-000000000021';
   raise exception 'Aceitou 11 itens'; exception when check_violation then null; end;
 update public.operacao_processos set monitor_itens = array[1,3] where id='f9000000-0000-4000-8000-000000000021';

 -- Modelo da empresa + preferência: licitação nova já entra com as tarefas do modelo.
 insert into public.operacao_funil_modelos_tarefas(id,organizacao_id,empresa_id,nome,secoes) values
  ('f9000000-0000-4000-8000-000000000041','f9000000-0000-4000-8000-00000000000a','f9000000-0000-4000-8000-00000000001a','Dispensa rápida',
   '[{"id":"s1","nome":"Dispensa","tarefas":[{"id":"t1","titulo":"Enviar proposta"}]}]');
 begin insert into public.operacao_funil_modelos_tarefas(organizacao_id,empresa_id,nome,secoes) values
  ('f9000000-0000-4000-8000-00000000000a','f9000000-0000-4000-8000-00000000001a','Sujo','[{"id":"s1","nome":"X","tarefas":[{"id":"t1","titulo":"Y","feita_em":"2026-11-20T10:00:00Z"}]}]');
  raise exception 'Modelo com marcação aceito'; exception when check_violation then null; end;
 insert into public.operacao_funil_preferencias(empresa_id,organizacao_id,modelo_tarefas,prospecta_ativo,prospecta_limite,prospecta_nota_minima,meta)
  values ('f9000000-0000-4000-8000-00000000001a','f9000000-0000-4000-8000-00000000000a','f9000000-0000-4000-8000-000000000041',true,2,60,'{"valor_minimo":5000}');
 insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,status) values
  ('f9000000-0000-4000-8000-000000000022','f9000000-0000-4000-8000-00000000000a','f9000000-0000-4000-8000-00000000001a','QA modelo','triagem');
 if (select tarefas_card->'secoes'->0->>'nome' from public.operacao_processos where id='f9000000-0000-4000-8000-000000000022') is distinct from 'Dispensa' then
  raise exception 'Modelo não aplicado ao adicionar'; end if;
 update public.operacao_funil_preferencias set modelo_tarefas='nenhum' where empresa_id='f9000000-0000-4000-8000-00000000001a';
 insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,status) values
  ('f9000000-0000-4000-8000-000000000023','f9000000-0000-4000-8000-00000000000a','f9000000-0000-4000-8000-00000000001a','QA nenhum','triagem');
 if (select tarefas_card from public.operacao_processos where id='f9000000-0000-4000-8000-000000000023') <> '{"secoes":[]}'::jsonb then raise exception '"Nenhuma" não aplicada'; end if;
 -- Gestor não executa o Prospecta.
 begin perform public.prospecta_sugerir('f9000000-0000-4000-8000-00000000001a','[]'); raise exception 'Usuário rodou o Prospecta';
 exception when insufficient_privilege then null; end;
end $$;

-- Operador da empresa B e gestor de outra organização não leem nem gravam a empresa A.
select set_config('request.jwt.claim.sub','f9000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.operacao_funil_preferencias) or exists(select 1 from public.operacao_funil_modelos_tarefas) then raise exception 'Operador da B leu a A'; end if;
 begin insert into public.operacao_funil_preferencias(empresa_id,organizacao_id) values ('f9000000-0000-4000-8000-00000000001a','f9000000-0000-4000-8000-00000000000a');
  raise exception 'Operador da B gravou preferência da A'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','f9000000-0000-4000-8000-000000000003',true);
do $$ begin
 if exists(select 1 from public.operacao_funil_preferencias) then raise exception 'Outra org leu'; end if;
 -- Empresa de outra organização com a organização dele: o gatilho recusa.
 begin insert into public.operacao_funil_preferencias(empresa_id,organizacao_id) values ('f9000000-0000-4000-8000-00000000001a','f9000000-0000-4000-8000-00000000000b');
  raise exception 'Par org/empresa trocado aceito'; exception when check_violation or insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin begin perform 1 from public.operacao_funil_preferencias; raise exception 'anon leu'; exception when insufficient_privilege then null; end; end $$;

-- Prospecta (service_role): nota mínima, limite do dia e sem duplicar.
set local role service_role;
do $$ declare n int; begin
 update public.operacao_funil_preferencias set modelo_tarefas='padrao' where empresa_id='f9000000-0000-4000-8000-00000000001a';
 n := public.prospecta_sugerir('f9000000-0000-4000-8000-00000000001a', '[
  {"numero_controle":"11222333000181-1-000001/2026","objeto":"Já no Funil","nota":95},
  {"numero_controle":"11222333000181-1-000002/2026","objeto":"Nota baixa","nota":40},
  {"numero_controle":"11222333000181-1-000003/2026","objeto":"Boa","orgao":"Prefeitura","nota":90,"valor":"12000.50","encerramento":"2026-12-05T09:00:00","link":"https://pncp.gov.br/app/editais/1"},
  {"numero_controle":"11222333000181-1-000004/2026","objeto":"Boa 2","nota":80},
  {"numero_controle":"11222333000181-1-000005/2026","objeto":"Passou do limite","nota":99}]');
 if n <> 2 then raise exception 'Prospecta pôs % (esperado 2)', n; end if;
 if (select count(*) from public.operacao_processos where empresa_id='f9000000-0000-4000-8000-00000000001a' and origem_externa_id like '11222333000181-1-%') <> 3 then raise exception 'Duplicou ou faltou'; end if;
 if (select sugerida_nota from public.operacao_processos where origem_externa_id='11222333000181-1-000003/2026') <> 90 then raise exception 'Sem selo'; end if;
 if not exists (select 1 from public.operacao_prazos_processo z join public.operacao_processos p on p.id=z.processo_id
   where p.origem_externa_id='11222333000181-1-000003/2026' and z.vencimento='2026-12-05 12:00:00+00') then raise exception 'Sem prazo de propostas'; end if;
 n := public.prospecta_sugerir('f9000000-0000-4000-8000-00000000001a', '[{"numero_controle":"11222333000181-1-000006/2026","objeto":"Amanhã","nota":99}]');
 if n <> 0 then raise exception 'Passou do limite diário'; end if;
 if public.prospecta_sugerir('f9000000-0000-4000-8000-00000000001b', '[{"numero_controle":"11222333000181-1-000007/2026","objeto":"x","nota":99}]') <> 0 then
  raise exception 'Empresa sem Prospecta ligado recebeu sugestão'; end if;
 raise notice 'testar_funil_v3: ok';
end $$;
rollback;
