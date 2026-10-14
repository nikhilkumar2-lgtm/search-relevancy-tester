// Pure helpers for the ground-truth generator: planning, sampling, parsing LLM output.

/** How many search pages / LLM calls are needed for `count` queries. */
export function planPages({ total, count, pageSize, docsPerCall = 5, maxWindow = 10000 }) {
  const available = Math.max(0, Math.min(Number(total) || 0, maxWindow));
  const docsTarget = Math.min(count, available);
  const pagesAvailable = Math.ceil(available / pageSize);
  let pagesToFetch = 0;
  if (docsTarget > 0) {
    // 20% headroom for duplicate / untitled documents
    pagesToFetch = docsTarget >= available ? pagesAvailable : Math.min(pagesAvailable, Math.max(1, Math.ceil((docsTarget * 1.2) / pageSize)));
  }
  return { available, docsTarget, pagesAvailable, pagesToFetch, searchCalls: pagesToFetch, llmCalls: Math.ceil(docsTarget / docsPerCall) };
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** n distinct random page indexes out of [0, pagesAvailable), sorted. */
export function pickPages(pagesAvailable, n, rng = Math.random) {
  const all = Array.from({ length: pagesAvailable }, (_, i) => i);
  return shuffle(all, rng).slice(0, n).sort((a, b) => a - b);
}

/** String form of a field that may be a string, an array of strings, or missing. */
export function textOf(v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' ');
  if (typeof v === 'object') return '';
  return String(v);
}

/** Pulls a JSON array out of an LLM reply (tolerates ``` fences and surrounding prose). */
export function extractJsonArray(text) {
  const t = String(text ?? '').replace(/```(?:json)?/gi, '').trim();
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v)) return v;
  } catch { /* fall through */ }
  const s = t.indexOf('[');
  const e = t.lastIndexOf(']');
  if (s >= 0 && e > s) {
    const v = JSON.parse(t.slice(s, e + 1));
    if (Array.isArray(v)) return v;
  }
  throw new Error('Model reply did not contain a JSON array');
}

/**
 * Splits `count` queries across groups as evenly as possible (50 over 2 -> 25/25, 50 over 3 -> 17/17/16),
 * never exceeding a group's capacity; unused share is handed to groups that still have room.
 */
export function allocateQuotas(count, capacities) {
  const quotas = capacities.map(() => 0);
  let left = Math.min(count, capacities.reduce((a, b) => a + Math.max(0, b), 0));
  while (left > 0) {
    let progressed = false;
    for (let i = 0; i < capacities.length && left > 0; i++) {
      if (quotas[i] < capacities[i]) { quotas[i]++; left--; progressed = true; }
    }
    if (!progressed) break;
  }
  return quotas;
}
