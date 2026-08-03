#!/usr/bin/env node
'use strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(process.env.HOME, 'Projects', 'shift-optimizer', 'scripts', 'refresh-targeted-ot-review-menu.js');
spawn(process.execPath, [script], { stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 1));
