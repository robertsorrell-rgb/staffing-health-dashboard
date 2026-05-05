/**
 * Keep in sync with netlify/functions/lib/vto-canonical-sales-group.js
 * (browser bundle cannot require Node modules).
 */

function normKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalVtoSalesGroup(raw) {
  const original = String(raw || '').trim();
  const k = normKey(original);
  if (!k) return original || 'Unknown';

  if (k === 'pc') return 'Prof Certs';

  if (k.includes('grad test prep') || (k.includes('college') && k.includes('grad'))) {
    return 'College';
  }

  if (k.includes('high school')) return 'High School';

  if (
    /\bk\s*6\b/.test(k) ||
    /\beld\b/.test(k) ||
    /\belementary\b/.test(k) ||
    k.includes('learning difference')
  ) {
    return 'Elementary';
  }

  if (/\bcore\b/.test(k) || /\blanguages\b/.test(k)) {
    return 'Adult Learning';
  }

  return original;
}

/**
 * Re-merge combined.by_group rows so stale API payloads (or pre-canonical servers)
 * still roll up High School SC + High School_CC90_New, etc.
 * @param {{ group: string, targeted_hours?: number, automated_hours?: number, total_hours?: number }[]} rows
 */
export function mergeCombinedByGroupRows(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const group = canonicalVtoSalesGroup(r.group);
    const k = group.toLowerCase();
    const th = Number(r.targeted_hours) || 0;
    const ah = Number(r.automated_hours) || 0;
    if (!map.has(k)) {
      map.set(k, { group, targeted_hours: 0, automated_hours: 0 });
    }
    const c = map.get(k);
    c.targeted_hours += th;
    c.automated_hours += ah;
  }
  return Array.from(map.values())
    .map((r) => {
      const targeted_hours = Math.round(r.targeted_hours * 100) / 100;
      const automated_hours = Math.round(r.automated_hours * 100) / 100;
      const total_hours = Math.round((targeted_hours + automated_hours) * 100) / 100;
      return { group: r.group, targeted_hours, automated_hours, total_hours };
    })
    .sort((a, b) => b.total_hours - a.total_hours || a.group.localeCompare(b.group));
}
