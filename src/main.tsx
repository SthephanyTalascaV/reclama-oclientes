import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { AppProvider, useApp } from './app-context';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage, SetupPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { NewComplaintPage } from './pages/NewComplaint';
import { HistoryPage } from './pages/History';
import { ComplaintDetailPage } from './pages/ComplaintDetail';
import { SettingsPage } from './pages/Settings';
import { missingWebConfig } from './lib/firebase';

function Shell() {
  const { health, authState, taxonomy, bootError } = useApp();

  if (!health && !bootError) return <div className="h-full grid place-items-center"><Spinner label="Iniciando…" /></div>;
  if (health && !health.demo && missingWebConfig.length) return <SetupPage missing={missingWebConfig} />;
  if (authState === 'loading') return <div className="h-full grid place-items-center"><Spinner label="Verificando sessão…" /></div>;
  if (authState !== 'signed-in' || !taxonomy) return <LoginPage />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/nova" element={<NewComplaintPage />} />
        <Route path="/reclamacoes" element={<HistoryPage />} />
        <Route path="/reclamacoes/:id" element={<ComplaintDetailPage />} />
        <Route path="/configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Shell />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
