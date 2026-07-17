#!/usr/bin/env node
'use strict';
/**
 * One-off: list LookML models + explores the API user can see, then keyword-grep
 * for ones that look related to inbound calls / CEP / contact center.
 *
 * Usage: node scripts/looker-list-models.js
 */
const fs = require('fs');
const path = require('path');
const { lookerLogin, normalizeBaseUrl } = require('../netlify/functions/lib/looker-api.js');

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

const HINT = process.argv[2] === '--all' ? /./ : /call|cep|ib\b|inbound|contact|dial|queue|five9|talkdesk|nice|ininx|cxone|amazon connect|cust(?:omer)? engagement|phone|offered|conversation|ticket|support|gpc|genesys|interaction|zendesk|invoca/i;

async function main() {
  loadLookerEnv();
  const baseUrl = normalizeBaseUrl(process.env.LOOKER_BASE_URL);
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  if (!baseUrl || !clientId || !clientSecret) {
    console.error('Missing LOOKER_BASE_URL / CLIENT_ID / CLIENT_SECRET');
    process.exit(1);
  }
  const token = await lookerLogin(baseUrl, clientId, clientSecret);

  const url = `${baseUrl}/api/4.0/lookml_models?fields=name,project_name,explores(name,label,description)`;
  const res = await fetch(url, { headers: { Authorization: `token ${token}` } });
  const text = await res.text();
  if (!res.ok) {
    console.error(`lookml_models failed (${res.status}): ${text.slice(0, 500)}`);
    process.exit(1);
  }
  const models = JSON.parse(text);
  if (!Array.isArray(models)) {
    console.error('Unexpected response shape');
    process.exit(1);
  }

  const matches = [];
  for (const m of models) {
    const explores = Array.isArray(m.explores) ? m.explores : [];
    for (const e of explores) {
      const hay = `${m.name || ''} ${m.project_name || ''} ${e.name || ''} ${e.label || ''} ${e.description || ''}`;
      if (HINT.test(hay)) matches.push({ model: m.name, explore: e.name, label: e.label, desc: e.description });
    }
  }

  console.log(`Total models: ${models.length}`);
  console.log(`Total matches (call/CEP/inbound/queue): ${matches.length}\n`);
  for (const m of matches) {
    console.log(`  ${m.model} / ${m.explore}`);
    if (m.label) console.log(`      label: ${m.label}`);
    if (m.desc) console.log(`      desc:  ${String(m.desc).slice(0, 160)}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
