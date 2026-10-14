// CSV export. Cells that start with a formula character are prefixed to avoid CSV injection.
const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function runToCsv(run) {
  const head = ['Query', 'Expected', 'Rank', 'Hit@10', 'Rating', 'Status', 'HTTP', 'Latency (ms)', 'Error', 'Top 10'];
  const lines = [head.map(cell).join(',')];
  for (const r of run.results) {
    lines.push([
      r.query, r.expected, r.status === 'ok' ? (r.rank ?? 'Not in top 10') : '', r.status === 'ok' ? r.hit : '',
      r.rating, r.status, r.httpStatus ?? '', r.latencyMs ?? '', r.error ?? '',
      (r.results || []).map((x) => `${x.rank}. ${x.value}`).join(' | '),
    ].map(cell).join(','));
  }
  return '﻿' + lines.join('\r\n');
}
