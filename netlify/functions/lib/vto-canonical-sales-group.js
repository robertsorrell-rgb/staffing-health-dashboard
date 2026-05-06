'use strict';

/**
 * Normalize sheet queue/role text for rule matching (case, underscores, hyphens).
 * @param {string} raw
 * @returns {string}
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

/**
 * Map raw Queue (Offers) or Role (Requests_Submissions) to a single dashboard bucket
 * so Targeted + Automated VTO roll up consistently.
 * Unknown labels are returned unchanged (trimmed).
 *
 * @param {string} raw
 * @returns {string}
 */
function canonicalVtoSalesGroup(raw) {
  const original = String(raw || '').trim();
  const k = normKey(original);
  if (!k) return original || 'Unknown';

  if (k === 'pc') return 'Prof Certs';

  if (k.includes('prof cert')) return 'Prof Certs';

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
 * Re-aggregate automated VTO rollups by canonical group and tag rows with optional role_raw.
 * @param {object} auto rollup object from rollupAutoVtoApproved
 */
function applyCanonicalToAutomatedRollup(auto) {
  if (!auto) return auto;

  const byCanon = new Map();
  for (const r of auto.by_role || []) {
    const roleCanon = canonicalVtoSalesGroup(r.role);
    const key = roleCanon.toLowerCase();
    if (!byCanon.has(key)) {
      byCanon.set(key, { role: roleCanon, approved: 0, hours: 0 });
    }
    const x = byCanon.get(key);
    x.approved += r.approved || 0;
    x.hours += Number(r.hours) || 0;
  }

  const by_role = Array.from(byCanon.values())
    .map((r) => ({ ...r, hours: Math.round(r.hours * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours || b.approved - a.approved);

  const approved_rows = (auto.approved_rows || []).map((row) => {
    const raw = String(row.role || '').trim();
    const c = canonicalVtoSalesGroup(raw);
    const out = { ...row, role: c };
    if (raw && c !== raw) out.role_raw = raw;
    return out;
  });

  return { ...auto, by_role, approved_rows };
}

module.exports = {
  canonicalVtoSalesGroup,
  applyCanonicalToAutomatedRollup,
};
