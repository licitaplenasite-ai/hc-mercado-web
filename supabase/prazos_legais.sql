-- Prazos legais automáticos do processo (Lei 14.133/2021). Idempotente, transação única; rodar no SQL Editor do Supabase
-- depois de operacao_licitacoes.sql (tabelas) e de operacao_esteira.sql. Não apaga dados.
--
-- Texto conferido no Planalto em 24/11/2026 (https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm):
--  art. 164, caput: impugnação e pedido de esclarecimento "até 3 (três) dias úteis antes da data de abertura do certame";
--  art. 165, § 1º, I: a intenção de recorrer é manifestada "imediatamente, sob pena de preclusão" (na sessão; o Meu dia avisa);
--  art. 183, caput e § 2º: só conta dia com expediente; vencimento em dia sem expediente vai para o primeiro dia útil seguinte.
-- O prazo do EDITAL prevalece: a linha nasce marcada (observacoes = marca abaixo) e a tela "Corrigir data" troca a marca,
-- então correção feita à mão nunca é sobrescrita por mudança posterior da data da sessão.
--
-- Corrige duas falhas do bloco (b) antigo de iniciar_esteira_processo (operacao_esteira.sql):
--  1. contava só sábado e domingo; feriado nacional na janela empurrava o último dia para DEPOIS do prazo real;
--  2. só rodava no INSERT e na troca de status; mudar a data da sessão deixava o prazo velho.
--  3. só valia para processo vindo do PNCP; o cadastrado à mão ficava sem prazo.
-- Feriados: os nacionais fixos + Sexta-feira Santa, e Carnaval e Corpus Christi como dia sem expediente (muito órgão fecha).
-- É a mesma regra de juridico-prazos.js (opção "antes da abertura"), sempre do lado seguro: o último dia sai mais cedo.
-- shortcut: feriado estadual/municipal do órgão não entra; a tela pede para conferir o edital.
begin;
set local lock_timeout = '5s';
do $$ begin
 if to_regclass('public.operacao_prazos_processo') is null or to_regclass('public.operacao_processos') is null then
  raise exception 'Aplique antes operacao_licitacoes.sql';
 end if;
end $$;

-- Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, o mesmo de juridico-prazos.js).
create or replace function public.pascoa_ano(p_ano int) returns date
language plpgsql immutable set search_path = '' as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
begin
 a := p_ano % 19; b := p_ano / 100; c := p_ano % 100; d := b / 4; e := b % 4; f := (b + 8) / 25;
 g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
 l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
 return make_date(p_ano, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;

-- Dia útil para prazo "antes da abertura": sem fim de semana, feriado nacional, Carnaval (seg/ter) e Corpus Christi.
create or replace function public.dia_util_licitacao(p_dia date) returns boolean
language sql immutable set search_path = '' as $$
 select extract(isodow from p_dia) < 6
   and to_char(p_dia, 'MM-DD') <> all (array['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'])
   and (p_dia - public.pascoa_ano(extract(year from p_dia)::int)) not in (-48, -47, -2, 60)
$$;

-- Último dia "até N dias úteis antes" da data (art. 164 + art. 183: o dia da abertura não conta).
-- N limitado a 0..30: a lei usa 3; teto evita laço longo se alguém chamar com número enorme.
create or replace function public.dias_uteis_antes(p_dia date, p_n int) returns date
language plpgsql immutable set search_path = '' as $$
declare d date := p_dia; n int := 0;
begin
 if p_n is null or p_n < 0 or p_n > 30 then raise exception 'Número de dias úteis fora de 0 a 30'; end if;
 while n < p_n loop
  d := d - 1;
  if public.dia_util_licitacao(d) then n := n + 1; end if;
 end loop;
 return d;
end $$;

-- Recalcula os prazos automáticos de um processo. Chamada pelo gatilho e pelo acerto único do fim do arquivo.
--  * processo ativo com sessão: recalcula o automático aberto, reabre o fechado só por sessão apagada ou processo
--    encerrado, e cria o que falta (só se o processo não tem nenhum prazo daquela categoria);
--  * sem sessão: fecha o automático aberto (mesmo texto de processos.html para o prazo da sessão);
--  * perdido, contratado ou arquivado: fecha o automático aberto (impugnar não serve mais para nada).
-- Corrigido à mão (marca trocada pela tela) ou concluído pela pessoa nunca é tocado.
create or replace function public.recalcular_prazos_legais(p_processo uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
 v_marca constant text := 'calculado pela regra legal; confira o edital'; -- mesma marca do bloco antigo da esteira
 v_sem_sessao constant text := 'Sessão removida do cadastro do processo';
 v_encerrado constant text := 'Processo encerrado (perdido, contratado ou arquivado)';
 p public.operacao_processos;
 v_venc timestamptz;
 v_fecha text;
 cat record;
begin
 select * into p from public.operacao_processos where id = p_processo;
 if p.id is null then return; end if;
 if p.status in ('arquivado', 'perdido', 'contratado') then v_fecha := v_encerrado;
 elsif p.data_sessao is null then v_fecha := v_sem_sessao;
 else
  v_venc := (public.dias_uteis_antes((p.data_sessao at time zone 'America/Sao_Paulo')::date, 3) + time '23:59') at time zone 'America/Sao_Paulo';
 end if;
 for cat in select * from (values ('impugnacao', 'Impugnação'), ('esclarecimento', 'Esclarecimento')) v(categoria, titulo) loop
  if v_fecha is not null then
   update public.operacao_prazos_processo set concluido_em = now(), observacoes = v_fecha
    where processo_id = p.id and categoria = cat.categoria and observacoes = v_marca and concluido_em is null;
  else
   update public.operacao_prazos_processo set vencimento = v_venc, concluido_em = null, observacoes = v_marca
    where processo_id = p.id and categoria = cat.categoria
      and ((observacoes = v_marca and concluido_em is null) or observacoes in (v_sem_sessao, v_encerrado));
   if not found then
    insert into public.operacao_prazos_processo (organizacao_id, processo_id, categoria, titulo, vencimento, observacoes)
    select p.organizacao_id, p.id, cat.categoria, cat.titulo, v_venc, v_marca
     where v_venc > now()
       and not exists (select 1 from public.operacao_prazos_processo x where x.processo_id = p.id and x.categoria = cat.categoria);
   end if;
  end if;
 end loop;
end $$;

create or replace function public.prazos_legais_processo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 perform public.recalcular_prazos_legais(new.id);
 return null;
end $$;

-- Só o banco usa estas funções (gatilho, como dono). Ninguém de fora chama, nem o anon nem o usuário logado.
revoke all on function public.pascoa_ano(int), public.dia_util_licitacao(date), public.dias_uteis_antes(date, int),
  public.recalcular_prazos_legais(uuid), public.prazos_legais_processo() from public, anon, authenticated, service_role;

-- Todo processo (manual ou do PNCP). Nome depois de "iniciar_esteira_processo": se o bloco antigo ainda estiver no
-- banco, ele cria primeiro e este gatilho corrige a data na mesma transação. Status final fecha os automáticos.
drop trigger if exists prazos_legais_processo on public.operacao_processos;
create trigger prazos_legais_processo after insert or update of data_sessao, status on public.operacao_processos
  for each row execute function public.prazos_legais_processo();

-- Acerto único (idempotente): processos ativos com sessão futura recalculam agora. Corrige as datas antigas sem
-- feriado (do lado perigoso) e cria o que faltava nos processos cadastrados à mão. Não toca em nada corrigido à mão.
do $$ declare r record; begin
 for r in select id from public.operacao_processos
           where data_sessao > now() and status not in ('arquivado', 'perdido', 'contratado') loop
  perform public.recalcular_prazos_legais(r.id);
 end loop;
end $$;

commit;
