'use strict';

/**
 * Minimal Looker API 4.0 client for running saved queries or looks as JSON.
 * @see https://cloud.google.com/looker/docs/reference/api-and-sdk
 */

const DEFAULT_API_VERSION = '4.0';

/** @type {{ token: string, until: number }} */
let tokenCache = { token: '', until: 0 };

function apiVersion() {
  const v = String(process.env.LOOKER_API_VERSION || DEFAULT_API_VERSION).trim();
  return v || DEFAULT_API_VERSION;
}

function normalizeBaseUrl(base) {
  return String(base || '')
    .trim()
    .replace(/\/$/, '');
}

/**
 * @returns {Promise<string>}
 */
async function lookerLogin(baseUrl, clientId, clientSecret) {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.until - 10_000) {
    return tokenCache.token;
  }

  const root = normalizeBaseUrl(baseUrl);
  const url = `${root}/api/${apiVersion()}/login`;
  const body = new URLSearchParams();
  body.set('client_id', String(clientId).trim());
  body.set('client_secret', String(clientSecret).trim());

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(
      `Looker login failed (${res.status}): ${text.slice(0, 400)}`
    );
    err.statusCode = res.status === 401 || res.status === 403 ? res.status : 502;
    throw err;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error('Looker login returned non-JSON');
    err.statusCode = 502;
    throw err;
  }

  const token = data.access_token;
  if (!token) {
    const err = new Error('Looker login: no access_token in response');
    err.statusCode = 502;
    throw err;
  }

  const expSec = Number(data.expires_in);
  const ttlMs = (Number.isFinite(expSec) ? expSec * 1000 : 3600 * 1000) - 120_000;
  tokenCache = { token, until: now + Math.max(60_000, ttlMs) };
  return token;
}

/**
 * @param {string} baseUrl
 * @param {string} token
 * @param {string|number} queryId
 * @returns {Promise<unknown>}
 */
/**
 * @param {string} baseUrl
 * @param {string} token
 * @param {string|number} queryId
 * @returns {Promise<Record<string, unknown>>}
 */
async function lookerGetQuery(baseUrl, token, queryId) {
  const root = normalizeBaseUrl(baseUrl);
  const id = encodeURIComponent(String(queryId).trim());
  const url = `${root}/api/${apiVersion()}/queries/${id}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `token ${token}` },
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Looker query ${id} GET failed (${res.status}): ${text.slice(0, 500)}`);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('Looker query GET returned non-JSON');
    err.statusCode = 502;
    throw err;
  }
}

/**
 * Create a new query (immutable writes — returns existing identical query when deduped).
 * @param {string} baseUrl
 * @param {string} token
 * @param {Record<string, unknown>} writeQueryBody
 * @returns {Promise<Record<string, unknown>>}
 */
async function lookerCreateQuery(baseUrl, token, writeQueryBody) {
  const root = normalizeBaseUrl(baseUrl);
  const url = `${root}/api/${apiVersion()}/queries`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(writeQueryBody),
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Looker create query failed (${res.status}): ${text.slice(0, 700)}`);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('Looker create query returned non-JSON');
    err.statusCode = 502;
    throw err;
  }
}

async function lookerRunQueryJson(baseUrl, token, queryId) {
  const root = normalizeBaseUrl(baseUrl);
  const id = encodeURIComponent(String(queryId).trim());
  const url = `${root}/api/${apiVersion()}/queries/${id}/run/json`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `token ${token}` },
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(
      `Looker query ${id} run failed (${res.status}): ${text.slice(0, 500)}`
    );
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Looker query run returned non-JSON');
    err.statusCode = 502;
    throw err;
  }
}

/**
 * @param {string} baseUrl
 * @param {string} token
 * @param {string|number} lookId
 * @returns {Promise<unknown>}
 */
async function lookerRunLookJson(baseUrl, token, lookId) {
  const root = normalizeBaseUrl(baseUrl);
  const id = encodeURIComponent(String(lookId).trim());
  const url = `${root}/api/${apiVersion()}/looks/${id}/run/json`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `token ${token}` },
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(
      `Looker look ${id} run failed (${res.status}): ${text.slice(0, 500)}`
    );
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('Looker look run returned non-JSON');
    err.statusCode = 502;
    throw err;
  }
}

/**
 * Turn Looker `run/json` payload into { headers, rows } (string cell matrix).
 * @param {unknown} data
 * @returns {{ headers: string[], rows: any[][] }}
 */
function lookerRunJsonToHeaderRows(data) {
  if (data == null) return { headers: [], rows: [] };

  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const keys = Object.keys(first);
      const headers = keys.map((k) => String(k).trim());
      const rows = data.map((obj) => keys.map((k) => (obj && typeof obj === 'object' ? obj[k] : null)));
      return { headers, rows };
    }
    if (Array.isArray(first)) {
      const headers = (first || []).map((c) => String(c ?? '').trim());
      const rows = data.slice(1);
      return { headers, rows };
    }
  }

  return { headers: [], rows: [] };
}

module.exports = {
  lookerLogin,
  lookerGetQuery,
  lookerCreateQuery,
  lookerRunQueryJson,
  lookerRunLookJson,
  lookerRunJsonToHeaderRows,
  normalizeBaseUrl,
};
