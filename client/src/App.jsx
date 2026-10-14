import { useEffect, useState } from 'react';
import { api } from './api.js';
import CurlStep from './components/CurlStep.jsx';
import SheetStep from './components/SheetStep.jsx';
import RunStep from './components/RunStep.jsx';
import Dashboard from './components/Dashboard.jsx';
import History from './components/History.jsx';
import GroundTruth from './components/GroundTruth.jsx';

const SAMPLE_CURL = `curl 'https://your-host.example.com/search/SUSearchResults' \\
  -H 'content-type: application/json' \\
  -H 'authorization: bearer <TOKEN>' \\
  -b '<COOKIES>' \\
  --data-raw '{"searchString":"{{QUERY}}","from":0,"resultsPerPage":10,"aggregations":[]}'`;

// Defaults match the SearchUnify setup: only searchString changes and aggregations are blanked.
const DEFAULT_SETTINGS = {
  queryToken: '{{QUERY}}',
  queryJsonPath: 'searchString',
  bodyOverrides: '{"aggregations": []}',
  responsePath: 'result.hits',
  matchField: 'highlight.TitleToDisplayString',
  displayField: 'highlight.TitleToDisplayString',
  matchMode: 'normalized',
  concurrency: 3,
  delayMs: 200,
  timeoutMs: 15000,
  retries: 1,
  thresholds: { excellent: 90, good: 75, fair: 50 },
  writeBack: false,
};

// The cURL (cookies / tokens) is deliberately kept in memory only, never in localStorage.
const load = (key, fallback) => {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key)) }; } catch { return fallback; }
};

const STEPS = ['1. cURL & mapping', '2. Google Sheet', '3. Run', 'Results', 'History', 'Generate ground truth'];

export default function App() {
  const [step, setStep] = useState(0);
  const [curl, setCurl] = useState('');
  const [settings, setSettings] = useState(() => load('rel.settings3', DEFAULT_SETTINGS));
  const [sheet, setSheet] = useState(() => load('rel.sheet', { sheet: '', tab: '' }));
  const [runId, setRunId] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => localStorage.setItem('rel.settings3', JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem('rel.sheet', JSON.stringify(sheet)), [sheet]);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ error: true })); }, []);

  const openRun = (id) => { setRunId(id); setStep(3); };

  return (
    <div className="app">
      <header>
        <h1>Search Relevancy Evaluator</h1>
        {health?.error && <span className="badge bad">API offline</span>}
        {health?.googleMode && <span className="badge">Sheets: {health.googleMode === 'service-account' ? 'service account' : 'public CSV'}</span>}
      </header>
      <nav>
        {STEPS.map((s, i) => (
          <button key={s} className={i === step ? 'tab active' : 'tab'} onClick={() => setStep(i)}>{s}</button>
        ))}
      </nav>
      {step === 0 && <CurlStep curl={curl} setCurl={setCurl} settings={settings} setSettings={setSettings} sample={SAMPLE_CURL} onNext={() => setStep(1)} />}
      {step === 1 && <SheetStep sheet={sheet} setSheet={setSheet} onNext={() => setStep(2)} />}
      {step === 2 && <RunStep curl={curl} settings={settings} setSettings={setSettings} sheet={sheet} serviceAccount={health?.googleMode === 'service-account'} onFinished={(id) => setRunId(id)} onOpen={openRun} />}
      {step === 3 && <Dashboard runId={runId} serviceAccount={health?.googleMode === 'service-account'} />}
      {step === 4 && <History onOpen={openRun} />}
      {step === 5 && <GroundTruth evaluatorCurl={curl} />}
    </div>
  );
}
