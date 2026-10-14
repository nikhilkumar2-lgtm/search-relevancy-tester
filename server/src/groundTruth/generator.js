import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildRequest } from '../../../shared/queryReplace.js';
import { getByPath, cleanText } from '../../../shared/matcher.js';
import { allocateQuotas, planPages, pickPages, shuffle, textOf } from '../../../shared/groundTruth.js';
import { fetchWithRetry, sleep } from '../services/executor.js';
import { config } from '../config.js';
import { HttpError } from '../utils/errors.js';
import { generateQueries } from './llm.js';

const dir = path.join(config.dataDir, 'groundtruth');
const jobs = new Map();
export const getJob = (id) => jobs.get(id);
const ID_RE = /^[a-f0-9-]{36}$/;
export const assertId = (id) => { if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid id'); return id; };

export async function loadJob(id) {
  assertId(id);
  if (jobs.has(id)) return publicJob(jobs.get(id));
  try { return JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export const publicJob = ({ controller, ...rest }) => rest;

// One search page: blank query + user's aggregations + paging fields, everything else from the cURL.
async function fetchPage(parsedCurl, p, group, pageIndex, signal) {
  const overrides = { ...group.override, [p.pageSizePath]: p.pageSize, [p.fromPath]: pageIndex * p.pageSize };
  for (const k of p.pagePaths) overrides[k] = pageIndex + 1;
  const req = buildRequest(parsedCurl, '', { token: '{{QUERY}}', queryJsonPath: p.queryJsonPath, bodyOverrides: overrides });
  const out = await fetchWithRetry(req, { timeoutMs: p.timeoutMs, retries: p.retries }, signal);
  if (out.error) throw new Error(out.error);
  if (out.res.status >= 400) throw new Error(`Search API returned HTTP ${out.res.status}`);
  const data = typeof out.res.data === 'string' ? JSON.parse(out.res.data) : out.res.data;
  const hits = getByPath(data, p.responsePath);
  if (!Array.isArray(hits)) throw new Error(`Response path "${p.responsePath}" did not return an array`);
  return { data, hits };
}

const toDoc = (hit, p, i) => {
  const title = cleanText(textOf(getByPath(hit, p.titlePath))).trim();
  if (!title) return null;
  return {
    id: String(getByPath(hit, p.idPath) ?? `doc-${i}`),
    title,
    content: cleanText(textOf(getByPath(hit, p.contentPath))).trim().slice(0, p.contentChars),
    url: textOf(getByPath(hit, p.urlPath)),
  };
};

/** Probe page 0 of every group, then split the requested count evenly across the groups. */
async function probeGroups(parsedCurl, p, signal) {
  const probes = [];
  for (const group of p.groups) {
    const probe = await fetchPage(parsedCurl, p, group, 0, signal);
    const total = Number(getByPath(probe.data, p.totalPath));
    if (!Number.isFinite(total)) throw new HttpError(400, `Total path "${p.totalPath}" did not return a number`);
    probes.push({ group, probe, total });
  }
  const quotas = allocateQuotas(p.count, probes.map((x) => Math.min(x.total, 10000)));
  return probes.map((x, i) => ({ ...x, quota: quotas[i], ...planPages({ total: x.total, count: quotas[i], pageSize: p.pageSize, docsPerCall: p.docsPerCall }) }));
}

export async function plan(parsedCurl, p) {
  const groups = await probeGroups(parsedCurl, p);
  const docsTarget = groups.reduce((a, g) => a + g.docsTarget, 0);
  const searchCalls = groups.reduce((a, g) => a + g.pagesToFetch, 0);
  const llmCalls = Math.ceil(docsTarget / p.docsPerCall);
  const approxInputTokens = Math.round((docsTarget * (p.contentChars + 120) + llmCalls * (p.prompt.length + 300)) / 4);
  return {
    docsTarget, searchCalls, llmCalls, approxInputTokens,
    total: groups.reduce((a, g) => a + g.total, 0),
    groups: groups.map((g) => ({ label: g.group.label, total: g.total, queries: g.docsTarget, searchCalls: g.pagesToFetch, pagesAvailable: g.pagesAvailable })),
    sample: groups[0].probe.hits.map((h, i) => toDoc(h, p, i)).filter(Boolean).slice(0, 5).map(({ title, content }) => ({ title, content: content.slice(0, 160) })),
  };
}

export function startGeneration({ parsedCurl, p, apiKey }) {
  const job = {
    id: randomUUID(), status: 'running', stage: 'fetching', startedAt: new Date().toISOString(), finishedAt: null,
    settings: { mode: p.mode, provider: p.provider, model: p.model, prompt: p.prompt, count: p.count, aggregations: p.groups.map((g) => g.label) },
    progress: { pages: { done: 0, total: 0 }, llm: { done: 0, total: 0 } },
    plan: null, rows: [], skipped: 0, errors: [], controller: new AbortController(),
  };
  jobs.set(job.id, job);
  run(job, parsedCurl, p, apiKey).catch((e) => finish(job, job.controller.signal.aborted ? 'cancelled' : 'failed', e.message));
  return job;
}

export function cancelJob(id) {
  const j = jobs.get(id);
  if (!j || j.status !== 'running') return false;
  j.controller.abort();
  return true;
}

async function run(job, parsedCurl, p, apiKey) {
  const { signal } = job.controller;
  const groups = await probeGroups(parsedCurl, p, signal);
  const pl = {
    docsTarget: groups.reduce((x, g) => x + g.docsTarget, 0),
    searchCalls: groups.reduce((x, g) => x + g.pagesToFetch, 0),
    llmCalls: Math.ceil(groups.reduce((x, g) => x + g.docsTarget, 0) / p.docsPerCall),
    groups: groups.map((g) => ({ label: g.group.label, total: g.total, queries: g.docsTarget })),
  };
  job.plan = pl;
  if (!pl.docsTarget) throw new Error('The search returned no documents for these aggregations');
  job.progress.pages.total = pl.searchCalls;

  // 1) per aggregation: collect documents from random pages, keep its share of unique documents
  const seen = new Set(); // titles are unique across all groups
  const chosen = [];
  for (const g of groups) {
    if (!g.docsTarget) continue;
    const pages = pickPages(g.pagesAvailable, g.pagesToFetch);
    const collected = [];
    let next = 0;
    const worker = async () => {
      while (!signal.aborted) {
        const idx = next++;
        if (idx >= pages.length) return;
        const pageIndex = pages[idx];
        try {
          const { hits } = pageIndex === 0 ? g.probe : (await sleep(p.delayMs, signal), await fetchPage(parsedCurl, p, g.group, pageIndex, signal));
          hits.forEach((h, i) => { const d = toDoc(h, p, pageIndex * p.pageSize + i); if (d) collected.push(d); else job.skipped++; });
        } catch (e) {
          if (signal.aborted) return;
          job.errors.push(`${g.group.label} · page ${pageIndex + 1}: ${e.message}`);
        }
        job.progress.pages.done++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, pages.length) }, worker));
    if (signal.aborted) throw new Error('Cancelled');

    const mine = shuffle(collected).filter((d) => { const k = d.title.toLowerCase(); if (seen.has(k)) { job.skipped++; return false; } seen.add(k); return true; }).slice(0, g.docsTarget);
    mine.forEach((d, i) => { d.group = g.group.label; d.style = i % 2 === 0 ? 'keyword' : 'natural'; });
    if (mine.length < g.docsTarget) job.errors.push(`${g.group.label}: only ${mine.length} unique documents found (wanted ${g.docsTarget}).`);
    chosen.push(...mine);
  }
  if (!chosen.length) throw new Error(`No usable documents found${job.errors.length ? `: ${job.errors[0]}` : ''}`);

  // 2) one query per document via the LLM, in batches
  job.stage = 'generating';
  const batches = [];
  for (let i = 0; i < chosen.length; i += p.docsPerCall) batches.push(chosen.slice(i, i + p.docsPerCall));
  job.progress.llm.total = batches.length;
  const usedQueries = new Set();
  let nb = 0;
  const llmWorker = async () => {
    while (!signal.aborted) {
      const bi = nb++;
      if (bi >= batches.length) return;
      const batch = batches[bi];
      const input = batch.map((d) => ({ id: d.id, title: d.title, content: d.content, ...(p.mode === 'hybrid' ? { style: d.style } : {}) }));
      try {
        const out = await generateQueries({ provider: p.provider, apiKey, model: p.model, prompt: p.prompt, docs: input, signal });
        for (const d of batch) {
          const q = out.get(d.id);
          if (!q || usedQueries.has(q.toLowerCase())) { job.skipped++; continue; }
          usedQueries.add(q.toLowerCase());
          job.rows.push({ query: q, expected: d.title, url: d.url, type: p.mode === 'hybrid' ? (d.style === 'keyword' ? 'keyword' : 'semantic') : 'keyword', aggregation: d.group, docId: d.id });
        }
      } catch (e) {
        if (signal.aborted) return;
        job.errors.push(`LLM batch ${bi + 1}: ${e.message}`);
        if (/API key|authentication|invalid x-api-key|Incorrect API key|credit|quota/i.test(e.message)) { job.controller.abort(); return; }
      }
      job.progress.llm.done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, llmWorker));
  if (signal.aborted && !job.errors.some((e) => /LLM batch/.test(e))) throw new Error('Cancelled');
  if (!job.rows.length) throw new Error(job.errors.find((e) => /LLM batch/.test(e)) || 'No queries were generated');
  await finish(job, signal.aborted ? 'cancelled' : 'completed');
}

async function finish(job, status, error) {
  if (job.status !== 'running') return;
  job.status = status;
  job.stage = 'done';
  job.finishedAt = new Date().toISOString();
  if (error) job.errors.push(error);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${job.id}.json`), JSON.stringify(publicJob(job), null, 2));
  } catch (e) { console.error('Failed to save ground-truth job:', e.message); }
  setTimeout(() => jobs.delete(job.id), 60_000).unref();
}
