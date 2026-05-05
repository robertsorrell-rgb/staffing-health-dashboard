'use strict';

const { ok, errorResponse, handleOptions, getSheetValues } = require('./_sheets.js');
const { readSheetFilterToday } = require('./lib/filter-today.js');
const { rollupTargetedOffers } = require('./lib/targeted-vto-rollup.js');
const { parseVtoSummaryFromGrid } = require('./lib/vto-summary-sheet.js');
const { todayCTDateStr } = require('./lib/ct.js');
const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('TARGETED_VTO_CACHE_SECONDS'), 10);

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const spreadsheetId = env('TARGETED_VTO_SPREADSHEET_ID');
  const offersTab = env('TARGETED_VTO_TAB') || 'Offers';
  const summaryTab = env('TARGETED_VTO_SUMMARY_TAB') || 'VTO_Summary';
  const summaryA1 = (env('TARGETED_VTO_SUMMARY_RANGE') || 'A1:F25').trim();

  if (!spreadsheetId) {
    return ok(
      {
        configured: false,
        note: 'TARGETED_VTO_SPREADSHEET_ID not set',
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  }

  let today = todayCTDateStr();
  let rollup = emptyTargetedRollup();
  let targetedRowsToday = 0;
  let targetedFetchError = null;

  try {
    const r = await readSheetFilterToday(spreadsheetId, offersTab, 'A1:ZZ20000', {
      preferDateHeaders: ['Date', 'date'],
    });
    today = r.today;
    targetedRowsToday = r.rowsToday.length;
    rollup =
      r.headers.length && r.rowsToday.length ? rollupTargetedOffers(r.rowsToday, r.headers) : emptyTargetedRollup();
  } catch (err) {
    targetedFetchError = err.message || String(err);
    rollup = emptyTargetedRollup();
  }

  let sheet_summary = {
    tab: summaryTab,
    combined_approved_hours: null,
    targeted_committed_hours: null,
    automated_approved_hours: null,
  };
  let sheet_summary_error = null;

  try {
    const t = summaryTab.replace(/'/g, "''");
    const range = `'${t}'!${summaryA1}`;
    const grid = await getSheetValues(spreadsheetId, range, {
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });
    sheet_summary = {
      tab: summaryTab,
      ...parseVtoSummaryFromGrid(grid),
    };
  } catch (err) {
    sheet_summary_error = err.message || String(err);
  }

  return ok(
    {
      configured: true,
      today,
      offers_tab: offersTab,
      targeted_fetch_error: targetedFetchError,
      sheet_summary_error,
      summary: {
        rows_targeted_offers_today: targetedRowsToday,
        committed_targeted_today: rollup.committed_offers_today,
        hours_targeted_from_offers: Number(rollup.total_hours) || 0,
      },
      sheet_summary,
      rollup,
      fetched_at: new Date().toISOString(),
    },
    CACHE_SEC
  );
};

function emptyTargetedRollup() {
  return {
    total_hours: 0,
    committed_offers_today: 0,
    offers_other_status_today: 0,
    by_queue: [],
    timeline: [],
    rows_missing_hours: 0,
    hours_basis_note:
      'Targeted Offers: Status COMMITTED, Date column (CT). Hours from Start–End (HH:MM) or Hold Hours.',
  };
}
