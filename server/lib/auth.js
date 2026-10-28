// Autenticação: o navegador faz login com Google pelo Firebase Auth e envia o
// ID token no cabeçalho Authorization. Aqui o token é verificado com o Admin SDK
// e o e-mail precisa ser do domínio permitido (ou estar na lista ALLOWED_EMAILS).
import { AppError, forbidden } from './http.js';
import { settings } from './config.js';

export async function authenticate(req, verifyIdToken) {
  const cfg = settings();
  if (cfg.demo) {
    return { email: 'demo@demonstracao.local', name: 'Usuário de demonstração', admin: true, demo: true };
  }
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = String(header).startsWith('Bearer ') ? String(header).slice(7) : null;
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Faça login para continuar.');

  let decoded;
  try {
    decoded = await verifyIdToken(token);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'UNAUTHENTICATED', 'Sessão expirada. Faça login novamente.');
  }
  const email = String(decoded.email || '').toLowerCase();
  if (!email || decoded.email_verified === false) throw forbidden('Conta sem e-mail verificado.');

  const domainOk = cfg.allowedDomain && email.endsWith('@' + cfg.allowedDomain.toLowerCase());
  const listOk = cfg.allowedEmails.includes(email);
  if (!domainOk && !listOk) throw forbidden(`Acesso restrito a contas @${cfg.allowedDomain}.`);

  const admin = cfg.adminEmails.length === 0 ? true : cfg.adminEmails.includes(email);
  return { email, name: decoded.name || email, admin, demo: false };
}

export function requireAdmin(user) {
  if (!user.admin) throw forbidden('Somente administradores podem fazer isso.');
}
