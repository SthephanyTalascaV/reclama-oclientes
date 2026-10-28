// Cliente da API. Envia o token do Firebase em todas as chamadas.
import { currentIdToken } from './firebase';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: any;
  requestId?: string;
  constructor(status: number, code: string, message: string, details?: any, requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

async function headers(json = true): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const token = await currentIdToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method || 'GET',
      headers: await headers(init.body !== undefined),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* resposta não-JSON */
  }
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code || 'HTTP_' + res.status, e?.message || `Erro ${res.status} no servidor.`, e?.details, e?.requestId);
  }
  return json as T;
}

export function qs(params: Record<string, string | number | undefined | null | boolean>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function downloadFile(path: string, filename: string) {
  const res = await fetch(path, { headers: await headers(false) });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD', 'Não foi possível exportar.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
