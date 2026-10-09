import type { Fatura } from '@/lib/types';
import { formatData, formatDataHoraBRT } from '@/lib/format';
import { StatusBadge } from '@/components/StatusBadge';
import { AcoesFatura } from '@/components/AcoesFatura';
import { DetalheEncargos, ObsPagoComAtraso, SeloInadimplente, textoDiasAtraso, ValorComEncargos } from '@/components/Atraso';

// Uma fatura em dois formatos: linha de tabela (desktop) e card (celular).
// As regras de exibição (selo, dias em atraso, encargos, obs. de pagamento
// atrasado) ficam aqui, num lugar só.

export interface PropsFatura {
  fatura: Fatura;
  inadimplente: boolean;
  recemPaga: boolean;
  processando: boolean;
  onSimular: (f: Fatura, valor: number) => void;
}

const mostrarSelo = (f: Fatura, inadimplente: boolean) => f.status === 'atrasado' && inadimplente;

export function LinhaFatura({ fatura: f, inadimplente, recemPaga, processando, onSimular }: PropsFatura) {
  return (
    <tr className={`transition-colors hover:bg-muted/30 ${recemPaga ? 'animate-flash-pago' : ''}`}>
      <td className="px-6 py-4">
        <p className="font-mono text-sm font-semibold">{f.codigo}</p>
        <p className="text-xs text-foreground/50">Parcela {f.parcela}/{f.total_parcelas}</p>
      </td>
      <td className="px-4 py-4">
        <p className="flex flex-wrap items-center gap-1.5 font-semibold">
          {f.cliente}
          {mostrarSelo(f, inadimplente) && <SeloInadimplente />}
        </p>
        <p className="text-xs text-foreground/50">{f.veiculo}</p>
      </td>
      <td className="px-4 py-4 tabular-nums">{formatData(f.vencimento)}</td>
      <td className="px-4 py-4 text-right font-semibold tabular-nums"><ValorComEncargos fatura={f} /></td>
      <td className="px-4 py-4">
        <StatusBadge status={f.status} animar={recemPaga} />
        {f.pago_em && <p className="mt-1 text-xs text-foreground/50 tabular-nums">{formatDataHoraBRT(f.pago_em)}</p>}
        {f.dias_atraso > 0 && <p className="mt-1 text-xs font-semibold text-destructive">{textoDiasAtraso(f.dias_atraso)}</p>}
        <ObsPagoComAtraso fatura={f} />
      </td>
      <td className="px-6 py-4">
        <div className="flex justify-end">
          <AcoesFatura fatura={f} carregando={processando} onSimular={onSimular} />
        </div>
      </td>
    </tr>
  );
}

export function CartaoFatura({ fatura: f, inadimplente, recemPaga, processando, onSimular }: PropsFatura) {
  return (
    <li className={`space-y-3 p-4 ${recemPaga ? 'animate-flash-pago' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold">
            {f.codigo} <span className="font-sans text-xs font-normal text-foreground/50">· {f.parcela}/{f.total_parcelas}</span>
          </p>
          <p className="flex flex-wrap items-center gap-1.5 font-semibold">
            <span className="truncate">{f.cliente}</span>
            {mostrarSelo(f, inadimplente) && <SeloInadimplente />}
          </p>
        </div>
        <StatusBadge status={f.status} animar={recemPaga} />
      </div>
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="text-foreground/60">
          Vence {formatData(f.vencimento)}
          {f.dias_atraso > 0 && <span className="font-semibold text-destructive"> · {textoDiasAtraso(f.dias_atraso)}</span>}
        </span>
        <span className="text-right font-bold tabular-nums"><ValorComEncargos fatura={f} /></span>
      </div>
      <DetalheEncargos fatura={f} />
      {f.pago_em && <p className="text-xs text-foreground/50">Pago em {formatDataHoraBRT(f.pago_em)} (Brasília)</p>}
      <ObsPagoComAtraso fatura={f} />
      <AcoesFatura fatura={f} carregando={processando} onSimular={onSimular} />
    </li>
  );
}
