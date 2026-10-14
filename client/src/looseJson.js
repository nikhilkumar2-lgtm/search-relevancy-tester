// Parses JSON, but also tolerates JS-object-literal style input: unquoted keys,
// single-quoted strings and trailing commas, e.g. [{type: "_index", filter: ['a']}].
export function parseLooseJson(text) {
  try {
    return JSON.parse(text);
  } catch { /* try the lenient path */ }
  let out = '';
  let chunk = '';
  const flush = () => {
    out += chunk
      .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":')
      .replace(/,(\s*[}\]])/g, '$1');
    chunk = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      let body = '';
      while (j < text.length && text[j] !== c) {
        if (text[j] === '\\' && j + 1 < text.length) { body += text[j] + text[j + 1]; j += 2; } else body += text[j++];
      }
      flush();
      out += c === '"' ? `"${body}"` : JSON.stringify(body.replace(/\\'/g, "'"));
      i = j;
    } else chunk += c;
  }
  flush();
  return JSON.parse(out);
}
