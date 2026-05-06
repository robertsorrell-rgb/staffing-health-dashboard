'use strict';

/**
 * OT fill for today (CT): Overtime Review–style tabs (open slots vs filled, 30-min slots → hours).
 * Raw open/filled are typically “hours × 2” slot counts; divide by OT_FILL_SLOT_DIVISOR (default 2).
 */

const {
  getSheetValues,
  resolveSpreadsheetTabTitle,
  parseSheetNumber,
  normalizeDateCell,
  ok,
  errorResponse,
  handleOptions,
} = require('./_sheets.js');
const { todayCTDateStr } = require('./lib/ct.js');
const { env } = require('./lib/deploy-defaults.js');

const CACHE_RAW = env('OT_FILL_CACHE_SECONDS');
const CACHE_SEC = Number.isFinite(parseInt(CACHE_RAW, 10)) ? parseInt(CACHE_RAW, 10) : 300;

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** @returns {{ dateCol: number, groupCol: number, openSlotsCol: number, filledCol: number, fillPctCol: number, offeredCol: number }} */
function detectColumns(headers) {
  const n = headers.map(normHeader);

  let dateCol = -1;
  for (let i = 0; i < n.length; i++) {
    const h = n[i];
    if (!h) continue;
    if (h === 'day' || h === 'date' || h.startsWith('calendar')) {
      dateCol = i;
      break;
    }
    if (h.includes('date') && !h.includes('updated') && !h.includes('timestamp')) {
      dateCol = i;
      break;
    }
  }

  let groupCol = -1;
  for (let i = 0; i < n.length; i++) {
    const h = n[i];
    if (h === 'sg' || /(sales group|consultant group|queue name|queue|team)\b/.test(h)) {
      groupCol = i;
      break;
    }
    if (/\bgroup\b/.test(h) && !/subgroup/.test(h)) {
      groupCol = i;
      break;
    }
  }

  let fillPctCol = -1;
  for (let i = 0; i < n.length; i++) {
    const h = n[i];
    if (/% filled|pct filled|percent filled/.test(h) || (h.includes('%') && h.includes('fill'))) {
      fillPctCol = i;
      break;
    }
  }

  let openSlotsCol = -1;
  for (let i = 0; i < n.length; i++) {
    const h = n[i];
    if (/open.*slot/.test(h)) openSlotsCol = i;
  }

  let filledCol = -1;
  for (let i = 0; i < n.length; i++) {
    const h = n[i];
    if (i === openSlotsCol || i === fillPctCol) continue;
    if (h.includes('filled') && !h.includes('unfilled')) filledCol = i;
  }

  let offeredCol = -1;
  for (let i = 0; i < n.length; i++) {
    const h = n[i];
    if (i === openSlotsCol || i === filledCol || i === fillPctCol) continue;
    if (/^offered$|^requested$|slots offered/.test(h)) offeredCol = i;
  }

  return { dateCol, groupCol, openSlotsCol, filledCol, fillPctCol, offeredCol };
}

/**
 * Header may not be row 1 (title rows, IMPORTRANGE placeholder row, etc.).
 * Scan the first rows for a line that looks like the OT table header.
 */
function findHeaderRow(values) {
  const maxScan = Math.min(25, values.length);
  const rowHeaders = (r) => (values[r] || []).map((h) => String(h || '').trim());

  for (let r = 0; r < maxScan; r++) {
    const headers = rowHeaders(r);
    if (!headers.some(Boolean)) continue;
    const col = detectColumns(headers);
    const hoursMode = col.openSlotsCol >= 0 && col.filledCol >= 0;
    const legacyOffered = col.filledCol >= 0 && col.offeredCol >= 0 && !hoursMode;
    const hasMetric = hoursMode || col.fillPctCol >= 0 || legacyOffered;
    if (col.dateCol >= 0 && hasMetric) {
      return { headerRow: r, headers, col };
    }
  }

  for (let r = 0; r < maxScan; r++) {
    const headers = rowHeaders(r);
    if (!headers.some(Boolean)) continue;
    const col = detectColumns(headers);
    if (col.dateCol >= 0) {
      return { headerRow: r, headers, col };
    }
  }

  return {
    headerRow: 0,
    headers: rowHeaders(0),
    col: detectColumns(rowHeaders(0)),
  };
}

function parsePctCell(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    if (cell >= 0 && cell <= 1) return Math.round(cell * 1000) / 10;
    return Math.round(cell * 10) / 10;
  }
  const s = String(cell).trim().replace(/,/g, '');
  const m = s.match(/([\d.]+)\s*%?/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  if (v >= 0 && v <= 1 && !/%/.test(s)) return Math.round(v * 1000) / 10;
  return Math.round(v * 10) / 10;
}

function round1(x) {
  return Math.round(Number(x) * 10) / 10;
}

function warningThresholdPct() {
  const warnParsed = parseFloat(env('OT_FILL_WARNING_MAX_PCT') || '75');
  return Number.isFinite(warnParsed) ? warnParsed : 75;
}

function warningMaxRows() {
  const n = parseInt(env('OT_FILL_WARNING_MAX_ROWS') || '150', 10);
  return Number.isFinite(n) ? Math.min(500, Math.max(10, n)) : 150;
}

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const spreadsheetId = env('OT_FILL_SPREADSHEET_ID');
  const tab = env('OT_FILL_TAB');

  if (!String(spreadsheetId).trim()) {
    return ok(
      {
        configured: false,
        note: 'Set OT_FILL_SPREADSHEET_ID.',
        today: todayCTDateStr(),
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  }

  if (!String(tab).trim()) {
    return ok(
      {
        configured: false,
        note: 'Set OT_FILL_TAB (e.g. OVERTIME REVIEW).',
        today: todayCTDateStr(),
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  }

  const divisorRaw = env('OT_FILL_SLOT_DIVISOR');
  const divisorParsed = parseFloat(divisorRaw || '2');
  const slotDivisor = Number.isFinite(divisorParsed) && divisorParsed > 0 ? divisorParsed : 2;

  try {
    const sheetGid = env('OT_FILL_SHEET_GID');
    const resolvedTitle = await resolveSpreadsheetTabTitle(spreadsheetId, {
      tabHint: tab,
      sheetGid: sheetGid || undefined,
    });
    const t = resolvedTitle.replace(/'/g, "''");
    const range = `'${t}'!A1:ZZ20000`;
    const values = await getSheetValues(spreadsheetId, range, {
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });

    if (!values.length) {
      const warnMaxPct = warningThresholdPct();
      return ok(
        {
          configured: true,
          today: todayCTDateStr(),
          note: 'Empty tab',
          units: 'hours',
          slot_divisor: slotDivisor,
          by_group: {},
          floor_hours_open: null,
          floor_hours_filled: null,
          floor_fill_pct: null,
          rows_today: 0,
          fill_warnings: [],
          fill_warning_max_pct: warnMaxPct,
          fill_warnings_omitted: 0,
          fetched_at: new Date().toISOString(),
        },
        CACHE_SEC
      );
    }

    const { headerRow, headers, col } = findHeaderRow(values);

    if (col.dateCol < 0) {
      const warnMaxPct = warningThresholdPct();
      return ok(
        {
          configured: true,
          today: todayCTDateStr(),
          note:
            'Could not find Day / Date column in the first header row (scanned top 25 rows).',
          headers_preview: headers.slice(0, 20),
          units: 'hours',
          slot_divisor: slotDivisor,
          by_group: {},
          floor_hours_open: null,
          floor_hours_filled: null,
          floor_fill_pct: null,
          rows_today: 0,
          fill_warnings: [],
          fill_warning_max_pct: warnMaxPct,
          fill_warnings_omitted: 0,
          fetched_at: new Date().toISOString(),
        },
        CACHE_SEC
      );
    }

    const hoursMode = col.openSlotsCol >= 0 && col.filledCol >= 0;
    const legacyOffered = col.filledCol >= 0 && col.offeredCol >= 0 && !hoursMode;
    const hasMetric = hoursMode || col.fillPctCol >= 0 || legacyOffered;

    if (!hasMetric) {
      const warnMaxPct = warningThresholdPct();
      return ok(
        {
          configured: true,
          today: todayCTDateStr(),
          note:
            'Could not find Open slots + Filled columns (or Fill % / Offered+Filled). Check row 1 headers.',
          headers_preview: headers.slice(0, 20),
          units: 'hours',
          slot_divisor: slotDivisor,
          by_group: {},
          floor_hours_open: null,
          floor_hours_filled: null,
          floor_fill_pct: null,
          rows_today: 0,
          fill_warnings: [],
          fill_warning_max_pct: warnMaxPct,
          fill_warnings_omitted: 0,
          fetched_at: new Date().toISOString(),
        },
        CACHE_SEC
      );
    }

    const today = todayCTDateStr();
    const warnMaxPct = warningThresholdPct();
    const warnRowCap = warningMaxRows();
    /** @type {Record<string, { ho: number, hf: number, pcts: number[] }>} */
    const agg = {};
    /** @type {Array<{ date: string, group: string, hours_open: number|null, hours_filled: number|null, fill_pct: number }>} */
    const fill_warnings = [];
    let fill_warnings_omitted = 0;

    let sumHO = 0;
    let sumHF = 0;
    let rowCount = 0;
    const flatPcts = [];

    for (let r = headerRow + 1; r < values.length; r++) {
      const row = values[r] || [];
      const ds = normalizeDateCell(row[col.dateCol]);
      if (!ds) continue;

      const group =
        col.groupCol >= 0 ? String(row[col.groupCol] || '').trim() || 'Floor' : 'Floor';

      /** Early warning: future OT fill gaps only (exclude today — covered by TODAY table). */
      const afterToday = ds > today;

      if (hoursMode) {
        const rawO = parseSheetNumber(row[col.openSlotsCol]);
        const rawF = parseSheetNumber(row[col.filledCol]);
        const slotsO = rawO != null && rawO >= 0 ? rawO : 0;
        const slotsF = rawF != null && rawF >= 0 ? rawF : 0;
        const ho = slotsO / slotDivisor;
        const hf = slotsF / slotDivisor;

        if (afterToday && ho > 0) {
          // Always derive % from the same open/filled slot columns as hours (÷ divisor).
          // The sheet's "% filled" cell can differ slightly (rounding / formula); mixing it
          // with displayed hours made early-warning rows look inconsistent vs the sheet grid.
          const pctForWarn = Math.round((hf / ho) * 1000) / 10;
          if (pctForWarn < warnMaxPct) {
            if (fill_warnings.length < warnRowCap) {
              fill_warnings.push({
                date: ds,
                group,
                hours_open: round1(ho),
                hours_filled: round1(hf),
                fill_pct: pctForWarn,
              });
            } else {
              fill_warnings_omitted++;
            }
          }
        }

        if (ds === today) {
          rowCount++;
          if (!agg[group]) agg[group] = { ho: 0, hf: 0, pcts: [] };
          agg[group].ho += ho;
          agg[group].hf += hf;
          sumHO += ho;
          sumHF += hf;
        }
      } else if (legacyOffered) {
        const f = parseSheetNumber(row[col.filledCol]);
        const o = parseSheetNumber(row[col.offeredCol]);

        if (afterToday && f != null && o != null && o > 0) {
          const pctForWarn = Math.round((f / o) * 1000) / 10;
          if (pctForWarn < warnMaxPct) {
            if (fill_warnings.length < warnRowCap) {
              fill_warnings.push({
                date: ds,
                group,
                hours_open: round1(o),
                hours_filled: round1(f),
                fill_pct: pctForWarn,
              });
            } else {
              fill_warnings_omitted++;
            }
          }
        }

        if (ds === today) {
          rowCount++;
          if (!agg[group]) agg[group] = { ho: 0, hf: 0, pcts: [] };
          if (f != null && o != null && o > 0) {
            agg[group].hf += f;
            agg[group].ho += o;
            sumHF += f;
            sumHO += o;
          }
        }
      } else if (col.fillPctCol >= 0) {
        const pct = parsePctCell(row[col.fillPctCol]);
        if (afterToday && pct != null && pct < warnMaxPct) {
          if (fill_warnings.length < warnRowCap) {
            fill_warnings.push({
              date: ds,
              group,
              hours_open: null,
              hours_filled: null,
              fill_pct: pct,
            });
          } else {
            fill_warnings_omitted++;
          }
        }

        if (ds === today) {
          rowCount++;
          if (!agg[group]) agg[group] = { ho: 0, hf: 0, pcts: [] };
          if (pct != null) {
            agg[group].pcts.push(pct);
            flatPcts.push(pct);
          }
        }
      }
    }

    fill_warnings.sort((a, b) =>
      a.date === b.date ? String(a.group).localeCompare(String(b.group)) : a.date.localeCompare(b.date)
    );

    /** @type {Record<string, number | { hours_open: number, hours_filled: number, fill_pct: number|null }>} */
    const by_group = {};

    for (const [g, x] of Object.entries(agg)) {
      if (hoursMode || legacyOffered) {
        const ho = round1(x.ho);
        const hf = round1(x.hf);
        const fill_pct = x.ho > 0 ? Math.round((x.hf / x.ho) * 1000) / 10 : null;
        by_group[g] = {
          hours_open: ho,
          hours_filled: hf,
          fill_pct,
        };
      } else if (x.pcts.length) {
        const avg = Math.round((x.pcts.reduce((a, b) => a + b, 0) / x.pcts.length) * 10) / 10;
        by_group[g] = avg;
      }
    }

    let floor_hours_open = hoursMode || legacyOffered ? round1(sumHO) : null;
    let floor_hours_filled = hoursMode || legacyOffered ? round1(sumHF) : null;
    let floor_fill_pct = null;
    if (sumHO > 0) floor_fill_pct = Math.round((sumHF / sumHO) * 1000) / 10;
    else if (!hoursMode && !legacyOffered && flatPcts.length) {
      floor_fill_pct = Math.round((flatPcts.reduce((a, b) => a + b, 0) / flatPcts.length) * 10) / 10;
    }

    return ok(
      {
        configured: true,
        today,
        ot_fill_tab: resolvedTitle,
        ot_fill_tab_config: tab,
        units: hoursMode || legacyOffered ? 'hours' : 'pct',
        slot_divisor: hoursMode ? slotDivisor : null,
        floor_hours_open,
        floor_hours_filled,
        floor_fill_pct,
        by_group,
        rows_today: rowCount,
        fill_warnings,
        fill_warning_max_pct: warnMaxPct,
        fill_warnings_omitted,
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  } catch (err) {
    return errorResponse(err, 'ot-fill-rate');
  }
};
