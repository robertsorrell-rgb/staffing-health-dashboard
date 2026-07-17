#!/usr/bin/env node
'use strict';
/**
 * Probe interactions/interactions: top queue_name + work_group values containing CEP.
 *
 * Usage: node scripts/looker-cep-queues-probe.js
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
    model: 'interactions',
    view: 'interactions',
    pivots: [],
    sorts: ['communications.ib_call_count desc'],
    limit: '300',
  };

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['interactions.queue_name', 'communications.ib_call_count'],
    filters: { 'communications.created_at_date': '7 days', 'interactions.queue_name': '%CEP%' },
  }, 'queue_name LIKE %CEP% (last 7d) — IB call count');

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['interactions.queue_name', 'communications.ib_call_count'],
    filters: { 'communications.created_at_date': '7 days', 'interactions.queue_name': '%cust%engage%, %customer engagement%, CEP, %cep%' },
  }, 'queue_name LIKE %customer engage% / CEP (last 7d)');

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['interactions.queue_campaign', 'communications.ib_call_count'],
    filters: { 'communications.created_at_date': '7 days', 'interactions.queue_campaign': '%CEP%' },
  }, 'queue_campaign LIKE %CEP% (last 7d)');

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['interactions.skill_names', 'communications.ib_call_count'],
    filters: { 'communications.created_at_date': '7 days', 'interactions.skill_names': '%CEP%' },
  }, 'skill_names LIKE %CEP% (last 7d)');

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['employee_directory.work_group', 'communications.ib_call_count'],
    filters: { 'communications.created_at_date': '7 days', 'employee_directory.work_group': '%CEP%' },
  }, 'employee_directory.work_group LIKE %CEP% (last 7d)');

  // Top 30 queues regardless of CEP for context
  await runWrite(token, baseUrl, {
    ...base,
    fields: ['interactions.queue_name', 'communications.ib_call_count'],
    filters: { 'communications.created_at_date': '7 days' },
    limit: '50',
  }, 'TOP queue_name (last 7d) — for sanity check');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
