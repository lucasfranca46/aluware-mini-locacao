// Modo demonstração: espelha em memória as regras do banco (liquidar_fatura)
// para a tela funcionar sem um projeto Supabase configurado.
import type { Fatura, RespostaWebhook } from './types';
import { hojeBRT } from './format';
import { calcularEncargos, diasEntre } from './encargos';

interface FaturaDemo extends Omit<Fatura, 'status' | 'dias_atraso' | 'multa' | 'juros' | 'valor_atualizado'> {
  status: 'pendente' | 'pago';
}

const addDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

let seq = 0;
function gerarFaturas(cliente: string, modelo: string, placa: string, valor: number, semanas: number, offsetInicio: number): FaturaDemo[] {
  const inicio = addDias(hojeBRT(), offsetInicio);
  return Array.from({ length: semanas }, (_, i) => {
    seq += 1;
    return {
      id: crypto.randomUUID(),
      codigo: `FAT-${String(seq).padStart(6, '0')}`,
      parcela: i + 1,
      total_parcelas: semanas,
      cliente,
      veiculo: `${modelo} · ${placa}`,
      modelo,
      placa,
      vencimento: addDias(inicio, 7 * (i + 1)),
      valor,
      status: 'pendente',
      pago_em: null,
    };
  });
}

const faturas: FaturaDemo[] = [
  ...gerarFaturas('Carlos Henrique Souza', 'Dafra DK 160', 'FAB1C23', 400, 4, -21),
  ...gerarFaturas('Juliana Ferreira', 'Dafra DK 160', 'GHI4J56', 389.9, 4, -3),
  ...gerarFaturas('Rafael Lima', 'Dafra DK 160', 'KLM7N89', 429.9, 2, 0),
];

const latencia = () => new Promise((r) => setTimeout(r, 350 + Math.random() * 300));

export async function listarFaturas(): Promise<Fatura[]> {
  await latencia();
  const hoje = hojeBRT();
  return faturas
    .map((f): Fatura => {
      const dias = f.status === 'pendente' ? Math.max(0, diasEntre(f.vencimento, hoje)) : 0;
      return { ...f, status: dias > 0 ? 'atrasado' : f.status, dias_atraso: dias, ...calcularEncargos(f.valor, dias) };
    })
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.codigo.localeCompare(b.codigo));
}

export async function webhook(p: { fatura_id: string; valor_pago: number }): Promise<RespostaWebhook> {
  await latencia();
  const f = faturas.find((x) => x.id === p.fatura_id);
  if (!f) return { httpStatus: 404, resultado: 'nao_encontrada' };
  if (f.status === 'pago') return { httpStatus: 200, resultado: 'ja_processada', codigo: f.codigo, pago_em: f.pago_em! };
  if (Math.round(p.valor_pago * 100) !== Math.round(f.valor * 100)) {
    return { httpStatus: 422, resultado: 'valor_divergente', codigo: f.codigo, valor_esperado: f.valor, valor_recebido: p.valor_pago };
  }
  f.status = 'pago';
  f.pago_em = new Date().toISOString();
  return { httpStatus: 200, resultado: 'liquidada', codigo: f.codigo, pago_em: f.pago_em };
}
