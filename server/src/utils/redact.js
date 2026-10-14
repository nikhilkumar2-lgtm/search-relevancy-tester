const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;

export function redactHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, SENSITIVE.test(k) || /token|secret|key|session/i.test(k) ? '***' : v]),
  );
}

// Safe-to-store description of the request template (no secrets).
export function describeCurl(parsed) {
  return { method: parsed.method, url: parsed.url, headers: redactHeaders(parsed.headers), hasBody: !!parsed.body };
}
