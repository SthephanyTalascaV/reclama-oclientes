// Repositório Firebase: Firestore (dados) + Cloud Storage (prints).
// Todo acesso passa pelo backend com o Admin SDK; as regras do Firestore/Storage
// bloqueiam acesso direto do navegador (ver firestore.rules e storage.rules).
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { DEFAULT_TAXONOMY, env } from '../lib/config.js';
import { notConfigured } from '../lib/http.js';

const COL = {
  complaints: 'complaints',
  config: 'config',
};

export function firebaseConfigured() {
  return Boolean(env('FIREBASE_SERVICE_ACCOUNT_BASE64') || (env('FIREBASE_PROJECT_ID') && env('FIREBASE_CLIENT_EMAIL') && env('FIREBASE_PRIVATE_KEY')));
}

export function getFirebaseApp() {
  if (getApps().length) return getApps()[0];
  if (!firebaseConfigured()) {
    throw notConfigured('O Firebase (banco de dados)', ['FIREBASE_SERVICE_ACCOUNT_BASE64 (ou FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)', 'FIREBASE_STORAGE_BUCKET']);
  }
  let credential;
  if (env('FIREBASE_SERVICE_ACCOUNT_BASE64')) {
    const json = JSON.parse(Buffer.from(env('FIREBASE_SERVICE_ACCOUNT_BASE64'), 'base64').toString('utf8'));
    credential = cert(json);
  } else {
    credential = cert({
      projectId: env('FIREBASE_PROJECT_ID'),
      clientEmail: env('FIREBASE_CLIENT_EMAIL'),
      privateKey: env('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    });
  }
  return initializeApp({ credential, storageBucket: env('FIREBASE_STORAGE_BUCKET') });
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

export function createFirestoreRepo() {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const bucketName = env('FIREBASE_STORAGE_BUCKET');
  const bucket = () => {
    if (!bucketName) throw notConfigured('O armazenamento de imagens', ['FIREBASE_STORAGE_BUCKET']);
    return getStorage(app).bucket(bucketName);
  };
  const complaints = db.collection(COL.complaints);
  const toObj = (snap) => (snap.exists ? { id: snap.id, ...snap.data() } : null);

  return {
    kind: 'firestore',

    async getTaxonomy() {
      const ref = db.collection(COL.config).doc('taxonomy');
      const snap = await ref.get();
      if (snap.exists) return snap.data();
      await ref.set(DEFAULT_TAXONOMY);
      return structuredClone(DEFAULT_TAXONOMY);
    },
    async saveTaxonomy(t) {
      await db.collection(COL.config).doc('taxonomy').set(t);
      return t;
    },

    async createComplaint(doc) {
      const ref = doc.id ? complaints.doc(doc.id) : complaints.doc();
      // create() falha se o ID já existir — evita sobrescrever registro por engano
      await ref.create({ ...doc, id: ref.id });
      return ref.id;
    },
    async getComplaint(id) { return toObj(await complaints.doc(id).get()); },
    async updateComplaint(id, patch) {
      const ref = complaints.doc(id);
      await ref.update(patch);
      return toObj(await ref.get());
    },
    async deleteComplaint(id) {
      const hist = await complaints.doc(id).collection('history').listDocuments();
      const batch = db.batch();
      hist.forEach((d) => batch.delete(d));
      batch.delete(complaints.doc(id));
      await batch.commit();
    },
    async listComplaints({ limit = 5000 } = {}) {
      const snap = await complaints.orderBy('createdAt', 'desc').limit(limit).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async findByImageHash(hash) {
      const snap = await complaints.where('imageHashes', 'array-contains', hash).limit(5).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async findRelated({ contactId, phoneKey }) {
      const out = new Map();
      if (contactId) (await complaints.where('hubspot.contactId', '==', contactId).limit(50).get()).docs.forEach((d) => out.set(d.id, { id: d.id, ...d.data() }));
      if (phoneKey) (await complaints.where('phoneKey', '==', phoneKey).limit(50).get()).docs.forEach((d) => out.set(d.id, { id: d.id, ...d.data() }));
      return [...out.values()];
    },
    async addHistory(id, entry) {
      await complaints.doc(id).collection('history').add({ ...entry, serverAt: FieldValue.serverTimestamp() });
    },
    async listHistory(id) {
      const snap = await complaints.doc(id).collection('history').orderBy('at', 'desc').limit(200).get();
      return snap.docs.map((d) => {
        const { serverAt, ...rest } = d.data();
        return { id: d.id, ...rest };
      });
    },

    async putImage(path, buffer, mime) {
      await bucket().file(path).save(buffer, { contentType: mime, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
    },
    async signedImageUrl(path) {
      const file = bucket().file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 10 * 60 * 1000 });
      return url;
    },
    async deleteImage(path) {
      await bucket().file(path).delete({ ignoreNotFound: true });
    },
    async listComplaintsWithExpiredImages(nowIso) {
      const snap = await complaints.where('imagesExpireAt', '<=', nowIso).limit(200).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
  };
}
