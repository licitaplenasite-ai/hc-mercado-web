-- Recurso "Orçamento de obra" (orcamento-obra.html, agente Orçamentista): só nos planos Empresa e Assessoria,
-- no teste de 14 dias (que tem tudo do Empresa) e na conta do dono. Essencial e Teste encerrado não têm.
-- Separado de planos_e_recursos.sql de propósito: aquele arquivo está sendo mexido em outro trabalho. Roda depois dele.
-- Idempotente (seguro rodar mais de uma vez) — SQL Editor do Supabase. "do nothing": o que o dono mudar no admin fica.
-- Sem rota /api: a conta roda no navegador e só lê tabelas que o plano já libera (sinapi_*); a trava é a da tela
-- (plano-trava.js, data-recurso="orcamento_obra"), a mesma de Mercado, Prospecção e Pesquisa de Preços.
insert into public.recursos_plano (codigo, nome, funcoes)
values ('orcamento_obra', 'Orçamento de obra (Orçamentista)', '{}')
on conflict (codigo) do nothing;

insert into public.plano_recursos (plano, recurso, permitido)
select p.codigo, 'orcamento_obra', p.codigo in ('teste', 'empresa', 'assessoria', 'dono')
from public.planos p
on conflict (plano, recurso) do nothing;
