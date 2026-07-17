#!/usr/bin/env node
'use strict';
/**
 * Speed-to-lead by hour × CC90 sales group from the singlestore explore
 * (the marketing/contacts explore has broken/missing recent first-attempt data).
 *
 * Usage:
 *   node scripts/looker-stl-by-hour-sales-group-singlestore.js
 *   DATE_FILTER="7 day ago for 7 day" node scripts/looker-stl-by-hour-sales-group-singlestore.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  lookerLogin,
  lookerCreateQuery,
  lookerRunQueryJson,
  lookerRunJsonToHeaderRows,
} = require('../netlify/functions/lib/looker-api.js');

const MODEL = 'singlestore_customer_acquisition';
const VIEW = 'contacts_w_lead_source';
const DATE_FILTER = process.env.DATE_FILTER || '7 day ago for 7 day';
const HOUR_FILTER = process.env.HOUR_FILTER || '[7,21]';
const OUT_CSV =
  process.env.OUT_CSV ||
  path.join(os.homedir(), 'Downloads', 'stl_by_hour_sales_group_last7d.csv');

/** CC90 consumer sales groups (matches VCPU / Assembled queue tabs). */
const SALES_GROUPS = [
  'High School',
  'College and Grad',
  'Elementary and LD',
  'Adult Learner',
  'Prof Certs',
];

const WITHIN_30S = new Set(['B) 30 seconds']);
const WITHIN_60S = new Set(['B) 30 seconds', 'C) 1 minute']);

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

function pct(n, d) {
  if (!d) return 'n/a';
  return `${((100 * n) / d).toFixed(1)}%`;
}

function cellPct(n, d) {
  if (!d) return 'n/a';
  return `${((100 * n) / d).toFixed(1)}%`;
}

async function main() {
  loadLookerEnv();
  const base = process.env.LOOKER_BASE_URL;
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  if (!base || !clientId || !clientSecret) {
    console.error('Missing LOOKER_* credentials in .env');
    process.exit(1);
  }

  const token = await lookerLogin(base, clientId, clientSecret);
  const body = {
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
      'contacts_w_lead_source.created_at_date': DATE_FILTER,
      'contacts_w_lead_source.created_at_hour_of_day': HOUR_FILTER,
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

  const created = await lookerCreateQuery(base, token, body);
  const qid = created.id || created.slug;
  console.log(
    `Looker explore: https://varsitytutors.looker.com/explore/${MODEL}/${VIEW}?qid=${qid}`,
  );
  console.log(`Model: ${MODEL}/${VIEW}`);
  console.log(`Date: ${DATE_FILTER} | Hours: ${HOUR_FILTER} CT\n`);

  const raw = await lookerRunQueryJson(base, token, qid);
  const { headers, rows } = lookerRunJsonToHeaderRows(raw);
  const idx = {
    date: headers.indexOf('contacts_w_lead_source.created_at_date'),
    group: headers.indexOf('call_data.work_group_blended'),
    hour: headers.indexOf('contacts_w_lead_source.created_at_hour_of_day'),
    bucket: headers.indexOf('call_data.time_to_first_attempt_activated_bucket_seconds'),
    net: headers.indexOf('contacts_w_lead_source.net_lead_count'),
  };

  /** date → group → hour → { net, s30, s60 } */
  const grid = new Map();
  for (const r of rows) {
    const date = String(r[idx.date] ?? '').trim();
    const group = String(r[idx.group] ?? '').trim();
    const hour = String(r[idx.hour] ?? '').trim();
    const bucket = String(r[idx.bucket] ?? '').trim();
    const n = Number(r[idx.net] ?? 0);
    if (!date || !group || !hour || !n) continue;
    const key = `${date}\0${group}\0${hour}`;
    if (!grid.has(key)) grid.set(key, { date, group, hour, net: 0, s30: 0, s60: 0 });
    const cell = grid.get(key);
    cell.net += n;
    if (WITHIN_30S.has(bucket)) cell.s30 += n;
    if (WITHIN_60S.has(bucket)) cell.s60 += n;
  }

  const cells = [...grid.values()].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d) return d;
    const g =
      SALES_GROUPS.indexOf(a.group) - SALES_GROUPS.indexOf(b.group) ||
      a.group.localeCompare(b.group);
    if (g) return g;
    return Number(a.hour) - Number(b.hour);
  });

  const csvRows = [
    [
      'date_ct',
      'sales_group',
      'hour_of_day_ct',
      'net_leads',
      'leads_0_30s',
      'leads_0_60s',
      'pct_0_30s',
      'pct_0_60s',
    ].join(','),
  ];

  let lastDate = '';
  for (const h of cells) {
    if (!h.net) continue;
    if (h.date !== lastDate) {
      if (lastDate) console.log('');
      const dayCells = cells.filter((c) => c.date === h.date && c.net);
      const dayNet = dayCells.reduce((s, x) => s + x.net, 0);
      const day30 = dayCells.reduce((s, x) => s + x.s30, 0);
      console.log(`=== ${h.date} (${dayNet} leads, ${pct(day30, dayNet)} ≤30s) ===`);
      lastDate = h.date;
    }
    csvRows.push(
      [
        h.date,
        h.group,
        h.hour,
        h.net,
        h.s30,
        h.s60,
        h.net ? (h.s30 / h.net).toFixed(4) : '',
        h.net ? (h.s60 / h.net).toFixed(4) : '',
      ].join(','),
    );
  }
  console.log('');

  fs.writeFileSync(OUT_CSV, csvRows.join('\n'));
  console.log(`Saved ${csvRows.length - 1} rows → ${OUT_CSV}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
