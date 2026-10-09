-- =============================================================================
-- Encargos por atraso: dias em atraso, multa, juros e valor atualizado
-- =============================================================================
-- Regra usada (padrão de mercado para cobranças no Brasil):
--   * multa de 2% sobre o valor da parcela, cobrada uma vez;
--   * juros de mora de 1% ao mês, pro rata die (mês comercial de 30 dias).
--
-- Os encargos são INFORMATIVOS: a liquidação continua exigindo o valor
-- original da fatura (requisito do desafio). Ficam na view, e não gravados
-- na tabela, pelo mesmo motivo do status "atrasado": mudam a cada dia e não
-- precisam de job para serem atualizados.
--
-- `create or replace view` só permite acrescentar colunas no fim.
-- =============================================================================

create or replace view public.vw_faturas
with (security_invoker = true)
as
select f.id,
       f.codigo,
       f.parcela,
       c.qtd_semanas as total_parcelas,
       cl.nome       as cliente,
       v.modelo || ' · ' || v.placa as veiculo,
       f.vencimento,
       f.valor,
       case when a.dias_atraso > 0 then 'atrasado' else f.status end as status,
       f.pago_em,
       f.pago_em_brt,
       v.modelo,
       v.placa,
       a.dias_atraso,
       e.multa,
       e.juros,
       f.valor + e.multa + e.juros as valor_atualizado
  from public.faturas f
  join public.contratos c  on c.id  = f.contrato_id
  join public.clientes  cl on cl.id = c.cliente_id
  join public.veiculos  v  on v.id  = c.veiculo_id
  cross join lateral (
    select case
             when f.status = 'pendente'
              and f.vencimento < (now() at time zone 'America/Sao_Paulo')::date
             then (now() at time zone 'America/Sao_Paulo')::date - f.vencimento
             else 0
           end as dias_atraso
  ) a
  cross join lateral (
    select case when a.dias_atraso > 0 then round(f.valor * 0.02, 2) else 0 end::numeric(12,2)                         as multa,
           case when a.dias_atraso > 0 then round(f.valor * 0.01 / 30 * a.dias_atraso, 2) else 0 end::numeric(12,2) as juros
  ) e;
