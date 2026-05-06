'use strict';

/**
 * Net staffing from Assembled (`GET /forecasted_vs_actuals`), rolled up to hourly people deltas.
 * Uses Assembled’s HTTP resource `/forecasted_vs_actuals` (their name — payload includes staffing metrics).
 */

const crypto = require('crypto');
const { env } = require('./deploy-defaults.js');
const {
  SCHEDULE_REST_PATHS,
  SCHEDULE_GRAPHQL_QUERIES,
  extractNamedSchedulesFromResponse,
  graphqlCollectScheduleLikeNodes,
  assembledGraphqlQuery,
} = require('./assembled-schedule-probe.js');

/** GET /sites + /queues responses — stable enough to cache and heavy enough to 429 if refreshed often. */
const assembledMetaCache = new Map();

const API_BASE_DEFAULT = 'https://api.assembledhq.com/v0';
const TZ = 'America/Chicago';

const CAP_QUEUE_MAP = [
  { queue: 'High School_CC90_New', label: 'High School SC' },
  { queue: 'Elementary and LD_CC90_New', label: 'Elementary and LD SC' },
  { queue: 'College and Grad TP_CC90_New', label: 'College and Grad SC' },
  { queue: 'Adult Learner_CC90_New', label: 'Adult Learner SC' },
  { queue: 'Prof Certs_CC90_New', label: 'Prof Certs SC' },
];

const AGGREGATE_LABEL = 'Aggregate';

/**
 * avg (default) = mean of half-hour nets in the clock hour — matches “one agent off for the hour” (~1 unit),
 *   since Assembled applies ~−1 per 30‑min slot for that change (sum would double-count to ~2).
 * sum = add both slots — use ASSEMBLED_NET_STAFFING_HOUR_ROLLUP=sum if you want hourly totals summed.
 */
function hourRollupMode() {
  const r = (env('ASSEMBLED_NET_STAFFING_HOUR_ROLLUP') || 'avg').trim().toLowerCase();
  return r === 'sum' ? 'sum' : 'avg';
}

function resolvedHourNet(cell, rollup) {
  if (!cell || !Number.isFinite(cell.sum)) return null;
  if (rollup === 'sum') return cell.sum;
  return cell.sum / Math.max(1, cell.n || 1);
}

/**
 * Optional env ASSEMBLED_NET_STAFFING_QUEUES — comma-separated Assembled queue names
 * (exact strings matching CAP_QUEUE_MAP `queue`, e.g. `College and Grad TP_CC90_New`).
 * Limits pulls to those queues so Aggregate matches a filtered Assembled timeline.
 */
function activeCapQueueMap() {
  const raw = (env('ASSEMBLED_NET_STAFFING_QUEUES') || '').trim();
  if (!raw) return CAP_QUEUE_MAP;
  const allow = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  const filtered = CAP_QUEUE_MAP.filter((q) => allow.has(q.queue));
  return filtered.length ? filtered : CAP_QUEUE_MAP;
}

/**
 * yyyy-MM-dd in America/Chicago. Uses formatToParts with numeric month/day so Linux/Netlify ICU
 * agrees with macOS for `chicagoMidnightUtcMs` / `todayIsoCt` (toLocaleDateString can vary).
 */
function isoDateChicagoFromMs(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const H = {};
  for (const p of parts) if (p.type !== 'literal') H[p.type] = p.value;
  if (!H.year || !H.month || !H.day) return '';
  return `${H.year}-${H.month}-${H.day}`;
}

/** yyyy-MM-dd CT wall calendar (today in Chicago) */
function todayIsoCt(d = new Date()) {
  return isoDateChicagoFromMs(d.getTime());
}

/** UTC millis at 00:00:00 America/Chicago on dateIso */
function chicagoMidnightUtcMs(dateIso) {
  const [y, mo, da] = dateIso.split('-').map((x) => parseInt(x, 10));
  let lo = Date.UTC(y, mo - 1, da - 1, 18, 0, 0);
  let hi = Date.UTC(y, mo - 1, da + 1, 12, 0, 0);
  while (hi - lo > 60000) {
    const mid = Math.floor((lo + hi) / 2);
    const wall = isoDateChicagoFromMs(mid);
    if (wall >= dateIso) hi = mid;
    else lo = mid;
  }
  let t = hi;
  while (isoDateChicagoFromMs(t) !== dateIso) t -= 60000;
  while (isoDateChicagoFromMs(t - 60000) === dateIso) t -= 60000;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(new Date(t));
  const H = {};
  for (const p of parts) if (p.type !== 'literal') H[p.type] = p.value;
  const secIntoDay =
    parseInt(H.hour, 10) * 3600 + parseInt(H.minute, 10) * 60 + parseInt(H.second, 10);
  return t - secIntoDay * 1000;
}

function assembledMetaCacheTtlMs() {
  const n = parseInt(String(env('ASSEMBLED_METADATA_CACHE_SECONDS') || '900'), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n * 1000, 86400000);
}

function assembledMetaCacheKey(apiBase, apiKey, path) {
  const fp = crypto.createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 16);
  return `${apiBase}\n${fp}\n${path}`;
}

const SCHEDULE_RESOLVE_NEG_TTL_MS = 300000;

/**
 * `GET /forecasted_vs_actuals` does not document `schedule_id`, but the platform uses the same default as
 * other v0 endpoints: **master schedule** when omitted. The Staffing timeline often shows “Default Schedule”
 * instead — numbers will not match until that schedule’s UUID is sent. We try a few list-style paths
 * (undocumented; vary by account) to resolve a human name → id.
 */

/**
 * When `ASSEMBLED_SCHEDULE_AUTORESOLVE_OFF` is not set, we try to match this name (default “Default Schedule”).
 * Set `ASSEMBLED_SCHEDULE_MATCH_NAME=` to empty in env to skip name resolution without turning off other behavior.
 */
function scheduleNameForAutoResolve() {
  if (['1', 'true', 'yes'].includes(String(env('ASSEMBLED_SCHEDULE_AUTORESOLVE_OFF') || '').trim().toLowerCase())) {
    return (env('ASSEMBLED_SCHEDULE_MATCH_NAME') || '').trim();
  }
  const custom = (env('ASSEMBLED_SCHEDULE_MATCH_NAME') || '').trim();
  if (custom) return custom;
  return 'Default Schedule';
}

async function resolveScheduleIdByName(apiBase, apiKey, matchName) {
  if (!matchName) return { scheduleId: '', triedPath: '' };
  const ttlMs = assembledMetaCacheTtlMs();
  const posKey = assembledMetaCacheKey(apiBase, apiKey, `/schedule_resolve\n${matchName}`);
  const negKey = assembledMetaCacheKey(apiBase, apiKey, `/schedule_resolve_neg\n${matchName}`);

  const negHit = assembledMetaCache.get(negKey);
  if (negHit && Date.now() < negHit.expires) {
    return { scheduleId: '', triedPath: '' };
  }
  if (ttlMs > 0) {
    const hit = assembledMetaCache.get(posKey);
    if (hit && Date.now() < hit.expires && hit.payload && hit.payload.scheduleId) {
      return hit.payload;
    }
  }

  const lower = matchName.toLowerCase();
  for (const path of SCHEDULE_REST_PATHS) {
    try {
      const res = await assembledFetch(apiBase, apiKey, path, {});
      const candidates = extractNamedSchedulesFromResponse(res);
      const row = candidates.find((s) => s.name.toLowerCase().trim() === lower);
      if (row && row.id) {
        const payload = { scheduleId: row.id, triedPath: path };
        if (ttlMs > 0) {
          assembledMetaCache.set(posKey, { expires: Date.now() + ttlMs, payload });
        }
        return payload;
      }
    } catch {
      /* try next path */
    }
  }

  const gqlOff = ['1', 'true', 'yes'].includes(String(env('ASSEMBLED_SCHEDULE_GRAPHQL_OFF') || '').trim().toLowerCase());
  if (!gqlOff) {
    for (const query of SCHEDULE_GRAPHQL_QUERIES) {
      try {
        const json = await assembledGraphqlQuery(apiBase, apiKey, query);
        if (json.errors && json.errors.length) continue;
        const candidates = graphqlCollectScheduleLikeNodes(json.data);
        const row = candidates.find((s) => s.name.toLowerCase().trim() === lower);
        if (row && row.id) {
          const payload = { scheduleId: row.id, triedPath: '/graphql' };
          if (ttlMs > 0) {
            assembledMetaCache.set(posKey, { expires: Date.now() + ttlMs, payload });
          }
          return payload;
        }
      } catch {
        /* try next query */
      }
    }
  }

  assembledMetaCache.set(negKey, { expires: Date.now() + SCHEDULE_RESOLVE_NEG_TTL_MS, payload: null });
  return { scheduleId: '', triedPath: '' };
}

function assembled429MaxAttempts() {
  const n = parseInt(String(env('ASSEMBLED_RATE_LIMIT_MAX_ATTEMPTS') || '6'), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 6;
}

async function sleepMs(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function assembledFetch(apiBase, apiKey, path, params) {
  const ttlMs = assembledMetaCacheTtlMs();
  if (ttlMs > 0 && (path === '/sites' || path === '/queues')) {
    const ck = assembledMetaCacheKey(apiBase, apiKey, path);
    const hit = assembledMetaCache.get(ck);
    if (hit && Date.now() < hit.expires) return hit.payload;
  }

  const keys = Object.keys(params || {}).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '');
  const qs = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&');
  const url = `${apiBase}${path}${qs ? `?${qs}` : ''}`;
  const auth = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
  };

  const maxAttempts = assembled429MaxAttempts();
  let lastText = '';
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, { headers });
    lastStatus = res.status;
    lastText = await res.text();

    if (res.ok) {
      const parsed = lastText ? JSON.parse(lastText) : {};
      if (ttlMs > 0 && (path === '/sites' || path === '/queues')) {
        const ck = assembledMetaCacheKey(apiBase, apiKey, path);
        assembledMetaCache.set(ck, { expires: Date.now() + ttlMs, payload: parsed });
      }
      return parsed;
    }

    if (res.status === 429 && attempt < maxAttempts) {
      const ra = res.headers.get('retry-after');
      let waitMs = Math.min(65000, 750 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400));
      if (ra && /^\d+$/.test(String(ra).trim())) {
        waitMs = Math.max(waitMs, parseInt(String(ra).trim(), 10) * 1000);
      }
      await sleepMs(waitMs);
      continue;
    }

    const err = new Error(`Assembled ${path} ${res.status}: ${lastText.slice(0, 400)}`);
    err.statusCode =
      res.status === 401 || res.status === 403 ? 503 : res.status === 429 ? 503 : 502;
    throw err;
  }

  const err = new Error(`Assembled ${path} ${lastStatus}: ${lastText.slice(0, 400)}`);
  err.statusCode = lastStatus === 429 ? 503 : 502;
  throw err;
}

function objectRows(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return Object.values(raw);
  return [];
}

function resolveSiteId(res, siteName) {
  const target = siteName.toLowerCase().trim();
  for (const row of objectRows(res.sites)) {
    const nm = String(row.name || '').toLowerCase().trim();
    if (nm === target) return String(row.id != null ? row.id : '');
  }
  throw new Error(`Assembled site not found: ${siteName}`);
}

/**
 * Map configured queue names → Assembled queue id. Matching is case-insensitive on name
 * (Netlify/prod env sometimes drifts from exact casing in Assembled).
 */
function resolveQueueIds(res, queueNames) {
  const want = new Map();
  for (const q of queueNames) {
    const canon = String(q || '').trim();
    if (canon) want.set(canon.toLowerCase(), canon);
  }
  const out = {};
  for (const row of objectRows(res.queues)) {
    const name = String(row.name || '').trim();
    const canon = want.get(name.toLowerCase());
    if (canon) out[canon] = String(row.id != null ? row.id : '');
  }
  return out;
}

/** Assembled usually returns Unix seconds; sometimes ms or ISO strings — normalize to Unix seconds. */
function intervalStartToUnixSec(t) {
  if (t == null || t === '') return null;
  if (typeof t === 'string') {
    const trimmed = t.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
    }
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
    return null;
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (n > 1e12) return Math.floor(n / 1000);
  return Math.floor(n);
}

/** Snap API window to interval grid (matches rolling 30m / 1h buckets). */
function alignForecastWindowSec(startSec, endSec, intervalSec) {
  const step = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 1800;
  const lo = Math.floor(startSec / step) * step;
  const hi = Math.ceil(endSec / step) * step;
  return lo < hi ? { startSec: lo, endSec: hi } : { startSec, endSec };
}

function skipSiteOnForecastedQuery() {
  return ['1', 'true', 'yes'].includes(String(env('ASSEMBLED_SKIP_SITE_FILTER') || '').trim().toLowerCase());
}

/**
 * Second pull without site_id mixes all sites for the same queue name — numbers diverge from a site-filtered
 * Staffing timeline (wrong highs/lows and spurious negatives). Opt in only when site-scoped pulls return nothing.
 */
function allowNoSiteAutoRetry() {
  return ['1', 'true', 'yes'].includes(String(env('ASSEMBLED_ALLOW_NO_SITE_RETRY') || '').trim().toLowerCase());
}

function emptyPullStats() {
  return {
    apiRows: 0,
    acceptedRows: 0,
    droppedBadStart: 0,
    droppedOutsideRequestRange: 0,
    droppedOutsideOpWindow: 0,
    droppedBadNet: 0,
  };
}

function addPullStats(a, b) {
  return {
    apiRows: a.apiRows + b.apiRows,
    acceptedRows: a.acceptedRows + b.acceptedRows,
    droppedBadStart: a.droppedBadStart + b.droppedBadStart,
    droppedOutsideRequestRange: a.droppedOutsideRequestRange + b.droppedOutsideRequestRange,
    droppedOutsideOpWindow: a.droppedOutsideOpWindow + b.droppedOutsideOpWindow,
    droppedBadNet: a.droppedBadNet + b.droppedBadNet,
  };
}

/** Minute-of-day 0–1439 in Chicago */
function minuteOfDayChicago(sec) {
  const { hr, minute } = hourFromUnix(sec);
  return hr * 60 + minute;
}

/**
 * Index of this interval’s start from Chicago midnight: 0 = 00:00–00:30, 1 = 00:30–01:00, …
 * Dedupes pagination quirks (duplicate Unix starts for the same slot).
 */
function slotIndexFromUnix(sec, intervalSec) {
  const intervalMin = intervalSec / 60;
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) return null;
  const mod = minuteOfDayChicago(sec);
  return Math.floor(mod / intervalMin);
}

/** Clock hour 0–23 containing this slot (used to average all slots in the hour, usually 2 when interval=1800). */
function hourFromSlotIndex(slotIdx, intervalSec) {
  const intervalMin = intervalSec / 60;
  const minutesFromMidnight = slotIdx * intervalMin;
  return Math.floor(minutesFromMidnight / 60);
}

function parsePositiveInt(name, fallback) {
  const n = parseInt(env(name), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseNonNegMinute(name, fallback) {
  const n = parseInt(env(name), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Which field drives “net” per 30‑min interval.
 * Default `api` matches **Targeted VTO bot** (`rvtoFindDeficits_`): numeric staffing_net, else scheduled − staffing_required.forecasted only.
 */
function netComputeMode() {
  let m = (env('ASSEMBLED_NET_COMPUTE') || 'api').trim().toLowerCase().replace(/-/g, '_');
  if (m === 'scheduled_minus_actual') m = 'sched_minus_actual';
  if (m === 'scheduled_minus_forecasted') m = 'sched_minus_forecasted';
  if (m === 'api' || m === 'assembled' || m === 'vto_bot') return 'api';
  if (m === 'sched_minus_forecasted') return 'sched_minus_forecasted';
  return 'sched_minus_actual';
}

/** One interval’s net staffing (people-style), before hourly rollup. */
function intervalNetStaffing(it, mode) {
  const scheduled = Number(it.staffing_scheduled) || 0;
  const r = it.staffing_required || {};
  const forecasted = r.forecasted != null ? Number(r.forecasted) : NaN;
  const actual = r.actual != null ? Number(r.actual) : NaN;

  if (mode === 'sched_minus_actual') {
    const req = Number.isFinite(actual) ? actual : forecasted;
    if (!Number.isFinite(req)) return NaN;
    return scheduled - req;
  }
  if (mode === 'sched_minus_forecasted') {
    if (!Number.isFinite(forecasted)) return NaN;
    return scheduled - forecasted;
  }

  /** `api` / VTO bot: staffing_net if numeric, else scheduled − forecasted (not actual — matches Apps Script bot). */
  if (it.staffing_net != null && it.staffing_net !== '') {
    const n = Number(it.staffing_net);
    if (Number.isFinite(n)) return n;
  }
  if (!Number.isFinite(forecasted)) return NaN;
  return scheduled - forecasted;
}

/** Chicago wall-clock hour (0–23) and minute for interval start — bucket key for hourly rollup. */
function hourFromUnix(sec) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    hourCycle: 'h23',
    calendar: 'gregory',
  }).formatToParts(new Date(sec * 1000));
  const H = {};
  for (const p of parts) if (p.type !== 'literal') H[p.type] = p.value;
  let hh = parseInt(H.hour, 10);
  let mm = parseInt(H.minute, 10);
  if (!Number.isFinite(hh)) hh = 0;
  if (!Number.isFinite(mm)) mm = 0;
  if (hh === 24) hh = 0;
  return { hr: hh, minute: mm };
}

/**
 * Paginate forecasted_vs_actuals per queue and fill hourly buckets (half-hours rolled later).
 * @returns {Promise<{ buckets: Record<string, Record<string, { sum: number, n: number }>>, stats: ReturnType<emptyPullStats> }>}
 */
async function pullForecastBuckets({
  apiBase,
  apiKey,
  capMap,
  queueIdMap,
  startSec,
  endSec,
  intervalSec,
  channel,
  siteId,
  omitSiteFilter,
  pageSize,
  opStartMin,
  opEndMin,
  scheduleId,
  netMode,
}) {
  const buckets = {};
  for (const q of capMap) buckets[q.label] = {};
  const stats = emptyPullStats();

  for (const qDef of capMap) {
    const queueId = queueIdMap[qDef.queue];
    if (!queueId) continue;

    /** One net per Chicago slot index (dedupes duplicate API rows for the same half-hour). */
    const slotNets = new Map();

    let offset = 0;
    let keepGoing = true;
    while (keepGoing) {
      const qParams = {
        start_time: startSec,
        end_time: endSec,
        interval: intervalSec,
        channel,
        queue: queueId,
        limit: pageSize,
        offset,
      };
      if (!omitSiteFilter && siteId) {
        qParams.site_id = siteId;
        qParams.site = siteId;
      }
      if (scheduleId) qParams.schedule_id = scheduleId;

      const res = await assembledFetch(apiBase, apiKey, '/forecasted_vs_actuals', qParams);
      const intervals = res.forecasts_vs_actuals || res.forecasted_vs_actuals || [];
      if (offset === 0 && intervals.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('[assembled-net-staffing] forecasted_vs_actuals empty page', {
          queue: qDef.queue,
          reportedTotal: res.total,
          omitSiteFilter,
        });
      }
      for (const it of intervals) {
        stats.apiRows += 1;
        const startUnix = intervalStartToUnixSec(it.start_time ?? it.startTime);
        if (startUnix == null) {
          stats.droppedBadStart += 1;
          continue;
        }
        /**
         * Unix window [startSec, endSec) is built from Chicago midnight + op hours for `dateIso` in the caller.
         * Do not re-filter by calendar date string — serverless ICU/timezone edge cases can mismatch
         * `toLocaleDateString` / formatToParts vs the API and drop every row (wrong CT date: N).
         */
        if (startUnix < startSec || startUnix >= endSec) {
          stats.droppedOutsideRequestRange += 1;
          continue;
        }

        const slotMinute = minuteOfDayChicago(startUnix);
        if (slotMinute < opStartMin || slotMinute >= opEndMin) {
          stats.droppedOutsideOpWindow += 1;
          continue;
        }

        const slotIdx = slotIndexFromUnix(startUnix, intervalSec);
        if (slotIdx == null || slotIdx < 0) {
          stats.droppedBadStart += 1;
          continue;
        }

        const net = intervalNetStaffing(it, netMode);
        if (!Number.isFinite(net)) {
          stats.droppedBadNet += 1;
          continue;
        }

        slotNets.set(slotIdx, net);
      }
      if (intervals.length < pageSize) keepGoing = false;
      else offset += pageSize;
      await new Promise((r) => setTimeout(r, 120));
    }

    stats.acceptedRows += slotNets.size;
    for (const [slotIdx, net] of slotNets) {
      const hr = hourFromSlotIndex(slotIdx, intervalSec);
      if (hr < 0 || hr > 23) continue;
      const b = buckets[qDef.label];
      if (!b[hr]) b[hr] = { sum: 0, n: 0 };
      b[hr].sum += net;
      b[hr].n += 1;
    }
  }

  return { buckets, stats };
}

function matrixHoursFromBuckets(buckets, capMap, rollup) {
  const aggregateLabels = capMap.map((q) => q.label);
  const hourSetAgg = new Set();
  for (const lbl of aggregateLabels) {
    for (const hr of Object.keys(buckets[lbl] || {})) hourSetAgg.add(parseInt(hr, 10));
  }

  /** One decimal place per queue hour — Aggregate = sum of those cells (matches “sum of rows” in the UI). */
  const roundedQueueByHour = {};
  for (const lbl of aggregateLabels) {
    roundedQueueByHour[lbl] = {};
    for (const hr of hourSetAgg) {
      const cell = buckets[lbl] && buckets[lbl][hr];
      const v = resolvedHourNet(cell, rollup);
      if (v == null || !Number.isFinite(v)) continue;
      roundedQueueByHour[lbl][hr] = Math.round(v * 10) / 10;
    }
  }

  buckets[AGGREGATE_LABEL] = {};
  for (const hr of hourSetAgg) {
    let sumAgg = 0;
    let parts = 0;
    for (const lbl of aggregateLabels) {
      const rv = roundedQueueByHour[lbl][hr];
      if (rv == null || !Number.isFinite(rv)) continue;
      sumAgg += rv;
      parts += 1;
    }
    if (parts > 0) buckets[AGGREGATE_LABEL][hr] = { sum: sumAgg };
  }

  const groupOrder = [AGGREGATE_LABEL].concat(capMap.map((q) => q.label));
  const hourSet = new Set();
  for (const lbl of groupOrder) {
    if (!buckets[lbl]) continue;
    for (const hr of Object.keys(buckets[lbl])) hourSet.add(parseInt(hr, 10));
  }
  const hours = [...hourSet].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);

  const matrix = [];
  for (const label of groupOrder) {
    const hoursOut = {};
    for (const hr of hours) {
      let v;
      if (label === AGGREGATE_LABEL) {
        const cell = buckets[label] && buckets[label][hr];
        v = cell && Number.isFinite(cell.sum) ? cell.sum : null;
      } else {
        v = roundedQueueByHour[label] && roundedQueueByHour[label][hr];
      }
      if (v == null || !Number.isFinite(v)) continue;
      hoursOut[String(hr)] = Math.round(v * 10) / 10;
    }
    if (Object.keys(hoursOut).length > 0) matrix.push({ group: label, hours: hoursOut });
  }

  return { matrix, hours };
}

/**
 * @returns {Promise<{ ok: boolean, matrix: object[], hours: number[], source: string, fetched_at: string, note?: string } | null>}
 */
async function loadNetStaffingFromAssembled() {
  const apiKey = env('ASSEMBLED_API_KEY');
  if (!apiKey) return null;

  const apiBase = (env('ASSEMBLED_API_BASE') || API_BASE_DEFAULT).replace(/\/$/, '');
  const siteName = env('ASSEMBLED_SITE_NAME') || 'Consumer Sales';
  const channel = env('ASSEMBLED_CHANNEL') || 'phone';
  const intervalSec = parsePositiveInt('ASSEMBLED_INTERVAL_SECONDS', 1800);
  const pageSize = parsePositiveInt('ASSEMBLED_PAGE_SIZE', 20);
  const opStartMin = parseNonNegMinute('ASSEMBLED_OP_START_MINUTE', 420);
  const opEndMin = parseNonNegMinute('ASSEMBLED_OP_END_MINUTE', 1320);

  const capMap = activeCapQueueMap();
  const queueNames = capMap.map((q) => q.queue);
  const sitesRes = await assembledFetch(apiBase, apiKey, '/sites', {});
  const queuesRes = await assembledFetch(apiBase, apiKey, '/queues', {});
  const siteId = resolveSiteId(sitesRes, siteName);
  const queueIdMap = resolveQueueIds(queuesRes, queueNames);
  const missingQueueNames = queueNames.filter((q) => !queueIdMap[q]);

  const rollup = hourRollupMode();
  const netMode = netComputeMode();
  const explicitScheduleId = (env('ASSEMBLED_SCHEDULE_ID') || '').trim();
  const scheduleAutoName = scheduleNameForAutoResolve();
  let scheduleId = explicitScheduleId;
  /** @type {'explicit'|'resolved_name'|'api_master_default'|'resolve_failed'} */
  let scheduleSource = explicitScheduleId ? 'explicit' : 'api_master_default';
  if (!scheduleId && scheduleAutoName) {
    const r = await resolveScheduleIdByName(apiBase, apiKey, scheduleAutoName);
    if (r.scheduleId) {
      scheduleId = r.scheduleId;
      scheduleSource = 'resolved_name';
    } else {
      scheduleSource = 'resolve_failed';
    }
  }

  const dateIso = todayIsoCt();
  const dayStartMs = chicagoMidnightUtcMs(dateIso);
  const opStartMs = dayStartMs + opStartMin * 60000;
  const opEndMs = dayStartMs + opEndMin * 60000;
  let startSec = Math.floor(opStartMs / 1000);
  let endSec = Math.floor(opEndMs / 1000);
  ({ startSec, endSec } = alignForecastWindowSec(startSec, endSec, intervalSec));

  const envSkipSite = skipSiteOnForecastedQuery();

  let pullStats = emptyPullStats();
  let pull1 = await pullForecastBuckets({
    apiBase,
    apiKey,
    capMap,
    queueIdMap,
    startSec,
    endSec,
    intervalSec,
    channel,
    siteId,
    omitSiteFilter: envSkipSite,
    pageSize,
    opStartMin,
    opEndMin,
    scheduleId,
    netMode,
  });
  pullStats = addPullStats(pullStats, pull1.stats);
  let buckets = pull1.buckets;

  let { matrix, hours } = matrixHoursFromBuckets(buckets, capMap, rollup);
  /**
   * Queue-only retry (no site_id) can match Netlify when site-scoped returns empty, but it aggregates every site
   * for that queue — net staffing then diverges from a site-filtered timeline. Opt-in: ASSEMBLED_ALLOW_NO_SITE_RETRY=1.
   */
  let assembledOmitSiteAuto = false;
  if (
    matrix.length === 0 &&
    !envSkipSite &&
    missingQueueNames.length === 0 &&
    allowNoSiteAutoRetry()
  ) {
    const pull2 = await pullForecastBuckets({
      apiBase,
      apiKey,
      capMap,
      queueIdMap,
      startSec,
      endSec,
      intervalSec,
      channel,
      siteId,
      omitSiteFilter: true,
      pageSize,
      opStartMin,
      opEndMin,
      scheduleId,
      netMode,
    });
    pullStats = addPullStats(pullStats, pull2.stats);
    buckets = pull2.buckets;
    ({ matrix, hours } = matrixHoursFromBuckets(buckets, capMap, rollup));
    assembledOmitSiteAuto = matrix.length > 0;
  }

  let emptyNote;
  let assembledNoteOk;
  if (matrix.length === 0) {
    if (missingQueueNames.length) {
      emptyNote = `Assembled has no matching queues for: ${missingQueueNames.join(
        ', '
      )}. Names must match Assembled (see CAP_QUEUE_MAP / ASSEMBLED_NET_STAFFING_QUEUES). Site “${siteName}”, channel “${channel}”.`;
    } else if (pullStats.apiRows > 0 && pullStats.acceptedRows === 0) {
      emptyNote = `Assembled returned ${pullStats.apiRows} staffing intervals for channel “${channel}” but none counted for ${dateIso} CT (outside API Unix window: ${pullStats.droppedOutsideRequestRange}, outside op minutes ${opStartMin}–${opEndMin}: ${pullStats.droppedOutsideOpWindow}, unusable net: ${pullStats.droppedBadNet}, bad timestamps: ${pullStats.droppedBadStart}). Adjust ASSEMBLED_OP_* or interval alignment.`;
    } else {
      const siteHint = envSkipSite
        ? 'site filter off (ASSEMBLED_SKIP_SITE_FILTER)'
        : allowNoSiteAutoRetry()
          ? `site “${siteName}” as site_id + site (queue-only retry also returned no rows)`
          : `site “${siteName}” as site_id + site (queue-only retry disabled — set ASSEMBLED_ALLOW_NO_SITE_RETRY=1 only if site-scoped pulls are empty; retry blends all sites and breaks timeline parity)`;
      emptyNote = `Assembled returned no staffing intervals for today CT (${dateIso}), channel “${channel}”, ${siteHint}. Queues matched — in Assembled, confirm **net staffing** (scheduled vs required / staffing surplus) exists for this date, channel, and queues; if it’s empty there too, this is missing Assembled data or API scope, not Netlify. Otherwise confirm the API key is a full key for this company (not restricted) and the channel name matches Assembled exactly.`;
    }
  } else {
    const parts = [];
    if (assembledOmitSiteAuto) {
      parts.push(
        'WARNING: Net staffing used queue + channel only (ASSEMBLED_ALLOW_NO_SITE_RETRY) — mixed all sites; compare only if timeline has no site filter.'
      );
    }
    if (scheduleSource === 'explicit') {
      parts.push(
        'ASSEMBLED_SCHEDULE_ID is set — confirm Staffing timeline uses that same schedule (not another template).'
      );
    } else if (scheduleSource === 'resolved_name') {
      parts.push(
        `schedule_id auto-resolved from Assembled name “${scheduleAutoName}” (matches typical “Default Schedule” timeline). Set ASSEMBLED_SCHEDULE_ID to pin the UUID.`
      );
    } else if (scheduleSource === 'resolve_failed' && scheduleAutoName) {
      parts.push(
        `Could not resolve schedule “${scheduleAutoName}” automatically (this API key/account does not expose schedule lists). Set **ASSEMBLED_SCHEDULE_ID** in Netlify: run locally **npm run assembled:list-schedules** (prints UUIDs if any probe works), or Chrome DevTools → Network on Staffing timeline while that schedule is selected and search for \`schedule\`. Until then Assembled defaults to **master schedule** — nets differ from “Default Schedule”.`
      );
    } else {
      parts.push(
        'No schedule_id: Assembled defaults to **master schedule**. Timeline “Default Schedule” usually needs ASSEMBLED_SCHEDULE_ID or auto-resolve (ASSEMBLED_SCHEDULE_MATCH_NAME).'
      );
    }
    const slotsPerHour = 3600 / intervalSec;
    const rollupLab =
      rollup === 'sum'
        ? `sum of ${Math.round(slotsPerHour)} interval(s) in that clock hour`
        : `average of ${Math.round(slotsPerHour)} interval(s) (${intervalSec}s each) in that clock hour`;
    parts.push(
      `Each queue hourly cell = ${rollupLab}. Aggregate = sum of the five queue hourly cells.`
    );
    if (netMode === 'api') {
      parts.push(
        'Net per 30‑min interval: staffing_net when present, else scheduled − staffing_required.forecasted (Targeted VTO bot).'
      );
    } else {
      parts.push(
        `Net per interval: ${netMode}. For bot parity use ASSEMBLED_NET_COMPUTE=api.`
      );
    }
    assembledNoteOk = parts.join(' ');
  }

  return {
    ok: true,
    matrix,
    hours,
    source: 'assembled',
    /** Heatmap shows people-style net per interval (see assembled_net_compute). */
    net_staffing_unit: 'people',
    assembled_hour_rollup: rollup,
    assembled_net_compute: netMode,
    assembled_schedule_id_set: !!scheduleId,
    assembled_schedule_source: scheduleSource,
    assembled_queues_used: queueNames,
    assembled_queues_missing: missingQueueNames.length ? missingQueueNames : undefined,
    assembled_site_filter: envSkipSite ? 'none_env' : assembledOmitSiteAuto ? 'none_auto_retry' : 'site_id',
    fetched_at: new Date().toISOString(),
    note: emptyNote,
    assembled_note: assembledNoteOk,
  };
}

module.exports = {
  loadNetStaffingFromAssembled,
  activeCapQueueMap,
  CAP_QUEUE_MAP,
  AGGREGATE_LABEL,
};
