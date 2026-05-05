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
    const { headers, rowsToday, today } = await readSheetFilterToday(spreadsheetId, tab, 'A1:ZZ20000', {
      preferDateHeaders: ['Timestamp', 'timestamp', 'Date Requested', 'date requested'],
    });
    return ok(
      {
        configured: true,
        today,
        summary: { rows_today: rowsToday.length },
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
