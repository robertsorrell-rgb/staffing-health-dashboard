'use strict';

const { ok, errorResponse, handleOptions } = require('./_sheets.js');
const { readSheetFilterToday } = require('./lib/filter-today.js');
const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('BOBBOT_CACHE_SECONDS'), 10);

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const spreadsheetId = env('BOBBOT_SPREADSHEET_ID');
  const tab = env('BOBBOT_TAB') || 'Bobbot_History';

  if (!spreadsheetId) {
    return ok({ configured: false, summary: {}, note: 'BOBBOT_SPREADSHEET_ID not set', fetched_at: new Date().toISOString() }, CACHE_SEC);
  }

  try {
    const { headers, rowsToday, today } = await readSheetFilterToday(spreadsheetId, tab, 'A1:ZZ20000', {
      preferDateHeaders: ['request_date', 'Request_Date', 'saved_at', 'Saved_At'],
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
    return errorResponse(err, 'bobbot');
  }
};
