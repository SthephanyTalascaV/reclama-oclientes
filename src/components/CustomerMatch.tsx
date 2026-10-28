import { useState } from 'react';
import { Building2, ExternalLink, Mail, Phone, RefreshCw, Search, UserX } from 'lucide-react';
import type { Candidate, MatchResult } from '../lib/types';
import { Alert, Badge, Button, Input, Spinner, cx } from './ui';
import { DECISION_LABELS } from '../lib/format';

interface Props {
  match: MatchResult | null;
  hubspotError: { code: string; message: string } | null;
  loading: boolean;
  /** contactId escolhido, "none" para sem vínculo, null se ainda não escolheu */
  selected: string | null;
  onSelect: (value: string | null, candidate?: Candidate) => void;
  onManualSearch: (q: string) => void;
  onRetry?: () => void;
}

const decisionTone = { confiavel: 'success', ambiguo: 'warn', possivel: 'warn', sem_correspondencia: 'info' } as const;
const decisionText: Record<string, string> = {
  confiavel: 'Encontramos um contato com identificador forte (telefone, e-mail ou ID). Confira e confirme.',
  ambiguo: 'Há mais de um contato com o mesmo identificador. Escolha o correto — nada é vinculado automaticamente.',
  possivel: 'O contato abaixo bate só pelo nome. Confirme apenas se tiver certeza.',
  sem_correspondencia: 'Não achamos o cliente. Busque manualmente ou salve sem vínculo — o registro ficará marcado para revisão.',
};

export function CustomerMatch({ match, hubspotError, loading, selected, onSelect, onManualSearch, onRetry }: Props) {
  const [q, setQ] = useState('');

  return (
    <div className="space-y-3">
      {loading && <Spinner label="Buscando no HubSpot…" />}

      {!loading && hubspotError && (
        <Alert
          tone={hubspotError.code === 'INTEGRATION_NOT_CONFIGURED' ? 'warn' : 'error'}
          title={hubspotError.code === 'INTEGRATION_NOT_CONFIGURED' ? 'HubSpot não configurado' : 'Erro na integração com o HubSpot'}
          action={onRetry && hubspotError.code !== 'INTEGRATION_NOT_CONFIGURED' && <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>Tentar de novo</Button>}
        >
          {hubspotError.message} Você ainda pode salvar sem vínculo e vincular depois.
        </Alert>
      )}

      {!loading && match && (
        <Alert tone={decisionTone[match.decision]} title={DECISION_LABELS[match.decision]}>{decisionText[match.decision]}</Alert>
      )}

      {!loading && match && match.candidates.length > 0 && (
        <ul className="space-y-2" role="radiogroup" aria-label="Contatos encontrados">
          {match.candidates.map((c) => (
            <li key={c.contactId}>
              <label className={cx('flex gap-3 rounded-xl border p-3 cursor-pointer transition-colors', selected === c.contactId ? 'border-nibo bg-[#f1f7fd] ring-2 ring-[#0072ce22]' : 'border-linha hover:border-gelo')}>
                <input type="radio" name="contact" className="mt-1 accent-[#0072ce]" checked={selected === c.contactId} onChange={() => onSelect(c.contactId, c)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-petroleo">{c.name || 'Sem nome'}</span>
                    <span className="text-xs text-slate-500">ID {c.contactId}</span>
                    {c.strong && <Badge tone="green">identificador forte</Badge>}
                    {match.suggestedContactId === c.contactId && <Badge tone="blue">sugerido</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    {c.phones[0] && <span className="inline-flex items-center gap-1"><Phone className="size-3" /> {[...new Set(c.phones)].join(' · ')}</span>}
                    {c.email && <span className="inline-flex items-center gap-1"><Mail className="size-3" /> {c.email}</span>}
                    {(c.companies[0]?.name || c.companyProp) && (
                      <span className="inline-flex items-center gap-1"><Building2 className="size-3" /> {c.companies.map((x) => x.name).filter(Boolean).join(', ') || c.companyProp}</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">{c.reasons.map((r) => <Badge key={r} tone="navy">{r}</Badge>)}</div>
                </div>
                {c.url && (
                  <a href={c.url} target="_blank" rel="noreferrer" className="text-nibo hover:underline text-xs inline-flex items-center gap-1 self-start" onClick={(e) => e.stopPropagation()}>
                    HubSpot <ExternalLink className="size-3" />
                  </a>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}

      {!loading && (
        <label className={cx('flex gap-3 items-center rounded-xl border p-3 cursor-pointer', selected === 'none' ? 'border-amber-300 bg-amber-50/50' : 'border-dashed border-linha hover:border-gelo')}>
          <input type="radio" name="contact" className="accent-[#0072ce]" checked={selected === 'none'} onChange={() => onSelect('none')} />
          <UserX className="size-4 text-amber-700" />
          <span className="text-sm text-slate-700">Salvar sem vínculo com o HubSpot <span className="text-slate-500">(fica marcado para revisar a identificação)</span></span>
        </label>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 3) onManualSearch(q.trim());
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, telefone, e-mail ou ID do HubSpot" aria-label="Busca manual no HubSpot" />
        <Button type="submit" variant="secondary" icon={<Search className="size-4" />} disabled={q.trim().length < 3 || loading}>Buscar</Button>
      </form>
    </div>
  );
}
