#!/usr/bin/env node
'use strict';

/**
 * One-off: repair Targeted VTO Roster headers/layout + Config for today's run.
 * Usage: node scripts/fix-targeted-vto-today.js
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { parseServiceAccountJson } = require('../netlify/functions/_sheets.js');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const text = fs.readFileSync(envPath, 'utf8');
for (const line of text.split('\n')) {
  const id = line.match(/^TARGETED_VTO_SPREADSHEET_ID=(.*)$/);
  if (id) process.env.TARGETED_VTO_SPREADSHEET_ID = id[1].trim();
  const j = line.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.*)$/);
  if (j) process.env.GOOGLE_SERVICE_ACCOUNT_JSON = j[1].trim();
}

const SPREADSHEET_ID =
  process.env.TARGETED_VTO_SPREADSHEET_ID || '1znBYs9PemirPw_is3b8Blj74wEz7Hb6iGH88DH2qWmU';

async function main() {
  const credentials = parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const roster = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Roster!A1:Z500',
  });
  const rows = roster.data.values || [];
  const header = rows[0] || [];
  console.log('Roster before header:', JSON.stringify(header), '| data rows:', rows.length - 1);

  const newHeader = ['Name', 'Email', 'Work Group', 'Manager', 'Sub Group', 'Functional Group', 'Senior'];
  const newData = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => c !== '' && c != null)) continue;
    const colA = String(r[0] || '').trim();
    const colB = String(r[1] || '').trim();
    const colC = String(r[2] || '').trim();
    if (!colA) continue;

    let name = colA;
    let email = colB.includes('@') ? colB : '';
    let workGroup = '';
    let manager = '';

    if (String(header[0] || '').trim() === 'Name' && String(header[1] || '').trim() === 'Email') {
      workGroup = colC;
      manager = String(r[3] || '').trim();
    } else {
      // Legacy: A=name, B=manager, C=work group
      manager = colB;
      workGroup = colC;
    }

    newData.push([name, email, workGroup, manager, r[4] || '', r[5] || '', r[6] || '']);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Roster!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [newHeader, ...newData] },
  });
  console.log('Roster repaired:', newData.length, 'reps');

  const cfg = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Config!A1:C100',
  });
  const cfgRows = cfg.data.values || [];
  const updates = {
    INDIVIDUAL_DAY_VTO_ENABLED: 'TRUE',
    INDIVIDUAL_DAY_VTO_TARGET_DATE: '2026-08-03',
    STANDARD_VTO_ENABLED: 'TRUE',
    WEEK_VTO_ENABLED: 'FALSE',
    LOOKAHEAD_DAYS: '1',
    SEND_EMAILS: 'TRUE',
    WEEK_VTO_CAMPAIGN_MODE: 'WEEK_BLOCK',
    WEEK_VTO_PICK_DATES: '',
    WEEK_VTO_START_DATE: '',
    WEEK_VTO_END_DATE: '',
  };
  const noteOverrides = {
    INDIVIDUAL_DAY_VTO_TARGET_DATE:
      'Today (2026-08-03 CT). Single-day menu: Run Week / Single-Day VTO. Run Now ignores this row.',
    INDIVIDUAL_DAY_VTO_ENABLED:
      'TRUE = menu Run Week / Single-Day VTO uses INDIVIDUAL_DAY_VTO_TARGET_DATE only.',
    LOOKAHEAD_DAYS: 'Run Now (intraday): 1 = surplus detection for today only.',
    STANDARD_VTO_ENABLED: 'TRUE = Run Now + timed trigger. Single-day menu works independently.',
  };

  const out = cfgRows.map((row, idx) => {
    if (idx === 0) return row;
    const key = String(row[0] || '').trim();
    if (updates[key] === undefined) return row;
    const nr = row.slice();
    nr[1] = updates[key];
    if (noteOverrides[key]) nr[2] = noteOverrides[key];
    return nr;
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Config!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: out },
  });
  console.log('Config updated:', Object.keys(updates).join(', '));

  const verify = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Roster!A1:D3',
  });
  console.log('Roster sample:', verify.data.values);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
