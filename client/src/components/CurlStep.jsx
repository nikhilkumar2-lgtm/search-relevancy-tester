import { useState } from 'react';
import { api } from '../api.js';
import Field from './Field.jsx';

export function parseOverrides(text) {
  if (!text.trim()) return {};
  const v = JSON.parse(text);
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('Body overrides must be a JSON object');
  return v;
}

export function requestPayload(curl, s) {
  return {
    curl,
    queryToken: s.queryToken,
    queryJsonPath: s.queryJsonPath,
    bodyOverrides: parseOverrides(s.bodyOverrides),
    responsePath: s.responsePath,
    matchField: s.matchField,
    displayField: s.displayField,
    matchMode: s.matchMode,
    timeoutMs: Number(s.timeoutMs),
    retries: Number(s.retries),
  };
}

export default function CurlStep({ curl, setCurl, settings, setSettings, sample, onNext }) {
  const [testQuery, setTestQuery] = useState('');
  const [test, setTest] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setSettings({ ...settings, [k]: e.target.value });

  const runTest = async () => {
    setError(''); setTest(null); setBusy(true);
    try {
      setTest(await api.testQuery({ ...requestPayload(curl, settings), query: testQuery }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="card">
      <h2>Step 1 — cURL and result mapping</h2>
      <Field label="Working cURL" hint="Kept in memory only. Mark the query with {{QUERY}}, or fill the JSON body path below. Cookies and tokens are never stored or logged.">
        <textarea rows={9} value={curl} onChange={(e) => setCurl(e.target.value)} placeholder={sample} spellCheck={false} />
      </Field>

      <h3>Where is the query?</h3>
      <div className="grid">
        <Field label="Placeholder / original text" hint="Replaced in URL, headers and body (URL-/JSON-encoded as needed). You can type the original query string here instead of {{QUERY}}.">
          <input value={settings.queryToken} onChange={set('queryToken')} />
        </Field>
        <Field label="JSON body path (optional)" hint='Sets this key to the query, e.g. "searchString". Works even when the field is empty.'>
          <input value={settings.queryJsonPath} onChange={set('queryJsonPath')} placeholder="searchString" />
        </Field>
        <Field label="Body overrides (JSON, optional)" hint='Fixed values applied to every request, e.g. {"aggregations": []}'>
          <input value={settings.bodyOverrides} onChange={set('bodyOverrides')} />
        </Field>
      </div>

      <h3>Reading the response</h3>
      <div className="grid">
        <Field label="Response path to results array" hint="e.g. result.hits or data.hits.hits"><input value={settings.responsePath} onChange={set('responsePath')} /></Field>
        <Field label="Field used to match" hint="e.g. href, id, _source.url (relative to each result)"><input value={settings.matchField} onChange={set('matchField')} /></Field>
        <Field label="Display field (optional)" hint="Shown as the title in the top-10 list">
          <input value={settings.displayField} onChange={set('displayField')} placeholder="auto: title / name" />
        </Field>
        <Field label="Match mode" hint="normalized = trim, lowercase, strip trailing slash and ?query/#hash">
          <select value={settings.matchMode} onChange={set('matchMode')}>
            <option value="exact">exact</option><option value="normalized">normalized</option><option value="contains">contains</option>
          </select>
        </Field>
      </div>

      <h3>Test one query</h3>
      <div className="row">
        <input value={testQuery} onChange={(e) => setTestQuery(e.target.value)} placeholder="Type a sample query" />
        <button disabled={busy || !curl || !testQuery} onClick={runTest}>{busy ? 'Testing…' : 'Send test request'}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {test && (
        <div className="test-result">
          <p>
            <b>{test.request.method} {test.request.url}</b> — HTTP {test.httpStatus ?? '—'}, {test.latencyMs ?? '—'} ms
          </p>
          {test.curl && <details><summary>Request sent (secrets masked)</summary><pre>{test.curl}</pre></details>}
          {test.status === 'error' ? <p className="error">{test.error}</p> : (
            <>
              <p className="ok">Found {test.results.length} results at “{settings.responsePath}”. Top results:</p>
              <ol>{test.results.map((r) => <li key={r.rank}><code>{r.value || '(empty — check match field)'}</code> {r.title && <small>— {r.title}</small>}</li>)}</ol>
            </>
          )}
        </div>
      )}
      <div className="actions"><button className="primary" onClick={onNext}>Next: Google Sheet →</button></div>
    </section>
  );
}
