'use strict';

/**
 * Net staffing heatmap: Assembled API (preferred) or Google Sheet Capacity Pull layout.
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
const { parseHourHeader } = require('./lib/hour-headers.js');
const { todayCTDateStr } = require('./lib/ct.js');
const { loadNetStaffingFromAssembled } = require('./lib/assembled-net-staffing.js');
const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('CAPACITY_PULL_CACHE_SECONDS'), 10);

/** Rows omitted from the net staffing heatmap (sheet may still contain these columns). */
const NET_STAFFING_EXCLUDED_GROUPS = new Set(['ISC']);

function filterNetStaffingMatrix(matrix) {
  return (matrix || []).filter((row) => !NET_STAFFING_EXCLUDED_GROUPS.has(String(row.group || '').trim()));
}

function tabRange(tab, a1) {
  const t = (tab || 'Sheet1').replace(/'/g, "''");
  return `'${t}'!${a1}`;
}

/** Apps Script Capacity Pull sheet: row1 group banding, row2 dates, col A time keys. */
function parseCapacityPullTwoHeaderLayout(values, todayIso) {
  if (!values || values.length < 3) return null;
  const r0 = values[0] || [];
  const r1 = values[1] || [];
  const a0 = String(r0[0] || '').trim().toLowerCase();
  const a1 = String(r1[0] || '').trim().toLowerCase();
  if (a0 !== 'sales group' || !a1.includes('time')) return null;

  let groupCarry = '';
  const colPick = [];
  const maxCol = Math.max(r0.length, r1.length, ...(values.slice(2).map((row) => row.length)));
  for (let c = 1; c < maxCol; c++) {
    const gCell = String(r0[c] || '').trim();
    if (gCell) groupCarry = gCell;
    const dNorm = normalizeDateCell(r1[c]);
    if (dNorm !== todayIso) continue;
    colPick.push({ group: groupCarry, col: c });
  }
  if (!colPick.length) return null;

  const acc = {};
  for (let r = 2; r < values.length; r++) {
    const row = values[r] || [];
    const hr = parseHourHeader(row[0]);
    if (hr == null) continue;
    for (const { group, col } of colPick) {
      let v = parseSheetNumber(row[col]);
      if (v == null) continue;
      if (Math.abs(v) <= 1 && !Number.isInteger(v)) v *= 100;
      if (!acc[group]) acc[group] = {};
      if (!acc[group][hr]) acc[group][hr] = { sum: 0, n: 0 };
      acc[group][hr].sum += v;
      acc[group][hr].n += 1;
    }
  }

  const hourSet = new Set();
  for (const g of Object.keys(acc)) {
    for (const hr of Object.keys(acc[g])) hourSet.add(parseInt(hr, 10));
  }
  const hours = [...hourSet].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);
  const matrix = [];
  const groupOrder = [...new Set(colPick.map((x) => x.group))];
  for (const group of groupOrder) {
    const hoursOut = {};
    for (const hr of hours) {
      const cell = acc[group] && acc[group][hr];
      if (!cell || !cell.n) continue;
      hoursOut[String(hr)] = Math.round((cell.sum / cell.n) * 10) / 10;
    }
    if (Object.keys(hoursOut).length) matrix.push({ group, hours: hoursOut });
  }

  return { matrix, hours };
}

/** Legacy single-header-row Capacity Pull layout */
function parseLegacyHourColumns(values) {
  let headerRowIdx = -1;
  const colToHour = {};

  for (let r = 0; r < Math.min(values.length, 40); r++) {
    const row = values[r] || [];
    let hits = 0;
    const tmp = {};
    for (let c = 1; c < row.length; c++) {
      const hr = parseHourHeader(row[c]);
      if (hr != null) {
        tmp[c] = hr;
        hits++;
      }
    }
    if (hits >= 3) {
      headerRowIdx = r;
      Object.assign(colToHour, tmp);
      break;
    }
  }

  if (headerRowIdx < 0) return null;

  const hourSet = [...new Set(Object.values(colToHour))].sort((a, b) => a - b);
  const matrix = [];

  for (let r = headerRowIdx + 1; r < values.length; r++) {
    const row = values[r] || [];
    const group = String(row[0] || '').trim();
    if (!group || /^total|^grand|^hour$/i.test(group)) continue;

    const hours = {};
    for (const [cStr, hr] of Object.entries(colToHour)) {
      const c = parseInt(cStr, 10);
      let v = parseSheetNumber(row[c]);
      if (v == null) continue;
      if (Math.abs(v) <= 1 && !Number.isInteger(v)) v *= 100;
      hours[String(hr)] = Math.round(v * 10) / 10;
    }
    if (Object.keys(hours).length === 0) continue;

    matrix.push({ group, hours });
  }

  return { matrix, hours: hourSet };
}

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const sourceMode = env('CAPACITY_PULL_SOURCE').toLowerCase();
  const apiKey = env('ASSEMBLED_API_KEY');
  const spreadsheetId = env('CAPACITY_PULL_SPREADSHEET_ID');
  const tab = env('CAPACITY_PULL_TAB') || 'Capacity Pull';

  /** auto: assembled if key present, else sheet; assembled|sheet forces primary */
  const mode = sourceMode || (apiKey ? 'auto' : 'sheet');

  try {
    const tryAssembled =
      apiKey && (mode === 'assembled' || mode === 'auto');

    if (tryAssembled) {
      try {
        const asm = await loadNetStaffingFromAssembled();
        if (asm && asm.matrix && asm.matrix.length) {
          return ok({ ok: true, ...asm, matrix: filterNetStaffingMatrix(asm.matrix) }, CACHE_SEC);
        }
        if (mode === 'assembled') {
          return ok(
            {
              ok: false,
              matrix: filterNetStaffingMatrix(asm?.matrix || []),
              hours: asm?.hours || [],
              source: 'assembled',
              note: asm?.note || 'No interval data from Assembled for today CT.',
              fetched_at: asm?.fetched_at || new Date().toISOString(),
            },
            CACHE_SEC
          );
        }
      } catch (e) {
        if (mode === 'assembled') return errorResponse(e, 'net-staffing-assembled');
        // eslint-disable-next-line no-console
        console.warn('[net-staffing] Assembled failed, sheet fallback:', e.message);
      }
    }

    if (!spreadsheetId) {
      if (mode === 'sheet')
        return bad('CAPACITY_PULL_SPREADSHEET_ID not configured (CAPACITY_PULL_SOURCE=sheet)', 503);
      return bad(
        'Net staffing: no sheet fallback (CAPACITY_PULL_SPREADSHEET_ID) after empty/failed Assembled',
        503
      );
    }

    const rangeOverride = (process.env.CAPACITY_PULL_RANGE || '').trim();
    const range = rangeOverride || tabRange(tab, 'A1:ZZ400');

    const values = await getSheetValues(spreadsheetId, range, {
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });

    const todayIso = todayCTDateStr();
    const two = parseCapacityPullTwoHeaderLayout(values, todayIso);
    let matrix;
    let hours;
    if (two && two.matrix.length) {
      matrix = filterNetStaffingMatrix(two.matrix);
      hours = two.hours;
    } else {
      const leg = parseLegacyHourColumns(values);
      if (!leg) {
        return ok(
          {
            ok: false,
            note:
              'Could not parse Capacity Pull layout (two-row Capacity Pull vs single hour-header row — see docs/sheet-contracts.md).',
            matrix: [],
            hours: [],
            fetched_at: new Date().toISOString(),
          },
          CACHE_SEC
        );
      }
      matrix = filterNetStaffingMatrix(leg.matrix);
      hours = leg.hours;
    }

    return ok(
      {
        ok: true,
        matrix,
        hours,
        source: 'sheet',
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  } catch (err) {
    return errorResponse(err, 'net-staffing');
  }
};
