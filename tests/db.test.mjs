// Testes das regras de banco rodando um Postgres real em WASM (PGlite).
// Não precisa de Docker nem Supabase: `npm test` na raiz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Todas as migrations, na ordem do nome (timestamp), como o Supabase aplica.
const dirMigrations = new URL('../supabase/migrations/', import.meta.url);
const migration = readdirSync(dirMigrations).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(new URL(f, dirMigrations), 'utf8')).join('\n');
const seed = readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8');

async function novoBanco() {
  const db = new PGlite();
  // Papéis que o Supabase já cria.
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await db.exec(migration);
  await db.exec(seed);
  return db;
}

// Por padrão o contrato começa hoje (Brasília): nenhuma parcela vencida, então
// o valor devido é o valor da parcela, sem encargos.
async function novoContrato(db, { valor = 400, semanas = 4, status = 'ativo', inicio = null } = {}) {
  const { rows: [cl] } = await db.query(
    `insert into clientes (nome, cpf) values ('Teste', lpad((random()*1e10)::bigint::text, 11, '0')) returning id`);
  const { rows: [ve] } = await db.query(
    `insert into veiculos (placa, modelo) values ('TST' || floor(random()*9)::int || 'A' || lpad(floor(random()*99)::int::text, 2, '0'), 'DK 160') returning id`);
  const { rows: [ct] } = await db.query(
    `insert into contratos (cliente_id, veiculo_id, valor_semanal, qtd_semanas, data_inicio, status)
     values ($1, $2, $3, $4, coalesce($6::date, hoje_brt()), $5) returning id`, [cl.id, ve.id, valor, semanas, status, inicio]);
  return ct.id;
}

const faturasDo = async (db, contratoId) =>
  (await db.query(`select * from faturas where contrato_id = $1 order by parcela`, [contratoId])).rows;

const liquidar = async (db, id, valor) =>
  (await db.query(`select liquidar_fatura($1, $2) as r`, [id, valor])).rows[0].r;

test('contrato ativo de R$ 400 x 4 semanas gera 4 faturas semanais', async () => {
  const db = await novoBanco();
  const id = await novoContrato(db, { inicio: '2026-10-01' });
  const fs = await faturasDo(db, id);

  assert.equal(fs.length, 4);
  assert.deepEqual(fs.map(f => f.parcela), [1, 2, 3, 4]);
  assert.ok(fs.every(f => Number(f.valor) === 400 && f.status === 'pendente'));
  assert.deepEqual(
    fs.map(f => f.vencimento.toISOString().slice(0, 10)),
    ['2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'],
  );
  assert.match(fs[0].codigo, /^FAT-\d{6}$/);
});

test('contrato rascunho não gera faturas; ao ativar, gera uma única vez', async () => {
  const db = await novoBanco();
  const id = await novoContrato(db, { status: 'rascunho', semanas: 3 });
  assert.equal((await faturasDo(db, id)).length, 0);

  await db.query(`update contratos set status = 'ativo' where id = $1`, [id]);
  assert.equal((await faturasDo(db, id)).length, 3);

  await db.query(`update contratos set status = 'encerrado' where id = $1`, [id]);
  await db.query(`update contratos set status = 'ativo' where id = $1`, [id]);
  assert.equal((await faturasDo(db, id)).length, 3);
});

test('liquidação grava pago + data/hora no fuso de Brasília', async () => {
  const db = await novoBanco();
  const [f] = await faturasDo(db, await novoContrato(db));

  const r = await liquidar(db, f.id, 400);
  assert.equal(r.resultado, 'liquidada');

  const { rows: [p] } = await db.query(
    `select status, valor_pago, pago_em, pago_em_brt,
            pago_em_brt = (pago_em at time zone 'America/Sao_Paulo') as brt_ok
       from faturas where id = $1`, [f.id]);
  assert.equal(p.status, 'pago');
  assert.equal(Number(p.valor_pago), 400);
  assert.ok(p.pago_em);
  assert.equal(p.brt_ok, true);
});

test('webhook repetido é idempotente: não altera a baixa original', async () => {
  const db = await novoBanco();
  const [f] = await faturasDo(db, await novoContrato(db));

  const r1 = await liquidar(db, f.id, 400);
  const r2 = await liquidar(db, f.id, 400);
  const r3 = await liquidar(db, f.id, 400);

  assert.equal(r1.resultado, 'liquidada');
  assert.equal(r2.resultado, 'ja_processada');
  assert.equal(r3.resultado, 'ja_processada');
  assert.equal(r2.pago_em, r1.pago_em);
  const { rows } = await db.query(`select count(*)::int n from faturas where id = $1 and status = 'pago'`, [f.id]);
  assert.equal(rows[0].n, 1);
});

test('valor divergente não liquida', async () => {
  const db = await novoBanco();
  const [f] = await faturasDo(db, await novoContrato(db));

  assert.equal((await liquidar(db, f.id, 399.99)).resultado, 'valor_divergente');
  assert.equal((await liquidar(db, f.id, 400.001)).resultado, 'liquidada'); // arredonda a centavos
});

test('fatura inexistente e fatura cancelada', async () => {
  const db = await novoBanco();
  const [f] = await faturasDo(db, await novoContrato(db));

  assert.equal((await liquidar(db, '00000000-0000-4000-8000-000000000000', 400)).resultado, 'nao_encontrada');
  await db.query(`update faturas set status = 'cancelado' where id = $1`, [f.id]);
  assert.equal((await liquidar(db, f.id, 400)).resultado, 'cancelada');
});

test('fatura paga não pode ser cancelada, alterada ou excluída', async () => {
  const db = await novoBanco();
  const [f] = await faturasDo(db, await novoContrato(db));
  await liquidar(db, f.id, 400);

  await assert.rejects(db.query(`update faturas set status = 'cancelado' where id = $1`, [f.id]), /não pode ter o status alterado/);
  await assert.rejects(db.query(`update faturas set status = 'pendente' where id = $1`, [f.id]), /não pode ter o status alterado/);
  await assert.rejects(db.query(`update faturas set valor = 1 where id = $1`, [f.id]), /imutáveis/);
  await assert.rejects(db.query(`update faturas set pago_em = now() - interval '1 day' where id = $1`, [f.id]), /imutáveis/);
  await assert.rejects(db.query(`delete from faturas where id = $1`, [f.id]), /não pode ser excluída/);
});

test('fatura pendente pode ser cancelada e ter valor ajustado', async () => {
  const db = await novoBanco();
  const [, f2, f3] = await faturasDo(db, await novoContrato(db));

  await db.query(`update faturas set valor = 350 where id = $1`, [f2.id]);
  await db.query(`update faturas set status = 'cancelado' where id = $1`, [f3.id]);
});

test('constraint impede marcar como pago sem dados de baixa', async () => {
  const db = await novoBanco();
  const [f] = await faturasDo(db, await novoContrato(db));
  await assert.rejects(db.query(`update faturas set status = 'pago' where id = $1`, [f.id]), /faturas_baixa_consistente/);
});

test('view deriva status atrasado e seed tem cenários variados', async () => {
  const db = await novoBanco();
  const { rows } = await db.query(`select status, count(*)::int n from vw_faturas group by status order by status`);
  const porStatus = Object.fromEntries(rows.map(r => [r.status, r.n]));
  // Carlos 2 + Mariana 4 + Pedro 1 + Lucas 3 (as 3 primeiras dele já vêm pagas)
  assert.equal(porStatus.atrasado, 10);
  assert.equal(porStatus.pago, 3);
  assert.ok(porStatus.pendente > 0);
});

test('veículo não pode ter dois contratos ativos', async () => {
  const db = await novoBanco();
  await assert.rejects(
    db.query(`insert into contratos (cliente_id, veiculo_id, valor_semanal, qtd_semanas)
              values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 400, 4)`),
    /contratos_veiculo_ativo_uq/,
  );
});

test('papel anon (chave pública do site) lê a vw_faturas, mas não CPF/e-mail/telefone', async () => {
  const db = await novoBanco();
  await db.exec('set role anon');

  const { rows } = await db.query(`select codigo, cliente, veiculo, status from vw_faturas`);
  assert.equal(rows.length, 32);
  assert.ok(rows[0].cliente && rows[0].veiculo);

  for (const sql of [
    'select cpf from clientes',
    'select email from clientes',
    'select telefone from clientes',
    'select * from clientes',
    'select valor_semanal from contratos',
  ]) {
    await assert.rejects(db.query(sql), /permission denied/, sql);
  }
  await assert.rejects(db.query(`update faturas set status = 'pago'`), /permission denied/);
  await db.exec('reset role');
});

test('vw_faturas expõe modelo e placa separados (filtros da tela)', async () => {
  const db = await novoBanco();
  await db.exec('set role anon');
  const { rows } = await db.query(`select modelo, placa, veiculo from vw_faturas where placa = 'FAB1C23'`);
  await db.exec('reset role');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].modelo, 'Dafra DK 160');
  assert.equal(rows[0].veiculo, 'Dafra DK 160 · FAB1C23');
});

test('encargos de atraso: multa 2% + juros 1% a.m. pro rata, só para faturas atrasadas', async () => {
  const db = await novoBanco();
  // Seed: contrato do Carlos (R$ 400) começou há 21 dias -> parcela 1 venceu há 14 dias, parcela 2 há 7.
  const { rows } = await db.query(`
    select parcela, status, dias_atraso, multa::float, juros::float, valor_atualizado::float
      from vw_faturas where placa = 'FAB1C23' order by parcela`);

  assert.deepEqual(rows[0], { parcela: 1, status: 'atrasado', dias_atraso: 14, multa: 8, juros: 1.87, valor_atualizado: 409.87 });
  assert.deepEqual(rows[1], { parcela: 2, status: 'atrasado', dias_atraso: 7, multa: 8, juros: 0.93, valor_atualizado: 408.93 });
  for (const r of rows.slice(2)) {
    assert.equal(r.dias_atraso, 0);
    assert.equal(r.valor_atualizado, 400);
  }
});

test('fatura paga não gera encargos, mesmo vencida', async () => {
  const db = await novoBanco();
  const { rows: [f] } = await db.query(`select id, valor_atualizado from vw_faturas where placa = 'FAB1C23' and parcela = 1`);
  await db.query(`select liquidar_fatura($1, $2)`, [f.id, f.valor_atualizado]);
  const { rows: [r] } = await db.query(`select status, dias_atraso, multa::float, juros::float from vw_faturas where id = $1`, [f.id]);
  assert.deepEqual(r, { status: 'pago', dias_atraso: 0, multa: 0, juros: 0 });
});

test('resetar_demo recria o cenário, inclusive faturas pagas, e limita a 1 reset a cada 30 s', async () => {
  const db = await novoBanco();
  // Simula uso do site: paga tudo que está atrasado.
  const { rows: atrasadas } = await db.query(`select id, valor_atualizado as valor from vw_faturas where status = 'atrasado'`);
  for (const f of atrasadas) await db.query(`select liquidar_fatura($1, $2)`, [f.id, f.valor]);

  // Reset logo depois da carga inicial: bloqueado pelo limite de 30 s.
  const { rows: [bloqueado] } = await db.query(`select resetar_demo() as r`);
  assert.equal(bloqueado.r.resultado, 'aguarde');

  await db.query(`update demo_controle set resetado_em = now() - interval '1 minute'`);
  await db.exec('set role anon');                       // o botão do site chama como anon
  const { rows: [ok] } = await db.query(`select resetar_demo() as r`);
  const { rows: [{ n }] } = await db.query(`select count(*)::int n from vw_faturas where status = 'atrasado'`);
  await db.exec('reset role');
  assert.equal(ok.r.resultado, 'ok');
  assert.equal(ok.r.faturas, 32);
  assert.equal(n, 10);

  // anon não consegue mexer no controle do reset diretamente.
  await db.exec('set role anon');
  await assert.rejects(db.query(`update demo_controle set resetado_em = now() - interval '1 hour'`), /permission denied/);
  await db.exec('reset role');
});

test('fatura atrasada só é liquidada com multa + juros, gravados separadamente', async () => {
  const db = await novoBanco();
  // Carlos, parcela 1: R$ 400 vencida há 14 dias -> 400 + 8,00 + 1,87
  const { rows: [f] } = await db.query(`select id from vw_faturas where placa = 'FAB1C23' and parcela = 1`);

  const original = await liquidar(db, f.id, 400);
  assert.equal(original.resultado, 'valor_divergente');
  assert.equal(Number(original.valor_esperado), 409.87);

  const r = await liquidar(db, f.id, 409.87);
  assert.equal(r.resultado, 'liquidada');
  assert.equal(r.dias_atraso, 14);

  const { rows: [p] } = await db.query(
    `select valor_pago::float, multa_paga::float, juros_pago::float from faturas where id = $1`, [f.id]);
  assert.deepEqual(p, { valor_pago: 409.87, multa_paga: 8, juros_pago: 1.87 });

  const { rows: [v] } = await db.query(
    `select status, dias_atraso, encargos_pagos::float, valor_pago::float from vw_faturas where id = $1`, [f.id]);
  assert.deepEqual(v, { status: 'pago', dias_atraso: 0, encargos_pagos: 9.87, valor_pago: 409.87 });

  // Reenvio com o mesmo valor: idempotente, sem recalcular encargos.
  assert.equal((await liquidar(db, f.id, 409.87)).resultado, 'ja_processada');
  await assert.rejects(db.query(`update faturas set juros_pago = 0 where id = $1`, [f.id]), /imutáveis/);
});

test('fatura em dia (ou vencendo hoje) é paga sem encargos', async () => {
  const db = await novoBanco();
  // Carlos, parcela 3: vence hoje -> ainda sem atraso
  const { rows: [f] } = await db.query(`select id, status, dias_atraso from vw_faturas where placa = 'FAB1C23' and parcela = 3`);
  assert.equal(f.status, 'pendente');
  assert.equal(f.dias_atraso, 0);
  const r = await liquidar(db, f.id, 400);
  assert.equal(r.resultado, 'liquidada');
  assert.equal(Number(r.multa) + Number(r.juros), 0);
});
