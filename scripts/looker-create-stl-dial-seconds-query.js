#!/usr/bin/env node
'use strict';
/**
 * Creates a Looker query: contact created date/hour + dial time to first attempt (seconds).
 * Dashboard converts *_sec to minutes. Override id via LOOKER_SPEED_TO_LEAD_QUERY_ID after creation.
 *
 * Usage: DRY_RUN=1 node scripts/looker-create-stl-dial-seconds-query.js
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

async function main() {
  loadLookerEnv();
  const dryRun = String(process.env.DRY_RUN || '') === '1';
  const baseUrl = process.env.LOOKER_BASE_URL;
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  if (!baseUrl || !clientId || !clientSecret) {
    console.error('Missing LOOKER_BASE_URL / CLIENT_ID / CLIENT_SECRET');
    process.exit(1);
  }

  const write = {
    model: 'singlestore_customer_acquisition',
    view: 'contacts_w_lead_source',
    fields: [
      'contacts_w_lead_source.created_at_date',
      'contacts_w_lead_source.created_at_hour',
      'call_data.work_group_blended',
      'call_data.dial_time_to_first_attempt_activated_sec',
    ],
    pivots: [],
    sorts: ['contacts_w_lead_source.created_at_date desc'],
    limit: '5000',
  };

  const token = await lookerLogin(baseUrl, clientId, clientSecret);
  if (!dryRun) {
    console.log('DRY_RUN unset: set DRY_RUN=1 to create query.');
    process.exit(0);
  }

  const created = await lookerCreateQuery(baseUrl, token, write);
  const id = created.id || created.slug;
  console.log('Created LOOKER_SPEED_TO_LEAD_QUERY_ID=', id);
  const raw = await lookerRunQueryJson(baseUrl, token, id);
  const { headers, rows } = lookerRunJsonToHeaderRows(raw);
  console.log('Headers:', headers);
  console.log('Row count:', rows.length);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
