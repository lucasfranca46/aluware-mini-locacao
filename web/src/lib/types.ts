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
  valor_esperado?: number;
  valor_recebido?: number;
  erro?: string;
}
