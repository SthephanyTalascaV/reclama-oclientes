// Erros, logs e utilidades HTTP compartilhadas pelo backend.
import { randomUUID } from 'node:crypto';

export class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} code  código estável que o frontend usa para escolher o estado de tela
   * @param {string} message  mensagem segura para o usuário (sem detalhes internos)
   * @param {object} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notConfigured = (what, envVars) =>
  new AppError(503, 'INTEGRATION_NOT_CONFIGURED', `${what} não está configurado. Defina: ${envVars.join(', ')}.`, { envVars });

export const badRequest = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details);
export const notFound = (message = 'Registro não encontrado.') => new AppError(404, 'NOT_FOUND', message);
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(403, 'FORBIDDEN', message);

/** Logger JSON em linha única (aparece formatado nos logs da Vercel). Nunca logar PII bruta. */
export function createLogger(requestId) {
  const base = { requestId };
  const write = (level, msg, extra) => {
    const line = JSON.stringify({ level, msg, ...base, ...extra, ts: new Date().toISOString() });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (process.env.LOG_LEVEL !== 'silent') console.log(line);
  };
  return {
    info: (msg, extra) => write('info', msg, extra),
    warn: (msg, extra) => write('warn', msg, extra),
    error: (msg, extra) => write('error', msg, extra),
  };
}

export const newRequestId = () => randomUUID().slice(0, 8);

const MAX_BODY_BYTES = 4 * 1024 * 1024; // abaixo do limite de 4,5 MB da Vercel

/** Lê o corpo JSON (funciona na Vercel, que já pode ter feito o parse, e no servidor local). */
export async function readJson(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') return safeParse(req.body);
  if (Buffer.isBuffer(req.body)) return safeParse(req.body.toString('utf8'));
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Arquivos grandes demais. Envie no máximo ~3 MB de imagens por vez.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return safeParse(Buffer.concat(chunks).toString('utf8'));
}

function safeParse(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('Corpo da requisição não é um JSON válido.');
  }
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
