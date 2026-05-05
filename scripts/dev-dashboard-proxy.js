#!/usr/bin/env node
'use strict';
/**
 * Static file server + /api/* → Netlify functions dev server (no file-watcher).
 *
 * Use when `netlify dev` hits EMFILE on your machine:
 *   Terminal A: npx netlify functions:serve -f netlify/functions -p 8889
 *   Terminal B: node scripts/dev-dashboard-proxy.js
 *   Open http://127.0.0.1:8080
 *
 * Env: DEV_STATIC_PORT (default 8080), DEV_FUNCTIONS_PORT (default 8889)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = parseInt(process.env.DEV_STATIC_PORT || '8080', 10);
const FN_PORT = parseInt(process.env.DEV_FUNCTIONS_PORT || '8889', 10);

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

function proxyApi(url, req, res) {
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

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${STATIC_PORT}`);
    if (url.pathname.startsWith('/api/')) proxyApi(url, req, res);
    else serveStatic(url.pathname, res);
  })
  .listen(STATIC_PORT, () => {
    // eslint-disable-next-line no-console
    console.error(`Open http://127.0.0.1:${STATIC_PORT}`);
    // eslint-disable-next-line no-console
    console.error(`Proxy /api → http://127.0.0.1:${FN_PORT}/.netlify/functions/*`);
    // eslint-disable-next-line no-console
    console.error('Requires: netlify functions:serve -f netlify/functions -p ' + FN_PORT);
  });
