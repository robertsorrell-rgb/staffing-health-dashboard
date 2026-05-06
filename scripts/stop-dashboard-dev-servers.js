#!/usr/bin/env node
'use strict';
/**
 * Free local Staffing Health dev ports (proxy + Netlify functions:serve).
 * Run from your machine: npm run stop:dev
 *
 * If you see EPERM (common from sandboxed agents): run the same command in your Mac Terminal
 * or Cursor’s integrated terminal so signals reach your user-owned Node processes.
 *
 * Alternate dev ports (avoid conflicts): `DEV_STATIC_PORT` + `DEV_FUNCTIONS_PORT` — see `dev-local-all.js`.
 */
const { execSync } = require('child_process');

const PORTS = [8886, 8887, 8888, 8889, 8890, 8891, 8892];

function pidsOnPort(port) {
  try {
    const out = execSync(`lsof -ti TCP:${port}`, { encoding: 'utf8' }).trim();
    if (!out) return [];
    return [...new Set(out.split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)))];
  } catch {
    return [];
  }
}

let killed = 0;
let eperm = 0;
const seenPid = new Set();
let foundAnyListener = false;

for (const port of PORTS) {
  for (const pid of pidsOnPort(port)) {
    if (seenPid.has(pid)) continue;
    seenPid.add(pid);
    foundAnyListener = true;
    try {
      process.kill(pid, 'SIGKILL');
      killed += 1;
      // eslint-disable-next-line no-console
      console.error(`Stopped PID ${pid} (was listening on ${port})`);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error(`Could not kill PID ${pid} on port ${port}: ${msg}`);
      if (/EPERM|permission/i.test(msg)) eperm += 1;
    }
  }
}

// eslint-disable-next-line no-console
if (eperm > 0) {
  console.error(
    `EPERM: could not signal ${eperm} process(es). Ports may still be busy — run \`npm run stop:dev\` in Terminal (Mac) or Cursor's terminal, not a restricted agent shell.`,
  );
}

if (!foundAnyListener) {
  // eslint-disable-next-line no-console
  console.error(`No listeners on ports ${PORTS.join(', ')} (already clear).`);
} else if (eperm === 0) {
  // eslint-disable-next-line no-console
  console.error(`Done — stopped ${killed} process(es); ports should be clear.`);
} else if (killed > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `Partial: stopped ${killed} process(es) but ${eperm} EPERM — some ports may still be busy.`,
  );
} else {
  // eslint-disable-next-line no-console
  console.error('Listeners remain (kill failed). Free ports manually if needed.');
}

process.exit(eperm > 0 ? 1 : 0);
