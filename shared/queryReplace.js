// Builds a concrete request for one query from a parsed cURL request.
// Only the query is swapped; every other header/cookie/param is left untouched.

export const DEFAULT_TOKEN = '{{QUERY}}';

const jsonEscape = (s) => JSON.stringify(s).slice(1, -1);

function replaceAll(haystack, needle, value) {
  if (!needle || typeof haystack !== 'string') return { text: haystack, count: 0 };
  const parts = haystack.split(needle);
  return { text: parts.join(value), count: parts.length - 1 };
}

// Replace the token in a URL, covering raw, percent-encoded and +-for-space forms.
function replaceInUrl(url, token, query) {
  const encoded = encodeURIComponent(query);
  const variants = [
    token,
    encodeURIComponent(token),
    encodeURIComponent(token).replace(/%20/g, '+'),
    token.replace(/ /g, '+'),
  ];
  let text = url;
  let count = 0;
  for (const v of [...new Set(variants)]) {
    const r = replaceAll(text, v, encoded);
    text = r.text;
    count += r.count;
  }
  return { text, count };
}

// Control characters inside JSON strings (e.g. stray newlines from a bad paste) make
// JSON.parse fail; whitespace outside strings is irrelevant, so just drop them.
export function parseLenientJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/[\u0000-\u001f]/g, ''));
  }
}

export function setByPath(obj, path, value) {
  const keys = path.split('.').filter(Boolean);
  if (!keys.length) throw new Error('Empty JSON path');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * @param parsed  { method, url, headers, body }
 * @param query   the search string for this row
 * @param opts    { token, queryJsonPath, bodyOverrides }
 * @returns       { method, url, headers, data }
 */
export function buildRequest(parsed, query, opts = {}) {
  const token = opts.token ?? DEFAULT_TOKEN;
  const q = String(query);
  let found = 0;

  const u = replaceInUrl(parsed.url, token, q);
  found += u.count;

  const headers = {};
  for (const [name, value] of Object.entries(parsed.headers || {})) {
    const lower = name.toLowerCase();
    if (lower === 'content-length' || lower === 'host') continue;
    const r = replaceAll(String(value), token, q);
    found += r.count;
    headers[name] = r.text;
  }

  let data = parsed.body ?? undefined;
  if (typeof data === 'string') {
    const ctype = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '';
    let value = q;
    if (/json/i.test(ctype) || /^\s*[{[]/.test(data)) value = jsonEscape(q);
    else if (/x-www-form-urlencoded/i.test(ctype)) value = encodeURIComponent(q);
    const r = replaceAll(data, token, value);
    data = r.text;
    found += r.count;
  }

  const hasOverrides = opts.bodyOverrides && Object.keys(opts.bodyOverrides).length > 0;
  if (typeof data === 'string' && (opts.queryJsonPath || hasOverrides)) {
    let obj;
    try {
      obj = parseLenientJson(data);
    } catch {
      throw new Error('Request body is not valid JSON, so the JSON path / overrides cannot be applied');
    }
    if (opts.queryJsonPath) {
      setByPath(obj, opts.queryJsonPath, q);
      found += 1;
    }
    for (const [path, value] of Object.entries(opts.bodyOverrides || {})) setByPath(obj, path, value);
    data = JSON.stringify(obj);
  } else if (opts.queryJsonPath) {
    throw new Error('Query JSON path was given but the cURL has no body');
  }

  if (found === 0) {
    throw new Error(`Could not find the query location: "${token}" is not in the URL, headers or body (and no JSON path set)`);
  }
  return { method: (parsed.method || 'get').toUpperCase(), url: u.text, headers, data };
}
