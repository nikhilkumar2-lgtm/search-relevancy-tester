# Search Relevancy Evaluator

Replays a working search-API cURL once per query from a Google Sheet, swaps **only** the query, checks whether the
expected result is in the top 10, and reports per-query and overall relevancy (hit rate, Hit@1/3/5/10, MRR@10,
rank distribution, grade). No database: runs are saved as JSON in `data/runs/<runId>.json`.

```
server/   Express API (runner, SSE, Sheets, Excel (.xlsx) export (`?format=csv` for CSV))
client/   React + Vite UI
shared/   Pure logic used by the server and covered by tests: query replacement, matching, metrics
```

## Setup

Requires Node 16+ (18+ recommended).

```bash
npm run install:all        # root, server and client dependencies
cp .env.example .env       # optional – only needed for private sheets / write-back
npm run dev                # API on :4000, UI on http://localhost:5173
npm test                   # unit tests (query replacement, matching, metrics)
```

Production-style: `npm run build && npm start` serves the UI and API together on http://localhost:4000.

### .env

```
PORT=4000
CORS_ORIGIN=http://localhost:5173
DATA_DIR=data
GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/key.json   # or GOOGLE_SERVICE_ACCOUNT_JSON (raw or base64)
```

Without a service account the app reads **public** sheets ("Anyone with the link can view") through the Excel (.xlsx) export (`?format=csv` for CSV) URL.
With one, share the sheet with the service account's e-mail (Editor if you want write-back).

## Sample sheet layout

| Query | Expected URL |
|---|---|
| reset password | https://support.example.com/s/article/reset-password |
| how to export report | https://support.example.com/s/article/export-report/ |

Row 1 is a header (columns containing "query" and "expected/url/id/title" are detected; otherwise columns A and B are used).
See `samples/sample-sheet.csv`.

## Using it

1. **cURL & mapping** – paste the cURL (line breaks without `\` are fine). The query can be located by
   `{{QUERY}}` (or the original query text) in the URL/headers/body, **or** by a JSON body path such as `searchString`,
   which works even when the field is empty. *Body overrides* are fixed values applied to every request –
   the defaults (`searchString` + `{"aggregations": []}`) match the SearchUnify cURL. Use **Send test request** to see the
   response and confirm the *response path* (default `result.hits`) and *match field* (default `href`) — adjust them to your API.
2. **Google Sheet** – paste the link/ID (+ optional tab) and preview.
3. **Run** – live progress, running hit rate and live table; cancel at any time (partial results are kept).
4. **Results / History** – dashboard, filterable table (click a row for the top 10 with the expected result highlighted), Excel (.xlsx) export (`?format=csv` for CSV).

## Behaviour notes

- Rank 1 Excellent, 2–3 Good, 4–10 Fair, miss Poor. Grade thresholds (90/75/50) are editable in step 3.
- Errored queries (network, HTTP error, bad response path, empty query, empty expected value) are listed separately and
  excluded from the rate. An empty result list is a valid miss, not an error.
- Duplicate queries share one HTTP request and are ranked against their own expected value.
- 429 / 5xx / network errors retry with exponential backoff (honours `Retry-After`).
- Requests use an IPv4-only agent. Cookies/tokens from the cURL are held in memory for the run only; the saved run JSON stores a redacted request description, and nothing secret is logged.
- SSE (`/api/run/:id/stream`) sends `snapshot`, `progress`, `done` events with a 15 s heartbeat; no compression middleware is used.
- The tool makes requests to whatever URL you paste – run it locally, don't expose it publicly.

## API

`POST /api/run` · `GET /api/run/:id/stream` · `GET /api/run/:id` · `GET /api/runs` · `GET /api/run/:id/export` ·
`POST /api/run/:id/cancel` · `POST /api/run/:id/writeback` · `POST /api/sheet/preview` · `POST /api/test`

## Generate ground truth (separate tab)

Builds a ground-truth sheet for you: calls your cURL with a **blank query** and your **aggregations**, samples documents from
random result pages, asks an LLM (Claude or OpenAI) for one search query per document, and exports Excel with columns
`Query | Expected | URL | Aggregation | Type | Doc ID` (an `Info` sheet records the prompt/model). **Calculate how many calls** shows the total
matching documents, search requests, LLM calls and approximate input tokens before you spend anything.
Pick **Keyword** or **Hybrid** — each has an editable default prompt (the JSON output format is appended automatically).
Keys come from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in `.env`, or paste one in the form (memory only).

With several aggregations, each entry is sampled on its own and the requested count is split evenly (50 queries over 2 aggregations = 25 each;
if one has fewer documents than its share, the shortfall goes to the others). Put several values in one aggregation row to keep them as a single filter.

## Deploy (Render API + Netlify UI)

1. **Render** → New → *Blueprint* → pick this repo (uses `render.yaml`). Set `CORS_ORIGIN` to your Netlify URL (you can fill it in after step 2) and optionally the LLM keys. Copy the generated `ACCESS_TOKEN` from the service's environment tab.
2. **Netlify** → Add new site → import this repo (uses `netlify.toml`). Add the environment variable `VITE_API_URL` = your Render URL (e.g. `https://relevancy-api.onrender.com`), then deploy.
3. Open the Netlify URL and enter the access token.

Without `ACCESS_TOKEN` anyone with the link can use your LLM keys and make the server call arbitrary URLs — always set it on a public deployment.
The Render free plan sleeps when idle (first request is slow) and its disk is ephemeral, so run history is lost on redeploy.
