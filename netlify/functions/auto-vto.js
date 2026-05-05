'use strict';

const { ok, errorResponse, handleOptions } = require('./_sheets.js');
const { readSheetFilterToday } = require('./lib/filter-today.js');
const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('AUTO_VTO_CACHE_SECONDS'), 10);

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const spreadsheetId = env('AUTO_VTO_SPREADSHEET_ID');
  const tab = env('AUTO_VTO_TAB') || 'Requests_Submissions';

  if (!spreadsheetId) {
    return ok({ configured: false, summary: {}, rows_today: 0, note: 'AUTO_VTO_SPREADSHEET_ID not set', fetched_at: new Date().toISOString() }, CACHE_SEC);
  }

  try {
    const byRequested = await readSheetFilterToday(spreadsheetId, tab, 'A1:ZZ20000', {
      preferDateHeaders: ['Date Requested', 'date requested', 'Timestamp', 'timestamp'],
    });
    let active = byRequested;
    if ((byRequested.rowsToday || []).length === 0) {
      const byTimestamp = await readSheetFilterToday(spreadsheetId, tab, 'A1:ZZ20000', {
        preferDateHeaders: ['Timestamp', 'timestamp', 'Date Requested', 'date requested'],
      });
      if ((byTimestamp.rowsToday || []).length > (byRequested.rowsToday || []).length) {
        active = byTimestamp;
      }
    }
    const { headers, rowsToday, rowsAll, today, dateCol } = active;
    const dateHeader = headers[dateCol] || '(column A)';
    let today_hint = null;
    if (rowsToday.length === 0) {
      if (rowsAll.length === 0) {
        today_hint = 'Sheet tab appears empty below the header row.';
      } else if (rowsAll.length > 30) {
        today_hint = `No rows for ${today} (CT) using “${dateHeader}”. If today should show activity, confirm that column uses CT calendar dates or try Timestamp vs Date Requested in the sheet.`;
      } else {
        today_hint = `No submissions for ${today} (CT).`;
      }
    }

    return ok(
      {
        configured: true,
        today,
        date_column_used: dateHeader,
        summary: { rows_today: rowsToday.length },
        today_hint,
        headers,
        rows_preview: rowsToday.slice(0, 50),
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  } catch (err) {
    return errorResponse(err, 'auto-vto');
  }
};
