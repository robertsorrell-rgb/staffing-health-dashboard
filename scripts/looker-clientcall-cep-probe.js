#!/usr/bin/env node
'use strict';
/**
 * Probe decompositions/client_call_data for CEP / employee_directory work groups + IB attempts.
 * Usage: node scripts/looker-clientcall-cep-probe.js
 */
const fs = require('fs');
const path = require('path');
const {
  lookerLogin,
  lookerCreateQuery,
  lookerRunQueryJson,
  lookerRunJsonToHeaderRows,
} = require('../netlify/functions/lib/looker-api.js');

function loadLookerEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    if (!k.startsWith('LOOKER_')) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

async function runWrite(token, baseUrl, write, label) {
  console.log(`\n--- ${label} ---`);
  const created = await lookerCreateQuery(baseUrl, token, write);
  const id = created.id || created.slug;
  const raw = await lookerRunQueryJson(baseUrl, token, id);
  const { headers, rows } = lookerRunJsonToHeaderRows(raw);
  console.log(`Headers: ${headers.join(' | ')}`);
  console.log(`Rows: ${rows.length}`);
  for (const r of rows.slice(0, 60)) console.log(`  ${r.join(' | ')}`);
}

async function main() {
  loadLookerEnv();
  const baseUrl = process.env.LOOKER_BASE_URL;
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  const token = await lookerLogin(baseUrl, clientId, clientSecret);

  const base = {
    model: 'decompositions',
    view: 'client_call_data',
    pivots: [],
    limit: '500',
  };

  const week = { 'client_call_data.call_created_at_date': '7 days' };

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['employee_directory.work_group_blended', 'client_call_data.ib_attempt_count', 'client_call_data.ob_attempt_count'],
    filters: { ...week },
    sorts: ['client_call_data.ib_attempt_count desc'],
  }, 'TOP work_group_blended (last 7d) — IB vs OB attempts');

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['employee_directory.work_group', 'client_call_data.ib_attempt_count', 'client_call_data.ob_attempt_count'],
    filters: { ...week },
    sorts: ['client_call_data.ib_attempt_count desc'],
  }, 'TOP work_group (last 7d) — IB vs OB attempts');

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['client_call_data.line_type', 'client_call_data.ib_attempt_count', 'client_call_data.ob_attempt_count'],
    filters: { ...week },
    sorts: ['client_call_data.ib_attempt_count desc'],
  }, 'TOP line_type (last 7d) — IB vs OB attempts');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
