#!/usr/bin/env node
/**
 * Writes .env for local `netlify dev` from a service-account JSON key file.
 * Usage: node scripts/bootstrap-local-env.js [/path/to/service-account-key.json]
 * Default path: ../VCPU-Dashboard/sheet-credentials.json (sibling repo).
 *
 * Merges keys from .env.example (same folder as package.json) so CAPACITY_PULL_*,
 * bot IDs, etc. are present — fill empty values as you wire each workbook.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const argPath = process.argv[2];
const defaultCred = path.resolve(__dirname, '../VCPU-Dashboard/sheet-credentials.json');
const credPath = argPath ? path.resolve(argPath) : defaultCred;

if (!fs.existsSync(credPath)) {
  console.error('Credentials file not found:', credPath);
  process.exit(1);
}

const credObj = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const compact = JSON.stringify(credObj);
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

const seen = new Set();
const out = [];

function addLine(line) {
  const t = line.trim();
  if (!t) {
    out.push('');
    return;
  }
  if (t.startsWith('#')) {
    out.push(t);
    return;
  }
  const eq = t.indexOf('=');
  if (eq < 0) {
    out.push(t);
    return;
  }
  const key = t.slice(0, eq);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(t);
}

addLine('# Auto-generated — gitignored. Regenerate with: node scripts/bootstrap-local-env.js');
addLine('# Credentials source: ' + credPath);
if (/[\r\n']/.test(compact)) {
  addLine('GOOGLE_SERVICE_ACCOUNT_JSON=' + JSON.stringify(compact));
} else {
  addLine("GOOGLE_SERVICE_ACCOUNT_JSON='" + compact + "'");
}
addLine('IDLE_CONSUMER_SPREADSHEET_ID=1MlHy2dB9JieEk4q72YhsEJLwvFFYJZ_fAI7s4M7mDLk');
addLine('IDLE_CONSUMER_HOURLY_LOG_TAB=CS_Hourly_Log');

if (fs.existsSync(examplePath)) {
  addLine('');
  addLine('# --- From .env.example (fill spreadsheet IDs / tabs) ---');
  const raw = fs.readFileSync(examplePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) {
      addLine(line.trimEnd());
      continue;
    }
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq);
    if (key === 'GOOGLE_SERVICE_ACCOUNT_JSON') continue;
    addLine(line.trimEnd());
  }
}

fs.writeFileSync(envPath, out.join('\n').replace(/\n+$/, '\n'), 'utf8');
console.log('Wrote', envPath);
console.log('Keys:', [...seen].sort().join(', '));
