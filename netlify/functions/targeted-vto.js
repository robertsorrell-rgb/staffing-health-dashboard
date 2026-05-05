'use strict';

const { ok, handleOptions } = require('./_sheets.js');
const { readSheetFilterToday, readSheetFilterWeek } = require('./lib/filter-today.js');
const { rollupTargetedOffers } = require('./lib/targeted-vto-rollup.js');
const { rollupAutoVtoApproved } = require('./lib/auto-vto-approved-rollup.js');
const { applyCanonicalToAutomatedRollup, canonicalVtoSalesGroup } = require('./lib/vto-canonical-sales-group.js');
const { todayCTDateStr, currentChicagoWeekSundayToSaturday } = require('./lib/ct.js');
const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('TARGETED_VTO_CACHE_SECONDS'), 10);

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const targetedSpreadsheetId = env('TARGETED_VTO_SPREADSHEET_ID');
  const autoSpreadsheetId = env('AUTO_VTO_SPREADSHEET_ID');
  const offersTab = env('TARGETED_VTO_TAB') || 'Offers';
  const autoTab = env('AUTO_VTO_TAB') || 'Requests_Submissions';

  if (!targetedSpreadsheetId && !autoSpreadsheetId) {
    return ok(
      {
        configured: false,
        note: 'TARGETED_VTO_SPREADSHEET_ID and AUTO_VTO_SPREADSHEET_ID not set',
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  }

  let today = todayCTDateStr();
  let rollup = emptyTargetedRollup();
  let targetedRowsToday = 0;
  let targetedFetchError = null;
  let auto = emptyAutoRollup();
  let autoRowsToday = 0;
  let autoDateColumnUsed = null;
  let autoFetchError = null;

  if (targetedSpreadsheetId) {
    try {
      const r = await readSheetFilterToday(targetedSpreadsheetId, offersTab, 'A1:ZZ20000', {
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
  }

  if (autoSpreadsheetId) {
    try {
      const byRequested = await readSheetFilterToday(autoSpreadsheetId, autoTab, 'A1:ZZ20000', {
        preferDateHeaders: ['Date Requested', 'date requested', 'Timestamp', 'timestamp'],
      });
      let active = byRequested;
      if ((byRequested.rowsToday || []).length === 0) {
        const byTimestamp = await readSheetFilterToday(autoSpreadsheetId, autoTab, 'A1:ZZ20000', {
          preferDateHeaders: ['Timestamp', 'timestamp', 'Date Requested', 'date requested'],
        });
        if ((byTimestamp.rowsToday || []).length > (byRequested.rowsToday || []).length) {
          active = byTimestamp;
        }
      }
      today = active.today || today;
      autoRowsToday = (active.rowsToday || []).length;
      autoDateColumnUsed = active.headers?.[active.dateCol] || null;
      auto =
        active.headers && active.headers.length
          ? applyCanonicalToAutomatedRollup(
              rollupAutoVtoApproved(active.rowsToday || [], active.headers)
            )
          : emptyAutoRollup();
    } catch (err) {
      autoFetchError = err.message || String(err);
      auto = emptyAutoRollup();
    }
  }

  const targetedHours = Number(rollup.total_hours) || 0;
  const autoHours = Number(auto.hours_approved_today) || 0;
  const combinedHours = Math.round((targetedHours + autoHours) * 100) / 100;
  const combinedByGroup = mergeByGroup(rollup.by_queue || [], auto.by_role || []);

  const weekMeta = currentChicagoWeekSundayToSaturday();
  let rollupWeek = emptyTargetedRollup();
  let autoWeek = emptyAutoRollup();
  let autoWeekDateColumnUsed = null;
  let weekTargetedError = null;
  let weekAutoError = null;

  if (targetedSpreadsheetId) {
    try {
      const rw = await readSheetFilterWeek(
        targetedSpreadsheetId,
        offersTab,
        'A1:ZZ20000',
        { preferDateHeaders: ['Date', 'date'] },
        weekMeta.week_start,
        weekMeta.week_end
      );
      rollupWeek =
        rw.headers.length && rw.rowsWeek.length
          ? rollupTargetedOffers(rw.rowsWeek, rw.headers)
          : emptyTargetedRollup();
    } catch (err) {
      weekTargetedError = err.message || String(err);
      rollupWeek = emptyTargetedRollup();
    }
  }

  if (autoSpreadsheetId) {
    try {
      const [byRequestedW, byTimestampW] = await Promise.all([
        readSheetFilterWeek(
          autoSpreadsheetId,
          autoTab,
          'A1:ZZ20000',
          { preferDateHeaders: ['Date Requested', 'date requested', 'Timestamp', 'timestamp'] },
          weekMeta.week_start,
          weekMeta.week_end
        ),
        readSheetFilterWeek(
          autoSpreadsheetId,
          autoTab,
          'A1:ZZ20000',
          { preferDateHeaders: ['Timestamp', 'timestamp', 'Date Requested', 'date requested'] },
          weekMeta.week_start,
          weekMeta.week_end
        ),
      ]);
      const activeW =
        (byTimestampW.rowsWeek || []).length > (byRequestedW.rowsWeek || []).length ? byTimestampW : byRequestedW;
      autoWeekDateColumnUsed = activeW.headers?.[activeW.dateCol] || null;
      autoWeek =
        activeW.headers && activeW.headers.length
          ? applyCanonicalToAutomatedRollup(
              rollupAutoVtoApproved(activeW.rowsWeek || [], activeW.headers)
            )
          : emptyAutoRollup();
    } catch (err) {
      weekAutoError = err.message || String(err);
      autoWeek = emptyAutoRollup();
    }
  }

  const combinedWeekByGroup = mergeByGroup(rollupWeek.by_queue || [], autoWeek.by_role || []);

  return ok(
    {
      configured: true,
      today,
      offers_tab: offersTab,
      auto_tab: autoTab,
      targeted_fetch_error: targetedFetchError,
      auto_fetch_error: autoFetchError,
      auto_date_column_used: autoDateColumnUsed,
      summary: {
        rows_targeted_offers_today: targetedRowsToday,
        committed_targeted_today: rollup.committed_offers_today,
        hours_targeted_from_offers: Number(rollup.total_hours) || 0,
        rows_auto_today: autoRowsToday,
        approved_auto_today: auto.approved_today,
        hours_auto_approved: auto.hours_approved_today,
        hours_combined_approved: combinedHours,
      },
      rollup,
      automated_rollup: auto,
      combined: {
        hours_approved: combinedHours,
        by_group: combinedByGroup,
      },
      combined_week: {
        by_group: combinedWeekByGroup,
        week_start: weekMeta.week_start,
        week_end: weekMeta.week_end,
        label: weekMeta.label,
        auto_date_column_used: autoWeekDateColumnUsed,
        targeted_fetch_error: weekTargetedError,
        auto_fetch_error: weekAutoError,
      },
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

function emptyAutoRollup() {
  return {
    approved_today: 0,
    hours_approved_today: 0,
    by_role: [],
    approved_rows: [],
    columns_used: { rep: 3, role: 4, dateRequested: 5, hours: 8, decision: 9, timestamp: 0 },
  };
}

function mergeByGroup(targetedByQueue, autoByRole) {
  const map = new Map();
  for (const t of targetedByQueue || []) {
    const group = canonicalVtoSalesGroup(t.queue);
    const k = group.toLowerCase();
    const hours = Number(t.hours) || 0;
    if (!map.has(k)) {
      map.set(k, { group, targeted_hours: 0, automated_hours: 0, total_hours: 0 });
    }
    const cur = map.get(k);
    cur.targeted_hours += hours;
    cur.total_hours += hours;
  }
  for (const a of autoByRole || []) {
    const group = canonicalVtoSalesGroup(a.role);
    const k = group.toLowerCase();
    const hours = Number(a.hours) || 0;
    if (!map.has(k)) {
      map.set(k, { group, targeted_hours: 0, automated_hours: hours, total_hours: hours });
    } else {
      const cur = map.get(k);
      cur.automated_hours += hours;
      cur.total_hours += hours;
    }
  }
  return Array.from(map.values())
    .map((r) => ({
      group: r.group,
      targeted_hours: Math.round(r.targeted_hours * 100) / 100,
      automated_hours: Math.round(r.automated_hours * 100) / 100,
      total_hours: Math.round(r.total_hours * 100) / 100,
    }))
    .sort((a, b) => b.total_hours - a.total_hours || a.group.localeCompare(b.group));
}
