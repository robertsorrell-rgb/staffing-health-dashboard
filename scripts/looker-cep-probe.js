#!/usr/bin/env node
'use strict';
/**
 * Probe call_view: distinct call_strategy / call_type / line_type when
 * work_group_blended LIKE "%CEP%" for the last 14 days. Helps confirm what
 * "incoming CEP calls" maps to (e.g. call_strategy = "Inbound").
 *
 * Usage: node scripts/looker-cep-probe.js
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
  for (const r of rows.slice(0, 50)) console.log(`  ${r.join(' | ')}`);
}

async function main() {
  loadLookerEnv();
  const baseUrl = process.env.LOOKER_BASE_URL;
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  const token = await lookerLogin(baseUrl, clientId, clientSecret);

  const noFilter = {
    model: 'singlestore_customer_acquisition',
    view: 'call_view',
    pivots: [],
    filters: {
      'call_view.call_created_at_date': '14 days',
    },
    sorts: ['call_view.attempt_count desc'],
    limit: '300',
  };

  await runWrite(token, baseUrl, {
    ...noFilter,
    fields: ['call_view.work_group_blended', 'call_view.attempt_count'],
  }, 'TOP work_group_blended (last 14d, NO CEP filter)');

  const cepFilter = {
    ...noFilter,
    filters: {
      ...noFilter.filters,
      'call_view.work_group_blended': 'Phone - CEP',
    },
  };

  await runWrite(token, baseUrl, {
    ...cepFilter,
    fields: ['call_view.work_group_blended', 'call_view.attempt_count'],
  }, 'work_group_blended = "Phone - CEP" (last 14d)');

  await runWrite(token, baseUrl, {
    ...cepFilter,
    fields: ['call_view.call_strategy', 'call_view.attempt_count'],
  }, 'call_strategy for Phone - CEP (last 14d)');

  await runWrite(token, baseUrl, {
    ...cepFilter,
    fields: ['call_view.call_type', 'call_view.attempt_count'],
  }, 'call_type for Phone - CEP (last 14d)');

  await runWrite(token, baseUrl, {
    ...cepFilter,
    fields: ['call_view.line_type', 'call_view.attempt_count'],
  }, 'line_type for Phone - CEP (last 14d)');

  await runWrite(token, baseUrl, {
    ...cepFilter,
    fields: ['call_view.call_participant_type', 'call_view.attempt_count'],
  }, 'call_participant_type for Phone - CEP (last 14d)');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
