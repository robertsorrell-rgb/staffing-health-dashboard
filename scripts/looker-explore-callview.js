#!/usr/bin/env node
'use strict';
/**
 * One-off: dump dimensions/measures from singlestore_customer_acquisition/call_view
 * that look like inbound / direction / work group / hour / count.
 *
 * Usage: node scripts/looker-explore-callview.js
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

const MODEL = process.argv[2] || 'singlestore_customer_acquisition';
const EXPLORE = process.argv[3] || 'call_view';

const HINT = /inbound|outbound|incoming|direction|ib\b|ob\b|cep|work_group|queue|hour|count|call_type|interaction_type|created_at_date|created_at_hour|line_type|participant|strategy|first_attempt/i;

async function main() {
  loadLookerEnv();
  const baseUrl = process.env.LOOKER_BASE_URL;
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  if (!baseUrl || !clientId || !clientSecret) {
    console.error('Missing LOOKER_BASE_URL / CLIENT_ID / CLIENT_SECRET');
    process.exit(1);
  }
  const token = await lookerLogin(baseUrl, clientId, clientSecret);
  const ex = await lookerGetExplore(baseUrl, token, MODEL, EXPLORE);
  const measures = Array.isArray(ex.fields?.measures) ? ex.fields.measures : [];
  const dims = Array.isArray(ex.fields?.dimensions) ? ex.fields.dimensions : [];

  console.log(`Explore ${MODEL}/${EXPLORE}`);
  console.log(`  Total dimensions: ${dims.length}`);
  console.log(`  Total measures:   ${measures.length}\n`);

  console.log('=== ALL measures ===');
  for (const m of measures) {
    console.log(`  ${m.name}  [${m.type || '?'}]  label="${m.label || ''}"`);
    if (m.description) console.log(`      desc: ${String(m.description).slice(0, 200)}`);
  }

  console.log('\n=== Dimensions matching hint ===');
  for (const d of dims) {
    const hay = `${d.name || ''} ${d.label || ''} ${d.description || ''}`;
    if (!HINT.test(hay)) continue;
    console.log(`  ${d.name}  [${d.type || '?'}]  label="${d.label || ''}"`);
    if (d.description) console.log(`      desc: ${String(d.description).slice(0, 160)}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
