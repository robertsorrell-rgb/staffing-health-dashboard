#!/usr/bin/env node
'use strict';
/**
 * Probe zendesk/zendesk_talk_call_exports for IB calls routed to anything CEP-related.
 * Prints distinct values of direction, ivr_destination_group_*, line_type, call_channel.
 *
 * Usage: node scripts/looker-zendesk-cep-probe.js
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
    model: 'zendesk',
    view: 'zendesk_talk_call_exports',
    pivots: [],
    sorts: ['zendesk_talk_call_exports.call_count desc'],
    limit: '300',
  };

  const week = { 'zendesk_talk_call_exports.created_at_date': '7 days' };

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['zendesk_talk_call_exports.direction', 'zendesk_talk_call_exports.call_count'],
    filters: { ...week },
  }, 'direction (last 7d)');

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['zendesk_talk_call_exports.ivr_destination_group_name', 'zendesk_talk_call_exports.call_count'],
    filters: { ...week, 'zendesk_talk_call_exports.direction': 'inbound' },
  }, 'IVR Destination Group Name (inbound, last 7d) — top 60');

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['zendesk_talk_call_exports.ivr_destination_group_tier', 'zendesk_talk_call_exports.call_count'],
    filters: { ...week, 'zendesk_talk_call_exports.direction': 'inbound' },
  }, 'IVR Destination Group Tier (inbound, last 7d)');

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['zendesk_talk_call_exports.ivr_destination_group_tier_rollup', 'zendesk_talk_call_exports.call_count'],
    filters: { ...week, 'zendesk_talk_call_exports.direction': 'inbound' },
  }, 'IVR Destination Group Tier Rollup (inbound, last 7d)');

  await runWrite(token, baseUrl, {
    ...base,
    fields: ['zendesk_talk_call_exports.line_type', 'zendesk_talk_call_exports.call_count'],
    filters: { ...week, 'zendesk_talk_call_exports.direction': 'inbound' },
  }, 'Line Type (inbound, last 7d)');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
