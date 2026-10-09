import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleSlash, Clock, FlaskConical, RefreshCw, Search, Webhook, X } from 'lucide-react';
import { enviarWebhook, listarFaturas, modoDemo } from '@/lib/api';
import { formatBRL, formatData, formatDataHoraBRT } from '@/lib/format';
import type { Fatura, StatusFatura } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { AcoesFatura } from '@/components/AcoesFatura';
import { useToast } from '@/components/Toaster';

type Filtro = 'todas' | StatusFatura;

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'pendente', label: 'Pendentes' },
  { id: 'atrasado', label: 'Atrasadas' },
  { id: 'pago', label: 'Pagas' },
];

export default function App() {
  const toast = useToast();
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  const [processando, setProcessando] = useState<Set<string>>(new Set());
  const [recemPagas, setRecemPagas] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try {
      setErro(null);
      setFaturas(await listarFaturas());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar faturas');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const simular = async (f: Fatura, valor: number) => {
    setProcessando((s) => new Set(s).add(f.id));
    try {
      const r = await enviarWebhook(f.id, valor);

      switch (r.resultado) {
        case 'liquidada':
          // Feedback imediato: atualiza a linha antes do refetch.
          setFaturas((fs) => fs.map((x) => (x.id === f.id ? { ...x, status: 'pago', pago_em: r.pago_em! } : x)));
          setRecemPagas((s) => new Set(s).add(f.id));
          setTimeout(() => setRecemPagas((s) => { const n = new Set(s); n.delete(f.id); return n; }), 2000);
          toast({
            tipo: 'sucesso',
            titulo: `${f.codigo} paga`,
            descricao: `${formatBRL(f.valor)} recebido via Pix em ${formatDataHoraBRT(r.pago_em!)} (Brasília).`,
            tecnico: `Webhook PAYMENT_RECEIVED · HTTP ${r.httpStatus} · liquidada`,
          });
          carregar();
          break;
        case 'ja_processada':
          toast({
            tipo: 'info',
            titulo: `${f.codigo} já estava paga`,
            descricao: `Nenhuma alteração feita. Pago em ${formatDataHoraBRT(r.pago_em!)} (Brasília).`,
            tecnico: `Webhook reenviado · HTTP ${r.httpStatus} · idempotente`,
          });
          break;
        case 'valor_divergente':
          toast({
            tipo: 'erro',
            titulo: 'Pagamento recusado: valor diferente da fatura',
            descricao: `Recebido ${formatBRL(r.valor_recebido!)}, mas a ${f.codigo} é de ${formatBRL(r.valor_esperado!)}. A fatura continua em aberto.`,
            tecnico: `Webhook · HTTP ${r.httpStatus} · valor_divergente`,
          });
          break;
        default:
          toast({
            tipo: 'erro',
            titulo: 'Não foi possível registrar o pagamento',
            descricao: 'Tente novamente em instantes.',
            tecnico: `Webhook · HTTP ${r.httpStatus} · ${r.erro ?? r.resultado}`,
          });
      }
    } catch (e) {
      toast({
        tipo: 'erro',
        titulo: 'Sem conexão com o servidor',
        descricao: 'Verifique sua internet e tente novamente.',
        tecnico: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setProcessando((s) => { const n = new Set(s); n.delete(f.id); return n; });
    }
  };

  // Filtro por cliente: casa nome ou placa, sem diferenciar maiúsculas/acentos.
  // Os cards de resumo seguem esse filtro; o filtro de status afeta só a lista.
  const clientes = useMemo(() => [...new Set(faturas.map((f) => f.cliente))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [faturas]);
  const daBusca = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return faturas;
    return faturas.filter((f) => normalizar(f.cliente).includes(termo) || normalizar(f.veiculo).includes(termo));
  }, [faturas, busca]);

  const resumo = useMemo(() => {
    const soma = (st: StatusFatura) => daBusca.filter((f) => f.status === st);
    const total = (fs: Fatura[]) => fs.reduce((acc, f) => acc + f.valor, 0);
    return {
      pendente: { qtd: soma('pendente').length, valor: total(soma('pendente')) },
      atrasado: { qtd: soma('atrasado').length, valor: total(soma('atrasado')) },
      pago: { qtd: soma('pago').length, valor: total(soma('pago')) },
    };
  }, [daBusca]);

  const visiveis = filtro === 'todas' ? daBusca : daBusca.filter((f) => f.status === filtro);

  return (
    <div className="min-h-screen pb-16">
      {/* Header */}
      <header className="relative overflow-hidden bg-gradient-to-br from-azul via-azul-escuro to-azul-marinho pb-24 pt-8 text-white">
        <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-azul-claro/20 blur-3xl" />
        <div className="container relative">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* Selo branco: o "GO" do logo é azul-marinho e sumiria no fundo escuro. */}
              <div className="rounded-xl bg-white px-3 py-2 shadow-elegant">
                <img src="/logo-alugo.png" alt="Alu.GO Motos" className="h-8 w-auto md:h-9" />
              </div>
              <p className="hidden border-l border-white/20 pl-4 text-sm text-white/70 sm:block">Gestão de faturas semanais</p>
            </div>
            {modoDemo && (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm">
                <FlaskConical className="h-3.5 w-3.5 text-accent" />
                <span className="hidden sm:inline">Modo demonstração</span>
                <span className="sm:hidden">Demo</span>
              </span>
            )}
          </div>

          <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
                Faturas{' '}
                <span className="bg-gradient-to-r from-accent to-primary-glow bg-clip-text text-transparent">& Pagamentos</span>
              </h1>
              <p className="mt-2 max-w-xl text-sm text-white/75 md:text-base">
                Simule a notificação de Pix do gateway e acompanhe a baixa em tempo real.
              </p>
            </div>
            <button
              onClick={() => { setCarregando(true); carregar(); }}
              className="inline-flex items-center gap-2 rounded-full border-2 border-white/30 px-5 py-2.5 text-sm font-semibold backdrop-blur-sm transition-all hover:bg-white/10"
            >
              <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>
        </div>
      </header>

      <main className="container -mt-14 relative space-y-6">
        {/* Resumo */}
        <section className="grid gap-4 sm:grid-cols-3">
          <CardResumo Icon={Clock} titulo="A vencer" qtd={resumo.pendente.qtd} valor={resumo.pendente.valor} tom="primary" />
          <CardResumo Icon={AlertCircle} titulo="Em atraso" qtd={resumo.atrasado.qtd} valor={resumo.atrasado.valor} tom="destructive" />
          <CardResumo Icon={CheckCircle2} titulo="Recebido" qtd={resumo.pago.qtd} valor={resumo.pago.valor} tom="success" />
        </section>

        {/* Lista */}
        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-elegant">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-4 md:px-6">
            <div className="flex items-center gap-2">
              <Webhook className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Faturas</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{visiveis.length}</span>
            </div>
            <div className="relative w-full sm:w-64 md:order-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" aria-hidden />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                list="lista-clientes"
                placeholder="Buscar cliente ou placa"
                aria-label="Filtrar faturas por cliente ou placa"
                className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-9 text-sm outline-none transition-all placeholder:text-foreground/40 focus:border-primary focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
              />
              <datalist id="lista-clientes">
                {clientes.map((c) => <option key={c} value={c} />)}
              </datalist>
              {busca && (
                <button
                  onClick={() => setBusca('')}
                  aria-label="Limpar filtro de cliente"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-foreground/40 hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1">
              {FILTROS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFiltro(f.id)}
                  aria-pressed={filtro === f.id}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    filtro === f.id ? 'bg-card text-primary shadow-sm' : 'text-foreground/60 hover:text-primary'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {carregando && faturas.length === 0 ? (
            <div className="flex justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : erro ? (
            <div className="p-10 text-center">
              <p className="font-semibold text-destructive">Não foi possível carregar as faturas</p>
              <p className="mt-1 text-sm text-foreground/60">{erro}</p>
            </div>
          ) : visiveis.length === 0 ? (
            <div className="p-10 text-center text-sm text-foreground/60">
              <p>{busca ? `Nenhuma fatura encontrada para “${busca}”.` : 'Nenhuma fatura neste filtro.'}</p>
              {busca && (
                <button onClick={() => setBusca('')} className="mt-2 font-semibold text-primary hover:underline">
                  Limpar filtro de cliente
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop */}
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="bg-muted/40 text-left text-xs font-bold uppercase tracking-wider text-foreground/50">
                    <th className="px-6 py-3">Código</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Vencimento</th>
                    <th className="px-4 py-3 text-right">Valor</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-6 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {visiveis.map((f) => (
                    <tr key={f.id} className={`transition-colors hover:bg-muted/30 ${recemPagas.has(f.id) ? 'animate-flash-pago' : ''}`}>
                      <td className="px-6 py-4">
                        <p className="font-mono text-sm font-semibold">{f.codigo}</p>
                        <p className="text-xs text-foreground/50">Parcela {f.parcela}/{f.total_parcelas}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-semibold">{f.cliente}</p>
                        <p className="text-xs text-foreground/50">{f.veiculo}</p>
                      </td>
                      <td className="px-4 py-4 tabular-nums">{formatData(f.vencimento)}</td>
                      <td className="px-4 py-4 text-right font-semibold tabular-nums">{formatBRL(f.valor)}</td>
                      <td className="px-4 py-4">
                        <StatusBadge status={f.status} animar={recemPagas.has(f.id)} />
                        {f.pago_em && <p className="mt-1 text-xs text-foreground/50 tabular-nums">{formatDataHoraBRT(f.pago_em)}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end">
                          <AcoesFatura fatura={f} carregando={processando.has(f.id)} onSimular={simular} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile */}
              <ul className="divide-y divide-border/50 md:hidden">
                {visiveis.map((f) => (
                  <li key={f.id} className={`space-y-3 p-4 ${recemPagas.has(f.id) ? 'animate-flash-pago' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold">
                          {f.codigo} <span className="font-sans text-xs font-normal text-foreground/50">· {f.parcela}/{f.total_parcelas}</span>
                        </p>
                        <p className="truncate font-semibold">{f.cliente}</p>
                      </div>
                      <StatusBadge status={f.status} animar={recemPagas.has(f.id)} />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground/60">Vence {formatData(f.vencimento)}</span>
                      <span className="font-bold tabular-nums">{formatBRL(f.valor)}</span>
                    </div>
                    {f.pago_em && <p className="text-xs text-foreground/50">Pago em {formatDataHoraBRT(f.pago_em)} (Brasília)</p>}
                    <AcoesFatura fatura={f} carregando={processando.has(f.id)} onSimular={simular} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <p className="text-center text-xs text-foreground/50">
          Horários exibidos no fuso America/Sao_Paulo. O botão <CircleSlash className="inline h-3.5 w-3.5 -translate-y-px" /> simula um Pix com valor divergente.
        </p>
      </main>
    </div>
  );
}

const tons = {
  primary: { icone: 'bg-primary/10 text-primary', valor: 'text-foreground' },
  destructive: { icone: 'bg-destructive/10 text-destructive', valor: 'text-destructive' },
  success: { icone: 'bg-success/10 text-success', valor: 'text-success' },
};

function CardResumo({ Icon, titulo, qtd, valor, tom }: {
  Icon: typeof Clock; titulo: string; qtd: number; valor: number; tom: keyof typeof tons;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-elegant transition-all hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground/60">{titulo}</p>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tons[tom].icone}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className={`mt-3 text-2xl font-extrabold tabular-nums ${tons[tom].valor}`}>{formatBRL(valor)}</p>
      <p className="text-xs text-foreground/50">{qtd} {qtd === 1 ? 'fatura' : 'faturas'}</p>
    </div>
  );
}
