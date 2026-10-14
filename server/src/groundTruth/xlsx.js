import ExcelJS from 'exceljs';

// Columns "Query" and "Expected" are detected automatically by the evaluator's sheet reader.
export async function gtToXlsx(job) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ground Truth', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Query', key: 'query', width: 48 },
    { header: 'Expected', key: 'expected', width: 60 },
    { header: 'URL', key: 'url', width: 60 },
    { header: 'Aggregation', key: 'aggregation', width: 36 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Doc ID', key: 'docId', width: 36 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5BEA' } };
  job.rows.forEach((r) => ws.addRow(r));
  ws.autoFilter = { from: 'A1', to: 'F1' };

  const info = wb.addWorksheet('Info');
  info.columns = [{ width: 22 }, { width: 100 }];
  const s = job.settings;
  [['Generated', job.startedAt], ['Mode', s.mode], ['Provider', s.provider], ['Model', s.model], ['Requested queries', s.count],
    ['Generated queries', job.rows.length], ['Skipped documents', job.skipped], ['Aggregations', s.aggregations?.length ? s.aggregations.join(' | ') : '(as in cURL)'], ['Prompt', s.prompt]]
    .forEach((r) => info.addRow(r));
  info.getColumn(1).font = { bold: true };
  info.getCell('B9').alignment = { wrapText: true, vertical: 'top' };
  return wb.xlsx.writeBuffer();
}
