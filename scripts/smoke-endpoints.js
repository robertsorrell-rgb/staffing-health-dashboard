#!/usr/bin/env node
'use strict';
/**
 * Smoke-test selected Netlify handlers via require() + mock event (no Netlify CLI).
 * Usage: node scripts/smoke-endpoints.js
 *
 * Validates HTTP 200 and prints row counts / payload hints. Requires `.env`.
 */
const fs = require('fs');
const path = require('path');

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

const evt = { httpMethod: 'GET' };

async function run(name, modPath) {
  const { handler } = require(modPath);
  const res = await handler(evt);
  const body = JSON.parse(res.body || '{}');
  const ok200 = res.statusCode === 200;
  process.stdout.write(`${ok200 ? '✓' : '✗'} ${name} ${res.statusCode}`);
  if (body.summary?.rows_today != null) process.stdout.write(` rows_today=${body.summary.rows_today}`);
  if (body.rows_today != null) process.stdout.write(` rows_today=${body.rows_today}`);
  if (body.ping1_today != null) process.stdout.write(` ping1=${body.ping1_today}`);
  if (body.matrix?.length != null) process.stdout.write(` matrix_groups=${body.matrix.length}`);
  if (body.source) process.stdout.write(` source=${body.source}`);
  if (!ok200 || body.error) process.stdout.write(` error=${body.error || ''}`);
  console.log('');
  return ok200;
}

(async () => {
  const root = path.join(__dirname, '..', 'netlify', 'functions');
  let failed = false;
  failed = !(await run('adherence', path.join(root, 'adherence.js'))) || failed;
  failed = !(await run('targeted-vto', path.join(root, 'targeted-vto.js'))) || failed;
  failed = !(await run('auto-vto', path.join(root, 'auto-vto.js'))) || failed;
  failed = !(await run('bobbot', path.join(root, 'bobbot.js'))) || failed;
  failed = !(await run('ot-fill-rate', path.join(root, 'ot-fill-rate.js'))) || failed;
  failed = !(await run('net-staffing', path.join(root, 'net-staffing.js'))) || failed;
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
