import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { computeMetrics } from '../../../shared/metrics.js';
import { describeCurl } from '../utils/redact.js';
import { evaluateRow, rerank, sleep } from './executor.js';
import { saveRun } from './store.js';
import { writeResults } from './sheets.js';

const active = new Map(); // runId -> live run state

export const getActiveRun = (id) => active.get(id);

export function snapshot(run) {
  const { emitter, controller, ...rest } = run;
  return rest;
}

export function startRun({ cfg, parsedCurl, rows, sheet }) {
  const run = {
    id: randomUUID(),
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: rows.length,
    completed: 0,
    sheet: { sheet: sheet.sheet, tab: sheet.tab || '' },
    // Stored config never contains the raw cURL (it holds cookies / tokens).
    config: { ...cfg, curl: undefined, request: describeCurl(parsedCurl) },
    results: new Array(rows.length).fill(null),
    metrics: computeMetrics([], cfg.thresholds),
    writeBack: null,
    emitter: new EventEmitter(),
    controller: new AbortController(),
  };
  run.emitter.setMaxListeners(100);
  active.set(run.id, run);
  execute(run, rows, parsedCurl, cfg).catch((e) => finish(run, 'failed', e.message));
  return run;
}

export function cancelRun(id) {
  const run = active.get(id);
  if (!run || run.status !== 'running') return false;
  run.controller.abort();
  return true;
}

async function execute(run, rows, parsedCurl, cfg) {
  const { signal } = run.controller;
  const cache = new Map(); // duplicate queries within a run share one HTTP request
  let next = 0;

  const worker = async () => {
    while (!signal.aborted) {
      const i = next++;
      if (i >= rows.length) return;
      const row = rows[i];
      // Duplicate queries share one HTTP request; rows with an empty query/expected are never cached.
      const key = row.query.trim() && row.expected.trim() ? row.query.trim() : null;
      let pending = key && cache.get(key);
      const reused = !!pending;
      if (!pending) {
        pending = (async () => {
          await sleep(cfg.delayMs, signal);
          return evaluateRow(row, i, parsedCurl, cfg, signal);
        })();
        if (key) cache.set(key, pending);
      }
      let res = await pending;
      if (signal.aborted && res.status === 'error' && res.error === 'Cancelled') return;
      if (reused) res = rerank(res, row, i, cfg);
      run.results[i] = res;
      run.completed++;
      const done = run.results.filter(Boolean);
      run.metrics = computeMetrics(done, cfg.thresholds);
      run.emitter.emit('progress', {
        index: i, completed: run.completed, total: run.total, query: res.query, expected: res.expected,
        rank: res.rank, hit: res.hit, status: res.status, rating: res.rating, error: res.error,
        httpStatus: res.httpStatus, latencyMs: res.latencyMs, results: res.results,
        runningHitRate: run.metrics.hitRate,
      });
    }
  };

  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, rows.length) }, worker));
  await finish(run, signal.aborted ? 'cancelled' : 'completed');
}

async function finish(run, status, error) {
  if (run.status !== 'running') return;
  run.results = run.results.filter(Boolean);
  run.status = status;
  run.error = error || null;
  run.finishedAt = new Date().toISOString();
  run.metrics = computeMetrics(run.results, run.config.thresholds);
  if (run.config.writeBack && status === 'completed') {
    try {
      run.writeBack = { ok: true, tab: await writeResults(run.sheet, run.results) };
    } catch (e) {
      run.writeBack = { ok: false, error: e.message };
    }
  }
  try {
    await saveRun(snapshot(run));
  } catch (e) {
    console.error('Failed to save run:', e.message);
  }
  run.emitter.emit('done', { status, metrics: run.metrics, writeBack: run.writeBack, error: run.error });
  setTimeout(() => active.delete(run.id), 60_000).unref();
}
