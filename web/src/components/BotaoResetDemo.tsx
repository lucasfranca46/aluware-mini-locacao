import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { resetarDemo } from '@/lib/api';
import { useToast } from '@/components/Toaster';

// Recria os dados de demonstração. Confirmação em dois cliques (sem diálogo do
// navegador): o primeiro arma o botão por alguns segundos, o segundo executa.
export function BotaoResetDemo({ onResetado }: { onResetado: () => void }) {
  const toast = useToast();
  const [armado, setArmado] = useState(false);
  const [executando, setExecutando] = useState(false);
  // Segundos até o banco liberar outro reset (limite de 1 a cada 30 s).
  const [espera, setEspera] = useState(0);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  useEffect(() => {
    if (!armado) return;
    const t = setTimeout(() => setArmado(false), 4000);
    return () => clearTimeout(t);
  }, [armado]);

  const clicar = async () => {
    if (espera > 0) return;
    if (!armado) return setArmado(true);
    setArmado(false);
    setExecutando(true);
    try {
      const r = await resetarDemo();
      if (r.resultado === 'aguarde') {
        setEspera(r.segundos);
        toast({
          tipo: 'info',
          titulo: 'Os dados acabaram de ser recriados',
          descricao: `Aguarde ${r.segundos} s para resetar de novo.`,
          tecnico: 'resetar_demo · limite de 1 reset a cada 30 s',
        });
      } else {
        toast({
          tipo: 'sucesso',
          titulo: 'Dados de teste recriados',
          descricao: `${r.faturas} faturas: atrasadas, inadimplentes, a vencer e pagas. Pode testar de novo.`,
        });
        setEspera(30);
        onResetado();
      }
    } catch (e) {
      toast({
        tipo: 'erro',
        titulo: 'Não foi possível resetar os dados',
        descricao: 'Tente novamente em instantes.',
        tecnico: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setExecutando(false);
    }
  };

  return (
    <button
      onClick={clicar}
      disabled={executando || espera > 0}
      title={espera > 0 ? 'O banco libera um novo reset a cada 30 segundos' : 'Apaga os pagamentos de teste e recria o cenário inicial'}
      className={`inline-flex items-center gap-2 rounded-full border-2 px-5 py-2.5 text-sm font-semibold backdrop-blur-sm transition-all disabled:opacity-60 ${
        armado ? 'border-warning bg-warning text-warning-foreground' : 'border-white/30 hover:bg-white/10'
      }`}
    >
      {executando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
      {espera > 0 ? `Resetar de novo em ${espera} s` : armado ? 'Clique de novo para confirmar' : 'Resetar dados de teste'}
    </button>
  );
}
