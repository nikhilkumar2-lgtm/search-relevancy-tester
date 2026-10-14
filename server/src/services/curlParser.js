import { toJsonString } from 'curlconverter';
import { HttpError } from '../utils/errors.js';

// Browsers' "copy as cURL" output sometimes loses the trailing backslashes when pasted.
// Join any line break that is outside quotes so the command is a single logical line.
export function normalizeCurl(src) {
  let out = '';
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\' && quote === '"') out += src[++i] ?? '';
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      out += c;
    } else if (c === '\\' && (src[i + 1] === '\n' || src[i + 1] === '\r')) {
      out += ' ';
      i += src[i + 1] === '\r' && src[i + 2] === '\n' ? 2 : 1;
    } else if (c === '\n' || c === '\r') out += ' ';
    else out += c;
  }
  return out.trim();
}

export function parseCurl(curlText) {
  let parsed;
  try {
    parsed = JSON.parse(toJsonString(normalizeCurl(curlText)));
  } catch (e) {
    throw new HttpError(400, `Could not parse cURL command: ${String(e.message).split('\n')[0]}`);
  }
  const url = parsed.raw_url || parsed.url;
  if (!/^https?:\/\//i.test(url || '')) throw new HttpError(400, 'cURL must contain an http(s) URL');
  const body = parsed.data === undefined ? null : typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data);
  return { method: parsed.method || 'get', url, headers: parsed.headers || {}, body };
}
