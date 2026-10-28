import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrPhone, samePhone } from '../server/lib/phone.js';
import { personNameSimilarity } from '../server/lib/text.js';
import { scoreCandidates } from '../server/lib/hubspot.js';
import { sanitizeAnalysis } from '../server/lib/ai.js';
import { DEFAULT_TAXONOMY } from '../server/lib/config.js';

// Formatos reais observados no HubSpot do Nibo (números fictícios na mesma forma)
test('telefone: formatos variados geram a mesma chave', () => {
  const k = normalizeBrPhone('+5551995010911').key;
  assert.equal(k, '5195010911');
  assert.equal(normalizeBrPhone('+555195010911').key, k, 'WhatsApp sem o nono dígito');
  assert.equal(normalizeBrPhone('(51) 99501-0911').key, k);
  assert.equal(normalizeBrPhone('51 99501 0911').key, k);
  assert.equal(normalizeBrPhone('051995010911').key, k, 'com zero de tronco');
  assert.equal(normalizeBrPhone('+55-61-99666-7677').key, '6196667677');
  assert.equal(normalizeBrPhone('16991581859').e164, '+5516991581859');
});

test('telefone: entradas sem DDD ou inválidas não geram chave', () => {
  assert.equal(normalizeBrPhone('99501-0911').key, null);
  assert.equal(normalizeBrPhone('99501-0911').last8, '95010911');
  assert.equal(normalizeBrPhone('').valid, false);
  assert.equal(normalizeBrPhone('123').key, null);
  assert.equal(normalizeBrPhone('0099501091').key, null, 'DDD com zero é inválido');
  assert.equal(samePhone('(21) 97680-7935', '+5521976807935'), true);
  assert.equal(samePhone('(21) 97680-7935', '+5511976807935'), false, 'DDD diferente');
});

test('nome: similaridade', () => {
  assert.equal(personNameSimilarity('Priscila Alves de Oliveira', 'PRISCILA ALVES DE OLIVEIRA'), 1);
  assert.equal(personNameSimilarity('Priscila Oliveira', 'Priscila Alves de Oliveira'), 1);
  assert.equal(personNameSimilarity('Priscila', 'Priscila Alves'), 0.4);
  assert.equal(personNameSimilarity('João', 'Maria'), 0);
});

const cand = (id, name, phones, email = null) => ({ contactId: id, name, email, phones, companyProp: null, companies: [] });

test('match: telefone único → confiável', () => {
  const r = scoreCandidates({ phone: '(51) 99501-0911', name: 'Eleandro' }, [cand('1', 'Eleandro Martins', ['+5551995010911'])]);
  assert.equal(r.decision, 'confiavel');
  assert.equal(r.suggestedContactId, '1');
});

test('match: dois contatos com o mesmo telefone → ambíguo, nunca vincula sozinho', () => {
  // caso real: dois contatos distintos compartilham o mesmo número
  const r = scoreCandidates({ phone: '(51) 99501-0911', name: 'Eleandro' }, [
    cand('1', 'Eleandro Martins', ['+5551995010911']),
    cand('2', 'Giuliano', ['+5551995010911', '+555195010911']),
  ]);
  assert.equal(r.decision, 'ambiguo');
  assert.equal(r.suggestedContactId, null);
});

test('match: nome completo desempata quando o telefone é compartilhado', () => {
  const r = scoreCandidates({ phone: '(51) 99501-0911', name: 'Eleandro Martins' }, [
    cand('1', 'Eleandro Martins', ['+5551995010911']),
    cand('2', 'Giuliano', ['+5551995010911']),
  ]);
  assert.equal(r.decision, 'confiavel');
  assert.equal(r.suggestedContactId, '1');
});

test('match: só nome → "possível", exige confirmação', () => {
  const r = scoreCandidates({ name: 'Ana Paula Souza' }, [cand('9', 'Ana Paula Souza', [])]);
  assert.equal(r.decision, 'possivel');
  assert.equal(r.suggestedContactId, null);
});

test('match: e-mail exato vence; sem dados → sem correspondência', () => {
  assert.equal(scoreCandidates({ email: 'a@b.com' }, [cand('3', 'X', [], 'A@B.com')]).decision, 'confiavel');
  assert.equal(scoreCandidates({ name: 'Fulano' }, [cand('3', 'Beltrano', [])]).decision, 'sem_correspondencia');
});

test('IA: saída fora da taxonomia vira "Revisão necessária"/"Não identificado"', () => {
  const a = sanitizeAnalysis({
    legibility: 'legivel', ocrText: 'texto', kind: 'reclamacao', summary: 'x',
    category: 'Categoria inventada', subcategory: 'Sub', product: 'Produto X',
    sentiment: 'furioso', severity: 'gravissima', customerPhone: '123', customerEmail: 'nao-email',
    conversationDate: '2999-01-01', evidence: [], fieldsNeedingReview: [],
  }, DEFAULT_TAXONOMY);
  assert.equal(a.category, 'Revisão necessária');
  assert.equal(a.subcategory, 'Revisão necessária');
  assert.equal(a.product, 'Não identificado');
  assert.equal(a.sentiment, 'nao_identificado');
  assert.equal(a.severity, 'nao_identificado');
  assert.equal(a.customerEmail, null);
  assert.equal(a.complaintDate, null, 'data futura descartada');
  assert.ok(a.needsReview);
  assert.ok(a.fieldsNeedingReview.includes('customerPhone'));
});

test('IA: saída válida é preservada', () => {
  const cat = DEFAULT_TAXONOMY.categories[1];
  const a = sanitizeAnalysis({
    legibility: 'legivel', ocrText: 'Cliente: demora...', kind: 'reclamacao', summary: 'Demora no retorno',
    category: cat.name, subcategory: cat.subcategories[0], product: DEFAULT_TAXONOMY.products[0],
    feature: 'Chat', problemDescription: 'p', reportedImpact: 'i', sentiment: 'insatisfeito', severity: 'media',
    customerName: 'Maria Lima', customerPhone: '(11) 98888-7777', conversationDate: '2026-10-01', evidence: ['a'], fieldsNeedingReview: [],
  }, DEFAULT_TAXONOMY);
  assert.equal(a.category, cat.name);
  assert.equal(a.complaintDate, '2026-10-01');
  assert.equal(a.needsReview, false);
});
