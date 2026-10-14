async function request(path, options) {
  const res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
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
  exportUrl: (id) => `/api/run/${id}/export?format=xlsx`,
  gtDefaults: () => request('/gt/defaults'),
  gtPlan: (payload) => post('/gt/plan', payload),
  gtGenerate: (payload) => post('/gt/generate', payload),
  gtGet: (id) => request(`/gt/${id}`),
  gtCancel: (id) => post(`/gt/${id}/cancel`),
  gtExportUrl: (id) => `/api/gt/${id}/export`,
  streamUrl: (id) => `/api/run/${id}/stream`,
};
