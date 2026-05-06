'use strict';

const { getSheetValues, normalizeDateCell } = require('../_sheets.js');
const { todayCTDateStr } = require('./ct.js');

/** 0-based column index → A, B, …, Z, AA, … */
function columnLetterFromIndex(i) {
  let n = Math.floor(Number(i)) + 1;
  if (n < 1) return '?';
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Sheets often omit trailing empty cells — pad so column indices align with header row. */
function padRowToHeaders(row, headerLen) {
  const n = Math.max(0, Number(headerLen) || 0);
  const r = Array.isArray(row) ? row : [];
  if (r.length >= n) return r.slice(0, n);
  return r.concat(Array(n - r.length).fill(''));
}

/** Bobbot_History can repeat `request_date`-style headers; OR across all matching columns. */
function collectRequestDateColumnIndices(headers, prefers) {
  const indices = new Set();
  const prefSet = new Set(
    (prefers || []).map((w) => String(w || '').trim().toLowerCase()).filter(Boolean)
  );
  headers.forEach((h, i) => {
    const hl = String(h || '').trim().toLowerCase();
    if (prefSet.has(hl)) indices.add(i);
    const ht = String(h || '').trim();
    if (/^request[_\s-]?date$/i.test(ht)) indices.add(i);
  });
  return [...indices].sort((a, b) => a - b);
}

function resolvePrimaryDateColumn(headers, prefers) {
  let dateCol = -1;
  const prefList = prefers || [];
  for (const want of prefList) {
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
  return dateCol;
}

/**
 * Reads a tab; uses row 1 as headers; filters body rows whose date column matches today CT.
 * @param {{ preferDateHeaders?: string[], matchAnyRequestDateColumn?: boolean, fixedDateColumnIndex?: number, bobbotRequestDateMatch?: boolean }} [opts] — If `bobbotRequestDateMatch`, OR every `request_date` header column; if none found, use column **F** (index 5). Otherwise see `fixedDateColumnIndex` / `matchAnyRequestDateColumn`.
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
  const prefers = opts.preferDateHeaders || [];
  const bobbotMode = opts.bobbotRequestDateMatch === true;
  const bobbotDatePrefers = ['request_date', 'Request_Date', 'Request Date', 'request date'];
  const fixedIdx = opts.fixedDateColumnIndex;
  const useFixed =
    !bobbotMode &&
    typeof fixedIdx === 'number' &&
    Number.isFinite(fixedIdx) &&
    fixedIdx >= 0 &&
    Number.isInteger(fixedIdx);

  let multiIdx = [];
  let dateColsForMatch;
  if (bobbotMode) {
    multiIdx = collectRequestDateColumnIndices(headers, bobbotDatePrefers);
    dateColsForMatch = multiIdx.length > 0 ? multiIdx : [5];
  } else if (useFixed) {
    dateColsForMatch = [fixedIdx];
  } else {
    multiIdx =
      opts.matchAnyRequestDateColumn === true
        ? collectRequestDateColumnIndices(headers, prefers)
        : [];
    dateColsForMatch =
      multiIdx.length > 0 ? multiIdx : [resolvePrimaryDateColumn(headers, prefers)];
  }

  const today = todayCTDateStr();
  const body = values.slice(1);
  const hl = headers.length;
  const rowsToday = [];

  for (const row of body) {
    const full = padRowToHeaders(row, hl);
    const hitsToday = dateColsForMatch.some((ci) => normalizeDateCell(full[ci]) === today);
    if (hitsToday) rowsToday.push(full);
  }

  let dateHeader = '';
  if (bobbotMode) {
    if (multiIdx.length > 1) {
      const labels = [...new Set(multiIdx.map((i) => String(headers[i] || '').trim()).filter(Boolean))];
      dateHeader = labels.length ? `${labels.join(' / ')} (${multiIdx.length} cols)` : '';
    } else if (multiIdx.length === 1) {
      const fi = multiIdx[0];
      const label = fi < headers.length ? String(headers[fi] || '').trim() : '';
      dateHeader = label
        ? `${label} (col ${columnLetterFromIndex(fi)})`
        : `Column ${columnLetterFromIndex(fi)}`;
    } else {
      dateHeader = `request_date → col ${columnLetterFromIndex(5)} (fallback)`;
    }
  } else if (useFixed) {
    const fi = /** @type {number} */ (fixedIdx);
    const label = fi < headers.length ? String(headers[fi] || '').trim() : '';
    dateHeader = label ? `${label} (col ${columnLetterFromIndex(fi)})` : `Column ${columnLetterFromIndex(fi)}`;
  } else if (multiIdx.length > 1) {
    const labels = [...new Set(multiIdx.map((i) => String(headers[i] || '').trim()).filter(Boolean))];
    dateHeader = labels.length ? `${labels.join(' / ')} (${multiIdx.length} cols)` : '';
  } else {
    const dc = dateColsForMatch[0];
    dateHeader = dc >= 0 && dc < headers.length ? String(headers[dc] || '').trim() : '';
  }

  return { headers, rowsToday, rowsAll: body, dateCol: dateColsForMatch[0], today, dateHeader };
}

/**
 * One fetch of Bobbot_History with the same **request_date** column OR-semantics as `readSheetFilterToday` (`bobbotRequestDateMatch`).
 * Use this when you need both “today” and “this week” rows without reading the sheet twice.
 * @returns {{ headers: string[], rows: any[][], dateColsForMatch: number[], dateHeader: string, today: string }}
 */
async function readBobbotHistoryBody(spreadsheetId, tab, a1Suffix = 'A1:ZZ20000') {
  const t = (tab || 'Sheet1').replace(/'/g, "''");
  const range = `'${t}'!${a1Suffix}`;
  const values = await getSheetValues(spreadsheetId, range, {
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  const today = todayCTDateStr();
  if (!values.length) {
    return { headers: [], rows: [], dateColsForMatch: [5], dateHeader: '', today };
  }
  const headers = (values[0] || []).map((h) => String(h || '').trim());
  const bobbotDatePrefers = ['request_date', 'Request_Date', 'Request Date', 'request date'];
  const multiIdx = collectRequestDateColumnIndices(headers, bobbotDatePrefers);
  const dateColsForMatch = multiIdx.length > 0 ? multiIdx : [5];

  let dateHeader = '';
  if (multiIdx.length > 1) {
    const labels = [...new Set(multiIdx.map((i) => String(headers[i] || '').trim()).filter(Boolean))];
    dateHeader = labels.length ? `${labels.join(' / ')} (${multiIdx.length} cols)` : '';
  } else if (multiIdx.length === 1) {
    const fi = multiIdx[0];
    const label = fi < headers.length ? String(headers[fi] || '').trim() : '';
    dateHeader = label
      ? `${label} (col ${columnLetterFromIndex(fi)})`
      : `Column ${columnLetterFromIndex(fi)}`;
  } else {
    dateHeader = `request_date → col ${columnLetterFromIndex(5)} (fallback)`;
  }

  const hl = headers.length;
  const rows = values.slice(1).map((row) => padRowToHeaders(row, hl));

  return { headers, rows, dateColsForMatch, dateHeader, today };
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

module.exports = { readSheetFilterToday, readSheetFilterWeek, readBobbotHistoryBody };
