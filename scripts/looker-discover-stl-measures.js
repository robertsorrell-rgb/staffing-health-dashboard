#!/usr/bin/env node
'use strict';
/**
 * Lists measures on contacts_w_lead_source that look like speed-to-lead / handle time.
 * Loads LOOKER_* from ../.env (same pattern as looker-stl-unpivot-query.js).
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

const HINT = /time|speed|attempt|first|contact|response|handle|minute|second|latency|wait|sla|stl|lead/i;

async function main() {
  loadLookerEnv();
  const baseUrl = process.env.LOOKER_BASE_URL;
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  if (!baseUrl || !clientId || !clientSecret) {
    console.error('Missing LOOKER_BASE_URL / CLIENT_ID / CLIENT_SECRET in .env');
    process.exit(1);
  }

  const token = await lookerLogin(baseUrl, clientId, clientSecret);
  const ex = await lookerGetExplore(baseUrl, token, MODEL, EXPLORE);
  const measures = Array.isArray(ex.fields?.measures) ? ex.fields.measures : [];
  const dims = Array.isArray(ex.fields?.dimensions) ? ex.fields.dimensions : [];

  const scored = measures
    .map((m) => {
      const name = String(m.name || '');
      const label = String(m.label || m.field_filter_title || '');
      const desc = String(m.description || '');
      const hay = `${name} ${label} ${desc}`;
      const hit = HINT.test(hay);
      return { name, label, description: desc, hit };
    })
    .filter((x) => x.hit)
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Explore ${MODEL}/${EXPLORE} — measures matching timing hint (${scored.length}):`);
  for (const m of scored) {
    console.log(`  ${m.name}`);
    console.log(`      label: ${m.label || '(none)'}`);
    if (m.description) console.log(`      desc: ${m.description.slice(0, 160)}${m.description.length > 160 ? '…' : ''}`);
  }

  console.log('\nCandidate date dimensions (first 15 with "date" or created_at):');
  dims
    .filter((d) => /date|created_at|timestamp/i.test(String(d.name)))
    .slice(0, 15)
    .forEach((d) => console.log(`  ${d.name} — ${d.label || ''}`));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
