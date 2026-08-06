#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { parseServiceAccountJson } = require('../netlify/functions/_sheets.js');

const PLAYWRIGHT_ROOT = path.join(__dirname, '..', '..', 'cs-adherence-dashboard');
const { chromium } = require(path.join(PLAYWRIGHT_ROOT, 'node_modules', 'playwright'));

const SCRIPT_URL =
  'https://script.google.com/home/projects/1jTdZBkgb9gOhNO2GRAPScqs5D3iSg_zuiR74SnFsxCOZPHWreXA8v82f/edit';
const SPREADSHEET_ID = '1znBYs9PemirPw_is3b8Blj74wEz7Hb6iGH88DH2qWmU';

async function getExpiredDeclineUrl() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  let saJson = '';
  for (const line of raw.split('\n')) {
    const j = line.match(/^GOOGLE_SERVICE_ACCOUNT_JSON=(.*)$/);
    if (j) saJson = j[1].trim();
  }
  const auth = new google.auth.GoogleAuth({
    credentials: parseServiceAccountJson(saJson),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Offers!A:S' });
  const values = res.data.values || [];
  for (let i = values.length - 1; i >= 1; i--) {
    const status = String(values[i][13] || '').trim().toUpperCase();
    const decline = String(values[i][18] || '').trim();
    if (status === 'EXPIRED' && decline.startsWith('http')) return decline;
  }
  return null;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const userDataDir = path.join(PLAYWRIGHT_ROOT, '.playwright-google-profile');
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: true,
  });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(SCRIPT_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(8000);
    if (/sign in/i.test(await page.title())) {
      console.log('EDITOR: sign-in required');
      process.exitCode = 2;
      return;
    }
    for (let i = 0; i < 30; i++) {
      const ready = await page.evaluate(
        () => !!(window.monaco && monaco.editor && monaco.editor.getEditors && monaco.editor.getEditors().length)
      );
      if (ready) break;
      await sleep(1000);
    }
    const meta = await page.evaluate(() => {
      const v = window.monaco.editor.getEditors()[0].getValue();
      return {
        version: (v.match(/TARGETED VTO BOT (v[\d.]+)/i) || [])[1],
        rvtoVersion: (v.match(/VERSION:\s*'(V[\d.]+)'/) || [])[1],
        hasIntradayEngine: v.includes('rvtoRunIntradayEngine_'),
        hasOfferLookupFix: v.includes('rvtoFindOfferSheetRowIndex_'),
        len: v.length,
      };
    });
    console.log('EDITOR_DEPLOYED:', JSON.stringify(meta));

    const declineUrl = await getExpiredDeclineUrl();
    if (!declineUrl) {
      console.log('WEBAPP_SMOKE: no expired decline URL in sheet');
      return;
    }
    console.log('WEBAPP_SMOKE_URL:', declineUrl.slice(0, 120) + '...');
    await page.goto(declineUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(5000);
    const body = ((await page.textContent('body')) || '').replace(/\s+/g, ' ').trim();
    const snippet = body.slice(0, 500);
    console.log('WEBAPP_BODY_SNIPPET:', snippet);
    const notFound = /offer not found/i.test(body);
    const okDecline = /declined|no longer active|expired/i.test(body);
    console.log('WEBAPP_RESULT:', notFound ? 'FAIL_OFFER_NOT_FOUND' : okDecline ? 'OK_LOOKUP_WORKS' : 'UNKNOWN_' + snippet.slice(0, 80));
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
