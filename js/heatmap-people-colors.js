/**
 * Net staffing heatmap — Assembled people units only.
 * Positives: adaptive green (separate max for Aggregate vs all other rows).
 * Negatives: fixed bands — yellow / orange / red (same for every row).
 */

function isAggregateRow(group) {
  return /^aggregate$/i.test(String(group || '').trim());
}

/** Max of values >= 0 across included rows × hours (for adaptive green ceiling). */
export function computePeopleHeatmapMaxes(matrix, hours) {
  let maxAgg = 0;
  let maxGroups = 0;
  if (!matrix || !hours) return { maxAgg: 0, maxGroups: 0 };

  for (const row of matrix) {
    const agg = isAggregateRow(row.group);
    const hmap = row.hours || {};
    for (const h of hours) {
      const v = hmap[String(h)];
      if (v == null || Number.isNaN(Number(v))) continue;
      const n = Number(v);
      if (n < 0) continue;
      if (agg) maxAgg = Math.max(maxAgg, n);
      else maxGroups = Math.max(maxGroups, n);
    }
  }
  return { maxAgg, maxGroups };
}

/** Pastel green ramp: low saturation, lifted lightness; dark end stays soft (not neon). */
function greenAtT(t) {
  const u = Math.min(1, Math.max(0, t));
  const h = 138 + u * 14;
  const s = 16 + u * 26;
  const l = 94 - u * 38;
  return { bg: `hsl(${h}, ${s}%, ${l}%)`, fg: l < 58 ? '#f7faf8' : '#2a3d32' };
}

/**
 * @returns {{ className: string, style: Record<string, string> }}
 */
export function peopleHeatmapCellStyle(value, isAggregate, maxAgg, maxGroups) {
  const v = Number(value);
  if (Number.isNaN(v)) {
    return { className: 'hm-neutral', style: {} };
  }

  // Negatives — same ladder for Aggregate and queue rows
  if (v < 0) {
    if (v <= -3.1) {
      return {
        className: 'heatmap-cell-people',
        style: { backgroundColor: 'hsl(355, 56%, 82%)', color: 'hsl(355, 45%, 22%)' },
      };
    }
    if (v <= -2.1) {
      return {
        className: 'heatmap-cell-people',
        style: { backgroundColor: 'hsl(28, 68%, 82%)', color: 'hsl(22, 48%, 24%)' },
      };
    }
    if (v <= -0.1) {
      return {
        className: 'heatmap-cell-people',
        style: { backgroundColor: 'hsl(46, 72%, 81%)', color: 'hsl(38, 40%, 22%)' },
      };
    }
    // (-0.1, 0)
    return {
      className: 'heatmap-cell-people',
      style: { backgroundColor: 'hsl(48, 58%, 90%)', color: 'hsl(200, 14%, 28%)' },
    };
  }

  // Zero / positives — adaptive green
  const maxPos = isAggregate ? maxAgg : maxGroups;
  const denom = Math.max(maxPos, 1e-9);
  const t = Math.min(1, v / denom);
  const { bg, fg } = greenAtT(t);
  return {
    className: 'heatmap-cell-people',
    style: { backgroundColor: bg, color: fg },
  };
}
