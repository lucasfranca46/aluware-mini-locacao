import { AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { StatusFatura } from '@/lib/types';

const config: Record<StatusFatura, { label: string; className: string; Icon: typeof Clock }> = {
  pendente: { label: 'Pendente', className: 'bg-primary/10 text-muted-foreground border-primary/20', Icon: Clock },
  atrasado: { label: 'Atrasado', className: 'bg-destructive/10 text-destructive border-destructive/20', Icon: AlertCircle },
  pago: { label: 'Pago', className: 'bg-success/10 text-success border-success/25', Icon: CheckCircle2 },
  cancelado: { label: 'Cancelado', className: 'bg-foreground/5 text-foreground/50 border-foreground/10', Icon: XCircle },
};

export function StatusBadge({ status, animar = false }: { status: StatusFatura; animar?: boolean }) {
  const { label, className, Icon } = config[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${className} ${animar ? 'animate-pop' : ''}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}
