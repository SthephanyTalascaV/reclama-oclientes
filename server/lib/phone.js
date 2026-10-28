// Normalização de telefones brasileiros.
//
// Por que existe: no HubSpot do Nibo o mesmo número aparece em formatos
// diferentes ("+5551995010911", "+55-61-99666-7677", "16991581859") e o campo
// de WhatsApp às vezes vem SEM o nono dígito ("+555195010911").
// Por isso a chave de comparação é DDD + últimos 8 dígitos: ela é igual para
// o número com e sem o 9 extra e independe de pontuação e código do país.

/** Remove tudo que não for dígito. */
export function digitsOnly(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

/**
 * Normaliza um telefone brasileiro.
 * @param {string|null|undefined} raw
 * @returns {{ raw: string, digits: string, ddd: string|null, local: string|null,
 *   key: string|null, last8: string|null, national: string|null, e164: string|null,
 *   valid: boolean }}
 */
export function normalizeBrPhone(raw) {
  const original = String(raw ?? '').trim();
  let d = digitsOnly(original);
  const empty = { raw: original, digits: d, ddd: null, local: null, key: null, last8: null, national: null, e164: null, valid: false };
  if (!d) return empty;

  // Prefixo internacional "00" e código do país 55
  if (d.startsWith('00')) d = d.slice(2);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  // Prefixo de operadora / tronco: 0 + (opcional 2 dígitos de operadora) + DDD
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  else if ((d.length === 13 || d.length === 14) && d.startsWith('0')) d = d.slice(3); // 0 + XX operadora + DDD + número

  if (d.length === 10 || d.length === 11) {
    const ddd = d.slice(0, 2);
    const local = d.slice(2);
    // DDDs brasileiros vão de 11 a 99 e nunca têm o dígito 0.
    if (ddd.includes('0')) {
      return { ...empty, digits: d, last8: d.slice(-8) };
    }
    const last8 = local.slice(-8);
    return {
      raw: original,
      digits: d,
      ddd,
      local,
      key: ddd + last8,
      last8,
      national: ddd + local,
      e164: '+55' + ddd + local,
      valid: true,
    };
  }

  // Sem DDD (8 ou 9 dígitos): dá para buscar, mas o vínculo é mais fraco.
  if (d.length === 8 || d.length === 9) {
    return { ...empty, digits: d, local: d, last8: d.slice(-8) };
  }

  return { ...empty, digits: d };
}

/** Compara dois telefones pela chave DDD + últimos 8 dígitos. */
export function samePhone(a, b) {
  const na = normalizeBrPhone(a);
  const nb = normalizeBrPhone(b);
  if (na.key && nb.key) return na.key === nb.key;
  return false;
}

/** Mascara o telefone para logs técnicos (LGPD): mantém só os 4 últimos. */
export function maskPhone(raw) {
  const d = digitsOnly(raw);
  if (d.length < 4) return '***';
  return '*'.repeat(Math.max(0, d.length - 4)) + d.slice(-4);
}

/** Formata para exibição: (51) 99501-0911 */
export function formatBrPhone(raw) {
  const n = normalizeBrPhone(raw);
  if (!n.valid) return String(raw ?? '');
  const l = n.local;
  const head = l.length === 9 ? l.slice(0, 5) : l.slice(0, 4);
  return `(${n.ddd}) ${head}-${l.slice(head.length)}`;
}
