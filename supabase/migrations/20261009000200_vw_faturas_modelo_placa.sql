-- =============================================================================
-- vw_faturas: modelo e placa em colunas próprias
-- =============================================================================
-- A tela filtra por cliente, placa e veículo separadamente. Em vez de quebrar
-- o texto "modelo · placa" no frontend, a view entrega os dois campos.
-- `create or replace view` só permite acrescentar colunas no fim; as grants
-- da migration anterior continuam valendo.
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
       case
         when f.status = 'pendente'
          and f.vencimento < (now() at time zone 'America/Sao_Paulo')::date
         then 'atrasado'
         else f.status
       end           as status,
       f.pago_em,
       f.pago_em_brt,
       v.modelo,
       v.placa
  from public.faturas f
  join public.contratos c  on c.id  = f.contrato_id
  join public.clientes  cl on cl.id = c.cliente_id
  join public.veiculos  v  on v.id  = c.veiculo_id;
