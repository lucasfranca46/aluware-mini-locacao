import { ShieldAlert } from 'lucide-react';
import type { Fatura } from '@/lib/types';
import { formatBRL } from '@/lib/format';

/** A partir de quantas parcelas atrasadas o cliente é tratado como inadimplente. */
export const PARCELAS_INADIMPLENCIA = 2;

/** Clientes com PARCELAS_INADIMPLENCIA ou mais faturas atrasadas (sobre todas as faturas, não só as filtradas). */
export function clientesInadimplentes(faturas: Fatura[]) {
  const atrasadas = new Map<string, number>();
  for (const f of faturas) if (f.status === 'atrasado') atrasadas.set(f.cliente, (atrasadas.get(f.cliente) ?? 0) + 1);
  return new Set([...atrasadas].filter(([, n]) => n >= PARCELAS_INADIMPLENCIA).map(([c]) => c));
}

export function SeloInadimplente() {
  return (
    <span
      title={`${PARCELAS_INADIMPLENCIA} ou mais parcelas em atraso. Avaliar bloqueio da moto pelo rastreador.`}
      className="inline-flex items-center gap-1 rounded-md bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive-foreground"
    >
      <ShieldAlert className="h-3 w-3" aria-hidden />
      Inadimplente
    </span>
  );
}

export const textoDiasAtraso = (dias: number) => (dias === 1 ? 'há 1 dia' : `há ${dias} dias`);

/** Valor original + linha com o valor atualizado (multa + juros), só para faturas atrasadas. */
export function ValorComEncargos({ fatura: f, alinhar = 'right' }: { fatura: Fatura; alinhar?: 'right' | 'left' }) {
  if (f.dias_atraso <= 0) return <>{formatBRL(f.valor)}</>;
  const detalhe = `Multa 2%: ${formatBRL(f.multa)} · Juros 1% a.m. (${f.dias_atraso} ${f.dias_atraso === 1 ? 'dia' : 'dias'}): ${formatBRL(f.juros)}`;
  return (
    <span className={`inline-flex flex-col ${alinhar === 'right' ? 'items-end' : 'items-start'}`}>
      <span>{formatBRL(f.valor)}</span>
      <span title={detalhe} className="cursor-help text-xs font-semibold text-destructive underline decoration-dotted underline-offset-2">
        {formatBRL(f.valor_atualizado)} c/ encargos
      </span>
    </span>
  );
}
