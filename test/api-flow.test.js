// Fluxo completo da API com repositório em memória e HubSpot/IA substituídos
// por dublês de teste (nenhuma chamada externa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApp } from '../server/app.js';
import { createMemoryRepo } from '../server/repo/memory.js';
import { DEFAULT_TAXONOMY } from '../server/lib/config.js';
import { computeDashboard } from '../server/lib/metrics.js';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.HUBSPOT_ACCESS_TOKEN = '';

const repo = createMemoryRepo();
const cat = DEFAULT_TAXONOMY.categories[1]; // atendimento (service: true)

const fakeHubspot = () => ({
  searchContacts: async () => ({ results: [{ id: '501', properties: { firstname: 'Maria', lastname: 'Lima', phone: '+5511988887777', email: 'maria@ex.com' } }] }),
  getContact: async (id) => (id === '501' ? { id: '501', properties: {} } : null),
  contactCompanyIds: async () => ['77'],
  readCompanies: async () => [{ id: '77', name: 'Contábil Lima', domain: null }],
});

const fakeAI = async () => ({
  model: 'teste',
  raw: {
    legibility: 'legivel', ocrText: 'Cliente: ninguém me responde há 3 dias', kind: 'reclamacao', kindReason: 'insatisfação',
    customerName: 'Maria Lima', customerPhone: '(11) 98888-7777', summary: 'Cliente sem retorno do suporte há 3 dias.',
    category: cat.name, subcategory: cat.subcategories[2], product: DEFAULT_TAXONOMY.products[1], feature: 'Chat de suporte',
    problemDescription: 'Sem retorno', reportedImpact: 'Atraso', sentiment: 'muito_insatisfeito', severity: 'alta',
    severityReason: 'x', evidence: ['há 3 dias'], fieldsNeedingReview: [],
  },
});

const app = createApp({ getRepo: async () => repo, hubspotClient: fakeHubspot, analyze: fakeAI });

async function call(method, path, body) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url: path, headers: { authorization: 'Bearer x' } });
  const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await app(req, res);
  return { status: res.statusCode, json: res.body && res.headers['Content-Type']?.includes('json') ? JSON.parse(res.body) : res.body };
}

// login fake: o app usa DEMO_MODE para pular o login; aqui ativamos só para o teste
process.env.DEMO_MODE = 'true';

const png = Buffer.alloc(400, 7).toString('base64');
let saved;

test('analisar → buscar cliente → salvar → consultar → editar → dashboard', async () => {
  const a = await call('POST', '/api/analyze', { images: [{ mime: 'image/png', data: png }] });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.analysis.category, cat.name);
  assert.ok(a.json.aiToken);

  const m = await call('POST', '/api/match', { customerName: 'Maria Lima', customerPhone: '(11) 98888-7777' });
  assert.equal(m.status, 200);
  assert.equal(m.json.match.decision, 'confiavel');
  const top = m.json.match.candidates[0];
  assert.equal(top.companies[0].name, 'Contábil Lima');

  const payload = {
    images: [{ mime: 'image/png', data: png }],
    analysis: a.json.analysis, imageHashes: a.json.imageHashes, model: a.json.model, aiToken: a.json.aiToken,
    data: { ...a.json.analysis, severity: 'critica' },
    hubspot: { contactId: top.contactId, contactName: top.name, companyId: '77', companyName: 'Contábil Lima', matchDecision: 'confiavel' },
    validate: true,
  };
  const s = await call('POST', '/api/complaints', payload);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  saved = s.json.id;

  const doc = await repo.getComplaint(saved);
  assert.equal(doc.fieldSources.severity, 'usuario', 'campo alterado pela pessoa');
  assert.equal(doc.fieldSources.summary, 'ia');
  assert.equal(doc.ai.output.severity, 'alta', 'saída original da IA preservada');
  assert.equal(doc.hubspot.status, 'vinculado');
  assert.equal(doc.validation.status, 'validado');
  assert.equal(doc.images.length, 1);

  // mesmo print de novo → 409 duplicidade
  const dup = await call('POST', '/api/complaints', payload);
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, 'DUPLICATE');

  // análise adulterada → rejeitada
  const tampered = await call('POST', '/api/complaints', { ...payload, analysis: { ...payload.analysis, summary: 'outro' }, duplicateAcknowledged: true });
  assert.equal(tampered.status, 400);

  const list = await call('GET', '/api/complaints?q=retorno');
  assert.equal(list.json.total, 1);
  const byPhone = await call('GET', '/api/complaints?customer=988887777');
  assert.equal(byPhone.json.total, 1);

  const e = await call('PATCH', `/api/complaints/${saved}`, { data: { product: DEFAULT_TAXONOMY.products[0] }, note: 'produto corrigido' });
  assert.equal(e.json.changed, true);
  const det = await call('GET', `/api/complaints/${saved}`);
  assert.equal(det.json.history.length, 2);
  assert.equal(det.json.history[0].changes[0].field, 'product');

  const d = await call('GET', '/api/dashboard');
  assert.equal(d.json.kpis.total, 1);
  assert.equal(d.json.kpis.service, 1);
  assert.equal(d.json.byProduct[0].name, DEFAULT_TAXONOMY.products[0]);
  assert.match(d.json.insights[0], /1 reclamação/);
});

test('salvar sem vínculo marca identificação para revisão', async () => {
  const s = await call('POST', '/api/complaints', {
    data: { kind: 'reclamacao', summary: 'Registro manual', category: cat.name, subcategory: cat.subcategories[0], product: 'Não identificado' },
    hubspot: null, recurrenceOf: saved,
  });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const doc = await repo.getComplaint(s.json.id);
  assert.equal(doc.hubspot.status, 'sem_vinculo');
  assert.equal(doc.hubspot.needsIdentificationReview, true);
  assert.equal(doc.validation.status, 'pendente');
  assert.equal(doc.recurrenceOf, saved);
});

test('validações de entrada', async () => {
  const bad = await call('POST', '/api/complaints', { data: { kind: 'reclamacao', summary: 'x', category: 'Inventada' } });
  assert.equal(bad.status, 400);
  const noImg = await call('POST', '/api/analyze', { images: [] });
  assert.equal(noImg.status, 400);
  const notFound = await call('GET', '/api/complaints/nao-existe');
  assert.equal(notFound.status, 404);
});

test('dashboard: períodos, recorrência e números batem com os registros', () => {
  const mk = (id, date, contactId, product, service) => ({
    id, createdAt: date + 'T10:00:00Z', complaintDate: date, kind: 'reclamacao', isComplaint: true, serviceRelated: service,
    hubspot: { contactId, status: 'vinculado' }, customer: {}, classification: { product, category: service ? 'A' : 'B', subcategory: 's' },
    validation: { status: 'validado' },
  });
  const all = [
    mk('1', '2026-10-02', 'c1', 'P1', true), mk('2', '2026-10-05', 'c1', 'P1', false), mk('3', '2026-10-20', 'c2', 'P2', true),
    mk('4', '2026-09-10', 'c3', 'P1', false),
    { ...mk('5', '2026-10-21', 'c4', 'P1', false), kind: 'duvida', isComplaint: false },
  ];
  const d = computeDashboard(all, { from: '2026-10-01', to: '2026-10-31' }, '2026-10-28');
  assert.equal(d.kpis.total, 3, 'dúvida não conta como reclamação');
  assert.equal(d.kpis.service, 2);
  assert.equal(d.kpis.uniqueCustomers, 2);
  assert.equal(d.kpis.recurrentCustomers, 1);
  assert.equal(d.kpis.totalPrevious, 1);
  assert.equal(d.byProduct[0].name, 'P1');
  assert.equal(d.monthly.at(-1).total, 3);
  assert.equal(d.nonComplaints[0].name, 'duvida');
  assert.match(d.insights[0], /^Em outubro, foram registradas 3 reclamações, de 2 clientes; 2 estão relacionadas ao atendimento\.$/);
});
