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

module.exports = { parseHourHeader };
