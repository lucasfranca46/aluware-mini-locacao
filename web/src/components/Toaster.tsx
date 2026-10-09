import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type Tipo = 'sucesso' | 'info' | 'erro';
// `tecnico`: detalhe para o avaliador do teste (ex.: código HTTP). Ver README, "Mensagens técnicas na tela".
interface Toast { id: number; tipo: Tipo; titulo: string; descricao?: string; tecnico?: string }

const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

const estilos: Record<Tipo, { Icon: typeof Info; barra: string; icone: string }> = {
  sucesso: { Icon: CheckCircle2, barra: 'bg-success', icone: 'text-success' },
  info: { Icon: Info, barra: 'bg-primary', icone: 'text-primary' },
  erro: { Icon: AlertTriangle, barra: 'bg-destructive', icone: 'text-destructive' },
};

let nextId = 1;

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const fechar = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const mostrar = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId++;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      setTimeout(() => fechar(id), 5000);
    },
    [fechar],
  );

  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-96"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const { Icon, barra, icone } = estilos[t.tipo];
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto relative flex w-full overflow-hidden rounded-xl border border-border/60 bg-card shadow-elegant animate-in slide-in-from-bottom-4 fade-in duration-300"
            >
              <span className={`w-1.5 shrink-0 ${barra}`} />
              <div className="flex flex-1 gap-3 p-4">
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${icone}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{t.titulo}</p>
                  {t.descricao && <p className="mt-0.5 text-sm text-foreground/70">{t.descricao}</p>}
                  {t.tecnico && <p className="mt-1.5 font-mono text-[11px] text-foreground/45">{t.tecnico}</p>}
                </div>
                <button
                  onClick={() => fechar(t.id)}
                  className="h-6 w-6 shrink-0 rounded-md text-foreground/40 hover:bg-muted hover:text-foreground"
                  aria-label="Fechar"
                >
                  <X className="mx-auto h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
