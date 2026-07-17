#!/usr/bin/env node
'use strict';
/**
 * One-off: dump ALL dimensions and measures from any explore.
 * Usage: node scripts/looker-explore-all.js <model> <explore>
 */
const fs = require('fs');
const path = require('path');
const { lookerLogin, lookerGetExplore } = require('../netlify/functions/lib/looker-api.js');

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

const MODEL = process.argv[2];
const EXPLORE = process.argv[3];

async function main() {
  if (!MODEL || !EXPLORE) {
    console.error('Usage: node scripts/looker-explore-all.js <model> <explore>');
    process.exit(1);
  }
  loadLookerEnv();
  const baseUrl = process.env.LOOKER_BASE_URL;
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  const token = await lookerLogin(baseUrl, clientId, clientSecret);
  const ex = await lookerGetExplore(baseUrl, token, MODEL, EXPLORE);
  const measures = Array.isArray(ex.fields?.measures) ? ex.fields.measures : [];
  const dims = Array.isArray(ex.fields?.dimensions) ? ex.fields.dimensions : [];

  console.log(`Explore ${MODEL}/${EXPLORE}  (${dims.length} dims, ${measures.length} measures)\n`);
  console.log('=== ALL measures ===');
  for (const m of measures) {
    console.log(`  ${m.name}  [${m.type || '?'}]  ${m.label || ''}`);
  }
  console.log('\n=== ALL dimensions ===');
  for (const d of dims) {
    console.log(`  ${d.name}  [${d.type || '?'}]  ${d.label || ''}`);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
