import { Loader2, RefreshCw, Zap, CircleSlash } from 'lucide-react';
import type { Fatura } from '@/lib/types';

interface Props {
  fatura: Fatura;
  carregando: boolean;
  onSimular: (f: Fatura, valor: number) => void;
}

export function AcoesFatura({ fatura, carregando, onSimular }: Props) {
  if (fatura.status === 'cancelado') return null;

  if (fatura.status === 'pago') {
    return (
      <button
        onClick={() => onSimular(fatura, fatura.valor)}
        disabled={carregando}
        title="Reenvia o mesmo webhook para demonstrar a idempotência"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground/70 transition-all hover:border-primary hover:text-primary disabled:opacity-50"
      >
        {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Reenviar webhook
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onSimular(fatura, fatura.valor)}
        disabled={carregando}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 hover:shadow-md disabled:opacity-60"
      >
        {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        Simular pagamento
      </button>
      <button
        // 90% do valor: sempre positivo e sempre diferente, qualquer que seja a fatura.
        onClick={() => onSimular(fatura, Math.round(fatura.valor * 90) / 100)}
        disabled={carregando}
        title="Simula um Pix com valor diferente da fatura (deve ser recusado)"
        aria-label="Simular pagamento com valor divergente"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/40 transition-all hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        <CircleSlash className="h-4 w-4" />
      </button>
    </div>
  );
}
