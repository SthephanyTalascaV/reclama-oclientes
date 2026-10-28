// Dados FICTÍCIOS para o modo demonstração (DEMO_MODE=true).
// Nunca são gravados no Firebase — vivem só no repositório em memória.
import { randomUUID } from 'node:crypto';
import { docFieldsFrom, buildSearchText } from './lib/complaints.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export async function seedDemo(repo, { count = 140, today = new Date() } = {}) {
  const taxonomy = await repo.getTaxonomy();
  const rand = rng(42);
  const pick = (arr, weights) => {
    if (!weights) return arr[Math.floor(rand() * arr.length)];
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  };
  const customers = Array.from({ length: 45 }, (_, i) => ({
    name: `Cliente Fictício ${String(i + 1).padStart(2, '0')}`,
    phone: `(11) 9${String(80000000 + i * 1371).slice(0, 8)}`,
    company: `Escritório Demo ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? '2' : ''}`,
    contactId: i % 5 === 4 ? null : String(910000000 + i),
  }));
  const kinds = ['reclamacao', 'duvida', 'sugestao', 'elogio', 'informativo'];
  const severities = ['baixa', 'media', 'alta', 'critica', 'nao_identificado'];
  const sentiments = ['levemente_insatisfeito', 'insatisfeito', 'muito_insatisfeito', 'neutro'];

  for (let i = 0; i < count; i++) {
    const daysAgo = Math.floor(Math.pow(rand(), 1.4) * 360);
    const date = new Date(today.getTime() - daysAgo * 86_400_000).toISOString();
    const cust = pick(customers, customers.map((_, j) => (j < 8 ? 4 : 1)));
    const cat = pick(taxonomy.categories, taxonomy.categories.map((c, j) => [6, 5, 2, 3, 2, 1, 1][j] ?? 1));
    const kind = pick(kinds, [10, 2, 1, 0.5, 0.5]);
    const data = {
      kind,
      complaintDate: date.slice(0, 10),
      customerName: cust.name,
      customerPhone: cust.phone,
      customerEmail: null,
      companyName: cust.company,
      summary: `[DEMONSTRAÇÃO] Relato fictício sobre ${cat.name.toLowerCase()}.`,
      category: cat.name,
      subcategory: pick(cat.subcategories),
      product: pick(taxonomy.products, taxonomy.products.map((_, j) => [5, 3, 2, 1][j] ?? 1)),
      feature: 'Funcionalidade fictícia',
      problemDescription: 'Descrição fictícia gerada para demonstração.',
      reportedImpact: 'Impacto fictício.',
      sentiment: kind === 'reclamacao' ? pick(sentiments) : 'neutro',
      severity: kind === 'reclamacao' ? pick(severities, [3, 4, 2, 1, 1]) : 'nao_identificado',
    };
    const validated = rand() > 0.22;
    const doc = {
      id: randomUUID(),
      createdAt: date,
      updatedAt: date,
      createdBy: { email: 'demo@demonstracao.local', name: 'Seed de demonstração' },
      source: 'print_suporte',
      ...docFieldsFrom(data, taxonomy),
      hubspot: cust.contactId
        ? { status: 'vinculado', needsIdentificationReview: false, contactId: cust.contactId, contactName: cust.name, companyId: null, companyName: cust.company, url: null, matchDecision: 'confiavel', linkedBy: 'demo', linkedAt: date }
        : { status: 'sem_vinculo', needsIdentificationReview: true, contactId: null, contactName: null, companyId: null, companyName: null, url: null, matchDecision: 'sem_correspondencia' },
      ocrText: '[DEMONSTRAÇÃO] Texto fictício.',
      ai: null,
      fieldSources: {},
      validation: validated ? { status: 'validado', by: 'demo', at: date } : { status: 'pendente', by: null, at: null },
      images: [],
      imageHashes: [],
      imagesExpireAt: null,
      recurrenceOf: null,
      demo: true,
    };
    doc.searchText = buildSearchText(doc);
    await repo.createComplaint(doc);
    await repo.addHistory(doc.id, { at: date, by: 'demo', byName: 'Seed de demonstração', action: 'criado', changes: [], note: 'Registro fictício' });
  }
}
