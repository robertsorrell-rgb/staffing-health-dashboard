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
  const rules = [
    (h) => h === 'sales group' || h.includes('sales group') || h === 'sales_group',
    (h) => h.includes('work_group_blended') || (h.includes('work_group') && h.includes('blended')),
    (h) => h.includes('lead_source_group'),
    (h) => h === 'queue' || (h.includes('queue') && !h.includes('request') && !h.includes('transfer')),
  ];
  for (const rule of rules) {
    const idx = lower.findIndex(rule);
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Clock hour (CT) when intraday STL reporting starts; buckets before this are omitted when an hour column exists. */
function reportingDayStartHourCt() {
  const raw = env('SPEED_TO_LEAD_REPORTING_DAY_START_HOUR_CT');
  const n = parseInt(String(raw || '').trim(), 10);
  if (Number.isFinite(n) && n >= 0 && n <= 23) return n;
  return 7;
}

/** Omit from dual STL tables (last hour / today): unknown bucket + training cohort noise. */
function excludeFromStlDualPanelGroup(group) {
  const g = String(group ?? '').trim().replace(/\s+/g, ' ');
  if (!g) return true;
  if (g === '-' || g === '–' || g === '—') return true;
  if (/^consumer sales training$/i.test(g)) return true;
  return false;
}

/** Row grain hour bucket, e.g. contacts_w_lead_source.created_at_hour ("YYYY-MM-DD HH"). */
function hourBucketColumnIndex(headers) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  const idx = lower.findIndex((h) => {
    if (h.includes('hour_of_day')) return false;
    return h.includes('created_at_hour') || (h.includes('created_at') && h.includes('_hour'));
  });
  return idx >= 0 ? idx : -1;
}

function hourLabelSortKey(label) {
  const s = String(label ?? '').trim();
  const m = s.match(/\s(\d{1,2})$/);
  if (m) return parseInt(m[1], 10);
  const m2 = s.match(/^(\d{1,2})(?::\d{2})?$/);
  return m2 ? parseInt(m2[1], 10) : 999;
}

function formatHourBucketLabel(rawLabel) {
  const s = String(rawLabel ?? '').trim();
  const m = s.match(/(?:^|\s)(\d{1,2})(?::\d{2})?$/);
  if (!m) return s || '—';
  const h = parseInt(m[1], 10);
  if (!Number.isFinite(h) || h < 0 || h > 23) return s || '—';
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${suffix} CT`;
}

function hourOfDayFromCell(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const n = Math.floor(cell);
    return n >= 0 && n <= 23 ? n : null;
  }
  const s =
    Object.prototype.toString.call(cell) === '[object Date]'
      ? Number.isNaN(cell.getTime())
        ? ''
        : cell.toISOString()
      : String(cell).trim();
  if (!s) return null;

  const isoT = s.match(/[Tt](\d{1,2}):\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (isoT) {
    const h = parseInt(isoT[1], 10);
    if (Number.isFinite(h) && h >= 0 && h <= 23) return h;
  }
  const dateTime = s.match(/\s(\d{1,2}):\d{2}(?::\d{2})?(?:\.\d+)?(?:\s|$)/);
  if (dateTime) {
    const h = parseInt(dateTime[1], 10);
    if (Number.isFinite(h) && h >= 0 && h <= 23) return h;
  }
  const m = s.match(/(?:^|\s)(\d{1,2})(?::\d{2})?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  return h;
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
    if (h.includes('dial_time_to_first') || (h.includes('time_to_first') && h.includes('attempt'))) score += 22;
    if (/_sec\b|_seconds\b/.test(h)) score += 18;
    if (/\bbucket\b/.test(h)) score -= 30;
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
    if (
      funnelWord &&
      (h.includes('_mins') ||
        h.includes('_min_') ||
        h.includes('mins_') ||
        /\bminutes?\b/.test(h) ||
        /\.minutes?\b/.test(h))
    ) {
      score += 9;
    }
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
    if (h.includes('created_at_date')) return i;
    if (h.includes('created_at_hour')) return i;
    if (h.includes('lead_date') || h.includes('lead date')) return i;
    if (h.includes('event_date') || h.includes('event date')) return i;
  }
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (h === 'date') return i;
    if (h.includes('calendar')) return i;
    if (/\btimestamp\b/.test(h)) return i;
    if (h === 'day' || /(^|\s)day(\s|$)/.test(h)) return i;
    if (
      h.includes('created') &&
      h.includes('date') &&
      !/_hour\b/.test(h) &&
      !h.includes('hour_of_day')
    ) {
      return i;
    }
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

/** Looker often exposes STL as *_sec numeric dimensions — convert to minutes for the panel. */
function headerSuggestsSecondsColumn(headerName) {
  const h = String(headerName || '').trim().toLowerCase();
  if (/\bbucket\b/.test(h)) return false;
  // Use "_sec\b" not "\b_sec\b" — `\b` does not separate letters from underscores (e.g. activated_sec).
  if (/_sec\b|_secs\b|_seconds\b/.test(h)) return true;
  if (/seconds?$/.test(h) && !h.includes('minute')) return true;
  return false;
}

/**
 * Numeric STL as dashboard minutes. *_sec Looker fields are usually seconds;
 * very large values are often milliseconds mis-stored, which would inflate averages.
 */
function speedValueAsMinutes(cell, headerName) {
  const raw = parseMinutes(cell);
  if (raw == null || !Number.isFinite(raw)) return null;
  if (!headerSuggestsSecondsColumn(headerName)) return raw;

  const asSec = raw / 60;
  const asMs = raw / 60000;
  if (raw >= 2000 && asSec > 480 && asMs <= 240) return asMs;
  return asSec;
}

function median(nums) {
  const a = nums.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function headerLowerTail(header) {
  const h = String(header || '').trim().toLowerCase();
  const dot = h.lastIndexOf('.');
  return dot >= 0 ? h.slice(dot + 1) : h;
}

/** Exclude obvious dimensions so anonymized Looker measures (s, s_1) can win. */
function isExcludedSpeedInferColumn(header) {
  const h = String(header || '').trim().toLowerCase();
  const t = headerLowerTail(header);
  if (/created_at|timestamp/.test(h)) return true;
  if (/_date\b|_hour\b|hour_of_day/.test(h)) return true;
  if (/lead_count|net_lead|\.count\b|_count\b/.test(h)) return true;
  if (/\b_id\b/.test(h) || t.endsWith('_id')) return true;
  if (/\bbucket\b/.test(h)) return true;
  if (/talk_duration|ring_duration|hold_duration|queue_duration/.test(h)) return true;
  return false;
}

const STL_INFER_MAX_MIN = 10080;

/**
 * When headers are opaque (e.g. Looker `s`, `s_1`), pick the column whose cells
 * best resemble speed-to-lead minutes (numeric, plausible range, enough samples).
 */
function inferSpeedMinutesColumnFromRows(headers, rows) {
  const hl = headers.length;
  if (!hl || !rows.length) return -1;
  const sampleN = Math.min(rows.length, 60);
  let bestIdx = -1;
  let bestScore = -1;

  for (let i = 0; i < hl; i++) {
    if (isExcludedSpeedInferColumn(headers[i])) continue;
    const nums = [];
    for (let r = 0; r < sampleN; r++) {
      const row = rows[r];
      if (!Array.isArray(row) || row.length <= i) continue;
      const cell = row[i];
      // normalizeDateCell treats finite numbers as Excel serial days — skip for numeric cells
      // so small integers (Looker counts) are not mis-read as calendar dates.
      if (typeof cell !== 'number' || !Number.isFinite(cell)) {
        const ymd = normalizeDateCell(cell);
        if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      }
      const m = speedValueAsMinutes(cell, headers[i]);
      if (m != null && m >= 0 && m <= STL_INFER_MAX_MIN) nums.push(m);
    }
    const need = Math.max(2, Math.ceil(sampleN * 0.15));
    if (nums.length < need) continue;
    const med = median(nums);
    if (med == null || med < 0 || med > 7200) continue;
    const tail = headerLowerTail(headers[i]);
    let bonus = 0;
    if (headerSuggestsSecondsColumn(headers[i]) && /first|attempt|dial|lead|contact/.test(String(headers[i]).toLowerCase()))
      bonus += 120;
    if (/^s(_\d+)?$/i.test(tail)) bonus += 35;
    if (/median|average|mean/.test(tail)) bonus += 25;
    const score = nums.length * 10 + bonus;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function cellIsComplexLookerValue(cell) {
  if (cell == null) return false;
  if (typeof cell !== 'object') return false;
  if (Array.isArray(cell)) return false;
  // Avoid treating Date as “pivot blob” (unlikely from Looker JSON, but cheap guard).
  if (Object.prototype.toString.call(cell) === '[object Date]') return false;
  return true;
}

/** When measures show as s / s_1 but cells are nested objects, index overrides cannot work. */
function lookerPivotMinutesHint(headers, rows) {
  if (!headers.length || !rows.length) return '';
  const sample = rows.slice(0, 12);
  let samples = 0;
  let complex = 0;
  for (let i = 0; i < headers.length; i++) {
    const tail = headerLowerTail(headers[i]);
    if (!/^s(_\d+)?$/i.test(tail)) continue;
    for (const row of sample) {
      if (!Array.isArray(row) || row.length <= i) continue;
      samples += 1;
      if (cellIsComplexLookerValue(row[i])) complex += 1;
    }
  }
  if (samples >= 2 && complex / samples >= 0.5) {
    return ' The s / s_1 / … columns are nested JSON (pivoted or multi-dimensional measures), not numeric minutes. In Looker, remove pivots and expose a single numeric speed-to-lead field per row (or use a different saved query). Setting SPEED_TO_LEAD_SPEED_MINUTES_COL_INDEX cannot fix this until a column contains plain numbers.';
  }
  return '';
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

  let speedCol = resolveSpeedMinutesColumnIndex(headers);
  let speedColumnInferred = false;
  if (speedCol < 0 && rows.length > 0) {
    const inferred = inferSpeedMinutesColumnFromRows(headers, rows);
    if (inferred >= 0) {
      speedCol = inferred;
      speedColumnInferred = true;
    }
  }

  const sgCol = salesGroupColumnIndex(headers);
  const hrCol = hourBucketColumnIndex(headers);
  const reportingStartHour = hrCol >= 0 ? reportingDayStartHourCt() : null;

  if (speedCol < 0) {
    const fieldList =
      headers.length > 0
        ? ` Looker fields (0-based index): ${headers
            .slice(0, 20)
            .map((name, idx) => `${idx}: ${String(name || '').trim() || '(empty)'}`)
            .join('; ')}${headers.length > 20 ? ' …' : '.'}`
        : '';
    const lookerPivotHint = source === 'looker' ? lookerPivotMinutesHint(headers, rows) : '';
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
          ? `Looker JSON had no recognizable speed-to-lead minutes field. Set SPEED_TO_LEAD_SPEED_MINUTES_COL_INDEX to the 0-based column index for minutes (see field list below), or rename the explore measure.${fieldList}${lookerPivotHint}`
          : `No speed-to-lead minutes column found. Set SPEED_TO_LEAD_SPEED_MINUTES_COL_INDEX (0-based column index) or add a header containing both “speed” and “lead”.${fieldList}`,
      headers,
      rows_preview: rows.slice(0, 5),
      fetched_at: new Date().toISOString(),
      ...exploreBit,
    };
  }

  const MAX_MIN = 10080;
  const capRaw = parseInt(env('SPEED_TO_LEAD_SUMMARY_CAP_MINUTES'), 10);
  const summaryCapMin =
    Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 1440;

  const minutesList = [];
  /** @type {Map<string, { sum: number, values: number[] }>} */
  const byGroup = new Map();
  /** @type {Map<string, { sum: number, values: number[] }>} */
  const byHour = new Map();
  /** @type {Map<string, { hour_sort: number, hour_label: string, group: string, sum: number, values: number[] }>} */
  const byHourGroup = new Map();
  let excludedAboveCap = 0;
  let excludedBeforeReportingHour = 0;

  for (const row of rows) {
    const mins = speedValueAsMinutes(row[speedCol], headers[speedCol]);
    if (mins == null || mins < 0 || mins > MAX_MIN) continue;
    if (mins > summaryCapMin) {
      excludedAboveCap += 1;
      continue;
    }
    let rowHour = null;
    if (hrCol >= 0) rowHour = hourOfDayFromCell(row[hrCol]);
    if (reportingStartHour != null && rowHour != null && rowHour < reportingStartHour) {
      excludedBeforeReportingHour += 1;
      continue;
    }
    minutesList.push(mins);
    const g = sgCol >= 0 ? String(row[sgCol] ?? '').trim() || '—' : '—';
    const curG = byGroup.get(g) || { sum: 0, values: [] };
    curG.sum += mins;
    curG.values.push(mins);
    byGroup.set(g, curG);

    if (hrCol >= 0) {
      const hourNum = rowHour;
      if (hourNum != null) {
        const hl = String(hourNum).padStart(2, '0');
        const curH = byHour.get(hl) || { sum: 0, values: [] };
        curH.sum += mins;
        curH.values.push(mins);
        byHour.set(hl, curH);

        const gk = sgCol >= 0 ? String(row[sgCol] ?? '').trim() || '—' : '—';
        const comboKey = `${hl}||${gk}`;
        const curHG = byHourGroup.get(comboKey) || {
          hour_sort: hourNum,
          hour_label: formatHourBucketLabel(String(hourNum)),
          group: gk,
          sum: 0,
          values: [],
        };
        curHG.sum += mins;
        curHG.values.push(mins);
        byHourGroup.set(comboKey, curHG);
      }
    }
  }

  const avg =
    minutesList.length > 0
      ? Math.round((minutesList.reduce((a, b) => a + b, 0) / minutesList.length) * 100) / 100
      : null;
  const med = median(minutesList);

  const by_sales_group = [...byGroup.entries()]
    .map(([group, { sum, values }]) => {
      const n = values.length;
      const medG = median(values);
      return {
        group,
        rows: n,
        avg_speed_to_lead_minutes: Math.round((sum / n) * 100) / 100,
        median_speed_to_lead_minutes: medG != null ? Math.round(medG * 100) / 100 : null,
      };
    })
    .sort((a, b) => {
      if (b.rows !== a.rows) return b.rows - a.rows;
      return String(a.group).localeCompare(String(b.group));
    });

  const by_hour = [...byHour.entries()]
    .map(([hour_label, { sum, values }]) => {
      const n = values.length;
      const medH = median(values);
      return {
        hour_label: formatHourBucketLabel(hour_label),
        hour_sort: hourLabelSortKey(hour_label),
        rows: n,
        avg_speed_to_lead_minutes: Math.round((sum / n) * 100) / 100,
        median_speed_to_lead_minutes: medH != null ? Math.round(medH * 100) / 100 : null,
      };
    })
    .sort((a, b) => {
      if (a.hour_sort !== b.hour_sort) return a.hour_sort - b.hour_sort;
      return String(a.hour_label).localeCompare(String(b.hour_label));
    })
    .map(({ hour_sort: _hs, ...rest }) => rest);

  const by_hour_sales_group = [...byHourGroup.values()]
    .map((r) => {
      const n = r.values.length;
      return {
        hour_label: r.hour_label,
        hour_sort: r.hour_sort,
        group: r.group,
        rows: n,
        speed_to_lead_minutes: Math.round((r.sum / n) * 100) / 100,
      };
    })
    .sort((a, b) => {
      if (a.hour_sort !== b.hour_sort) return b.hour_sort - a.hour_sort;
      if (b.rows !== a.rows) return b.rows - a.rows;
      return String(a.group).localeCompare(String(b.group));
    })
    .map(({ hour_sort: _hs, ...rest }) => rest);

  let stl_last_hour_label = null;
  let stl_last_hour_by_group = null;
  let stl_today_by_group = null;
  let stl_spark_y_max = null;
  let stl_spark_hour_min = null;
  let stl_spark_hour_max = null;
  let stl_hourly_by_group = null;

  if (hrCol >= 0 && rows.length) {
    let latestHour = null;
    for (const row of rows) {
      const mins = speedValueAsMinutes(row[speedCol], headers[speedCol]);
      if (mins == null || mins < 0 || mins > MAX_MIN) continue;
      if (mins > summaryCapMin) continue;
      const h = hourOfDayFromCell(row[hrCol]);
      if (h == null || h < reportingStartHour) continue;
      if (latestHour == null || h > latestHour) latestHour = h;
    }

    if (latestHour != null) {
      /** @type {Map<string, { sum: number, values: number[] }>} */
      const hourOnly = new Map();
      for (const row of rows) {
        const h = hourOfDayFromCell(row[hrCol]);
        if (h !== latestHour) continue;
        const mins = speedValueAsMinutes(row[speedCol], headers[speedCol]);
        if (mins == null || mins < 0 || mins > MAX_MIN) continue;
        if (mins > summaryCapMin) continue;
        const g = sgCol >= 0 ? String(row[sgCol] ?? '').trim() || '—' : '—';
        const cur = hourOnly.get(g) || { sum: 0, values: [] };
        cur.sum += mins;
        cur.values.push(mins);
        hourOnly.set(g, cur);
      }

      const union = new Set([...byGroup.keys(), ...hourOnly.keys()]);
      const sortedGroups = [...union]
        .filter((g) => !excludeFromStlDualPanelGroup(g))
        .sort((a, b) => {
          const na = byGroup.get(a)?.values.length || 0;
          const nb = byGroup.get(b)?.values.length || 0;
          if (nb !== na) return nb - na;
          return String(a).localeCompare(String(b));
        });

      stl_last_hour_label = formatHourBucketLabel(String(latestHour));
      stl_last_hour_by_group = sortedGroups.map((g) => {
        const ho = hourOnly.get(g);
        if (!ho || !ho.values.length) {
          return {
            group: g,
            rows: 0,
            avg_speed_to_lead_minutes: null,
            median_speed_to_lead_minutes: null,
          };
        }
        const n = ho.values.length;
        const medG = median(ho.values);
        return {
          group: g,
          rows: n,
          avg_speed_to_lead_minutes: Math.round((ho.sum / n) * 100) / 100,
          median_speed_to_lead_minutes: medG != null ? Math.round(medG * 100) / 100 : null,
        };
      });
      stl_today_by_group = sortedGroups.map((g) => {
        const d = byGroup.get(g);
        if (!d || !d.values.length) {
          return {
            group: g,
            rows: 0,
            avg_speed_to_lead_minutes: null,
            median_speed_to_lead_minutes: null,
          };
        }
        const n = d.values.length;
        const medG = median(d.values);
        return {
          group: g,
          rows: n,
          avg_speed_to_lead_minutes: Math.round((d.sum / n) * 100) / 100,
          median_speed_to_lead_minutes: medG != null ? Math.round(medG * 100) / 100 : null,
        };
      });

      /** Per-group avg STL by clock hour (for idle-style mini sparklines). */
      /** @type {Map<string, Map<number, { avg_speed_to_lead_minutes: number, rows: number }>>} */
      const groupHourAvgs = new Map();
      for (const [comboKey, cur] of byHourGroup.entries()) {
        const sep = comboKey.indexOf('||');
        if (sep < 0) continue;
        const hk = comboKey.slice(0, sep);
        const gk = comboKey.slice(sep + 2);
        if (excludeFromStlDualPanelGroup(gk)) continue;
        const hNum = parseInt(hk, 10);
        if (!Number.isFinite(hNum) || hNum < 0 || hNum > 23) continue;
        const n = cur.values.length;
        if (!n) continue;
        const avgM = Math.round((cur.sum / n) * 100) / 100;
        if (!groupHourAvgs.has(gk)) groupHourAvgs.set(gk, new Map());
        groupHourAvgs.get(gk).set(hNum, { avg_speed_to_lead_minutes: avgM, rows: n });
      }

      let sparkHMin = 23;
      let sparkHMax = 0;
      let sparkPeak = 0;
      for (const hm of groupHourAvgs.values()) {
        for (const [h, cell] of hm) {
          sparkHMin = Math.min(sparkHMin, h);
          sparkHMax = Math.max(sparkHMax, h);
          sparkPeak = Math.max(sparkPeak, cell.avg_speed_to_lead_minutes);
        }
      }

      if (groupHourAvgs.size > 0 && sparkHMin <= sparkHMax) {
        const peakForScale = Math.max(sparkPeak, 1e-6);
        const yMaxSpark = Math.min(summaryCapMin, Math.max(5, Math.ceil(peakForScale * 1.06)));
        stl_spark_y_max = yMaxSpark;
        stl_spark_hour_min = sparkHMin;
        stl_spark_hour_max = sparkHMax;
        stl_hourly_by_group = sortedGroups.map((g) => {
          const hm = groupHourAvgs.get(g);
          const hours = [];
          for (let h = sparkHMin; h <= sparkHMax; h++) {
            const cell = hm?.get(h);
            hours.push({
              hour: h,
              avg_speed_to_lead_minutes: cell?.avg_speed_to_lead_minutes ?? null,
              rows: cell?.rows ?? 0,
            });
          }
          return { group: g, hours };
        });
      }
    }
  }

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
      ...(excludedAboveCap > 0
        ? {
            rows_excluded_above_cap: excludedAboveCap,
            summary_cap_minutes: summaryCapMin,
          }
        : {}),
      ...(excludedBeforeReportingHour > 0
        ? { rows_excluded_before_reporting_hour: excludedBeforeReportingHour }
        : {}),
    },
    by_sales_group: by_sales_group.slice(0, 32),
    by_hour: by_hour.slice(0, 48),
    by_hour_sales_group: by_hour_sales_group.slice(0, 240),
    fetched_at: new Date().toISOString(),
    ...(speedColumnInferred ? { speed_column_inferred: true } : {}),
    ...(stl_last_hour_by_group && stl_today_by_group
      ? {
          stl_last_hour_label,
          stl_last_hour_by_group,
          stl_today_by_group,
          ...(stl_hourly_by_group && stl_spark_y_max != null
            ? {
                stl_spark_y_max,
                stl_spark_hour_min,
                stl_spark_hour_max,
                stl_hourly_by_group,
              }
            : {}),
        }
      : {}),
    ...(reportingStartHour != null ? { stl_reporting_day_start_hour_ct: reportingStartHour } : {}),
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
      payload.window_mode = 'intraday_today';
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
