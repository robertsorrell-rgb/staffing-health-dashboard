'use strict';

const { getSheetValues, normalizeDateCell } = require('../_sheets.js');
const { todayCTDateStr } = require('./ct.js');

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
    return { headers: [], rowsToday: [], rowsAll: [], dateCol: 0, today: todayCTDateStr() };
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
    dateCol = headers.findIndex(
      (h) =>
        /^date$/i.test(h) ||
        /^calendar/i.test(h) ||
        /^\s*day\s*$/i.test(h) ||
        /^timestamp$/i.test(h)
    );
  }
  if (dateCol < 0) dateCol = 0;
  const today = todayCTDateStr();
  const body = values.slice(1);
  const rowsToday = [];
  for (const row of body) {
    const d = normalizeDateCell(row[dateCol]);
    if (d === today) rowsToday.push(row);
  }
  return { headers, rowsToday, rowsAll: body, dateCol, today };
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
    dateCol = headers.findIndex(
      (h) =>
        /^date$/i.test(h) ||
        /^calendar/i.test(h) ||
        /^\s*day\s*$/i.test(h) ||
        /^timestamp$/i.test(h)
    );
  }
  if (dateCol < 0) dateCol = 0;
  const body = values.slice(1);
  const rowsWeek = [];
  for (const row of body) {
    const d = normalizeDateCell(row[dateCol]);
    if (d && d >= weekStartYmd && d <= weekEndYmd) rowsWeek.push(row);
  }
  return { headers, rowsWeek, rowsAll: body, dateCol, today: todayCTDateStr(), weekStartYmd, weekEndYmd };
}

module.exports = { readSheetFilterToday, readSheetFilterWeek };
