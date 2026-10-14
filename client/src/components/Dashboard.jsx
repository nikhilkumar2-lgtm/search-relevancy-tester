import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';

const GRADE_CLASS = { Excellent: 'g-ex', Good: 'g-good', 'Needs improvement': 'g-mid', Poor: 'g-poor', 'N/A': '' };
const fmt = (n) => `${n.toFixed(1)}%`;

function Card({ label, value, sub }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{sub && <div className="stat-sub">{sub}</div>}</div>;
}

function Distribution({ dist, total }) {
  const items = [
    ['Rank 1', dist.rank1, 'c-ex'], ['Rank 2–3', dist.rank2to3, 'c-good'], ['Rank 4–10', dist.rank4to10, 'c-mid'], ['Not in top 10', dist.miss, 'c-poor'],
  ];
  return (
    <div className="dist">
      {items.map(([label, n, cls]) => (
        <div className="dist-row" key={label}>
          <span className="dist-label">{label}</span>
          <div className="bar"><div className={cls} style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></div>
          <span className="dist-n">{n} ({total ? Math.round((n / total) * 100) : 0}%)</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ runId, serviceAccount }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!runId) return;
    setRun(null); setError('');
    api.getRun(runId).then(setRun).catch((e) => setError(e.message));
  }, [runId]);

  if (!runId) return <section className="card"><p>No run selected. Start a run or open one from History.</p></section>;
  if (error) return <section className="card"><p className="error">{error}</p></section>;
  if (!run) return <section className="card"><p>Loading…</p></section>;

  const m = run.metrics;
  const errors = run.results.filter((r) => r.status === 'error');
  const visible = run.results.filter((r) => {
    if (filter === 'hits') return r.status === 'ok' && r.hit;
    if (filter === 'misses') return r.status === 'ok' && !r.hit;
    if (filter === 'errors') return r.status === 'error';
    return true;
  });

  const writeBack = async () => {
    setNote('');
    try { setNote(`Written to tab “${(await api.writeBack(run.id)).tab}”`); } catch (e) { setNote(e.message); }
  };

  return (
    <section className="card">
      <div className="row between">
        <h2>Results <small>({run.status}, {new Date(run.startedAt).toLocaleString()})</small></h2>
        <div className="row">
          <a className="button" href={api.exportUrl(run.id)}>Export Excel</a>
          {serviceAccount && <button onClick={writeBack}>Write to sheet</button>}
        </div>
      </div>
      {note && <p className="hint">{note}</p>}
      {run.writeBack && <p className={run.writeBack.ok ? 'ok' : 'error'}>{run.writeBack.ok ? `Written to tab “${run.writeBack.tab}”` : `Write-back failed: ${run.writeBack.error}`}</p>}
      {run.status === 'cancelled' && <p className="hint">This run was cancelled — metrics cover the {m.totalRows} completed queries only.</p>}

      <div className="hero">
        <div>
          <div className="stat-label">Top-10 hit rate</div>
          <div className="hero-value">{fmt(m.hitRate)}</div>
          <div className="stat-sub">{m.hits} of {m.scored} scored queries</div>
        </div>
        <div className={`grade ${GRADE_CLASS[m.grade]}`}>{m.grade}</div>
      </div>

      <div className="stats">
        <Card label="Hit@1" value={fmt(m.hitAt1.pct)} sub={`${m.hitAt1.count} queries`} />
        <Card label="Hit@3" value={fmt(m.hitAt3.pct)} sub={`${m.hitAt3.count} queries`} />
        <Card label="Hit@5" value={fmt(m.hitAt5.pct)} sub={`${m.hitAt5.count} queries`} />
        <Card label="Hit@10" value={fmt(m.hitAt10.pct)} sub={`${m.hitAt10.count} queries`} />
        <Card label="MRR@10" value={m.mrr.toFixed(3)} />
        <Card label="Errored (excluded)" value={m.errors} sub={`of ${m.totalRows} rows`} />
      </div>

      <h3>Rank distribution</h3>
      <Distribution dist={m.distribution} total={m.scored} />

      <div className="filters">
        {[['all', `All (${run.results.length})`], ['hits', 'Hits'], ['misses', 'Misses'], ['errors', `Errors (${errors.length})`]].map(([k, label]) => (
          <button key={k} className={filter === k ? 'tab active' : 'tab'} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      <table>
        <thead><tr><th></th><th>Query</th><th>Expected</th><th>Rank</th><th>Rating</th><th>HTTP</th><th>Latency</th></tr></thead>
        <tbody>
          {visible.map((r) => (
            <Fragment key={r.index}>
              <tr className="clickable" onClick={() => setOpen(open === r.index ? null : r.index)}>
                <td>{open === r.index ? '▾' : '▸'}</td>
                <td>{r.query}</td>
                <td className="wrap">{r.expected}</td>
                <td>{r.status === 'error' ? '—' : r.rank ?? 'Not in top 10'}</td>
                <td>{r.status === 'error' ? <span className="pill err">error</span> : <span className={`pill r-${r.rating.toLowerCase()}`}>{r.rating}</span>}</td>
                <td>{r.httpStatus ?? '—'}</td>
                <td>{r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</td>
              </tr>
              {open === r.index && (
                <tr className="detail"><td colSpan={7}>
                  {r.error && <p className="error">{r.error}</p>}
                  {r.results.length === 0 && !r.error && <p className="hint">The search returned no results.</p>}
                  <ol className="top10">
                    {r.results.map((x) => (
                      <li key={x.rank} className={x.isMatch ? 'match' : ''} value={x.rank}>
                        <code>{x.value || '(empty)'}</code>{x.title && <small> — {x.title}</small>}{x.isMatch && <b> ← expected</b>}
                      </li>
                    ))}
                  </ol>
                </td></tr>
              )}
            </Fragment>
          ))}
          {!visible.length && <tr><td colSpan={7} className="hint">Nothing to show for this filter.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
