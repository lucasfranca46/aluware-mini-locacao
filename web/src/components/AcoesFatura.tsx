import { Loader2, MessageCircle, RefreshCw, Zap, CircleSlash } from 'lucide-react';
import type { Fatura } from '@/lib/types';
import { formatBRL, formatData } from '@/lib/format';

// Mensagem de cobrança pronta. O link wa.me sem número abre o WhatsApp para a
// pessoa escolher o contato: o telefone do cliente não sai do banco (ele não é
// público, ver migration 20261009000100).
export function linkCobrancaWhatsApp(f: Fatura) {
  const primeiroNome = f.cliente.split(' ')[0];
  const texto =
    `Olá, ${primeiroNome}! Tudo bem? Aqui é da Alu.GO Motos.\n\n` +
    `Consta em aberto a parcela ${f.parcela}/${f.total_parcelas} da locação da ${f.modelo} (placa ${f.placa}), ` +
    `no valor de ${formatBRL(f.valor)}, com vencimento em ${formatData(f.vencimento)} ` +
    `(${f.dias_atraso} ${f.dias_atraso === 1 ? 'dia' : 'dias'} em atraso).\n\n` +
    `Com multa e juros, o valor atualizado é ${formatBRL(f.valor_atualizado)}. ` +
    `Podemos te ajudar a regularizar hoje?`;
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

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
        onClick={() => onSimular(fatura, fatura.valor_pago ?? fatura.valor)}
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
      {fatura.status === 'atrasado' && (
        <a
          href={linkCobrancaWhatsApp(fatura)}
          target="_blank"
          rel="noopener noreferrer"
          title="Cobrar no WhatsApp (mensagem pronta)"
          aria-label={`Cobrar ${fatura.codigo} no WhatsApp`}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#25D366]/10 text-[#128C7E] transition-all hover:bg-[#25D366]/20"
        >
          <MessageCircle className="h-4 w-4" />
        </a>
      )}
      <button
        // Valor devido hoje: com multa e juros se a fatura estiver atrasada.
        onClick={() => onSimular(fatura, fatura.valor_atualizado)}
        disabled={carregando}
        title={fatura.dias_atraso > 0 ? `Paga ${formatBRL(fatura.valor_atualizado)} (com multa e juros)` : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 hover:shadow-md disabled:opacity-60"
      >
        {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        Simular pagamento
      </button>
      <button
        // 90% do valor: sempre positivo e sempre diferente, qualquer que seja a fatura.
        onClick={() => onSimular(fatura, Math.round(fatura.valor_atualizado * 90) / 100)}
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
