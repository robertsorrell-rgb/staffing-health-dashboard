#!/usr/bin/env node
'use strict';

/**
 * Push targeted-vto-bot.gs to the bound Apps Script project (Monaco via CDP).
 *
 * Prerequisite: Chrome with remote debugging, e.g.
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *
 *   node scripts/deploy-targeted-vto-gas-cdp.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const GS_SOURCE = path.join(REPO_ROOT, 'apps-script', 'targeted-vto-bot.gs');
const SCRIPT_URL =
  process.env.TARGETED_VTO_SCRIPT_URL ||
  'https://script.google.com/home/projects/1jTdZBkgb9gOhNO2GRAPScqs5D3iSg_zuiR74SnFsxCOZPHWreXA8v82f/edit';
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return require(path.join(REPO_ROOT, '..', 'cs-adherence-dashboard', 'node_modules', 'playwright'));
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pasteCode(page, gsCode) {
  await sleep(2000);
  const codeFile = page.getByRole('option', { name: /Code\.gs|targeted-vto-bot/i }).first();
  if (await codeFile.count()) {
    await codeFile.click();
    await sleep(1000);
  }

  const ok = await page.evaluate((code) => {
    const editors =
      window.monaco && window.monaco.editor && window.monaco.editor.getEditors
        ? window.monaco.editor.getEditors()
        : [];
    if (editors.length) {
      editors[0].setValue(code);
      return { via: 'monaco', head: editors[0].getValue().slice(0, 100) };
    }
    return { via: '', head: '' };
  }, gsCode);
  if (!ok.via) throw new Error('Could not find Apps Script Monaco editor');
  console.log('Pasted via', ok.via, '| head:', ok.head.replace(/\n/g, ' '));
  await sleep(800);
  await page.keyboard.press('Meta+s');
  await sleep(3500);
  const save = page.getByRole('button', { name: /Save project/i }).first();
  if (await save.count() && !(await save.isDisabled())) {
    await save.click();
    await sleep(2500);
  }
}

async function main() {
  const gsCode = fs.readFileSync(GS_SOURCE, 'utf8');
  const version = (gsCode.match(/TARGETED VTO BOT (v[\d.]+)/i) || [])[1] || 'unknown';
  if (!gsCode.includes('rvtoRosterNameFromHeaders_')) {
    console.warn('Warning: deployed file may be missing v1.11.4 roster hardening');
  }
  console.log('Deploying', version, '(' + gsCode.length + ' bytes) →', SCRIPT_URL);

  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes('script.google.com')) || context.pages()[0];
  console.log('CDP page:', page.url());

  await page.goto(SCRIPT_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(8000);
  if (/sign in/i.test(await page.title())) {
    throw new Error('Google sign-in required in the Chrome CDP profile');
  }

  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(
      () => !!(window.monaco && monaco.editor && monaco.editor.getEditors && monaco.editor.getEditors().length)
    );
    if (ready) break;
    await sleep(1000);
  }
  const ready = await page.evaluate(
    () => !!(window.monaco && monaco.editor && monaco.editor.getEditors && monaco.editor.getEditors().length)
  );
  if (!ready) throw new Error('Monaco editor not ready');

  await pasteCode(page, gsCode);
  console.log('Saved', version, 'to Apps Script');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
