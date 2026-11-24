-- Teste de funil_exemplos.sql (+ trechos de planos_e_recursos.sql): exemplos não contam no limite de processos,
-- passam com o plano travado, a marca não muda, teto de 8 e o prefixo "[Exemplo] ". Dados fictícios e rollback.
begin;
set local timezone = 'America/Sao_Paulo';
insert into auth.users(id,email) values ('e3000000-0000-4000-8000-000000000001','ex-v@qa.invalid');
insert into public.clientes(id,nome,email,status,plano) values ('e3000000-0000-4000-8000-000000000001','QA EX','ex-v@qa.invalid','aprovado','empresa');
insert into public.operacao_organizacoes(id,nome,owner_id) values ('e3000000-0000-4000-8000-00000000000a','QA org EX','e3000000-0000-4000-8000-000000000001');
insert into public.operacao_membros(organizacao_id,usuario_id,papel) values ('e3000000-0000-4000-8000-00000000000a','e3000000-0000-4000-8000-000000000001','gestor');
insert into public.operacao_empresas(id,organizacao_id,razao_social) values ('e3000000-0000-4000-8000-0000000000e1','e3000000-0000-4000-8000-00000000000a','QA EX1');
-- Teste vencido: limite de 0 processos.
update public.assinaturas set teste_ate = now() - interval '1 day' where usuario_id = 'e3000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"e3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare o uuid := 'e3000000-0000-4000-8000-00000000000a'; e uuid := 'e3000000-0000-4000-8000-0000000000e1'; v jsonb;
begin
 -- Processo real: bloqueado pelo plano (policy restritiva ou gatilho).
 begin insert into public.operacao_processos(organizacao_id,empresa_id,objeto) values (o,e,'Real');
   raise exception 'processo real passou com limite 0';
 exception when raise_exception or insufficient_privilege then
   if sqlerrm = 'processo real passou com limite 0' then raise; end if;
 end;
 -- Exemplos: entram mesmo com o plano travado, com o prefixo garantido.
 insert into public.operacao_processos(organizacao_id,empresa_id,objeto,exemplo,origem_externa_id)
   select o,e,'Exemplo '||g,true,'exemplo-'||g from generate_series(1,3) g;
 if (select count(*) from public.operacao_processos where organizacao_id=o and exemplo and objeto like '[Exemplo] Exemplo %') <> 3 then
   raise exception 'prefixo [Exemplo] ausente'; end if;
 update public.operacao_processos set objeto = 'Sem prefixo' where origem_externa_id = 'exemplo-1';
 if (select objeto from public.operacao_processos where origem_externa_id = 'exemplo-1') <> '[Exemplo] Sem prefixo' then
   raise exception 'edição tirou o prefixo'; end if;
 -- Uso do plano não conta exemplos.
 v := public.meu_plano();
 if (v->'uso'->>'processos')::int <> 0 then raise exception 'meu_plano contou exemplos: %', v->'uso'; end if;
 -- Exemplo não vira real.
 begin update public.operacao_processos set exemplo = false where origem_externa_id = 'exemplo-1';
   raise exception 'marca trocada';
 exception when raise_exception then if sqlerrm not like 'A marca de exemplo%' then raise; end if; end;
 -- Teto de 8 por organização.
 insert into public.operacao_processos(organizacao_id,empresa_id,objeto,exemplo) select o,e,'Mais '||g,true from generate_series(4,8) g;
 begin insert into public.operacao_processos(organizacao_id,empresa_id,objeto,exemplo) values (o,e,'Nono',true);
   raise exception 'passou do teto';
 exception when raise_exception then if sqlerrm not like 'Esta conta já tem os exemplos%' then raise; end if; end;
 -- "Apagar exemplos": some só o exemplo.
 delete from public.operacao_processos where organizacao_id = o and empresa_id = e and exemplo;
 if exists (select 1 from public.operacao_processos where organizacao_id = o and exemplo) then raise exception 'exemplo ficou'; end if;
end $$;
reset role;

-- Processo real (como dono do banco, sem plano): não vira exemplo e não ganha prefixo.
do $$
declare o uuid := 'e3000000-0000-4000-8000-00000000000a'; e uuid := 'e3000000-0000-4000-8000-0000000000e1'; p uuid;
begin
 update public.assinaturas set teste_ate = now() + interval '5 days' where usuario_id = 'e3000000-0000-4000-8000-000000000001';
 insert into public.operacao_processos(organizacao_id,empresa_id,objeto) values (o,e,'Real de verdade') returning id into p;
 begin update public.operacao_processos set exemplo = true where id = p; raise exception 'real virou exemplo';
 exception when raise_exception then if sqlerrm not like 'A marca de exemplo%' then raise; end if; end;
 if (select objeto from public.operacao_processos where id = p) <> 'Real de verdade' then raise exception 'real ganhou prefixo'; end if;
end $$;
select 'testar_funil_exemplos ok';
rollback;
