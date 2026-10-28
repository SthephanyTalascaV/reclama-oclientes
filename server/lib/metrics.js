// Agregações do dashboard. Todos os números e textos analíticos saem
// daqui, calculados sobre os registros reais do banco — nenhum número é
// gerado pela IA. Os textos de insight são montados por modelo fixo.
import { referenceDate } from './complaints.js';
import { normalizeText } from './text.js';
import { LABELS, UNIDENTIFIED, NEEDS_REVIEW } from './config.js';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_FULL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function customerIdentity(c) {
  if (c.hubspot?.contactId) return `hs:${c.hubspot.contactId}`;
  if (c.phoneKey) return `tel:${c.phoneKey}`;
  const n = normalizeText(c.customer?.name);
  if (n) return `nome:${n}`;
  return `reg:${c.id}`;
}

const countBy = (list, fn) => {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    if (k === null || k === undefined) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
};

const toDate = (s) => new Date(s + 'T00:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * 86_400_000));
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86_400_000) + 1;

export function defaultPeriod(today = iso(new Date())) {
  return { from: today.slice(0, 8) + '01', to: today };
}

/** Aplica filtros que não são de data. */
export function matchesFilters(c, f) {
  const cls = c.classification || {};
  if (f.kind && f.kind !== 'todos' && c.kind !== f.kind) return false;
  if (!f.kind && !c.isComplaint) return false;
  if (f.product && cls.product !== f.product) return false;
  if (f.category && cls.category !== f.category) return false;
  if (f.subcategory && cls.subcategory !== f.subcategory) return false;
  if (f.severity && cls.severity !== f.severity) return false;
  if (f.sentiment && cls.sentiment !== f.sentiment) return false;
  if (f.validationStatus && c.validation?.status !== f.validationStatus) return false;
  if (f.hubspotStatus && c.hubspot?.status !== f.hubspotStatus) return false;
  if (f.company) {
    const q = normalizeText(f.company);
    const names = [c.hubspot?.companyName, c.customer?.companyName].map(normalizeText);
    if (!names.some((n) => n && n.includes(q))) return false;
  }
  if (f.customer) {
    const byNumber = matchesNumber(c, f.customer);
    if (byNumber === false) return false;
    if (byNumber === null) {
      const q = normalizeText(f.customer);
      const hay = [c.customer?.name, c.hubspot?.contactName, c.hubspot?.contactId, c.phoneKey, c.customer?.phone].map(normalizeText).join(' ');
      if (!hay.includes(q)) return false;
    }
  }
  return matchesQ(c, f.q);
}

/** Busca por número (telefone ou ID do HubSpot). null = não é número. */
function matchesNumber(c, value) {
  const d = String(value).replace(/\D+/g, '');
  if (d.length < 8 || /[a-z]/i.test(String(value))) return null;
  const last8 = d.slice(-8);
  return Boolean((c.phoneKey && c.phoneKey.endsWith(last8)) || c.hubspot?.contactId === d);
}

function matchesQ(c, q) {
  if (!q) return true;
  const num = matchesNumber(c, q);
  if (num !== null) return num;
  {
    const terms = normalizeText(q).split(' ').filter(Boolean);
    const tokens = new Set(c.searchText || []);
    const blob = (c.searchText || []).join(' ');
    if (!terms.every((t) => tokens.has(t) || blob.includes(t))) return false;
  }
  return true;
}

export const inRange = (c, from, to) => {
  const d = referenceDate(c);
  return (!from || d >= from) && (!to || d <= to);
};

function summarize(list) {
  const service = list.filter((c) => c.serviceRelated).length;
  const ids = countBy(list, customerIdentity);
  return { total: list.length, service, uniqueCustomers: ids.length, recurrentCustomers: ids.filter((x) => x.count > 1).length };
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const deltaPct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

/**
 * @param {Array} all  todos os registros (o filtro é aplicado aqui)
 * @param {object} filters  { from, to, product, category, ... }
 */
export function computeDashboard(all, filters = {}, today = iso(new Date())) {
  const period = { ...defaultPeriod(today), ...pick(filters, ['from', 'to']) };
  if (period.from > period.to) [period.from, period.to] = [period.to, period.from];

  const filtered = all.filter((c) => matchesFilters(c, filters));
  const current = filtered.filter((c) => inRange(c, period.from, period.to));

  const len = daysBetween(period.from, period.to);
  const prevTo = addDays(period.from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const previous = filtered.filter((c) => inRange(c, prevFrom, prevTo));

  const cur = summarize(current);
  const prev = summarize(previous);
  const pending = current.filter((c) => c.validation?.status !== 'validado').length;
  const unlinked = current.filter((c) => c.hubspot?.status !== 'vinculado').length;

  // Série mensal: 12 meses terminando no mês de "to" (mesmos filtros, exceto datas)
  const end = toDate(period.to);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    months.push({ key: iso(d).slice(0, 7), label: `${MONTHS[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`, total: 0, service: 0 });
  }
  const byMonth = new Map(months.map((m) => [m.key, m]));
  for (const c of filtered) {
    const m = byMonth.get(referenceDate(c).slice(0, 7));
    if (m) { m.total++; if (c.serviceRelated) m.service++; }
  }

  const byCategory = countBy(current, (c) => c.classification?.category);
  const prevByCategory = new Map(countBy(previous, (c) => c.classification?.category).map((x) => [x.name, x.count]));
  const byCategoryCompared = byCategory.map((x) => ({ ...x, previous: prevByCategory.get(x.name) || 0, delta: deltaPct(x.count, prevByCategory.get(x.name) || 0) }));
  for (const [name, count] of prevByCategory) if (!byCategory.find((x) => x.name === name)) byCategoryCompared.push({ name, count: 0, previous: count, delta: -100 });

  const topProblems = countBy(current, (c) => `${c.classification?.category} › ${c.classification?.subcategory} › ${c.classification?.product}`)
    .slice(0, 10)
    .map((x) => {
      const [category, subcategory, product] = x.name.split(' › ');
      return { category, subcategory, product, count: x.count };
    });

  // Clientes
  const groups = new Map();
  for (const c of current) {
    const k = customerIdentity(c);
    const g = groups.get(k) || { key: k, name: null, company: null, contactId: null, count: 0, last: '', categories: [] };
    g.count++;
    g.name ||= c.hubspot?.contactName || c.customer?.name || null;
    g.company ||= c.hubspot?.companyName || c.customer?.companyName || null;
    g.contactId ||= c.hubspot?.contactId || null;
    if (referenceDate(c) > g.last) g.last = referenceDate(c);
    g.categories.push(c.classification?.category);
    groups.set(k, g);
  }
  const customers = [...groups.values()]
    .map((g) => ({ ...g, topCategory: countBy(g.categories, (x) => x)[0]?.name || null, categories: undefined }))
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));

  const result = {
    period: { ...period, previousFrom: prevFrom, previousTo: prevTo, days: len },
    kpis: {
      total: cur.total,
      totalPrevious: prev.total,
      totalDelta: deltaPct(cur.total, prev.total),
      service: cur.service,
      servicePrevious: prev.service,
      uniqueCustomers: cur.uniqueCustomers,
      recurrentCustomers: cur.recurrentCustomers,
      pending,
      pendingPct: pct(pending, cur.total),
      unlinked,
    },
    monthly: months,
    byProduct: countBy(current, (c) => c.classification?.product),
    byCategory: byCategoryCompared,
    bySubcategory: countBy(current, (c) => `${c.classification?.category} › ${c.classification?.subcategory}`).slice(0, 15),
    bySeverity: countBy(current, (c) => c.classification?.severity).map((x) => ({ ...x, label: LABELS.severity[x.name] || x.name })),
    bySentiment: countBy(current, (c) => c.classification?.sentiment).map((x) => ({ ...x, label: LABELS.sentiment[x.name] || x.name })),
    byCompany: countBy(current, (c) => c.hubspot?.companyName || c.customer?.companyName || null).slice(0, 10),
    topProblems,
    customers: customers.slice(0, 50),
    nonComplaints: filters.kind
      ? []
      : countBy(all.filter((c) => !c.isComplaint && inRange(c, period.from, period.to)), (c) => c.kind).map((x) => ({ ...x, label: LABELS.kind[x.name] || x.name })),
  };
  result.insights = buildInsights(result);
  return result;
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k]) out[k] = o[k];
  return out;
}

function periodLabel(p) {
  const f = toDate(p.from);
  const t = toDate(p.to);
  const sameMonth = p.from.slice(0, 7) === p.to.slice(0, 7);
  const fullMonth = sameMonth && p.from.endsWith('-01');
  if (fullMonth) return `Em ${MONTHS_FULL[f.getUTCMonth()]}${p.to < iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0))) ? ' (até o dia ' + t.getUTCDate() + ')' : ''}`;
  const br = (s) => s.split('-').reverse().join('/');
  return `Entre ${br(p.from)} e ${br(p.to)}`;
}

const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

/** Frases analíticas a partir dos números calculados (sem IA). */
export function buildInsights(d) {
  const k = d.kpis;
  const out = [];
  if (!k.total) {
    out.push(`${periodLabel(d.period)}, não há reclamações registradas com os filtros atuais.`);
    return out;
  }
  out.push(`${periodLabel(d.period)}, foram registradas ${plural(k.total, 'reclamação', 'reclamações')}, de ${plural(k.uniqueCustomers, 'cliente', 'clientes')}; ${plural(k.service, 'está relacionada', 'estão relacionadas')} ao atendimento.`);
  if (k.totalDelta !== null) {
    const dir = k.totalDelta > 0 ? 'aumento' : k.totalDelta < 0 ? 'queda' : 'estabilidade';
    out.push(`Em relação ao período anterior equivalente (${k.totalPrevious}), houve ${dir}${k.totalDelta ? ` de ${Math.abs(k.totalDelta).toLocaleString('pt-BR')}%` : ''}.`);
  }
  const topProd = d.byProduct.find((p) => p.name !== UNIDENTIFIED);
  if (topProd) out.push(`O produto ${topProd.name} concentrou ${plural(topProd.count, 'reclamação', 'reclamações')} (${pct(topProd.count, k.total).toLocaleString('pt-BR')}% do total).`);
  const growing = d.byCategory.filter((c) => c.name !== NEEDS_REVIEW && c.count > c.previous && c.previous > 0).sort((a, b) => b.delta - a.delta)[0];
  if (growing) out.push(`A categoria ${growing.name} teve aumento em relação ao período anterior (${growing.previous} → ${growing.count}).`);
  else {
    const newCat = d.byCategory.find((c) => c.previous === 0 && c.count >= 2 && c.name !== NEEDS_REVIEW);
    if (newCat) out.push(`A categoria ${newCat.name} apareceu com ${newCat.count} reclamações, sem registros no período anterior.`);
  }
  if (k.recurrentCustomers) out.push(`${plural(k.recurrentCustomers, 'cliente reclamou', 'clientes reclamaram')} mais de uma vez no período.`);
  if (k.pending) out.push(`${plural(k.pending, 'registro ainda aguarda', 'registros ainda aguardam')} validação (${k.pendingPct.toLocaleString('pt-BR')}%).`);
  return out;
}
