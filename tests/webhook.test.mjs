// Integração: handler HTTP da Edge Function + função liquidar_fatura no Postgres (PGlite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../supabase/functions/webhook-pagamento/handler.ts';

const migration = readFileSync(new URL('../supabase/migrations/20261009000000_mini_locacao.sql', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8');

async function setup({ webhookToken } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await db.exec(migration);
  await db.exec(seed);
  const liquidar = async (id, valor) =>
    (await db.query(`select liquidar_fatura($1, $2) as r`, [id, valor])).rows[0].r;
  const handler = createHandler({ liquidar, webhookToken });
  const call = async (body, headers = {}) => {
    const res = await handler(new Request('http://x/webhook-pagamento', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  };
  const { rows: [fatura] } = await db.query(
    `select id, valor::float as valor from faturas where status = 'pendente' order by numero limit 1`);
  return { db, call, fatura };
}

test('PAYMENT_RECEIVED com valor correto liquida (200)', async () => {
  const { call, fatura, db } = await setup();
  const r = await call({ fatura_id: fatura.id, valor_pago: fatura.valor, evento: 'PAYMENT_RECEIVED' });
  assert.equal(r.status, 200);
  assert.equal(r.body.resultado, 'liquidada');
  const { rows: [f] } = await db.query(`select status from faturas where id = $1`, [fatura.id]);
  assert.equal(f.status, 'pago');
});

test('reenvio do mesmo webhook (inclusive em paralelo) responde 200 sem duplicar baixa', async () => {
  const { call, fatura } = await setup();
  const payload = { fatura_id: fatura.id, valor_pago: fatura.valor, evento: 'PAYMENT_RECEIVED' };
  const respostas = await Promise.all(Array.from({ length: 5 }, () => call(payload)));

  assert.ok(respostas.every(r => r.status === 200));
  const resultados = respostas.map(r => r.body.resultado).sort();
  assert.deepEqual(resultados, ['ja_processada', 'ja_processada', 'ja_processada', 'ja_processada', 'liquidada']);
  const pagoEm = new Set(respostas.map(r => r.body.pago_em));
  assert.equal(pagoEm.size, 1);
});

test('valor divergente -> 422 e fatura continua pendente', async () => {
  const { call, fatura, db } = await setup();
  const r = await call({ fatura_id: fatura.id, valor_pago: fatura.valor - 0.01, evento: 'PAYMENT_RECEIVED' });
  assert.equal(r.status, 422);
  assert.equal(r.body.resultado, 'valor_divergente');
  const { rows: [f] } = await db.query(`select status from faturas where id = $1`, [fatura.id]);
  assert.equal(f.status, 'pendente');
});

test('fatura inexistente -> 404', async () => {
  const { call } = await setup();
  const r = await call({ fatura_id: '00000000-0000-4000-8000-000000000000', valor_pago: 400, evento: 'PAYMENT_RECEIVED' });
  assert.equal(r.status, 404);
});

test('payload inválido -> 400', async () => {
  const { call, fatura } = await setup();
  assert.equal((await call('{nao-json')).status, 400);
  assert.equal((await call({ fatura_id: 'abc', valor_pago: 400, evento: 'PAYMENT_RECEIVED' })).status, 400);
  assert.equal((await call({ fatura_id: fatura.id, valor_pago: '400', evento: 'PAYMENT_RECEIVED' })).status, 400);
  assert.equal((await call({ fatura_id: fatura.id, valor_pago: -1, evento: 'PAYMENT_RECEIVED' })).status, 400);
});

test('outros eventos são ignorados com 200', async () => {
  const { call, fatura } = await setup();
  const r = await call({ fatura_id: fatura.id, valor_pago: fatura.valor, evento: 'PAYMENT_CREATED' });
  assert.equal(r.status, 200);
  assert.equal(r.body.resultado, 'ignorado');
});

test('token do webhook é exigido quando configurado', async () => {
  const { call, fatura } = await setup({ webhookToken: 'segredo' });
  const payload = { fatura_id: fatura.id, valor_pago: fatura.valor, evento: 'PAYMENT_RECEIVED' };
  assert.equal((await call(payload)).status, 401);
  assert.equal((await call(payload, { 'asaas-access-token': 'errado' })).status, 401);
  assert.equal((await call(payload, { 'asaas-access-token': 'segredo' })).status, 200);
});
