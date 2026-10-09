import { createClient } from '@supabase/supabase-js';
import type { Fatura, RespostaReset, RespostaWebhook } from './types';
import * as demo from './demo';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const modoDemo = !SUPABASE_URL || !SUPABASE_ANON_KEY;

const supabase = modoDemo ? null : createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);

export async function listarFaturas(): Promise<Fatura[]> {
  if (!supabase) return demo.listarFaturas();

  const { data, error } = await supabase
    .from('vw_faturas')
    .select('id, codigo, parcela, total_parcelas, cliente, veiculo, modelo, placa, vencimento, valor, status, pago_em, dias_atraso, multa, juros, valor_atualizado, valor_pago, encargos_pagos')
    .order('vencimento')
    .order('codigo');
  if (error) throw error;
  return data.map((f) => ({
    ...f,
    valor: Number(f.valor),
    multa: Number(f.multa),
    juros: Number(f.juros),
    valor_atualizado: Number(f.valor_atualizado),
    valor_pago: f.valor_pago == null ? null : Number(f.valor_pago),
    encargos_pagos: Number(f.encargos_pagos),
  })) as Fatura[];
}

/** Simula o gateway (Asaas) chamando nosso webhook. */
export async function enviarWebhook(faturaId: string, valorPago: number): Promise<RespostaWebhook> {
  const payload = { fatura_id: faturaId, valor_pago: valorPago, evento: 'PAYMENT_RECEIVED' as const };
  if (!supabase) return demo.webhook(payload);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/webhook-pagamento`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({ erro: 'Resposta inválida do servidor' }));
  return { httpStatus: res.status, ...body };
}

/** Recria os dados de demonstração (public.resetar_demo, limitado a 1 vez a cada 30 s). */
export async function resetarDemo(): Promise<RespostaReset> {
  if (!supabase) return demo.resetar();
  const { data, error } = await supabase.rpc('resetar_demo');
  if (error) throw error;
  return data as RespostaReset;
}
