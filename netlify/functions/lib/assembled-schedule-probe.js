'use strict';

/**
 * Shared helpers to discover schedule UUIDs (Default Schedule vs master). Used by
 * assembled-net-staffing.js and scripts/assembled-list-schedules.js — keep paths/queries in sync.
 */

const SCHEDULE_REST_PATHS = [
  '/schedules',
  '/schedule_templates',
  '/schedule_template',
  '/schedule_templates/all',
  '/staffing/schedules',
  '/company/schedules',
];

/** Minimal GraphQL probes; most accounts reject unknown fields — harmless try/next. */
const SCHEDULE_GRAPHQL_QUERIES = [
  'query { schedules { id name } }',
  'query { schedule_templates { id name } }',
  'query { scheduleTemplates { id name } }',
  'query { staffing_schedules { id name } }',
  'query { company { schedules { id name } } }',
];

function scheduleRowId(row) {
  if (!row || typeof row !== 'object') return '';
  const id = row.id ?? row.uuid ?? row.schedule_id;
  return id != null ? String(id).trim() : '';
}

function scheduleRowName(row) {
  if (!row || typeof row !== 'object') return '';
  const nm = row.name ?? row.title ?? row.display_name ?? row.label;
  return nm != null ? String(nm).trim() : '';
}

function extractNamedSchedulesFromResponse(payload) {
  const out = [];
  const seen = new Set();
  const addRow = (row) => {
    const id = scheduleRowId(row);
    const name = scheduleRowName(row);
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name });
  };
  if (!payload || typeof payload !== 'object') return out;
  const collect = (block) => {
    if (!block) return;
    if (Array.isArray(block)) {
      for (const row of block) {
        if (row && typeof row === 'object') addRow(row);
      }
    } else if (typeof block === 'object') {
      for (const row of Object.values(block)) {
        if (row && typeof row === 'object' && !Array.isArray(row)) addRow(row);
      }
    }
  };
  collect(payload.schedules);
  collect(payload.schedule_templates);
  collect(payload.templates);
  collect(payload.results);
  collect(payload.items);
  collect(payload.records);
  if (Array.isArray(payload.data)) collect(payload.data);
  if (Array.isArray(payload)) collect(payload);
  return out;
}

function graphqlCollectScheduleLikeNodes(data) {
  const out = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (node == null || depth > 14) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      const id = scheduleRowId(node);
      const name = scheduleRowName(node);
      if (id && name && !seen.has(id)) {
        seen.add(id);
        out.push({ id, name });
      }
      for (const v of Object.values(node)) walk(v, depth + 1);
    }
  };
  walk(data, 0);
  return out;
}

async function assembledGraphqlQuery(apiBase, apiKey, query) {
  const auth = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  const apiVer = String(process.env.ASSEMBLED_API_VERSION || '').trim();
  const url = `${apiBase.replace(/\/$/, '')}/graphql`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(apiVer ? { 'API-Version': apiVer } : {}),
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Assembled /graphql ${res.status}: ${text.slice(0, 240)}`);
    err.statusCode = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

module.exports = {
  SCHEDULE_REST_PATHS,
  SCHEDULE_GRAPHQL_QUERIES,
  scheduleRowId,
  scheduleRowName,
  extractNamedSchedulesFromResponse,
  graphqlCollectScheduleLikeNodes,
  assembledGraphqlQuery,
};
