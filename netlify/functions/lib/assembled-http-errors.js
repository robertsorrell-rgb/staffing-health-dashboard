'use strict';

/**
 * Map undici/Node `fetch` failures (often `TypeError: fetch failed`) to actionable hints.
 * Never includes secrets — only hostnames from caller-supplied URLs.
 */

function walkErrorChain(err, maxDepth = 8) {
  const out = [];
  let cur = err;
  for (let i = 0; i < maxDepth && cur; i++) {
    out.push(cur);
    cur = cur.cause;
  }
  return out;
}

function firstErrorCode(chain) {
  for (const e of chain) {
    if (e && e.code) return String(e.code);
  }
  const head = chain[0];
  if (head && head.name === 'AggregateError' && Array.isArray(head.errors)) {
    for (const inner of head.errors) {
      if (inner && inner.code) return String(inner.code);
    }
  }
  return '';
}

function classifyFetchFailure(err) {
  const chain = walkErrorChain(err);
  const msgs = chain
    .map((e) => (e && e.message ? String(e.message) : ''))
    .filter(Boolean)
    .join(' | ');
  const code = firstErrorCode(chain);
  const blob = `${code} ${msgs}`.toLowerCase();

  let hint =
    'Verify ASSEMBLED_API_BASE (default https://api.assembledhq.com/v0), DNS, and HTTPS egress from this runtime.';
  if (code === 'ENOTFOUND' || blob.includes('getaddrinfo enotfound')) {
    hint =
      'DNS lookup failed for the API host — check ASSEMBLED_API_BASE hostname spelling and that resolvers work from this environment.';
  } else if (code === 'ECONNREFUSED') {
    hint = 'Connection refused — wrong host/port, firewall, or TLS intercept blocking the path.';
  } else if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    hint = 'Connection timed out — transient network issue or restrictive outbound rules.';
  } else if (blob.includes('certificate') || blob.includes('ssl') || blob.includes('tls')) {
    hint = 'TLS handshake failed — proxy, wrong URL scheme (https), or system clock skew.';
  } else if (msgs.toLowerCase().includes('fetch failed')) {
    hint =
      'Fetch failed before any HTTP response — common when outbound HTTPS is blocked (CI sandbox, air‑gapped machine). Netlify Functions need public egress; locally run smoke/tests with network enabled.';
  }

  return { code: code || undefined, hint, chainSummary: msgs.slice(0, 240) };
}

/**
 * @param {string} urlStr
 * @param {string} label short label e.g. `GET /sites` or `POST /graphql`
 * @param {unknown} fetchErr
 */
function transportError(urlStr, label, fetchErr) {
  const { code, hint } = classifyFetchFailure(fetchErr);
  let host = '';
  try {
    host = new URL(urlStr).hostname;
  } catch {
    host = '(invalid URL)';
  }
  const summary = code ? `${label} (${code})` : `${label} (network)`;
  const err = new Error(`Assembled unreachable: ${summary}`);
  err.statusCode = 503;
  err.hint = host ? `${hint} Host: ${host}.` : hint;
  err.detailCode = code;
  return err;
}

/** Codes where Capacity Pull sheet fallback is reasonable (no HTTP response from Assembled). */
const TRANSPORT_FALLBACK_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'EAI_AGAIN',
]);

/**
 * True when Assembled `fetch` failed before a useful HTTP response (DNS, TLS, timeout, etc.).
 * Used by net-staffing to optionally fall back to Capacity Pull.
 * @param {unknown} err
 */
function isAssembledTransportFailure(err) {
  if (!err || typeof err !== 'object') return false;
  const dc = err.detailCode && String(err.detailCode);
  if (dc && TRANSPORT_FALLBACK_CODES.has(dc)) return true;
  const { code } = classifyFetchFailure(err);
  if (code && TRANSPORT_FALLBACK_CODES.has(code)) return true;
  if (/Assembled unreachable:/i.test(String(err.message || ''))) return true;
  return false;
}

module.exports = { classifyFetchFailure, transportError, isAssembledTransportFailure };
