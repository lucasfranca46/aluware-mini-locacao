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

test('simulação (formato do desafio) não exige token, mesmo com WEBHOOK_TOKEN configurado', async () => {
  const { call, fatura } = await setup({ webhookToken: 'segredo' });
  const r = await call({ fatura_id: fatura.id, valor_pago: fatura.valor, evento: 'PAYMENT_RECEIVED' });
  assert.equal(r.status, 200);
  assert.equal(r.body.resultado, 'liquidada');
});

// ---------------------------------------------------------------------------
// Formato Asaas: { event, payment: { id, value, externalReference } }
// ---------------------------------------------------------------------------
const asaas = (fatura, { event = 'PAYMENT_RECEIVED', value = fatura.valor } = {}) => ({
  id: 'evt_1', event,
  payment: { object: 'payment', id: 'pay_123', value, netValue: value - 1.99, billingType: 'PIX', externalReference: fatura.id },
});
const TOKEN = { 'asaas-access-token': 'segredo' };

test('Asaas: token é obrigatório e precisa estar configurado', async () => {
  const semConfig = await setup();
  assert.equal((await semConfig.call(asaas(semConfig.fatura), TOKEN)).status, 503);

  const { call, fatura } = await setup({ webhookToken: 'segredo' });
  assert.equal((await call(asaas(fatura))).status, 401);
  assert.equal((await call(asaas(fatura), { 'asaas-access-token': 'errado' })).status, 401);
});

test('Asaas: PAYMENT_RECEIVED com token certo liquida pela externalReference', async () => {
  const { call, fatura, db } = await setup({ webhookToken: 'segredo' });
  const r = await call(asaas(fatura), TOKEN);
  assert.equal(r.status, 200);
  assert.equal(r.body.resultado, 'liquidada');
  assert.equal(r.body.asaas_payment_id, 'pay_123');
  const { rows: [f] } = await db.query(`select status, valor_pago::float as v from faturas where id = $1`, [fatura.id]);
  assert.equal(f.status, 'pago');
  assert.equal(f.v, fatura.valor);
});

test('Asaas: reenvio é idempotente e PAYMENT_CONFIRMED também conta como pago', async () => {
  const { call, fatura } = await setup({ webhookToken: 'segredo' });
  const primeiro = await call(asaas(fatura, { event: 'PAYMENT_CONFIRMED' }), TOKEN);
  const segundo = await call(asaas(fatura), TOKEN);
  assert.equal(primeiro.body.resultado, 'liquidada');
  assert.equal(segundo.status, 200);
  assert.equal(segundo.body.resultado, 'ja_processada');
  assert.equal(segundo.body.pago_em, primeiro.body.pago_em);
});

test('Asaas: recusa definitiva responde 200 (sem reenvio) e não liquida', async () => {
  const { call, fatura, db } = await setup({ webhookToken: 'segredo' });
  const r = await call(asaas(fatura, { value: fatura.valor - 10 }), TOKEN);
  assert.equal(r.status, 200);
  assert.equal(r.body.resultado, 'valor_divergente');
  const { rows: [f] } = await db.query(`select status from faturas where id = $1`, [fatura.id]);
  assert.equal(f.status, 'pendente');
});

test('Asaas: outros eventos são ignorados e payload sem externalReference é 400', async () => {
  const { call, fatura } = await setup({ webhookToken: 'segredo' });
  const criado = await call(asaas(fatura, { event: 'PAYMENT_CREATED' }), TOKEN);
  assert.equal(criado.status, 200);
  assert.equal(criado.body.resultado, 'ignorado');

  const semRef = asaas(fatura);
  delete semRef.payment.externalReference;
  const r = await call(semRef, TOKEN);
  assert.equal(r.status, 400);
  assert.match(r.body.erro, /externalReference/);
});
