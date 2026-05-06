'use strict';

/** First hour of slot from header like "6 AM–7 AM", "17–18", "17:00", or numeric hour */
function parseHourHeader(cell) {
  if (cell == null || cell === '') return null;
  const n = Number(cell);
  if (Number.isFinite(n) && n >= 0 && n <= 23 && Number.isInteger(n)) return n;
  const s = String(cell).trim();
  if (/^hour\b/i.test(s)) return null;
  const m = s.match(/(\d{1,2})\s*(AM|PM)/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const ap = m[2].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h >= 0 && h <= 23 ? h : null;
  }
  const m24 = s.match(/^(\d{1,2})\s*[–\-—]\s*(\d{1,2})/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    if (h >= 0 && h <= 23) return h;
  }
  /** Capacity Pull script style: `7:00A`, `12:30P` (before bare `H:MM` 24h parse). */
  const cap = s.match(/^(\d{1,2}):(\d{2})\s*([AP])/i);
  if (cap) {
    let h = parseInt(cap[1], 10);
    const ap = cap[3].toUpperCase();
    if (ap === 'P' && h !== 12) h += 12;
    if (ap === 'A' && h === 12) h = 0;
    return h >= 0 && h <= 23 ? h : null;
  }
  const mClock = s.match(/^(\d{1,2}):(\d{2})/);
  if (mClock) {
    const h = parseInt(mClock[1], 10);
    if (h >= 0 && h <= 23) return h;
  }
  return null;
}

/**
 * CS_Hourly_Log buckets: the sheet uses interval *start* in Hour Key / labels (e.g. `10 AM–11 AM`,
 * `2026-05-06 10`) while the hourly job logs the *completed* interval. The dashboard rolls up by the
 * clock hour when that interval **ends** so “current hour” in CT matches the latest row (end hour).
 *
 * @param {unknown} cell Hour Label cell
 * @returns {number | null} 0–23 end hour, or null
 */
function idleLogClosedHourBucketFromLabel(cell) {
  if (cell == null || cell === '') return null;
  const s = String(cell).trim();
  if (/^hour\b/i.test(s)) return null;

  const rangeAmPm = s.match(
    /(\d{1,2})\s*(AM|PM)\s*[–\-—]\s*(\d{1,2})\s*(AM|PM)/i
  );
  if (rangeAmPm) {
    let h = parseInt(rangeAmPm[3], 10);
    const ap = rangeAmPm[4].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h >= 0 && h <= 23 ? h : null;
  }

  const range24 = s.match(/^(\d{1,2})\s*[–\-—]\s*(\d{1,2})\s*$/);
  if (range24) {
    const h = parseInt(range24[2], 10);
    if (h >= 0 && h <= 23) return h;
  }

  const start = parseHourHeader(cell);
  if (start == null) return null;
  return (start + 1) % 24;
}

/**
 * Hour Key `YYYY-MM-DD HH` — trailing HH is interval **start** (same as Hour Label start).
 * @param {string} hk
 * @returns {number | null}
 */
function idleLogClosedHourBucketFromHourKey(hk) {
  const s = String(hk || '').trim();
  const m = s.match(/\s(\d{1,2})$/);
  if (m) {
    const start = parseInt(m[1], 10);
    if (start >= 0 && start <= 23) return (start + 1) % 24;
  }
  const hr = parseHourHeader(s);
  return hr == null ? null : (hr + 1) % 24;
}

module.exports = {
  parseHourHeader,
  idleLogClosedHourBucketFromLabel,
  idleLogClosedHourBucketFromHourKey,
};
