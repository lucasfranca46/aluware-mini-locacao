-- Dados de exemplo. Os contratos são inseridos como 'ativo', então o trigger
-- gera as faturas automaticamente. Datas relativas a "hoje" para que a tela
-- mostre faturas atrasadas, pendentes e (após simular) pagas.

insert into public.clientes (id, nome, cpf, email, telefone) values
  ('11111111-1111-4111-8111-111111111111', 'Carlos Henrique Souza', '12345678901', 'carlos@example.com', '11988880001'),
  ('22222222-2222-4222-8222-222222222222', 'Juliana Ferreira',      '23456789012', 'juliana@example.com', '11988880002'),
  ('33333333-3333-4333-8333-333333333333', 'Rafael Lima',           '34567890123', 'rafael@example.com',  '11988880003');

insert into public.veiculos (id, placa, modelo, cor, ano) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'FAB1C23', 'Dafra DK 160', 'Preta',    2025),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'GHI4J56', 'Dafra DK 160', 'Azul',     2025),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'KLM7N89', 'Dafra DK 160', 'Vermelha', 2025);

with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
insert into public.contratos (cliente_id, veiculo_id, valor_semanal, qtd_semanas, data_inicio, status)
select v.cliente_id, v.veiculo_id, v.valor_semanal, v.qtd_semanas, hoje.d + v.offset_dias, 'ativo'
  from hoje, (values
    -- R$ 400 x 4 semanas, iniciado há 3 semanas: 2 atrasadas, 1 vencendo hoje, 1 futura
    ('11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 400.00, 4, -21),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 389.90, 4,  -3),
    ('33333333-3333-4333-8333-333333333333'::uuid, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, 429.90, 2,   0)
  ) as v(cliente_id, veiculo_id, valor_semanal, qtd_semanas, offset_dias);
