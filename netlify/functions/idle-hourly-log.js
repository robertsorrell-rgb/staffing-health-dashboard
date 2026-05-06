'use strict';

/**
 * CS_Hourly_Log → weighted idle % per hour + per-group breakdown.
 * Weighted floor: Σ Available / Σ (Available + On Call) for filtered rows (today CT).
 */

const {
  getSheetValues,
  parseSheetNumber,
  normalizeDateCell,
  ok,
  bad,
  errorResponse,
  handleOptions,
} = require('./_sheets.js');
const { todayCTDateStr, currentCTHour } = require('./lib/ct.js');
const { parseHourHeader } = require('./lib/hour-headers.js');
const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('IDLE_HOURLY_LOG_CACHE_SECONDS'), 10);

const IDLE_CONSUMER_SPREADSHEET_ID = env('IDLE_CONSUMER_SPREADSHEET_ID');
const TAB = env('IDLE_CONSUMER_HOURLY_LOG_TAB') || 'CS_Hourly_Log';
const RANGE =
  (process.env.IDLE_CONSUMER_HOURLY_LOG_RANGE || '').trim() ||
  `'${TAB.replace(/'/g, "''")}'!A1:ZZ50000`;

function normalizeHeader(cell) {
  return String(cell || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Match header labels → canonical keys (supports Hour Key + Hour Label layout). */
function detectColumns(headerRow) {
  const idx = {};
  for (let c = 0; c < headerRow.length; c++) {
    const h = normalizeHeader(headerRow[c]);
    if (!h) continue;
    if (/^date\b|^calendar/.test(h) || h === 'day') idx.date = c;
    else if (/hour\s*label/.test(h)) idx.hour_label = c;
    else if (/hour\s*key/.test(h)) idx.hour_key = c;
    else if (/\bhour\b/.test(h) && !/label|key/.test(h)) idx.hour = c;
    else if (/(sales group|consultant group|queue name|group|team)/.test(h) && idx.group == null) idx.group = c;
    else if (/available/.test(h) && !/on.?call/.test(h)) idx.available = c;
    else if (/on.?call|talk time|active call/.test(h)) idx.oncall = c;
  }
  return idx;
}

function hasHourColumn(idx) {
  return idx.hour_label != null || idx.hour_key != null || idx.hour != null;
}

function resolveHourFromRow(row, idx) {
  if (idx.hour_label != null) {
    const hr = parseHourHeader(row[idx.hour_label]);
    if (hr != null) return hr;
  }
  if (idx.hour_key != null) {
    const hk = String(row[idx.hour_key] || '').trim();
    const m = hk.match(/\s(\d{1,2})$/);
    if (m) {
      const h = parseInt(m[1], 10);
      if (h >= 0 && h <= 23) return h;
    }
    const hr2 = parseHourHeader(hk);
    if (hr2 != null) return hr2;
  }
  if (idx.hour != null) return parseHourCell(row[idx.hour]);
  return null;
}

function parseHourCell(cell) {
  if (cell == null || cell === '') return null;
  const n = Number(cell);
  if (Number.isFinite(n) && n >= 0 && n <= 23 && Number.isInteger(n)) return n;
  const s = String(cell).trim();
  const m = s.match(/(\d{1,2})\s*(AM|PM)?/i);
  if (m) {
    let h = parseInt(m[1], 10);
    if (/PM/i.test(s) && h !== 12) h += 12;
    if (/AM/i.test(s) && h === 12) h = 0;
    if (h >= 0 && h <= 23) return h;
  }
  return null;
}

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const qs = event.queryStringParameters || {};
  const dateFilter = qs.date ? String(qs.date).trim() : todayCTDateStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
    return bad('Invalid date param');
  }

  try {
    const values = await getSheetValues(IDLE_CONSUMER_SPREADSHEET_ID, RANGE, {
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });

    if (!values.length) {
      return ok({ date: dateFilter, byHour: {}, groups_by_hour: {}, note: 'Empty sheet range', fetched_at: new Date().toISOString() }, CACHE_SEC);
    }

    let col = null;
    let dataStart = 1;
    const h0 = detectColumns(values[0] || []);
    if (h0.date != null && hasHourColumn(h0) && h0.available != null && h0.oncall != null) {
      col = h0;
      dataStart = 1;
    } else if (values.length > 1) {
      const h1 = detectColumns(values[1] || []);
      if (h1.date != null && hasHourColumn(h1) && h1.available != null && h1.oncall != null) {
        col = h1;
        dataStart = 2;
      }
    }

    if (!col || col.available == null || col.oncall == null) {
      return ok({
        date: dateFilter,
        byHour: {},
        groups_by_hour: {},
        note:
          'Could not detect CS_Hourly_Log columns (need Date, Hour Label or Hour Key or Hour, Available*, On Call*; Group optional). See docs/sheet-contracts.md.',
        fetched_at: new Date().toISOString(),
      }, CACHE_SEC);
    }

    /** hourStr -> { avail, denom } */
    const rollup = {};
    /** hourStr -> Map group -> { avail, oncall } */
    const groupsByHour = {};

    for (let r = dataStart; r < values.length; r++) {
      const row = values[r] || [];
      const dateStr = normalizeDateCell(row[col.date]);
      if (dateStr !== dateFilter) continue;
      const hour = resolveHourFromRow(row, col);
      if (hour == null || hour < 0 || hour > 23) continue;
      const group =
        col.group != null ? String(row[col.group] || '').trim() || 'Unknown' : 'Floor';
      let avail = parseSheetNumber(row[col.available]);
      let oncall = parseSheetNumber(row[col.oncall]);
      if (avail == null) avail = 0;
      if (oncall == null) oncall = 0;
      if (avail < 0 || oncall < 0) continue;
      const denom = avail + oncall;
      if (denom <= 0 && avail <= 0) continue;

      const hk = String(hour);
      if (!rollup[hk]) rollup[hk] = { avail: 0, denom: 0 };
      rollup[hk].avail += avail;
      rollup[hk].denom += denom;

      if (!groupsByHour[hk]) groupsByHour[hk] = {};
      if (!groupsByHour[hk][group]) groupsByHour[hk][group] = { available: 0, on_call: 0 };
      groupsByHour[hk][group].available += avail;
      groupsByHour[hk][group].on_call += oncall;
    }

    const byHour = {};
    for (const [hk, v] of Object.entries(rollup)) {
      const pct = v.denom > 0 ? Math.round((v.avail / v.denom) * 1000) / 10 : null;
      byHour[hk] = { idle_pct: pct, available_sum: v.avail, denominator_sum: v.denom };
    }

    const groupIdle = {};
    for (const [hk, gmap] of Object.entries(groupsByHour)) {
      groupIdle[hk] = {};
      for (const [g, x] of Object.entries(gmap)) {
        const d = x.available + x.on_call;
        groupIdle[hk][g] = d > 0 ? Math.round((x.available / d) * 1000) / 10 : null;
      }
    }

    /** Same weighting as hourly, summed across all hours with data for this calendar day. */
    let dayAvailSum = 0;
    let dayDenomSum = 0;
    for (const v of Object.values(rollup)) {
      dayAvailSum += v.avail;
      dayDenomSum += v.denom;
    }
    const day_floor_idle_pct =
      dayDenomSum > 0 ? Math.round((dayAvailSum / dayDenomSum) * 1000) / 10 : null;

    const groupDayAgg = {};
    for (const gmap of Object.values(groupsByHour)) {
      for (const [g, x] of Object.entries(gmap)) {
        if (!groupDayAgg[g]) groupDayAgg[g] = { available: 0, on_call: 0 };
        groupDayAgg[g].available += x.available;
        groupDayAgg[g].on_call += x.on_call;
      }
    }
    const groups_by_day = {};
    for (const [g, x] of Object.entries(groupDayAgg)) {
      const d = x.available + x.on_call;
      groups_by_day[g] = d > 0 ? Math.round((x.available / d) * 1000) / 10 : null;
    }

    const nowH = dateFilter === todayCTDateStr() ? currentCTHour() : null;

    const hourKeys = Object.keys(byHour)
      .map((k) => parseInt(k, 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23);
    const maxDataHour = hourKeys.length ? Math.max(...hourKeys) : -1;

    let current_hour_floor_idle =
      nowH != null && byHour[String(nowH)] ? byHour[String(nowH)].idle_pct : null;
    let kpi_hour = nowH;
    let kpi_note = null;
    if (nowH != null && current_hour_floor_idle == null) {
      for (let h = nowH - 1; h >= 7; h--) {
        const entry = byHour[String(h)];
        if (entry && entry.idle_pct != null) {
          current_hour_floor_idle = entry.idle_pct;
          kpi_hour = h;
          kpi_note = `Hour ${nowH}:00 has no rows yet; showing weighted idle for hour ${h}:00.`;
          break;
        }
      }
    }

    /** Operating-hours sparkline 07:00 → latest relevant hour (context vs single dip). */
    const spark = [];
    if (nowH != null) {
      const endHour = Math.min(21, Math.max(nowH, maxDataHour >= 0 ? maxDataHour : nowH, 12));
      for (let h = 7; h <= endHour; h++) {
        const entry = byHour[String(h)];
        spark.push({ hour: h, idle_pct: entry ? entry.idle_pct : null });
      }
    }

    return ok(
      {
        date: dateFilter,
        ct_current_hour: nowH,
        kpi_hour,
        kpi_note,
        current_hour_floor_idle: current_hour_floor_idle,
        day_floor_idle_pct,
        groups_by_day,
        byHour,
        groups_by_hour: groupIdle,
        sparkline_hours: spark,
        idle_source_tab: TAB,
        idle_spreadsheet_id: IDLE_CONSUMER_SPREADSHEET_ID,
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  } catch (err) {
    return errorResponse(err, 'idle-hourly-log');
  }
};
