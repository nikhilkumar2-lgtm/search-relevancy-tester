// VITE_API_URL points at the Render API when the UI is hosted elsewhere (Netlify); empty = same origin / dev proxy.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const getToken = () => localStorage.getItem('rel.token') || '';
export const setToken = (t) => (t ? localStorage.setItem('rel.token', t) : localStorage.removeItem('rel.token'));
// Download / EventSource URLs cannot send headers, so the token travels as a query parameter.
const withToken = (url) => (getToken() ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken())}` : url);

async function request(path, options) {
  const headers = { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) };
  const res = await fetch(`${BASE}/api${path}`, { headers, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = body.details ? ` (${body.details.join('; ')})` : '';
    throw new Error((body.error || `Request failed (${res.status})`) + details);
  }
  return body;
}
const post = (path, data) => request(path, { method: 'POST', body: JSON.stringify(data ?? {}) });

export const api = {
  health: () => request('/health'),
  previewSheet: (sheet) => post('/sheet/preview', sheet),
  testQuery: (payload) => post('/test', payload),
  startRun: (payload) => post('/run', payload),
  cancelRun: (id) => post(`/run/${id}/cancel`),
  getRun: (id) => request(`/run/${id}`),
  listRuns: () => request('/runs'),
  writeBack: (id) => post(`/run/${id}/writeback`),
  exportUrl: (id) => withToken(`${BASE}/api/run/${id}/export?format=xlsx`),
  gtDefaults: () => request('/gt/defaults'),
  gtPlan: (payload) => post('/gt/plan', payload),
  gtGenerate: (payload) => post('/gt/generate', payload),
  gtGet: (id) => request(`/gt/${id}`),
  gtCancel: (id) => post(`/gt/${id}/cancel`),
  gtExportUrl: (id) => withToken(`${BASE}/api/gt/${id}/export`),
  streamUrl: (id) => withToken(`${BASE}/api/run/${id}/stream`),
};
