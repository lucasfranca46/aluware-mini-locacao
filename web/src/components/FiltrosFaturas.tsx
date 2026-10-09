import { Bike, Hash, User, X } from 'lucide-react';
import type { Fatura } from '@/lib/types';

export interface Filtros {
  cliente: string;
  placa: string;
  modelo: string; // '' = todos
}

export const FILTROS_VAZIOS: Filtros = { cliente: '', placa: '', modelo: '' };

// Sem acento, minúsculo e, para placa, só letras e números ("fab-1c23" casa "FAB1C23").
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const soAlfanumerico = (s: string) => normalizar(s).replace(/[^a-z0-9]/g, '');

export function aplicarFiltros(faturas: Fatura[], { cliente, placa, modelo }: Filtros) {
  const termoCliente = normalizar(cliente.trim());
  const termoPlaca = soAlfanumerico(placa);
  return faturas.filter(
    (f) =>
      (!termoCliente || normalizar(f.cliente).includes(termoCliente)) &&
      (!termoPlaca || soAlfanumerico(f.placa).includes(termoPlaca)) &&
      (!modelo || f.modelo === modelo),
  );
}

export const temFiltro = (f: Filtros) => Boolean(f.cliente.trim() || f.placa.trim() || f.modelo);

const unicos = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, 'pt-BR'));

interface Props {
  faturas: Fatura[];
  valor: Filtros;
  onChange: (f: Filtros) => void;
}

const campo =
  'w-full rounded-xl border border-border bg-card py-2 pl-9 pr-8 text-sm outline-none transition-all placeholder:text-foreground/40 focus:border-primary focus:ring-2 focus:ring-primary/20';

export function FiltrosFaturas({ faturas, valor, onChange }: Props) {
  const set = (k: keyof Filtros) => (v: string) => onChange({ ...valor, [k]: v });

  return (
    <div className="grid gap-3 border-b border-border/60 bg-muted/20 p-4 sm:grid-cols-3 md:px-6">
      <CampoTexto
        Icon={User}
        label="Cliente"
        placeholder="Nome do cliente"
        valor={valor.cliente}
        onChange={set('cliente')}
        sugestoes={unicos(faturas.map((f) => f.cliente))}
      />
      <CampoTexto
        Icon={Hash}
        label="Placa"
        placeholder="Ex.: FAB1C23"
        valor={valor.placa}
        onChange={(v) => set('placa')(v.toUpperCase())}
        sugestoes={unicos(faturas.map((f) => f.placa))}
        mono
      />
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-foreground/60">Veículo</span>
        <span className="relative block">
          <Bike className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" aria-hidden />
          <select value={valor.modelo} onChange={(e) => set('modelo')(e.target.value)} className={`${campo} appearance-none`}>
            <option value="">Todos os modelos</option>
            {unicos(faturas.map((f) => f.modelo)).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </span>
      </label>
    </div>
  );
}

function CampoTexto({ Icon, label, placeholder, valor, onChange, sugestoes, mono = false }: {
  Icon: typeof User;
  label: string;
  placeholder: string;
  valor: string;
  onChange: (v: string) => void;
  sugestoes: string[];
  mono?: boolean;
}) {
  const listId = `sugestoes-${label.toLowerCase()}`;
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-foreground/60">{label}</span>
      <span className="relative block">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" aria-hidden />
        <input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          list={listId}
          placeholder={placeholder}
          autoComplete="off"
          className={`${campo} ${mono ? 'font-mono uppercase placeholder:normal-case placeholder:font-sans' : ''}`}
        />
        <datalist id={listId}>
          {sugestoes.map((s) => <option key={s} value={s} />)}
        </datalist>
        {valor && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={`Limpar ${label.toLowerCase()}`}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-foreground/40 hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </span>
    </label>
  );
}
