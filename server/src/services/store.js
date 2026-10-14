import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../utils/errors.js';

const runsDir = path.join(config.dataDir, 'runs');
const ID_RE = /^[a-f0-9-]{36}$/;

export const assertRunId = (id) => {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid run id');
  return id;
};

const file = (id) => path.join(runsDir, `${assertRunId(id)}.json`);

export async function saveRun(run) {
  await fs.mkdir(runsDir, { recursive: true });
  const tmp = `${file(run.id)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(run, null, 2));
  await fs.rename(tmp, file(run.id));
}

export async function loadRun(id) {
  try {
    return JSON.parse(await fs.readFile(file(id), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function listRuns() {
  await fs.mkdir(runsDir, { recursive: true });
  const names = (await fs.readdir(runsDir)).filter((n) => n.endsWith('.json'));
  const runs = [];
  for (const n of names) {
    try {
      const r = JSON.parse(await fs.readFile(path.join(runsDir, n), 'utf8'));
      runs.push({ id: r.id, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, total: r.total, sheet: r.sheet, metrics: r.metrics });
    } catch { /* skip corrupt file */ }
  }
  return runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}
