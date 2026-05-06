'use strict';

const { chicagoHourMinute } = require('./ct.js');
const { captureDashboardData } = require('./capture-dashboard-data.js');
const { saveSnapshot } = require('./dashboard-snapshot-store.js');

/**
 * Runs only during Central hour 23 (11 PM–11:59 PM), once per calendar day in practice
 * (paired with hourly UTC cron at :20 — see netlify.toml).
 */
async function runNightlyCaptureIfDue() {
  const { hour } = chicagoHourMinute();
  if (hour !== 23) {
    return { skipped: true, reason: 'Outside 11 PM CT window', chicagoHour: hour };
  }

  const base =
    (process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || '').replace(/\/$/, '');
  if (!base) {
    return { skipped: true, reason: 'URL env not set (skip local / misconfigured scheduled run)' };
  }

  const bundle = await captureDashboardData(base);
  await saveSnapshot(bundle.date, bundle);

  return {
    skipped: false,
    date: bundle.date,
    captured_at: bundle.captured_at,
    okKeys: Object.keys(bundle.results || {}),
    errKeys: Object.keys(bundle.errors || {}),
  };
}

module.exports = { runNightlyCaptureIfDue };
