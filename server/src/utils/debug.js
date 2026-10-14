import { config } from '../config.js';
import { normalize, getByPath } from '../../../shared/matcher.js';
import { redactHeaders } from './redact.js';

const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// cURL equivalent of what was sent, with auth / cookie / token headers masked.
export function toCurl(req) {
  const parts = [`curl -X ${req.method} ${sh(req.url)}`];
  for (const [k, v] of Object.entries(redactHeaders(req.headers))) parts.push(`-H ${sh(`${k}: ${v}`)}`);
  if (req.data) parts.push(`--data-raw ${sh(req.data)}`);
  return parts.join(' \\\n  ');
}

export function debugRequest(row, req) {
  if (!config.debug) return;
  console.log(`\n[debug] row ${row.sheetRow} query=${JSON.stringify(row.query)}\n${toCurl(req)}`);
}

export function debugOutcome(row, items, cfg, rank, status) {
  if (!config.debug) return;
  const exp = String(row.expected);
  console.log(`[debug] HTTP ${status} · ${items.length} result(s) at "${cfg.responsePath}" · matchField="${cfg.matchField}" mode=${cfg.matchMode}`);
  console.log(`[debug] expected: ${JSON.stringify(exp)}  (normalized: ${JSON.stringify(normalize(exp))})`);
  items.forEach((it, i) => {
    const v = cfg.matchField ? getByPath(it, cfg.matchField) : it;
    const s = typeof v === 'object' ? JSON.stringify(v) : v;
    const mark = rank === i + 1 ? '  <== MATCH' : '';
    console.log(`[debug]  ${i + 1}. ${JSON.stringify(s)}${v === undefined ? '  (field not found on this item; keys: ' + Object.keys(it || {}).join(',') + ')' : ''}${mark}`);
  });
  if (rank === null) console.log(`[debug] NOT MATCHED: none of the ${items.length} values equals the expected value under "${cfg.matchMode}" mode.`);
}
