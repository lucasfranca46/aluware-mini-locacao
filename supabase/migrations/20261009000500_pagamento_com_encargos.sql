-- =============================================================================
-- Fatura atrasada é paga com multa e juros
-- =============================================================================
-- "O valor recebido deve coincidir com o valor da fatura" passa a significar
-- o valor DEVIDO NO DIA DO PAGAMENTO:
--   * em dia (ou vencendo hoje): valor da parcela;
--   * atrasada: valor + multa (2%) + juros (1% a.m. pro rata die).
-- O cálculo fica numa única função, usada pela view (o que a tela mostra) e
-- pela liquidação (o que o banco aceita). Assim os dois nunca divergem.
--
-- A baixa grava o valor pago separado em parcela, multa e juros, para
-- conciliação. Os campos novos também ficam imutáveis depois de pagos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Regra de encargos (única fonte da verdade)
-- -----------------------------------------------------------------------------
create or replace function public.calcular_encargos(p_valor numeric, p_vencimento date, p_data date)
returns table (dias_atraso int, multa numeric(12,2), juros numeric(12,2))
language sql
immutable
as $$
  select d.dias,
         case when d.dias > 0 then round(p_valor * 0.02, 2) else 0 end::numeric(12,2),
         case when d.dias > 0 then round(p_valor * 0.01 / 30 * d.dias, 2) else 0 end::numeric(12,2)
    from (select greatest(p_data - p_vencimento, 0) as dias) d;
$$;

create or replace function public.hoje_brt()
returns date
language sql
stable
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- -----------------------------------------------------------------------------
-- Colunas da baixa: multa e juros pagos
-- -----------------------------------------------------------------------------
alter table public.faturas
  add column multa_paga numeric(12,2),
  add column juros_pago numeric(12,2);

-- Faturas pagas antes desta migration foram quitadas sem encargos.
alter table public.faturas disable trigger trg_faturas_proteger_paga;
update public.faturas set multa_paga = 0, juros_pago = 0 where status = 'pago';
alter table public.faturas enable trigger trg_faturas_proteger_paga;

alter table public.faturas drop constraint faturas_baixa_consistente;
alter table public.faturas add constraint faturas_baixa_consistente check (
  (status = 'pago'
     and pago_em is not null and pago_em_brt is not null
     and multa_paga is not null and juros_pago is not null
     and multa_paga >= 0 and juros_pago >= 0
     and valor_pago = valor + multa_paga + juros_pago)
  or
  (status <> 'pago'
     and pago_em is null and pago_em_brt is null and valor_pago is null
     and multa_paga is null and juros_pago is null)
);

-- -----------------------------------------------------------------------------
-- Imutabilidade: inclui os campos novos
-- -----------------------------------------------------------------------------
create or replace function public.fn_proteger_fatura_paga()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'pago' then
      raise exception 'Fatura % já está paga e não pode ser excluída', old.codigo
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'pago' then
    if new.status is distinct from old.status then
      raise exception 'Fatura % já está paga e não pode ter o status alterado para %', old.codigo, new.status
        using errcode = 'check_violation';
    end if;
    if new.valor is distinct from old.valor
       or new.valor_pago is distinct from old.valor_pago
       or new.multa_paga is distinct from old.multa_paga
       or new.juros_pago is distinct from old.juros_pago
       or new.pago_em is distinct from old.pago_em
       or new.pago_em_brt is distinct from old.pago_em_brt
       or new.vencimento is distinct from old.vencimento
       or new.contrato_id is distinct from old.contrato_id
       or new.parcela is distinct from old.parcela then
      raise exception 'Fatura % já está paga: valores e dados de baixa são imutáveis', old.codigo
        using errcode = 'check_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Liquidação: exige o valor devido no dia (com encargos se atrasada)
-- -----------------------------------------------------------------------------
create or replace function public.liquidar_fatura(
  p_fatura_id  uuid,
  p_valor_pago numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fatura  public.faturas%rowtype;
  v_agora   timestamptz := now();
  v_enc     record;
  v_devido  numeric(12,2);
begin
  select * into v_fatura
    from public.faturas
   where id = p_fatura_id
   for update;

  if not found then
    return jsonb_build_object('resultado', 'nao_encontrada', 'fatura_id', p_fatura_id);
  end if;

  if v_fatura.status = 'pago' then
    return jsonb_build_object(
      'resultado',   'ja_processada',
      'fatura_id',   v_fatura.id,
      'codigo',      v_fatura.codigo,
      'valor_pago',  v_fatura.valor_pago,
      'multa',       v_fatura.multa_paga,
      'juros',       v_fatura.juros_pago,
      'pago_em',     v_fatura.pago_em,
      'pago_em_brt', v_fatura.pago_em_brt
    );
  end if;

  if v_fatura.status = 'cancelado' then
    return jsonb_build_object('resultado', 'cancelada', 'fatura_id', v_fatura.id, 'codigo', v_fatura.codigo);
  end if;

  select * into v_enc
    from calcular_encargos(v_fatura.valor, v_fatura.vencimento, (v_agora at time zone 'America/Sao_Paulo')::date);
  v_devido := v_fatura.valor + v_enc.multa + v_enc.juros;

  if round(p_valor_pago, 2) <> v_devido then
    return jsonb_build_object(
      'resultado',      'valor_divergente',
      'fatura_id',      v_fatura.id,
      'codigo',         v_fatura.codigo,
      'valor_esperado', v_devido,
      'valor_original', v_fatura.valor,
      'multa',          v_enc.multa,
      'juros',          v_enc.juros,
      'dias_atraso',    v_enc.dias_atraso,
      'valor_recebido', p_valor_pago
    );
  end if;

  update public.faturas
     set status      = 'pago',
         valor_pago  = v_devido,
         multa_paga  = v_enc.multa,
         juros_pago  = v_enc.juros,
         pago_em     = v_agora,
         pago_em_brt = v_agora at time zone 'America/Sao_Paulo'
   where id = v_fatura.id;

  return jsonb_build_object(
    'resultado',      'liquidada',
    'fatura_id',      v_fatura.id,
    'codigo',         v_fatura.codigo,
    'valor_pago',     v_devido,
    'valor_original', v_fatura.valor,
    'multa',          v_enc.multa,
    'juros',          v_enc.juros,
    'dias_atraso',    v_enc.dias_atraso,
    'pago_em',        v_agora,
    'pago_em_brt',    v_agora at time zone 'America/Sao_Paulo'
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- View: mesma regra de encargos + o que foi pago
-- -----------------------------------------------------------------------------
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
       case when e.dias_atraso > 0 then 'atrasado' else f.status end as status,
       f.pago_em,
       f.pago_em_brt,
       v.modelo,
       v.placa,
       e.dias_atraso,
       e.multa::numeric(12,2) as multa,
       e.juros::numeric(12,2) as juros,
       f.valor + e.multa + e.juros as valor_atualizado,
       f.valor_pago,
       coalesce(f.multa_paga, 0) + coalesce(f.juros_pago, 0) as encargos_pagos
  from public.faturas f
  join public.contratos c  on c.id  = f.contrato_id
  join public.clientes  cl on cl.id = c.cliente_id
  join public.veiculos  v  on v.id  = c.veiculo_id
  -- Só fatura pendente acumula encargos; paga/cancelada fica com zero.
  cross join lateral calcular_encargos(
    f.valor,
    f.vencimento,
    case when f.status = 'pendente' then hoje_brt() else f.vencimento end
  ) e;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select (valor_pago, multa_paga, juros_pago) on public.faturas to anon, authenticated;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- resetar_demo(): as faturas já pagas do cenário são quitadas com encargos
-- -----------------------------------------------------------------------------
create or replace function public.resetar_demo()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ultimo timestamptz;
  v_espera int;
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_pagas  int := 0;
  r        record;
begin
  select resetado_em into v_ultimo from demo_controle for update;
  if v_ultimo is not null and now() - v_ultimo < interval '30 seconds' then
    v_espera := ceil(extract(epoch from (v_ultimo + interval '30 seconds' - now())))::int;
    return jsonb_build_object('resultado', 'aguarde', 'segundos', v_espera);
  end if;

  truncate public.faturas, public.contratos, public.veiculos, public.clientes restart identity cascade;

  insert into clientes (id, nome, cpf, email, telefone) values
    ('11111111-1111-4111-8111-111111111111', 'Carlos Henrique Souza', '12345678901', 'carlos@example.com',   '11988880001'),
    ('22222222-2222-4222-8222-222222222222', 'Juliana Ferreira',      '23456789012', 'juliana@example.com',  '11988880002'),
    ('33333333-3333-4333-8333-333333333333', 'Rafael Lima',           '34567890123', 'rafael@example.com',   '11988880003'),
    ('44444444-4444-4444-8444-444444444444', 'Mariana Costa',         '45678901234', 'mariana@example.com',  '11988880004'),
    ('55555555-5555-4555-8555-555555555555', 'Pedro Almeida',         '56789012345', 'pedro@example.com',    '11988880005'),
    ('66666666-6666-4666-8666-666666666666', 'Ana Beatriz Rocha',     '67890123456', 'ana@example.com',      '11988880006'),
    ('77777777-7777-4777-8777-777777777777', 'Lucas Martins',         '78901234567', 'lucas@example.com',    '11988880007');

  insert into veiculos (id, placa, modelo, cor, ano) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'FAB1C23', 'Dafra DK 160',      'Preta',    2025),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'GHI4J56', 'Dafra DK 160',      'Azul',     2025),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'KLM7N89', 'Dafra DK 160',      'Vermelha', 2025),
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'QRS2T34', 'Honda CG 160 Start','Preta',    2024),
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'UVW5X67', 'Yamaha Factor 150', 'Branca',   2024),
    ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'BCD8E90', 'Honda Biz 125',     'Vermelha', 2025),
    ('99999999-9999-4999-8999-999999999999', 'HJK3L45', 'Dafra DK 160',      'Azul',     2025);

  -- Contratos inseridos como 'ativo': o trigger gera as faturas. A parcela N
  -- vence em data_inicio + 7*N, então o "início" define quantas já venceram.
  insert into contratos (cliente_id, veiculo_id, valor_semanal, qtd_semanas, data_inicio, status)
  select v.cliente_id, v.veiculo_id, v.valor, v.semanas, v_hoje + v.inicio, 'ativo'
    from (values
      -- Carlos: 2 atrasadas (14 e 7 dias), 1 vence hoje, 1 a vencer -> inadimplente
      ('11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 400.00, 4, -21),
      -- Juliana: em dia, tudo a vencer
      ('22222222-2222-4222-8222-222222222222'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 389.90, 4,  -3),
      -- Rafael: contrato novo, 2 semanas
      ('33333333-3333-4333-8333-333333333333'::uuid, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, 429.90, 2,   0),
      -- Mariana: 4 atrasadas (23, 16, 9 e 2 dias) -> inadimplente grave
      ('44444444-4444-4444-8444-444444444444'::uuid, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid, 450.00, 6, -30),
      -- Pedro: 1 atrasada (3 dias) -> atrasado, mas ainda não inadimplente
      ('55555555-5555-4555-8555-555555555555'::uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid, 420.00, 4, -10),
      -- Ana: em dia, tudo a vencer
      ('66666666-6666-4666-8666-666666666666'::uuid, 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 350.00, 4,  -5),
      -- Lucas: 6 vencidas, as 3 primeiras já pagas (abaixo) -> 3 atrasadas
      ('77777777-7777-4777-8777-777777777777'::uuid, '99999999-9999-4999-8999-999999999999'::uuid, 400.00, 8, -45)
    ) as v(cliente_id, veiculo_id, valor, semanas, inicio);

  -- Algumas faturas já pagas, pelo mesmo caminho do webhook. Estão vencidas,
  -- então são quitadas com multa e juros (o valor que liquidar_fatura exige).
  for r in
    select f.id, f.valor + e.multa + e.juros as valor
      from faturas f
      join contratos c on c.id = f.contrato_id
      cross join lateral calcular_encargos(f.valor, f.vencimento, hoje_brt()) e
     where c.cliente_id = '77777777-7777-4777-8777-777777777777' and f.parcela <= 3
  loop
    perform liquidar_fatura(r.id, r.valor);
    v_pagas := v_pagas + 1;
  end loop;

  insert into demo_controle (id, resetado_em) values (true, now())
  on conflict (id) do update set resetado_em = excluded.resetado_em;

  return jsonb_build_object(
    'resultado', 'ok',
    'faturas',   (select count(*) from faturas),
    'pagas',     v_pagas,
    'resetado_em', now()
  );
end;
$$;

