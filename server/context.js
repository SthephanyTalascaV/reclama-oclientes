// Monta as dependências reais da aplicação (uma vez por instância).
import { createApp } from './app.js';
import { isDemoMode } from './lib/config.js';
import { createMemoryRepo } from './repo/memory.js';
import { seedDemo } from './demo-seed.js';

let repoPromise = null;

async function getRepo() {
  if (!repoPromise) {
    repoPromise = (async () => {
      if (isDemoMode()) {
        const repo = createMemoryRepo();
        await seedDemo(repo);
        return repo;
      }
      const { createFirestoreRepo } = await import('./repo/firestore.js');
      return createFirestoreRepo();
    })().catch((err) => {
      repoPromise = null; // permite nova tentativa depois de configurar
      throw err;
    });
  }
  return repoPromise;
}

async function verifyIdToken(token) {
  const { getFirebaseAuth } = await import('./repo/firestore.js');
  return getFirebaseAuth().verifyIdToken(token, true);
}

export const handler = createApp({ getRepo, verifyIdToken });
