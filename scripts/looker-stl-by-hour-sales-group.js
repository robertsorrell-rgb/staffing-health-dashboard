#!/usr/bin/env node
'use strict';
/**
 * Speed-to-lead by hour × WFM sales group from marketing/contacts explore.
 * Clones filters/measures from qid ub6VjTCXbq2fgYXf9fRwhf and adds hour + sales group dims.
 *
 * Usage:
 *   node scripts/looker-stl-by-hour-sales-group.js
 *   DATE_FILTER="30 day ago for 30 day" node scripts/looker-stl-by-hour-sales-group.js
 *   OUT_CSV=~/Downloads/stl.csv node scripts/looker-stl-by-hour-sales-group.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  lookerLogin,
  lookerGetQuery,
  lookerCreateQuery,
  lookerRunQueryJson,
  lookerRunJsonToHeaderRows,
} = require('../netlify/functions/lib/looker-api.js');

const SOURCE_QID = process.env.LOOKER_STL_SOURCE_QID || 'ub6VjTCXbq2fgYXf9fRwhf';
const DATE_FILTER = process.env.DATE_FILTER || '7 day ago for 7 day';
const OUT_CSV =
  process.env.OUT_CSV ||
  path.join(os.homedir(), 'Downloads', 'stl_by_hour_sales_group.csv');

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

/** Map Leads Audience (Sales) → CC90 sales group tabs used in WFM/VCPU. */
function withWfmSalesGroupDynamic(dynamicFieldsJson) {
  const fields = JSON.parse(dynamicFieldsJson);
  const has = fields.some((f) => f.dimension === 'wfm_sales_group');
  if (has) return dynamicFieldsJson;

  fields.push({
    category: 'dimension',
    expression: [
      'case(',
      '  when(${contacts.audience_subject}="HS-STEM" OR ${contacts.audience_subject}="K12 Test Prep", "High School"),',
      '  when(${contacts.audience_subject}="Col-STEM" OR ${contacts.audience_subject}="Grad Test Prep", "College and Grad"),',
      '  when(${contacts.audience_subject}="K-6" OR ${contacts.audience_subject}="Learning Differences", "Elementary and LD"),',
      '  when(${contacts.audience_subject}="Prof Certs" OR ${contacts.audience_subject}="Upskilling", "Adult Learner"),',
      '  "Other"',
      ')',
    ].join('\n'),
    label: 'WFM Sales Group',
    dimension: 'wfm_sales_group',
    _kind_hint: 'dimension',
    _type_hint: 'string',
  });
  return JSON.stringify(fields);
}

function pct(n, d) {
  if (!d) return 'n/a';
  return `${((100 * n) / d).toFixed(1)}%`;
}

function cellPct(v) {
  if (v == null || v === '') return 'n/a';
  if (typeof v === 'number') return `${(100 * v).toFixed(1)}%`;
  return String(v);
}

async function main() {
  loadLookerEnv();
  const base = process.env.LOOKER_BASE_URL;
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  if (!base || !clientId || !clientSecret) {
    console.error('Missing LOOKER_BASE_URL / CLIENT_ID / CLIENT_SECRET in .env');
    process.exit(1);
  }

  const token = await lookerLogin(base, clientId, clientSecret);
  const orig = await lookerGetQuery(base, token, SOURCE_QID);

  const body = {
    model: orig.model,
    view: orig.view,
    fields: [
      'wfm_sales_group',
      'contacts.created_hour_of_day',
      'contacts.net_leads',
      's',
      's_1',
      's_2',
      's_3',
    ],
    filters: {
      ...orig.filters,
      'contacts.created_date': DATE_FILTER,
    },
    sorts: ['wfm_sales_group', 'contacts.created_hour_of_day'],
    limit: '5000',
    dynamic_fields: withWfmSalesGroupDynamic(orig.dynamic_fields),
    query_timezone: orig.query_timezone || 'America/Chicago',
  };

  const created = await lookerCreateQuery(base, token, body);
  const qid = created.id || created.slug;
  console.log(`Looker explore: https://varsitytutors.looker.com/explore/marketing/contacts?qid=${qid}`);
  console.log(`Date filter: ${DATE_FILTER}\n`);

  const raw = await lookerRunQueryJson(base, token, qid);
  const { headers, rows } = lookerRunJsonToHeaderRows(raw);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  const groups = new Map();
  for (const r of rows) {
    const sg = String(r[idx.wfm_sales_group] ?? '');
    if (!groups.has(sg)) groups.set(sg, []);
    groups.get(sg).push({
      hour: String(r[idx['contacts.created_hour_of_day']] ?? ''),
      net: Number(r[idx['contacts.net_leads']] ?? 0),
      s30: Number(r[idx.s] ?? 0),
      s60: Number(r[idx.s_1] ?? 0),
      pct30: r[idx.s_2],
      pct60: r[idx.s_3],
    });
  }

  const order = [
    'High School',
    'College and Grad',
    'Elementary and LD',
    'Adult Learner',
    'Other',
  ];
  const sortedGroups = [...groups.keys()].sort(
    (a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || a.localeCompare(b),
  );

  for (const sg of sortedGroups) {
    const hrs = groups.get(sg).sort((a, b) => Number(a.hour) - Number(b.hour));
    const totalNet = hrs.reduce((s, x) => s + x.net, 0);
    const total30 = hrs.reduce((s, x) => s + x.s30, 0);
    const total60 = hrs.reduce((s, x) => s + x.s60, 0);
    console.log(
      `=== ${sg} (${totalNet} leads, ${pct(total30, totalNet)} within 30s, ${pct(total60, totalNet)} within 60s) ===`,
    );
    console.log('Hour | Net Leads | 0-30s | 0-60s | %0-30s | %0-60s');
    for (const h of hrs) {
      if (!h.net) continue;
      console.log(
        `${String(h.hour).padStart(2)}:00 | ${String(h.net).padStart(9)} | ${String(h.s30).padStart(5)} | ${String(h.s60).padStart(5)} | ${cellPct(h.pct30).padStart(6)} | ${cellPct(h.pct60).padStart(6)}`,
      );
    }
    console.log('');
  }

  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      r
        .map((c) => {
          const s = c == null ? '' : String(c);
          return s.includes(',') ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    );
  }
  fs.writeFileSync(OUT_CSV, lines.join('\n'));
  console.log(`Saved ${rows.length} rows → ${OUT_CSV}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
