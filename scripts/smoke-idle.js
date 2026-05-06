#!/usr/bin/env node
'use strict';
/**
 * Smoke-test idle-hourly-log function using .env (no Netlify CLI).
 * Usage: node scripts/smoke-idle.js [YYYY-MM-DD]
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('Missing .env — run: node scripts/bootstrap-local-env.js');
  process.exit(1);
}

const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
for (const line of lines) {
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  const key = line.slice(0, eq);
  let val = line.slice(eq + 1);
  try {
    val = JSON.parse(val);
  } catch {
    /* leave as raw string */
  }
  if (typeof val === 'string' && val.startsWith('{')) {
    try {
      val = JSON.parse(val);
    } catch {
      /* keep string */
    }
  }
  process.env[key] =
    typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);
}

const date = process.argv[2];
const { handler } = require('../netlify/functions/idle-hourly-log.js');

handler({
  httpMethod: 'GET',
  queryStringParameters: date ? { date } : {},
})
  .then((r) => {
    console.log('status', r.statusCode);
    const b = JSON.parse(r.body);
    console.log(
      'date',
      b.date,
      'day_floor_idle',
      b.day_floor_idle_pct,
      'current_hour_floor_idle',
      b.current_hour_floor_idle,
      'hours',
      Object.keys(b.byHour || {}).length
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
