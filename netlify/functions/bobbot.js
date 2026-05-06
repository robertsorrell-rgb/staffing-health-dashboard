'use strict';

const { ok, errorResponse, handleOptions } = require('./_sheets.js');
const { readSheetFilterToday } = require('./lib/filter-today.js');

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

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  try {
    const { headers, rowsToday, today, dateHeader } = await readSheetFilterToday(
      BOBBOT_SPREADSHEET_ID,
      BOBBOT_TAB,
      'A1:ZZ20000',
      {
        /** Today = wall date on request_date only (not saved_at). */
        preferDateHeaders: ['request_date', 'Request_Date', 'Request Date', 'request date'],
      }
    );

    const rowsVisible = rowsToday.filter((row) => !isCancelledDecision(headers, row));
    const nCancelled = rowsToday.length - rowsVisible.length;

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
        rows_preview: rowsVisible.slice(0, 50),
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  } catch (err) {
    return errorResponse(err, 'bobbot');
  }
};
