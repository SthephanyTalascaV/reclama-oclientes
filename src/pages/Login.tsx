import { useState } from 'react';
import { useApp } from '../app-context';
import { loginWithGoogle, logout } from '../lib/firebase';
import { Alert, Button } from '../components/ui';
import { DemoBanner } from '../components/Layout';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full flex flex-col">
      <DemoBanner />
      <div className="flex-1 grid lg:grid-cols-2">
        <div className="hidden lg:flex flex-col justify-between bg-petroleo text-white p-12 relative overflow-hidden">
          <img src="/logo-principal-nibo-rgb-branco.png" alt="Nibo" className="h-9 w-auto self-start relative" />
          <div className="relative">
            <p className="text-celeste text-sm font-medium uppercase tracking-wide">Sucesso do Cliente</p>
            <h1 className="text-4xl font-semibold leading-tight mt-3 max-w-md">Reclamações que viram dados para decidir.</h1>
            <p className="text-gelo mt-4 max-w-md">Envie o print da conversa, confira o que a IA extraiu, vincule ao cliente do HubSpot e acompanhe os problemas que mais se repetem.</p>
          </div>
          <p className="text-xs text-gelo/70 relative">Ferramenta interna · uso restrito ao time Nibo</p>
          <div aria-hidden className="absolute -right-32 -bottom-32 size-[480px] rounded-full bg-gradient-to-br from-roxo/60 via-nibo/40 to-celeste/30 blur-2xl" />
        </div>
        <div className="flex items-center justify-center p-6">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { health, authState, authError, bootError } = useApp();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const domain = health?.integrations.security.allowedDomain || 'nibo.com.br';

  const go = async () => {
    setErr(null);
    setLoading(true);
    try {
      await loginWithGoogle(domain);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setErr('Não foi possível entrar com o Google. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Frame>
      <img src="/logo-principal-nibo-rgb-azul.png" alt="Nibo" className="h-8 w-auto mb-8 lg:hidden" />
      <h2 className="text-2xl font-semibold text-petroleo">Entrar</h2>
      <p className="text-sm text-slate-500 mt-1 mb-6">Use sua conta Google @{domain}.</p>
      <div className="space-y-3">
        {bootError && <Alert tone="error" title="Não foi possível falar com o servidor">{bootError}</Alert>}
        {authState === 'denied' && (
          <Alert tone="error" title="Acesso negado" action={<Button size="sm" variant="secondary" onClick={() => logout()}>Trocar conta</Button>}>
            {authError}
          </Alert>
        )}
        {err && <Alert tone="error">{err}</Alert>}
        <Button size="lg" className="w-full" loading={loading} onClick={go}>Entrar com Google</Button>
      </div>
    </Frame>
  );
}

export function SetupPage({ missing }: { missing: string[] }) {
  return (
    <Frame>
      <h2 className="text-xl font-semibold text-petroleo">Configuração pendente</h2>
      <p className="text-sm text-slate-500 mt-1 mb-4">O login ainda não foi configurado. Defina estas variáveis (no <code>.env.local</code> ou na Vercel) e publique de novo:</p>
      <ul className="space-y-1 font-mono text-xs bg-white border border-linha rounded-xl p-4">
        {missing.map((m) => <li key={m}>{m}</li>)}
      </ul>
      <p className="text-xs text-slate-500 mt-4">Para testar sem configurar nada, rode <code>npm run dev:demo</code> (dados fictícios).</p>
    </Frame>
  );
}
