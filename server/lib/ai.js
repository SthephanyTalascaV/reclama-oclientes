// Leitura dos prints + classificação com um modelo multimodal (Gemini).
//
// O modelo devolve JSON restrito por responseSchema e o resultado AINDA é
// validado aqui (sanitizeAnalysis): enumerações, categorias fora da
// taxonomia e campos vazios viram "Não identificado"/"Revisão necessária".
// Nada do que o modelo devolve é salvo sem a conferência de uma pessoa.

import { AppError, notConfigured } from './http.js';
import { KINDS, SENTIMENTS, SEVERITIES, UNIDENTIFIED, NEEDS_REVIEW, settings } from './config.js';
import { normalizeBrPhone } from './phone.js';
import { isEmail } from './text.js';

const LEGIBILITY = ['legivel', 'parcial', 'ilegivel'];

const S = (description, extra = {}) => ({ type: 'STRING', description, ...extra });
const NS = (description) => ({ type: 'STRING', description, nullable: true });

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    legibility: S('Qualidade da leitura do print', { enum: LEGIBILITY }),
    ocrText: S('Transcrição fiel de TODO o texto da conversa, na ordem, com "Cliente:"/"Suporte:" quando for possível distinguir'),
    kind: S('Tipo do conteúdo', { enum: KINDS }),
    kindReason: S('Uma frase justificando o tipo, citando o que o cliente disse'),
    conversationDate: NS('Data da mensagem principal do cliente no formato AAAA-MM-DD, só se estiver visível no print'),
    customerName: NS('Nome do CLIENTE (nunca o nome do atendente do Nibo)'),
    customerPhone: NS('Telefone do cliente exatamente como aparece'),
    customerEmail: NS('E-mail do cliente, se aparecer'),
    companyName: NS('Empresa/escritório do cliente, se aparecer'),
    hubspotContactId: NS('ID de contato do HubSpot, só se aparecer explicitamente'),
    summary: S('Resumo objetivo em 1-2 frases do que o cliente relata. Não inventar causas.'),
    category: S('Categoria principal: exatamente um nome da lista fornecida, ou "Revisão necessária"'),
    subcategory: S('Subcategoria: exatamente um nome da lista da categoria escolhida, ou "Revisão necessária"'),
    product: S('Produto: exatamente um nome da lista fornecida, ou "Não identificado"'),
    feature: S('Funcionalidade afetada conforme citada pelo cliente, ou "Não identificado"'),
    problemDescription: S('Descrição do problema com base apenas no que está no print'),
    reportedImpact: S('Impacto que o próprio cliente relata (ex.: perdeu prazo, retrabalho), ou "Não identificado"'),
    sentiment: S('Nível de insatisfação percebido', { enum: SENTIMENTS }),
    severity: S('Gravidade estimada pelo impacto descrito', { enum: SEVERITIES }),
    severityReason: S('Por que essa gravidade, citando o impacto relatado'),
    evidence: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Até 3 trechos curtos do print que sustentam a classificação' },
    fieldsNeedingReview: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Nomes dos campos acima com baixa confiança' },
  },
  required: ['legibility', 'ocrText', 'kind', 'kindReason', 'summary', 'category', 'subcategory', 'product', 'feature', 'problemDescription', 'reportedImpact', 'sentiment', 'severity', 'severityReason', 'evidence', 'fieldsNeedingReview'],
  propertyOrdering: ['legibility', 'ocrText', 'kind', 'kindReason', 'conversationDate', 'customerName', 'customerPhone', 'customerEmail', 'companyName', 'hubspotContactId', 'summary', 'category', 'subcategory', 'product', 'feature', 'problemDescription', 'reportedImpact', 'sentiment', 'severity', 'severityReason', 'evidence', 'fieldsNeedingReview'],
};

export function buildPrompt(taxonomy) {
  const cats = taxonomy.categories
    .map((c) => `- ${c.name}: ${c.subcategories.join(' | ')}`)
    .join('\n');
  return `Você analisa prints de conversas entre clientes e o suporte do Nibo (software contábil/financeiro B2B).
Leia TODAS as imagens como uma única conversa, na ordem enviada.

REGRAS OBRIGATÓRIAS
1. Use somente o que está visível nas imagens. Não invente nomes, telefones, datas, produtos ou causas.
2. Se algo não estiver visível ou for incerto, use "${UNIDENTIFIED}" (ou null nos campos opcionais) e inclua o campo em fieldsNeedingReview.
3. Nunca trate hipótese como fato. Não atribua causa técnica que o cliente ou o suporte não tenham afirmado.
4. O cliente é quem relata o problema. Atendentes do Nibo NÃO são o cliente — não use o nome deles em customerName.
5. Classifique o TIPO com cuidado — nem toda conversa é reclamação:
   - reclamacao: o cliente expressa insatisfação com produto, atendimento, cobrança etc. ou relata problema que o prejudica
   - duvida: pergunta como fazer algo, sem insatisfação
   - sugestao: propõe melhoria, sem relatar falha
   - elogio: manifesta satisfação
   - informativo: apenas repassa informação
   - nao_identificado: não é possível saber
6. category e subcategory devem ser EXATAMENTE nomes desta lista (categoria: subcategorias):
${cats}
   Se nenhuma servir com segurança, use "${NEEDS_REVIEW}".
7. product deve ser EXATAMENTE um destes: ${taxonomy.products.join(' | ')}. Se não estiver claro, use "${UNIDENTIFIED}".
8. severity: baixa (incômodo pontual), media (atrapalha o trabalho), alta (impede uma rotina importante ou se repete), critica (perda financeira, prazo legal/fiscal em risco ou ameaça de cancelamento). Sem impacto descrito → nao_identificado.
9. legibility: "ilegivel" se não for possível ler a conversa; "parcial" se partes importantes estiverem cortadas/borradas.
10. Responda apenas com o JSON do schema.`;
}

/** Chama o Gemini via REST. Lança AppError com códigos estáveis. */
export async function analyzeImagesWithGemini(images, taxonomy, log) {
  const cfg = settings();
  if (!cfg.geminiKey) throw notConfigured('A IA (Gemini)', ['GEMINI_API_KEY']);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildPrompt(taxonomy) },
          ...images.map((img) => ({ inline_data: { mime_type: img.mime, data: img.data } })),
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (err) {
    log.error('gemini.network', { error: String(err?.message || err) });
    throw new AppError(502, 'AI_UNAVAILABLE', 'Não foi possível falar com a IA agora. Tente de novo em instantes.');
  }

  const text = await res.text();
  if (!res.ok) {
    log.error('gemini.http_error', { status: res.status, body: text.slice(0, 500), model: cfg.geminiModel });
    if (res.status === 400) throw new AppError(502, 'AI_BAD_REQUEST', 'A IA recusou a requisição (verifique GEMINI_MODEL e o formato das imagens).');
    if (res.status === 401 || res.status === 403) throw new AppError(502, 'AI_AUTH', 'Chave da IA inválida ou sem permissão (GEMINI_API_KEY).');
    if (res.status === 404) throw new AppError(502, 'AI_MODEL_NOT_FOUND', `Modelo "${cfg.geminiModel}" não encontrado. Ajuste GEMINI_MODEL.`);
    if (res.status === 429) throw new AppError(429, 'AI_RATE_LIMIT', 'Limite de uso da IA atingido. Aguarde um pouco e tente de novo.');
    throw new AppError(502, 'AI_ERROR', 'A IA retornou um erro. Tente novamente.');
  }

  let parsed;
  try {
    const json = JSON.parse(text);
    const candidate = json?.candidates?.[0];
    const blocked = json?.promptFeedback?.blockReason || (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason) ? candidate.finishReason : null);
    if (blocked) {
      log.warn('gemini.blocked', { reason: blocked });
      throw new AppError(422, 'AI_BLOCKED', 'A IA não processou estas imagens. Revise o conteúdo e tente novamente.');
    }
    const out = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';
    parsed = JSON.parse(out);
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error('gemini.parse_error', { body: text.slice(0, 300) });
    throw new AppError(502, 'AI_INVALID_OUTPUT', 'A IA devolveu uma resposta fora do formato esperado. Tente novamente.');
  }

  log.info('gemini.ok', { ms: Date.now() - started, model: cfg.geminiModel, images: images.length });
  return { raw: parsed, model: cfg.geminiModel };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const orUnknown = (v) => str(v) || UNIDENTIFIED;
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

/**
 * Valida e normaliza a saída do modelo contra a taxonomia atual.
 * Garante que nada fora das listas configuradas entre no registro.
 */
export function sanitizeAnalysis(raw, taxonomy) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const review = new Set(Array.isArray(r.fieldsNeedingReview) ? r.fieldsNeedingReview.map(String) : []);

  const catNames = taxonomy.categories.map((c) => c.name);
  let category = str(r.category);
  if (!catNames.includes(category)) {
    if (category && category !== NEEDS_REVIEW) review.add('category');
    category = NEEDS_REVIEW;
    review.add('category');
  }
  const cat = taxonomy.categories.find((c) => c.name === category);
  let subcategory = str(r.subcategory);
  if (!cat || !cat.subcategories.includes(subcategory)) {
    subcategory = NEEDS_REVIEW;
    review.add('subcategory');
  }

  let product = str(r.product);
  if (!taxonomy.products.includes(product)) {
    product = UNIDENTIFIED;
    review.add('product');
  }

  const legibility = oneOf(r.legibility, LEGIBILITY, 'parcial');
  const kind = oneOf(r.kind, KINDS, 'nao_identificado');
  if (kind === 'nao_identificado') review.add('kind');

  const phone = str(r.customerPhone);
  const phoneN = normalizeBrPhone(phone);
  if (phone && !phoneN.valid) review.add('customerPhone');

  const email = str(r.customerEmail);
  const hubspotId = str(r.hubspotContactId).replace(/\D/g, '');

  const date = str(r.conversationDate);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && Date.parse(date) <= Date.now() + 86_400_000;

  const customerName = str(r.customerName);
  if (!customerName) review.add('customerName');

  const analysis = {
    legibility,
    ocrText: str(r.ocrText),
    kind,
    kindReason: str(r.kindReason),
    complaintDate: validDate ? date : null,
    customerName: customerName || null,
    customerPhone: phone || null,
    customerEmail: isEmail(email) ? email.toLowerCase() : null,
    companyName: str(r.companyName) || null,
    hubspotContactId: hubspotId || null,
    summary: orUnknown(r.summary),
    category,
    subcategory,
    product,
    feature: orUnknown(r.feature),
    problemDescription: orUnknown(r.problemDescription),
    reportedImpact: orUnknown(r.reportedImpact),
    sentiment: oneOf(r.sentiment, SENTIMENTS, 'nao_identificado'),
    severity: oneOf(r.severity, SEVERITIES, 'nao_identificado'),
    severityReason: str(r.severityReason),
    evidence: (Array.isArray(r.evidence) ? r.evidence : []).map(String).map((s) => s.slice(0, 300)).slice(0, 3),
  };
  if (analysis.severity === 'nao_identificado') review.add('severity');
  if (!analysis.ocrText || legibility === 'ilegivel') review.add('ocrText');

  analysis.fieldsNeedingReview = [...review].filter((f) => f in analysis);
  analysis.needsReview = legibility !== 'legivel' || analysis.fieldsNeedingReview.length > 0;
  return analysis;
}

/** Análise fictícia — usada SOMENTE com DEMO_MODE=true e sempre marcada como demonstração. */
export function demoAnalysis(taxonomy) {
  const cat = taxonomy.categories[0];
  return {
    raw: {
      legibility: 'legivel',
      ocrText: '[DEMONSTRAÇÃO — texto fictício]\nCliente: Oi, de novo o sistema deu erro ao gerar o relatório do mês. Já é a terceira vez que abro chamado e estou com prazo para entregar ao meu cliente.\nSuporte: Entendo, vou verificar com o time técnico.',
      kind: 'reclamacao',
      kindReason: 'O cliente relata erro recorrente e demonstra insatisfação com a repetição.',
      conversationDate: new Date().toISOString().slice(0, 10),
      customerName: 'Cliente Demonstração',
      customerPhone: '(11) 99999-0001',
      customerEmail: null,
      companyName: 'Escritório Fictício Ltda',
      hubspotContactId: null,
      summary: 'Cliente relata erro recorrente ao gerar relatório mensal e insatisfação por já ter aberto chamados anteriores.',
      category: cat.name,
      subcategory: cat.subcategories[0],
      product: taxonomy.products[0] || UNIDENTIFIED,
      feature: 'Geração de relatório mensal',
      problemDescription: 'Erro ao gerar relatório; problema se repete após chamados anteriores.',
      reportedImpact: 'Risco de atrasar entrega ao cliente do escritório.',
      sentiment: 'insatisfeito',
      severity: 'alta',
      severityReason: 'Problema recorrente com prazo de entrega em risco.',
      evidence: ['já é a terceira vez que abro chamado', 'estou com prazo para entregar'],
      fieldsNeedingReview: [],
    },
    model: 'demo',
  };
}
