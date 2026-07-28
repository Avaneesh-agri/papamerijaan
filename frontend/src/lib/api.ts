// API client. The backend lives on a separate host — set it in public/config.js
// (runtime) or the VITE_API_URL environment variable (build time).
declare global {
  interface Window { APP_CONFIG?: { API_URL?: string } }
}

export const API_BASE = (
  (window.APP_CONFIG?.API_URL && window.APP_CONFIG.API_URL.trim()) ||
  (import.meta as any).env?.VITE_API_URL ||
  'http://localhost:4000'
).replace(/\/+$/, '');

export function getToken() { return localStorage.getItem('asscher_token'); }
export function setToken(t: string | null) {
  if (t) localStorage.setItem('asscher_token', t);
  else localStorage.removeItem('asscher_token');
}

export class ApiError extends Error {
  status: number; code?: string;
  constructor(msg: string, status: number, code?: string) { super(msg); this.status = status; this.code = code; }
}

let onSessionRevoked: ((msg: string) => void) | null = null;
export function setSessionRevokedHandler(fn: (msg: string) => void) { onSessionRevoked = fn; }

export async function api(path: string, opts: { method?: string; body?: any; formData?: FormData } = {}) {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}/api${path}`, {
    method: opts.method || (opts.body !== undefined || opts.formData ? 'POST' : 'GET'),
    headers,
    body: opts.formData ? opts.formData : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json();
  if (!res.ok) {
    const msg = data?.error || `Request failed (${res.status})`;
    if (res.status === 401 && data?.code === 'SESSION_REVOKED' && onSessionRevoked) onSessionRevoked(msg);
    throw new ApiError(msg, res.status, data?.code);
  }
  return data;
}

/** Upload one file (10 MB max) → {id, name, size, mime} */
export async function uploadFile(file: File, scope = 'GENERAL') {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('scope', scope);
  const data = await api('/files', { formData: fd });
  return data.file as { id: string; name: string; size: number; mime: string };
}

/** Open/download a stored file using the session token. */
export async function openFile(id: string, download = false) {
  const res = await fetch(`${API_BASE}/api/files/${id}${download ? '?download=1' : ''}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError('Could not open file', res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Download an authenticated endpoint (PDF/CSV) to the browser. */
export async function downloadUrl(path: string, filename: string) {
  const res = await fetch(`${API_BASE}/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError('Download failed', res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
