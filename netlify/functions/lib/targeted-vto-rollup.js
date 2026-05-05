'use strict';

const { parseSheetNumber } = require('../_sheets.js');

const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Sheets serial datetime → readable string in America/Chicago. */
function serialToChicagoDateTime(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return '';
  const ms = SHEETS_EPOCH_MS + serial * 86400000;
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Fractional serial days → hours between two sheet datetimes. */
function hoursFromStartEnd(startCell, endCell) {
  const s = parseSheetNumber(startCell);
  const e = parseSheetNumber(endCell);
  if (s == null || e == null || !Number.isFinite(e - s)) return null;
  const h = (e - s) * 24;
  if (!Number.isFinite(h) || h < 0 || h > 24 * 14) return null;
  return Math.round(h * 100) / 100;
}

function normalizeHeaderLabel(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function findHoldHoursColumn(headers, H) {
  const specificRes = [
    /^hold\s+hours$/i,
    /hours\s+approved/i,
    /approved\s+hours/i,
    /vto\s+hours/i,
    /grant(ed)?\s+hours/i,
  ];
  for (const re of specificRes) {
    for (let i = 0; i < headers.length; i++) {
      const raw = String(headers[i] || '').trim();
      const norm = H[i];
      if (re.test(norm) || re.test(raw)) return { idx: i, label: raw };
    }
  }
  for (let i = 0; i < headers.length; i++) {
    const raw = String(headers[i] || '').trim();
    const norm = H[i];
    if (/^hours$/i.test(norm)) return { idx: i, label: raw };
  }
  return { idx: -1, label: null };
}

function detectOffersColumns(headers) {
  const H = headers.map(normalizeHeaderLabel);
  const idx = (want) => H.indexOf(want);

  const hold = findHoldHoursColumn(headers, H);
  const holdHours = hold.idx;
  const holdHoursHeader = hold.label;

  let sentAt = idx('sent at');
  if (sentAt < 0) sentAt = H.findIndex((h) => h.includes('sent') && h.includes('at'));

  let queue = idx('queue');
  if (queue < 0) queue = H.findIndex((h) => h.includes('sales group'));

  let start = idx('start');
  if (start < 0) start = H.findIndex((h) => h === 'slot start' || h === 'offer start');

  let end = idx('end');
  if (end < 0) end = H.findIndex((h) => h === 'slot end' || h === 'offer end');

  const name = idx('name') >= 0 ? idx('name') : H.findIndex((h) => h === 'agent name');

  return {
    sent_at: sentAt,
    queue,
    start,
    end,
    hold_hours: holdHours,
    hold_hours_header: holdHoursHeader,
    name,
  };
}

function rowHours(row, cols, stats) {
  if (cols.hold_hours >= 0) {
    const v = parseSheetNumber(row[cols.hold_hours]);
    if (v != null && v >= 0 && v <= 24 * 14) {
      stats.used_hold_column += 1;
      return Math.round(v * 100) / 100;
    }
  }
  if (cols.start >= 0 && cols.end >= 0) {
    const delta = hoursFromStartEnd(row[cols.start], row[cols.end]);
    if (delta != null) {
      stats.used_start_end += 1;
      return delta;
    }
  }
  return null;
}

/**
 * @param {string[][]} rowsToday
 * @param {string[]} headers
 */
function rollupTargetedOffers(rowsToday, headers) {
  const cols = detectOffersColumns(headers);
  const stats = { used_hold_column: 0, used_start_end: 0 };

  /** @type {Map<string, { queue: string, offers: number, hours: number }>} */
  const byQueue = new Map();
  /** @type {{ sent_sort: number, sent_ct: string, queue: string, hours: number | null, name: string }[]} */
  const timeline = [];

  for (const row of rowsToday) {
    const queue =
      cols.queue >= 0 ? String(row[cols.queue] || '').trim() || 'Unknown queue' : 'Unknown queue';
    const hours = rowHours(row, cols, stats);
    const sentRaw = cols.sent_at >= 0 ? row[cols.sent_at] : null;
    const sentSort = typeof sentRaw === 'number' && Number.isFinite(sentRaw) ? sentRaw : 0;
    const sentCt =
      typeof sentRaw === 'number' && Number.isFinite(sentRaw)
        ? serialToChicagoDateTime(sentRaw)
        : String(sentRaw || '').trim() || '—';

    const name =
      cols.name >= 0 ? String(row[cols.name] || '').trim() : '';

    timeline.push({ sent_sort: sentSort, sent_ct: sentCt, queue, hours, name });

    const agg = byQueue.get(queue) || { queue, offers: 0, hours: 0 };
    agg.offers += 1;
    if (hours != null) agg.hours += hours;
    byQueue.set(queue, agg);
  }

  timeline.sort((a, b) => a.sent_sort - b.sent_sort);
  const timelineOut = timeline.map(({ sent_ct, queue, hours, name }) => ({
    sent_ct,
    queue,
    hours,
    name,
  }));

  let totalHours = 0;
  for (const v of byQueue.values()) totalHours += v.hours;
  totalHours = Math.round(totalHours * 100) / 100;

  const byQueueArr = Array.from(byQueue.values()).sort(
    (a, b) => b.hours - a.hours || b.offers - a.offers
  );

  const rowsMissingHours = timeline.filter((t) => t.hours == null).length;

  let hours_basis_note = '';
  if (cols.hold_hours >= 0 && cols.hold_hours_header) {
    hours_basis_note = `Hours use “${cols.hold_hours_header}” when set; otherwise End − Start when both look like datetimes.`;
  } else {
    hours_basis_note =
      'No “Hold Hours” / “Hours” column matched; hours are End − Start when both cells are datetime serials.';
  }

  return {
    total_hours: totalHours,
    by_queue: byQueueArr,
    timeline: timelineOut.slice(0, 100),
    rows_missing_hours: rowsMissingHours,
    hours_basis_note,
  };
}

module.exports = {
  rollupTargetedOffers,
  serialToChicagoDateTime,
};
