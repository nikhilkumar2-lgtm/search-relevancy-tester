import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../utils/errors.js';
import { parseCurl } from '../services/curlParser.js';
import { DEFAULT_MODELS, DEFAULT_PROMPTS } from '../groundTruth/prompts.js';
import { resolveKey } from '../groundTruth/llm.js';
import { assertId, cancelJob, getJob, loadJob, plan, publicJob, startGeneration } from '../groundTruth/generator.js';
import { gtToXlsx } from '../groundTruth/xlsx.js';
import { config } from '../config.js';
import { parseLooseJson } from '../../../shared/looseJson.js';

export const gtRouter = Router();

const path = (def) => z.string().trim().max(200).default(def);
const schema = z.object({
  curl: z.string().min(10, 'Paste a cURL command').max(100_000),
  queryJsonPath: path('searchString'),
  aggregations: z.string().max(20_000).default(''), // JSON array text; blank = keep the cURL's own
  count: z.coerce.number().int().min(1).max(2000),
  mode: z.enum(['keyword', 'hybrid']).default('keyword'),
  prompt: z.string().trim().min(10, 'Prompt is too short').max(8000),
  provider: z.enum(['anthropic', 'openai']).default('anthropic'),
  model: z.string().trim().min(1).max(100),
  apiKey: z.string().trim().max(300).optional().default(''),
  responsePath: path('result.hits'),
  totalPath: path('result.total'),
  titlePath: path('highlight.TitleToDisplayString'),
  contentPath: path('highlight.SummaryToDisplay'),
  urlPath: path('href'),
  idPath: path('_id'),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  pageSizePath: path('resultsPerPage'),
  fromPath: path('from'),
  pagePaths: z.string().trim().max(200).default('pageNum,pageNo'),
  docsPerCall: z.coerce.number().int().min(1).max(20).default(5),
  contentChars: z.coerce.number().int().min(0).max(5000).default(1200),
  timeoutMs: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  retries: z.coerce.number().int().min(0).max(5).default(1),
  delayMs: z.coerce.number().int().min(0).max(10_000).default(200),
});

function prepare(body, { needKey }) {
  const p = schema.parse(body);
  // Each aggregation entry becomes its own group; the requested count is split evenly across groups.
  let groups = [{ label: '(cURL default)', override: {} }];
  if (p.aggregations.trim()) {
    let v;
    try { v = parseLooseJson(p.aggregations); } catch { throw new HttpError(400, 'Aggregations must be valid JSON'); }
    if (!Array.isArray(v)) throw new HttpError(400, 'Aggregations must be a JSON array, e.g. [] or [{"type":"Language","filter":["en"]}]');
    if (v.length > 20) throw new HttpError(400, 'At most 20 aggregations are supported');
    const labelOf = (a) => (a && a.type ? `${a.type}: ${[].concat(a.filter ?? []).join(', ') || '(any)'}` : JSON.stringify(a));
    groups = v.length ? v.map((a) => ({ label: labelOf(a), override: { aggregations: [a] } })) : [{ label: 'No filter', override: { aggregations: [] } }];
  }
  const apiKey = needKey ? resolveKey(p.provider, p.apiKey) : null;
  return { p: { ...p, groups, pagePaths: p.pagePaths.split(',').map((s) => s.trim()).filter(Boolean) }, parsedCurl: parseCurl(p.curl), apiKey };
}

gtRouter.get('/defaults', (req, res) => res.json({ prompts: DEFAULT_PROMPTS, models: DEFAULT_MODELS, keys: { anthropic: !!config.anthropicKey, openai: !!config.openaiKey } }));

gtRouter.post('/plan', asyncHandler(async (req, res) => {
  const { p, parsedCurl } = prepare(req.body, { needKey: false });
  res.json(await plan(parsedCurl, p));
}));

gtRouter.post('/generate', asyncHandler(async (req, res) => {
  const { p, parsedCurl, apiKey } = prepare(req.body, { needKey: true });
  const job = startGeneration({ parsedCurl, p, apiKey });
  res.status(202).json({ id: job.id });
}));

gtRouter.get('/:id', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const live = getJob(req.params.id);
  const job = live ? publicJob(live) : await loadJob(req.params.id);
  if (!job) throw new HttpError(404, 'Not found');
  res.json(job);
}));

gtRouter.post('/:id/cancel', asyncHandler(async (req, res) => res.json({ cancelled: cancelJob(assertId(req.params.id)) })));

gtRouter.get('/:id/export', asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id);
  if (!job) throw new HttpError(404, 'Not found');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ground-truth-${job.id}.xlsx"`);
  res.send(Buffer.from(await gtToXlsx(job)));
}));
