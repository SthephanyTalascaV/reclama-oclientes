// Regras de negócio das reclamações: montagem do registro, validação,
// rastreio de origem de cada campo (IA x pessoa) e diff para o histórico.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { badRequest } from './http.js';
import { KINDS, SENTIMENTS, SEVERITIES, VALIDATION_STATUSES, SOURCES, UNIDENTIFIED, NEEDS_REVIEW, env, isDemoMode } from './config.js';
import { normalizeBrPhone } from './phone.js';
import { searchTokens, isEmail } from './text.js';

/** Campos que a pessoa confere/corrige na tela de revisão. */
export const EDITABLE_FIELDS = [
  'kind', 'complaintDate', 'customerName', 'customerPhone', 'customerEmail', 'companyName',
  'summary', 'category', 'subcategory', 'product', 'feature', 'problemDescription', 'reportedImpact',
  'sentiment', 'severity',
];

// ---------- assinatura da análise da IA ----------
// A análise volta ao navegador para revisão e retorna no salvamento.
// A assinatura HMAC garante que o "extraído pela IA" gravado é exatamente o que a IA produziu.
function secret() {
  const s = env('APP_SECRET');
  if (s) return s;
  if (isDemoMode() || process.env.NODE_ENV === 'test') return 'demo-secret-not-for-production';
  throw badRequest('APP_SECRET não configurado no servidor.');
}

export function signAnalysis(payload) {
  return createHmac('sha256', secret()).update(JSON.stringify(payload)).digest('base64url');
}

export function verifyAnalysis(payload, token) {
  const expected = Buffer.from(signAnalysis(payload));
  const got = Buffer.from(String(token || ''));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------- imagens ----------
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGES = 6;

export function parseImages(images) {
  if (!Array.isArray(images) || images.length === 0) throw badRequest('Envie pelo menos uma imagem.');
  if (images.length > MAX_IMAGES) throw badRequest(`Envie no máximo ${MAX_IMAGES} imagens por reclamação.`);
  return images.map((img, i) => {
    const mime = String(img?.mime || '');
    if (!ALLOWED_MIME.includes(mime)) throw badRequest(`Imagem ${i + 1}: formato não suportado (use JPG, PNG ou WEBP).`);
    const data = String(img?.data || '').replace(/^data:[^;]+;base64,/, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) throw badRequest(`Imagem ${i + 1}: conteúdo inválido.`);
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length < 200) throw badRequest(`Imagem ${i + 1}: arquivo vazio ou corrompido.`);
    if (buffer.length > 3 * 1024 * 1024) throw badRequest(`Imagem ${i + 1}: maior que 3 MB.`);
    return { mime, data, buffer, hash: sha256(buffer), size: buffer.length };
  });
}

// ---------- validação dos dados confirmados ----------
const clean = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? null : String(v).slice(0, max));

export function validateData(input, taxonomy) {
  const d = {};
  for (const f of EDITABLE_FIELDS) d[f] = clean(input?.[f]) || null;

  if (!KINDS.includes(d.kind)) throw badRequest('Tipo inválido.');
  if (d.sentiment && !SENTIMENTS.includes(d.sentiment)) throw badRequest('Sentimento inválido.');
  if (d.severity && !SEVERITIES.includes(d.severity)) throw badRequest('Gravidade inválida.');
  d.sentiment ||= 'nao_identificado';
  d.severity ||= 'nao_identificado';

  const catNames = taxonomy.categories.map((c) => c.name);
  if (d.category && d.category !== NEEDS_REVIEW && !catNames.includes(d.category)) throw badRequest(`Categoria "${d.category}" não existe na configuração.`);
  d.category ||= NEEDS_REVIEW;
  const cat = taxonomy.categories.find((c) => c.name === d.category);
  if (d.subcategory && d.subcategory !== NEEDS_REVIEW && !(cat && cat.subcategories.includes(d.subcategory))) {
    throw badRequest(`Subcategoria "${d.subcategory}" não pertence à categoria escolhida.`);
  }
  d.subcategory ||= NEEDS_REVIEW;
  if (d.product && d.product !== UNIDENTIFIED && !taxonomy.products.includes(d.product)) throw badRequest(`Produto "${d.product}" não existe na configuração.`);
  d.product ||= UNIDENTIFIED;

  if (d.complaintDate && (!/^\d{4}-\d{2}-\d{2}$/.test(d.complaintDate) || Number.isNaN(Date.parse(d.complaintDate)))) {
    throw badRequest('Data da reclamação inválida (use AAAA-MM-DD).');
  }
  if (d.customerEmail && !isEmail(d.customerEmail)) throw badRequest('E-mail do cliente inválido.');
  if (d.customerEmail) d.customerEmail = d.customerEmail.toLowerCase();
  for (const f of ['summary', 'feature', 'problemDescription', 'reportedImpact']) d[f] ||= UNIDENTIFIED;
  if (d.summary === UNIDENTIFIED) throw badRequest('O resumo da reclamação é obrigatório.');
  return d;
}

/** Para cada campo: "ia" se igual ao que a IA extraiu, "usuario" se a pessoa mudou. */
export function fieldSources(data, analysis) {
  const out = {};
  for (const f of EDITABLE_FIELDS) {
    const a = analysis ? (analysis[f] ?? null) : undefined;
    out[f] = analysis === null ? 'usuario' : (data[f] ?? null) === a ? 'ia' : 'usuario';
  }
  return out;
}

/** Diferenças entre dois objetos planos, para o histórico. */
export function diff(before, after, fields) {
  const changes = [];
  for (const f of fields) {
    const a = before?.[f] ?? null;
    const b = after?.[f] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ field: f, from: a, to: b });
  }
  return changes;
}

/** Achata o documento em campos de dados (para edição e diff). */
export function dataOf(doc) {
  return {
    kind: doc.kind,
    complaintDate: doc.complaintDate,
    customerName: doc.customer?.name ?? null,
    customerPhone: doc.customer?.phone ?? null,
    customerEmail: doc.customer?.email ?? null,
    companyName: doc.customer?.companyName ?? null,
    summary: doc.summary,
    category: doc.classification?.category,
    subcategory: doc.classification?.subcategory,
    product: doc.classification?.product,
    feature: doc.classification?.feature,
    problemDescription: doc.problemDescription,
    reportedImpact: doc.reportedImpact,
    sentiment: doc.classification?.sentiment,
    severity: doc.classification?.severity,
  };
}

/** Converte dados planos + vínculo em campos do documento. */
export function docFieldsFrom(data, taxonomy) {
  const phone = normalizeBrPhone(data.customerPhone);
  const cat = taxonomy.categories.find((c) => c.name === data.category);
  return {
    kind: data.kind,
    isComplaint: data.kind === 'reclamacao',
    complaintDate: data.complaintDate || null,
    customer: {
      name: data.customerName || null,
      phone: data.customerPhone || null,
      phoneE164: phone.e164,
      email: data.customerEmail || null,
      companyName: data.companyName || null,
    },
    phoneKey: phone.key,
    summary: data.summary,
    problemDescription: data.problemDescription,
    reportedImpact: data.reportedImpact,
    classification: {
      category: data.category,
      subcategory: data.subcategory,
      product: data.product,
      feature: data.feature,
      sentiment: data.sentiment,
      severity: data.severity,
    },
    serviceRelated: Boolean(cat?.service),
  };
}

export function buildSearchText(doc) {
  return searchTokens(
    doc.customer?.name, doc.customer?.email, doc.customer?.companyName, doc.customer?.phone,
    doc.phoneKey, doc.hubspot?.contactId, doc.hubspot?.contactName, doc.hubspot?.companyName,
    doc.summary, doc.problemDescription, doc.classification?.feature, doc.classification?.product,
  );
}

/** Data de referência para o dashboard: data da conversa, ou a do registro. */
export function referenceDate(doc) {
  return doc.complaintDate || String(doc.createdAt).slice(0, 10);
}

/** Vínculo com o HubSpot a partir do que a pessoa escolheu. */
export function buildHubspotLink(link, user, nowIso) {
  if (!link || !link.contactId) {
    return { status: 'sem_vinculo', needsIdentificationReview: true, contactId: null, contactName: null, companyId: null, companyName: null, url: null, matchDecision: link?.matchDecision || 'sem_correspondencia', linkedBy: null, linkedAt: null };
  }
  const contactId = String(link.contactId).replace(/\D/g, '');
  if (!contactId) throw badRequest('ID do contato do HubSpot inválido.');
  return {
    status: 'vinculado',
    needsIdentificationReview: false,
    contactId,
    contactName: clean(link.contactName, 200) || null,
    companyId: link.companyId ? String(link.companyId).replace(/\D/g, '') || null : null,
    companyName: clean(link.companyName, 200) || null,
    url: clean(link.url, 300) || null,
    matchDecision: clean(link.matchDecision, 40) || 'manual',
    matchScore: Number.isFinite(link.matchScore) ? link.matchScore : null,
    matchReasons: Array.isArray(link.matchReasons) ? link.matchReasons.map((r) => clean(r, 100)).slice(0, 6) : [],
    linkedBy: user.email,
    linkedAt: nowIso,
  };
}

export function validateStatus(s) {
  if (!VALIDATION_STATUSES.includes(s)) throw badRequest('Status de validação inválido.');
  return s;
}

export function validateSource(s) {
  return SOURCES.includes(s) ? s : 'print_suporte';
}

/** Versão resumida do registro para listas. */
export function summaryRow(doc) {
  return {
    id: doc.id,
    createdAt: doc.createdAt,
    complaintDate: doc.complaintDate,
    referenceDate: referenceDate(doc),
    kind: doc.kind,
    customerName: doc.customer?.name ?? null,
    customerPhone: doc.customer?.phone ?? null,
    companyName: doc.hubspot?.companyName || doc.customer?.companyName || null,
    hubspotStatus: doc.hubspot?.status,
    hubspotContactId: doc.hubspot?.contactId ?? null,
    summary: doc.summary,
    category: doc.classification?.category,
    subcategory: doc.classification?.subcategory,
    product: doc.classification?.product,
    severity: doc.classification?.severity,
    sentiment: doc.classification?.sentiment,
    validationStatus: doc.validation?.status,
    recurrenceOf: doc.recurrenceOf || null,
    hasImages: (doc.images || []).some((i) => !i.deleted),
  };
}
