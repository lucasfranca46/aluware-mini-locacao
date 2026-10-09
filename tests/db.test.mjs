// Testes das regras de banco rodando um Postgres real em WASM (PGlite).
// Não precisa de Docker nem Supabase: `npm test` na raiz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261009000000_mini_locacao.sql', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8');

async function novoBanco() {
  const db = new PGlite();
  // Papéis que o Supabase já cria.
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await db.exec(migration);
  await db.exec(seed);
  return db;
}

async function novoContrato(db, { valor = 400, semanas = 4, status = 'ativo' } = {}) {
  const { rows: [cl] } = await db.query(
    `insert into clientes (nome, cpf) values ('Teste', lpad((random()*1e10)::bigint::text, 11, '0')) returning id`);
  const { rows: [ve] } = await db.query(
    `insert into veiculos (placa, modelo) values ('TST' || floor(random()*9)::int || 'A' || lpad(floor(random()*99)::int::text, 2, '0'), 'DK 160') returning id`);
  const { rows: [ct] } = await db.query(
    `insert into contratos (cliente_id, veiculo_id, valor_semanal, qtd_semanas, data_inicio, status)
     values ($1, $2, $3, $4, '2026-10-01', $5) returning id`, [cl.id, ve.id, valor, semanas, status]);
  return ct.id;
}

const faturasDo = async (db, contratoId) =>
  (await db.query(`select * from faturas where contrato_id = $1 order by parcela`, [contratoId])).rows;

const liquidar = async (db, id, valor) =>
  (await db.query(`select liquidar_fatura($1, $2) as r`, [id, valor])).rows[0].r;

test('contrato ativo de R$ 400 x 4 semanas gera 4 faturas semanais', async () => {
  const db = await novoBanco();
  const id = await novoContrato(db);
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
  assert.equal(porStatus.atrasado, 2);
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
