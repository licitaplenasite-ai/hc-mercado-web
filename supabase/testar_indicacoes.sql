-- Teste de indicacoes.sql: regras do "Indique e ganhe" e RLS como asserts. Dados fictícios e rollback (nada fica no banco).
-- Papéis simulados com "set local role" + request.jwt.claim.sub / request.jwt.claims (aal2 do admin); não prova a API HTTP.
-- I indicador, N indicado, C mesmo CNPJ de I, T mesmo telefone de I, V link vencido, O outro cliente, P pendente, D dono.
begin;
-- O ensaio PGlite tem um auth.users mínimo, sem o metadado do cadastro; o Supabase real já tem a coluna.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_user_meta_data') then
    execute 'alter table auth.users add column raw_user_meta_data jsonb';
  end if;
end $$;
insert into auth.users(id,email) values
 ('e3000000-0000-4000-8000-000000000001','ind-i@qa.invalid'),('e3000000-0000-4000-8000-000000000006','ind-o@qa.invalid'),
 ('e3000000-0000-4000-8000-000000000007','ind-p@qa.invalid'),('e3000000-0000-4000-8000-000000000008','ind-d@qa.invalid');
insert into public.admins(email,nome,role) values ('ind-d@qa.invalid','QA dono','owner');
insert into public.clientes(id,nome,email,status,cnpj,telefone) values
 ('e3000000-0000-4000-8000-000000000001','Ana Indicadora Souza','ind-i@qa.invalid','aprovado','11.222.333/0001-81','(92) 99999-0001'),
 ('e3000000-0000-4000-8000-000000000006','QA Outro','ind-o@qa.invalid','aprovado','22333444000155','92 98888-0006'),
 ('e3000000-0000-4000-8000-000000000007','QA Pendente','ind-p@qa.invalid','pendente',null,null),
 ('e3000000-0000-4000-8000-000000000008','QA Dono','ind-d@qa.invalid','aprovado',null,null);
select public.gerar_codigo_indicacao('e3000000-0000-4000-8000-000000000001');
-- Cadastros com o código no metadado (o que cadastro.html manda). Código em minúsculas: o banco normaliza.
insert into auth.users(id,email,raw_user_meta_data)
select ('e3000000-0000-4000-8000-00000000000'||n)::uuid, 'ind-'||n||'@qa.invalid', jsonb_build_object('indicacao_codigo', lower(k.codigo), 'indicacao_em', em)
from public.indicacao_codigos k, (values ('2', now() - interval '1 day'), ('3', now()), ('4', now()), ('5', now() - interval '61 days')) v(n, em)
where k.usuario_id = 'e3000000-0000-4000-8000-000000000001';
insert into public.clientes(id,nome,email,status,cnpj,telefone) values
 ('e3000000-0000-4000-8000-000000000002','Nora Indicada Lima','ind-2@qa.invalid','aprovado','33444555000166','(11) 97777-0002'),
 ('e3000000-0000-4000-8000-000000000003','QA Mesmo CNPJ','ind-3@qa.invalid','aprovado','11222333000181','11 97777-0003'),
 ('e3000000-0000-4000-8000-000000000004','QA Mesmo Telefone','ind-4@qa.invalid','aprovado','44555666000177','92999990001'),
 ('e3000000-0000-4000-8000-000000000005','QA Link Vencido','ind-5@qa.invalid','aprovado','55666777000188','11 97777-0005');
-- Pagamentos do indicado N (Empresa, R$ 149,00/mês; anual R$ 1.490,00) e de C (bloqueada).
insert into public.pagamentos(id,usuario_id,plano,ciclo,valor_centavos) values
 ('e3000000-0000-4000-8000-0000000000a1','e3000000-0000-4000-8000-000000000002','empresa','mensal',14900),
 ('e3000000-0000-4000-8000-0000000000a2','e3000000-0000-4000-8000-000000000002','empresa','mensal',14900),
 ('e3000000-0000-4000-8000-0000000000a3','e3000000-0000-4000-8000-000000000002','empresa','anual',149000),
 ('e3000000-0000-4000-8000-0000000000a4','e3000000-0000-4000-8000-000000000002','empresa','mensal',14900),
 ('e3000000-0000-4000-8000-0000000000c1','e3000000-0000-4000-8000-000000000003','empresa','mensal',14900);

do $$
declare i uuid := 'e3000000-0000-4000-8000-000000000001'; n uuid := 'e3000000-0000-4000-8000-000000000002'; v jsonb; k record;
begin
  -- Cadastro: N indicado; C e T bloqueados (antifraude); V com link vencido fica sem indicação.
  if (select situacao from public.indicacoes where indicado_id = n) <> 'cadastrado' then raise exception 'indicação de N não criada'; end if;
  if (select indicador_id from public.indicacoes where indicado_id = n) <> i then raise exception 'indicador errado'; end if;
  if (select situacao||'/'||motivo_bloqueio from public.indicacoes where indicado_id = 'e3000000-0000-4000-8000-000000000003') <> 'bloqueada/mesmo CNPJ do indicador' then raise exception 'mesmo CNPJ não bloqueou'; end if;
  if (select situacao||'/'||motivo_bloqueio from public.indicacoes where indicado_id = 'e3000000-0000-4000-8000-000000000004') <> 'bloqueada/mesmo telefone do indicador' then raise exception 'mesmo telefone não bloqueou'; end if;
  if exists (select 1 from public.indicacoes where indicado_id = 'e3000000-0000-4000-8000-000000000005') then raise exception 'link vencido gerou indicação'; end if;
  if public.gerar_codigo_indicacao(i) <> (select codigo from public.indicacao_codigos where usuario_id = i) then raise exception 'código mudou'; end if;
  if public.nome_curto_indicado('Nora Indicada Lima') <> 'Nora L.' or public.nome_curto_indicado('') <> 'Cliente' then raise exception 'nome curto'; end if;

  -- Pagamento confirmado (mesmo caminho do admin e do futuro webhook): 30% de R$ 149,00 = R$ 44,70, liberada em 30 dias.
  v := public.aplicar_pagamento_confirmado('e3000000-0000-4000-8000-0000000000a1', 'qa');
  select * into k from public.indicacao_comissoes where pagamento_id = 'e3000000-0000-4000-8000-0000000000a1';
  if k.valor_centavos <> 4470 or k.meses <> 1 or k.situacao <> 'pendente' or k.indicador_id <> i then raise exception 'comissão da 1ª mensalidade: %', to_jsonb(k); end if;
  if k.libera_em < now() + interval '29 days' or public.situacao_comissao(k.situacao, k.libera_em) <> 'pendente' then raise exception 'garantia de 30 dias'; end if;
  if (select situacao from public.indicacoes where indicado_id = n) <> 'cliente' then raise exception 'indicado não virou cliente'; end if;
  v := public.indicacao_registrar_pagamento('e3000000-0000-4000-8000-0000000000a1');
  if not coalesce((v->>'ja_registrada')::boolean, false) or (select count(*) from public.indicacao_comissoes) <> 1 then raise exception 'comissão duplicada: %', v; end if;
  -- Estorno anula a comissão ainda não paga.
  perform public.aplicar_pagamento_confirmado('e3000000-0000-4000-8000-0000000000a2', 'qa');
  update public.pagamentos set situacao = 'estornado' where id = 'e3000000-0000-4000-8000-0000000000a2';
  if (select situacao from public.indicacao_comissoes where pagamento_id = 'e3000000-0000-4000-8000-0000000000a2') <> 'cancelada' then raise exception 'estorno não anulou'; end if;
  -- Anual: só os 11 meses que faltam dos 12 (estornado não conta): 149000*11/12 = 136583; 30% = 40975.
  perform public.aplicar_pagamento_confirmado('e3000000-0000-4000-8000-0000000000a3', 'qa');
  select * into k from public.indicacao_comissoes where pagamento_id = 'e3000000-0000-4000-8000-0000000000a3';
  if k.meses <> 11 or k.base_centavos <> 136583 or k.valor_centavos <> 40975 then raise exception 'comissão anual: %', to_jsonb(k); end if;
  -- Prazo encerrado: o pagamento seguinte não gera comissão, e o pagamento confirma normalmente.
  perform public.aplicar_pagamento_confirmado('e3000000-0000-4000-8000-0000000000a4', 'qa');
  if exists (select 1 from public.indicacao_comissoes where pagamento_id = 'e3000000-0000-4000-8000-0000000000a4') then raise exception 'comissão depois do prazo'; end if;
  if (select situacao from public.pagamentos where id = 'e3000000-0000-4000-8000-0000000000a4') <> 'pago' then raise exception 'pagamento não confirmou'; end if;
  -- Indicação bloqueada não gera comissão.
  perform public.aplicar_pagamento_confirmado('e3000000-0000-4000-8000-0000000000c1', 'qa');
  if exists (select 1 from public.indicacao_comissoes where pagamento_id = 'e3000000-0000-4000-8000-0000000000c1') then raise exception 'bloqueada gerou comissão'; end if;
end $$;
-- A comissão da 1ª mensalidade passou da garantia (simulado).
update public.indicacao_comissoes set libera_em = now() - interval '1 day' where pagamento_id = 'e3000000-0000-4000-8000-0000000000a1';

set local role anon;
do $$ begin
  if (select count(*) from public.indicacao_regras) <> 1 then raise exception 'anon não lê as regras'; end if;
  begin perform 1 from public.indicacoes; raise exception 'anon leu indicações';
  exception when insufficient_privilege then null; end;
  begin perform public.minhas_indicacoes(); raise exception 'anon chamou minhas_indicacoes';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
do $$
declare i uuid := 'e3000000-0000-4000-8000-000000000001'; v jsonb; t text;
begin
  -- Indicador: vê as próprias indicações e comissões, sem dado sensível do indicado.
  perform set_config('request.jwt.claim.sub', i::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', i)::text, true);
  if (select count(*) from public.indicacoes) <> 3 or (select count(*) from public.indicacao_comissoes) <> 3 then raise exception 'indicador não vê o que é dele'; end if;
  v := public.minhas_indicacoes(); t := v::text;
  if v->>'codigo' !~ '^[A-Z0-9]{8}$' or (v->'regras'->>'percentual')::numeric <> 30 then raise exception 'minhas_indicacoes: %', v; end if;
  if t like '%@%' or t like '%33444555%' or t like '%Indicada%' or t like '%97777%' or t not like '%Nora L.%' then raise exception 'dado sensível do indicado na tela: %', t; end if;
  if not exists (select 1 from jsonb_array_elements(v->'comissoes') c where c->>'situacao' = 'liberada' and (c->>'valor_centavos')::int = 4470) then raise exception 'liberada ausente'; end if;
  -- Saque abaixo do mínimo (R$ 44,70 < R$ 50,00) é recusado.
  begin perform public.pedir_saque_indicacao(); raise exception 'saque abaixo do mínimo aceito';
  exception when raise_exception then if sqlerrm not like 'O saque mínimo é de R$ 50,00%' then raise; end if; end;
  -- Não escreve direto nem chama o que é do admin ou do servidor.
  begin update public.indicacao_comissoes set situacao = 'paga'; raise exception 'indicador alterou comissão';
  exception when insufficient_privilege then null; end;
  begin insert into public.indicacoes(indicador_id, indicado_id, codigo) values (i, i, 'AAAAAAAA'); raise exception 'autoindicação direta aceita';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_pagar_comissoes(array(select id from public.indicacao_comissoes), 'PIX'); raise exception 'indicador marcou como pago';
  exception when insufficient_privilege then null; end;
  begin perform public.indicacao_registrar_pagamento('e3000000-0000-4000-8000-0000000000a4'); raise exception 'cliente criou comissão';
  exception when insufficient_privilege then null; end;

  -- Outro cliente não vê nada de I; o indicado não vê a comissão; pendente não entra.
  perform set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000006', true);
  if (select count(*) from public.indicacoes) <> 0 or (select count(*) from public.indicacao_comissoes) <> 0 or (select count(*) from public.indicacao_codigos) <> 0 then raise exception 'outro cliente viu indicações de I'; end if;
  v := public.minhas_indicacoes();
  if jsonb_array_length(v->'indicados') <> 0 or jsonb_array_length(v->'comissoes') <> 0 then raise exception 'outro cliente recebeu dados de I: %', v; end if;
  perform set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000002', true);
  if (select count(*) from public.indicacao_comissoes) <> 0 or (select count(*) from public.indicacoes) <> 0 then raise exception 'indicado viu a comissão'; end if;
  perform set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000007', true);
  begin perform public.minhas_indicacoes(); raise exception 'pendente usou o programa';
  exception when insufficient_privilege then null; end;

  -- Dono: sem 2 fatores é recusado; com 2 fatores só paga comissão liberada.
  perform set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000008', true);
  perform set_config('request.jwt.claims', json_build_object('sub', 'e3000000-0000-4000-8000-000000000008', 'aal', 'aal1')::text, true);
  begin perform public.admin_indicacoes(); raise exception 'admin sem 2 fatores';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', 'e3000000-0000-4000-8000-000000000008', 'aal', 'aal2')::text, true);
  v := public.admin_indicacoes();
  if jsonb_array_length(v->'indicacoes') < 3 or jsonb_array_length(v->'comissoes') < 3 then raise exception 'admin não vê: %', v; end if;
  begin perform public.admin_pagar_comissoes(array(select (c->>'id')::uuid from jsonb_array_elements(v->'comissoes') c where c->>'situacao' = 'pendente'), 'PIX-QA'); raise exception 'pagou comissão na garantia';
  exception when raise_exception then if sqlerrm not like 'Só comissões liberadas%' then raise; end if; end;
  begin perform public.admin_salvar_regras_indicacao('{"cpf":"1"}'); raise exception 'campo estranho aceito';
  exception when raise_exception then null; end;
  perform public.admin_salvar_regras_indicacao('{"saque_minimo_centavos":4000}');

  -- Com o mínimo de R$ 40,00 o indicador pede o saque e o dono registra o Pix.
  perform set_config('request.jwt.claim.sub', i::text, true);
  v := public.pedir_saque_indicacao();
  if (v->>'total_centavos')::int <> 4470 then raise exception 'saque: %', v; end if;
  perform set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000008', true);
  v := public.admin_pagar_comissoes(array(select (c->>'id')::uuid from jsonb_array_elements(public.admin_indicacoes()->'comissoes') c where c->>'situacao' = 'liberada'), 'PIX-QA-1');
  if (v->>'pagas')::int <> 1 then raise exception 'pagamento da comissão: %', v; end if;
  perform set_config('request.jwt.claim.sub', i::text, true);
  if not exists (select 1 from jsonb_array_elements(public.minhas_indicacoes()->'comissoes') c where c->>'situacao' = 'paga' and c->>'paga_em' is not null) then raise exception 'indicador não vê como paga'; end if;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon', 'public.indicacao_comissoes', 'SELECT') then raise exception 'anon lê comissões'; end if;
  if has_function_privilege('authenticated', 'public.indicacao_registrar_pagamento(uuid)', 'EXECUTE') then raise exception 'cliente executa o gancho do pagamento'; end if;
  if has_function_privilege('anon', 'public.admin_pagar_comissoes(uuid[], text)', 'EXECUTE') then raise exception 'anon executa admin'; end if;
  if (select paga_referencia from public.indicacao_comissoes where pagamento_id = 'e3000000-0000-4000-8000-0000000000a1') <> 'PIX-QA-1' then raise exception 'referência do Pix'; end if;
end $$;
rollback;
