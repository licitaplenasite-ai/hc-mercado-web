-- Teste de prospeccao.sql. Dados fictícios e rollback (nada fica no banco).
-- Papéis simulados com "set local role"; não prova a API HTTP do PostgREST.
begin;
set local role service_role;
insert into public.prospeccao_itens(id,tipo,fonte,uf,orgao_cnpj,orgao_nome,objeto,data_ref,link,busca,coletado_em) values
 ('contrato:QA-1','contrato','pncp','AM','11222333000181','QA órgão','Limpeza predial','2027-03-01','https://pncp.gov.br/app/contratos/11222333000181/2026/1','limpeza predial','2026-11-18'),
 ('ata:QA-2#1#11222333000181','ata','comprasgov_arp','AM','11222333000181','QA órgão','Papel A4','2027-05-01','https://pncp.gov.br/app/atas/11222333000181/2026/2/1','papel a4','2026-11-18');
-- Upsert pela chave (mesmo caminho do robô: on conflict).
insert into public.prospeccao_itens(id,tipo,fonte,uf,data_ref,link,coletado_em) values
 ('contrato:QA-1','contrato','pncp','AM','2027-04-01','https://pncp.gov.br/app/contratos/11222333000181/2026/1','2026-11-19')
 on conflict (id) do update set data_ref=excluded.data_ref,coletado_em=excluded.coletado_em;
do $$ begin
 if (select count(*) from public.prospeccao_itens where id like '%QA-%')<>2 then raise exception 'upsert duplicou'; end if;
 if (select data_ref from public.prospeccao_itens where id='contrato:QA-1')<>'2027-04-01' then raise exception 'upsert não atualizou'; end if;
 -- Limpeza do robô: o que não voltou na coleta do dia sai.
 delete from public.prospeccao_itens where tipo='ata' and uf='AM' and coletado_em<'2026-11-19' and id like 'ata:QA-%';
 if exists(select 1 from public.prospeccao_itens where id='ata:QA-2#1#11222333000181') then raise exception 'limpeza não apagou'; end if;
 begin insert into public.prospeccao_itens(id,tipo,fonte,data_ref,link) values('pca:QA-3','pca','pncp','2027-01-01','https://evil.example.com/x'); raise exception 'link de fora aceito';
 exception when check_violation then null; end;
 begin insert into public.prospeccao_itens(id,tipo,fonte,link,fornecedor_cnpj) values('ata:QA-4','ata','pncp','https://pncp.gov.br/app/atas/1','12345678901'); raise exception 'CPF aceito';
 exception when check_violation then null; end;
 begin insert into public.prospeccao_itens(id,tipo,fonte,link,fornecedor_nome) values('ata:QA-5','ata','pncp','https://pncp.gov.br/app/atas/1','Fulano'); raise exception 'nome sem CNPJ aceito';
 exception when check_violation then null; end;
 begin insert into public.prospeccao_itens(id,tipo,fonte,link) values('xx:QA-6','edital','pncp','https://pncp.gov.br/app/x'); raise exception 'tipo inválido aceito';
 exception when check_violation then null; end;
end $$;
reset role;
insert into auth.users(id,email) values ('c9000000-0000-4000-8000-000000000001','pro-a@qa.invalid'),('c9000000-0000-4000-8000-000000000002','pro-p@qa.invalid');
insert into public.clientes(id,nome,email,status) values ('c9000000-0000-4000-8000-000000000001','QA pro A','pro-a@qa.invalid','aprovado'),('c9000000-0000-4000-8000-000000000002','QA pro P','pro-p@qa.invalid','pendente');
set local role authenticated;
select set_config('request.jwt.claim.sub','c9000000-0000-4000-8000-000000000002',true);
do $$ begin if (select count(*) from public.prospeccao_itens)<>0 then raise exception 'cliente pendente leu'; end if; end $$;
select set_config('request.jwt.claim.sub','c9000000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.prospeccao_itens where id='contrato:QA-1')<>1 then raise exception 'autenticado não lê'; end if;
 begin insert into public.prospeccao_itens(id,tipo,fonte,link) values('pca:QA-7','pca','pncp','https://pncp.gov.br/app/pca/1/2026'); raise exception 'autenticado gravou';
 exception when insufficient_privilege then null; end;
 begin delete from public.prospeccao_itens where id='contrato:QA-1'; raise exception 'autenticado apagou';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- v3: cliente aprovado lê só o resumo da cobertura em dados_robo (não o progresso do robô); pendente não lê nada.
insert into public.dados_robo(chave,dado) values ('prospeccao_cobertura_qa','{"etapas":{"AM:pca":{"concluidaEm":null}}}'),('prospeccao_estado_qa','{"orgaos":{}}'),('prospeccaoXcoberturaXqa','{}')
 on conflict (chave) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9000000-0000-4000-8000-000000000002',true);
do $$ begin if exists(select 1 from public.dados_robo where chave like 'prospeccao%') then raise exception 'pendente leu a cobertura'; end if; end $$;
select set_config('request.jwt.claim.sub','c9000000-0000-4000-8000-000000000001',true);
do $$ begin
 if not exists(select 1 from public.dados_robo where chave='prospeccao_cobertura_qa') then raise exception 'aprovado não lê a cobertura'; end if;
 if exists(select 1 from public.dados_robo where chave in ('prospeccao_estado_qa','prospeccaoXcoberturaXqa')) then raise exception 'aprovado leu o progresso do robô'; end if;
end $$;
reset role;
delete from public.dados_robo where chave in ('prospeccao_cobertura_qa','prospeccao_estado_qa','prospeccaoXcoberturaXqa');
-- Dado antigo com CPF (gravado antes do CHECK): a limpeza do .sql tira só o CPF e é idempotente.
alter table public.prospeccao_itens drop constraint prospeccao_itens_fornecedor_sem_cpf;
insert into public.prospeccao_itens(id,tipo,fonte,link,fornecedor_cnpj,fornecedor_nome) values('ata:QA-8','ata','pncp','https://pncp.gov.br/app/atas/8','12345678000195','FULANA DE TAL 97048143215');
do $$ declare n int; begin
 update public.prospeccao_itens set fornecedor_nome = nullif(btrim(regexp_replace(regexp_replace(fornecedor_nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '') where fornecedor_nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
 get diagnostics n = row_count;
 if n <> 1 then raise exception 'limpeza de CPF tocou % linhas', n; end if;
 if (select fornecedor_nome from public.prospeccao_itens where id='ata:QA-8') <> 'FULANA DE TAL' then raise exception 'limpeza de CPF errada'; end if;
 update public.prospeccao_itens set fornecedor_nome = nullif(btrim(regexp_replace(regexp_replace(fornecedor_nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '') where fornecedor_nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'limpeza de CPF não é idempotente'; end if;
end $$;
alter table public.prospeccao_itens add constraint prospeccao_itens_fornecedor_sem_cpf check (fornecedor_nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
do $$ declare v text; begin
 foreach v in array array['FULANA 97048143215','FULANA 970.481.432-15','FULANA 970 481 432 15','FULANA 970.481.432/15'] loop
  begin update public.prospeccao_itens set fornecedor_nome = v where id='ata:QA-8'; raise exception 'CPF aceito em prospeccao_itens.fornecedor_nome: %', v;
  exception when check_violation then null; end;
 end loop;
 update public.prospeccao_itens set fornecedor_nome = 'EMPRESA 11.222.333/0001-81 LTDA' where id='ata:QA-8'; -- CNPJ formatado não é CPF
end $$;
-- v2: adesões, número da ata e busca_nome (idempotência do backfill e dos CHECKs).
do $$ declare n int; begin
 insert into public.prospeccao_itens(id,tipo,fonte,uf,descricao,objeto,link,ata_numero,adesoes_usadas,adesoes_em) values
  ('ata:QA-9#1#11222333000181','ata','comprasgov_arp','AM','PAPEL A4 — Gramatura 75','Material','https://pncp.gov.br/app/atas/9','00076/2025',4,now());
 if (select busca_nome from public.prospeccao_itens where id='ata:QA-9#1#11222333000181') <> '' then raise exception 'default de busca_nome deveria ser vazio'; end if;
 -- Backfill do .sql (linha antiga, sem busca_nome): minúsculo, sem acento, 100 primeiros caracteres da descrição.
 update public.prospeccao_itens set busca_nome = btrim(left(translate(lower(coalesce(descricao, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), 90) || ' '
                       || left(translate(lower(coalesce(objeto, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), 90))
  where busca_nome = '' and coalesce(descricao, objeto) is not null and id = 'ata:QA-9#1#11222333000181';
 get diagnostics n = row_count;
 if n <> 1 or (select busca_nome from public.prospeccao_itens where id='ata:QA-9#1#11222333000181') <> 'papel a4 — gramatura 75 material' then raise exception 'backfill de busca_nome errado'; end if;
 update public.prospeccao_itens set busca_nome = btrim(left(translate(lower(coalesce(descricao, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), 90) || ' '
                       || left(translate(lower(coalesce(objeto, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), 90))
  where busca_nome = '' and coalesce(descricao, objeto) is not null and id = 'ata:QA-9#1#11222333000181';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'backfill de busca_nome não é idempotente'; end if;
 begin update public.prospeccao_itens set adesoes_usadas = -1 where id='ata:QA-9#1#11222333000181'; raise exception 'adesão negativa aceita';
 exception when check_violation then null; end;
 begin update public.prospeccao_itens set busca_nome = repeat('x', 201) where id='ata:QA-9#1#11222333000181'; raise exception 'busca_nome gigante aceito';
 exception when check_violation then null; end;
 -- O upsert do robô (linha sem as colunas de adesão) não apaga o que a rodada de adesões gravou.
 insert into public.prospeccao_itens(id,tipo,fonte,uf,descricao,link,ata_numero,busca_nome) values
  ('ata:QA-9#1#11222333000181','ata','comprasgov_arp','AM','PAPEL A4','https://pncp.gov.br/app/atas/9','00076/2025','papel a4')
  on conflict (id) do update set descricao=excluded.descricao, ata_numero=excluded.ata_numero, busca_nome=excluded.busca_nome;
 if (select adesoes_usadas from public.prospeccao_itens where id='ata:QA-9#1#11222333000181') <> 4 then raise exception 'upsert do robô apagou adesoes_usadas'; end if;
end $$;
do $$ begin
 if has_table_privilege('anon','public.prospeccao_itens','SELECT') then raise exception 'anon lê prospecção'; end if;
 if has_function_privilege('anon','public.buscar_prospeccao(text,text,text,date,date,jsonb,text,int)','EXECUTE') then raise exception 'anon executa buscar_prospeccao'; end if;
end $$;
-- v5: buscar_prospeccao (busca com palavra, security definer). Mesmos níveis da function; pendente não lê; entrada validada.
insert into public.prospeccao_itens(id,tipo,fonte,uf,data_ref,valor_total,link,busca,busca_nome) values
 ('pca:QA-10','pca','pncp','AM','2027-01-10',10,'https://pncp.gov.br/app/pca/10','material de limpeza predial orgao qa','material de limpeza'),
 ('pca:QA-11','pca','pncp','SP','2027-01-05',20,'https://pncp.gov.br/app/pca/11','limpeza de vidros orgao qa','limpeza de vidros'),
 ('pca:QA-12','pca','pncp','AM','2027-01-20',30,'https://pncp.gov.br/app/pca/12','impressora laser com kit de limpeza orgao qa','impressora laser'),
 ('pca:QA-13','pca','pncp','AM','2029-01-01',40,'https://pncp.gov.br/app/pca/13','limpeza fora da janela','limpeza fora da janela');
set local role authenticated;
select set_config('request.jwt.claim.sub','c9000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["limpeza"]]','inicio',201)) then raise exception 'pendente leu pela RPC'; end if;
end $$;
select set_config('request.jwt.claim.sub','c9000000-0000-4000-8000-000000000001',true);
do $$
declare ids text;
begin
 select string_agg(id, ',' order by data_ref) into ids from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["limpeza"]]','inicio',201) where id like '%QA-%';
 if ids is distinct from 'pca:QA-11' then raise exception 'nível inicio errado: %', ids; end if;
 select string_agg(id, ',' order by data_ref) into ids from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["limpeza"]]','nome',201) where id like '%QA-%';
 if ids is distinct from 'pca:QA-10' then raise exception 'nível nome errado: %', ids; end if;
 select string_agg(id, ',' order by data_ref) into ids from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["limpeza"]]','espec',201) where id like '%QA-%';
 if ids is distinct from 'pca:QA-12' then raise exception 'nível espec errado: %', ids; end if;
 -- Janela aberta em cima (ata): sem p_ate entra o que vence depois.
 if not exists(select 1 from public.buscar_prospeccao('pca',null,null,'2026-11-01',null,'[["limpeza"]]','inicio',201) where id = 'pca:QA-13') then raise exception 'sem p_ate cortou a janela'; end if;
 if exists(select 1 from public.buscar_prospeccao('pca','AM',null,'2026-11-01','2028-01-01','[["limpeza"]]','inicio',201)) then raise exception 'filtro de UF ignorado'; end if;
 -- Frase = todas as palavras; só a primeira precisa abrir o nome. Frases somam (or).
 if not exists(select 1 from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["limpeza","vidro"]]','inicio',201) where id = 'pca:QA-11') then raise exception 'frase com duas palavras não casou'; end if;
 if exists(select 1 from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["vidro","limpeza"]]','inicio',201) where id like '%QA-%') then raise exception 'inicio casou fora do começo'; end if;
 select string_agg(id, ',' order by data_ref) into ids from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["impressora"],["limpeza","vidro"]]','inicio',201) where id like '%QA-%';
 if ids is distinct from 'pca:QA-11,pca:QA-12' then raise exception 'frases não somaram: %', ids; end if;
 if (select count(*) from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["qa"]]','espec',1)) <> 1 then raise exception 'limite ignorado'; end if;
 -- Entrada fora do formato (curinga, aspas, nível, limite) é recusada, não vira SQL.
 begin perform public.buscar_prospeccao('pca',null,null,'2026-11-01',null,'[["lim%"]]','inicio',10); raise exception 'curinga aceito';
 exception when invalid_parameter_value then null; end;
 begin perform public.buscar_prospeccao('pca',null,null,'2026-11-01',null,'[["a'') or true --"]]','inicio',10); raise exception 'aspas aceitas';
 exception when invalid_parameter_value then null; end;
 begin perform public.buscar_prospeccao('pca',null,null,'2026-11-01',null,'[["limpeza"]]','tudo',10); raise exception 'nível inválido aceito';
 exception when invalid_parameter_value then null; end;
 begin perform public.buscar_prospeccao('pca',null,null,'2026-11-01',null,'[["limpeza"]]','inicio',5000); raise exception 'limite gigante aceito';
 exception when invalid_parameter_value then null; end;
 begin perform public.buscar_prospeccao('pca','sp',null,'2026-11-01',null,'[["limpeza"]]','inicio',10); raise exception 'UF inválida aceita';
 exception when invalid_parameter_value then null; end;
end $$;
reset role;
-- v7: cópia estreita prospeccao_busca, mantida pelo trigger; a busca acima já passou por ela (banco de teste nasce "pronto").
do $$
declare x text; ids text;
begin
 if not exists(select 1 from public.dados_robo where chave='prospeccao_busca_pronta') then raise exception 'banco novo deveria nascer com a cópia pronta'; end if;
 if has_table_privilege('authenticated','public.prospeccao_busca','SELECT') or has_table_privilege('anon','public.prospeccao_busca','SELECT')
    or has_table_privilege('service_role','public.prospeccao_busca','INSERT') then raise exception 'papel do PostgREST chega à cópia'; end if;
 if has_function_privilege('authenticated','public.prospeccao_busca_carregar(int)','EXECUTE') then raise exception 'autenticado roda a carga'; end if;
 -- Palavras distintas, só [a-z0-9] com 2+ letras, em ordem: '%palavra%' casa igual ao texto original.
 if public.prospeccao_palavras('Papel A4, papel-a4; x 75g') <> '75g a4 papel' then raise exception 'palavras: %', public.prospeccao_palavras('Papel A4, papel-a4; x 75g'); end if;
 if (select (nome, texto, tipo, uf, data_ref, valor_total) from public.prospeccao_busca where id='pca:QA-12')
    is distinct from ('impressora laser'::text, 'com de impressora kit laser limpeza orgao qa'::text, 'pca'::text, 'AM'::text, '2027-01-20'::date, 30::numeric) then
   raise exception 'trigger não copiou o insert: %', (select row(nome, texto) from public.prospeccao_busca where id='pca:QA-12');
 end if;
 -- Upsert do robô que só muda coletado_em não regrava a cópia (é o que mantém o VM "all-visible").
 x := (select xmin::text from public.prospeccao_busca where id='pca:QA-12');
 insert into public.prospeccao_itens(id,tipo,fonte,uf,data_ref,valor_total,link,busca,busca_nome,coletado_em) values
  ('pca:QA-12','pca','pncp','AM','2027-01-20',30,'https://pncp.gov.br/app/pca/12','impressora laser com kit de limpeza orgao qa','impressora laser',now())
  on conflict (id) do update set coletado_em = excluded.coletado_em, busca = excluded.busca;
 if (select xmin::text from public.prospeccao_busca where id='pca:QA-12') <> x then raise exception 'upsert sem mudança regravou a cópia'; end if;
 -- Mudou campo da busca: a cópia acompanha (no mesmo upsert do robô).
 insert into public.prospeccao_itens(id,tipo,fonte,uf,data_ref,valor_total,link,busca,busca_nome) values
  ('pca:QA-12','pca','pncp','SP','2027-01-21',31,'https://pncp.gov.br/app/pca/12','Limpeza de piso orgao qa','limpeza de piso')
  on conflict (id) do update set uf = excluded.uf, data_ref = excluded.data_ref, valor_total = excluded.valor_total, busca = excluded.busca, busca_nome = excluded.busca_nome;
 if (select (nome, texto, uf, data_ref, valor_total) from public.prospeccao_busca where id='pca:QA-12')
    is distinct from ('limpeza de piso'::text, 'de limpeza orgao piso qa'::text, 'SP'::text, '2027-01-21'::date, 31::numeric) then raise exception 'trigger não copiou o update'; end if;
 -- Robô apaga: some da cópia.
 delete from public.prospeccao_itens where id='pca:QA-13';
 if exists(select 1 from public.prospeccao_busca where id='pca:QA-13') then raise exception 'trigger não apagou'; end if;
 -- Mesmo resultado pela cópia e, sem a marca de pronta, direto em prospeccao_itens (caminho da carga em produção).
 select string_agg(id, ',' order by data_ref) into ids from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["limpeza"]]','inicio',201) where id like '%QA-%';
 if ids is distinct from 'pca:QA-11,pca:QA-12' then raise exception 'inicio pela cópia: %', ids; end if;
 delete from public.dados_robo where chave='prospeccao_busca_pronta';
 select string_agg(id, ',' order by data_ref) into ids from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["limpeza"]]','inicio',201) where id like '%QA-%';
 if ids is distinct from 'pca:QA-11,pca:QA-12' then raise exception 'inicio sem a cópia: %', ids; end if;
 select string_agg(id, ',' order by data_ref) into ids from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["qa"]]','espec',201) where id like '%QA-%';
 if ids is distinct from 'pca:QA-11,pca:QA-10,pca:QA-12' then raise exception 'espec sem a cópia: %', ids; end if;
 -- Carga: repõe o que faltar, apaga sobra e volta a marcar pronta (os dois índices existem aqui).
 delete from public.prospeccao_busca where id='pca:QA-10';
 insert into public.prospeccao_busca(id,tipo,nome,texto) values ('pca:QA-sobra','pca','x','x');
 while public.prospeccao_busca_carregar(1000) > 0 loop end loop;
 if not exists(select 1 from public.prospeccao_busca where id='pca:QA-10') then raise exception 'carga não repôs'; end if;
 if exists(select 1 from public.prospeccao_busca where id='pca:QA-sobra') then raise exception 'carga não apagou sobra'; end if;
 if not exists(select 1 from public.dados_robo where chave='prospeccao_busca_pronta') then raise exception 'carga não marcou pronta'; end if;
 select string_agg(id, ',' order by data_ref) into ids from public.buscar_prospeccao('pca',null,null,'2026-11-01','2028-01-01','[["qa"]]','espec',201) where id like '%QA-%';
 if ids is distinct from 'pca:QA-11,pca:QA-10,pca:QA-12' then raise exception 'espec pela cópia: %', ids; end if;
end $$;
rollback;
