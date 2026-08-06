#!/usr/bin/env node
'use strict';

/** Simulate doGet offer lookup (column A + header resolve) without hitting the web app. */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { parseServiceAccountJson } = require('../netlify/functions/_sheets.js');

const HEADERS = [
  'Offer ID', 'Deficit ID', 'Date', 'Start', 'End',
  'Name', 'Email', 'Agent ID', 'Queue', 'Manager',
  'Sent At', 'Expires At', 'Hold Hours', 'Status',
  'Response Time', 'Response Action',
  'Token', 'Accept URL', 'Decline URL',
  'Assembled Request ID', 'Assembled Status', 'Assembled Response', 'Notes',
];

const offerId = process.argv[2] || 'RVTO_WK_1785771951370_88120';

function resolveHeaders(firstRow) {
  if (firstRow && String(firstRow[0] || '').trim() === 'Offer ID') return firstRow;
  return HEADERS;
}

function findRowIndex(values, wantId) {
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === wantId) return i;
  }
  return -1;
}

function loadEnv() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  let saJson = '';
  let spreadsheetId = '1znBYs9PemirPw_is3b8Blj74wEz7Hb6iGH88DH2qWmU';
  for (const line of raw.split('\n')) {
    const j = line.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.*)$/);
    if (j) saJson = j[1].trim();
    const s = line.match(/^TARGETED_VTO_SPREADSHEET_ID=(.*)$/);
    if (s) spreadsheetId = s[1].trim();
  }
  return { saJson, spreadsheetId };
}

async function main() {
  const { saJson, spreadsheetId } = loadEnv();
  const auth = new google.auth.GoogleAuth({
    credentials: parseServiceAccountJson(saJson),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Offers!A:W',
  });
  const values = res.data.values || [];
  const headers = resolveHeaders(values[0]);
  const rowIdx = findRowIndex(values, offerId);
  const a1 = values[0] ? values[0][0] : '';
  console.log('Spreadsheet:', spreadsheetId);
  console.log('A1:', JSON.stringify(a1), a1 === 'Offer ID' ? '(OK)' : '(uses fallback headers)');
  console.log('Offer ID:', offerId);
  if (rowIdx === -1) {
    console.log('RESULT: Offer not found (doGet would fail)');
    process.exit(1);
  }
  const row = values[rowIdx];
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i]; });
  console.log('Sheet row (1-based):', rowIdx + 1);
  console.log('Status:', obj.Status);
  console.log('Email:', obj.Email);
  console.log('Date/Window:', obj.Date, obj.Start, '-', obj.End);
  console.log('Expires At:', obj['Expires At']);
  console.log('Token present:', Boolean(String(obj.Token || '').trim()));
  console.log('RESULT: Offer found (wrong token → Invalid token; correct token → process accept/decline)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
