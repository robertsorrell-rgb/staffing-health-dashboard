#!/usr/bin/env node
'use strict';
/**
 * One-off: clone LOOKER_SPEED_TO_LEAD_QUERY_ID without pivots so JSON cells are flat numbers.
 * Loads only LOOKER_* keys from ../.env (simple KEY=value lines).
 *
 * Usage: node scripts/looker-stl-unpivot-query.js
 * Optional: DRY_RUN=0 node ...  — default prints plan only; set DRY_RUN=1 to POST new query.
 */
const fs = require('fs');
const path = require('path');
const {
  lookerLogin,
  lookerGetQuery,
  lookerCreateQuery,
  lookerRunQueryJson,
  lookerRunJsonToHeaderRows,
} = require('../netlify/functions/lib/looker-api.js');

function loadLookerEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
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

/** Fields Looker accepts on POST /queries (omit server-generated keys). */
function buildWriteQuery(original, { dropPivotDimensionsFromFields }) {
  const q = original;
  let fields = q.fields || [];
  if (dropPivotDimensionsFromFields) {
    const pivotSet = new Set((q.pivots || []).map((x) => String(x)));
    fields = fields.filter((f) => !pivotSet.has(String(f)));
  }

  const body = {
    model: q.model,
    view: q.view,
    fields,
    pivots: [],
    filters: q.filters || undefined,
    filter_expression: q.filter_expression || undefined,
    sorts: q.sorts || undefined,
    limit: q.limit != null ? q.limit : undefined,
    column_limit: q.column_limit != null ? q.column_limit : undefined,
    total: q.total != null ? q.total : undefined,
    row_totals: q.row_totals != null ? q.row_totals : undefined,
    subtotals: q.subtotals != null ? q.subtotals : undefined,
    query_timezone: q.query_timezone || undefined,
    fill_fields: q.fill_fields != null ? q.fill_fields : undefined,
    // Required when measures are table-calc style (s, s_1, …); omitting drops columns.
    dynamic_fields: q.dynamic_fields || undefined,
  };

  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  return body;
}

async function main() {
  loadLookerEnv();
  const baseUrl = process.env.LOOKER_BASE_URL;
  const clientId = process.env.LOOKER_CLIENT_ID;
  const clientSecret = process.env.LOOKER_CLIENT_SECRET;
  const queryId = process.env.LOOKER_SPEED_TO_LEAD_QUERY_ID;
  if (!baseUrl || !clientId || !clientSecret || !queryId) {
    console.error('Missing LOOKER_BASE_URL, LOOKER_CLIENT_ID, LOOKER_CLIENT_SECRET, or LOOKER_SPEED_TO_LEAD_QUERY_ID in .env');
    process.exit(1);
  }

  const dryRun = String(process.env.DRY_RUN || '') !== '1';
  const dropPivotDims =
    String(process.env.LOOKER_STL_DROP_PIVOT_DIMS_FROM_FIELDS || '') === '1';
  const token = await lookerLogin(baseUrl, clientId, clientSecret);
  const existing = await lookerGetQuery(baseUrl, token, queryId);

  console.log('Current query id:', existing.id || queryId);
  console.log('Pivots:', JSON.stringify(existing.pivots || []));
  console.log('Fields count:', (existing.fields || []).length);

  const write = buildWriteQuery(existing, {
    dropPivotDimensionsFromFields: dropPivotDims,
  });
  console.log('New pivots:', write.pivots);
  console.log('New fields count:', (write.fields || []).length);

  if (dryRun) {
    console.log('\nDRY_RUN (default): no query created. Run with DRY_RUN=1 to POST clone.');
    process.exit(0);
  }

  const created = await lookerCreateQuery(baseUrl, token, write);
  const newId = created.id || created.slug || created;
  console.log('\nCreated query id:', newId);

  const raw = await lookerRunQueryJson(baseUrl, token, newId);
  const { headers, rows } = lookerRunJsonToHeaderRows(raw);
  console.log('Headers:', headers);
  console.log('First row sample:', rows[0] ? rows[0].map((c, i) => [i, typeof c, headers[i]]) : '(no rows)');

  console.log('\nSet in .env and Netlify:');
  console.log(`LOOKER_SPEED_TO_LEAD_QUERY_ID=${newId}`);
  console.log('Update LOOKER_SPEED_TO_LEAD_EXPLORE_URL qid= to match if you use that link.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
