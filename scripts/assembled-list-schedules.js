#!/usr/bin/env node
'use strict';
/**
 * Print schedule-like id+name pairs from Assembled (same probes as net staffing auto-resolve).
 *
 * Usage:
 *   npm run assembled:list-schedules
 *
 * Requires `.env` with ASSEMBLED_API_KEY (and optional ASSEMBLED_API_BASE).
 */
const fs = require('fs');
const path = require('path');

const {
  SCHEDULE_REST_PATHS,
  SCHEDULE_GRAPHQL_QUERIES,
  extractNamedSchedulesFromResponse,
  graphqlCollectScheduleLikeNodes,
  assembledGraphqlQuery,
} = require('../netlify/functions/lib/assembled-schedule-probe.js');

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

const apiKey = process.env.ASSEMBLED_API_KEY;
const apiBase = (process.env.ASSEMBLED_API_BASE || 'https://api.assembledhq.com/v0').replace(/\/$/, '');

if (!apiKey) {
  console.error('ASSEMBLED_API_KEY missing from .env');
  process.exit(1);
}

async function restGet(path) {
  const auth = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  const apiVer = String(process.env.ASSEMBLED_API_VERSION || '').trim();
  const url = `${apiBase}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      ...(apiVer ? { 'API-Version': apiVer } : {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _nonJson: text.slice(0, 200) };
  }
  return { path, status: res.status, json };
}

function dedupe(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = `${r.id}\t${r.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

(async () => {
  console.log(`API base: ${apiBase}\n`);

  const all = [];

  for (const path of SCHEDULE_REST_PATHS) {
    try {
      const { status, json } = await restGet(path);
      const rows = extractNamedSchedulesFromResponse(json);
      console.log(`GET ${path} → HTTP ${status} (${rows.length} id+name rows extracted)`);
      for (const r of rows) {
        console.log(`  ${r.id}\t${r.name}`);
        all.push(r);
      }
      if (json && json._nonJson) console.log(`  (non-JSON body)`);
    } catch (e) {
      console.log(`GET ${path} → error: ${e.message}`);
    }
  }

  console.log('\nGraphQL probes:\n');
  for (const query of SCHEDULE_GRAPHQL_QUERIES) {
    try {
      const json = await assembledGraphqlQuery(apiBase, apiKey, query);
      if (json.errors && json.errors.length) {
        console.log(`Query ${query.slice(0, 48)}… → errors: ${JSON.stringify(json.errors).slice(0, 200)}`);
        continue;
      }
      const rows = graphqlCollectScheduleLikeNodes(json.data);
      console.log(`Query ${query.slice(0, 48)}… → ${rows.length} nodes with id+name`);
      for (const r of rows) {
        console.log(`  ${r.id}\t${r.name}`);
        all.push(r);
      }
    } catch (e) {
      console.log(`Query ${query.slice(0, 48)}… → ${e.message}`);
    }
  }

  const merged = dedupe(all);
  console.log('\n── Unique id + name (merge of above) ──\n');
  if (!merged.length) {
    console.log(
      '(none — your key may not expose schedule lists. Open Staffing timeline in Chrome → DevTools → Network,\n filter “schedule” or inspect the schedule dropdown XHR, then set ASSEMBLED_SCHEDULE_ID in Netlify.)'
    );
    process.exit(2);
  }
  for (const r of merged) {
    console.log(`${r.id}\t${r.name}`);
  }
  console.log(
    '\nAdd to Netlify env:\n  ASSEMBLED_SCHEDULE_ID=<uuid matching “Default Schedule” or your timeline>\n'
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
