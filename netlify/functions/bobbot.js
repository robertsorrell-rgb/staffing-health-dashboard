'use strict';

const { ok, errorResponse, handleOptions, normalizeDateCell } = require('./_sheets.js');
const { readBobbotHistoryBody } = require('./lib/filter-today.js');
const { currentChicagoWeekSundayToSaturday } = require('./lib/ct.js');

/** Bobbot PTO history — hardcoded workbook/tab (no BOBBOT_* env required). */
const BOBBOT_SPREADSHEET_ID = '1gndsQQZdIJ5sr0XPP6aafRnQ95ZT4KXPQk5882To4F0';
const BOBBOT_TAB = 'Bobbot_History';
const CACHE_SEC = 300;

function decisionColumnIndex(headers) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  let i = lower.indexOf('decision');
  if (i >= 0) return i;
  i = lower.indexOf('status');
  if (i >= 0) return i;
  return lower.findIndex((h) => h === 'stage' || h.includes('decision'));
}

function isCancelledDecision(headers, row) {
  const di = decisionColumnIndex(headers);
  if (di < 0) return false;
  const raw = String(row[di] ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  return raw === 'CANCELLED' || raw === 'CANCELED';
}

/** True when decision/status indicates approved PTO (excludes denied / not approved / cancelled). */
function isApprovedDecision(headers, row) {
  const di = decisionColumnIndex(headers);
  if (di < 0) return false;
  const raw = String(row[di] ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!raw || raw === 'CANCELLED' || raw === 'CANCELED') return false;
  if (raw === 'DENIED' || raw.startsWith('DENIED')) return false;
  if (raw.includes('NOT APPROVED')) return false;
  return raw === 'APPROVED' || raw.startsWith('APPROVED ') || raw.includes('APPROVED');
}

/** Denied PTO requests only (excludes cancelled). Other outcomes (e.g. call-out) are not counted as denied. */
function isDeniedDecision(headers, row) {
  const di = decisionColumnIndex(headers);
  if (di < 0) return false;
  const raw = String(row[di] ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!raw || raw === 'CANCELLED' || raw === 'CANCELED') return false;
  return raw === 'DENIED' || raw.startsWith('DENIED ');
}

function rowMatchesAnyDate(row, dateCols, pred) {
  for (const ci of dateCols) {
    const ymd = normalizeDateCell(row[ci]);
    if (ymd && pred(ymd)) return true;
  }
  return false;
}

function salesGroupColumnIndex(headers) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (h === 'queue' || h.includes('sales group') || h.includes('sales_group')) return i;
  }
  return -1;
}

function hoursColumnIndex(headers) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  /** Bobbot_History uses `amount_raw` with values like "8 Hours" (not a bare number). */
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (h === 'amount_raw' || h === 'amount' || h.endsWith('_amount_raw')) return i;
  }
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (h === 'hours' || h === 'hour') return i;
  }
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (h.includes('pto_hour') || /\bpto\s*hours?\b/.test(h)) return i;
    if ((h.includes('requested') && h.includes('hour')) || h.includes('requested_hour')) return i;
  }
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (h.includes('duration')) return i;
  }
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (h.endsWith('_hours') || h.endsWith('_hrs')) return i;
  }
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (h.includes('hour') && !h.includes('timestamp') && !h.includes('time zone')) return i;
  }
  return -1;
}

function parseHoursCell(cell) {
  if (cell == null || cell === '') return 0;
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
  const s = String(cell).trim().replace(/,/g, '');
  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;
  // "8 Hours", "6.5 hrs", "2 Hour" (Bobbot amount_raw)
  const hm = s.match(/([\d.]+)\s*(?:hours?|hrs?)\b/i);
  if (hm) {
    const n = Number(hm[1]);
    return Number.isFinite(n) ? n : 0;
  }
  const lead = s.match(/^[\s]*([\d.]+)/);
  if (lead) {
    const n = Number(lead[1]);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Sun–Sat week in CT: rows where any request_date matches the range and decision predicate passes (not cancelled).
 */
function buildPtoWeekHoursByGroup(headers, rows, dateCols, weekStartYmd, weekEndYmd, decisionPred) {
  const queueI = salesGroupColumnIndex(headers);
  const hoursI = hoursColumnIndex(headers);
  const map = new Map();
  let rows_matched = 0;
  let rows_missing_hours_value = 0;

  for (const row of rows) {
    if (isCancelledDecision(headers, row)) continue;
    if (!rowMatchesAnyDate(row, dateCols, (ymd) => ymd >= weekStartYmd && ymd <= weekEndYmd)) {
      continue;
    }
    if (!decisionPred(headers, row)) continue;
    rows_matched += 1;
    const g = queueI >= 0 ? String(row[queueI] ?? '').trim() : '';
    const groupLabel = g || '—';
    let hrs = 0;
    if (hoursI >= 0) {
      const raw = row[hoursI];
      if (raw == null || raw === '') rows_missing_hours_value += 1;
      hrs = parseHoursCell(raw);
    }
    map.set(groupLabel, (map.get(groupLabel) || 0) + hrs);
  }

  const by_group = [...map.entries()]
    .map(([group, hours]) => ({
      group,
      hours: Math.round(hours * 100) / 100,
    }))
    .sort((a, b) => a.group.localeCompare(b.group));

  const total_hours = Math.round(by_group.reduce((s, r) => s + r.hours, 0) * 100) / 100;

  return {
    week_start: weekStartYmd,
    week_end: weekEndYmd,
    rows_matched,
    rows_missing_hours_value,
    hours_column_found: hoursI >= 0,
    queue_column_found: queueI >= 0,
    by_group,
    total_hours,
  };
}

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  try {
    const { headers, rows, dateColsForMatch, dateHeader, today } = await readBobbotHistoryBody(
      BOBBOT_SPREADSHEET_ID,
      BOBBOT_TAB,
      'A1:ZZ20000'
    );

    const rowsToday = rows.filter((row) =>
      rowMatchesAnyDate(row, dateColsForMatch, (ymd) => ymd === today)
    );

    const rowsVisible = rowsToday.filter((row) => !isCancelledDecision(headers, row));
    const nCancelled = rowsToday.length - rowsVisible.length;

    const weekMeta = currentChicagoWeekSundayToSaturday();
    const approvedBase = buildPtoWeekHoursByGroup(
      headers,
      rows,
      dateColsForMatch,
      weekMeta.week_start,
      weekMeta.week_end,
      isApprovedDecision
    );
    const deniedBase = buildPtoWeekHoursByGroup(
      headers,
      rows,
      dateColsForMatch,
      weekMeta.week_start,
      weekMeta.week_end,
      isDeniedDecision
    );

    const pto_week_approved = {
      ...approvedBase,
      label: weekMeta.label,
      by_group: approvedBase.by_group.map(({ group, hours }) => ({ group, approved_hours: hours })),
    };
    const pto_week_denied = {
      ...deniedBase,
      label: weekMeta.label,
      by_group: deniedBase.by_group.map(({ group, hours }) => ({ group, denied_hours: hours })),
    };

    const sheet_source_note = [
      `Sheet "${BOBBOT_TAB}"`,
      `Today column "${dateHeader || '?'}"`,
      `CT ${today}`,
      nCancelled > 0 ? `${nCancelled} cancelled hidden` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return ok(
      {
        configured: true,
        today,
        bobbot_tab: BOBBOT_TAB,
        date_column_used: dateHeader || null,
        sheet_source_note,
        summary: {
          rows_today: rowsVisible.length,
          rows_matched_date: rowsToday.length,
          rows_cancelled_excluded: nCancelled,
        },
        headers,
        /** All decision rows for request_date today except CANCELLED/CANCELED (preview cap). */
        rows_preview: rowsVisible.slice(0, 80),
        /** Approved / denied PTO hours by sales group for current Sun–Sat week (CT). */
        pto_week_approved,
        pto_week_denied,
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  } catch (err) {
    return errorResponse(err, 'bobbot');
  }
};
