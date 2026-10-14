import ExcelJS from 'exceljs';

const RATING_COLORS = { Excellent: 'FFC6EFCE', Good: 'FFE2F0D9', Fair: 'FFFFEB9C', Poor: 'FFFFC7CE', Error: 'FFD9D9D9' };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

// Strings are written as plain string cells (never formulas), so no formula-injection risk.
export async function runToXlsx(run) {
  const m = run.metrics;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 28 }, { width: 24 }, { width: 14 }];
  const pct = (n) => Number((n / 100).toFixed(4));
  const rows = [
    ['Run started', run.startedAt],
    ['Status', run.status],
    ['Total rows', m.totalRows],
    ['Scored queries', m.scored],
    ['Errored (excluded)', m.errors],
    [],
    ['Top-10 hit rate', pct(m.hitRate)],
    ['Grade', m.grade],
    ['Hit@1', pct(m.hitAt1.pct), m.hitAt1.count],
    ['Hit@3', pct(m.hitAt3.pct), m.hitAt3.count],
    ['Hit@5', pct(m.hitAt5.pct), m.hitAt5.count],
    ['Hit@10', pct(m.hitAt10.pct), m.hitAt10.count],
    ['MRR@10', Number(m.mrr.toFixed(4))],
    [],
    ['Rank 1', m.distribution.rank1],
    ['Rank 2-3', m.distribution.rank2to3],
    ['Rank 4-10', m.distribution.rank4to10],
    ['Not in top 10', m.distribution.miss],
  ];
  rows.forEach((r) => sum.addRow(r));
  sum.getColumn(1).font = { bold: true };
  [7, 9, 10, 11, 12].forEach((r) => { sum.getCell(`B${r}`).numFmt = '0.0%'; });
  sum.getCell('B8').fill = fill(RATING_COLORS[m.grade] || 'FFFFFFFF');

  const ws = wb.addWorksheet('Results', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Query', key: 'query', width: 36 },
    { header: 'Expected', key: 'expected', width: 48 },
    { header: 'Rank', key: 'rank', width: 14 },
    { header: 'Hit@10', key: 'hit', width: 9 },
    { header: 'Rating', key: 'rating', width: 12 },
    { header: 'Status', key: 'status', width: 9 },
    { header: 'HTTP', key: 'http', width: 7 },
    { header: 'Latency (ms)', key: 'latency', width: 13 },
    { header: 'Error', key: 'error', width: 28 },
    ...Array.from({ length: 10 }, (_, i) => ({ header: `Result ${i + 1}`, key: `r${i + 1}`, width: 40 })),
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = fill('FF2F5BEA');
  for (const r of run.results) {
    const ok = r.status === 'ok';
    const row = ws.addRow({
      query: r.query, expected: r.expected, rank: ok ? (r.rank ?? 'Not in top 10') : '', hit: ok ? (r.hit ? 'TRUE' : 'FALSE') : '',
      rating: r.rating, status: r.status, http: r.httpStatus ?? '', latency: r.latencyMs ?? '', error: r.error ?? '',
      ...Object.fromEntries((r.results || []).map((x) => [`r${x.rank}`, x.value])),
    });
    row.getCell('rating').fill = fill(RATING_COLORS[r.rating] || 'FFFFFFFF');
    (r.results || []).filter((x) => x.isMatch).forEach((x) => { row.getCell(`r${x.rank}`).fill = fill('FFC6EFCE'); });
  }
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };
  return wb.xlsx.writeBuffer();
}
