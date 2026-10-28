import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Inbox, PlusCircle, Repeat } from 'lucide-react';
import { useTaxonomy } from '../app-context';
import { api, downloadFile, qs, type ApiError } from '../lib/api';
import type { ComplaintRow } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { Button, Card, Empty, ErrorBox, Spinner, cx } from '../components/ui';
import { FilterBar, useFilters } from '../components/Filters';
import { ComplaintTable } from '../components/ComplaintTable';
import { useDebounced } from '../lib/useDebounced';

interface ListResponse { total: number; page: number; pageSize: number; rows: ComplaintRow[] }

export function HistoryPage() {
  const taxonomy = useTaxonomy();
  const navigate = useNavigate();
  const { filters, update, clear, params, setParams } = useFilters();
  const page = Number(params.get('page') || 1);
  const query = useDebounced(qs({ ...filters, page }));
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<ListResponse>('/api/complaints' + query, { signal: ctrl.signal })
      .then(setData)
      .catch((e) => e.name !== 'AbortError' && setError(e))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [query, tick]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const goPage = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Histórico de reclamações"
        subtitle="Todos os registros, incluindo dúvidas e sugestões. Clique num registro para ver detalhes, editar ou validar."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} loading={exporting} onClick={async () => {
              setExporting(true);
              try { await downloadFile('/api/complaints/export' + qs(filters), `reclamacoes-${new Date().toISOString().slice(0, 10)}.csv`); } catch (e) { setError(e as ApiError); } finally { setExporting(false); }
            }}>Exportar CSV</Button>
            <Button icon={<PlusCircle className="size-4" />} onClick={() => navigate('/nova')}>Nova reclamação</Button>
          </>
        }
      />
      <div className="space-y-4">
        <FilterBar filters={filters} update={update} clear={clear} taxonomy={taxonomy} showKind showSearch defaultPeriod={false} />
        <div className="flex items-center gap-2">
          <button onClick={() => update({ recurrent: filters.recurrent ? '' : '1' })} className={cx('inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs border', filters.recurrent ? 'bg-[#ffe8f5] border-pink text-[#c4127c]' : 'bg-white border-linha text-slate-600')}>
            <Repeat className="size-3.5" /> Só clientes com mais de uma reclamação
          </button>
          {data && <span className="text-xs text-slate-500">{data.total} registro(s)</span>}
        </div>
        <ErrorBox error={error} onRetry={() => setTick((t) => t + 1)} />
        <Card padded>
          {loading && !data && <Spinner />}
          {data && data.rows.length === 0 && <Empty icon={<Inbox className="size-6" />} title="Nenhum registro encontrado">Ajuste os filtros ou a busca.</Empty>}
          {data && data.rows.length > 0 && (
            <div className={cx(loading && 'opacity-60')}>
              <ComplaintTable rows={data.rows} taxonomy={taxonomy} />
              <div className="flex items-center justify-between mt-4 text-sm">
                <span className="text-slate-500">Página {data.page} de {pages}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => goPage(page - 1)}>Anterior</Button>
                  <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => goPage(page + 1)}>Próxima</Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
