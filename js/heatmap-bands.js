/**
 * Net staffing heatmap — asymmetric bands (plan default).
 * d = signed % deviation from target (negative = understaffed).
 * Tune here without hunting through render logic.
 */
export const HEATMAP_BANDS_DOC = {
  green: '−10% ≤ d ≤ +10%',
  yellow_under: '−20% ≤ d < −10%',
  red_under: 'd < −20%',
  yellow_over: '+10% < d ≤ +25%',
  red_over: 'd > +25%',
};

/** Returns CSS class suffix for heat cell */
export function heatmapBandClass(d) {
  if (d == null || Number.isNaN(d)) return 'hm-neutral';
  if (d >= -10 && d <= 10) return 'hm-green';
  if (d >= -20 && d < -10) return 'hm-yellow-under';
  if (d < -20) return 'hm-red-under';
  if (d > 10 && d <= 25) return 'hm-yellow-over';
  if (d > 25) return 'hm-red-over';
  return 'hm-neutral';
}
