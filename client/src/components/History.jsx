import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function History({ onOpen }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.listRuns().then(setRuns).catch((e) => setError(e.message)); }, []);

  return (
    <section className="card">
      <h2>Run history</h2>
      {error && <p className="error">{error}</p>}
      {runs && !runs.length && <p className="hint">No runs yet.</p>}
      {runs && runs.length > 0 && (
        <table>
          <thead><tr><th>Started</th><th>Status</th><th>Queries</th><th>Hit rate</th><th>Grade</th><th>MRR</th><th></th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.startedAt).toLocaleString()}</td>
                <td>{r.status}</td>
                <td>{r.metrics?.totalRows ?? 0}/{r.total}</td>
                <td>{r.metrics ? `${r.metrics.hitRate.toFixed(1)}%` : '—'}</td>
                <td>{r.metrics?.grade}</td>
                <td>{r.metrics ? r.metrics.mrr.toFixed(3) : '—'}</td>
                <td><button onClick={() => onOpen(r.id)}>Open</button> <a className="button" href={api.exportUrl(r.id)}>Excel</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
