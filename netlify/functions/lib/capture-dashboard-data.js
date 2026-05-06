'use strict';

const { todayCTDateStr } = require('./ct.js');

/** Same logical keys as dashboard `ENDPOINTS` in js/app.js */
const SNAPSHOT_FN_NAMES = [
  'net-staffing',
  'idle-hourly-log',
  'adherence',
  'targeted-vto',
  'auto-vto',
  'bobbot',
  'callout',
  'ot-fill-rate',
];

/**
 * @param {string} baseUrl Site origin, no trailing slash (e.g. https://foo.netlify.app)
 */
async function captureDashboardData(baseUrl) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const results = {};
  const errors = {};

  await Promise.all(
    SNAPSHOT_FN_NAMES.map(async (name) => {
      const url = `${root}/api/${name}`;
      try {
        const r = await fetch(url, {
          headers: { Accept: 'application/json' },
          redirect: 'follow',
        });
        const text = await r.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Non-JSON from ${name}: ${text.slice(0, 80)}`);
        }
        if (!r.ok) {
          errors[name] = (data && data.error) || r.statusText || String(r.status);
          return;
        }
        results[name] = data;
      } catch (e) {
        errors[name] = e.message || String(e);
      }
    })
  );

  return {
    date: todayCTDateStr(),
    captured_at: new Date().toISOString(),
    results,
    errors,
  };
}

module.exports = { captureDashboardData, SNAPSHOT_FN_NAMES };
