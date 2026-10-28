import { Link } from 'react-router-dom';
import { Repeat, UserX } from 'lucide-react';
import type { ComplaintRow, Taxonomy } from '../lib/types';
import { Badge, severityTone, statusTone } from './ui';
import { fmtDate, STATUS_LABELS } from '../lib/format';

export function ComplaintTable({ rows, taxonomy, compact }: { rows: ComplaintRow[]; taxonomy: Taxonomy; compact?: boolean }) {
  const L = taxonomy.enums.labels;
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-linha">
            <th className="py-2 pr-3 font-medium">Data</th>
            <th className="py-2 pr-3 font-medium">Cliente</th>
            <th className="py-2 pr-3 font-medium">Resumo</th>
            {!compact && <th className="py-2 pr-3 font-medium">Classificação</th>}
            <th className="py-2 pr-3 font-medium">Gravidade</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-linha/70 last:border-0 hover:bg-[#f7faff] align-top">
              <td className="py-3 pr-3 whitespace-nowrap text-slate-600">{fmtDate(r.referenceDate)}</td>
              <td className="py-3 pr-3 min-w-[160px]">
                <Link to={`/reclamacoes/${r.id}`} className="font-medium text-petroleo hover:text-nibo">{r.customerName || 'Cliente não identificado'}</Link>
                <div className="text-xs text-slate-500">{r.companyName || '—'}</div>
                {r.hubspotStatus === 'sem_vinculo' && <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 mt-0.5"><UserX className="size-3" /> sem vínculo HubSpot</span>}
              </td>
              <td className="py-3 pr-3 min-w-[240px]">
                <Link to={`/reclamacoes/${r.id}`} className="text-slate-700 hover:text-nibo line-clamp-2">{r.summary}</Link>
                <div className="flex gap-1 mt-1">
                  {r.kind !== 'reclamacao' && <Badge tone="purple">{L.kind[r.kind]}</Badge>}
                  {r.recurrenceOf && <Badge tone="pink"><Repeat className="size-3" /> recorrência</Badge>}
                </div>
              </td>
              {!compact && (
                <td className="py-3 pr-3 min-w-[180px] text-xs">
                  <div className="text-slate-700">{r.category}</div>
                  <div className="text-slate-500">{r.subcategory} · {r.product}</div>
                </td>
              )}
              <td className="py-3 pr-3"><Badge tone={severityTone(r.severity)}>{L.severity[r.severity]}</Badge></td>
              <td className="py-3"><Badge tone={statusTone(r.validationStatus)}>{STATUS_LABELS[r.validationStatus]}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
