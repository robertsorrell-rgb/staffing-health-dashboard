'use strict';

const { ok, errorResponse, handleOptions, normalizeDateCell } = require('./_sheets.js');
const { readSheetFilterToday } = require('./lib/filter-today.js');
const { todayCTDateStr } = require('./lib/ct.js');
const { env } = require('./lib/deploy-defaults.js');
const {
  lookerLogin,
  lookerRunQueryJson,
  lookerRunLookJson,
  lookerRunJsonToHeaderRows,
} = require('./lib/looker-api.js');

const CACHE_SEC = parseInt(env('SPEED_TO_LEAD_CACHE_SECONDS'), 10);

/** Optional dashboard link (same tab users hit in browser). Not secret. */
function lookerExploreUrlFromEnv() {
  const u = String(process.env.LOOKER_SPEED_TO_LEAD_EXPLORE_URL || '').trim();
  if (!u) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function salesGroupColumnIndex(headers) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  const idx = lower.findIndex(
    (h) =>
      h === 'sales group' ||
      h.includes('sales group') ||
      h === 'sales_group' ||
      h === 'queue' ||
      (h.includes('queue') && !h.includes('request'))
  );
  return idx >= 0 ? idx : -1;
}

/** Prefer env SPEED_TO_LEAD_SPEED_MINUTES_COL_INDEX (0-based); else score headers. */
function resolveSpeedMinutesColumnIndex(headers) {
  const raw = process.env.SPEED_TO_LEAD_SPEED_MINUTES_COL_INDEX;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const fixed = parseInt(String(raw).trim(), 10);
    if (Number.isFinite(fixed) && fixed >= 0 && fixed < headers.length) return fixed;
  }

  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  const scored = [];
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    let score = 0;
    if (h.includes('speed') && h.includes('lead')) score += 14;
    if (h.includes('speed_to_lead')) score += 14;
    if (h.includes('speed to lead')) score += 14;
    if (/\bstl\b/.test(h) && (h.includes('min') || h.includes('time'))) score += 11;
    if ((h.includes('response') || h.includes('first')) && (h.includes('min') || h.includes('time'))) score += 9;
    if (h.includes('handle') && (h.includes('time') || h.includes('min'))) score += 7;
    if (h.includes('contact') && h.includes('min')) score += 6;
    if (h.includes('speed') && (h.includes('contact') || h.includes('response'))) score += 12;
    if (/time[_\s-]?to[_\s-]?(contact|response|reply|touch|lead|call)/.test(h)) score += 12;
    if (/\b(ttc|speed_to_contact|contact_speed)\b/.test(h)) score += 11;
    const timingWord =
      h.includes('min') ||
      h.includes('minute') ||
      /\bsecs?\b/.test(h) ||
      h.includes('duration') ||
      h.includes('elapsed') ||
      h.includes('latency') ||
      h.includes('lag') ||
      h.includes('delay');
    const funnelWord =
      /\blead\b/.test(h) ||
      /\bcontact\b/.test(h) ||
      /\bfirst\b/.test(h) ||
      /\brouting\b/.test(h) ||
      /\bassign(ed|ment)?\b/.test(h) ||
      /\bqueue\b/.test(h);
    if (timingWord && funnelWord) score += 10;
    if (/\bsla\b/.test(h) && timingWord) score += 8;
    if ((/_mins?\b|\bmins?_|\bminutes?\b)/.test(h) || /\.minutes?\b/.test(h)) && funnelWord) score += 9;
    if (/\bwait\b/.test(h) && timingWord) score += 6;
    if (score > 0) scored.push({ i, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].i : -1;
}

function findDateColumnIndex(headers) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (h === 'date') return i;
    if (h.includes('calendar')) return i;
    if (/\btimestamp\b/.test(h)) return i;
    if (h.includes('lead_date') || h.includes('lead date')) return i;
    if (h.includes('created') && (h.includes('date') || h.includes('at'))) return i;
    if (h.includes('event_date') || h.includes('event date')) return i;
    if (h === 'day' || /(^|\s)day(\s|$)/.test(h)) return i;
  }
  return -1;
}

/** When source is Looker, optionally narrow to Chicago “today” if a parseable date column exists. */
function filterRowsByTodayCt(headers, rows, today) {
  const di = findDateColumnIndex(headers);
  if (di < 0) {
    return { rows, dateNote: null, dateFiltered: false };
  }
  const label = String(headers[di] || '').trim() || `column_${di}`;
  const out = [];
  for (const row of rows) {
    const ymd = normalizeDateCell(row[di]);
    if (ymd === today) out.push(row);
  }
  return { rows: out, dateNote: label, dateFiltered: true };
}

function parseMinutes(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
  const s = String(cell).trim().replace(/,/g, '');
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const m = s.match(/([\d.]+)\s*(?:min|minutes?)?/i);
  if (m) {
    const x = Number(m[1]);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

function median(nums) {
  const a = nums.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * @returns {object} API payload body (before ok())
 */
function buildSpeedToLeadPayload(headers, rows, today, ctx) {
  const {
    date_column_used = null,
    source = 'sheet',
    lookerArtifact = null,
    looker_explore_url = null,
  } = ctx || {};
  const exploreBit =
    looker_explore_url && typeof looker_explore_url === 'string' ? { looker_explore_url } : {};

  const speedCol = resolveSpeedMinutesColumnIndex(headers);
  const sgCol = salesGroupColumnIndex(headers);

  if (speedCol < 0) {
    const fieldList =
      headers.length > 0
        ? ` Looker fields (0-based index): ${headers
            .slice(0, 20)
            .map((name, idx) => `${idx}: ${String(name || '').trim() || '(empty)'}`)
            .join('; ')}${headers.length > 20 ? ' …' : '.'}`
        : '';
    return {
      configured: true,
      source,
      looker_artifact: lookerArtifact,
      today,
      date_column_used,
      summary: {
        rows_today: rows.length,
        rows_with_valid_minutes: 0,
        avg_speed_to_lead_minutes: null,
        median_speed_to_lead_minutes: null,
      },
      speed_column_used: null,
      note:
        source === 'looker'
          ? `Looker JSON had no recognizable speed-to-lead minutes field. Set SPEED_TO_LEAD_SPEED_MINUTES_COL_INDEX to the 0-based column index for minutes (see field list below), or rename the explore measure.${fieldList}`
          : `No speed-to-lead minutes column found. Set SPEED_TO_LEAD_SPEED_MINUTES_COL_INDEX (0-based column index) or add a header containing both “speed” and “lead”.${fieldList}`,
      headers,
      rows_preview: rows.slice(0, 5),
      fetched_at: new Date().toISOString(),
      ...exploreBit,
    };
  }

  const MAX_MIN = 10080;
  const minutesList = [];
  const byGroup = new Map();

  for (const row of rows) {
    const mins = parseMinutes(row[speedCol]);
    if (mins == null || mins < 0 || mins > MAX_MIN) continue;
    minutesList.push(mins);
    const g = sgCol >= 0 ? String(row[sgCol] ?? '').trim() || '—' : '—';
    const cur = byGroup.get(g) || { sum: 0, n: 0 };
    cur.sum += mins;
    cur.n += 1;
    byGroup.set(g, cur);
  }

  const avg =
    minutesList.length > 0
      ? Math.round((minutesList.reduce((a, b) => a + b, 0) / minutesList.length) * 100) / 100
      : null;
  const med = median(minutesList);

  const by_sales_group = [...byGroup.entries()]
    .map(([group, { sum, n }]) => ({
      group,
      rows: n,
      avg_speed_to_lead_minutes: Math.round((sum / n) * 100) / 100,
    }))
    .sort((a, b) => {
      if (b.rows !== a.rows) return b.rows - a.rows;
      return String(a.group).localeCompare(String(b.group));
    });

  return {
    configured: true,
    source,
    looker_artifact: lookerArtifact,
    today,
    date_column_used,
    speed_column_used: headers[speedCol] || `column_${speedCol}`,
    summary: {
      rows_today: rows.length,
      rows_with_valid_minutes: minutesList.length,
      avg_speed_to_lead_minutes: avg,
      median_speed_to_lead_minutes: med != null ? Math.round(med * 100) / 100 : null,
    },
    by_sales_group: by_sales_group.slice(0, 32),
    fetched_at: new Date().toISOString(),
    ...exploreBit,
  };
}

function lookerEnvReady() {
  const baseUrl = String(process.env.LOOKER_BASE_URL || '').trim();
  const clientId = String(process.env.LOOKER_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.LOOKER_CLIENT_SECRET || '').trim();
  const queryId = String(process.env.LOOKER_SPEED_TO_LEAD_QUERY_ID || '').trim();
  const lookId = String(process.env.LOOKER_SPEED_TO_LEAD_LOOK_ID || '').trim();
  if (!baseUrl || !clientId || !clientSecret) return null;
  if (lookId) return { baseUrl, clientId, clientSecret, lookId, queryId: null };
  if (queryId) return { baseUrl, clientId, clientSecret, queryId, lookId: null };
  return null;
}

/** Pull client_email from SA JSON for permission hints without importing full parser. */
function serviceAccountEmailFromEnv() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || typeof raw !== 'string') return '';
  const m = raw.match(/"client_email"\s*:\s*"([^"]+)"/);
  return m && m[1] ? m[1].trim() : '';
}

/**
 * Make Sheet vs Looker permission failures obvious in JSON `hint` (UI shows error + hint).
 * @param {Error} err
 * @param {{ usedLooker: boolean, spreadsheetId?: string }} ctx
 */
function enrichSpeedToLeadError(err, ctx) {
  const msg = err && err.message ? String(err.message) : 'Unknown error';
  const lower = msg.toLowerCase();
  const permissionish =
    lower.includes('does not have permission') ||
    lower.includes('permission_denied') ||
    lower.includes('insufficient permission');

  if (!permissionish) return err;

  const e = new Error(msg);
  const baseStatus = err.statusCode && err.statusCode >= 400 ? err.statusCode : 403;
  e.statusCode = baseStatus;

  if (ctx.usedLooker) {
    e.hint =
      'Looker: the API user cannot run this saved query/look. In Looker admin, grant the embed/API user access to the model/explore (or use credentials that can). Check LOOKER_SPEED_TO_LEAD_QUERY_ID / LOOKER_SPEED_TO_LEAD_LOOK_ID.';
  } else {
    const sa = serviceAccountEmailFromEnv();
    const share = sa
      ? `Share the speed-to-lead Google Sheet with ${sa} (Viewer).`
      : 'Share the speed-to-lead Google Sheet with the service account in GOOGLE_SERVICE_ACCOUNT_JSON (Viewer).';
    const id = ctx.spreadsheetId ? ` Spreadsheet id: ${ctx.spreadsheetId}.` : '';
    e.hint = `${share}${id} Or set LOOKER_BASE_URL + client id/secret + LOOKER_SPEED_TO_LEAD_QUERY_ID (or LOOK_ID) to use Looker instead of Sheets.`;
  }
  return e;
}

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const spreadsheetId = env('SPEED_TO_LEAD_SPREADSHEET_ID');
  const tab = env('SPEED_TO_LEAD_TAB');
  const today = todayCTDateStr();
  const lookerExploreUrl = lookerExploreUrlFromEnv();

  const lookerCfg = lookerEnvReady();

  try {
    if (lookerCfg) {
      const token = await lookerLogin(lookerCfg.baseUrl, lookerCfg.clientId, lookerCfg.clientSecret);
      const raw = lookerCfg.lookId
        ? await lookerRunLookJson(lookerCfg.baseUrl, token, lookerCfg.lookId)
        : await lookerRunQueryJson(lookerCfg.baseUrl, token, lookerCfg.queryId);
      let { headers, rows } = lookerRunJsonToHeaderRows(raw);

      const fr = filterRowsByTodayCt(headers, rows, today);
      rows = fr.rows;
      const dateMeta =
        fr.dateFiltered && fr.dateNote
          ? `${fr.dateNote} (CT today ${today})`
          : fr.dateFiltered
            ? `CT today ${today}`
            : 'Looker result — no date column detected; using all returned rows (filter in Looker if needed).';

      const artifact = lookerCfg.lookId
        ? { type: 'look', id: lookerCfg.lookId }
        : { type: 'query', id: lookerCfg.queryId };

      const payload = buildSpeedToLeadPayload(headers, rows, today, {
        date_column_used: dateMeta,
        source: 'looker',
        lookerArtifact: artifact,
        looker_explore_url: lookerExploreUrl,
      });
      return ok(payload, CACHE_SEC);
    }

    if (!spreadsheetId || !tab) {
      return ok(
        {
          configured: false,
          note:
            'Speed to lead not configured. Add Looker API keys (LOOKER_BASE_URL, LOOKER_CLIENT_ID, LOOKER_CLIENT_SECRET, and LOOKER_SPEED_TO_LEAD_QUERY_ID or LOOKER_SPEED_TO_LEAD_LOOK_ID), or set SPEED_TO_LEAD_SPREADSHEET_ID + SPEED_TO_LEAD_TAB.',
          fetched_at: new Date().toISOString(),
        },
        CACHE_SEC
      );
    }

    const { headers, rowsToday, dateHeader } = await readSheetFilterToday(
      spreadsheetId,
      tab,
      'A1:ZZ50000',
      {}
    );

    const payload = buildSpeedToLeadPayload(headers, rowsToday, today, {
      date_column_used: dateHeader || null,
      source: 'sheet',
      lookerArtifact: null,
      looker_explore_url: lookerExploreUrl,
    });
    return ok(payload, CACHE_SEC);
  } catch (err) {
    const usedLooker = !!lookerCfg;
    return errorResponse(enrichSpeedToLeadError(err, { usedLooker, spreadsheetId }), 'speed-to-lead');
  }
};
