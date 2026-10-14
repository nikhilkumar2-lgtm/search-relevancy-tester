import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Field from './Field.jsx';
import { requestPayload } from './CurlStep.jsx';

export default function RunStep({ curl, settings, setSettings, sheet, serviceAccount, onFinished, onOpen }) {
  const [runId, setRunId] = useState(null);
  const [rows, setRows] = useState([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0, rate: 0 });
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const sourceRef = useRef(null);
  useEffect(() => () => sourceRef.current?.close(), []);

  const set = (k) => (e) => setSettings({ ...settings, [k]: e.target.value });
  const setTh = (k) => (e) => setSettings({ ...settings, thresholds: { ...settings.thresholds, [k]: Number(e.target.value) } });

  const follow = (id) => {
    const es = new EventSource(api.streamUrl(id));
    sourceRef.current = es;
    es.addEventListener('snapshot', (e) => {
      const d = JSON.parse(e.data);
      setRows(d.results);
      setProgress({ completed: d.completed, total: d.total, rate: d.metrics?.hitRate ?? 0 });
    });
    es.addEventListener('progress', (e) => {
      const p = JSON.parse(e.data);
      setRows((prev) => [...prev, p]);
      setProgress({ completed: p.completed, total: p.total, rate: p.runningHitRate });
    });
    es.addEventListener('done', (e) => {
      const d = JSON.parse(e.data);
      setStatus(d.status);
      if (d.error) setError(d.error);
      es.close();
      onFinished(id);
    });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) setStatus((s) => (s === 'running' ? 'disconnected' : s)); };
  };

  const start = async () => {
    setError(''); setRows([]); setStatus('starting');
    try {
      const body = {
        ...requestPayload(curl, settings),
        concurrency: Number(settings.concurrency),
        delayMs: Number(settings.delayMs),
        thresholds: settings.thresholds,
        writeBack: settings.writeBack,
        sheet,
      };
      const { runId: id, total } = await api.startRun(body);
      setRunId(id); setProgress({ completed: 0, total, rate: 0 }); setStatus('running');
      follow(id);
    } catch (e) { setError(e.message); setStatus('idle'); }
  };

  const cancel = () => api.cancelRun(runId).catch((e) => setError(e.message));
  const pct = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const running = status === 'running' || status === 'starting';
  const sorted = [...rows].sort((a, b) => a.index - b.index);

  return (
    <section className="card">
      <h2>Step 3 — Run evaluation</h2>
      <div className="grid">
        <Field label="Concurrency"><input type="number" min="1" max="20" value={settings.concurrency} onChange={set('concurrency')} /></Field>
        <Field label="Delay between requests (ms)"><input type="number" min="0" value={settings.delayMs} onChange={set('delayMs')} /></Field>
        <Field label="Timeout (ms)"><input type="number" min="1000" value={settings.timeoutMs} onChange={set('timeoutMs')} /></Field>
        <Field label="Retries (429 / 5xx back off)"><input type="number" min="0" max="5" value={settings.retries} onChange={set('retries')} /></Field>
      </div>
      <div className="grid">
        <Field label="Excellent ≥ %"><input type="number" value={settings.thresholds.excellent} onChange={setTh('excellent')} /></Field>
        <Field label="Good ≥ %"><input type="number" value={settings.thresholds.good} onChange={setTh('good')} /></Field>
        <Field label="Needs improvement ≥ %"><input type="number" value={settings.thresholds.fair} onChange={setTh('fair')} /></Field>
      </div>
      <label className="check">
        <input type="checkbox" disabled={!serviceAccount} checked={settings.writeBack && serviceAccount} onChange={(e) => setSettings({ ...settings, writeBack: e.target.checked })} />
        Write results to a new tab in the sheet {!serviceAccount && <small>(needs a service account)</small>}
      </label>

      <div className="actions">
        <button className="primary" disabled={running || !curl || !sheet.sheet} onClick={start}>Run evaluation</button>
        {running && runId && <button className="danger" onClick={cancel}>Cancel run</button>}
        {runId && !running && <button onClick={() => onOpen(runId)}>View results →</button>}
      </div>
      {!curl && <p className="hint">Paste the cURL in step 1 first (it is not saved between page reloads).</p>}
      {error && <p className="error">{error}</p>}

      {status !== 'idle' && (
        <>
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
          <p>
            {progress.completed}/{progress.total} ({pct}%) · running hit rate <b>{progress.rate.toFixed(1)}%</b> · <span className="badge">{status}</span>
          </p>
          <table>
            <thead><tr><th>#</th><th>Query</th><th>Expected</th><th>Rank</th><th>Result</th></tr></thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.index}>
                  <td>{r.index + 1}</td><td>{r.query}</td><td className="wrap">{r.expected}</td>
                  <td>{r.status === 'error' ? '—' : r.rank ?? 'Not in top 10'}</td>
                  <td>{r.status === 'error' ? <span className="pill err" title={r.error}>error: {r.error}</span> : r.hit ? <span className="pill pass">pass</span> : <span className="pill fail">fail</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
