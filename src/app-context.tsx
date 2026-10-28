import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './lib/api';
import { watchAuth } from './lib/firebase';
import type { Health, Taxonomy, User } from './lib/types';

interface Ctx {
  health: Health | null;
  user: User | null;
  taxonomy: Taxonomy | null;
  authState: 'loading' | 'signed-out' | 'signed-in' | 'denied';
  authError: string | null;
  bootError: string | null;
  reloadTaxonomy: () => Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [authState, setAuthState] = useState<Ctx['authState']>('loading');
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const reloadTaxonomy = useCallback(async () => {
    setTaxonomy(await api<Taxonomy>('/api/taxonomy'));
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const me = await api<User>('/api/me');
      setUser(me);
      await reloadTaxonomy();
      setAuthState('signed-in');
      setAuthError(null);
    } catch (err) {
      const e = err as ApiError;
      setUser(null);
      if (e.status === 403) {
        setAuthState('denied');
        setAuthError(e.message);
      } else if (e.status === 401) {
        setAuthState('signed-out');
      } else {
        setBootError(e.message);
        setAuthState('signed-out');
      }
    }
  }, [reloadTaxonomy]);

  useEffect(() => {
    let unsub = () => {};
    api<Health>('/api/health')
      .then((h) => {
        setHealth(h);
        if (h.demo) {
          loadSession();
          return;
        }
        unsub = watchAuth((fbUser) => {
          if (fbUser) loadSession();
          else {
            setUser(null);
            setAuthState('signed-out');
          }
        });
      })
      .catch((e: ApiError) => {
        setBootError(e.message);
        setAuthState('signed-out');
      });
    return () => unsub();
  }, [loadSession]);

  return (
    <AppCtx.Provider value={{ health, user, taxonomy, authState, authError, bootError, reloadTaxonomy }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fora do AppProvider');
  return c;
}

/** Taxonomia garantida (só use dentro das páginas autenticadas). */
export function useTaxonomy(): Taxonomy {
  const { taxonomy } = useApp();
  if (!taxonomy) throw new Error('Taxonomia ainda não carregada');
  return taxonomy;
}
