import type { ComplaintData, Taxonomy } from '../lib/types';
import { Field, Input, Select, Textarea } from './ui';
import { FIELD_LABELS } from '../lib/format';

interface Props {
  value: ComplaintData;
  onChange: (v: ComplaintData) => void;
  taxonomy: Taxonomy;
  /** campos que a IA marcou para conferência */
  flags?: string[];
  /** valores originais da IA: mostra o selo "IA" ou "editado" em cada campo */
  original?: Partial<ComplaintData> | null;
  sources?: Record<string, 'ia' | 'usuario'>;
  section?: 'all' | 'customer' | 'classification';
}

export function ComplaintForm({ value, onChange, taxonomy, flags = [], original, sources, section = 'all' }: Props) {
  const set = <K extends keyof ComplaintData>(k: K, v: ComplaintData[K]) => onChange({ ...value, [k]: v });
  const { enums } = taxonomy;
  const cat = taxonomy.categories.find((c) => c.name === value.category);
  const src = (k: keyof ComplaintData): 'ia' | 'usuario' | undefined => {
    if (original) return (original[k] ?? null) === (value[k] ?? null) ? 'ia' : 'usuario';
    return sources?.[k];
  };
  const f = (k: keyof ComplaintData) => ({ flag: flags.includes(k as string) && (!original || src(k) === 'ia'), source: src(k) });

  const customer = (
    <div className="grid sm:grid-cols-2 gap-4">
      <Field label={FIELD_LABELS.customerName} {...f('customerName')}>
        <Input value={value.customerName || ''} onChange={(e) => set('customerName', e.target.value || null)} flag={f('customerName').flag} placeholder="Como aparece no print" />
      </Field>
      <Field label={FIELD_LABELS.customerPhone} {...f('customerPhone')}>
        <Input value={value.customerPhone || ''} onChange={(e) => set('customerPhone', e.target.value || null)} flag={f('customerPhone').flag} inputMode="tel" placeholder="(11) 99999-9999" />
      </Field>
      <Field label={FIELD_LABELS.customerEmail} {...f('customerEmail')}>
        <Input type="email" value={value.customerEmail || ''} onChange={(e) => set('customerEmail', e.target.value || null)} flag={f('customerEmail').flag} />
      </Field>
      <Field label={FIELD_LABELS.companyName} {...f('companyName')}>
        <Input value={value.companyName || ''} onChange={(e) => set('companyName', e.target.value || null)} flag={f('companyName').flag} />
      </Field>
    </div>
  );

  const classification = (
    <div className="grid sm:grid-cols-2 gap-4">
      <Field label={FIELD_LABELS.kind} {...f('kind')} hint="Só “Reclamação” entra nos indicadores de reclamações.">
        <Select value={value.kind} onChange={(e) => set('kind', e.target.value as ComplaintData['kind'])} flag={f('kind').flag}>
          {enums.kinds.map((k) => <option key={k} value={k}>{enums.labels.kind[k]}</option>)}
        </Select>
      </Field>
      <Field label={FIELD_LABELS.complaintDate} {...f('complaintDate')} hint="Deixe vazio se a data não aparece no print.">
        <Input type="date" value={value.complaintDate || ''} max={new Date().toLocaleDateString('sv-SE')} onChange={(e) => set('complaintDate', e.target.value || null)} />
      </Field>
      <Field label={FIELD_LABELS.category} {...f('category')}>
        <Select
          value={value.category}
          flag={f('category').flag || value.category === enums.needsReview}
          onChange={(e) => {
            const next = taxonomy.categories.find((c) => c.name === e.target.value);
            onChange({ ...value, category: e.target.value, subcategory: next?.subcategories.includes(value.subcategory) ? value.subcategory : enums.needsReview });
          }}
        >
          <option value={enums.needsReview}>{enums.needsReview}</option>
          {taxonomy.categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label={FIELD_LABELS.subcategory} {...f('subcategory')}>
        <Select value={value.subcategory} onChange={(e) => set('subcategory', e.target.value)} flag={f('subcategory').flag || value.subcategory === enums.needsReview}>
          <option value={enums.needsReview}>{enums.needsReview}</option>
          {(cat?.subcategories || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
      <Field label={FIELD_LABELS.product} {...f('product')}>
        <Select value={value.product} onChange={(e) => set('product', e.target.value)} flag={f('product').flag || value.product === enums.unidentified}>
          <option value={enums.unidentified}>{enums.unidentified}</option>
          {taxonomy.products.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      </Field>
      <Field label={FIELD_LABELS.feature} {...f('feature')}>
        <Input value={value.feature} onChange={(e) => set('feature', e.target.value)} flag={f('feature').flag} />
      </Field>
      <Field label={FIELD_LABELS.severity} {...f('severity')}>
        <Select value={value.severity} onChange={(e) => set('severity', e.target.value as ComplaintData['severity'])} flag={f('severity').flag}>
          {enums.severities.map((s) => <option key={s} value={s}>{enums.labels.severity[s]}</option>)}
        </Select>
      </Field>
      <Field label={FIELD_LABELS.sentiment} {...f('sentiment')}>
        <Select value={value.sentiment} onChange={(e) => set('sentiment', e.target.value as ComplaintData['sentiment'])} flag={f('sentiment').flag}>
          {enums.sentiments.map((s) => <option key={s} value={s}>{enums.labels.sentiment[s]}</option>)}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label={FIELD_LABELS.summary} {...f('summary')}>
          <Textarea value={value.summary} onChange={(e) => set('summary', e.target.value)} flag={f('summary').flag} rows={2} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label={FIELD_LABELS.problemDescription} {...f('problemDescription')}>
          <Textarea value={value.problemDescription} onChange={(e) => set('problemDescription', e.target.value)} flag={f('problemDescription').flag} rows={3} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label={FIELD_LABELS.reportedImpact} {...f('reportedImpact')}>
          <Input value={value.reportedImpact} onChange={(e) => set('reportedImpact', e.target.value)} flag={f('reportedImpact').flag} />
        </Field>
      </div>
    </div>
  );

  if (section === 'customer') return customer;
  if (section === 'classification') return classification;
  return (
    <div className="space-y-6">
      {customer}
      {classification}
    </div>
  );
}

export function pickData<T extends Partial<ComplaintData>>(src: T): ComplaintData {
  return {
    kind: src.kind ?? 'nao_identificado',
    complaintDate: src.complaintDate ?? null,
    customerName: src.customerName ?? null,
    customerPhone: src.customerPhone ?? null,
    customerEmail: src.customerEmail ?? null,
    companyName: src.companyName ?? null,
    summary: src.summary ?? '',
    category: src.category ?? '',
    subcategory: src.subcategory ?? '',
    product: src.product ?? '',
    feature: src.feature ?? '',
    problemDescription: src.problemDescription ?? '',
    reportedImpact: src.reportedImpact ?? '',
    sentiment: src.sentiment ?? 'nao_identificado',
    severity: src.severity ?? 'nao_identificado',
  };
}
