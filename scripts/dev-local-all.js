#!/usr/bin/env node
'use strict';
/**
 * One command for local dashboard + real APIs: starts netlify functions:serve, then the static proxy.
 * Forces local handlers only (ignores DASHBOARD_API_ORIGIN / local-dashboard-dev.json).
 *
 * Usage: npm start
 *
 * Ports: `DEV_STATIC_PORT` (default 8888, UI + proxy) and `DEV_FUNCTIONS_PORT` (default 8889).
 * If 8889 is stuck: `DEV_FUNCTIONS_PORT=8890 npm start` or `npm run start:8890`.
 */
const { spawn, execSync } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FN_PORT = parseInt(process.env.DEV_FUNCTIONS_PORT || '8889', 10);
const STATIC_PORT = parseInt(process.env.DEV_STATIC_PORT || '8888', 10);

function waitForPort(port, timeoutMs = 120000) {
  const host = '127.0.0.1';
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.connect({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port} (netlify functions:serve)`));
        } else {
          setTimeout(attempt, 350);
        }
      });
    }
    attempt();
  });
}

/** Wait until nothing is listening on `port` (same binding style as dev-dashboard-proxy: all interfaces). */
function waitUntilListenFree(port, timeoutMs = 45000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryBind() {
      const srv = net.createServer();
      srv.on('error', (err) => {
        try {
          srv.close();
        } catch (_) {}
        if (err && err.code === 'EADDRINUSE') {
          if (Date.now() - start > timeoutMs) {
            reject(
              new Error(
                `Port ${port} is still in use — stop the other process (e.g. npm run start:remote or Python http.server) and retry.`
              )
            );
          } else setTimeout(tryBind, 280);
        } else reject(err);
      });
      srv.listen(port, () => {
        srv.close(() => resolve());
      });
    }
    tryBind();
  });
}

async function ensureListenPortFree(port, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await waitUntilListenFree(port);
      return;
    } catch (e) {
      lastErr = e;
      try {
        execSync(`lsof -ti TCP:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 1200 + i * 400));
    }
  }
  try {
    // eslint-disable-next-line no-console
    console.error(`Still busy on port ${port}. Holder(s):`);
    execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true`, { stdio: 'inherit' });
  } catch (_) {}
  throw lastErr;
}

let fnProc = null;
let proxyProc = null;

function shutdown(signal) {
  if (proxyProc && !proxyProc.killed) try { proxyProc.kill(signal || 'SIGTERM'); } catch (_) {}
  if (fnProc && !fnProc.killed) try { fnProc.kill(signal || 'SIGTERM'); } catch (_) {}
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
  process.exit(0);
});

(async () => {
  const reclaimRaw = String(process.env.DEV_LOCAL_RECLAIM_PORT ?? '1').toLowerCase();
  const reclaim =
    process.platform !== 'win32' &&
    reclaimRaw !== '0' &&
    reclaimRaw !== 'false' &&
    reclaimRaw !== 'no';
  if (reclaim) {
    for (const p of [STATIC_PORT, FN_PORT]) {
      try {
        execSync(`lsof -ti TCP:${p} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
      } catch (_) {
        /* ignore */
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // eslint-disable-next-line no-console
  console.error('Starting netlify functions:serve on port ' + FN_PORT + '…');

  const fnEnv = {
    ...process.env,
    NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=8192',
    /** Reduce native file watchers — avoids EMFILE on macOS default limits with Netlify CLI. */
    CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING || '1',
    CHOKIDAR_INTERVAL: process.env.CHOKIDAR_INTERVAL || '800',
  };

  if (process.platform === 'win32') {
    fnProc = spawn(
      'npx',
      [
        '--yes',
        'netlify',
        'functions:serve',
        '--offline',
        '-f',
        'netlify/functions',
        '-p',
        String(FN_PORT),
      ],
      { cwd: ROOT, stdio: 'inherit', env: fnEnv }
    );
  } else {
    const inner = `ulimit -n 10240 2>/dev/null || ulimit -n 8192 2>/dev/null || true; exec npx --yes netlify functions:serve --offline -f netlify/functions -p ${FN_PORT}`;
    fnProc = spawn('/bin/bash', ['-lc', inner], {
      cwd: ROOT,
      stdio: 'inherit',
      env: fnEnv,
    });
  }

  fnProc.on('exit', (code, sig) => {
    if (sig === 'SIGINT' || sig === 'SIGTERM') process.exit(0);
    // eslint-disable-next-line no-console
    console.error(`\nnetlify functions:serve exited (code ${code}).`);
    shutdown('SIGTERM');
    process.exit(code === null || code === undefined ? 1 : code);
  });

  try {
    await ensureListenPortFree(STATIC_PORT);
    await waitForPort(FN_PORT);
    await ensureListenPortFree(STATIC_PORT);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e.message || e);
    shutdown('SIGTERM');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.error(
    `\nFunctions listening on ${FN_PORT}. Starting dashboard proxy on ${STATIC_PORT} (local APIs — production origin from .env is ignored).\n`
  );

  proxyProc = spawn('node', [path.join(ROOT, 'scripts', 'dev-dashboard-proxy.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      DEV_STATIC_PORT: String(STATIC_PORT),
      DEV_FUNCTIONS_PORT: String(FN_PORT),
      DASHBOARD_FORCE_LOCAL_API: '1',
      DASHBOARD_API_ORIGIN: '',
    },
  });

  proxyProc.on('exit', (code) => {
    shutdown('SIGTERM');
    process.exit(code ?? 0);
  });
})().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  shutdown('SIGTERM');
  process.exit(1);
});
