#!/usr/bin/env node
'use strict';
/**
 * Dump GET /forecasted_vs_actuals intervals for one queue (raw staffing_scheduled, staffing_required, staffing_net).
 * Compare to Staffing timeline — timeline “Net” often matches staffing_net, not visible Scheduled−Required.
 *
 * Usage:
 *   npm run assembled:inspect-forecast -- "High School_CC90_New"
 *   npm run assembled:inspect-forecast -- "High School_CC90_New" 1778043600 1778130000
 *
 * Defaults start/end Unix seconds match a typical Chicago day window (override with args 3–4).
 */
const fs = require('fs');
const path = require('path');

const TZ = 'America/Chicago';

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env — run: node scripts/bootstrap-local-env.js');
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let val = line.slice(eq + 1);
    try {
      val = JSON.parse(val);
    } catch {
      /* raw */
    }
    process.env[line.slice(0, eq)] =
      typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);
  }
}

function objectRows(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return Object.values(raw);
  return [];
}

function fmtCt(sec) {
  return new Date(sec * 1000).toLocaleString('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
    hour12: true,
  });
}

async function assembledGet(apiBase, apiKey, pathname, params) {
  const apiVer = String(process.env.ASSEMBLED_API_VERSION || '').trim();
  const keys = Object.keys(params || {}).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '');
  const qs = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&');
  const url = `${apiBase}${pathname}${qs ? `?${qs}` : ''}`;
  const auth = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      ...(apiVer ? { 'API-Version': apiVer } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

function resolveSiteId(res, siteName) {
  const target = siteName.toLowerCase().trim();
  for (const row of objectRows(res.sites)) {
    const nm = String(row.name || '').toLowerCase().trim();
    if (nm === target) return String(row.id != null ? row.id : '');
  }
  throw new Error(`Site not found: ${siteName}`);
}

function resolveQueueId(res, queueName) {
  const target = queueName.toLowerCase().trim();
  for (const row of objectRows(res.queues)) {
    const nm = String(row.name || '').trim();
    if (nm.toLowerCase() === target) return String(row.id != null ? row.id : '');
  }
  throw new Error(`Queue not found: ${queueName}`);
}

loadDotEnv();

const apiKey = process.env.ASSEMBLED_API_KEY;
const apiBase = (process.env.ASSEMBLED_API_BASE || 'https://api.assembledhq.com/v0').replace(/\/$/, '');
const siteName = process.env.ASSEMBLED_SITE_NAME || 'Consumer Sales';
const channel = process.env.ASSEMBLED_CHANNEL || 'phone';
const scheduleId = (process.env.ASSEMBLED_SCHEDULE_ID || '').trim();
const intervalSec = parseInt(process.env.ASSEMBLED_INTERVAL_SECONDS || '1800', 10);
const skipSite = ['1', 'true', 'yes'].includes(String(process.env.ASSEMBLED_SKIP_SITE_FILTER || '').trim().toLowerCase());

const queueArg = process.argv[2] || 'High School_CC90_New';
const startSec = parseInt(process.argv[3] || '1778043600', 10);
const endSec = parseInt(process.argv[4] || '1778130000', 10);

if (!apiKey) {
  console.error('ASSEMBLED_API_KEY missing');
  process.exit(1);
}

(async () => {
  const sitesRes = await assembledGet(apiBase, apiKey, '/sites', {});
  const queuesRes = await assembledGet(apiBase, apiKey, '/queues', {});
  const siteId = skipSite ? '' : resolveSiteId(sitesRes, siteName);
  const queueId = resolveQueueId(queuesRes, queueArg);

  console.log(`Queue: ${queueArg}`);
  console.log(`Queue UUID: ${queueId}`);
  console.log(`Site: ${skipSite ? '(skipped ASSEMBLED_SKIP_SITE_FILTER)' : `${siteName} → ${siteId}`}`);
  console.log(`Channel: ${channel}  interval: ${intervalSec}s  schedule_id: ${scheduleId || '(none)'}`);
  console.log(`Window Unix: ${startSec} … ${endSec}\n`);

  const rows = [];
  let offset = 0;
  const limit = 50;
  let keep = true;
  while (keep) {
    const params = {
      start_time: startSec,
      end_time: endSec,
      interval: intervalSec,
      channel,
      queue: queueId,
      limit,
      offset,
    };
    if (!skipSite && siteId) {
      params.site_id = siteId;
      params.site = siteId;
    }
    if (scheduleId) params.schedule_id = scheduleId;

    const res = await assembledGet(apiBase, apiKey, '/forecasted_vs_actuals', params);
    const intervals = res.forecasts_vs_actuals || res.forecasted_vs_actuals || [];
    for (const it of intervals) {
      const st = it.start_time != null ? Math.floor(Number(it.start_time) > 1e12 ? Number(it.start_time) / 1000 : Number(it.start_time)) : NaN;
      const sched = Number(it.staffing_scheduled) || 0;
      const r = it.staffing_required || {};
      const fc = r.forecasted != null ? Number(r.forecasted) : NaN;
      const act = r.actual != null ? Number(r.actual) : NaN;
      const netApi = it.staffing_net != null && it.staffing_net !== '' ? Number(it.staffing_net) : NaN;
      const subFc = Number.isFinite(fc) ? sched - fc : NaN;
      rows.push({ st, sched, fc, act, netApi, subFc });
    }
    if (intervals.length < limit) keep = false;
    else offset += limit;
  }

  rows.sort((a, b) => a.st - b.st);

  console.log(
    'start (CT)\tsched\treq.fcst\treq.act\tstaffing_net\tsched−fcst\t(net−subFc Δ)'
  );
  for (const x of rows) {
    const d =
      Number.isFinite(x.netApi) && Number.isFinite(x.subFc) ? (Math.round((x.netApi - x.subFc) * 100) / 100).toFixed(2) : '—';
    console.log(
      [
        fmtCt(x.st),
        x.sched.toFixed(2),
        Number.isFinite(x.fc) ? x.fc.toFixed(2) : '—',
        Number.isFinite(x.act) ? x.act.toFixed(2) : '—',
        Number.isFinite(x.netApi) ? x.netApi.toFixed(2) : '—',
        Number.isFinite(x.subFc) ? x.subFc.toFixed(2) : '—',
        d,
      ].join('\t')
    );
  }
  console.log(
    '\nHeatmap default (ASSEMBLED_NET_COMPUTE=api) uses staffing_net when numeric; else sched−fcst. Timeline blue row is usually staffing_net, not the Scheduled−Required cells shown above it.'
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
