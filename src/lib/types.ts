export type Kind = 'reclamacao' | 'duvida' | 'sugestao' | 'elogio' | 'informativo' | 'nao_identificado';
export type Severity = 'baixa' | 'media' | 'alta' | 'critica' | 'nao_identificado';
export type Sentiment = 'neutro' | 'levemente_insatisfeito' | 'insatisfeito' | 'muito_insatisfeito' | 'nao_identificado';
export type ValidationStatus = 'pendente' | 'validado' | 'revisao_necessaria';
export type MatchDecision = 'confiavel' | 'ambiguo' | 'possivel' | 'sem_correspondencia';

export interface Category { id: string; name: string; service: boolean; subcategories: string[] }

export interface Taxonomy {
  version?: number;
  categories: Category[];
  products: string[];
  updatedAt?: string;
  updatedBy?: string;
  enums: {
    kinds: Kind[];
    severities: Severity[];
    sentiments: Sentiment[];
    validationStatuses: ValidationStatus[];
    labels: { kind: Record<string, string>; severity: Record<string, string>; sentiment: Record<string, string> };
    unidentified: string;
    needsReview: string;
  };
}

/** Campos que a pessoa confere/edita */
export interface ComplaintData {
  kind: Kind;
  complaintDate: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  companyName: string | null;
  summary: string;
  category: string;
  subcategory: string;
  product: string;
  feature: string;
  problemDescription: string;
  reportedImpact: string;
  sentiment: Sentiment;
  severity: Severity;
}

export interface Analysis extends ComplaintData {
  legibility: 'legivel' | 'parcial' | 'ilegivel';
  ocrText: string;
  kindReason: string;
  hubspotContactId: string | null;
  severityReason: string;
  evidence: string[];
  fieldsNeedingReview: string[];
  needsReview: boolean;
}

export interface AnalyzeResponse {
  analysis: Analysis;
  imageHashes: string[];
  model: string;
  aiToken: string;
  duplicates: ComplaintRow[];
  demo: boolean;
}

export interface Candidate {
  contactId: string;
  name: string | null;
  email: string | null;
  phones: string[];
  companyProp: string | null;
  companies: { id: string; name: string | null; domain: string | null }[];
  url: string | null;
  score: number;
  strong: boolean;
  reasons: string[];
}

export interface MatchResult {
  decision: MatchDecision;
  suggestedContactId: string | null;
  candidates: Candidate[];
  searched: string[];
}

export interface MatchResponse {
  match: MatchResult | null;
  hubspotError: { code: string; message: string } | null;
  related?: ComplaintRow[];
  demo: boolean;
}

export interface ComplaintRow {
  id: string;
  createdAt: string;
  complaintDate: string | null;
  referenceDate: string;
  kind: Kind;
  customerName: string | null;
  customerPhone: string | null;
  companyName: string | null;
  hubspotStatus: 'vinculado' | 'sem_vinculo';
  hubspotContactId: string | null;
  summary: string;
  category: string;
  subcategory: string;
  product: string;
  severity: Severity;
  sentiment: Sentiment;
  validationStatus: ValidationStatus;
  recurrenceOf: string | null;
  hasImages: boolean;
}

export interface HubspotLink {
  status: 'vinculado' | 'sem_vinculo';
  needsIdentificationReview: boolean;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  url: string | null;
  matchDecision: string;
  matchScore?: number | null;
  matchReasons?: string[];
  linkedBy: string | null;
  linkedAt: string | null;
}

export interface ComplaintDoc {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: { email: string; name: string };
  source: string;
  kind: Kind;
  complaintDate: string | null;
  customer: { name: string | null; phone: string | null; phoneE164: string | null; email: string | null; companyName: string | null };
  summary: string;
  problemDescription: string;
  reportedImpact: string;
  classification: { category: string; subcategory: string; product: string; feature: string; sentiment: Sentiment; severity: Severity };
  hubspot: HubspotLink;
  ocrText: string | null;
  ai: null | { model: string; analyzedAt: string; legibility: string; fieldsNeedingReview: string[]; kindReason: string; severityReason: string; evidence: string[]; output: Analysis };
  fieldSources: Record<string, 'ia' | 'usuario'>;
  validation: { status: ValidationStatus; by: string | null; byName?: string; at: string | null };
  images: { path: string; deleted: boolean; expiresAt: string }[];
  recurrenceOf: string | null;
  demo?: boolean;
  data: ComplaintData;
}

export interface HistoryEntry {
  id: string;
  at: string;
  by: string;
  byName?: string;
  action: 'criado' | 'editado' | 'imagens_removidas';
  changes: { field: string; from: unknown; to: unknown }[];
  note: string | null;
}

export interface CountItem { name: string; count: number; label?: string }

export interface Dashboard {
  period: { from: string; to: string; previousFrom: string; previousTo: string; days: number };
  kpis: {
    total: number; totalPrevious: number; totalDelta: number | null;
    service: number; servicePrevious: number;
    uniqueCustomers: number; recurrentCustomers: number;
    pending: number; pendingPct: number; unlinked: number;
  };
  monthly: { key: string; label: string; total: number; service: number }[];
  byProduct: CountItem[];
  byCategory: (CountItem & { previous: number; delta: number | null })[];
  bySubcategory: CountItem[];
  bySeverity: CountItem[];
  bySentiment: CountItem[];
  byCompany: CountItem[];
  topProblems: { category: string; subcategory: string; product: string; count: number }[];
  customers: { key: string; name: string | null; company: string | null; contactId: string | null; count: number; last: string; topCategory: string | null }[];
  nonComplaints: CountItem[];
  insights: string[];
  demo: boolean;
  totalRecords: number;
}

export interface Health {
  ok: boolean;
  demo: boolean;
  retentionDays: number;
  integrations: {
    firebase: { configured: boolean; storageBucket: boolean; required: string[] };
    ai: { configured: boolean; provider: string; model: string; required: string[] };
    hubspot: { configured: boolean; portalId: boolean; required: string[] };
    security: { appSecret: boolean; cronSecret: boolean; allowedDomain: string; adminsConfigured: boolean };
  };
}

export interface User { email: string; name: string; admin: boolean; demo: boolean }
