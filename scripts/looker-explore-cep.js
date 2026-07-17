#!/usr/bin/env node
'use strict';
/**
 * One-off discovery: list dimensions/measures on the contacts/call explore that
 * look related to incoming/inbound calls and the CEP work group.
 *
 * Usage: node scripts/looker-explore-cep.js
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

const MODEL = process.env.LOOKER_STL_MODEL || 'singlestore_customer_acquisition';
const EXPLORE = process.env.LOOKER_STL_EXPLORE || 'contacts_w_lead_source';

const HINT = /inbound|incoming|ib\b|call|dial|attempt|work_group|cep|queue|hour/i;

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
  console.log(`  Total measures:   ${measures.length}`);

  console.log('\n=== Measures matching call/inbound/CEP/queue hint ===');
  for (const m of measures) {
    const hay = `${m.name || ''} ${m.label || ''} ${m.description || ''}`;
    if (!HINT.test(hay)) continue;
    console.log(`  ${m.name}`);
    console.log(`      label: ${m.label || '(none)'}`);
    if (m.description) console.log(`      desc:  ${m.description.slice(0, 200)}`);
  }

  console.log('\n=== Dimensions matching call/inbound/CEP/queue/work_group/hour hint ===');
  for (const d of dims) {
    const hay = `${d.name || ''} ${d.label || ''} ${d.description || ''}`;
    if (!HINT.test(hay)) continue;
    console.log(`  ${d.name}`);
    console.log(`      label: ${d.label || '(none)'}`);
    if (d.description) console.log(`      desc:  ${d.description.slice(0, 160)}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
