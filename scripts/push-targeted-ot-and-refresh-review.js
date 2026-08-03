#!/usr/bin/env node
'use strict';
/** Wrapper → shift-optimizer deploy script (same Chrome profile). */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, '..', '..', '..', 'Projects', 'shift-optimizer', 'scripts', 'push-targeted-ot-and-refresh-review.js');
const gs = path.join(__dirname, '..', 'apps-script', 'targeted-ot-bot.gs');

const child = spawn(process.execPath, [script, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, OT_GS_FILE: gs },
});
child.on('exit', (code) => process.exit(code ?? 1));
