// Result extraction and expected-result matching.

export const MATCH_MODES = ['exact', 'normalized', 'contains'];

export function getByPath(obj, path) {
  if (path === undefined || path === null || path === '') return obj;
  let cur = obj;
  for (const key of String(path).split('.').filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(key)) cur = cur[Number(key)];
    else if (typeof cur === 'object' && key in cur) cur = cur[key];
    else if (typeof cur === 'object') {
      // Case-insensitive fallback (e.g. titletodisplaystring vs titleToDisplayString)
      const alt = Object.keys(cur).find((k) => k.toLowerCase() === key.toLowerCase());
      cur = alt === undefined ? undefined : cur[alt];
    } else cur = undefined;
  }
  return cur;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Strip HTML tags (e.g. highlight <em>) and decode entities (e.g. &amp;), collapse whitespace.
export function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ');
}

// Trim, lowercase and drop trailing slashes; for URL-like values also drop ?query and #hash
// (plain titles such as "How do I reset?" are left intact).
export function normalize(value) {
  let s = cleanText(value).trim().toLowerCase();
  if (/^(https?:)?\/\//.test(s) || s.startsWith('/')) s = s.replace(/[?#].*$/, '');
  return s.replace(/\/+$/, '');
}

export function valuesMatch(actual, expected, mode = 'normalized') {
  if (actual === undefined || actual === null) return false;
  if (Array.isArray(actual)) return actual.some((a) => valuesMatch(a, expected, mode));
  if (typeof actual === 'object') actual = JSON.stringify(actual);
  const exp = String(expected ?? '');
  if (!exp.trim()) return false;
  switch (mode) {
    case 'exact':
      return String(actual) === exp;
    case 'contains':
      return cleanText(actual).trim().toLowerCase().includes(cleanText(exp).trim().toLowerCase());
    default:
      return normalize(actual) === normalize(exp);
  }
}

export function extractResults(data, responsePath, limit = 10) {
  const arr = getByPath(data, responsePath);
  if (!Array.isArray(arr)) {
    throw new Error(`Response path "${responsePath}" did not return an array`);
  }
  return arr.slice(0, limit);
}

/** 1-based rank of the expected value within items, or null. */
export function findRank(items, expected, { matchField, matchMode = 'normalized' } = {}) {
  for (let i = 0; i < items.length; i++) {
    const actual = matchField ? getByPath(items[i], matchField) : items[i];
    if (valuesMatch(actual, expected, matchMode)) return i + 1;
  }
  return null;
}
