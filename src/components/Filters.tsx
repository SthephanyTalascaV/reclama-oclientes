import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import type { Taxonomy } from '../lib/types';
import { Button, Input, Select, cx } from './ui';
import { addDays, monthEnd, monthStart, today, STATUS_LABELS } from '../lib/format';

export type Filters = Record<string, string>;

export const FILTER_KEYS = ['from', 'to', 'product', 'category', 'subcategory', 'company', 'customer', 'severity', 'sentiment', 'validationStatus', 'hubspotStatus', 'kind', 'q', 'recurrent'];

export function useFilters(defaults: Filters = {}) {
  const [params, setParams] = useSearchParams();
  const filters: Filters = { ...defaults };
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) filters[k] = v;
  }
  const update = (patch: Filters) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    setParams(next, { replace: true });
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  return { filters, update, clear, params, setParams };
}

export function periodPresets() {
  const t = today();
  return [
    { label: 'Este mês', from: monthStart(t), to: t },
    { label: 'Mês passado', from: monthStart(t, -1), to: monthEnd(monthStart(t, -1)) },
    { label: '90 dias', from: addDays(t, -89), to: t },
    { label: '12 meses', from: monthStart(t, -11), to: t },
  ];
}

export function FilterBar({ filters, update, clear, taxonomy, showKind, showSearch, defaultPeriod = true }: {
  filters: Filters;
  update: (p: Filters) => void;
  clear: () => void;
  taxonomy: Taxonomy;
  showKind?: boolean;
  showSearch?: boolean;
  defaultPeriod?: boolean;
}) {
  const presets = periodPresets();
  const activePreset = presets.find((p) => p.from === filters.from && p.to === filters.to) || (defaultPeriod && !filters.from && !filters.to ? presets[0] : null);
  const cat = taxonomy.categories.find((c) => c.name === filters.category);
  const L = taxonomy.enums.labels;
  const extra = FILTER_KEYS.filter((k) => !['from', 'to', 'q'].includes(k) && filters[k]).length;

  return (
    <div className="bg-white rounded-2xl border border-linha p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-[#eef3fa] p-1">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => update({ from: p.from, to: p.to })}
              className={cx('px-3 h-8 rounded-lg text-xs font-medium transition-colors', activePreset?.label === p.label ? 'bg-white text-petroleo shadow-sm' : 'text-slate-600 hover:text-petroleo')}
            >
              {p.label}
            </button>
          ))}
          {!defaultPeriod && (
            <button onClick={() => update({ from: '', to: '' })} className={cx('px-3 h-8 rounded-lg text-xs font-medium', !filters.from && !filters.to ? 'bg-white text-petroleo shadow-sm' : 'text-slate-600')}>Tudo</button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Input type="date" aria-label="De" className="h-8 w-[150px] text-xs" value={filters.from || (defaultPeriod ? presets[0].from : '')} onChange={(e) => update({ from: e.target.value })} />
          até
          <Input type="date" aria-label="Até" className="h-8 w-[150px] text-xs" value={filters.to || (defaultPeriod ? presets[0].to : '')} onChange={(e) => update({ to: e.target.value })} />
        </div>
        {showSearch && (
          <Input className="h-8 text-xs flex-1 min-w-[220px]" placeholder="Buscar por nome, telefone, empresa, ID do HubSpot ou palavras do resumo" value={filters.q || ''} onChange={(e) => update({ q: e.target.value })} />
        )}
        {(extra > 0 || filters.q || (!defaultPeriod && (filters.from || filters.to))) && (
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={clear}>Limpar filtros</Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
        {showKind && (
          <Select className="h-9 text-xs" value={filters.kind || ''} onChange={(e) => update({ kind: e.target.value })} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {taxonomy.enums.kinds.map((k) => <option key={k} value={k}>{L.kind[k]}</option>)}
          </Select>
        )}
        <Select className="h-9 text-xs" value={filters.product || ''} onChange={(e) => update({ product: e.target.value })} aria-label="Produto">
          <option value="">Todos os produtos</option>
          {[...taxonomy.products, taxonomy.enums.unidentified].map((p) => <option key={p}>{p}</option>)}
        </Select>
        <Select className="h-9 text-xs" value={filters.category || ''} onChange={(e) => update({ category: e.target.value, subcategory: '' })} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {[...taxonomy.categories.map((c) => c.name), taxonomy.enums.needsReview].map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Select className="h-9 text-xs" value={filters.subcategory || ''} onChange={(e) => update({ subcategory: e.target.value })} disabled={!cat} aria-label="Subcategoria">
          <option value="">{cat ? 'Todas as subcategorias' : 'Subcategoria (escolha a categoria)'}</option>
          {(cat?.subcategories || []).map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select className="h-9 text-xs" value={filters.severity || ''} onChange={(e) => update({ severity: e.target.value })} aria-label="Gravidade">
          <option value="">Todas as gravidades</option>
          {taxonomy.enums.severities.map((s) => <option key={s} value={s}>{L.severity[s]}</option>)}
        </Select>
        <Select className="h-9 text-xs" value={filters.validationStatus || ''} onChange={(e) => update({ validationStatus: e.target.value })} aria-label="Status de validação">
          <option value="">Qualquer status</option>
          {taxonomy.enums.validationStatuses.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>
        <Select className="h-9 text-xs" value={filters.hubspotStatus || ''} onChange={(e) => update({ hubspotStatus: e.target.value })} aria-label="Vínculo HubSpot">
          <option value="">Com e sem vínculo</option>
          <option value="vinculado">Vinculadas ao HubSpot</option>
          <option value="sem_vinculo">Sem vínculo</option>
        </Select>
        <Input className="h-9 text-xs" placeholder="Empresa" value={filters.company || ''} onChange={(e) => update({ company: e.target.value })} aria-label="Empresa" />
        <Input className="h-9 text-xs" placeholder="Cliente, telefone ou ID" value={filters.customer || ''} onChange={(e) => update({ customer: e.target.value })} aria-label="Cliente" />
      </div>
    </div>
  );
}
