#!/usr/bin/env node
'use strict';

/** Restore Offers row 1 headers and remove accidental pasted code rows 2–799. */

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

const SPREADSHEET_ID = (() => {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^TARGETED_VTO_SPREADSHEET_ID=(.*)$/);
    if (m) return m[1].trim();
  }
  return '1znBYs9PemirPw_is3b8Blj74wEz7Hb6iGH88DH2qWmU';
})();

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  let saJson = '';
  for (const line of raw.split('\n')) {
    const j = line.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.*)$/);
    if (j) saJson = j[1].trim();
  }
  const auth = new google.auth.GoogleAuth({
    credentials: parseServiceAccountJson(saJson),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties' });
  const offers = meta.data.sheets.find((s) => s.properties.title === 'Offers');
  if (!offers) throw new Error('Offers tab missing');
  const sheetId = offers.properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Offers!A1:W1',
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  });
  console.log('Restored Offers row 1 headers');

  // Delete sheet rows 2–799 (0-based indices 1..798) — pasted script junk before real offer log ~row 800.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 799 },
        },
      }],
    },
  });
  console.log('Deleted junk rows 2–799');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
