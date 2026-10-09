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
  /**
   * Token que o Asaas envia no header `asaas-access-token`. Obrigatório para
   * payloads no formato Asaas; sem ele configurado, esse formato é recusado.
   */
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

// Eventos do Asaas que significam "dinheiro recebido". Pix gera PAYMENT_RECEIVED;
// cartão gera PAYMENT_CONFIRMED.
const EVENTOS_ASAAS_PAGO = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);

function tokensIguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Entrada =
  | { formato: 'simulacao'; evento: unknown; fatura_id: unknown; valor_pago: unknown }
  | { formato: 'asaas'; evento: unknown; fatura_id: unknown; valor_pago: unknown; payment_id: unknown };

// Aceita dois formatos na mesma URL:
//   simulação (enunciado do desafio): { fatura_id, valor_pago, evento }
//   Asaas (gateway real):             { event, payment: { id, value, externalReference } }
// No Asaas, a cobrança é criada com externalReference = id da fatura.
function normalizar(body: Record<string, unknown>): Entrada {
  const payment = body.payment;
  if (typeof body.event === 'string' && payment && typeof payment === 'object') {
    const p = payment as Record<string, unknown>;
    return { formato: 'asaas', evento: body.event, fatura_id: p.externalReference, valor_pago: p.value, payment_id: p.id };
  }
  return { formato: 'simulacao', evento: body.evento, fatura_id: body.fatura_id, valor_pago: body.valor_pago };
}

export function createHandler({ liquidar, webhookToken, log = () => {} }: HandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json(405, { erro: 'Método não permitido' });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { erro: 'JSON inválido' });
    }

    const entrada = normalizar((body ?? {}) as Record<string, unknown>);
    const { formato, evento, fatura_id, valor_pago } = entrada;

    // O token protege o formato do gateway. A simulação fica aberta de propósito:
    // ela é chamada pelo navegador, e um token embutido no frontend seria público.
    if (formato === 'asaas') {
      if (!webhookToken) return json(503, { erro: 'Integração Asaas não configurada (WEBHOOK_TOKEN ausente)' });
      const recebido = req.headers.get('asaas-access-token') ?? '';
      if (!tokensIguais(recebido, webhookToken)) return json(401, { erro: 'Token do webhook inválido' });
    }

    // Gateways enviam vários tipos de evento para a mesma URL. Eventos que não
    // tratamos recebem 200 para não entrarem em fila de reenvio.
    const eventoDePagamento = formato === 'asaas'
      ? typeof evento === 'string' && EVENTOS_ASAAS_PAGO.has(evento)
      : evento === 'PAYMENT_RECEIVED';
    if (!eventoDePagamento) {
      log('evento ignorado', { formato, evento });
      return json(200, { resultado: 'ignorado', evento });
    }

    const campoFatura = formato === 'asaas' ? 'payment.externalReference' : 'fatura_id';
    const campoValor = formato === 'asaas' ? 'payment.value' : 'valor_pago';
    if (typeof fatura_id !== 'string' || !UUID_RE.test(fatura_id)) {
      return json(400, { erro: `${campoFatura} deve ser um UUID` });
    }
    if (typeof valor_pago !== 'number' || !Number.isFinite(valor_pago) || valor_pago <= 0) {
      return json(400, { erro: `${campoValor} deve ser um número positivo` });
    }

    try {
      const r = await liquidar(fatura_id, valor_pago);
      const extra = entrada.formato === 'asaas' ? { asaas_payment_id: entrada.payment_id } : {};
      log('webhook processado', { formato, fatura_id, valor_pago, resultado: r.resultado, ...extra });

      // O Asaas reenvia tudo que não for 200 e pausa a fila depois de várias
      // falhas seguidas. Recusas definitivas (valor divergente, fatura
      // inexistente ou cancelada) não melhoram com reenvio: respondemos 200 com
      // o resultado no corpo e deixamos o caso registrado no log para conciliação.
      if (formato === 'asaas') return json(200, { ...r, ...extra });

      return json(HTTP_POR_RESULTADO[r.resultado] ?? 500, r);
    } catch (e) {
      log('erro ao liquidar', { fatura_id, erro: String(e) });
      // 500 faz o gateway reenviar — seguro, pois a liquidação é idempotente.
      return json(500, { erro: 'Erro interno ao processar pagamento' });
    }
  };
}
