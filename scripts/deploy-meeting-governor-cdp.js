#!/usr/bin/env node
'use strict';

/**
 * Deploy meeting-governor.gs via Chrome already running with --remote-debugging-port=9222
 *   node scripts/deploy-meeting-governor-cdp.js [--reprocess-row=111]
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const GS_SOURCE = path.join(REPO_ROOT, 'apps-script', 'meeting-governor.gs');
const SCRIPT_URL =
  'https://script.google.com/home/projects/1_-YQGfTzW9r_cd0MfNRHZO5DcS84PGMiAfbWlBWjfo4eSfeuTGYJS2GQ/edit';
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const REPROCESS_ROW = (() => {
  const arg = process.argv.find((a) => a.startsWith('--reprocess-row='));
  if (!arg) return null;
  const n = Number(arg.split('=')[1]);
  return Number.isFinite(n) && n >= 2 ? n : null;
})();

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
  const codeFile = page.getByRole('option', { name: /Code\.gs/i }).first();
  if (await codeFile.count()) {
    await codeFile.click();
    await sleep(1000);
  } else {
    const anyGs = page.locator('text=/Code\\.gs|meeting-governor\\.gs/i').first();
    if (await anyGs.count()) {
      await anyGs.click();
      await sleep(1000);
    }
  }

  const ok = await page.evaluate((code) => {
    const editors =
      window.monaco && window.monaco.editor && window.monaco.editor.getEditors
        ? window.monaco.editor.getEditors()
        : [];
    if (editors.length) {
      editors[0].setValue(code);
      return 'monaco:' + editors[0].getValue().slice(0, 80);
    }
    const ta = document.querySelector('textarea.inputarea');
    if (ta) {
      ta.focus();
      ta.value = code;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'textarea';
    }
    return '';
  }, gsCode);
  if (!ok) throw new Error('Could not find Apps Script editor surface');
  console.log('Pasted via', ok);
  await sleep(800);
  await page.keyboard.press('Meta+s');
  await sleep(3500);
  const save = page.getByRole('button', { name: /Save project/i }).first();
  if (await save.count() && !(await save.isDisabled())) {
    await save.click();
    await sleep(2500);
  }
  const head = await page.evaluate(() => {
    const eds = (window.monaco && monaco.editor && monaco.editor.getEditors && monaco.editor.getEditors()) || [];
    return eds[0] ? eds[0].getValue().slice(0, 140) : '';
  });
  console.log('Editor head:', head.replace(/\n/g, ' | '));
}

async function runAppsScriptFunction(page, fnName) {
  console.log('Running Apps Script function:', fnName);
  const combo = page
    .locator('[aria-label="Select function to run"], [aria-label*="function" i], input[aria-label*="Function" i]')
    .first();
  if (await combo.count()) {
    await combo.click();
    await sleep(400);
    await page.keyboard.type(fnName, { delay: 15 });
    await sleep(700);
    await page.keyboard.press('Enter');
    await sleep(400);
  } else {
    await page.evaluate((name) => {
      const els = [...document.querySelectorAll('input, [role="combobox"]')];
      for (const el of els) {
        const label = ((el.getAttribute('aria-label') || '') + (el.placeholder || '')).toLowerCase();
        if (label.includes('function')) {
          el.focus();
          if ('value' in el) el.value = name;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, fnName);
  }

  const runBtn = page.getByRole('button', { name: /^Run$/i }).first();
  if (await runBtn.count()) await runBtn.click();
  else await page.keyboard.press('Meta+Enter');
  await sleep(3000);

  for (let i = 0; i < 5; i++) {
    const review = page.getByRole('button', { name: /Review permissions/i }).first();
    if (await review.count()) {
      await review.click();
      await sleep(2500);
      continue;
    }
    break;
  }

  const start = Date.now();
  while (Date.now() - start < 180000) {
    const body = (await page.textContent('body').catch(() => '')) || '';
    const snip = body.match(/.{0,40}(Execution completed|completed with status|EXCEPTION|Cloud logs|Error:).{0,120}/i);
    if (snip) {
      console.log('Exec:', snip[0].replace(/\s+/g, ' ').slice(0, 240));
      if (/Execution completed|completed with status/i.test(snip[0])) break;
      if (/EXCEPTION/i.test(snip[0]) && Date.now() - start > 20000) break;
    }
    await sleep(3000);
  }
}

async function main() {
  const gsCode = fs.readFileSync(GS_SOURCE, 'utf8');
  const version = (gsCode.match(/MEETING GOVERNOR (v[\d.]+)/) || [])[1] || 'unknown';
  console.log('Deploying', version, '(' + gsCode.length + ' bytes) via', CDP);
  if (REPROCESS_ROW) console.log('Will reprocess row', REPROCESS_ROW);

  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes('script.google.com')) || context.pages()[0];
  console.log('Connected:', await page.title(), page.url());

  if (!page.url().includes('script.google.com/home/projects')) {
    await page.goto(SCRIPT_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(8000);
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
  console.log('Monaco ready:', ready);
  if (!ready) {
    const hint = await page.evaluate(() => ({
      title: document.title,
      text: (document.body.innerText || '').slice(0, 600),
    }));
    throw new Error('Monaco not ready: ' + JSON.stringify(hint));
  }

  await pasteCode(page, gsCode);
  console.log('Saved', version);

  if (REPROCESS_ROW) {
    if (REPROCESS_ROW === 111) {
      await runAppsScriptFunction(page, 'mgReprocessRow111');
    } else {
      const runner = `\nfunction __mgReprocessOnce(){ return mgReprocessRequestRow(${REPROCESS_ROW}); }\n`;
      await pasteCode(page, gsCode + runner);
      await runAppsScriptFunction(page, '__mgReprocessOnce');
    }
  }

  // Disconnect without closing the Chrome process
  await browser.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
