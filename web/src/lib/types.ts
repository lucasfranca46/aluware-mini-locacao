export type StatusFatura = 'pendente' | 'pago' | 'atrasado' | 'cancelado';

export interface Fatura {
  id: string;
  codigo: string;
  parcela: number;
  total_parcelas: number;
  cliente: string;
  veiculo: string; // "modelo · placa"
  modelo: string;
  placa: string;
  vencimento: string; // YYYY-MM-DD
  valor: number;
  status: StatusFatura;
  pago_em: string | null;
  // Encargos por atraso, calculados no banco para hoje. A baixa exige o
  // valor_atualizado (= valor quando a fatura não está atrasada).
  dias_atraso: number;
  multa: number;
  juros: number;
  valor_atualizado: number;
  // O que foi efetivamente pago (faturas pagas).
  valor_pago: number | null;
  encargos_pagos: number;
}

export type ResultadoWebhook =
  | 'liquidada'
  | 'ja_processada'
  | 'nao_encontrada'
  | 'valor_divergente'
  | 'cancelada'
  | 'ignorado';

export interface RespostaWebhook {
  httpStatus: number;
  resultado?: ResultadoWebhook;
  codigo?: string;
  pago_em?: string;
  valor_pago?: number;
  valor_original?: number;
  multa?: number;
  juros?: number;
  dias_atraso?: number;
  valor_esperado?: number;
  valor_recebido?: number;
  erro?: string;
}

export type RespostaReset =
  | { resultado: 'ok'; faturas: number }
  | { resultado: 'aguarde'; segundos: number };
