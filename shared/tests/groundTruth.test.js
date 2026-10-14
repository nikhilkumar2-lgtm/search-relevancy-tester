import assert from 'node:assert/strict';
import { allocateQuotas, planPages, pickPages, extractJsonArray, textOf } from '../groundTruth.js';

it('planPages computes pages and LLM calls', () => {
  const p = planPages({ total: 1589, count: 100, pageSize: 10, docsPerCall: 5 });
  assert.deepEqual(p, { available: 1589, docsTarget: 100, pagesAvailable: 159, pagesToFetch: 12, searchCalls: 12, llmCalls: 20 });
});

it('planPages caps at what exists and at the 10k window', () => {
  const small = planPages({ total: 23, count: 100, pageSize: 10, docsPerCall: 5 });
  assert.equal(small.docsTarget, 23);
  assert.equal(small.pagesToFetch, 3);
  assert.equal(small.llmCalls, 5);
  assert.equal(planPages({ total: 50000, count: 5, pageSize: 10 }).available, 10000);
  assert.equal(planPages({ total: 0, count: 5, pageSize: 10 }).pagesToFetch, 0);
});

it('pickPages returns distinct sorted in-range pages', () => {
  const p = pickPages(159, 12);
  assert.equal(new Set(p).size, 12);
  assert.ok(p.every((x, i) => x >= 0 && x < 159 && (i === 0 || x > p[i - 1])));
  assert.deepEqual(pickPages(3, 10), [0, 1, 2]);
});

it('extractJsonArray handles fences and prose', () => {
  assert.deepEqual(extractJsonArray('```json\n[{"id":"a","query":"x"}]\n```'), [{ id: 'a', query: 'x' }]);
  assert.deepEqual(extractJsonArray('Sure! [{"id":1,"query":"q"}] done'), [{ id: 1, query: 'q' }]);
  assert.throws(() => extractJsonArray('no json here'), /JSON array/);
});

it('textOf flattens arrays', () => {
  assert.equal(textOf(['a', 'b']), 'a b');
  assert.equal(textOf(undefined), '');
});

it('allocateQuotas splits evenly and redistributes the shortfall', () => {
  assert.deepEqual(allocateQuotas(50, [1000, 1000]), [25, 25]);
  assert.deepEqual(allocateQuotas(50, [1000, 1000, 1000]), [17, 17, 16]);
  assert.deepEqual(allocateQuotas(50, [10, 1000]), [10, 40]);
  assert.deepEqual(allocateQuotas(50, [10, 5]), [10, 5]);
  assert.deepEqual(allocateQuotas(7, [0, 100]), [0, 7]);
});
