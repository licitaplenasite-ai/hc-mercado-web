-- Corrigir razão social e CNPJ de empresa já cadastrada (operacao.html, "Corrigir razão social ou CNPJ").
-- Idempotente; pode ser reaplicado. Requer operacao_licitacoes.sql, acesso_empresa_convites.sql e seguranca_operacao.sql.
-- A RLS (operacao_empresas_escrita) já deixa gestor e operador alterarem; esta guarda restringe razão social/CNPJ ao gestor
-- da organização inteira e recusa CNPJ com dígito verificador errado (ex.: 13 dígitos, faltando um zero).
-- Chave de serviço e SQL Editor (auth.uid() nulo) passam direto: correção administrativa e robôs.
-- A invalidação da identificação confirmada e do vínculo com a compra continua com os gatilhos de
-- identificacao_empresa.sql e vinculo_compra_portal.sql (after update).
begin;

create or replace function public.cnpj_valido(p_cnpj text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare d text := coalesce(p_cnpj, ''); pesos int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2]; soma int; r int;
begin
 if d !~ '^\d{14}$' or d ~ '^(\d)\1{13}$' then return false; end if;
 for n in 12..13 loop
  soma := 0;
  for i in 1..n loop soma := soma + substr(d, i, 1)::int * pesos[i + 13 - n]; end loop;
  r := soma % 11;
  if (case when r < 2 then 0 else 11 - r end) <> substr(d, n + 1, 1)::int then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function public.cnpj_valido(text) from public, anon;
grant execute on function public.cnpj_valido(text) to authenticated, service_role;

create or replace function public.operacao_empresas_guarda_cadastro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 if auth.uid() is null then return new; end if;
 if new.razao_social is not distinct from old.razao_social and new.cnpj is not distinct from old.cnpj then return new; end if;
 if not exists(select 1 from public.operacao_membros m where m.organizacao_id = old.organizacao_id
   and m.usuario_id = auth.uid() and m.empresa_id is null and m.papel = 'gestor') then
  raise exception 'Só o gestor da conta pode corrigir razão social ou CNPJ.' using errcode = '42501';
 end if;
 new.razao_social := btrim(coalesce(new.razao_social, ''));
 if length(new.razao_social) not between 1 and 180 then raise exception 'Informe a razão social (até 180 letras).' using errcode = '22023'; end if;
 new.cnpj := regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g');
 if new.cnpj is distinct from old.cnpj and not public.cnpj_valido(new.cnpj) then
  raise exception 'CNPJ inválido: confira os 14 dígitos.' using errcode = '22023';
 end if;
 return new;
end $$;
revoke all on function public.operacao_empresas_guarda_cadastro() from public, anon, authenticated, service_role;
drop trigger if exists operacao_empresas_guarda_cadastro on public.operacao_empresas;
create trigger operacao_empresas_guarda_cadastro before update of razao_social, cnpj on public.operacao_empresas
 for each row execute function public.operacao_empresas_guarda_cadastro();

notify pgrst, 'reload schema';
commit;
