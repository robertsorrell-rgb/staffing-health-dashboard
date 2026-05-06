'use strict';

const { handleOptions, ok, bad } = require('./_sheets.js');
const {
  saveSnapshot,
  readSnapshot,
  listSnapshotDates,
  getStoreOrNull,
} = require('./lib/dashboard-snapshot-store.js');
const { captureDashboardData } = require('./lib/capture-dashboard-data.js');

const CORS_JSON = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  try {
    if (event.httpMethod === 'POST') {
      const secret = (process.env.SNAPSHOT_TRIGGER_SECRET || '').trim();
      const hdr = event.headers || {};
      const sent =
        hdr['x-snapshot-trigger-secret'] ||
        hdr['X-Snapshot-Trigger-Secret'] ||
        hdr['authorization']?.replace(/^Bearer\s+/i, '') ||
        '';
      if (!secret || sent !== secret) {
        return { statusCode: 403, headers: CORS_JSON, body: JSON.stringify({ error: 'Forbidden' }) };
      }
      const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/$/, '');
      if (!base) return bad('URL not configured', 503);
      const bundle = await captureDashboardData(base);
      await saveSnapshot(bundle.date, bundle);
      return ok({ ok: true, manual: true, date: bundle.date, captured_at: bundle.captured_at }, 0);
    }

    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: CORS_JSON, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const qs = event.queryStringParameters || {};
    if (qs.list === '1') {
      if (!getStoreOrNull()) {
        return ok({ ok: true, dates: [], blobs: false, note: 'Blobs not available in this environment' }, 60);
      }
      const dates = await listSnapshotDates();
      return ok({ ok: true, dates }, 60);
    }

    const date = (qs.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return bad('Query ?date=YYYY-MM-DD required (or ?list=1 for index)', 400);
    }

    if (!getStoreOrNull()) {
      return {
        statusCode: 503,
        headers: CORS_JSON,
        body: JSON.stringify({ ok: false, error: 'Snapshot storage not available' }),
      };
    }

    const snap = await readSnapshot(date);
    if (!snap) {
      return {
        statusCode: 404,
        headers: CORS_JSON,
        body: JSON.stringify({ ok: false, error: 'No snapshot for this date', date }),
      };
    }

    return ok({ ok: true, ...snap }, 120);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[dashboard-snapshot]', e);
    return {
      statusCode: 500,
      headers: CORS_JSON,
      body: JSON.stringify({ ok: false, error: e.message || String(e) }),
    };
  }
};
