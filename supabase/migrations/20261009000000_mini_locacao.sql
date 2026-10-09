-- =============================================================================
-- Mini-Locação de Motos — schema, regras de negócio e liquidação de faturas
-- =============================================================================
-- Convenções:
--   * Valores monetários em numeric(12,2) — nunca float.
--   * Datas absolutas em timestamptz; a hora "de parede" de Brasília é gravada
--     também em pago_em_brt para leitura direta/relatórios.
--   * Status 'atrasado' NÃO é persistido: é derivado (pendente + vencida) na
--     view vw_faturas, evitando jobs de atualização e estados inconsistentes.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------
create table public.clientes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(trim(nome)) > 0),
  cpf         text not null unique check (cpf ~ '^\d{11}$'),
  email       text,
  telefone    text,
  created_at  timestamptz not null default now()
);

create table public.veiculos (
  id          uuid primary key default gen_random_uuid(),
  placa       text not null unique check (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  modelo      text not null,
  cor         text,
  ano         int  check (ano between 1990 and 2100),
  created_at  timestamptz not null default now()
);

create table public.contratos (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id),
  veiculo_id     uuid not null references public.veiculos(id),
  valor_semanal  numeric(12,2) not null check (valor_semanal > 0),
  qtd_semanas    int  not null check (qtd_semanas between 1 and 520),
  data_inicio    date not null default (now() at time zone 'America/Sao_Paulo')::date,
  status         text not null default 'ativo'
                 check (status in ('rascunho', 'ativo', 'encerrado', 'cancelado')),
  created_at     timestamptz not null default now()
);

-- Um veículo não pode estar em dois contratos ativos ao mesmo tempo.
create unique index contratos_veiculo_ativo_uq
  on public.contratos (veiculo_id) where status = 'ativo';

create table public.faturas (
  id           uuid primary key default gen_random_uuid(),
  numero       bigint generated always as identity unique,
  codigo       text generated always as ('FAT-' || lpad(numero::text, 6, '0')) stored,
  contrato_id  uuid not null references public.contratos(id),
  parcela      int  not null check (parcela > 0),
  vencimento   date not null,
  valor        numeric(12,2) not null check (valor > 0),
  status       text not null default 'pendente'
               check (status in ('pendente', 'pago', 'cancelado')),
  valor_pago   numeric(12,2),
  pago_em      timestamptz,   -- instante absoluto da baixa
  pago_em_brt  timestamp,     -- mesmo instante, relógio de America/Sao_Paulo
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint faturas_parcela_uq unique (contrato_id, parcela),
  -- Fatura paga sempre tem dados de baixa; fatura não paga nunca tem.
  constraint faturas_baixa_consistente check (
    (status = 'pago'  and pago_em is not null and pago_em_brt is not null and valor_pago = valor)
    or
    (status <> 'pago' and pago_em is null and pago_em_brt is null and valor_pago is null)
  )
);

create index faturas_contrato_idx on public.faturas (contrato_id);
create index faturas_status_venc_idx on public.faturas (status, vencimento);

-- -----------------------------------------------------------------------------
-- Trigger 1: gerar faturas ao ativar contrato
-- -----------------------------------------------------------------------------
-- Parcela N vence em data_inicio + 7*N dias (semana usada, semana paga).
-- Dispara no INSERT de contrato 'ativo' e também quando um contrato muda para
-- 'ativo' (ex.: rascunho -> ativo). A checagem de existência + a unique
-- (contrato_id, parcela) impedem geração duplicada.
create or replace function public.fn_gerar_faturas_contrato()
returns trigger
language plpgsql
security definer  -- gera faturas mesmo que quem criou o contrato não tenha INSERT em faturas
set search_path = public
as $$
begin
  if new.status <> 'ativo' then
    return new;
  end if;

  if exists (select 1 from public.faturas where contrato_id = new.id) then
    return new;
  end if;

  insert into public.faturas (contrato_id, parcela, vencimento, valor)
  select new.id,
         s.n,
         new.data_inicio + (s.n * 7),
         new.valor_semanal
    from generate_series(1, new.qtd_semanas) as s(n);

  return new;
end;
$$;

create trigger trg_contratos_gerar_faturas
  after insert or update of status on public.contratos
  for each row
  execute function public.fn_gerar_faturas_contrato();

-- -----------------------------------------------------------------------------
-- Trigger 2: fatura paga é imutável (sem cancelar, sem mudar valor, sem apagar)
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

create trigger trg_faturas_proteger_paga
  before update or delete on public.faturas
  for each row
  execute function public.fn_proteger_fatura_paga();

-- -----------------------------------------------------------------------------
-- Liquidação atômica e idempotente (chamada pelo webhook)
-- -----------------------------------------------------------------------------
-- Retorna jsonb com "resultado":
--   liquidada       -> baixa feita agora
--   ja_processada   -> webhook repetido; nada alterado (idempotente)
--   nao_encontrada  -> fatura inexistente
--   valor_divergente-> valor pago diferente do valor da fatura
--   cancelada       -> fatura cancelada não pode ser paga
--
-- O SELECT ... FOR UPDATE serializa webhooks concorrentes para a mesma fatura:
-- o segundo espera o primeiro commitar e então enxerga status = 'pago'.
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
  v_fatura public.faturas%rowtype;
  v_agora  timestamptz := now();
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
      'pago_em',     v_fatura.pago_em,
      'pago_em_brt', v_fatura.pago_em_brt
    );
  end if;

  if v_fatura.status = 'cancelado' then
    return jsonb_build_object('resultado', 'cancelada', 'fatura_id', v_fatura.id, 'codigo', v_fatura.codigo);
  end if;

  if round(p_valor_pago, 2) <> v_fatura.valor then
    return jsonb_build_object(
      'resultado',      'valor_divergente',
      'fatura_id',      v_fatura.id,
      'codigo',         v_fatura.codigo,
      'valor_esperado', v_fatura.valor,
      'valor_recebido', p_valor_pago
    );
  end if;

  update public.faturas
     set status      = 'pago',
         valor_pago  = v_fatura.valor,
         pago_em     = v_agora,
         pago_em_brt = v_agora at time zone 'America/Sao_Paulo'
   where id = v_fatura.id;

  return jsonb_build_object(
    'resultado',   'liquidada',
    'fatura_id',   v_fatura.id,
    'codigo',      v_fatura.codigo,
    'valor_pago',  v_fatura.valor,
    'pago_em',     v_agora,
    'pago_em_brt', v_agora at time zone 'America/Sao_Paulo'
  );
end;
$$;

-- Só o backend (service_role) pode liquidar.
revoke all on function public.liquidar_fatura(uuid, numeric) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.liquidar_fatura(uuid, numeric) from anon, authenticated;
    grant execute on function public.liquidar_fatura(uuid, numeric) to service_role;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- View de leitura para o frontend (status 'atrasado' derivado)
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
       case
         when f.status = 'pendente'
          and f.vencimento < (now() at time zone 'America/Sao_Paulo')::date
         then 'atrasado'
         else f.status
       end           as status,
       f.pago_em,
       f.pago_em_brt
  from public.faturas f
  join public.contratos c  on c.id  = f.contrato_id
  join public.clientes  cl on cl.id = c.cliente_id
  join public.veiculos  v  on v.id  = c.veiculo_id;

-- -----------------------------------------------------------------------------
-- RLS: leitura pública (demo), escrita apenas via service_role / funções
-- -----------------------------------------------------------------------------
alter table public.clientes  enable row level security;
alter table public.veiculos  enable row level security;
alter table public.contratos enable row level security;
alter table public.faturas   enable row level security;

create policy "leitura demo" on public.clientes  for select using (true);
create policy "leitura demo" on public.veiculos  for select using (true);
create policy "leitura demo" on public.contratos for select using (true);
create policy "leitura demo" on public.faturas   for select using (true);
