'use strict';

const { ok, errorResponse, handleOptions } = require('./_sheets.js');
const { readSheetFilterToday } = require('./lib/filter-today.js');

const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('CALLOUT_CACHE_SECONDS'), 10);

function salesGroupColumnIndex(headers) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  const idx = lower.findIndex(
    (h) => h === 'sales group' || h.includes('sales group') || h === 'sales_group'
  );
  return idx >= 0 ? idx : -1;
}

/** Drop rows with blank Sales Group (unscoped call-outs). */
function filterRowsWithSalesGroup(headers, rows) {
  const sg = salesGroupColumnIndex(headers);
  if (sg < 0) return rows;
  return rows.filter((row) => {
    const v = row[sg];
    if (v == null || v === '') return false;
    return String(v).trim().length > 0;
  });
}

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

    const mainRows = filterRowsWithSalesGroup(main.headers, main.rowsToday);
    const attRows = attendance
      ? filterRowsWithSalesGroup(attendance.headers, attendance.rowsToday)
      : null;

    return ok(
      {
        configured: true,
        today: main.today,
        call_out_main: {
          rows_today: mainRows.length,
          headers: main.headers,
          rows_preview: mainRows.slice(0, 40),
        },
        attendance_notifications: attendance
          ? {
              rows_today: attRows.length,
              headers: attendance.headers,
              rows_preview: attRows.slice(0, 40),
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
