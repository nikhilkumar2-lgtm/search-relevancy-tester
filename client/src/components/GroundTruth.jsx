import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Field from './Field.jsx';
import { parseLooseJson } from '../looseJson.js';

const DEFAULTS = {
  queryJsonPath: 'searchString',
  aggregations: '[]',
  count: 50,
  mode: 'keyword',
  provider: 'anthropic',
  responsePath: 'result.hits',
  totalPath: 'result.total',
  titlePath: 'highlight.TitleToDisplayString',
  contentPath: 'highlight.SummaryToDisplay',
  urlPath: 'href',
  idPath: '_id',
  pageSize: 10,
  pageSizePath: 'resultsPerPage',
  fromPath: 'from',
  pagePaths: 'pageNum,pageNo',
  docsPerCall: 5,
  contentChars: 1200,
};

const parseAgg = (text) => {
  try {
    const v = parseLooseJson(text || '[]');
    if (!Array.isArray(v)) return null;
    return v.map((a) => ({ type: String(a.type ?? ''), filter: (Array.isArray(a.filter) ? a.filter : []).join(', ') }));
  } catch { return null; }
};
const serializeAgg = (rows) =>
  JSON.stringify(rows.filter((r) => r.type.trim()).map((r) => ({ type: r.type.trim(), filter: r.filter.split(',').map((x) => x.trim()).filter(Boolean) })));

const loadSaved = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('rel.gt')) }; } catch { return DEFAULTS; } };

export default function GroundTruth({ evaluatorCurl }) {
  // cURL and API key are kept in memory only.
  const [curl, setCurl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [f, setF] = useState(loadSaved);
  const [defaults, setDefaults] = useState(null);
  const [prompts, setPrompts] = useState(() => { try { return JSON.parse(localStorage.getItem('rel.gt.prompts')) || {}; } catch { return {}; } });
  const [models, setModels] = useState(() => { try { return JSON.parse(localStorage.getItem('rel.gt.models')) || {}; } catch { return {}; } });
  const [aggRows, setAggRows] = useState(() => parseAgg(loadSaved().aggregations) ?? []);
  const [aggRaw, setAggRaw] = useState(() => parseAgg(loadSaved().aggregations) === null);
  const [plan, setPlan] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => { api.gtDefaults().then(setDefaults).catch((e) => setError(e.message)); return () => clearInterval(timer.current); }, []);
  useEffect(() => localStorage.setItem('rel.gt', JSON.stringify(f)), [f]);
  useEffect(() => localStorage.setItem('rel.gt.prompts', JSON.stringify(prompts)), [prompts]);
  useEffect(() => localStorage.setItem('rel.gt.models', JSON.stringify(models)), [models]);

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPlan(null); };
  const updateAgg = (rows) => { setAggRows(rows); setF({ ...f, aggregations: serializeAgg(rows) }); setPlan(null); };
  const toggleRaw = () => {
    if (aggRaw) { const rows = parseAgg(f.aggregations); if (!rows) { setError('Aggregations JSON is invalid — fix it before switching back.'); return; } setAggRows(rows); setF({ ...f, aggregations: serializeAgg(rows) }); setError(''); }
    setAggRaw(!aggRaw);
  };
  const prompt = prompts[f.mode] ?? defaults?.prompts[f.mode] ?? '';
  const model = models[f.provider] ?? defaults?.models[f.provider] ?? '';
  const keyOnServer = defaults?.keys[f.provider];

  const payload = () => ({ ...f, curl, apiKey, prompt, model, count: Number(f.count), pageSize: Number(f.pageSize), docsPerCall: Number(f.docsPerCall), contentChars: Number(f.contentChars) });

  const calcPlan = async () => {
    setError(''); setPlan(null); setBusy(true);
    try { setPlan(await api.gtPlan(payload())); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const poll = (id) => {
    clearInterval(timer.current);
    const tick = async () => {
      try {
        const j = await api.gtGet(id);
        setJob(j);
        if (j.status !== 'running') clearInterval(timer.current);
      } catch (e) { setError(e.message); clearInterval(timer.current); }
    };
    tick();
    timer.current = setInterval(tick, 1000);
  };

  const generate = async () => {
    setError(''); setJob(null); setBusy(true);
    try { poll((await api.gtGenerate(payload())).id); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const running = job?.status === 'running';
  const pct = (d) => (d.total ? Math.round((d.done / d.total) * 100) : 0);

  return (
    <section className="card">
      <h2>Generate ground truth</h2>
      <p className="hint">Independent of the evaluator. Pulls documents with your cURL (blank query + your aggregations), asks an LLM to write one search query per document, and exports an Excel sheet (Query, Expected, …) you can use as the evaluator's ground truth.</p>

      <Field label="Working cURL" hint="In memory only; secrets are never stored or logged.">
        <textarea rows={6} value={curl} onChange={(e) => setCurl(e.target.value)} spellCheck={false} placeholder="curl 'https://…/search/SUSearchResults' -H '…' --data-raw '{…}'" />
      </Field>
      {evaluatorCurl && !curl && <button onClick={() => setCurl(evaluatorCurl)}>Use the cURL from step 1</button>}

      <h3>Documents to sample</h3>
      <div className="grid">
        <Field label="Number of queries to generate" hint="One query per document"><input type="number" min="1" max="2000" value={f.count} onChange={set('count')} /></Field>
        <Field label="Title field (becomes “Expected”)" hint="Relative to each hit"><input value={f.titlePath} onChange={set('titlePath')} /></Field>
        <Field label="Content field (context for the LLM)" hint="e.g. highlight.SummaryToDisplay or autosuggestData.0.value.0"><input value={f.contentPath} onChange={set('contentPath')} /></Field>
      </div>
      <div className="agg">
        <div className="row between">
          <span className="label">Aggregations (the query count is split equally across them)</span>
          <button onClick={toggleRaw}>{aggRaw ? 'Use builder' : 'Edit as JSON'}</button>
        </div>
        {aggRaw ? (
          <input value={f.aggregations} onChange={set('aggregations')} placeholder='[{"type":"Language","filter":["en"]},{"type":"Content Source","filter":["Community"]}]' />
        ) : (
          <>
            {aggRows.length === 0 && <p className="hint">No filter — documents are sampled from everything (sends <code>[]</code>).</p>}
            {aggRows.map((r, i) => (
              <div className="row agg-row" key={i}>
                <input placeholder="Type, e.g. Language" value={r.type} onChange={(e) => updateAgg(aggRows.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} />
                <input placeholder="Values, comma separated, e.g. en_US, en, en-us" value={r.filter} onChange={(e) => updateAgg(aggRows.map((x, j) => (j === i ? { ...x, filter: e.target.value } : x)))} />
                <button onClick={() => updateAgg(aggRows.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            <button onClick={() => updateAgg([...aggRows, { type: '', filter: '' }])}>+ Add aggregation</button>
          </>
        )}
        <span className="hint">
          Each aggregation is sampled on its own, so {Number(f.count) || 0} queries over {Math.max(1, aggRaw ? (parseAgg(f.aggregations) ?? []).length : aggRows.filter((r) => r.type.trim()).length)} aggregation(s)
          ≈ {Math.ceil((Number(f.count) || 0) / Math.max(1, aggRaw ? (parseAgg(f.aggregations) ?? []).length : aggRows.filter((r) => r.type.trim()).length))} each. Put several values in one row to treat them as a single aggregation.
        </span>
      </div>
      <details>
        <summary>Advanced response / paging settings</summary>
        <div className="grid">
          {[['responsePath', 'Results array path'], ['totalPath', 'Total count path'], ['urlPath', 'URL field'], ['idPath', 'ID field'],
            ['queryJsonPath', 'Query JSON body path'], ['pageSize', 'Page size'], ['pageSizePath', 'Page-size body key'], ['fromPath', 'Offset body key'],
            ['pagePaths', 'Page-number body keys (comma separated)'], ['docsPerCall', 'Documents per LLM call'], ['contentChars', 'Max content characters per document']]
            .map(([k, label]) => <Field key={k} label={label}><input value={f[k]} onChange={set(k)} /></Field>)}
        </div>
      </details>

      <h3>Query style and LLM</h3>
      <div className="grid">
        <Field label="Mode" hint="Switching mode loads that mode’s prompt (your edits are remembered per mode)">
          <select value={f.mode} onChange={set('mode')}><option value="keyword">Keyword</option><option value="hybrid">Hybrid (keyword + semantic)</option></select>
        </Field>
        <Field label="Provider">
          <select value={f.provider} onChange={set('provider')}><option value="anthropic">Claude (Anthropic)</option><option value="openai">OpenAI</option></select>
        </Field>
        <Field label="Model"><input value={model} onChange={(e) => setModels({ ...models, [f.provider]: e.target.value })} /></Field>
        <Field label="API key" hint={keyOnServer ? 'A key is configured in .env — leave blank to use it.' : 'No key in .env — paste one here (kept in memory only).'}>
          <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyOnServer ? 'using key from .env' : 'sk-…'} />
        </Field>
      </div>
      <Field label={`Prompt (${f.mode})`} hint="Editable. The JSON output format is added automatically. Each document is sent with its title and content.">
        <textarea rows={9} value={prompt} onChange={(e) => setPrompts({ ...prompts, [f.mode]: e.target.value })} />
      </Field>
      <button onClick={() => { const { [f.mode]: _, ...rest } = prompts; setPrompts(rest); }}>Reset prompt to default</button>

      <div className="actions">
        <button disabled={busy || running || !curl} onClick={calcPlan}>Calculate how many calls</button>
        <button className="primary" disabled={busy || running || !curl} onClick={generate}>Generate ground truth</button>
        {running && <button className="danger" onClick={() => api.gtCancel(job.id)}>Cancel</button>}
      </div>
      {error && <p className="error">{error}</p>}

      {plan && (
        <div className="test-result">
          <p><b>{plan.total}</b> documents across the aggregations. To make <b>{plan.docsTarget}</b> queries you will run:</p>
          <ul>
            <li><b>{plan.searchCalls}</b> search requests (random pages out of {plan.pagesAvailable}, +1 probe)</li>
            <li><b>{plan.llmCalls}</b> LLM calls ({f.docsPerCall} documents each), ≈ {plan.approxInputTokens.toLocaleString()} input tokens</li>
          </ul>
          <table>
            <thead><tr><th>Aggregation</th><th>Documents</th><th>Queries to make</th><th>Search requests</th></tr></thead>
            <tbody>{plan.groups.map((g) => <tr key={g.label}><td>{g.label}</td><td>{g.total}</td><td>{g.queries}</td><td>{g.searchCalls}</td></tr>)}</tbody>
          </table>
          {plan.docsTarget < Number(f.count) && <p className="error">Only {plan.docsTarget} documents are available (you asked for {f.count}).</p>}
          <small>Sample documents:</small>
          <ol>{plan.sample.map((s, i) => <li key={i}>{s.title} <small>— {s.content}</small></li>)}</ol>
        </div>
      )}

      {job && (
        <>
          <h3>Progress <span className="badge">{job.status}{running ? ` · ${job.stage}` : ''}</span></h3>
          <p>Fetching pages: {job.progress.pages.done}/{job.progress.pages.total}</p>
          <div className="progress"><div style={{ width: `${pct(job.progress.pages)}%` }} /></div>
          <p>LLM calls: {job.progress.llm.done}/{job.progress.llm.total}</p>
          <div className="progress"><div style={{ width: `${pct(job.progress.llm)}%` }} /></div>
          <p>{job.rows.length} queries generated{job.skipped ? `, ${job.skipped} documents skipped (untitled / duplicate)` : ''}.</p>
          {job.errors.map((e, i) => <p key={i} className="error">{e}</p>)}
          {!running && job.rows.length > 0 && <a className="button primary" href={api.gtExportUrl(job.id)}>Download Excel</a>}
          {job.rows.length > 0 && (
            <table>
              <thead><tr><th>Query</th><th>Expected</th><th>Aggregation</th><th>Type</th></tr></thead>
              <tbody>{job.rows.slice(0, 200).map((r) => <tr key={r.docId}><td>{r.query}</td><td className="wrap">{r.expected}</td><td>{r.aggregation}</td><td>{r.type}</td></tr>)}</tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
