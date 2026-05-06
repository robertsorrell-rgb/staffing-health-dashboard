'use strict';

const {
  getSheetValues,
  normalizeDateCell,
  ok,
  errorResponse,
  handleOptions,
  resolveSpreadsheetTabTitle,
} = require('./_sheets.js');
const { todayCTDateStr } = require('./lib/ct.js');
const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('ADHERENCE_CACHE_SECONDS'), 10);

/** @param {unknown} v */
function cellToString(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object') return '';
  return String(v);
}

/**
 * Prefer formatted display strings; when Sheets leaves FORMATTED_VALUE empty (some emoji / rich cells),
 * fall back to UNFORMATTED_VALUE so we still see "Significant OOA …".
 * @param {string[][]} formatted
 * @param {string[][]} unformatted
 */
function mergeFormattedUnformattedRows(formatted, unformatted) {
  const rows = Math.max(formatted.length, unformatted.length);
  const out = [];
  for (let i = 0; i < rows; i++) {
    const fr = formatted[i] || [];
    const ur = unformatted[i] || [];
    const cols = Math.max(fr.length, ur.length);
    const row = [];
    for (let j = 0; j < cols; j++) {
      const fs = cellToString(fr[j]).trim();
      const us = cellToString(ur[j]).trim();
      row.push(fs || us || '');
    }
    out.push(row);
  }
  return out;
}

/**
 * Ops sheets often insert title rows above the real header — find the row that looks like Live Floor headers.
 * @param {string[][]} values
 */
function findLiveFloorHeaderRowIndex(values) {
  const max = Math.min(values.length, 45);
  let bestR = 0;
  let bestScore = -1;
  for (let r = 0; r < max; r++) {
    const cells = (values[r] || []).map((c) => cellToString(c).trim().toLowerCase());
    const hasName = cells.some((c) => c === 'name' || (/name/.test(c) && !/email/.test(c)));
    const hasFlex = cells.some((c) => /flex/.test(c) && /state/.test(c));
    const hasAdh = cells.some((c) => c.includes('adherence'));
    const hasEmail = cells.some((c) => c.includes('email'));
    const score = (hasName ? 3 : 0) + (hasFlex ? 2 : 0) + (hasAdh ? 3 : 0) + (hasEmail ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestR = r;
    }
  }
  return bestScore >= 5 ? bestR : 0;
}

/**
 * @param {string} text
 */
function isOutOfAdherenceCell(text) {
  const raw = cellToString(text).trim();
  if (!raw) return false;
  const t = raw.toLowerCase();
  const inOnly =
    /\bin adherence\b/.test(t) &&
    !/\booa\b/.test(t) &&
    !/out\s+of\s+adherence/.test(t) &&
    !/significant/.test(t) &&
    !/🚨/.test(raw) &&
    !/⚠️/.test(raw);
  if (inOnly) return false;
  if (/\booa\b/.test(t) || /out\s+of\s+adherence/.test(t)) return true;
  if (/🚨/.test(raw) && (/significant|ooa|adher/.test(t) || /\(\s*\d/.test(raw))) return true;
  if (/significant/.test(t) && /\(\s*\d/.test(raw)) return true;
  return false;
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function extractOoaMinutes(text) {
  const s = cellToString(text);
  const paren = s.match(/\(\s*(\d+)\s*m(?:in(?:utes)?)?\s*\)/i);
  if (paren) return parseInt(paren[1], 10);
  const parenBare = s.match(/\(\s*(\d+)\s*\)/);
  if (parenBare) return parseInt(parenBare[1], 10);
  const loose = s.match(/(\d+)\s*m\b/i);
  if (loose) return parseInt(loose[1], 10);
  return null;
}

/**
 * @param {string[][]} values
 * @returns {{ name: string, state: string, ooa_display: string, ooa_minutes: number | null }[]}
 */
function parseLiveFloorOoaRows(values) {
  if (!values || values.length < 2) return [];
  const headerIdx = findLiveFloorHeaderRowIndex(values);
  const headers = (values[headerIdx] || []).map((h) => cellToString(h).trim().toLowerCase());
  const findCol = (pred) => headers.findIndex(pred);

  let nameCol = findCol((h) => /^name$/i.test(h));
  if (nameCol < 0) nameCol = findCol((h) => h.includes('name') && !h.includes('email'));
  if (nameCol < 0) nameCol = 0;

  let stateCol = findCol((h) => /flex\s*state/.test(h) || h === 'state');
  if (stateCol < 0) {
    stateCol = findCol((h) => h.includes('state') && !/time\s+in/i.test(h));
  }
  if (stateCol < 0) stateCol = 2;

  let adhCol = findCol((h) => h.includes('adherence'));
  if (adhCol < 0) adhCol = 6;

  const out = [];
  for (let r = headerIdx + 1; r < values.length; r++) {
    const row = values[r] || [];
    const name = cellToString(row[nameCol]).trim();
    if (!name || /^name$/i.test(name)) continue;
    const state = cellToString(row[stateCol]).trim();
    const adhRaw = cellToString(row[adhCol]).trim();
    if (!isOutOfAdherenceCell(adhRaw)) continue;
    out.push({
      name,
      state,
      ooa_display: adhRaw,
      ooa_minutes: extractOoaMinutes(adhRaw),
    });
  }
  return out;
}

/**
 * @param {string} spreadsheetId
 * @returns {Promise<{ range: string, tabTitle: string }>}
 */
async function resolveLiveFloorRangeParts(spreadsheetId) {
  const explicit = (process.env.ADHERENCE_LIVE_FLOOR_RANGE || '').trim();
  const tabHint = (env('ADHERENCE_LIVE_FLOOR_TAB') || 'Live Floor').trim();
  const gid = env('ADHERENCE_LIVE_FLOOR_SHEET_GID').trim();
  if (explicit) {
    const m = explicit.match(/^'([^']+)'\s*!/);
    const tabGuess = m ? m[1].replace(/''/g, "'") : tabHint;
    return { range: explicit, tabTitle: tabGuess };
  }
  let tabTitle = tabHint;
  try {
    tabTitle = await resolveSpreadsheetTabTitle(spreadsheetId, {
      sheetGid: gid || undefined,
      tabHint,
    });
  } catch {
    tabTitle = tabHint;
  }
  const esc = tabTitle.replace(/'/g, "''");
  return { range: `'${esc}'!A1:J4000`, tabTitle };
}

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const spreadsheetId = env('ADHERENCE_SPREADSHEET_ID');
  const alertsTab = env('ADHERENCE_ALERTS_TAB') || 'Adherence_Alert_Log';
  const alertsRange =
    (process.env.ADHERENCE_ALERTS_RANGE || '').trim() || `'${alertsTab.replace(/'/g, "''")}'!A1:Z50000`;
  const digestUrl = (process.env.ADHERENCE_DIGEST_URL || '').trim();

  const emptyPayload = {
    configured: false,
    ping1_today: null,
    ping2_today: null,
    top_managers: [],
    digest_url: digestUrl || null,
    live_floor_ooa: [],
    live_floor_note: null,
    note: 'ADHERENCE_SPREADSHEET_ID not set',
    fetched_at: new Date().toISOString(),
  };

  if (!spreadsheetId) {
    return ok(emptyPayload, CACHE_SEC);
  }

  try {
    const { range: liveFloorRange, tabTitle: liveFloorTabTitle } =
      await resolveLiveFloorRangeParts(spreadsheetId);
    const [values, liveFloorFmt, liveFloorRaw] = await Promise.all([
      getSheetValues(spreadsheetId, alertsRange, {
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
      }),
      getSheetValues(spreadsheetId, liveFloorRange, {
        valueRenderOption: 'FORMATTED_VALUE',
      }).catch((err) => ({ __error: err.message || String(err) })),
      getSheetValues(spreadsheetId, liveFloorRange, {
        valueRenderOption: 'UNFORMATTED_VALUE',
      }).catch((err) => ({ __error: err.message || String(err) })),
    ]);

    const fmtArr = Array.isArray(liveFloorFmt) ? liveFloorFmt : null;
    const rawArr = Array.isArray(liveFloorRaw) ? liveFloorRaw : null;
    const fmtErr =
      liveFloorFmt && typeof liveFloorFmt === 'object' && liveFloorFmt.__error
        ? liveFloorFmt.__error
        : null;
    const rawErr =
      liveFloorRaw && typeof liveFloorRaw === 'object' && liveFloorRaw.__error
        ? liveFloorRaw.__error
        : null;

    let liveFloorMerged = [];
    let liveFloorFetchErr = null;
    if (fmtArr && rawArr) {
      liveFloorMerged = mergeFormattedUnformattedRows(fmtArr, rawArr);
    } else if (fmtArr) {
      liveFloorMerged = fmtArr;
    } else if (rawArr) {
      liveFloorMerged = rawArr;
    } else {
      liveFloorFetchErr = fmtErr || rawErr || 'Live Floor range returned no usable rows';
    }

    const today = todayCTDateStr();
    const headers = (values[0] || []).map((h) => String(h || '').trim().toLowerCase());

    const findCol = (pred) => headers.findIndex(pred);
    const dateCol = findCol((h) => h.includes('date') || h === 'day' || h.includes('timestamp'));
    const mgrCol = findCol((h) => h.includes('manager') || h.includes('supervisor') || h.includes('lead'));

    let typeCol = findCol((h) => /ping|alert|level|tier|type|alert_type/.test(h));
    if (typeCol < 0) typeCol = findCol((h) => h.includes('notification'));

    const dc = dateCol >= 0 ? dateCol : 0;

    let ping1 = 0;
    let ping2 = 0;
    const mgrCounts = {};

    for (let r = 1; r < values.length; r++) {
      const row = values[r] || [];
      if (normalizeDateCell(row[dc]) !== today) continue;
      const typeRaw = typeCol >= 0 ? String(row[typeCol] || '').toLowerCase() : '';
      if (/ping\s*1|^p1\b|first\s*ping|tier\s*1|level\s*1/.test(typeRaw)) ping1++;
      else if (/ping\s*2|^p2\b|second\s*ping|tier\s*2|level\s*2/.test(typeRaw)) ping2++;
      else if (/ping/.test(typeRaw)) {
        if (typeRaw.includes('2')) ping2++;
        else if (typeRaw.includes('1')) ping1++;
      }

      if (mgrCol >= 0) {
        const m = String(row[mgrCol] || '').trim();
        if (m) mgrCounts[m] = (mgrCounts[m] || 0) + 1;
      }
    }

    const topManagers = Object.entries(mgrCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    let live_floor_ooa = [];
    let live_floor_note = null;
    if (liveFloorFetchErr) {
      live_floor_note = `Live Floor tab read failed: ${liveFloorFetchErr}`;
    } else if (liveFloorMerged.length) {
      live_floor_ooa = parseLiveFloorOoaRows(liveFloorMerged);
    }

    return ok(
      {
        configured: true,
        ping1_today: ping1,
        ping2_today: ping2,
        top_managers: topManagers,
        digest_url: digestUrl || null,
        live_floor_ooa,
        live_floor_note,
        live_floor_sheet_tab: liveFloorTabTitle,
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  } catch (err) {
    return errorResponse(err, 'adherence');
  }
};
