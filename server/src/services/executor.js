import axios from 'axios';
import { config } from '../config.js';
import http from 'node:http';
import https from 'node:https';
import { buildRequest } from '../../../shared/queryReplace.js';
import { debugOutcome, debugRequest, toCurl } from '../utils/debug.js';
import { ratingForRank } from '../../../shared/metrics.js';
import { extractResults, findRank, getByPath, valuesMatch, cleanText } from '../../../shared/matcher.js';

// IPv4-only agents avoid dual-stack DNS / happy-eyeballs problems.
const httpAgent = new http.Agent({ family: 4, keepAlive: true });
const httpsAgent = new https.Agent({ family: 4, keepAlive: true });

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

const TITLE_FIELDS = ['highlight.TitleToDisplayString', 'title', 'name', 'objName', '_source.title', '_source.name', 'highlight.title', 'label'];
const str = (v) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.map(str).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

function summarize(items, cfg) {
  return items.map((item, i) => {
    const value = cfg.matchField ? getByPath(item, cfg.matchField) : item;
    let title = '';
    for (const f of cfg.displayField ? [cfg.displayField] : TITLE_FIELDS) {
      title = str(getByPath(item, f));
      if (title) break;
    }
    return { rank: i + 1, value: str(value).slice(0, 500), title: cleanText(title).slice(0, 300) };
  });
}

async function fetchOnce(req, cfg, signal) {
  return axios.request({
    method: req.method,
    url: req.url,
    headers: req.headers,
    data: req.data,
    timeout: cfg.timeoutMs,
    signal,
    httpAgent,
    httpsAgent,
    validateStatus: () => true,
    maxContentLength: 20 * 1024 * 1024,
  });
}

/** Sends the request with retries; 429 (and 5xx / network errors) back off exponentially. */
export async function fetchWithRetry(req, cfg, signal) {
  let last;
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    if (signal?.aborted) throw new Error('Cancelled');
    const started = Date.now();
    let status = null;
    let retryAfter = NaN;
    try {
      const res = await fetchOnce(req, cfg, signal);
      status = res.status;
      last = { res, latencyMs: Date.now() - started };
      if (res.status < 400) return last;
      if (res.status !== 429 && res.status < 500) return last; // client error: do not retry
      retryAfter = Number(res.headers?.['retry-after']);
    } catch (e) {
      if (signal?.aborted) throw new Error('Cancelled');
      last = { error: e.code === 'ECONNABORTED' ? `Timeout after ${cfg.timeoutMs} ms` : `Network error: ${e.code || e.message}`, latencyMs: Date.now() - started };
    }
    if (attempt < cfg.retries) {
      const backoff = status === 429 && retryAfter > 0 ? retryAfter * 1000 : Math.min(500 * 2 ** attempt, 15000) * (status === 429 ? 2 : 1);
      await sleep(backoff, signal);
    }
  }
  return last;
}

/** Evaluates one row. Never throws; returns a result record. */
export async function evaluateRow(row, index, parsedCurl, cfg, signal) {
  const base = { index, sheetRow: row.sheetRow, query: row.query, expected: row.expected, rank: null, hit: false, rating: 'Poor', status: 'ok', httpStatus: null, latencyMs: null, error: null, results: [] };
  const fail = (error, extra = {}) => ({ ...base, status: 'error', rating: 'Error', error, ...extra });

  if (!row.query.trim()) return fail('Empty query');
  if (!row.expected.trim()) return fail('Empty expected value');

  let req;
  try {
    req = buildRequest(parsedCurl, row.query, cfg);
  } catch (e) {
    return fail(e.message);
  }

  debugRequest(row, req);
  let out;
  try {
    out = await fetchWithRetry(req, cfg, signal);
  } catch (e) {
    return fail(e.message);
  }
  if (out.error) return fail(out.error, { latencyMs: out.latencyMs });
  const { res, latencyMs } = out;
  if (res.status >= 400 && config.debug) console.log(`[debug] HTTP ${res.status} body: ${String(typeof res.data === 'string' ? res.data : JSON.stringify(res.data)).slice(0, 500)}`);
  if (res.status >= 400) return fail(`HTTP ${res.status}${res.status === 429 ? ' (rate limited)' : ''}`, { httpStatus: res.status, latencyMs });

  let items;
  try {
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    items = extractResults(data, cfg.responsePath, 10);
  } catch (e) {
    return fail(e instanceof SyntaxError ? 'Response is not valid JSON' : e.message, { httpStatus: res.status, latencyMs });
  }
  const rank = findRank(items, row.expected, cfg);
  debugOutcome(row, items, cfg, rank, res.status);
  const results = summarize(items, cfg).map((r) => ({ ...r, isMatch: r.rank === rank }));
  return { ...base, rank, hit: rank !== null, rating: ratingForRank(rank), httpStatus: res.status, latencyMs, results, ...(row.sheetRow === 0 ? { curl: toCurl(req) } : {}) };
}

/** Re-uses a cached evaluation of the same query, re-ranked against this row's expected value. */
export function rerank(cached, row, index, cfg) {
  if (cached.status === 'error') return { ...cached, index, sheetRow: row.sheetRow, expected: row.expected };
  const hit = cached.results.findIndex((r) => valuesMatch(r.value, row.expected, cfg.matchMode));
  const rank = hit === -1 ? null : hit + 1;
  return {
    ...cached, index, sheetRow: row.sheetRow, expected: row.expected, rank, hit: rank !== null, rating: ratingForRank(rank),
    results: cached.results.map((r) => ({ ...r, isMatch: r.rank === rank })),
  };
}

export { sleep };
