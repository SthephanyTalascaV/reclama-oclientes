import { useState, type ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, TextSearch, Settings, LogOut, Menu, X, FlaskConical } from 'lucide-react';
import { useApp } from '../app-context';
import { logout } from '../lib/firebase';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/nova', label: 'Nova reclamação', icon: PlusCircle },
  { to: '/reclamacoes', label: 'Histórico', icon: TextSearch },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

export function DemoBanner() {
  const { health } = useApp();
  if (!health?.demo) return null;
  return (
    <div className="bg-amarelo text-petroleo text-xs sm:text-sm font-medium px-4 py-2 flex items-center justify-center gap-2 text-center">
      <FlaskConical className="size-4 shrink-0" />
      AMBIENTE DE DEMONSTRAÇÃO — todos os dados são fictícios. IA e HubSpot são simulados; nada é salvo de verdade.
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, health } = useApp();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors', isActive ? 'bg-white/12 text-white font-medium' : 'text-gelo hover:bg-white/8 hover:text-white')
          }
        >
          <Icon className="size-[18px]" /> {label}
        </NavLink>
      ))}
    </nav>
  );

  const userBox = user && (
    <div className="border-t border-white/10 pt-4 mt-4">
      <p className="text-sm text-white truncate">{user.name}</p>
      <p className="text-xs text-gelo/80 truncate">{user.email}</p>
      {!user.demo && (
        <button onClick={() => logout()} className="mt-3 inline-flex items-center gap-2 text-xs text-gelo hover:text-white">
          <LogOut className="size-3.5" /> Sair
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-full flex flex-col">
      <DemoBanner />
      <div className="flex flex-1 min-h-0">
        <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-petroleo px-4 py-6 sticky top-0 h-screen">
          <Link to="/" className="px-2 mb-8 block">
            <img src="/logo-principal-nibo-rgb-branco.png" alt="Nibo" className="h-7 w-auto" />
            <span className="block text-[11px] tracking-wide uppercase text-celeste mt-2 font-medium">Inteligência de Reclamações</span>
          </Link>
          {nav}
          <div className="mt-auto">
            {health && !health.demo && (!health.integrations.ai.configured || !health.integrations.hubspot.configured) && (
              <Link to="/configuracoes" className="block rounded-xl bg-white/8 p-3 text-xs text-gelo hover:bg-white/12">
                Algumas integrações ainda não estão configuradas. Ver status →
              </Link>
            )}
            {userBox}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="lg:hidden flex items-center justify-between bg-petroleo px-4 h-14 sticky top-0 z-30">
            <img src="/logo-principal-nibo-rgb-branco.png" alt="Nibo" className="h-6 w-auto" />
            <button aria-label="Abrir menu" onClick={() => setOpen(true)} className="text-white p-2">
              <Menu className="size-5" />
            </button>
          </header>
          {open && (
            <div className="lg:hidden fixed inset-0 z-40 bg-petroleo/40" onClick={() => setOpen(false)}>
              <div className="absolute right-0 top-0 h-full w-72 bg-petroleo p-5 flex flex-col" onClick={(e) => e.stopPropagation()}>
                <button aria-label="Fechar menu" onClick={() => setOpen(false)} className="self-end text-white p-1 mb-4"><X className="size-5" /></button>
                {nav}
                <div className="mt-auto">{userBox}</div>
              </div>
            </div>
          )}
          <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] w-full mx-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-petroleo tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
