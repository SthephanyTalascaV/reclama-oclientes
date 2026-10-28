// Login com Google pelo Firebase Auth (somente no navegador).
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, type Auth, type User } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const missingWebConfig = Object.entries({
  VITE_FIREBASE_API_KEY: config.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: config.authDomain,
  VITE_FIREBASE_PROJECT_ID: config.projectId,
  VITE_FIREBASE_APP_ID: config.appId,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function getFirebaseAuth(): Auth | null {
  if (missingWebConfig.length) return null;
  if (!app) {
    app = initializeApp(config);
    auth = getAuth(app);
  }
  return auth;
}

export async function loginWithGoogle(domain: string) {
  const a = getFirebaseAuth();
  if (!a) throw new Error('Firebase não configurado.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: domain, prompt: 'select_account' });
  await signInWithPopup(a, provider);
}

export async function logout() {
  const a = getFirebaseAuth();
  if (a) await signOut(a);
}

export function watchAuth(cb: (u: User | null) => void) {
  const a = getFirebaseAuth();
  if (!a) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(a, cb);
}

export async function currentIdToken(): Promise<string | null> {
  const a = getFirebaseAuth();
  return a?.currentUser ? a.currentUser.getIdToken() : null;
}
