'use strict';

const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

let _sheetsClient = null;

function loadCredentials() {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    const err = new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
    err.statusCode = 503;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error('GOOGLE_SERVICE_ACCOUNT_JSON is set but not valid JSON: ' + e.message);
    err.statusCode = 500;
    throw err;
  }
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
