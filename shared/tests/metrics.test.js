import assert from 'node:assert/strict';
import { computeMetrics, ratingForRank, gradeForRate } from '../metrics.js';

it('ratingForRank', () => {
  assert.deepEqual([1, 2, 3, 4, 10, null].map(ratingForRank), ['Excellent', 'Good', 'Good', 'Fair', 'Fair', 'Poor']);
});

it('gradeForRate with default and custom thresholds', () => {
  assert.deepEqual([95, 90, 80, 75, 60, 50, 49.9].map((x) => gradeForRate(x)),
    ['Excellent', 'Excellent', 'Good', 'Good', 'Needs improvement', 'Needs improvement', 'Poor']);
  assert.equal(gradeForRate(60, { excellent: 60 }), 'Excellent');
});

it('computeMetrics excludes errors and computes MRR / Hit@K / distribution', () => {
  const rows = [
    { status: 'ok', rank: 1 },
    { status: 'ok', rank: 2 },
    { status: 'ok', rank: 5 },
    { status: 'ok', rank: null },
    { status: 'error', rank: null },
  ];
  const m = computeMetrics(rows);
  assert.equal(m.scored, 4);
  assert.equal(m.errors, 1);
  assert.equal(m.hits, 3);
  assert.equal(m.hitRate, 75);
  assert.equal(m.grade, 'Good');
  assert.deepEqual([m.hitAt1.count, m.hitAt3.count, m.hitAt5.count, m.hitAt10.count], [1, 2, 3, 3]);
  assert.ok(Math.abs(m.mrr - (1 + 0.5 + 0.2) / 4) < 1e-9);
  assert.deepEqual(m.distribution, { rank1: 1, rank2to3: 1, rank4to10: 1, miss: 1 });
});

it('computeMetrics with no scored rows', () => {
  const m = computeMetrics([{ status: 'error', rank: null }]);
  assert.equal(m.hitRate, 0);
  assert.equal(m.grade, 'N/A');
});
