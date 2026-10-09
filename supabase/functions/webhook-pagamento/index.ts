// Supabase Edge Function: POST /functions/v1/webhook-pagamento
// Body: { fatura_id: string, valor_pago: number, evento: "PAYMENT_RECEIVED" }
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { createHandler, type Liquidar } from './handler.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const liquidar: Liquidar = async (faturaId, valorPago) => {
  const { data, error } = await supabase.rpc('liquidar_fatura', {
    p_fatura_id: faturaId,
    p_valor_pago: valorPago,
  });
  if (error) throw error;
  return data;
};

Deno.serve(
  createHandler({
    liquidar,
    webhookToken: Deno.env.get('WEBHOOK_TOKEN') || undefined,
    log: (msg, extra) => console.log(JSON.stringify({ msg, ...extra })),
  }),
);
