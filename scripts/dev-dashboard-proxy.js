#!/usr/bin/env node
'use strict';
/**
 * Static file server + /api/* proxied to either:
 *
 * 1) Production (no Netlify CLI): set DASHBOARD_API_ORIGIN=https://your-site.netlify.app
 *    (repo-root `.env`, or **`local-dashboard-dev.json`** — see `local-dashboard-dev.example.json`).
 *    Same-origin browser calls `/api/*` → forwarded to production → real JSON.
 *
 * 2) Local functions: omit DASHBOARD_API_ORIGIN; point at `netlify functions:serve`:
 *   Terminal A: npx netlify functions:serve -f netlify/functions -p 8889
 *   Terminal B: node scripts/dev-dashboard-proxy.js
 *
 * Or run **`npm start`** from the repo root — it starts functions + this proxy together and sets
 * **`DASHBOARD_FORCE_LOCAL_API`** so `.env` / local-dashboard-dev.json production origins are ignored.
 *
 * Env: DEV_STATIC_PORT (default 8888), DEV_FUNCTIONS_PORT (default 8889), DASHBOARD_FORCE_LOCAL_API
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = parseInt(process.env.DEV_STATIC_PORT || '8888', 10);
const FN_PORT = parseInt(process.env.DEV_FUNCTIONS_PORT || '8889', 10);

const DASHBOARD_FORCE_LOCAL_API = ['1', 'true', 'yes'].includes(
  String(process.env.DASHBOARD_FORCE_LOCAL_API || '').toLowerCase()
);

/** Read env at call time so `npm start` cannot accidentally hit production if something sets `DASHBOARD_API_ORIGIN` later. */
function shouldProxyApiToProduction() {
  const forceLocal = ['1', 'true', 'yes'].includes(
    String(process.env.DASHBOARD_FORCE_LOCAL_API || '').toLowerCase()
  );
  if (forceLocal) return false;
  const origin = process.env.DASHBOARD_API_ORIGIN;
  return Boolean(origin && String(origin).trim());
}

function loadDashboardApiOriginFromDotEnv() {
  if (process.env.DASHBOARD_API_ORIGIN) return;
  const fp = path.join(ROOT, '.env');
  try {
    const text = fs.readFileSync(fp, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      if (key !== 'DASHBOARD_API_ORIGIN') continue;
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env.DASHBOARD_API_ORIGIN = val;
      break;
    }
  } catch (_) {
    /* no .env */
  }
}

function loadDashboardApiOriginFromLocalDevJson() {
  if (process.env.DASHBOARD_API_ORIGIN && String(process.env.DASHBOARD_API_ORIGIN).trim()) return;
  const fp = path.join(ROOT, 'local-dashboard-dev.json');
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const o = j.dashboardApiOrigin || j.DASHBOARD_API_ORIGIN;
    if (o && String(o).trim()) process.env.DASHBOARD_API_ORIGIN = String(o).trim();
  } catch (_) {
    /* optional file */
  }
}

if (DASHBOARD_FORCE_LOCAL_API) {
  delete process.env.DASHBOARD_API_ORIGIN;
} else {
  loadDashboardApiOriginFromDotEnv();
  loadDashboardApiOriginFromLocalDevJson();
}

function filterHopByHopHeaders(raw, hostHeader) {
  const skip = new Set([
    'connection',
    'keep-alive',
    'proxy-connection',
    'transfer-encoding',
    'host',
  ]);
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (skip.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  out.host = hostHeader;
  return out;
}

function mimeFor(fp) {
  const ext = path.extname(fp).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  };
  return map[ext] || 'application/octet-stream';
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const base = decoded.replace(/^\/+/, '') || 'index.html';
  const fp = path.normalize(path.join(root, base));
  if (!fp.startsWith(root)) return null;
  return fp;
}

function serveStatic(urlPath, res) {
  let fp = safeJoin(ROOT, urlPath === '/' ? '/index.html' : urlPath);
  if (!fp) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      const fb = path.join(ROOT, 'index.html');
      fs.readFile(fb, (e2, buf) => {
        if (e2) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buf);
      });
      return;
    }
    fs.readFile(fp, (e, buf) => {
      if (e) {
        res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeFor(fp) });
      res.end(buf);
    });
  });
}

function proxyApiToProduction(apiOrigin, url, req, res) {
  let originOnly;
  try {
    originOnly = new URL(apiOrigin).origin;
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Invalid DASHBOARD_API_ORIGIN (must be a full URL)' }));
    return;
  }
  const targetUrl = new URL(url.pathname + url.search, originOnly);
  const isHttps = targetUrl.protocol === 'https:';
  const lib = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : 80;
  const port = targetUrl.port ? parseInt(targetUrl.port, 10) : defaultPort;
  const opts = {
    hostname: targetUrl.hostname,
    port,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: filterHopByHopHeaders(req.headers, targetUrl.host),
  };
  const p = lib.request(opts, (pr) => {
    const headers = { ...pr.headers };
    delete headers['transfer-encoding'];
    res.writeHead(pr.statusCode || 502, headers);
    pr.pipe(res);
  });
  p.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message }));
  });
  req.pipe(p);
}

function proxyApiToLocalFunctions(url, req, res) {
  const match = url.pathname.match(/^\/api\/([^/?]+)/);
  if (!match) {
    res.writeHead(404);
    res.end();
    return;
  }
  const fnPath = `/.netlify/functions/${match[1]}${url.search || ''}`;
  const opts = {
    hostname: '127.0.0.1',
    port: FN_PORT,
    path: fnPath,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${FN_PORT}` },
  };
  const p = http.request(opts, (pr) => {
    const headers = { ...pr.headers };
    delete headers['transfer-encoding'];
    res.writeHead(pr.statusCode || 502, headers);
    pr.pipe(res);
  });
  p.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: err.message }));
  });
  req.pipe(p);
}

function proxyApi(url, req, res) {
  if (shouldProxyApiToProduction()) {
    proxyApiToProduction(String(process.env.DASHBOARD_API_ORIGIN).trim(), url, req, res);
  } else {
    proxyApiToLocalFunctions(url, req, res);
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${STATIC_PORT}`);
    if (url.pathname.startsWith('/api/')) proxyApi(url, req, res);
    else serveStatic(url.pathname, res);
  })
  .listen(STATIC_PORT, () => {
    // eslint-disable-next-line no-console
    console.error(`Open http://127.0.0.1:${STATIC_PORT}`);
    const po = process.env.DASHBOARD_API_ORIGIN;
    if (DASHBOARD_FORCE_LOCAL_API) {
      // eslint-disable-next-line no-console
      console.error(
        `Proxy /api → http://127.0.0.1:${FN_PORT}/.netlify/functions/* (local only — DASHBOARD_FORCE_LOCAL_API)`,
      );
    } else if (po && String(po).trim()) {
      // eslint-disable-next-line no-console
      console.error(`Proxy /api/* → production ${String(po).trim()}`);
    } else {
      // eslint-disable-next-line no-console
      console.error(`Proxy /api → http://127.0.0.1:${FN_PORT}/.netlify/functions/*`);
      // eslint-disable-next-line no-console
      console.error(
        'Tip: use npm run start:remote with DASHBOARD_API_ORIGIN in .env to proxy APIs to Netlify without running functions locally.',
      );
      // eslint-disable-next-line no-console
      console.error('Or run: npm run dev:functions (port ' + FN_PORT + ') before this proxy.');
    }
  });
