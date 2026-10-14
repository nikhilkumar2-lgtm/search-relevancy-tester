import axios from 'axios';
import { parse } from 'csv-parse/sync';
import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { config } from '../config.js';
import { HttpError } from '../utils/errors.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export function parseSheetRef(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const id = m ? m[1] : s;
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) throw new HttpError(400, 'Invalid Google Sheet link or ID');
  return { id, gid: (s.match(/[#&?]gid=(\d+)/) || [])[1] };
}

function credentials() {
  const raw = config.googleCredentials.trim();
  if (raw) {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return { credentials: JSON.parse(text) };
  }
  if (config.googleKeyFile && fs.existsSync(config.googleKeyFile)) return { keyFile: config.googleKeyFile };
  return null;
}

export const hasServiceAccount = () => !!credentials();

async function authHeader(write = false) {
  const creds = credentials();
  if (!creds) throw new HttpError(400, 'No Google service account configured (set GOOGLE_SERVICE_ACCOUNT_FILE in .env)');
  const scope = write ? 'https://www.googleapis.com/auth/spreadsheets' : 'https://www.googleapis.com/auth/spreadsheets.readonly';
  const token = await new GoogleAuth({ ...creds, scopes: [scope] }).getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

const quoteTab = (t) => `'${t.replace(/'/g, "''")}'`;

async function readViaApi(id, tab) {
  const range = tab ? `${quoteTab(tab)}!A:Z` : 'A:Z';
  try {
    const { data } = await axios.get(`${API}/${id}/values/${encodeURIComponent(range)}`, { headers: await authHeader(), timeout: 20000 });
    return data.values || [];
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    throw new HttpError(e.response?.status === 404 ? 404 : 400, `Google Sheets API: ${msg}`);
  }
}

async function readViaCsv(id, tab, gid) {
  const url = tab
    ? `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`
    : `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
  let res;
  try {
    res = await axios.get(url, { responseType: 'text', timeout: 20000, maxRedirects: 5, validateStatus: () => true });
  } catch (e) {
    throw new HttpError(502, `Could not reach Google Sheets: ${e.code || e.message}`);
  }
  const body = String(res.data || '');
  if (res.status >= 400 || /^\s*<(!doctype|html)/i.test(body)) {
    throw new HttpError(400, 'Sheet is not publicly readable. Share it as "Anyone with the link can view" or configure a service account.');
  }
  return parse(body, { relax_column_count: true, skip_empty_lines: false });
}

const isHeader = (cells) => cells.some((c) => /query|search|keyword/i.test(c)) && cells.some((c) => /expected|url|id|title|result/i.test(c));

/** Returns { rows: [{sheetRow, query, expected}], header, mode } */
export async function readSheet({ sheet, tab }) {
  const { id, gid } = parseSheetRef(sheet);
  const mode = hasServiceAccount() ? 'service-account' : 'public-csv';
  const values = mode === 'service-account' ? await readViaApi(id, tab) : await readViaCsv(id, tab, gid);
  const cells = (r) => (r || []).map((c) => String(c ?? '').trim());

  let qCol = 0;
  let eCol = 1;
  let start = 0;
  const head = cells(values[0]);
  if (isHeader(head)) {
    start = 1;
    const q = head.findIndex((c) => /query|search|keyword/i.test(c));
    const e = head.findIndex((c, i) => i !== q && /expected|url|id|title|result/i.test(c));
    if (q >= 0) qCol = q;
    if (e >= 0) eCol = e;
  }
  const rows = [];
  for (let i = start; i < values.length; i++) {
    const r = cells(values[i]);
    if (!r.some(Boolean)) continue;
    rows.push({ sheetRow: i + 1, query: r[qCol] || '', expected: r[eCol] || '' });
  }
  if (!rows.length) throw new HttpError(400, 'No data rows found in the sheet');
  return { id, rows, header: start === 1 ? head : null, mode };
}

/** Writes results to a new tab (service account required). Returns the new tab name. */
export async function writeResults({ sheet }, results) {
  const { id } = parseSheetRef(sheet);
  const headers = { ...(await authHeader(true)) };
  const title = `Relevancy ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  try {
    await axios.post(`${API}/${id}:batchUpdate`, { requests: [{ addSheet: { properties: { title } } }] }, { headers });
    const values = [
      ['Query', 'Expected', 'Rank', 'Hit@10', 'Status', 'Latency (ms)'],
      ...results.map((r) => [r.query, r.expected, r.rank ?? 'Not in top 10', r.status === 'ok' ? (r.hit ? 'TRUE' : 'FALSE') : '', r.status === 'ok' ? r.rating : `Error: ${r.error}`, r.latencyMs ?? '']),
    ];
    await axios.put(`${API}/${id}/values/${encodeURIComponent(`${quoteTab(title)}!A1`)}?valueInputOption=RAW`, { values }, { headers });
  } catch (e) {
    throw new HttpError(400, `Write-back failed: ${e.response?.data?.error?.message || e.message}`);
  }
  return title;
}
