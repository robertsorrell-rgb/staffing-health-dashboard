'use strict';

const { ok, errorResponse, handleOptions } = require('./_sheets.js');
const { readSheetFilterToday } = require('./lib/filter-today.js');
const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('BOBBOT_CACHE_SECONDS'), 10);

/** PTO / automated decisions live on Bobbot_History (see docs/sheet-contracts.md). */
const DEFAULT_BOBBOT_TAB = 'Bobbot_History';

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const spreadsheetId = env('BOBBOT_SPREADSHEET_ID');
  const tab = (env('BOBBOT_TAB') || '').trim() || DEFAULT_BOBBOT_TAB;

  if (!spreadsheetId) {
    return ok({ configured: false, summary: {}, note: 'BOBBOT_SPREADSHEET_ID not set', fetched_at: new Date().toISOString() }, CACHE_SEC);
  }

  try {
    const { headers, rowsToday, today, dateHeader } = await readSheetFilterToday(spreadsheetId, tab, 'A1:ZZ20000', {
      preferDateHeaders: [
        'request_date',
        'Request_Date',
        'Request Date',
        'request date',
        'saved_at',
        'Saved_At',
      ],
    });
    const configuration_hint =
      tab !== DEFAULT_BOBBOT_TAB
        ? `BOBBOT_TAB is "${tab}". Use Bobbot_History for the PTO Automated Decision Engine history log.`
        : undefined;
    const sheet_source_note = `Sheet "${tab}" · Today column "${dateHeader || '?'}" · CT ${today}`;
    return ok(
      {
        configured: true,
        today,
        bobbot_tab: tab,
        date_column_used: dateHeader || null,
        configuration_hint,
        sheet_source_note,
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
