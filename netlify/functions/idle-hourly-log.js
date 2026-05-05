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

const CACHE_SEC = parseInt(process.env.IDLE_HOURLY_LOG_CACHE_SECONDS || '180', 10);

const IDLE_CONSUMER_SPREADSHEET_ID = (process.env.IDLE_CONSUMER_SPREADSHEET_ID || '').trim()
  || '1MlHy2dB9JieEk4q72YhsEJLwvFFYJZ_fAI7s4M7mDLk';
const TAB = (process.env.IDLE_CONSUMER_HOURLY_LOG_TAB || '').trim() || 'CS_Hourly_Log';
const RANGE = (process.env.IDLE_CONSUMER_HOURLY_LOG_RANGE || '').trim()
  || `'${TAB.replace(/'/g, "''")}'!A1:ZZ50000`;

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
      return ok({ date: dateFilter, byHour: {}, groupsByHour: {}, note: 'Empty sheet range', fetched_at: new Date().toISOString() }, CACHE_SEC);
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
        groupsByHour: {},
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

    const nowH = dateFilter === todayCTDateStr() ? currentCTHour() : null;
    let current_hour_floor_idle = null;
    if (nowH != null && byHour[String(nowH)]) {
      current_hour_floor_idle = byHour[String(nowH)].idle_pct;
    }

    const spark = [];
    if (nowH != null) {
      for (let i = 7; i >= 0; i--) {
        const h = nowH - i;
        if (h < 0) break;
        const entry = byHour[String(h)];
        spark.push({ hour: h, idle_pct: entry ? entry.idle_pct : null });
      }
    }

    return ok(
      {
        date: dateFilter,
        ct_current_hour: nowH,
        current_hour_floor_idle: current_hour_floor_idle,
        byHour,
        groups_by_hour: groupIdle,
        sparkline_hours: spark,
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  } catch (err) {
    return errorResponse(err, 'idle-hourly-log');
  }
};
