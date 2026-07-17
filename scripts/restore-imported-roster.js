#!/usr/bin/env node
'use strict';

/**
 * Inspect Imported Roster damage and open Sheets version history for restore.
 * Requires Chrome already running with --remote-debugging-port=9222
 * DOES NOT call browser.close() (that kills the Chrome CDP session).
 */

const { chromium } = require('playwright');
const fs = require('fs');

const SHEET_ID = '1HsE_GG26stfnkPgg9C964Y7M9r3ZDuzRN_D-AkzcQOo';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const DO_RESTORE = process.argv.includes('--restore');

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];

  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Imported%20Roster`;
  const resp = await ctx.request.get(csvUrl);
  const csv = await resp.text();
  fs.writeFileSync('/tmp/imported-roster-now.csv', csv);
  const rows = csv.split(/\r?\n/).filter((l) => l.length);
  console.log('Imported Roster now: status=%s bytes=%s rows=%s', resp.status(), csv.length, rows.length);
  console.log('header:', (rows[0] || '').slice(0, 300));
  console.log('row2:', (rows[1] || '').slice(0, 300));

  let page = ctx.pages().find((p) => p.url().includes(SHEET_ID)) || (await ctx.newPage());
  await page.goto(SHEET_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(4000);

  await page.click('#docs-file-menu', { timeout: 15000 });
  await sleep(500);
  const vh = page.locator('.goog-menuitem', { hasText: /Version history/i }).first();
  await vh.hover();
  await sleep(600);
  await page.locator('.goog-menuitem', { hasText: /See version history/i }).first().click();
  console.log('Opened See version history');
  await sleep(9000);

  const hist = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.docs-revisions-tile')].map((el, i) => ({
      i,
      aria: el.getAttribute('aria-label') || '',
      text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 180),
    }));
    const sidebar = document.querySelector('.docs-revisions-sidebar');
    return {
      tileCount: tiles.length,
      tiles: tiles.slice(0, 25),
      sidebarText: (sidebar?.innerText || '').slice(0, 2500),
      hasRestore: /Restore this version/i.test(document.body.innerText || ''),
    };
  });
  console.log(JSON.stringify(hist, null, 2));

  if (!DO_RESTORE) {
    console.log('Pass --restore to pick a pre-damage version and restore (interactive confirm in UI).');
    // Disconnect only — do not close Chrome
    browser.disconnect();
    return;
  }

  // Prefer a version from before ~9:00 AM today (damage ~9:03).
  // Click tiles from the top and find one that still has roster emails when previewed.
  const tiles = page.locator('.docs-revisions-tile');
  const n = await tiles.count();
  console.log('Clicking through', n, 'revision tiles…');
  let chosen = -1;
  for (let i = 0; i < Math.min(n, 20); i++) {
    await tiles.nth(i).click();
    await sleep(3500);
    const check = await page.evaluate(() => {
      const body = document.body.innerText || '';
      const emails = (body.match(/@varsitytutors\.com/g) || []).length;
      const script = /MEETING GOVERNOR|function mgProcess/.test(body);
      const label =
        document.querySelector('.docs-revisions-tile-selected, .docs-revisions-tile.goog-control-hover')?.innerText ||
        '';
      return { emails, script, label: label.replace(/\s+/g, ' ').slice(0, 120) };
    });
    console.log('tile', i, check);
    // Current empty version will have ~0 emails
    if (check.emails >= 20 && !check.script) {
      chosen = i;
      break;
    }
  }

  if (chosen < 0) {
    // Fallback: skip the first (current) tile, take the next one that isn't empty
    for (let i = 1; i < Math.min(n, 10); i++) {
      await tiles.nth(i).click();
      await sleep(3000);
      const emails = await page.evaluate(() => (document.body.innerText.match(/@varsitytutors\.com/g) || []).length);
      console.log('fallback tile', i, 'emails', emails);
      if (emails >= 5) {
        chosen = i;
        break;
      }
    }
  }

  if (chosen < 0) {
    console.error('Could not find a healthy revision automatically. Leave Version history open for manual restore.');
    browser.disconnect();
    process.exit(2);
  }

  console.log('Restoring tile', chosen);
  await tiles.nth(chosen).click();
  await sleep(2000);
  const restoreBtn = page.getByRole('button', { name: /Restore this version/i }).first();
  if (!(await restoreBtn.count())) {
    // Some UIs use a menu
    const alt = page.locator('text=/Restore this version/i').first();
    await alt.click({ timeout: 10000 });
  } else {
    await restoreBtn.click();
  }
  await sleep(1500);
  // Confirm dialog
  const confirm = page.getByRole('button', { name: /^Restore$/i }).first();
  if (await confirm.count()) await confirm.click();
  await sleep(8000);

  const after = await ctx.request.get(csvUrl);
  const afterCsv = await after.text();
  fs.writeFileSync('/tmp/imported-roster-after-restore.csv', afterCsv);
  const afterRows = afterCsv.split(/\r?\n/).filter((l) => l.length);
  console.log(
    'After restore: rows=%s emails=%s header=%s',
    afterRows.length,
    (afterCsv.match(/@varsitytutors\.com/g) || []).length,
    (afterRows[0] || '').slice(0, 200)
  );
  browser.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
