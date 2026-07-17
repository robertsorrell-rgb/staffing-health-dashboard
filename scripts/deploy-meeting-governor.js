#!/usr/bin/env node
'use strict';

/**
 * Push apps-script/meeting-governor.gs to the Meeting Optimizer Apps Script project.
 *
 * Uses a logged-in Google Chrome profile (same as cs-adherence-dashboard deploy scripts).
 *   npm run deploy:meeting-governor
 *   node scripts/deploy-meeting-governor.js [--run-now]
 *   node scripts/deploy-meeting-governor.js --reprocess-row=111
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const GS_SOURCE = path.join(REPO_ROOT, 'apps-script', 'meeting-governor.gs');
const SPREADSHEET_ID = '1HsE_GG26stfnkPgg9C964Y7M9r3ZDuzRN_D-AkzcQOo';
const SCRIPT_ID = '1_-YQGfTzW9r_cd0MfNRHZO5DcS84PGMiAfbWlBWjfo4eSfeuTGYJS2GQ';
const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
const SCRIPT_URL = `https://script.google.com/d/${SCRIPT_ID}/edit`;
const PROFILE = path.join(REPO_ROOT, '..', 'cs-adherence-dashboard', '.playwright-google-profile');
const RUN_NOW = process.argv.includes('--run-now');
const REPROCESS_ROW = (() => {
  const arg = process.argv.find((a) => a.startsWith('--reprocess-row='));
  if (!arg) return null;
  const n = Number(arg.split('=')[1]);
  return Number.isFinite(n) && n >= 2 ? n : null;
})();

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    const fallback = path.join(REPO_ROOT, '..', 'cs-adherence-dashboard', 'node_modules', 'playwright');
    return require(fallback);
  }
}

function readVersion(gsCode) {
  const m = gsCode.match(/MEETING GOVERNOR (v[\d.]+)/);
  return m ? m[1] : 'unknown';
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForLogin(page, label, maxMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const text = ((await page.textContent('body').catch(() => '')) || '').slice(0, 800);
    const title = (await page.title().catch(() => '')) || '';
    if (!/sign in|log in|choose an account/i.test(text + ' ' + title)) return true;
    if ((Date.now() - start) % 15000 < 3000) {
      console.log(`Waiting for Google login (${label})… title=${title}`);
    }
    await sleep(3000);
  }
  return false;
}

async function pasteCode(editorPage, gsCode) {
  await sleep(3000);
  const codeFile = editorPage.getByRole('option', { name: /Code\.gs/i }).first();
  if (await codeFile.count()) await codeFile.click();
  await sleep(1500);

  const ok = await editorPage.evaluate((code) => {
    const editors =
      window.monaco && window.monaco.editor && window.monaco.editor.getEditors
        ? window.monaco.editor.getEditors()
        : [];
    if (editors.length) {
      editors[0].setValue(code);
      return 'monaco';
    }
    const ta = document.querySelector('textarea.inputarea');
    if (ta) {
      ta.value = code;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'textarea';
    }
    return '';
  }, gsCode);

  if (!ok) throw new Error('Could not find Apps Script editor surface');
  console.log('Updated editor via', ok);
  await sleep(1000);
  await editorPage.keyboard.press('Meta+s');
  await sleep(2500);
  const save = editorPage.getByRole('button', { name: /Save project/i }).first();
  if (await save.count() && !(await save.isDisabled())) {
    await save.click();
    await sleep(2000);
  }
}

async function runAppsScriptFunction(editorPage, fnName) {
  console.log('Running Apps Script function:', fnName);
  // Function dropdown near the Run button
  const combo = editorPage.locator('[aria-label="Select function to run"], [aria-label*="function" i]').first();
  if (await combo.count()) {
    await combo.click();
    await sleep(500);
    await editorPage.keyboard.type(fnName);
    await sleep(700);
    await editorPage.keyboard.press('Enter');
    await sleep(500);
  } else {
    // Fallback: type into any visible function select-like control
    const typed = await editorPage.evaluate((name) => {
      const selects = [...document.querySelectorAll('input, [role="combobox"]')];
      for (const el of selects) {
        const label = (el.getAttribute('aria-label') || el.placeholder || '').toLowerCase();
        if (label.includes('function') || label.includes('select')) {
          el.focus();
          if ('value' in el) el.value = name;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, fnName);
    if (!typed) console.warn('Could not locate function picker — trying Run anyway');
  }

  const runBtn = editorPage.getByRole('button', { name: /^Run$/i }).first();
  if (await runBtn.count()) {
    await runBtn.click();
  } else {
    await editorPage.keyboard.press('Meta+Enter'); // common Apps Script run shortcut
  }
  await sleep(2000);

  // Authorization prompt
  const review = editorPage.getByRole('button', { name: /Review permissions/i }).first();
  if (await review.count()) {
    await review.click();
    await sleep(3000);
  }
  // Wait for execution to finish (Execution log / Done)
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const body = ((await editorPage.textContent('body').catch(() => '')) || '').slice(0, 4000);
    if (/Execution completed|completed with status|EXCEPTION|Error/i.test(body)) {
      console.log('Execution feedback snippet:', body.match(/.{0,80}(Execution completed|EXCEPTION|Error).{0,120}/i)?.[0] || 'seen');
      break;
    }
    await sleep(3000);
  }
}

async function runNow(spreadsheetPage) {
  await spreadsheetPage.goto(SPREADSHEET_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(2000);
  const menu = spreadsheetPage.getByRole('combobox', { name: /Menus/i }).first();
  if (await menu.count()) {
    await menu.click();
    await sleep(300);
    await spreadsheetPage.keyboard.type('Run Now');
    await sleep(500);
    const runItem = spreadsheetPage.getByRole('option', { name: /Run Now/i }).first();
    if (await runItem.count()) {
      await runItem.click();
      console.log('Triggered Run Now via Menus combobox');
      return;
    }
  }
  const meetingMenu = spreadsheetPage.getByRole('button', { name: /^Meeting Optimizer$/i }).first();
  if (await meetingMenu.count()) {
    await meetingMenu.click();
    await sleep(500);
    const runNowItem = spreadsheetPage.getByRole('menuitem', { name: /Run Now/i }).first();
    if (await runNowItem.count()) {
      await runNowItem.click();
      console.log('Triggered Run Now via Meeting Optimizer menu');
    }
  }
}

async function main() {
  if (!fs.existsSync(GS_SOURCE)) {
    throw new Error('Source not found: ' + GS_SOURCE);
  }
  if (!fs.existsSync(PROFILE)) {
    throw new Error('Playwright Google profile not found: ' + PROFILE);
  }

  const gsCode = fs.readFileSync(GS_SOURCE, 'utf8');
  const version = readVersion(gsCode);
  console.log('Deploying meeting-governor.gs', version, '(' + gsCode.length + ' bytes)');
  if (REPROCESS_ROW) console.log('Will reprocess Requests row', REPROCESS_ROW, 'after save');

  const { chromium } = loadPlaywright();
  const browser = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const page = browser.pages()[0] || (await browser.newPage());
    console.log('Opening Apps Script editor…');
    await page.goto(SCRIPT_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (!(await waitForLogin(page, 'apps script'))) {
      throw new Error('Google login required — sign in in the Chrome window, then re-run.');
    }

    await pasteCode(page, gsCode);
    console.log('Saved Code.gs —', version, 'is live in Apps Script.');

    if (REPROCESS_ROW) {
      const fn =
        REPROCESS_ROW === 111 ? 'mgReprocessRow111' : `mgReprocessRequestRow`;
      if (REPROCESS_ROW === 111) {
        await runAppsScriptFunction(page, fn);
      } else {
        // For other rows: inject a one-shot runner at bottom, save, run
        const runner = `\nfunction __mgReprocessOnce(){ return mgReprocessRequestRow(${REPROCESS_ROW}); }\n`;
        await pasteCode(page, gsCode + runner);
        await runAppsScriptFunction(page, '__mgReprocessOnce');
      }
    }

    if (RUN_NOW) {
      console.log('Triggering Run Now on spreadsheet…');
      await runNow(page);
    }

    await sleep(3000);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
