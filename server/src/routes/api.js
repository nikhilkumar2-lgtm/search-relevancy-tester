import { Router } from 'express';
import { config } from '../config.js';
import { HttpError, asyncHandler } from '../utils/errors.js';
import { parseCurl } from '../services/curlParser.js';
import { readSheet, hasServiceAccount, writeResults } from '../services/sheets.js';
import { evaluateRow } from '../services/executor.js';
import { startRun, cancelRun, getActiveRun, snapshot } from '../services/runner.js';
import { assertRunId, listRuns, loadRun, saveRun } from '../services/store.js';
import { runToCsv } from '../services/exporter.js';
import { runToXlsx } from '../services/xlsxExporter.js';
import { previewSchema, runSchema, testSchema } from './schemas.js';

export const router = Router();

const getRun = async (id) => {
  assertRunId(id);
  const live = getActiveRun(id);
  const run = live ? snapshot(live) : await loadRun(id);
  if (!run) throw new HttpError(404, 'Run not found');
  return { run, live };
};

router.get('/health', (req, res) => res.json({ ok: true, authRequired: !!config.accessToken, googleMode: hasServiceAccount() ? 'service-account' : 'public-csv' }));

router.post('/sheet/preview', asyncHandler(async (req, res) => {
  const input = previewSchema.parse(req.body);
  const { rows, header, mode } = await readSheet(input);
  const seen = new Map();
  rows.forEach((r) => seen.set(r.query, (seen.get(r.query) || 0) + 1));
  res.json({
    mode, header, total: rows.length, rows: rows.slice(0, 10),
    duplicateQueries: [...seen.values()].filter((n) => n > 1).length,
    emptyExpected: rows.filter((r) => !r.expected).length,
  });
}));

// Run the template once for a single query and show what came back (helps pick the response path).
router.post('/test', asyncHandler(async (req, res) => {
  const cfg = testSchema.parse(req.body);
  const parsed = parseCurl(cfg.curl);
  const r = await evaluateRow({ sheetRow: 0, query: cfg.query, expected: '(test)' }, 0, parsed, cfg);
  res.json({ ...r, request: { method: parsed.method.toUpperCase(), url: parsed.url } });
}));

router.post('/run', asyncHandler(async (req, res) => {
  const cfg = runSchema.parse(req.body);
  const parsedCurl = parseCurl(cfg.curl);
  const { rows } = await readSheet(cfg.sheet);
  const run = startRun({ cfg, parsedCurl, rows, sheet: cfg.sheet });
  res.status(202).json({ runId: run.id, total: run.total });
}));

router.get('/runs', asyncHandler(async (req, res) => res.json(await listRuns())));

router.get('/run/:runId', asyncHandler(async (req, res) => {
  const { run } = await getRun(req.params.runId);
  res.json({ ...run, results: run.results.filter(Boolean) });
}));

router.post('/run/:runId/cancel', asyncHandler(async (req, res) => {
  assertRunId(req.params.runId);
  res.json({ cancelled: cancelRun(req.params.runId) });
}));

router.post('/run/:runId/writeback', asyncHandler(async (req, res) => {
  const { run, live } = await getRun(req.params.runId);
  if (run.status === 'running') throw new HttpError(409, 'Run is still in progress');
  const tab = await writeResults(run.sheet, run.results);
  run.writeBack = { ok: true, tab };
  if (live) live.writeBack = run.writeBack;
  await saveRun(run);
  res.json(run.writeBack);
}));

// Excel by default; ?format=csv still returns CSV.
router.get('/run/:runId/export', asyncHandler(async (req, res) => {
  const { run } = await getRun(req.params.runId);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relevancy-${run.id}.csv"`);
    return res.send(runToCsv(run));
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="relevancy-${run.id}.xlsx"`);
  res.send(Buffer.from(await runToXlsx(run)));
}));

// Server-Sent Events. No compression middleware is used anywhere, so events are never buffered.
router.get('/run/:runId/stream', asyncHandler(async (req, res) => {
  const { run, live } = await getRun(req.params.runId);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('snapshot', { total: run.total, completed: run.completed ?? run.results.length, status: run.status, results: run.results.filter(Boolean), metrics: run.metrics });
  if (!live || run.status !== 'running') {
    send('done', { status: run.status, metrics: run.metrics, writeBack: run.writeBack ?? null, error: run.error ?? null });
    return res.end();
  }

  const onProgress = (p) => send('progress', p);
  const onDone = (d) => { send('done', d); cleanup(); res.end(); };
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
  const cleanup = () => {
    clearInterval(heartbeat);
    live.emitter.off('progress', onProgress);
    live.emitter.off('done', onDone);
  };
  live.emitter.on('progress', onProgress);
  live.emitter.on('done', onDone);
  req.on('close', cleanup); // closing the stream does not cancel the run
}));
