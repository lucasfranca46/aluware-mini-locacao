-- =============================================================================
-- Dados de demonstração + reset pela tela
-- =============================================================================
-- O site é uma demonstração pública: quem testa vai pagando as faturas e, em
-- pouco tempo, não sobra nada atrasado para testar. resetar_demo() apaga tudo
-- e recria um cenário variado (atrasadas, inadimplentes, a vencer e pagas).
--
-- * Só existe por ser demonstração. Em produção, esta função não existiria.
-- * TRUNCATE não dispara os triggers de linha, então passa por cima da regra
--   "fatura paga é imutável". É o único caminho que faz isso, e é exatamente o
--   que um reset de demo precisa. UPDATE/DELETE continuam bloqueados.
-- * Limite de 1 reset a cada 30 segundos, para ninguém travar o banco.
-- * Datas relativas a "hoje" (Brasília), então o cenário é o mesmo em qualquer dia.
-- =============================================================================

create table if not exists public.demo_controle (
  id           boolean primary key default true check (id),  -- linha única
  resetado_em  timestamptz not null
);
alter table public.demo_controle enable row level security;

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

  -- Algumas faturas já pagas, pelo mesmo caminho do webhook.
  for r in
    select f.id, f.valor
      from faturas f join contratos c on c.id = f.contrato_id
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

revoke all on function public.resetar_demo() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.demo_controle from anon, authenticated;
    grant execute on function public.resetar_demo() to anon, authenticated;
  end if;
end;
$$;
