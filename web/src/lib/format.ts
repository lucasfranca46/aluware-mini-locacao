const TZ = 'America/Sao_Paulo';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatBRL = (v: number) => brl.format(v);

// 'YYYY-MM-DD' é data de calendário: formatar sem passar por Date evita
// o clássico "dia anterior" causado pela conversão UTC -> local.
export const formatData = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const dataHoraBRT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
export const formatDataHoraBRT = (iso: string) => dataHoraBRT.format(new Date(iso));

export const hojeBRT = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
