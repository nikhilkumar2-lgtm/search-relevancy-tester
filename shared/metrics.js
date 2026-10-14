// Per-query rating and overall metric calculation (top-10 based).

export const DEFAULT_THRESHOLDS = { excellent: 90, good: 75, fair: 50 };

export function ratingForRank(rank) {
  if (rank === 1) return 'Excellent';
  if (rank >= 2 && rank <= 3) return 'Good';
  if (rank >= 4 && rank <= 10) return 'Fair';
  return 'Poor';
}

export function gradeForRate(ratePct, t = DEFAULT_THRESHOLDS) {
  const th = { ...DEFAULT_THRESHOLDS, ...t };
  if (ratePct >= th.excellent) return 'Excellent';
  if (ratePct >= th.good) return 'Good';
  if (ratePct >= th.fair) return 'Needs improvement';
  return 'Poor';
}

const pct = (n, d) => (d ? (n / d) * 100 : 0);

/** rows: [{ status: 'ok'|'error', rank: number|null }] */
export function computeMetrics(rows, thresholds = DEFAULT_THRESHOLDS) {
  const scored = rows.filter((r) => r.status === 'ok');
  const total = scored.length;
  const errors = rows.length - total;
  const hitAt = (k) => scored.filter((r) => r.rank !== null && r.rank <= k).length;
  const dist = { rank1: 0, rank2to3: 0, rank4to10: 0, miss: 0 };
  let rr = 0;
  for (const r of scored) {
    if (r.rank === null) dist.miss++;
    else {
      rr += 1 / r.rank;
      if (r.rank === 1) dist.rank1++;
      else if (r.rank <= 3) dist.rank2to3++;
      else dist.rank4to10++;
    }
  }
  const hits10 = hitAt(10);
  const hitRate = pct(hits10, total);
  return {
    totalRows: rows.length,
    scored: total,
    errors,
    hits: hits10,
    hitRate,
    grade: total ? gradeForRate(hitRate, thresholds) : 'N/A',
    hitAt1: { count: hitAt(1), pct: pct(hitAt(1), total) },
    hitAt3: { count: hitAt(3), pct: pct(hitAt(3), total) },
    hitAt5: { count: hitAt(5), pct: pct(hitAt(5), total) },
    hitAt10: { count: hits10, pct: hitRate },
    mrr: total ? rr / total : 0,
    distribution: dist,
  };
}
