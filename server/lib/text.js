// Utilidades de texto: normalização de nomes e similaridade.

/** minúsculas, sem acentos, sem pontuação, espaços colapsados */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'ltda', 'me', 'eireli', 'sa', 's', 'a', 'epp']);

/** tokens significativos de um nome */
export function nameTokens(value) {
  return normalizeText(value)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Similaridade de nome de pessoa em 0..1.
 * 1 = todos os tokens do nome menor aparecem no maior e o primeiro nome bate.
 */
export function personNameSimilarity(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const firstMatch = ta[0] === tb[0];
  const shared = small.filter((t) => big.includes(t)).length;
  if (!firstMatch && shared === 0) return 0;
  const coverage = shared / small.length;
  if (firstMatch && coverage === 1 && small.length >= 2) return 1;
  if (firstMatch && small.length === 1) return 0.4; // só o primeiro nome
  return Math.min(0.9, 0.3 * (firstMatch ? 1 : 0) + 0.6 * coverage);
}

/** Similaridade de nome de empresa (Jaccard de tokens) em 0..1. */
export function companyNameSimilarity(a, b) {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Tokens para busca textual simples no histórico. */
export function searchTokens(...values) {
  const set = new Set();
  for (const v of values) {
    for (const t of normalizeText(v).split(' ')) if (t.length >= 2) set.add(t);
  }
  return [...set].slice(0, 400);
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}
