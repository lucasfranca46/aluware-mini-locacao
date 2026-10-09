// Modo demonstração: espelha em memória as regras do banco (liquidar_fatura)
// para a tela funcionar sem um projeto Supabase configurado.
import type { Fatura, RespostaReset, RespostaWebhook } from './types';
import { hojeBRT } from './format';
import { calcularEncargos, diasEntre } from './encargos';

interface FaturaDemo extends Omit<Fatura, 'status' | 'dias_atraso' | 'multa' | 'juros' | 'valor_atualizado' | 'encargos_pagos'> {
  encargos_pagos: number;
  status: 'pendente' | 'pago';
}

const addDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

let seq = 0;
function gerarFaturas(cliente: string, modelo: string, placa: string, valor: number, semanas: number, offsetInicio: number, pagas = 0): FaturaDemo[] {
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
      status: i < pagas ? 'pago' : 'pendente',
      pago_em: i < pagas ? new Date().toISOString() : null,
      valor_pago: i < pagas ? valor : null,
      encargos_pagos: 0,
    };
  });
}

// Mesmo cenário de public.resetar_demo() (migration 20261009000400_resetar_demo.sql).
function cenario(): FaturaDemo[] {
  seq = 0;
  return [
    ...gerarFaturas('Carlos Henrique Souza', 'Dafra DK 160', 'FAB1C23', 400, 4, -21),
    ...gerarFaturas('Juliana Ferreira', 'Dafra DK 160', 'GHI4J56', 389.9, 4, -3),
    ...gerarFaturas('Rafael Lima', 'Dafra DK 160', 'KLM7N89', 429.9, 2, 0),
    ...gerarFaturas('Mariana Costa', 'Honda CG 160 Start', 'QRS2T34', 450, 6, -30),
    ...gerarFaturas('Pedro Almeida', 'Yamaha Factor 150', 'UVW5X67', 420, 4, -10),
    ...gerarFaturas('Ana Beatriz Rocha', 'Honda Biz 125', 'BCD8E90', 350, 4, -5),
    ...gerarFaturas('Lucas Martins', 'Dafra DK 160', 'HJK3L45', 400, 8, -45, 3),
  ];
}

let faturas = cenario();

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
  if (f.status === 'pago') return { httpStatus: 200, resultado: 'ja_processada', codigo: f.codigo, pago_em: f.pago_em!, valor_pago: f.valor_pago! };
  // Mesma regra de liquidar_fatura: atrasada exige valor + multa + juros.
  const dias = Math.max(0, diasEntre(f.vencimento, hojeBRT()));
  const enc = calcularEncargos(f.valor, dias);
  if (Math.round(p.valor_pago * 100) !== Math.round(enc.valor_atualizado * 100)) {
    return { httpStatus: 422, resultado: 'valor_divergente', codigo: f.codigo, valor_esperado: enc.valor_atualizado, valor_recebido: p.valor_pago };
  }
  f.status = 'pago';
  f.pago_em = new Date().toISOString();
  f.valor_pago = enc.valor_atualizado;
  f.encargos_pagos = Math.round((enc.multa + enc.juros) * 100) / 100;
  return {
    httpStatus: 200, resultado: 'liquidada', codigo: f.codigo, pago_em: f.pago_em,
    valor_pago: f.valor_pago, valor_original: f.valor, multa: enc.multa, juros: enc.juros, dias_atraso: dias,
  };
}

export async function resetar(): Promise<RespostaReset> {
  await latencia();
  faturas = cenario();
  return { resultado: 'ok', faturas: faturas.length };
}
