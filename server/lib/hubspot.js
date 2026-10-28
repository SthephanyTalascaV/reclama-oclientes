// Integração com o HubSpot (somente leitura) + regra de correspondência.
//
// Endpoints usados (documentação oficial: https://developers.hubspot.com/docs/api-reference/search/guide):
//   POST /crm/v3/objects/contacts/search        busca com filterGroups ou "query"
//   GET  /crm/v3/objects/contacts/{id}           leitura por ID
//   GET  /crm/v4/objects/contacts/{id}/associations/companies   empresas associadas
//   POST /crm/v3/objects/companies/batch/read    nomes das empresas
// Escopos necessários no app privado: crm.objects.contacts.read, crm.objects.companies.read
//
// Regra de ouro: a busca só SUGERE. O vínculo é gravado apenas quando a pessoa confirma na tela de revisão.

import { AppError, notConfigured } from './http.js';
import { settings } from './config.js';
import { normalizeBrPhone, maskPhone, digitsOnly } from './phone.js';
import { personNameSimilarity, companyNameSimilarity, isEmail, nameTokens } from './text.js';

export const CONTACT_PROPS = ['firstname', 'lastname', 'email', 'phone', 'mobilephone', 'hs_whatsapp_phone_number', 'company', 'hs_object_id'];
const PHONE_PROPS = ['phone', 'mobilephone', 'hs_whatsapp_phone_number'];
const BASE = 'https://api.hubapi.com';

function objectsPath(object) {
  const v = settings().hubspotApiVersion;
  return v === 'v3' ? `/crm/v3/objects/${object}` : `/crm/objects/${v}/${object}`;
}

export function hubspotRecordUrl(contactId) {
  const portal = settings().hubspotPortalId;
  return portal ? `https://app.hubspot.com/contacts/${portal}/record/0-1/${contactId}` : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cliente HTTP mínimo com tratamento de 401/403/429. */
export function createHubspotClient(log, fetchImpl = fetch) {
  const token = settings().hubspotToken;
  if (!token) throw notConfigured('A integração com o HubSpot', ['HUBSPOT_ACCESS_TOKEN']);

  async function call(method, path, body, attempt = 0) {
    let res;
    try {
      res = await fetchImpl(BASE + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      log.error('hubspot.network', { path, error: String(err?.message || err) });
      throw new AppError(502, 'HUBSPOT_UNAVAILABLE', 'Não foi possível consultar o HubSpot agora.');
    }
    if (res.status === 429 && attempt < 2) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1100 * (attempt + 1);
      log.warn('hubspot.rate_limited', { path, wait });
      await sleep(wait);
      return call(method, path, body, attempt + 1);
    }
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) {
      log.error('hubspot.http_error', { path, status: res.status, body: text.slice(0, 300) });
      if (res.status === 401) throw new AppError(502, 'HUBSPOT_AUTH', 'Token do HubSpot inválido ou expirado (HUBSPOT_ACCESS_TOKEN).');
      if (res.status === 403) throw new AppError(502, 'HUBSPOT_SCOPE', 'O app do HubSpot não tem os escopos necessários (crm.objects.contacts.read e crm.objects.companies.read).');
      if (res.status === 429) throw new AppError(429, 'HUBSPOT_RATE_LIMIT', 'Limite de requisições do HubSpot atingido. Tente em alguns segundos.');
      throw new AppError(502, 'HUBSPOT_ERROR', 'O HubSpot retornou um erro na busca.');
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    searchContacts: (payload) => call('POST', `${objectsPath('contacts')}/search`, { properties: CONTACT_PROPS, limit: 10, ...payload }),
    getContact: (id) => call('GET', `${objectsPath('contacts')}/${encodeURIComponent(id)}?properties=${CONTACT_PROPS.join(',')}`),
    contactCompanyIds: async (id) => {
      const r = await call('GET', `/crm/v4/objects/contacts/${encodeURIComponent(id)}/associations/companies?limit=10`);
      return (r?.results || []).map((x) => String(x.toObjectId));
    },
    readCompanies: async (ids) => {
      if (!ids.length) return [];
      const r = await call('POST', `${objectsPath('companies')}/batch/read`, { inputs: ids.map((id) => ({ id })), properties: ['name', 'domain'] });
      return (r?.results || []).map((c) => ({ id: String(c.id), name: c.properties?.name || null, domain: c.properties?.domain || null }));
    },
  };
}

/** Converte o objeto do HubSpot para o formato interno. */
export function toCandidate(obj) {
  const p = obj.properties || {};
  const name = [p.firstname, p.lastname].filter(Boolean).join(' ').trim() || null;
  return {
    contactId: String(obj.id),
    name,
    email: p.email || null,
    phones: PHONE_PROPS.map((k) => p[k]).filter(Boolean),
    companyProp: p.company || null,
    companies: [],
    url: hubspotRecordUrl(obj.id),
  };
}

/**
 * Pontua candidatos contra os dados extraídos do print. Função pura (testada).
 * Pesos: ID exato 100 · e-mail exato 95 · telefone (DDD+8 últimos) 90 ·
 * telefone sem DDD 45 · nome completo 30 / parcial ≤27 / só 1º nome 12 · empresa até 15.
 */
export function scoreCandidates(input, candidates) {
  const phone = normalizeBrPhone(input.phone);
  const email = String(input.email || '').toLowerCase().trim();
  const wantedId = digitsOnly(input.contactId);

  const scored = candidates.map((c) => {
    let score = 0;
    const reasons = [];
    let strong = false;

    if (wantedId && c.contactId === wantedId) {
      score += 100; strong = true; reasons.push('ID do contato igual');
    }
    if (email && c.email && c.email.toLowerCase() === email) {
      score += 95; strong = true; reasons.push('E-mail igual');
    }
    if (phone.key || phone.last8) {
      const keys = c.phones.map((p) => normalizeBrPhone(p));
      if (phone.key && keys.some((k) => k.key === phone.key)) {
        score += 90; strong = true; reasons.push('Telefone igual (DDD + número)');
      } else if (!phone.key && phone.last8 && keys.some((k) => k.last8 === phone.last8)) {
        score += 45; reasons.push('Final do telefone igual (sem DDD no print)');
      }
    }
    const nameSim = personNameSimilarity(input.name, c.name);
    if (nameSim >= 1) { score += 30; reasons.push('Nome completo igual'); }
    else if (nameSim >= 0.5) { score += Math.round(30 * nameSim); reasons.push('Nome parecido'); }
    else if (nameSim > 0) { score += 12; reasons.push('Primeiro nome igual'); }

    if (input.company) {
      const compNames = [c.companyProp, ...c.companies.map((x) => x.name)].filter(Boolean);
      const best = Math.max(0, ...compNames.map((n) => companyNameSimilarity(input.company, n)));
      if (best >= 0.5) { score += Math.round(15 * best); reasons.push('Empresa compatível'); }
    }
    return { ...c, score, strong, reasons };
  });

  scored.sort((a, b) => b.score - a.score);
  const [top, second] = scored;

  let decision = 'sem_correspondencia';
  if (top && top.score > 0) {
    if (top.strong) {
      const tie = second && second.strong && top.score - second.score < 25;
      decision = tie ? 'ambiguo' : 'confiavel';
    } else {
      decision = 'possivel';
    }
  }
  return {
    decision,
    suggestedContactId: decision === 'confiavel' ? top.contactId : null,
    candidates: scored.filter((c) => c.score > 0).slice(0, 8),
  };
}

/** Executa as buscas no HubSpot e devolve a decisão + candidatos. */
export async function findContact(input, log, client = createHubspotClient(log)) {
  const found = new Map();
  const searched = [];
  const add = (results) => (results || []).forEach((o) => found.set(String(o.id), toCandidate(o)));

  const wantedId = digitsOnly(input.contactId);
  if (wantedId) {
    searched.push('id');
    const c = await client.getContact(wantedId);
    if (c) add([c]);
  }

  const email = String(input.email || '').trim().toLowerCase();
  if (isEmail(email)) {
    searched.push('email');
    const r = await client.searchContacts({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }] });
    add(r?.results);
  }

  const phone = normalizeBrPhone(input.phone);
  if (phone.last8) {
    searched.push('telefone');
    // 1) token final do número nos 3 campos de telefone (OR entre grupos)
    const r1 = await client.searchContacts({
      filterGroups: PHONE_PROPS.map((prop) => ({ filters: [{ propertyName: prop, operator: 'CONTAINS_TOKEN', value: `*${phone.last8}` }] })),
    });
    add(r1?.results);
    // 2) busca textual pelo número nacional — pega números gravados com hífen/espaço
    if (phone.national) {
      const r2 = await client.searchContacts({ query: phone.national });
      add(r2?.results);
    }
  }

  if (nameTokens(input.name).length >= 2 && found.size < 3) {
    searched.push('nome');
    const r = await client.searchContacts({ query: String(input.name).trim().slice(0, 100) });
    add(r?.results);
  }

  // Empresas associadas (até 6 candidatos para respeitar o limite de requisições)
  const list = [...found.values()].slice(0, 6);
  for (const c of list) {
    try {
      const ids = await client.contactCompanyIds(c.contactId);
      c.companies = await client.readCompanies(ids.slice(0, 5));
    } catch (err) {
      log.warn('hubspot.companies_failed', { contactId: c.contactId, code: err.code });
    }
  }

  const result = scoreCandidates(input, [...found.values()]);
  log.info('hubspot.match', { searched, candidates: found.size, decision: result.decision, phone: maskPhone(input.phone) });
  return { ...result, searched };
}

/** Busca manual a partir de um texto livre digitado na tela de revisão. */
export async function manualSearch(q, log, client = createHubspotClient(log)) {
  const text = String(q || '').trim();
  if (text.length < 3) return { decision: 'sem_correspondencia', candidates: [], searched: [] };
  const input = {};
  if (isEmail(text)) input.email = text;
  else if (/^\d[\d\s().+-]{6,}$/.test(text)) {
    input.phone = text;
    if (digitsOnly(text).length >= 9 && digitsOnly(text).length <= 14) input.contactId = digitsOnly(text);
  } else input.name = text;

  const res = await findContact(input, log, client);
  // na busca manual por nome com um só token, mostrar também resultados textuais
  if (!res.candidates.length && input.name) {
    const r = await client.searchContacts({ query: text.slice(0, 100) });
    const cands = (r?.results || []).map(toCandidate).map((c) => ({ ...c, score: 1, strong: false, reasons: ['Resultado da busca textual'] }));
    return { decision: cands.length ? 'possivel' : 'sem_correspondencia', candidates: cands, searched: ['texto'] };
  }
  return res;
}

/** Fixtures de DEMONSTRAÇÃO (DEMO_MODE=true). Contatos fictícios. */
export function demoClient() {
  const contacts = [
    { id: '900000001', properties: { firstname: 'Cliente', lastname: 'Demonstração', email: 'cliente.demo@exemplo.com', phone: '+5511999990001', company: 'Escritório Fictício Ltda' } },
    { id: '900000002', properties: { firstname: 'Cliente', lastname: 'Homônimo Demo', email: 'outro.demo@exemplo.com', phone: '+5521988880002', company: 'Outra Empresa Demo' } },
  ];
  const match = (body) => {
    const json = JSON.stringify(body).toLowerCase();
    return contacts.filter((c) => {
      const p = c.properties;
      return [p.email, normalizeBrPhone(p.phone).last8, normalizeBrPhone(p.phone).national, p.firstname, p.lastname]
        .filter(Boolean)
        .some((v) => json.includes(String(v).toLowerCase()));
    });
  };
  return {
    searchContacts: async (body) => ({ results: match(body) }),
    getContact: async (id) => contacts.find((c) => c.id === id) || null,
    contactCompanyIds: async (id) => [id === '900000001' ? '800000001' : '800000002'],
    readCompanies: async (ids) => ids.map((id) => ({ id, name: id === '800000001' ? 'Escritório Fictício Ltda' : 'Outra Empresa Demo', domain: null })),
  };
}
