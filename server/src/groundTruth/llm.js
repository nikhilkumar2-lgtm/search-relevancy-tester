import axios from 'axios';
import { extractJsonArray } from '../../../shared/groundTruth.js';
import { config } from '../config.js';
import { HttpError } from '../utils/errors.js';

const FORMAT_CONTRACT = `

OUTPUT FORMAT (mandatory): reply with ONLY a JSON array, no prose and no code fences. It must contain exactly one object per input document, in the form {"id": <the document's id, unchanged>, "query": "<the search query>"}.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function resolveKey(provider, supplied) {
  const key = (supplied || (provider === 'anthropic' ? config.anthropicKey : config.openaiKey) || '').trim();
  if (!key) throw new HttpError(400, `No ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key: set it in .env or paste one in the form`);
  return key;
}

async function callProvider({ provider, apiKey, model, system, user, signal }) {
  if (provider === 'anthropic') {
    const { data } = await axios.post(
      `${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`,
      { model, max_tokens: 2048, system, messages: [{ role: 'user', content: user }] },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, timeout: 90_000, signal },
    );
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
  const { data } = await axios.post(
    `${process.env.OPENAI_BASE_URL || 'https://api.openai.com'}/v1/chat/completions`,
    { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 90_000, signal },
  );
  return data.choices?.[0]?.message?.content || '';
}

// Error text comes from the provider's error body only, never from request config (which holds the key).
const describe = (e) => e.response?.data?.error?.message || e.response?.data?.message || (e.response ? `HTTP ${e.response.status}` : e.code || e.message);

/**
 * docs: [{ id, title, content, style? }]. Returns Map(id -> query). Retries 429/5xx with backoff.
 */
export async function generateQueries({ provider, apiKey, model, prompt, docs, signal }) {
  const user = `Documents:\n${JSON.stringify(docs)}`;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal?.aborted) throw new Error('Cancelled');
    try {
      const text = await callProvider({ provider, apiKey, model, system: prompt + FORMAT_CONTRACT, user, signal });
      const out = new Map();
      for (const item of extractJsonArray(text)) {
        const q = String(item?.query ?? '').trim().replace(/\s+/g, ' ');
        if (item?.id !== undefined && q) out.set(String(item.id), q.slice(0, 300));
      }
      return out;
    } catch (e) {
      if (signal?.aborted) throw new Error('Cancelled');
      const status = e.response?.status;
      lastErr = new Error(describe(e));
      const retryable = status === 429 || status >= 500 || !e.response || /JSON array|Unexpected token/.test(e.message);
      if (status === 401 || status === 403 || status === 404 || !retryable || attempt === 3) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}
