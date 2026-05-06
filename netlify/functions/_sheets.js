'use strict';

const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

let _sheetsClient = null;

/** True when value looks like a GCP service account key object. */
function isServiceAccountObject(o) {
  return !!(o && typeof o === 'object' && o.type === 'service_account');
}

/** Normalize SA JSON from Netlify/UI/.env paste accidents (BOM, key prefix, quotes, smart quotes, double-encoding). */
function parseServiceAccountJson(raw) {
  let s = String(raw || '').trim();
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1).trim();

  s = s.replace(/^GOOGLE_SERVICE_ACCOUNT_JSON\s*=\s*/i, '').trim();

  // Curly/smart quotes pasted from editors
  s = s.replace(/[\u201c\u201d\u201e\u201f]/g, '"').replace(/[\u2018\u2019]/g, "'");

  // Netlify CLI / dotenv double-quoted lines can surface as `{\"type\":...}` (column 2 is `\`), which is not valid JSON.
  // Structural `\"` → `"` is safe for standard service-account keys (no `\"` inside PEM text).
  if (s.startsWith('{') && s[1] === '\\' && s[2] === '"') {
    s = s.replace(/\\"/g, '"');
  }

  const candidates = [];
  const add = (x) => {
    const t = String(x || '').trim();
    if (t && !candidates.includes(t)) candidates.push(t);
  };
  add(s);
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) add(s.slice(1, -1).trim());
  }

  let lastParseError = /** @type {Error | null} */ (null);
  for (const cand of candidates) {
    let v = cand;
    for (let depth = 0; depth < 8; depth++) {
      let p;
      try {
        p = JSON.parse(v);
      } catch (e) {
        lastParseError = e;
        break;
      }
      if (isServiceAccountObject(p)) return p;
      if (typeof p === 'string') {
        v = p.trim();
        if (!v.startsWith('{')) {
          lastParseError = new Error('Expected JSON object after decoding string layer');
          break;
        }
        continue;
      }
      lastParseError = new Error('JSON parsed but is not a service_account object');
      break;
    }
  }

  const peek = s.slice(0, 24).replace(/[^\x20-\x7e]/g, '?');
  const hint =
    peek.charAt(0) !== '{'
      ? ' Use the raw JSON key file, or run: node scripts/bootstrap-local-env.js path/to/key.json'
      : '';
  const err = new Error(
    `GOOGLE_SERVICE_ACCOUNT_JSON is set but not valid JSON: ${(lastParseError && lastParseError.message) || 'parse failed'}.${hint}`
  );
  err.statusCode = 500;
  throw err;
}

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!String(raw).trim()) {
    const err = new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
    err.statusCode = 503;
    throw err;
  }
  return parseServiceAccountJson(raw);
}

function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

async function getSheetValues(spreadsheetId, range, options = {}) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    ...options,
  });
  return res.data.values || [];
}

function parseSheetNumber(cell) {
  if (cell == null || cell === '') return null;
  const n = Number(String(cell).trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a sheet cell to YYYY-MM-DD in America/Chicago.
 * Sheets serial datetimes must use the full fractional day and Chicago wall date
 * (floor-to-UTC was off-by-one vs CT for evening timestamps).
 */
function normalizeDateCell(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const epochUtcMs = Date.UTC(1899, 11, 30);
    const ms = epochUtcMs + cell * 86400000;
    return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  }
  const s = String(cell).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (iso) return iso[1];
  const mdyTime = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+|$)/);
  if (mdyTime) {
    const mo = mdyTime[1].padStart(2, '0');
    const da = mdyTime[2].padStart(2, '0');
    return `${mdyTime[3]}-${mo}-${da}`;
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mo = m[1].padStart(2, '0');
    const da = m[2].padStart(2, '0');
    return `${m[3]}-${mo}-${da}`;
  }
  // Handle textual month formats used by some automation logs, e.g.
  // "May 5th, 2026 at 9:17 AM CDT" or "May 5, 2026 9:17 AM".
  const cleaned = s
    .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
    .replace(/\bat\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parsedMs = Date.parse(cleaned);
  if (Number.isFinite(parsedMs)) {
    return new Date(parsedMs).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  }
  return null;
}

const JSON_HEADERS_BASE = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function jsonResponse(body, maxAgeSeconds = 120) {
  return {
    statusCode: 200,
    headers: {
      ...JSON_HEADERS_BASE,
      'Cache-Control': `private, max-age=${maxAgeSeconds}`,
    },
    body: JSON.stringify(body),
  };
}

function ok(body, maxAgeSeconds) {
  return jsonResponse(body, maxAgeSeconds != null ? maxAgeSeconds : 120);
}

function bad(message, statusCode = 400) {
  return { statusCode, headers: JSON_HEADERS_BASE, body: JSON.stringify({ error: message }) };
}

function errorResponse(err, label) {
  const status = err && err.statusCode ? err.statusCode : 500;
  const message = err && err.message ? err.message : 'Unknown error';
  // eslint-disable-next-line no-console
  console.error(`[${label || 'function'}] ${status} — ${message}`);
  return { statusCode: status, headers: JSON_HEADERS_BASE, body: JSON.stringify({ error: message }) };
}

function handleOptions(event) {
  if (event && event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: JSON_HEADERS_BASE, body: '' };
  }
  return null;
}

module.exports = {
  getSheetsClient,
  getSheetValues,
  parseSheetNumber,
  normalizeDateCell,
  ok,
  bad,
  errorResponse,
  handleOptions,
};
