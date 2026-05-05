'use strict';

const { parseSheetNumber } = require('../_sheets.js');

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDecision(v) {
  return String(v || '').trim().toUpperCase();
}

function detectCols(headers) {
  const hs = (headers || []).map(normalizeHeader);
  let rep = hs.findIndex((h) => h === 'rep name' || h === 'name' || h.includes('rep'));
  let role = hs.findIndex((h) => h === 'role' || h === 'queue' || /sales group/.test(h));
  let hours = hs.findIndex((h) => h === 'hours' || /^hours\b/.test(h) || /requested hours/.test(h));
  let decision = hs.findIndex((h) => h === 'decision' || /decision/.test(h));
  let dateRequested = hs.findIndex((h) => h === 'date requested');
  let timestamp = hs.findIndex((h) => h === 'timestamp');

  // Stable fallback to Requests_Submissions contract columns.
  if (rep < 0) rep = 3; // D
  if (role < 0) role = 4; // E
  if (dateRequested < 0) dateRequested = 5; // F
  if (hours < 0) hours = 8; // I
  if (decision < 0) decision = 9; // J
  if (timestamp < 0) timestamp = 0; // A
  return { rep, role, dateRequested, hours, decision, timestamp };
}

function rollupAutoVtoApproved(rowsToday, headers) {
  const col = detectCols(headers);
  let approvedCount = 0;
  let approvedHours = 0;
  const byRole = {};
  const approved_rows = [];

  for (const row of rowsToday || []) {
    const d = normalizeDecision(row[col.decision]);
    if (d !== 'APPROVED') continue;
    approvedCount += 1;

    const hoursNum = parseSheetNumber(row[col.hours]);
    const hours = hoursNum != null && Number.isFinite(hoursNum) && hoursNum >= 0 ? hoursNum : null;
    if (hours != null) approvedHours += hours;

    const role = String(row[col.role] || '').trim() || 'Unknown';
    if (!byRole[role]) byRole[role] = { role, approved: 0, hours: 0 };
    byRole[role].approved += 1;
    if (hours != null) byRole[role].hours += hours;

    approved_rows.push({
      rep: String(row[col.rep] || '').trim(),
      role,
      hours,
      date_requested: String(row[col.dateRequested] || '').trim(),
      timestamp: String(row[col.timestamp] || '').trim(),
    });
  }

  const by_role = Object.values(byRole)
    .map((r) => ({ ...r, hours: Math.round(r.hours * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours || b.approved - a.approved);

  return {
    approved_today: approvedCount,
    hours_approved_today: Math.round(approvedHours * 100) / 100,
    by_role,
    approved_rows: approved_rows.slice(0, 100),
    columns_used: col,
  };
}

module.exports = { rollupAutoVtoApproved };
