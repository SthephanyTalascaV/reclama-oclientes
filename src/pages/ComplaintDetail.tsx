import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ExternalLink, ImageOff, Images, Link2, Pencil, Repeat, ShieldAlert, Trash2, Unlink } from 'lucide-react';
import { useApp, useTaxonomy } from '../app-context';
import { api, type ApiError } from '../lib/api';
import type { Candidate, ComplaintData, ComplaintDoc, ComplaintRow, HistoryEntry, MatchResponse } from '../lib/types';
import { Alert, Badge, Button, Card, ErrorBox, Spinner, Textarea, severityTone, statusTone } from '../components/ui';
import { ComplaintForm } from '../components/ComplaintForm';
import { CustomerMatch } from '../components/CustomerMatch';
import { ComplaintTable } from '../components/ComplaintTable';
import { FIELD_LABELS, STATUS_LABELS, fmtDate, fmtDateTime } from '../lib/format';

interface DetailResponse { complaint: ComplaintDoc; history: HistoryEntry[]; related: ComplaintRow[] }

export function ComplaintDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const taxonomy = useTaxonomy();
  const { user } = useApp();
  const [d, setD] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ComplaintData | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [images, setImages] = useState<{ url: string | null; deleted: boolean; expiresAt: string }[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setError(null);
    api<DetailResponse>(`/api/complaints/${id}`).then((r) => { setD(r); setForm(r.complaint.data); }).catch(setError);
  }, [id, tick]);

  const patch = async (body: Record<string, unknown>, okMsg: string) => {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ changed: boolean }>(`/api/complaints/${id}`, { method: 'PATCH', body: { ...body, note: note || undefined } });
      setMsg(r.changed ? okMsg : 'Nenhuma alteração para salvar.');
      setEditing(false);
      setLinking(false);
      setNote('');
      setTick((t) => t + 1);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  };

  if (error && !d) return <ErrorBox error={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!d || !form) return <Spinner />;
  const c = d.complaint;
  const L = taxonomy.enums.labels;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-slate-500 hover:text-petroleo"><ArrowLeft className="size-4" /> Voltar</button>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2 mb-2">
            <Badge tone={c.kind === 'reclamacao' ? 'navy' : 'purple'}>{L.kind[c.kind]}</Badge>
            <Badge tone={severityTone(c.classification.severity)}>Gravidade: {L.severity[c.classification.severity]}</Badge>
            <Badge tone={statusTone(c.validation.status)}>{STATUS_LABELS[c.validation.status]}</Badge>
            <Badge tone={statusTone(c.hubspot.status)}>{STATUS_LABELS[c.hubspot.status]}</Badge>
            {c.recurrenceOf && <Badge tone="pink"><Repeat className="size-3" /> recorrência</Badge>}
            {c.demo && <Badge tone="amber">demonstração</Badge>}
          </div>
          <h1 className="text-xl font-semibold text-petroleo">{c.summary}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {c.customer.name || 'Cliente não identificado'} · data de referência {fmtDate(c.complaintDate || c.createdAt)} · registrado por {c.createdBy.name} em {fmtDateTime(c.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {c.validation.status !== 'validado' && <Button variant="success" icon={<CheckCircle2 className="size-4" />} loading={saving} onClick={() => patch({ validationStatus: 'validado' }, 'Registro validado.')}>Validar</Button>}
          {c.validation.status !== 'revisao_necessaria' && <Button variant="secondary" icon={<ShieldAlert className="size-4" />} onClick={() => patch({ validationStatus: 'revisao_necessaria' }, 'Marcado para revisão.')}>Marcar para revisão</Button>}
          {!editing && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>}
          {user?.admin && (
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => {
              if (!confirm('Excluir este registro e seus prints? Esta ação não pode ser desfeita.')) return;
              try { await api(`/api/complaints/${id}`, { method: 'DELETE' }); navigate('/reclamacoes'); } catch (e) { setError(e as ApiError); }
            }}>Excluir</Button>
          )}
        </div>
      </div>

      {msg && <Alert tone="success">{msg}</Alert>}
      <ErrorBox error={error} />
      {c.hubspot.needsIdentificationReview && <Alert tone="warn" title="Identificação do cliente pendente">Este registro não está vinculado a um contato do HubSpot. Use “Vincular ao HubSpot” abaixo.</Alert>}

      <div className="grid xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Card title="Dados da reclamação" subtitle={editing ? 'Alterações ficam registradas no histórico' : 'Selos: IA = extraído automaticamente · editado = alterado por uma pessoa'}>
            {editing ? (
              <div className="space-y-4">
                <ComplaintForm value={form} onChange={setForm} taxonomy={taxonomy} sources={c.fieldSources} />
                <Textarea placeholder="Motivo da alteração (opcional, aparece no histórico)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => { setEditing(false); setForm(c.data); }}>Cancelar</Button>
                  <Button loading={saving} onClick={() => patch({ data: form }, 'Alterações salvas.')}>Salvar alterações</Button>
                </div>
              </div>
            ) : (
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                {(['category', 'subcategory', 'product', 'feature', 'sentiment', 'severity', 'customerName', 'customerPhone', 'customerEmail', 'companyName', 'complaintDate'] as const).map((k) => (
                  <div key={k}>
                    <dt className="text-xs text-slate-500 flex items-center gap-1.5">{FIELD_LABELS[k]} {c.fieldSources?.[k] === 'usuario' && <Badge tone="purple">editado</Badge>}</dt>
                    <dd className="text-slate-800 mt-0.5">{k === 'severity' ? L.severity[c.data.severity] : k === 'sentiment' ? L.sentiment[c.data.sentiment] : k === 'complaintDate' ? fmtDate(c.data.complaintDate) : (c.data[k] as string) || '—'}</dd>
                  </div>
                ))}
                {(['problemDescription', 'reportedImpact'] as const).map((k) => (
                  <div key={k} className="sm:col-span-2">
                    <dt className="text-xs text-slate-500 flex items-center gap-1.5">{FIELD_LABELS[k]} {c.fieldSources?.[k] === 'usuario' && <Badge tone="purple">editado</Badge>}</dt>
                    <dd className="text-slate-800 mt-0.5">{c.data[k]}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          <Card title="Texto original extraído do print" subtitle="Imutável — é o que a IA leu da imagem">
            <pre className="whitespace-pre-wrap text-sm bg-[#f4f7fc] rounded-xl p-4 max-h-96 overflow-auto scroll-thin font-sans text-slate-700">{c.ocrText || 'Registro manual, sem print.'}</pre>
          </Card>

          {c.ai && (
            <Card title="Análise original da IA" subtitle={`Modelo ${c.ai.model} · ${fmtDateTime(c.ai.analyzedAt)} · leitura ${c.ai.legibility}`}>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <p><span className="text-xs text-slate-500 block">Tipo sugerido</span>{L.kind[c.ai.output.kind]} — {c.ai.kindReason}</p>
                <p><span className="text-xs text-slate-500 block">Gravidade sugerida</span>{L.severity[c.ai.output.severity]} — {c.ai.severityReason}</p>
                <p><span className="text-xs text-slate-500 block">Classificação sugerida</span>{c.ai.output.category} › {c.ai.output.subcategory} · {c.ai.output.product}</p>
                <p><span className="text-xs text-slate-500 block">Resumo sugerido</span>{c.ai.output.summary}</p>
              </div>
              {c.ai.evidence?.length > 0 && <div className="mt-3 space-y-1">{c.ai.evidence.map((e) => <blockquote key={e} className="border-l-2 border-celeste pl-3 text-sm text-slate-600 italic">{e}</blockquote>)}</div>}
            </Card>
          )}

          <Card title="Prints" subtitle="Links temporários (10 min). Apagados automaticamente após o prazo de retenção.">
            {!images ? (
              <Button variant="secondary" icon={<Images className="size-4" />} disabled={!c.images.length} onClick={async () => {
                try { setImages((await api<{ images: typeof images }>(`/api/complaints/${id}/images`)).images); } catch (e) { setError(e as ApiError); }
              }}>{c.images.length ? `Carregar ${c.images.length} print(s)` : 'Sem prints neste registro'}</Button>
            ) : (
              <div className="flex gap-3 overflow-x-auto scroll-thin">
                {images!.map((img, i) => img.url ? (
                  <a key={i} href={img.url} target="_blank" rel="noreferrer" className="shrink-0"><img src={img.url} alt={`Print ${i + 1}`} className="h-64 rounded-xl border border-linha" /></a>
                ) : (
                  <div key={i} className="h-40 w-40 rounded-xl border border-dashed border-linha grid place-items-center text-xs text-slate-500 text-center p-3"><ImageOff className="size-5 mx-auto mb-1" />Removido pela retenção</div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Cliente no HubSpot">
            {c.hubspot.status === 'vinculado' ? (
              <div className="text-sm space-y-1">
                <p className="font-medium text-petroleo">{c.hubspot.contactName || 'Contato'} <span className="text-xs text-slate-500 font-normal">ID {c.hubspot.contactId}</span></p>
                {c.hubspot.companyName && <p className="text-slate-600">{c.hubspot.companyName}</p>}
                <p className="text-xs text-slate-500">Vinculado por {c.hubspot.linkedBy} em {fmtDateTime(c.hubspot.linkedAt)}</p>
                {c.hubspot.url && <a href={c.hubspot.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-nibo text-xs hover:underline">Abrir no HubSpot <ExternalLink className="size-3" /></a>}
              </div>
            ) : <p className="text-sm text-slate-500">Sem vínculo.</p>}
            <div className="flex flex-wrap gap-2 mt-3">
              <Button size="sm" variant="secondary" icon={<Link2 className="size-3.5" />} onClick={() => setLinking(!linking)}>{c.hubspot.status === 'vinculado' ? 'Trocar contato' : 'Vincular ao HubSpot'}</Button>
              {c.hubspot.status === 'vinculado' && <Button size="sm" variant="ghost" icon={<Unlink className="size-3.5" />} onClick={() => confirm('Remover o vínculo com o HubSpot?') && patch({ hubspot: null }, 'Vínculo removido.')}>Desvincular</Button>}
            </div>
            {linking && <LinkPicker complaint={c} onConfirm={(cand) => patch({ hubspot: { contactId: cand.contactId, contactName: cand.name, companyId: cand.companies[0]?.id, companyName: cand.companies[0]?.name || cand.companyProp, url: cand.url, matchDecision: 'confirmado_manual', matchScore: cand.score, matchReasons: cand.reasons } }, 'Contato vinculado.')} />}
          </Card>

          <Card title="Recorrência">
            {c.recurrenceOf ? (
              <p className="text-sm">Recorrência de <Link className="text-nibo underline" to={`/reclamacoes/${c.recurrenceOf}`}>outro registro</Link>.
                <button className="ml-2 text-xs text-slate-500 underline" onClick={() => patch({ recurrenceOf: null }, 'Recorrência removida.')}>remover</button></p>
            ) : d.related.length ? (
              <select className="w-full h-10 rounded-xl border border-linha px-2 text-sm" defaultValue="" onChange={(e) => e.target.value && patch({ recurrenceOf: e.target.value }, 'Marcado como recorrência.')}>
                <option value="">Marcar como recorrência de…</option>
                {d.related.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.referenceDate)} · {r.subcategory}</option>)}
              </select>
            ) : <p className="text-sm text-slate-500">Nenhuma outra reclamação deste cliente.</p>}
          </Card>

          <Card title="Histórico de alterações">
            <ol className="relative border-l border-linha ml-2 space-y-4">
              {d.history.map((h) => (
                <li key={h.id} className="ml-4">
                  <span className="absolute -left-[5px] size-2.5 rounded-full bg-celeste mt-1.5" />
                  <p className="text-xs text-slate-500">{fmtDateTime(h.at)} · {h.byName || h.by}</p>
                  <p className="text-sm font-medium text-petroleo capitalize">{h.action.replace('_', ' ')}</p>
                  {h.note && <p className="text-xs text-slate-600 italic">“{h.note}”</p>}
                  {h.changes.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {h.changes.map((ch, i) => <li key={i} className="text-xs text-slate-600"><span className="font-medium">{FIELD_LABELS[ch.field] || ch.field}:</span> <span className="line-through text-slate-400">{String(ch.from ?? '—')}</span> → {String(ch.to ?? '—')}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {d.related.length > 0 && (
        <Card title="Outras reclamações do mesmo cliente" subtitle="Pelo contato do HubSpot ou pelo telefone">
          <ComplaintTable rows={d.related} taxonomy={taxonomy} />
        </Card>
      )}
    </div>
  );
}

function LinkPicker({ complaint, onConfirm }: { complaint: ComplaintDoc; onConfirm: (c: Candidate) => void }) {
  const [res, setRes] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [cand, setCand] = useState<Candidate | undefined>();

  const run = async (manual?: string) => {
    setLoading(true);
    try {
      const r = manual
        ? await api<MatchResponse>('/api/hubspot/search?q=' + encodeURIComponent(manual))
        : await api<MatchResponse>('/api/match', { method: 'POST', body: { customerName: complaint.customer.name, customerPhone: complaint.customer.phone, customerEmail: complaint.customer.email, companyName: complaint.customer.companyName, excludeId: complaint.id } });
      setRes(r);
      setSelected(r.match?.suggestedContactId || null);
      setCand(r.match?.candidates.find((c) => c.contactId === r.match?.suggestedContactId));
    } catch (e) {
      setRes({ match: null, hubspotError: { code: (e as ApiError).code, message: (e as ApiError).message }, demo: false });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-4 border-t border-linha pt-4 space-y-3">
      <CustomerMatch match={res?.match || null} hubspotError={res?.hubspotError || null} loading={loading} selected={selected} onSelect={(v, c) => { setSelected(v); setCand(c); }} onManualSearch={run} onRetry={() => run()} />
      <Button size="sm" className="w-full" disabled={!cand || selected === 'none'} onClick={() => cand && onConfirm(cand)}>Confirmar vínculo</Button>
    </div>
  );
}
