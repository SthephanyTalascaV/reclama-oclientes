// Roteador da API. Uma única função serverless (api/index.js) atende todas as
// rotas — cabe folgado no limite de funções da Vercel.
import { randomUUID } from 'node:crypto';
import { AppError, badRequest, notFound, createLogger, newRequestId, readJson, sendJson } from './lib/http.js';
import { settings, isDemoMode, KINDS, SEVERITIES, SENTIMENTS, VALIDATION_STATUSES, LABELS, UNIDENTIFIED, NEEDS_REVIEW } from './lib/config.js';
import { authenticate, requireAdmin } from './lib/auth.js';
import { analyzeImagesWithGemini, sanitizeAnalysis, demoAnalysis } from './lib/ai.js';
import { createHubspotClient, findContact, manualSearch, demoClient } from './lib/hubspot.js';
import {
  parseImages, signAnalysis, verifyAnalysis, validateData, fieldSources, diff, dataOf, docFieldsFrom,
  buildSearchText, buildHubspotLink, validateStatus, validateSource, summaryRow, EDITABLE_FIELDS, referenceDate,
} from './lib/complaints.js';
import { computeDashboard, matchesFilters, inRange } from './lib/metrics.js';
import { normalizeBrPhone } from './lib/phone.js';

/**
 * @param {object} deps
 * @param {() => Promise<object>} deps.getRepo
 * @param {(token: string) => Promise<object>} [deps.verifyIdToken]
 * @param {(log) => object} [deps.hubspotClient]  fábrica do cliente HubSpot
 * @param {(images, taxonomy, log) => Promise<{raw, model}>} [deps.analyze]
 */
export function createApp(deps) {
  const demo = isDemoMode();
  const hubspotClient = deps.hubspotClient || ((log) => (demo ? demoClient() : createHubspotClient(log)));
  const analyze = deps.analyze || ((images, taxonomy, log) => (demo ? Promise.resolve(demoAnalysis(taxonomy)) : analyzeImagesWithGemini(images, taxonomy, log)));

  const routes = [];
  const route = (method, pattern, handler, { auth = true, needsRepo = true } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, auth, needsRepo });
  };

  // ---------------- saúde / configuração ----------------
  route('GET', '/api/health', async () => {
    const cfg = settings();
    const { firebaseConfigured } = await import('./repo/firestore.js');
    return {
      ok: true,
      demo: cfg.demo,
      integrations: {
        firebase: { configured: cfg.demo ? false : firebaseConfigured(), storageBucket: Boolean(cfg.storageBucket), required: ['FIREBASE_SERVICE_ACCOUNT_BASE64', 'FIREBASE_STORAGE_BUCKET'] },
        ai: { configured: Boolean(cfg.geminiKey), provider: 'Google Gemini', model: cfg.geminiModel, required: ['GEMINI_API_KEY'] },
        hubspot: { configured: Boolean(cfg.hubspotToken), portalId: Boolean(cfg.hubspotPortalId), required: ['HUBSPOT_ACCESS_TOKEN'] },
        security: { appSecret: Boolean(process.env.APP_SECRET), cronSecret: Boolean(cfg.cronSecret), allowedDomain: cfg.allowedDomain, adminsConfigured: cfg.adminEmails.length > 0 },
      },
      retentionDays: cfg.retentionDays,
    };
  }, { auth: false, needsRepo: false });

  route('GET', '/api/me', async ({ user }) => user);

  route('GET', '/api/taxonomy', async ({ repo }) => ({
    ...(await repo.getTaxonomy()),
    enums: { kinds: KINDS, severities: SEVERITIES, sentiments: SENTIMENTS, validationStatuses: VALIDATION_STATUSES, labels: LABELS, unidentified: UNIDENTIFIED, needsReview: NEEDS_REVIEW },
  }));

  route('PUT', '/api/taxonomy', async ({ repo, user, body, log }) => {
    requireAdmin(user);
    const t = validateTaxonomy(body);
    const cur = await repo.getTaxonomy();
    const saved = await repo.saveTaxonomy({ ...t, version: (cur.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: user.email });
    log.info('taxonomy.updated', { by: user.email, version: saved.version });
    return saved;
  });

  // ---------------- análise do print ----------------
  route('POST', '/api/analyze', async ({ repo, body, log }) => {
    const images = parseImages(body.images);
    const taxonomy = await repo.getTaxonomy();

    const dupMap = new Map();
    for (const img of images) for (const c of await repo.findByImageHash(img.hash)) dupMap.set(c.id, summaryRow(c));

    const { raw, model } = await analyze(images.map(({ mime, data }) => ({ mime, data })), taxonomy, log);
    const analysis = sanitizeAnalysis(raw, taxonomy);
    const imageHashes = images.map((i) => i.hash);
    const signed = { analysis, imageHashes, model };
    log.info('analyze.ok', { images: images.length, kind: analysis.kind, legibility: analysis.legibility, review: analysis.fieldsNeedingReview.length, duplicates: dupMap.size });
    return { ...signed, aiToken: signAnalysis(signed), duplicates: [...dupMap.values()], demo };
  });

  // ---------------- busca do cliente no HubSpot ----------------
  route('POST', '/api/match', async ({ repo, body, log }) => {
    const input = {
      name: str(body.customerName), phone: str(body.customerPhone), email: str(body.customerEmail),
      company: str(body.companyName), contactId: str(body.hubspotContactId),
    };
    let match = null;
    let hubspotError = null;
    try {
      match = await findContact(input, log, hubspotClient(log));
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      hubspotError = { code: err.code, message: err.message };
    }
    const phoneKey = normalizeBrPhone(input.phone).key;
    const ids = new Set(match?.candidates?.slice(0, 3).map((c) => c.contactId) || []);
    const related = new Map();
    for (const c of await repo.findRelated({ phoneKey })) related.set(c.id, c);
    for (const id of ids) for (const c of await repo.findRelated({ contactId: id })) related.set(c.id, c);
    const rows = [...related.values()].filter((c) => c.id !== body.excludeId).map(summaryRow)
      .sort((a, b) => String(b.referenceDate).localeCompare(String(a.referenceDate))).slice(0, 20);
    return { match, hubspotError, related: rows, demo };
  });

  route('GET', '/api/hubspot/search', async ({ query, log }) => {
    try {
      return { match: await manualSearch(query.q, log, hubspotClient(log)), hubspotError: null, demo };
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      return { match: null, hubspotError: { code: err.code, message: err.message }, demo };
    }
  });

  // ---------------- reclamações ----------------
  route('POST', '/api/complaints', async ({ repo, user, body, log }) => {
    const taxonomy = await repo.getTaxonomy();
    const now = new Date().toISOString();
    const cfg = settings();

    // 1) análise da IA (assinada) — opcional apenas em registro manual
    const analysis = body.analysis ?? null;
    if (analysis) {
      const signed = { analysis, imageHashes: body.imageHashes, model: body.model };
      if (!verifyAnalysis(signed, body.aiToken)) throw badRequest('A análise da IA não confere com a original. Refaça a análise.');
    }

    // 2) imagens: precisam ser exatamente as analisadas
    const images = body.images?.length ? parseImages(body.images) : [];
    if (analysis) {
      const sent = images.map((i) => i.hash).join(',');
      if (sent !== (body.imageHashes || []).join(',')) throw badRequest('As imagens enviadas são diferentes das analisadas.');
    }

    // 3) duplicidade exata (mesmo arquivo)
    const dups = new Map();
    for (const img of images) for (const c of await repo.findByImageHash(img.hash)) dups.set(c.id, summaryRow(c));
    if (dups.size && !body.duplicateAcknowledged) {
      throw new AppError(409, 'DUPLICATE', 'Este print já foi registrado. Confirme se é mesmo um novo registro.', { duplicates: [...dups.values()] });
    }

    // 4) dados confirmados pela pessoa
    const data = validateData(body.data, taxonomy);

    // 5) vínculo HubSpot — confere se o contato existe antes de gravar
    const hubspot = buildHubspotLink(body.hubspot, user, now);
    if (hubspot.contactId && !demo && cfg.hubspotToken) {
      const exists = await hubspotClient(log).getContact(hubspot.contactId);
      if (!exists) throw badRequest(`Contato ${hubspot.contactId} não encontrado no HubSpot.`);
    }

    // 6) recorrência
    let recurrenceOf = null;
    if (body.recurrenceOf) {
      const base = await repo.getComplaint(String(body.recurrenceOf));
      if (!base) throw badRequest('A reclamação indicada como recorrência não existe.');
      recurrenceOf = base.id;
    }

    const id = randomUUID();
    const expiresAt = new Date(Date.now() + cfg.retentionDays * 86_400_000).toISOString();
    const stored = [];
    try {
      for (const [i, img] of images.entries()) {
        const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg';
        const path = `complaints/${id}/${i + 1}-${img.hash.slice(0, 12)}.${ext}`;
        await repo.putImage(path, img.buffer, img.mime);
        stored.push({ path, hash: img.hash, mime: img.mime, size: img.size, expiresAt, deleted: false });
      }

      const validated = body.validate === true;
      const doc = {
        id,
        createdAt: now,
        updatedAt: now,
        createdBy: { email: user.email, name: user.name },
        source: validateSource(body.source || (analysis ? 'print_suporte' : 'manual')),
        ...docFieldsFrom(data, taxonomy),
        hubspot,
        ocrText: analysis ? String(analysis.ocrText || '').slice(0, 20_000) : null,
        ai: analysis ? { model: body.model, analyzedAt: now, legibility: analysis.legibility, fieldsNeedingReview: analysis.fieldsNeedingReview, kindReason: analysis.kindReason, severityReason: analysis.severityReason, evidence: analysis.evidence, output: analysis } : null,
        fieldSources: fieldSources(data, analysis),
        validation: validated ? { status: 'validado', by: user.email, byName: user.name, at: now } : { status: 'pendente', by: null, at: null },
        images: stored,
        imageHashes: stored.map((s) => s.hash),
        imagesExpireAt: stored.length ? expiresAt : null,
        recurrenceOf,
        duplicateAcknowledged: Boolean(dups.size && body.duplicateAcknowledged),
        demo,
      };
      doc.searchText = buildSearchText(doc);
      await repo.createComplaint(doc);
      await repo.addHistory(id, { at: now, by: user.email, byName: user.name, action: 'criado', changes: [], note: validated ? 'Criado e validado na revisão' : 'Criado como pendente de validação' });
      log.info('complaint.created', { id, kind: doc.kind, linked: hubspot.status, images: stored.length, validated });
      return { id, complaint: summaryRow(doc) };
    } catch (err) {
      // não deixar imagens órfãs se a gravação falhar
      for (const s of stored) await repo.deleteImage(s.path).catch(() => {});
      throw err;
    }
  });

  route('GET', '/api/complaints', async ({ repo, query }) => {
    const all = await repo.listComplaints();
    const f = { ...query, kind: query.kind || 'todos' };
    let rows = all.filter((c) => matchesFilters(c, f) && inRange(c, query.from, query.to));
    if (query.recurrent === '1') {
      const counts = new Map();
      for (const c of all) { const k = c.hubspot?.contactId || c.phoneKey; if (k) counts.set(k, (counts.get(k) || 0) + 1); }
      rows = rows.filter((c) => (counts.get(c.hubspot?.contactId || c.phoneKey) || 0) > 1);
    }
    rows.sort((a, b) => referenceDate(b).localeCompare(referenceDate(a)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    const pageSize = clamp(Number(query.pageSize) || 25, 5, 200);
    const page = Math.max(1, Number(query.page) || 1);
    return { total: rows.length, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize).map(summaryRow) };
  });

  route('GET', '/api/complaints/export', async ({ repo, query, res }) => {
    const all = await repo.listComplaints();
    const rows = all.filter((c) => matchesFilters(c, { ...query, kind: query.kind || 'todos' }) && inRange(c, query.from, query.to)).map(summaryRow);
    const cols = ['id', 'referenceDate', 'createdAt', 'kind', 'customerName', 'customerPhone', 'companyName', 'hubspotContactId', 'hubspotStatus', 'category', 'subcategory', 'product', 'severity', 'sentiment', 'validationStatus', 'summary', 'recurrenceOf'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reclamacoes-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.end(csv);
    return undefined;
  });

  route('GET', '/api/complaints/:id', async ({ repo, params }) => {
    const doc = await repo.getComplaint(params.id);
    if (!doc) throw notFound();
    const history = await repo.listHistory(doc.id);
    const relatedMap = new Map();
    for (const c of await repo.findRelated({ contactId: doc.hubspot?.contactId, phoneKey: doc.phoneKey })) if (c.id !== doc.id) relatedMap.set(c.id, summaryRow(c));
    const { searchText, ...rest } = doc;
    return { complaint: { ...rest, data: dataOf(doc) }, history, related: [...relatedMap.values()].sort((a, b) => b.referenceDate.localeCompare(a.referenceDate)) };
  });

  route('PATCH', '/api/complaints/:id', async ({ repo, params, body, user, log }) => {
    const doc = await repo.getComplaint(params.id);
    if (!doc) throw notFound();
    const taxonomy = await repo.getTaxonomy();
    const now = new Date().toISOString();
    const changes = [];
    const patch = { updatedAt: now };

    if (body.data) {
      const before = dataOf(doc);
      const data = validateData({ ...before, ...body.data }, taxonomy);
      const dataChanges = diff(before, data, EDITABLE_FIELDS);
      if (dataChanges.length) {
        Object.assign(patch, docFieldsFrom(data, taxonomy));
        const fs = { ...(doc.fieldSources || {}) };
        for (const ch of dataChanges) fs[ch.field] = 'usuario';
        patch.fieldSources = fs;
        changes.push(...dataChanges);
      }
    }

    if (body.hubspot !== undefined) {
      const link = buildHubspotLink(body.hubspot, user, now);
      if (link.contactId && !demo && settings().hubspotToken) {
        const exists = await hubspotClient(log).getContact(link.contactId);
        if (!exists) throw badRequest(`Contato ${link.contactId} não encontrado no HubSpot.`);
      }
      if (link.contactId !== (doc.hubspot?.contactId ?? null)) {
        patch.hubspot = link;
        changes.push({ field: 'hubspot.contactId', from: doc.hubspot?.contactId ?? null, to: link.contactId });
      }
    }

    if (body.validationStatus) {
      const s = validateStatus(body.validationStatus);
      if (s !== doc.validation?.status) {
        patch.validation = { status: s, by: user.email, byName: user.name, at: now };
        changes.push({ field: 'validation.status', from: doc.validation?.status ?? null, to: s });
      }
    }

    if (body.recurrenceOf !== undefined) {
      const target = body.recurrenceOf ? String(body.recurrenceOf) : null;
      if (target === doc.id) throw badRequest('Um registro não pode ser recorrência de si mesmo.');
      if (target && !(await repo.getComplaint(target))) throw badRequest('Registro de origem não encontrado.');
      if (target !== (doc.recurrenceOf ?? null)) {
        patch.recurrenceOf = target;
        changes.push({ field: 'recurrenceOf', from: doc.recurrenceOf ?? null, to: target });
      }
    }

    if (!changes.length) return { changed: false };
    const merged = { ...doc, ...patch };
    patch.searchText = buildSearchText(merged);
    await repo.updateComplaint(doc.id, patch);
    await repo.addHistory(doc.id, { at: now, by: user.email, byName: user.name, action: 'editado', changes, note: str(body.note).slice(0, 500) || null });
    log.info('complaint.updated', { id: doc.id, fields: changes.map((c) => c.field) });
    return { changed: true, changes };
  });

  route('GET', '/api/complaints/:id/images', async ({ repo, params }) => {
    const doc = await repo.getComplaint(params.id);
    if (!doc) throw notFound();
    const images = [];
    for (const img of doc.images || []) {
      images.push({ path: img.path, deleted: Boolean(img.deleted), expiresAt: img.expiresAt, url: img.deleted ? null : await repo.signedImageUrl(img.path) });
    }
    return { images };
  });

  route('DELETE', '/api/complaints/:id', async ({ repo, params, user, log }) => {
    requireAdmin(user);
    const doc = await repo.getComplaint(params.id);
    if (!doc) throw notFound();
    for (const img of doc.images || []) await repo.deleteImage(img.path).catch(() => {});
    await repo.deleteComplaint(doc.id);
    log.info('complaint.deleted', { id: doc.id, by: user.email });
    return { deleted: true };
  });

  route('GET', '/api/dashboard', async ({ repo, query }) => {
    const all = await repo.listComplaints();
    return { ...computeDashboard(all, query), demo, totalRecords: all.length };
  });

  // ---------------- retenção dos prints (Vercel Cron) ----------------
  const retention = async ({ repo, req, log }) => {
    const secret = settings().cronSecret;
    if (!secret || req.headers?.authorization !== `Bearer ${secret}`) throw new AppError(401, 'UNAUTHENTICATED', 'Não autorizado.');
    const now = new Date().toISOString();
    const docs = await repo.listComplaintsWithExpiredImages(now);
    let removed = 0;
    for (const doc of docs) {
      const images = [];
      for (const img of doc.images || []) {
        if (!img.deleted && img.expiresAt <= now) {
          await repo.deleteImage(img.path);
          images.push({ ...img, deleted: true, deletedAt: now });
          removed++;
        } else images.push(img);
      }
      const pending = images.filter((i) => !i.deleted).map((i) => i.expiresAt).sort()[0] || null;
      await repo.updateComplaint(doc.id, { images, imagesExpireAt: pending });
      await repo.addHistory(doc.id, { at: now, by: 'sistema', byName: 'Retenção automática', action: 'imagens_removidas', changes: [], note: 'Prints apagados pelo prazo de retenção' });
    }
    log.info('retention.done', { complaints: docs.length, removed });
    return { complaints: docs.length, imagesRemoved: removed };
  };
  route('GET', '/api/cron/retention', retention, { auth: false });
  route('POST', '/api/cron/retention', retention, { auth: false });

  // ---------------- handler ----------------
  return async function handler(req, res) {
    const requestId = newRequestId();
    const log = createLogger(requestId);
    res.setHeader?.('X-Request-Id', requestId);
    const url = new URL(req.url, 'http://localhost');
    const method = req.method || 'GET';
    try {
      const found = routes.find((r) => r.method === method && r.re.test(url.pathname));
      if (!found) {
        const any = routes.some((r) => r.re.test(url.pathname));
        throw new AppError(any ? 405 : 404, any ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', any ? 'Método não permitido.' : 'Rota não encontrada.');
      }
      const m = url.pathname.match(found.re);
      const params = Object.fromEntries(found.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const query = Object.fromEntries(url.searchParams.entries());
      const user = found.auth ? await authenticate(req, deps.verifyIdToken || (async () => { throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'Login não configurado.'); })) : null;
      const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readJson(req) : {};
      const repo = found.needsRepo ? await deps.getRepo() : null;
      const result = await found.handler({ req, res, repo, user, body, params, query, log });
      if (result !== undefined) sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof AppError) {
        if (err.status >= 500) log.error('request.failed', { path: url.pathname, code: err.code });
        else log.warn('request.rejected', { path: url.pathname, code: err.code, status: err.status });
        return sendJson(res, err.status, { error: { code: err.code, message: err.message, details: err.details, requestId } });
      }
      log.error('request.crashed', { path: url.pathname, error: String(err?.stack || err).slice(0, 1500) });
      return sendJson(res, 500, { error: { code: 'INTERNAL', message: 'Erro inesperado no servidor. Informe o código ao time responsável.', requestId } });
    }
  };
}

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function validateTaxonomy(body) {
  const categories = Array.isArray(body?.categories) ? body.categories : null;
  const products = Array.isArray(body?.products) ? body.products : null;
  if (!categories || !categories.length) throw badRequest('Informe ao menos uma categoria.');
  if (!products || !products.length) throw badRequest('Informe ao menos um produto.');
  const names = new Set();
  const cats = categories.map((c, i) => {
    const name = str(c?.name).slice(0, 80);
    if (!name) throw badRequest(`Categoria ${i + 1} sem nome.`);
    if ([UNIDENTIFIED, NEEDS_REVIEW].includes(name)) throw badRequest(`"${name}" é um valor reservado.`);
    if (names.has(name.toLowerCase())) throw badRequest(`Categoria "${name}" repetida.`);
    names.add(name.toLowerCase());
    const subs = [...new Set((Array.isArray(c.subcategories) ? c.subcategories : []).map((s) => str(s).slice(0, 80)).filter(Boolean))];
    if (!subs.length) throw badRequest(`A categoria "${name}" precisa de ao menos uma subcategoria.`);
    return { id: str(c.id) || name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-'), name, service: Boolean(c.service), subcategories: subs };
  });
  const prods = [...new Set(products.map((p) => str(p).slice(0, 80)).filter(Boolean))];
  if (prods.includes(UNIDENTIFIED)) throw badRequest(`"${UNIDENTIFIED}" é um valor reservado.`);
  return { categories: cats, products: prods };
}
