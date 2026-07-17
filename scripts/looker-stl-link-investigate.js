#!/usr/bin/env node
'use strict';
/**
 * Investigate shareable Looker URLs for STL singlestore explore.
 * Usage: node scripts/looker-stl-link-investigate.js
 */
const fs = require('fs');
const path = require('path');
const {
  lookerLogin,
  lookerGetQuery,
  lookerCreateQuery,
  lookerRunQueryJson,
  lookerRunJsonToHeaderRows,
  normalizeBaseUrl,
} = require('../netlify/functions/lib/looker-api.js');

const MODEL = 'singlestore_customer_acquisition';
const VIEW = 'contacts_w_lead_source';
const SALES_GROUPS = [
  'High School',
  'College and Grad',
  'Elementary and LD',
  'Adult Learner',
  'Prof Certs',
];

const PRIOR_QIDS = [
  'ZP5Hyq4Kwqt6xQMCfxhJF2p5VWCdRvwm',
  'fxvV8JdCxfzxKvf32R6VvtRmZSWXN6Zj',
  '65nVDK7VnSTAWT6qFrlSJJ',
  'ub6VjTCXbq2fgYXf9fRwhf',
];

function loadLookerEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    if (!k.startsWith('LOOKER_')) continue;
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

function apiVersion() {
  return String(process.env.LOOKER_API_VERSION || '4.0').trim() || '4.0';
}

async function apiGet(base, token, endpoint) {
  const url = `${normalizeBaseUrl(base)}/api/${apiVersion()}${endpoint}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `token ${token}` },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, text: text.slice(0, 800), json };
}

async function apiPost(base, token, endpoint, body) {
  const url = `${normalizeBaseUrl(base)}/api/${apiVersion()}${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, text: text.slice(0, 1200), json };
}

function validatedQueryBody() {
  return {
    model: MODEL,
    view: VIEW,
    fields: [
      'contacts_w_lead_source.created_at_date',
      'call_data.work_group_blended',
      'contacts_w_lead_source.created_at_hour_of_day',
      'call_data.time_to_first_attempt_activated_bucket_seconds',
      'contacts_w_lead_source.net_lead_count',
    ],
    filters: {
      'contacts_w_lead_source.created_at_date': '7 day ago for 7 day',
      'contacts_w_lead_source.created_at_hour_of_day': '[7,21]',
      'call_data.work_group_blended': SALES_GROUPS.join(','),
    },
    sorts: [
      'contacts_w_lead_source.created_at_date',
      'call_data.work_group_blended',
      'contacts_w_lead_source.created_at_hour_of_day',
    ],
    limit: '5000',
    query_timezone: 'America/Chicago',
  };
}

async function runCount(base, token, qid) {
  try {
    const raw = await lookerRunQueryJson(base, token, qid);
    const { rows } = lookerRunJsonToHeaderRows(raw);
    return rows.length;
  } catch (e) {
    return `ERR: ${e.message?.slice(0, 120)}`;
  }
}

async function main() {
  loadLookerEnv();
  const base = process.env.LOOKER_BASE_URL;
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  if (!base || !clientId || !clientSecret) {
    console.error('Missing LOOKER credentials');
    process.exit(1);
  }

  const token = await lookerLogin(base, clientId, clientSecret);
  const host = normalizeBaseUrl(base);

  console.log('=== Prior qids ===');
  const envQid = process.env.LOOKER_SPEED_TO_LEAD_QUERY_ID || '';
  const allQids = [...new Set([...PRIOR_QIDS, envQid].filter(Boolean))];
  for (const qid of allQids) {
    console.log(`\n--- qid ${qid} ---`);
    try {
      const q = await lookerGetQuery(base, token, qid);
      const rows = await runCount(base, token, qid);
      console.log('GET ok:', {
        id: q.id,
        slug: q.slug,
        model: q.model,
        view: q.view,
        share_url: q.share_url || '(none)',
        url: q.url || '(none)',
        client_id: q.client_id || '(none)',
        row_count: rows,
      });
      if (q.share_url) {
        const share = await apiGet(base, token, q.share_url.replace(/^.*\/api\/[^/]+/, ''));
        console.log('share_url path GET:', share.status, share.text.slice(0, 200));
      }
    } catch (e) {
      console.log('GET failed:', e.message?.slice(0, 200));
    }
  }

  console.log('\n=== Search existing Looks ===');
  for (const term of [
    'speed to lead',
    'speed-to-lead',
    'STL',
    'contacts_w_lead_source',
    'singlestore',
  ]) {
    const r = await apiGet(
      base,
      token,
      `/looks/search?title=${encodeURIComponent(term)}&fields=id,title,short_url,url,query_id,model,view_name`,
    );
    if (r.status === 200 && Array.isArray(r.json) && r.json.length) {
      console.log(`\nLooks matching "${term}":`);
      for (const look of r.json.slice(0, 8)) {
        const rows = look.query_id ? await runCount(base, token, look.query_id) : 'n/a';
        console.log({
          id: look.id,
          title: look.title,
          short_url: look.short_url,
          url: look.url,
          query_id: look.query_id,
          row_count: rows,
        });
      }
    }
  }

  console.log('\n=== Create fresh validated query ===');
  const created = await lookerCreateQuery(base, token, validatedQueryBody());
  const newQid = created.id || created.slug;
  const newRows = await runCount(base, token, newQid);
  console.log({
    qid: newQid,
    slug: created.slug,
    share_url: created.share_url,
    url: created.url,
    row_count: newRows,
  });

  const exploreUrl = `${host}/explore/${MODEL}/${VIEW}?qid=${newQid}&toggle=fil,vis`;
  console.log('Explore URL:', exploreUrl);

  console.log('\n=== Try POST /looks (saved Look) ===');
  const lookBody = {
    title: 'Staffing Health Dashboard — STL by hour × sales group (API)',
    description:
      'Auto-created for dashboard deep-link. 7d, hours 7-21 CT, CC90 sales groups.',
    query_id: newQid,
    public: true,
  };
  const lookRes = await apiPost(base, token, '/looks', lookBody);
  if (lookRes.status >= 200 && lookRes.status < 300 && lookRes.json) {
    const look = lookRes.json;
    const lookRows = look.query_id
      ? await runCount(base, token, look.query_id)
      : 'n/a';
    console.log('Look created:', {
      id: look.id,
      title: look.title,
      short_url: look.short_url,
      url: look.url,
      public_url: look.public_url,
      embed_url: look.embed_url,
      query_id: look.query_id,
      row_count: lookRows,
    });
    if (look.id) {
      console.log('Look URL:', `${host}/looks/${look.id}`);
      if (look.short_url) console.log('Look short_url:', look.short_url);
    }
  } else {
    console.log('Look create failed:', lookRes.status, lookRes.text);
  }

  console.log('\n=== Try query slug endpoint ===');
  if (created.slug) {
    const slugGet = await apiGet(base, token, `/queries/slug/${created.slug}`);
    console.log('GET /queries/slug:', slugGet.status, slugGet.text.slice(0, 300));
    const slugPost = await apiPost(base, token, `/queries/slug/${created.slug}`, {});
    console.log('POST /queries/slug:', slugPost.status, slugPost.text.slice(0, 300));
  }

  console.log('\n=== Env explore URL qid check ===');
  const exploreEnv = process.env.LOOKER_SPEED_TO_LEAD_EXPLORE_URL || '';
  if (exploreEnv) {
    const m = exploreEnv.match(/[?&]qid=([^&]+)/);
    if (m) {
      const eq = m[1];
      console.log('Env explore qid:', eq);
      try {
        const q = await lookerGetQuery(base, token, eq);
        const rows = await runCount(base, token, eq);
        console.log({ share_url: q.share_url, row_count: rows });
      } catch (e) {
        console.log('Env qid GET failed:', e.message?.slice(0, 200));
      }
    }
    console.log('Env URL (redacted qid only):', exploreEnv.replace(/qid=[^&]+/, 'qid=<see above>'));
  }

  console.log('\n=== URL format experiments (for browser) ===');
  const fields = validatedQueryBody().fields.join(',');
  console.log('fields param URL:', `${host}/explore/${MODEL}/${VIEW}?fields=${encodeURIComponent(fields)}&toggle=fil,vis`);
  if (created.share_url) {
    console.log('API share_url:', created.share_url);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
