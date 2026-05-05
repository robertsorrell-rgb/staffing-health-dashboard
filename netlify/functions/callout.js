'use strict';

const { ok, errorResponse, handleOptions } = require('./_sheets.js');
const { readSheetFilterToday } = require('./lib/filter-today.js');

const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('CALLOUT_CACHE_SECONDS'), 10);

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const spreadsheetId = env('CALLOUT_SPREADSHEET_ID');
  const mainTab = env('CALLOUT_MAIN_TAB') || 'Sheet1';
  const attendanceTab = env('CALLOUT_ATTENDANCE_TAB');

  if (!spreadsheetId) {
    return ok({ configured: false, note: 'CALLOUT_SPREADSHEET_ID not set', fetched_at: new Date().toISOString() }, CACHE_SEC);
  }

  try {
    const main = await readSheetFilterToday(spreadsheetId, mainTab);
    let attendance = null;
    if (attendanceTab) {
      attendance = await readSheetFilterToday(spreadsheetId, attendanceTab);
    }

    return ok(
      {
        configured: true,
        today: main.today,
        call_out_main: {
          rows_today: main.rowsToday.length,
          headers: main.headers,
          rows_preview: main.rowsToday.slice(0, 40),
        },
        attendance_notifications: attendance
          ? {
              rows_today: attendance.rowsToday.length,
              headers: attendance.headers,
              rows_preview: attendance.rowsToday.slice(0, 40),
            }
          : null,
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  } catch (err) {
    return errorResponse(err, 'callout');
  }
};
