// Repositório em memória — usado no modo DEMONSTRAÇÃO e nos testes automatizados.
// Os dados somem quando o processo reinicia.
import { randomUUID } from 'node:crypto';
import { DEFAULT_TAXONOMY } from '../lib/config.js';

const clone = (v) => (v === undefined ? v : structuredClone(v));

export function createMemoryRepo() {
  const complaints = new Map();
  const history = new Map();
  const files = new Map();
  let taxonomy = clone(DEFAULT_TAXONOMY);

  return {
    kind: 'memory',
    async getTaxonomy() { return clone(taxonomy); },
    async saveTaxonomy(t) { taxonomy = clone(t); return clone(taxonomy); },

    async createComplaint(doc) {
      const id = doc.id || randomUUID();
      complaints.set(id, clone({ ...doc, id }));
      return id;
    },
    async getComplaint(id) { return clone(complaints.get(id)) || null; },
    async updateComplaint(id, patch) {
      const cur = complaints.get(id);
      if (!cur) return null;
      const next = { ...cur, ...clone(patch) };
      complaints.set(id, next);
      return clone(next);
    },
    async deleteComplaint(id) { complaints.delete(id); history.delete(id); },
    async listComplaints({ limit = 5000 } = {}) {
      return [...complaints.values()]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit)
        .map(clone);
    },
    async findByImageHash(hash) {
      return [...complaints.values()].filter((c) => (c.imageHashes || []).includes(hash)).map(clone);
    },
    async findRelated({ contactId, phoneKey }) {
      return [...complaints.values()]
        .filter((c) => (contactId && c.hubspot?.contactId === contactId) || (phoneKey && c.phoneKey === phoneKey))
        .map(clone);
    },
    async addHistory(id, entry) {
      const list = history.get(id) || [];
      list.push(clone({ id: randomUUID(), ...entry }));
      history.set(id, list);
    },
    async listHistory(id) {
      return clone(history.get(id) || []).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    },

    // "Storage" em memória
    async putImage(path, buffer, mime) { files.set(path, { buffer, mime }); },
    async signedImageUrl(path) {
      const f = files.get(path);
      return f ? `data:${f.mime};base64,${f.buffer.toString('base64')}` : null;
    },
    async deleteImage(path) { files.delete(path); },
    async listComplaintsWithExpiredImages(nowIso) {
      return [...complaints.values()]
        .filter((c) => c.imagesExpireAt && c.imagesExpireAt <= nowIso)
        .map(clone);
    },
  };
}
