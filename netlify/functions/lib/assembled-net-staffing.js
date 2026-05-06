'use strict';

/**
 * Mirrors Capacity Pull Apps Script: Assembled /forecasted_vs_actuals → net staffing matrix.
 */

const { parseHourHeader } = require('./hour-headers.js');
const { env } = require('./deploy-defaults.js');

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

/** yyyy-MM-dd CT wall calendar */
function todayIsoCt(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** UTC millis at 00:00:00 America/Chicago on dateIso */
function chicagoMidnightUtcMs(dateIso) {
  const [y, mo, da] = dateIso.split('-').map((x) => parseInt(x, 10));
  let lo = Date.UTC(y, mo - 1, da - 1, 18, 0, 0);
  let hi = Date.UTC(y, mo - 1, da + 1, 12, 0, 0);
  while (hi - lo > 60000) {
    const mid = Math.floor((lo + hi) / 2);
    const wall = new Date(mid).toLocaleDateString('en-CA', { timeZone: TZ });
    if (wall >= dateIso) hi = mid;
    else lo = mid;
  }
  let t = hi;
  while (new Date(t).toLocaleDateString('en-CA', { timeZone: TZ }) !== dateIso) t -= 60000;
  while (new Date(t - 60000).toLocaleDateString('en-CA', { timeZone: TZ }) === dateIso) t -= 60000;
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

async function assembledFetch(apiBase, apiKey, path, params) {
  const keys = Object.keys(params || {}).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '');
  const qs = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&');
  const url = `${apiBase}${path}${qs ? `?${qs}` : ''}`;
  const auth = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Assembled ${path} ${res.status}: ${text.slice(0, 400)}`);
    err.statusCode = res.status === 401 || res.status === 403 ? 503 : 502;
    throw err;
  }
  return text ? JSON.parse(text) : {};
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

function resolveQueueIds(res, queueNames) {
  const out = {};
  for (const row of objectRows(res.queues)) {
    const name = String(row.name || '').trim();
    if (queueNames.includes(name)) out[name] = String(row.id != null ? row.id : '');
  }
  return out;
}

/** CT hour 0–23 for interval start */
function hourFromUnix(sec) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(sec * 1000));
  const H = {};
  for (const p of parts) if (p.type !== 'literal') H[p.type] = p.value;
  const hh = parseInt(H.hour, 10);
  const mm = parseInt(H.minute, 10);
  const slotTry = `${hh}:${String(mm).padStart(2, '0')}`;
  let hr = parseHourHeader(slotTry);
  if (hr == null) hr = hh;
  return { hr, minute: mm };
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
  const intervalSec = parseInt(env('ASSEMBLED_INTERVAL_SECONDS'), 10);
  const pageSize = parseInt(env('ASSEMBLED_PAGE_SIZE'), 10);
  const opStartMin = parseInt(env('ASSEMBLED_OP_START_MINUTE'), 10);
  const opEndMin = parseInt(env('ASSEMBLED_OP_END_MINUTE'), 10);

  const queueNames = CAP_QUEUE_MAP.map((q) => q.queue);
  const sitesRes = await assembledFetch(apiBase, apiKey, '/sites', {});
  const queuesRes = await assembledFetch(apiBase, apiKey, '/queues', {});
  const siteId = resolveSiteId(sitesRes, siteName);
  const queueIdMap = resolveQueueIds(queuesRes, queueNames);

  const dateIso = todayIsoCt();
  const dayStartMs = chicagoMidnightUtcMs(dateIso);
  const opStartMs = dayStartMs + opStartMin * 60000;
  const opEndMs = dayStartMs + opEndMin * 60000;
  const startSec = Math.floor(opStartMs / 1000);
  const endSec = Math.floor(opEndMs / 1000);

  /** label -> hour -> { sum, n } */
  const buckets = {};
  for (const q of CAP_QUEUE_MAP) buckets[q.label] = {};

  for (const qDef of CAP_QUEUE_MAP) {
    const queueId = queueIdMap[qDef.queue];
    if (!queueId) continue;

    let offset = 0;
    let keepGoing = true;
    while (keepGoing) {
      const res = await assembledFetch(apiBase, apiKey, '/forecasted_vs_actuals', {
        start_time: startSec,
        end_time: endSec,
        interval: intervalSec,
        channel,
        site: siteId,
        queue: queueId,
        limit: pageSize,
        offset,
      });
      const intervals = res.forecasts_vs_actuals || [];
      for (const it of intervals) {
        if (!it.start_time) continue;
        const slotMs = it.start_time * 1000;
        const ctDay = new Date(slotMs).toLocaleDateString('en-CA', { timeZone: TZ });
        if (ctDay !== dateIso) continue;

        const { hr, minute } = hourFromUnix(it.start_time);
        const slotMinute = hr * 60 + minute;
        if (slotMinute < opStartMin || slotMinute >= opEndMin) continue;

        const scheduled = Number(it.staffing_scheduled) || 0;
        const required =
          it.staffing_required && it.staffing_required.forecasted != null ? Number(it.staffing_required.forecasted) : 0;
        let net =
          it.staffing_net != null && it.staffing_net !== '' ? Number(it.staffing_net) : scheduled - required;
        if (!Number.isFinite(net)) continue;

        const b = buckets[qDef.label];
        if (!b[hr]) b[hr] = { sum: 0, n: 0 };
        b[hr].sum += net;
        b[hr].n += 1;
      }
      if (intervals.length < pageSize) keepGoing = false;
      else offset += pageSize;
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  buckets[AGGREGATE_LABEL] = {};
  const aggregateLabels = CAP_QUEUE_MAP.map((q) => q.label);
  const hourSetAgg = new Set();
  for (const lbl of aggregateLabels) {
    for (const hr of Object.keys(buckets[lbl] || {})) hourSetAgg.add(parseInt(hr, 10));
  }
  for (const hr of hourSetAgg) {
    let sumAgg = 0;
    let parts = 0;
    for (const lbl of aggregateLabels) {
      const cell = buckets[lbl][hr];
      if (!cell || !cell.n) continue;
      sumAgg += cell.sum / cell.n;
      parts += 1;
    }
    if (parts > 0) buckets[AGGREGATE_LABEL][hr] = { sum: sumAgg, n: parts };
  }

  const groupOrder = [AGGREGATE_LABEL].concat(CAP_QUEUE_MAP.map((q) => q.label));
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
      const cell = buckets[label] && buckets[label][hr];
      if (!cell || !cell.n) continue;
      const avg = cell.sum / cell.n;
      hoursOut[String(hr)] = Math.round(avg * 10) / 10;
    }
    if (Object.keys(hoursOut).length > 0) matrix.push({ group: label, hours: hoursOut });
  }

  return {
    ok: true,
    matrix,
    hours,
    source: 'assembled',
    fetched_at: new Date().toISOString(),
    note:
      matrix.length === 0
        ? 'Assembled returned no intervals for today CT (queues/site/channel or operating window).'
        : undefined,
  };
}

module.exports = {
  loadNetStaffingFromAssembled,
  CAP_QUEUE_MAP,
  AGGREGATE_LABEL,
};
