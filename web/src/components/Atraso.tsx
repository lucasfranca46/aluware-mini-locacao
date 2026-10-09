import { ShieldAlert } from 'lucide-react';
import type { Fatura } from '@/lib/types';
import { dataBRT, formatBRL } from '@/lib/format';
import { diasEntre } from '@/lib/encargos';

/** A partir de quantas parcelas atrasadas o cliente é tratado como inadimplente. */
export const PARCELAS_INADIMPLENCIA = 1;

/** Clientes com PARCELAS_INADIMPLENCIA ou mais faturas atrasadas (sobre todas as faturas, não só as filtradas). */
export function clientesInadimplentes(faturas: Fatura[]) {
  const atrasadas = new Map<string, number>();
  for (const f of faturas) if (f.status === 'atrasado') atrasadas.set(f.cliente, (atrasadas.get(f.cliente) ?? 0) + 1);
  return new Set([...atrasadas].filter(([, n]) => n >= PARCELAS_INADIMPLENCIA).map(([c]) => c));
}

export function SeloInadimplente() {
  return (
    <span
      title="Cliente com parcela em atraso. Avaliar bloqueio da moto pelo rastreador."
      className="inline-flex items-center gap-1 rounded-md bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive-foreground"
    >
      <ShieldAlert className="h-3 w-3" aria-hidden />
      Inadimplente
    </span>
  );
}

export const textoDiasAtraso = (dias: number) => (dias === 1 ? 'há 1 dia' : `há ${dias} dias`);
const textoDias = (dias: number) => (dias === 1 ? '1 dia' : `${dias} dias`);

/** Dias entre o vencimento e a data (em Brasília) em que a fatura foi paga; 0 se paga em dia. */
export const diasAtrasoNoPagamento = (f: Fatura) =>
  f.status === 'pago' && f.pago_em ? Math.max(0, diasEntre(f.vencimento, dataBRT(f.pago_em))) : 0;

/** Fatura paga: o selo "Inadimplente" some, mas fica registrado que o pagamento atrasou. */
export function ObsPagoComAtraso({ fatura }: { fatura: Fatura }) {
  const dias = diasAtrasoNoPagamento(fatura);
  if (dias <= 0) return null;
  return (
    <p className="mt-1 text-xs font-semibold text-warning-foreground/80">
      <span className="rounded bg-warning/20 px-1.5 py-0.5">Pago com {textoDias(dias)} de atraso</span>
    </p>
  );
}

/** Divisão dos encargos por escrito (no celular não há "passar o mouse"). */
export function DetalheEncargos({ fatura: f }: { fatura: Fatura }) {
  if (f.dias_atraso <= 0) return null;
  return (
    <p className="text-xs text-foreground/60">
      Multa 2%: {formatBRL(f.multa)} · Juros 1% a.m. ({textoDias(f.dias_atraso)}): {formatBRL(f.juros)}
    </p>
  );
}

/** Valor original + linha com o valor atualizado (multa + juros), só para faturas atrasadas. */
export function ValorComEncargos({ fatura: f, alinhar = 'right' }: { fatura: Fatura; alinhar?: 'right' | 'left' }) {
  const lado = alinhar === 'right' ? 'items-end' : 'items-start';
  // Paga com atraso: mostra o total recebido e quanto foi de encargos.
  if (f.status === 'pago' && f.encargos_pagos > 0 && f.valor_pago != null) {
    return (
      <span className={`inline-flex flex-col ${lado}`}>
        <span>{formatBRL(f.valor_pago)}</span>
        <span className="text-xs font-normal text-foreground/50">
          {formatBRL(f.valor)} + {formatBRL(f.encargos_pagos)} de encargos
        </span>
      </span>
    );
  }
  if (f.dias_atraso <= 0) return <>{formatBRL(f.valor)}</>;
  const detalhe = `Multa 2%: ${formatBRL(f.multa)} · Juros 1% a.m. (${textoDias(f.dias_atraso)}): ${formatBRL(f.juros)}`;
  return (
    <span className={`inline-flex flex-col ${lado}`}>
      <span>{formatBRL(f.valor)}</span>
      <span title={detalhe} className="cursor-help text-xs font-semibold text-destructive underline decoration-dotted underline-offset-2">
        {formatBRL(f.valor_atualizado)} c/ encargos
      </span>
    </span>
  );
}
