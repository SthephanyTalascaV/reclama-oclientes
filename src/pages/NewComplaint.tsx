import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, ImagePlus, Loader2, Repeat, RefreshCw, ScanText, Trash2, UploadCloud, XCircle, Eye,
} from 'lucide-react';
import { useTaxonomy } from '../app-context';
import { api, ApiError } from '../lib/api';
import { prepareImage, totalBytes, formatBytes, MAX_TOTAL_BYTES, ACCEPTED, type PreparedImage } from '../lib/image';
import type { AnalyzeResponse, Candidate, ComplaintData, ComplaintRow, MatchResponse } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { Alert, Badge, Button, Card, ErrorBox, cx } from '../components/ui';
import { ComplaintForm, pickData } from '../components/ComplaintForm';
import { CustomerMatch } from '../components/CustomerMatch';
import { ComplaintTable } from '../components/ComplaintTable';
import { DECISION_LABELS, fmtDate } from '../lib/format';

type StepState = 'pending' | 'running' | 'done' | 'error' | 'skipped';
interface Job {
  id: string;
  images: PreparedImage[];
  steps: { upload: StepState; ai: StepState; hubspot: StepState; history: StepState };
  phase: 'queued' | 'processing' | 'review' | 'saving' | 'saved' | 'failed';
  analyze?: AnalyzeResponse;
  data?: ComplaintData;
  match?: MatchResponse;
  matchLoading?: boolean;
  selected: string | null;
  candidate?: Candidate;
  recurrenceOf: string | null;
  dupAck: boolean;
  duplicates?: ComplaintRow[];
  error?: ApiError | null;
  savedId?: string;
}

const MAX_FILES = 6;

export function NewComplaintPage() {
  const taxonomy = useTaxonomy();
  const navigate = useNavigate();
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [mode, setMode] = useState<'single' | 'each'>('single');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [current, setCurrent] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const patchJob = useCallback((id: string, patch: Partial<Job> | ((j: Job) => Partial<Job>)) => {
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...(typeof patch === 'function' ? patch(j) : patch) } : j)));
  }, []);

  // ---------- 1. seleção de arquivos ----------
  const addFiles = async (files: FileList | File[]) => {
    setPrepError(null);
    const list = [...files].filter((f) => ACCEPTED.includes(f.type));
    if (!list.length) return setPrepError('Envie imagens PNG, JPG ou WEBP.');
    if (images.length + list.length > MAX_FILES) return setPrepError(`Envie no máximo ${MAX_FILES} prints por vez.`);
    setPreparing(true);
    try {
      const prepared: PreparedImage[] = [];
      for (const f of list) {
        let img = await prepareImage(f);
        if (img.bytes > 2_500_000) img = await prepareImage(f, 0.7);
        prepared.push(img);
      }
      const next = [...images, ...prepared];
      if (totalBytes(next) > MAX_TOTAL_BYTES && mode === 'single') {
        setPrepError(`As imagens somam ${formatBytes(totalBytes(next))}. O limite por análise é ${formatBytes(MAX_TOTAL_BYTES)} — envie menos prints ou recorte-os.`);
      }
      setImages(next);
    } catch (e) {
      setPrepError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  };

  // ---------- 2. processamento ----------
  const runMatch = async (jobId: string, data: ComplaintData, hubspotContactId: string | null, manual?: string) => {
    patchJob(jobId, (j) => ({ matchLoading: true, steps: { ...j.steps, hubspot: 'running' } }));
    try {
      const res = manual
        ? await api<MatchResponse>('/api/hubspot/search?q=' + encodeURIComponent(manual))
        : await api<MatchResponse>('/api/match', { method: 'POST', body: { customerName: data.customerName, customerPhone: data.customerPhone, customerEmail: data.customerEmail, companyName: data.companyName, hubspotContactId } });
      patchJob(jobId, (j) => {
        const suggested = res.match?.suggestedContactId || null;
        const keepSel = j.selected && res.match?.candidates.some((c) => c.contactId === j.selected);
        return {
          matchLoading: false,
          match: manual ? { ...res, related: j.match?.related } : res,
          selected: keepSel ? j.selected : suggested,
          candidate: res.match?.candidates.find((c) => c.contactId === (keepSel ? j.selected : suggested)),
          steps: { ...j.steps, hubspot: res.hubspotError ? 'error' : 'done', history: 'done' },
        };
      });
    } catch (e) {
      patchJob(jobId, (j) => ({ matchLoading: false, match: { match: null, hubspotError: { code: (e as ApiError).code, message: (e as ApiError).message }, demo: false }, steps: { ...j.steps, hubspot: 'error' } }));
    }
  };

  const processJob = async (job: Job) => {
    patchJob(job.id, { phase: 'processing', error: null, steps: { upload: 'running', ai: 'pending', hubspot: 'pending', history: 'pending' } });
    let res: AnalyzeResponse;
    try {
      patchJob(job.id, (j) => ({ steps: { ...j.steps, upload: 'done', ai: 'running' } }));
      res = await api<AnalyzeResponse>('/api/analyze', { method: 'POST', body: { images: job.images.map((i) => ({ mime: i.mime, data: i.data })) } });
    } catch (e) {
      patchJob(job.id, (j) => ({ phase: 'failed', error: e as ApiError, steps: { ...j.steps, ai: 'error' } }));
      return;
    }
    const data = pickData(res.analysis);
    patchJob(job.id, (j) => ({ analyze: res, data, duplicates: res.duplicates, steps: { ...j.steps, ai: 'done' } }));
    await runMatch(job.id, data, res.analysis.hubspotContactId);
    patchJob(job.id, { phase: 'review' });
  };

  const start = async () => {
    const groups = mode === 'single' ? [images] : images.map((i) => [i]);
    const created: Job[] = groups.map((imgs) => ({
      id: crypto.randomUUID(),
      images: imgs,
      steps: { upload: 'pending', ai: 'pending', hubspot: 'pending', history: 'pending' },
      phase: 'queued',
      selected: null,
      recurrenceOf: null,
      dupAck: false,
    }));
    setJobs(created);
    setCurrent(0);
    for (const job of created) await processJob(job); // em sequência: respeita limites da IA e do HubSpot
  };

  // ---------- 3. salvar ----------
  const save = async (job: Job, validate: boolean) => {
    if (!job.analyze || !job.data) return;
    patchJob(job.id, { phase: 'saving', error: null });
    const c = job.candidate;
    const hubspot = job.selected && job.selected !== 'none' && c
      ? {
          contactId: c.contactId,
          contactName: c.name,
          companyId: c.companies[0]?.id || null,
          companyName: c.companies[0]?.name || c.companyProp || null,
          url: c.url,
          matchDecision: job.match?.match?.decision === 'confiavel' && job.match.match.suggestedContactId === c.contactId ? 'confiavel' : 'confirmado_manual',
          matchScore: c.score,
          matchReasons: c.reasons,
        }
      : { matchDecision: job.match?.match?.decision || 'sem_correspondencia' };
    try {
      const res = await api<{ id: string }>('/api/complaints', {
        method: 'POST',
        body: {
          images: job.images.map((i) => ({ mime: i.mime, data: i.data })),
          analysis: job.analyze.analysis,
          imageHashes: job.analyze.imageHashes,
          model: job.analyze.model,
          aiToken: job.analyze.aiToken,
          data: job.data,
          hubspot,
          recurrenceOf: job.recurrenceOf,
          duplicateAcknowledged: job.dupAck,
          validate,
        },
      });
      patchJob(job.id, { phase: 'saved', savedId: res.id });
    } catch (e) {
      const err = e as ApiError;
      patchJob(job.id, { phase: 'review', error: err, duplicates: err.code === 'DUPLICATE' ? err.details?.duplicates : job.duplicates });
    }
  };

  const reset = () => {
    setImages([]);
    setJobs([]);
    setCurrent(0);
    setPrepError(null);
  };

  // ================= RENDER =================
  if (!jobs.length) {
    return (
      <>
        <PageHeader title="Nova reclamação" subtitle="Envie o print da conversa com o suporte. A IA lê, classifica e procura o cliente no HubSpot — você confere tudo antes de salvar." />
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
              onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) addFiles(f); }}
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              className={cx('rounded-2xl border-2 border-dashed bg-white p-10 text-center cursor-pointer transition-colors', dragging ? 'border-nibo bg-[#f1f7fd]' : 'border-gelo hover:border-nibo')}
            >
              <div className="mx-auto size-14 rounded-2xl bg-[#e6f1fb] text-nibo grid place-items-center mb-4">
                {preparing ? <Loader2 className="size-7 animate-spin" /> : <UploadCloud className="size-7" />}
              </div>
              <p className="font-medium text-petroleo">Arraste os prints aqui, cole (Ctrl+V) ou clique para escolher</p>
              <p className="text-xs text-slate-500 mt-1">PNG, JPG ou WEBP · até {MAX_FILES} imagens · reduzimos o tamanho sem perder a leitura</p>
              <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            {prepError && <Alert tone="warn">{prepError}</Alert>}

            {images.length > 0 && (
              <Card title={`Prévia (${images.length})`} subtitle={`${formatBytes(totalBytes(images))} no total`} action={<Button size="sm" variant="ghost" icon={<ImagePlus className="size-4" />} onClick={() => inputRef.current?.click()}>Adicionar</Button>}>
                <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {images.map((img, i) => (
                    <li key={img.id} className="group relative rounded-xl border border-linha overflow-hidden bg-[#f4f7fc]">
                      <button className="block w-full" onClick={() => setZoom(img.previewUrl)} aria-label={`Ampliar ${img.name}`}>
                        <img src={img.previewUrl} alt={img.name} className="h-44 w-full object-cover object-top" />
                      </button>
                      <div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-slate-600 bg-white">
                        <span className="truncate">{i + 1}. {img.name}</span>
                        <button onClick={() => setImages(images.filter((x) => x.id !== img.id))} className="text-slate-400 hover:text-red-600 p-1" aria-label={`Remover ${img.name}`}><Trash2 className="size-3.5" /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card title="Como processar">
              <div className="space-y-2">
                {([
                  ['single', 'Uma reclamação', 'Os prints são partes da mesma conversa.'],
                  ['each', 'Uma por print', 'Cada imagem é um caso diferente.'],
                ] as const).map(([v, t, d]) => (
                  <label key={v} className={cx('flex gap-3 rounded-xl border p-3 cursor-pointer', mode === v ? 'border-nibo bg-[#f1f7fd]' : 'border-linha', images.length < 2 && v === 'each' && 'opacity-50')}>
                    <input type="radio" className="mt-1 accent-[#0072ce]" checked={mode === v} disabled={images.length < 2 && v === 'each'} onChange={() => setMode(v)} />
                    <span><span className="block text-sm font-medium text-petroleo">{t}</span><span className="text-xs text-slate-500">{d}</span></span>
                  </label>
                ))}
              </div>
              <Button size="lg" className="w-full mt-4" icon={<ScanText className="size-5" />} disabled={!images.length || preparing || (mode === 'single' && totalBytes(images) > MAX_TOTAL_BYTES)} onClick={start}>
                Analisar {images.length > 1 && mode === 'each' ? `${images.length} prints` : 'print'}
              </Button>
            </Card>
            <Alert tone="info" title="Nada é salvo sem sua confirmação">
              A IA só sugere. Campos incertos ficam marcados como “conferir”, e o cliente só é vinculado ao HubSpot quando você escolhe o contato.
            </Alert>
          </div>
        </div>
        {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
      </>
    );
  }

  const job = jobs[current];
  const savedCount = jobs.filter((j) => j.phase === 'saved').length;

  return (
    <>
      <PageHeader
        title="Revisar e registrar"
        subtitle={jobs.length > 1 ? `Registro ${current + 1} de ${jobs.length} · ${savedCount} salvo(s)` : 'Confira os dados extraídos antes de salvar'}
        actions={
          <>
            {jobs.length > 1 && (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="secondary" icon={<ChevronLeft className="size-4" />} disabled={current === 0} onClick={() => setCurrent(current - 1)}>Anterior</Button>
                <Button size="sm" variant="secondary" disabled={current === jobs.length - 1} onClick={() => setCurrent(current + 1)}>Próximo <ChevronRight className="size-4" /></Button>
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={reset}>Começar de novo</Button>
          </>
        }
      />

      {(job.phase === 'queued' || job.phase === 'processing' || job.phase === 'failed') && (
        <div className="max-w-xl mx-auto">
          <Card title={job.phase === 'failed' ? 'Não foi possível concluir a análise' : 'Analisando…'}>
            <ol className="space-y-3">
              <Step state={job.steps.upload} label="Enviando as imagens" />
              <Step state={job.steps.ai} label="Lendo o print e classificando a reclamação (IA)" />
              <Step state={job.steps.hubspot} label="Buscando o cliente no HubSpot" />
              <Step state={job.steps.history} label="Verificando duplicidades e reclamações anteriores" />
            </ol>
            {job.phase !== 'failed' && <div className="h-1 bg-[#eef3fa] rounded-full overflow-hidden mt-5"><div className="h-full w-1/3 bg-nibo progress-indeterminate" /></div>}
            {job.phase === 'failed' && (
              <div className="mt-4 space-y-3">
                <ErrorBox error={job.error || null} />
                <div className="flex gap-2">
                  <Button icon={<RefreshCw className="size-4" />} onClick={() => processJob(job)}>Tentar de novo</Button>
                  <Button variant="secondary" onClick={reset}>Voltar</Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {job.phase === 'saved' && (
        <div className="max-w-xl mx-auto">
          <Card>
            <div className="text-center py-6">
              <CheckCircle2 className="size-12 text-emerald-600 mx-auto" />
              <p className="text-lg font-semibold text-petroleo mt-3">Reclamação registrada</p>
              <p className="text-sm text-slate-500 mt-1">O dashboard já considera este registro.</p>
              <div className="flex flex-wrap justify-center gap-2 mt-5">
                <Button variant="secondary" onClick={() => navigate(`/reclamacoes/${job.savedId}`)}>Abrir registro</Button>
                {current < jobs.length - 1 ? <Button onClick={() => setCurrent(current + 1)}>Revisar o próximo</Button> : <Button onClick={reset}>Registrar outra</Button>}
              </div>
            </div>
          </Card>
        </div>
      )}

      {(job.phase === 'review' || job.phase === 'saving') && job.analyze && job.data && (
        <ReviewPanel
          job={job}
          onData={(data) => patchJob(job.id, { data })}
          onSelect={(selected, candidate) => patchJob(job.id, { selected, candidate })}
          onRematch={(manual) => runMatch(job.id, job.data!, job.analyze!.analysis.hubspotContactId, manual)}
          onRecurrence={(id) => patchJob(job.id, { recurrenceOf: id })}
          onDupAck={(v) => patchJob(job.id, { dupAck: v })}
          onSave={(validate) => save(job, validate)}
          onDiscard={() => (jobs.length > 1 ? patchJob(job.id, { phase: 'failed', error: new ApiError(0, 'DISCARDED', 'Registro descartado.') }) : reset())}
          onZoom={setZoom}
          taxonomy={taxonomy}
        />
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </>
  );
}

function Step({ state, label }: { state: StepState; label: string }) {
  const icon = {
    pending: <CircleDashed className="size-5 text-slate-300" />,
    running: <Loader2 className="size-5 text-nibo animate-spin" />,
    done: <CheckCircle2 className="size-5 text-emerald-600" />,
    error: <XCircle className="size-5 text-red-600" />,
    skipped: <CircleDashed className="size-5 text-slate-300" />,
  }[state];
  return <li className={cx('flex items-center gap-3 text-sm', state === 'pending' ? 'text-slate-400' : 'text-slate-700')}>{icon}{label}</li>;
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal className="fixed inset-0 z-50 bg-petroleo/70 p-4 sm:p-10 overflow-auto" onClick={onClose}>
      <img src={src} alt="Print ampliado" className="mx-auto max-w-full rounded-xl shadow-2xl bg-white" />
    </div>
  );
}

function ReviewPanel({ job, taxonomy, onData, onSelect, onRematch, onRecurrence, onDupAck, onSave, onDiscard, onZoom }: {
  job: Job;
  taxonomy: ReturnType<typeof useTaxonomy>;
  onData: (d: ComplaintData) => void;
  onSelect: (v: string | null, c?: Candidate) => void;
  onRematch: (manual?: string) => void;
  onRecurrence: (id: string | null) => void;
  onDupAck: (v: boolean) => void;
  onSave: (validate: boolean) => void;
  onDiscard: () => void;
  onZoom: (src: string) => void;
}) {
  const a = job.analyze!.analysis;
  const data = job.data!;
  const L = taxonomy.enums.labels;
  const related = job.match?.related || [];
  const dups = job.duplicates || [];
  const needsDupAck = dups.length > 0 && !job.dupAck;
  const canSave = job.selected !== null && !needsDupAck && data.summary.trim().length > 0;
  const [showText, setShowText] = useState(false);

  return (
    <div className="grid xl:grid-cols-5 gap-5">
      {/* coluna esquerda: evidências */}
      <div className="xl:col-span-2 space-y-4">
        <Card title="Print enviado" padded>
          <div className="flex gap-2 overflow-x-auto scroll-thin pb-1">
            {job.images.map((img) => (
              <button key={img.id} onClick={() => onZoom(img.previewUrl)} className="shrink-0 rounded-xl border border-linha overflow-hidden hover:border-nibo">
                <img src={img.previewUrl} alt={img.name} className="h-56 w-auto max-w-[260px] object-cover object-top" />
              </button>
            ))}
          </div>
        </Card>

        {a.legibility === 'ilegivel' && <Alert tone="error" title="Print ilegível">A IA não conseguiu ler a conversa. Envie uma imagem melhor ou preencha os campos manualmente — nada foi inventado.</Alert>}
        {a.legibility === 'parcial' && <Alert tone="warn" title="Leitura parcial">Parte do print está cortada ou borrada. Confira os campos marcados.</Alert>}
        {data.kind !== 'reclamacao' && (
          <Alert tone="info" title={`Classificado como: ${L.kind[data.kind]}`}>
            {a.kindReason || 'A IA não identificou insatisfação.'} Registros que não são reclamação ficam no histórico, mas não entram nos indicadores. Corrija o tipo se necessário.
          </Alert>
        )}

        <Card title="O que a IA considerou" subtitle={`Modelo: ${job.analyze!.model}${job.analyze!.demo ? ' (demonstração)' : ''}`}>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-xs text-slate-500">Por que é {L.kind[a.kind].toLowerCase()}</dt><dd className="text-slate-700">{a.kindReason || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Gravidade ({L.severity[a.severity]})</dt><dd className="text-slate-700">{a.severityReason || '—'}</dd></div>
            {a.evidence.length > 0 && (
              <div><dt className="text-xs text-slate-500 mb-1">Trechos do print</dt>
                <dd className="space-y-1">{a.evidence.map((e) => <blockquote key={e} className="border-l-2 border-celeste pl-3 text-slate-600 italic">{e}</blockquote>)}</dd>
              </div>
            )}
            {a.fieldsNeedingReview.length > 0 && <div><dt className="text-xs text-slate-500 mb-1">Campos com baixa confiança</dt><dd className="flex flex-wrap gap-1">{a.fieldsNeedingReview.map((f) => <Badge key={f} tone="amber">{f}</Badge>)}</dd></div>}
          </dl>
          <button className="mt-4 text-xs text-nibo inline-flex items-center gap-1" onClick={() => setShowText(!showText)}><Eye className="size-3.5" /> {showText ? 'Ocultar' : 'Ver'} texto extraído do print</button>
          {showText && <pre className="mt-2 whitespace-pre-wrap text-xs bg-[#f4f7fc] rounded-xl p-3 max-h-80 overflow-auto scroll-thin font-sans text-slate-700">{a.ocrText || '(sem texto)'}</pre>}
        </Card>
      </div>

      {/* coluna direita: formulário */}
      <div className="xl:col-span-3 space-y-4">
        {dups.length > 0 && (
          <Alert tone="warn" title="Este print já foi registrado">
            <p>Existe registro com exatamente a mesma imagem. Confira antes de salvar para não duplicar:</p>
            <ul className="mt-2 space-y-1">{dups.map((d) => <li key={d.id}><Link className="underline" to={`/reclamacoes/${d.id}`} target="_blank">{fmtDate(d.referenceDate)} · {d.customerName || 'cliente'} · {d.summary.slice(0, 80)}</Link></li>)}</ul>
            <label className="flex items-center gap-2 mt-3 font-medium"><input type="checkbox" className="accent-[#0072ce]" checked={job.dupAck} onChange={(e) => onDupAck(e.target.checked)} /> Conferi — é um registro novo mesmo assim</label>
          </Alert>
        )}

        <Card title="Cliente" subtitle="Dados extraídos do print — corrija se necessário e busque de novo">
          <ComplaintForm section="customer" value={data} onChange={onData} taxonomy={taxonomy} flags={a.fieldsNeedingReview} original={a} />
          <div className="mt-3"><Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} onClick={() => onRematch()} loading={job.matchLoading}>Buscar de novo com estes dados</Button></div>
        </Card>

        <Card title="Identificação no HubSpot" subtitle={job.match?.match ? `Buscado por: ${job.match.match.searched.join(', ') || '—'} · ${DECISION_LABELS[job.match.match.decision]}` : undefined}>
          <CustomerMatch
            match={job.match?.match || null}
            hubspotError={job.match?.hubspotError || null}
            loading={Boolean(job.matchLoading)}
            selected={job.selected}
            onSelect={onSelect}
            onManualSearch={(q) => onRematch(q)}
            onRetry={() => onRematch()}
          />
        </Card>

        {related.length > 0 && (
          <Card title="Reclamações anteriores deste cliente" subtitle="Pelo mesmo telefone ou contato do HubSpot. Marque se é o mesmo problema voltando — os registros continuam separados.">
            <ComplaintTable rows={related} taxonomy={taxonomy} compact />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <Repeat className="size-4 text-[#c4127c]" />
              <span className="text-slate-600">Recorrência de:</span>
              <select className="h-9 rounded-xl border border-linha px-2 text-sm" value={job.recurrenceOf || ''} onChange={(e) => onRecurrence(e.target.value || null)}>
                <option value="">Não é recorrência</option>
                {related.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.referenceDate)} · {r.subcategory}</option>)}
              </select>
            </div>
          </Card>
        )}

        <Card title="Classificação" subtitle="Selos: IA = valor extraído · editado = alterado por você · conferir = baixa confiança">
          <ComplaintForm section="classification" value={data} onChange={onData} taxonomy={taxonomy} flags={a.fieldsNeedingReview} original={a} />
        </Card>

        <ErrorBox error={job.error && job.error.code !== 'DUPLICATE' ? job.error : null} />

        <div className="sticky bottom-0 z-10 -mx-1 px-1 py-3 bg-gradient-to-t from-fundo via-fundo to-transparent">
          <div className="bg-white rounded-2xl border border-linha p-3 flex flex-wrap items-center gap-2 shadow-[0_-4px_16px_rgba(0,45,114,0.06)]">
            <p className="text-xs text-slate-500 flex-1 min-w-[200px]">
              {job.selected === null ? 'Escolha o contato do HubSpot ou “salvar sem vínculo” para continuar.' : needsDupAck ? 'Confirme o aviso de duplicidade acima.' : job.selected === 'none' ? 'Será salvo sem vínculo (identificação a revisar).' : `Será vinculado ao contato ${job.selected}.`}
            </p>
            <Button variant="ghost" onClick={onDiscard} disabled={job.phase === 'saving'}>Descartar</Button>
            <Button variant="secondary" onClick={() => onSave(false)} disabled={!canSave} loading={job.phase === 'saving'}>Salvar como pendente</Button>
            <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => onSave(true)} disabled={!canSave} loading={job.phase === 'saving'}>Confirmar e salvar</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
