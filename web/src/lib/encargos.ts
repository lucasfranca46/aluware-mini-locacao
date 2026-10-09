// Mesma regra da vw_faturas (migration 20261009000300_encargos_atraso.sql),
// usada só no modo demonstração. Com Supabase, os valores vêm do banco.
export const MULTA = 0.02; // 2% sobre a parcela
export const JUROS_MES = 0.01; // 1% ao mês, pro rata die (mês de 30 dias)

const centavos = (v: number) => Math.round(v * 100) / 100;

export function calcularEncargos(valor: number, diasAtraso: number) {
  if (diasAtraso <= 0) return { multa: 0, juros: 0, valor_atualizado: valor };
  const multa = centavos(valor * MULTA);
  const juros = centavos((valor * JUROS_MES * diasAtraso) / 30);
  return { multa, juros, valor_atualizado: centavos(valor + multa + juros) };
}

export const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
