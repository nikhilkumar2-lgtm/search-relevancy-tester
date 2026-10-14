import { useState } from 'react';
import { api } from '../api.js';
import Field from './Field.jsx';

export default function SheetStep({ sheet, setSheet, onNext }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(''); setPreview(null); setBusy(true);
    try { setPreview(await api.previewSheet(sheet)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="card">
      <h2>Step 2 — Ground-truth Google Sheet</h2>
      <div className="grid">
        <Field label="Sheet link or ID" hint="Public “anyone with the link” sheets work out of the box; private ones need the service account (shared with its email).">
          <input value={sheet.sheet} onChange={(e) => setSheet({ ...sheet, sheet: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…" />
        </Field>
        <Field label="Tab name (optional)" hint="Defaults to the first tab (or the gid in the link)">
          <input value={sheet.tab} onChange={(e) => setSheet({ ...sheet, tab: e.target.value })} placeholder="Sheet1" />
        </Field>
      </div>
      <button disabled={busy || !sheet.sheet} onClick={load}>{busy ? 'Loading…' : 'Load & preview'}</button>
      {error && <p className="error">{error}</p>}
      {preview && (
        <>
          <p className="ok">
            {preview.total} rows found via {preview.mode}.
            {preview.duplicateQueries > 0 && ` ${preview.duplicateQueries} duplicated query(ies) will share one request.`}
            {preview.emptyExpected > 0 && ` ${preview.emptyExpected} row(s) have no expected value and will be reported as errors.`}
          </p>
          <table>
            <thead><tr><th>Row</th><th>Query</th><th>Expected</th></tr></thead>
            <tbody>{preview.rows.map((r) => <tr key={r.sheetRow}><td>{r.sheetRow}</td><td>{r.query}</td><td className="wrap">{r.expected}</td></tr>)}</tbody>
          </table>
          <div className="actions"><button className="primary" onClick={onNext}>Next: Run →</button></div>
        </>
      )}
    </section>
  );
}
