#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const {
  lookerLogin,
  lookerGetQuery,
  lookerCreateQuery,
  lookerRunQueryJson,
  lookerRunJsonToHeaderRows,
} = require('../netlify/functions/lib/looker-api.js');

const DATE = process.env.DATE_FILTER || '7 day ago for 7 day';

function loadEnv() {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}

async function run(token, base, body) {
  const c = await lookerCreateQuery(base, token, body);
  const raw = await lookerRunQueryJson(base, token, c.id || c.slug);
  const { headers, rows } = lookerRunJsonToHeaderRows(raw);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const netKey = headers.find((h) => /net_lead|contact_count|count/.test(h)) || headers[0];
  const sKey = headers.find((h) => h === 's' || /0.?30|30.?sec/i.test(h));
  const net = rows.reduce((s, r) => s + Number(r[idx[netKey]] ?? 0), 0);
  const s30 = sKey ? rows.reduce((s, r) => s + Number(r[idx[sKey]] ?? 0), 0) : null;
  return { net, s30, rows: rows.length, qid: c.id || c.slug };
}

async function main() {
  loadEnv();
  const base = process.env.LOOKER_BASE_URL;
  const token = await lookerLogin(base, process.env.LOOKER_CLIENT_ID, process.env.LOOKER_CLIENT_SECRET);
  const orig = await lookerGetQuery(base, token, 'ub6VjTCXbq2fgYXf9fRwhf');

  const baseBody = {
    model: orig.model,
    view: orig.view,
    fields: ['contacts.net_leads', 's', 's_1'],
    filters: { 'contacts.created_date': DATE },
    limit: '500',
    dynamic_fields: orig.dynamic_fields,
    query_timezone: 'America/Chicago',
  };

  console.log(`Date: ${DATE}\n=== Cumulative filter impact (marketing/contacts) ===`);
  const cum = { 'contacts.created_date': DATE };
  for (const [name, f] of [
    ['created_hour 7-21', { 'contacts.created_hour_of_day': '[7,21]' }],
    ['valid_lead Yes', { 'contacts.valid_lead': 'Yes' }],
    ['spam No', { 'contacts.spam': 'No' }],
    ['business VT Core,Intl,Prof', { 'contacts_base.business': 'VT Core,International,Prof Certs' }],
    ['country US,Canada', { 'contacts_base.country_region': 'Canada,French Canada,US' }],
    ['lead_type -Overnight', { 'contacts_base.lead_type': '-Overnight' }],
    ['lead_source -Tutors', { 'contacts.lead_source': '-Tutors.com' }],
    ['tags exclude DNC/B2B/etc', { 'tags.name': '-%DNC%,-%ROW%,-%B2B%,-%VT4S%,-%Blocked%' }],
    ['first_attempt not Inbound', { 'contact_first_attempt.time_to_first_attempt_activated_bucket_seconds': '-I) Inbound' }],
    ['local hour 8-20', { 'contacts.contact_local_created_at_hour_of_day': '[8,20]' }],
    ['b2b_instant No', { 'clients.b2b_instant_only_flag': 'No' }],
  ]) {
    Object.assign(cum, f);
    const r = await run(token, base, { ...baseBody, filters: { ...cum } });
    const pct = r.net && r.s30 != null ? `${((100 * r.s30) / r.net).toFixed(1)}%` : 'n/a';
    console.log(`${name.padEnd(30)} leads=${String(r.net).padStart(7)}  0-30s=${String(r.s30 ?? 'n/a').padStart(7)}  pct=${pct}`);
  }

  console.log('\n=== Drop one filter from ORIGINAL set ===');
  const origFilters = { ...orig.filters, 'contacts.created_date': DATE };
  const rAll = await run(token, base, { ...baseBody, filters: origFilters });
  console.log(`ALL original filters       leads=${rAll.net}  0-30s=${rAll.s30}  pct=${rAll.net ? ((100 * rAll.s30) / rAll.net).toFixed(1) + '%' : 'n/a'}`);

  for (const drop of Object.keys(orig.filters)) {
    const f = { ...origFilters };
    delete f[drop];
    const r = await run(token, base, { ...baseBody, filters: f });
    if (r.net > rAll.net * 1.5 || (r.s30 > 0 && rAll.s30 === 0)) {
      console.log(`DROP ${drop.padEnd(55)} leads=${String(r.net).padStart(7)}  0-30s=${String(r.s30).padStart(7)}  pct=${r.net ? ((100 * r.s30) / r.net).toFixed(1) + '%' : 'n/a'}`);
    }
  }

  // Saved STL query from dashboard
  const stlQid = process.env.LOOKER_SPEED_TO_LEAD_QUERY_ID;
  if (stlQid) {
    console.log('\n=== Saved LOOKER_SPEED_TO_LEAD_QUERY_ID ===');
    const sq = await lookerGetQuery(base, token, stlQid);
    console.log('model/view:', sq.model, sq.view);
    console.log('fields:', sq.fields?.join(', '));
    console.log('filters:', JSON.stringify(sq.filters));
    const sb = {
      ...sq,
      filters: { ...(sq.filters || {}), [Object.keys(sq.filters || {}).find((k) => /date/i.test(k)) || 'contacts_w_lead_source.created_at_date']: DATE },
    };
    delete sb.id;
    delete sb.client_id;
    delete sb.slug;
    delete sb.share_url;
    const r = await run(token, base, sb);
    console.log(`7d with date swapped leads=${r.net} rows=${r.rows} qid=${r.qid}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
