'use strict';

const { getSheetValues, normalizeDateCell } = require('../_sheets.js');
const { todayCTDateStr } = require('./ct.js');

/** Sheets often omit trailing empty cells — pad so column indices align with header row. */
function padRowToHeaders(row, headerLen) {
  const n = Math.max(0, headerLen | 0);
  const r = Array.isArray(row) ? row : [];
  if (r.length >= n) return r.slice(0, n);
  return r.concat(Array(n - r.length).fill(''));
}

/**
 * Reads a tab; uses row 1 as headers; filters body rows whose date column matches today CT.
 * @param {{ preferDateHeaders?: string[] }} [opts] — try these header labels first (exact match, case-insensitive).
 */
async function readSheetFilterToday(spreadsheetId, tab, a1Suffix = 'A1:Z10000', opts = {}) {
  const t = (tab || 'Sheet1').replace(/'/g, "''");
  const range = `'${t}'!${a1Suffix}`;
  const values = await getSheetValues(spreadsheetId, range, {
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  if (!values.length) {
    return {
      headers: [],
      rowsToday: [],
      rowsAll: [],
      dateCol: 0,
      today: todayCTDateStr(),
      dateHeader: '',
    };
  }
  const headers = (values[0] || []).map((h) => String(h || '').trim());
  let dateCol = -1;
  const prefers = opts.preferDateHeaders || [];
  for (const want of prefers) {
    const w = String(want || '').trim().toLowerCase();
    const idx = headers.findIndex((h) => h.trim().toLowerCase() === w);
    if (idx >= 0) {
      dateCol = idx;
      break;
    }
  }
  if (dateCol < 0) {
    dateCol = headers.findIndex((h) => {
      const hl = String(h || '').trim();
      return (
        /^date$/i.test(hl) ||
        /^calendar/i.test(hl) ||
        /^\s*day\s*$/i.test(hl) ||
        /^timestamp$/i.test(hl) ||
        /request[_\s-]?date/i.test(hl)
      );
    });
  }
  if (dateCol < 0) dateCol = 0;
  const today = todayCTDateStr();
  const body = values.slice(1);
  const hl = headers.length;
  const rowsToday = [];
  for (const row of body) {
    const full = padRowToHeaders(row, hl);
    const d = normalizeDateCell(full[dateCol]);
    if (d === today) rowsToday.push(full);
  }
  const dateHeader =
    dateCol >= 0 && dateCol < headers.length ? String(headers[dateCol] || '').trim() : '';
  return { headers, rowsToday, rowsAll: body, dateCol, today, dateHeader };
}

/**
 * Same as readSheetFilterToday but rows whose date column falls in [weekStartYmd, weekEndYmd] inclusive (YYYY-MM-DD, CT calendar dates on the chosen column).
 * @param {string} weekStartYmd
 * @param {string} weekEndYmd
 */
async function readSheetFilterWeek(spreadsheetId, tab, a1Suffix = 'A1:Z10000', opts = {}, weekStartYmd, weekEndYmd) {
  const t = (tab || 'Sheet1').replace(/'/g, "''");
  const range = `'${t}'!${a1Suffix}`;
  const values = await getSheetValues(spreadsheetId, range, {
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  if (!values.length) {
    return {
      headers: [],
      rowsWeek: [],
      rowsAll: [],
      dateCol: 0,
      today: todayCTDateStr(),
      weekStartYmd,
      weekEndYmd,
    };
  }
  const headers = (values[0] || []).map((h) => String(h || '').trim());
  let dateCol = -1;
  const prefers = opts.preferDateHeaders || [];
  for (const want of prefers) {
    const w = String(want || '').trim().toLowerCase();
    const idx = headers.findIndex((h) => h.trim().toLowerCase() === w);
    if (idx >= 0) {
      dateCol = idx;
      break;
    }
  }
  if (dateCol < 0) {
    dateCol = headers.findIndex((h) => {
      const hl = String(h || '').trim();
      return (
        /^date$/i.test(hl) ||
        /^calendar/i.test(hl) ||
        /^\s*day\s*$/i.test(hl) ||
        /^timestamp$/i.test(hl) ||
        /request[_\s-]?date/i.test(hl)
      );
    });
  }
  if (dateCol < 0) dateCol = 0;
  const body = values.slice(1);
  const hl = headers.length;
  const rowsWeek = [];
  for (const row of body) {
    const full = padRowToHeaders(row, hl);
    const d = normalizeDateCell(full[dateCol]);
    if (d && d >= weekStartYmd && d <= weekEndYmd) rowsWeek.push(full);
  }
  return { headers, rowsWeek, rowsAll: body, dateCol, today: todayCTDateStr(), weekStartYmd, weekEndYmd };
}

module.exports = { readSheetFilterToday, readSheetFilterWeek };
