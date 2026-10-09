// Lógica do webhook, sem dependências de runtime (testável em Node e Deno).
// A baixa em si (lock, idempotência, fuso) acontece no banco, em
// public.liquidar_fatura — aqui ficam validação de entrada, autenticação e
// tradução do resultado para HTTP.

export type ResultadoLiquidacao =
  | 'liquidada'
  | 'ja_processada'
  | 'nao_encontrada'
  | 'valor_divergente'
  | 'cancelada';

export type Liquidar = (faturaId: string, valorPago: number) => Promise<Record<string, unknown> & { resultado: ResultadoLiquidacao }>;

export interface HandlerDeps {
  liquidar: Liquidar;
  /** Se definido, exige o header `asaas-access-token` igual a este valor. */
  webhookToken?: string;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, asaas-access-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });

// Mapeamento resultado do banco -> HTTP.
// ja_processada responde 200: o gateway reenviou e não deve continuar tentando.
const HTTP_POR_RESULTADO: Record<ResultadoLiquidacao, number> = {
  liquidada: 200,
  ja_processada: 200,
  nao_encontrada: 404,
  valor_divergente: 422,
  cancelada: 409,
};

function tokensIguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function createHandler({ liquidar, webhookToken, log = () => {} }: HandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json(405, { erro: 'Método não permitido' });

    if (webhookToken) {
      const recebido = req.headers.get('asaas-access-token') ?? '';
      if (!tokensIguais(recebido, webhookToken)) return json(401, { erro: 'Token do webhook inválido' });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { erro: 'JSON inválido' });
    }

    const { fatura_id, valor_pago, evento } = (body ?? {}) as Record<string, unknown>;

    // Gateways enviam vários tipos de evento para a mesma URL. Eventos que não
    // tratamos recebem 200 para não entrarem em fila de reenvio.
    if (evento !== 'PAYMENT_RECEIVED') {
      log('evento ignorado', { evento });
      return json(200, { resultado: 'ignorado', evento });
    }

    if (typeof fatura_id !== 'string' || !UUID_RE.test(fatura_id)) {
      return json(400, { erro: 'fatura_id deve ser um UUID' });
    }
    if (typeof valor_pago !== 'number' || !Number.isFinite(valor_pago) || valor_pago <= 0) {
      return json(400, { erro: 'valor_pago deve ser um número positivo' });
    }

    try {
      const r = await liquidar(fatura_id, valor_pago);
      log('webhook processado', { fatura_id, valor_pago, resultado: r.resultado });
      return json(HTTP_POR_RESULTADO[r.resultado] ?? 500, r);
    } catch (e) {
      log('erro ao liquidar', { fatura_id, erro: String(e) });
      // 500 faz o gateway reenviar — seguro, pois a liquidação é idempotente.
      return json(500, { erro: 'Erro interno ao processar pagamento' });
    }
  };
}
