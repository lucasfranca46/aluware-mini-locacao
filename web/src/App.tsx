import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleSlash, Clock, FlaskConical, RefreshCw, Webhook } from 'lucide-react';
import { enviarWebhook, listarFaturas, modoDemo } from '@/lib/api';
import { formatBRL, formatData, formatDataHoraBRT } from '@/lib/format';
import type { Fatura, StatusFatura } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { AcoesFatura } from '@/components/AcoesFatura';
import { useToast } from '@/components/Toaster';
import { BotaoResetDemo } from '@/components/BotaoResetDemo';
import { clientesInadimplentes, SeloInadimplente, textoDiasAtraso, ValorComEncargos } from '@/components/Atraso';
import { aplicarFiltros, FILTROS_VAZIOS, FiltrosFaturas, temFiltro, type Filtros } from '@/components/FiltrosFaturas';

type Filtro = 'todas' | StatusFatura;
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
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
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

  // Filtros de cliente/placa/veículo valem para a lista e para os cards de resumo;
  // o filtro de status (abas) afeta só a lista.
  const filtradas = useMemo(() => aplicarFiltros(faturas, filtros), [faturas, filtros]);

  const inadimplentes = useMemo(() => clientesInadimplentes(faturas), [faturas]);

  const resumo = useMemo(() => {
    const soma = (st: StatusFatura) => filtradas.filter((f) => f.status === st);
    const total = (fs: Fatura[], campo: 'valor' | 'valor_atualizado' = 'valor') => fs.reduce((acc, f) => acc + f[campo], 0);
    return {
      pendente: { qtd: soma('pendente').length, valor: total(soma('pendente')) },
      atrasado: { qtd: soma('atrasado').length, valor: total(soma('atrasado')), atualizado: total(soma('atrasado'), 'valor_atualizado') },
      pago: { qtd: soma('pago').length, valor: total(soma('pago')) },
    };
  }, [filtradas]);

  const visiveis = filtro === 'todas' ? filtradas : filtradas.filter((f) => f.status === filtro);

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
            <div className="flex flex-wrap gap-2">
            <BotaoResetDemo onResetado={() => { setFiltros(FILTROS_VAZIOS); setFiltro('todas'); setCarregando(true); carregar(); }} />
            <button
              onClick={() => { setCarregando(true); carregar(); }}
              className="inline-flex items-center gap-2 rounded-full border-2 border-white/30 px-5 py-2.5 text-sm font-semibold backdrop-blur-sm transition-all hover:bg-white/10"
            >
              <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container -mt-14 relative space-y-6">
        {/* Resumo */}
        <section className="grid gap-4 sm:grid-cols-3">
          <CardResumo Icon={Clock} titulo="A vencer" qtd={resumo.pendente.qtd} valor={resumo.pendente.valor} tom="primary" />
          <CardResumo
            Icon={AlertCircle}
            titulo="Em atraso"
            qtd={resumo.atrasado.qtd}
            valor={resumo.atrasado.valor}
            tom="destructive"
            extra={resumo.atrasado.qtd > 0 ? `${formatBRL(resumo.atrasado.atualizado)} com multa e juros` : undefined}
          />
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

          <FiltrosFaturas faturas={faturas} valor={filtros} onChange={setFiltros} />

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
              <p>Nenhuma fatura encontrada com esses filtros.</p>
              {temFiltro(filtros) && (
                <button onClick={() => setFiltros(FILTROS_VAZIOS)} className="mt-2 font-semibold text-primary hover:underline">
                  Limpar filtros
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
                        <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                          {f.cliente}
                          {inadimplentes.has(f.cliente) && <SeloInadimplente />}
                        </p>
                        <p className="text-xs text-foreground/50">{f.veiculo}</p>
                      </td>
                      <td className="px-4 py-4 tabular-nums">{formatData(f.vencimento)}</td>
                      <td className="px-4 py-4 text-right font-semibold tabular-nums"><ValorComEncargos fatura={f} /></td>
                      <td className="px-4 py-4">
                        <StatusBadge status={f.status} animar={recemPagas.has(f.id)} />
                        {f.pago_em && <p className="mt-1 text-xs text-foreground/50 tabular-nums">{formatDataHoraBRT(f.pago_em)}</p>}
                        {f.dias_atraso > 0 && <p className="mt-1 text-xs font-semibold text-destructive">{textoDiasAtraso(f.dias_atraso)}</p>}
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
                        <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                          <span className="truncate">{f.cliente}</span>
                          {inadimplentes.has(f.cliente) && <SeloInadimplente />}
                        </p>
                      </div>
                      <StatusBadge status={f.status} animar={recemPagas.has(f.id)} />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground/60">
                        Vence {formatData(f.vencimento)}
                        {f.dias_atraso > 0 && <span className="font-semibold text-destructive"> · {textoDiasAtraso(f.dias_atraso)}</span>}
                      </span>
                      <span className="font-bold tabular-nums"><ValorComEncargos fatura={f} /></span>
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
          Encargos de atraso (multa 2% + juros 1% a.m.) são informativos: a baixa exige o valor original da fatura.
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

function CardResumo({ Icon, titulo, qtd, valor, tom, extra }: {
  Icon: typeof Clock; titulo: string; qtd: number; valor: number; tom: keyof typeof tons; extra?: string;
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
      <p className="text-xs text-foreground/50">
        {qtd} {qtd === 1 ? 'fatura' : 'faturas'}
        {extra && <span className="font-semibold text-destructive"> · {extra}</span>}
      </p>
    </div>
  );
}
