#!/usr/bin/env node
'use strict';

/**
 * Probe Assembled overtime_slots for peak week + OT T1 skill (local validation).
 *   node scripts/probe-ot-peak-slots.js
 */
const fs = require('fs');
const path = require('path');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]] != null) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnv(path.join(__dirname, '..', '.env'));
loadEnv(path.join(__dirname, '..', '..', 'cs-wfm-platform', '.env'));

const SESSION = (process.env.ASSEMBLED_SESSION || '').trim();
const CSRF = (process.env.ASSEMBLED_CSRF || '').trim();
const API_KEY = (process.env.ASSEMBLED_API_KEY || '').trim();

const APP_BASE = 'https://app.assembledhq.com/api';
const API_BASE = 'https://api.assembledhq.com/v0';

const QUEUES = [
  { sg: 'AL', queueAppId: 'expertalcc90new-1741983982' },
  { sg: 'PC', queueAppId: 'expertpccc90new-1741987887' },
  { sg: 'COL', queueAppId: 'expertcolcc90new-1741984259' },
  { sg: 'ELD', queueAppId: 'experteldcc90new-1741984392' },
  { sg: 'HS', queueAppId: 'experthscc90new-1741984534' },
];

const PEAK_START = '2026-09-13T05:00:00.000Z'; // Sun 00:00 CT (CDT)
const PEAK_END = '2026-09-20T05:00:00.000Z';
const SKILL_ID = (process.env.REVIEW_PEAK_SKILL_ID || 'ott1-1759507170').trim();

function sessionHeaders() {
  return {
    accept: 'application/json',
    'Content-Type': 'application/json',
    cookie: `assembled-session=${SESSION}`,
    'x-csrf-token': CSRF,
  };
}

function apiHeaders() {
  return {
    Authorization: `Basic ${Buffer.from(`${API_KEY}:`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

function coerceSlots(body) {
  if (Array.isArray(body)) return body;
  for (const k of ['overtime_slots', 'slots', 'data']) {
    if (Array.isArray(body?.[k])) return body[k];
  }
  return [];
}

function slotMetrics(slot) {
  const cap = Number(slot.capacity ?? slot.capacity_count ?? 0);
  const appr = Number(slot.num_approved_requests ?? slot.numApprovedRequests ?? 0);
  const pend = Number(slot.num_pending_requests ?? slot.numPendingRequests ?? 0);
  return { cap, filled: appr + pend };
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, body, textLen: text.length };
}

function buildUrl(basePath, qd, extra) {
  const p = new URLSearchParams({
    start_time: PEAK_START,
    end_time: PEAK_END,
    channel: 'phone',
    queue: qd.queueAppId,
    is_published: 'true',
    ...extra,
  });
  return `${APP_BASE}${basePath}?${p.toString()}`;
}

async function main() {
  if (!SESSION || !CSRF) {
    console.error('Need ASSEMBLED_SESSION + ASSEMBLED_CSRF in cs-wfm-platform/.env');
    process.exit(1);
  }

  console.log('Peak window', PEAK_START, '→', PEAK_END);
  console.log('Skill param', SKILL_ID);

  const skillLists = [];
  for (const skillsUrl of [`${APP_BASE}/skills`, `${API_BASE}/skills`]) {
    const { status, body } = await getJson(skillsUrl, skillsUrl.includes('/v0/') ? apiHeaders() : sessionHeaders());
    const raw = body.skills || body.data || body;
    const list = Array.isArray(raw)
      ? raw
      : Object.entries(raw || {}).map(([k, v]) =>
          typeof v === 'object' ? { id: v.id || k, ...v } : { id: k, name: v }
        );
    const otT1 = list.filter((s) => /ot t1|ot tier 1/i.test(String(s.name || '')));
    skillLists.push({ url: skillsUrl, status, otT1: otT1.slice(0, 5), total: list.length });
  }
  console.log('\nSkills catalogs:', JSON.stringify(skillLists, null, 2));

  const variants = [
    { label: 'baseline (no skill)', extra: {} },
    { label: 'skill=ott1', extra: { skill: SKILL_ID } },
    { label: 'skill_id', extra: { skill_id: SKILL_ID } },
    { label: 'skills', extra: { skills: SKILL_ID } },
    { label: 'skill + unpublished', extra: { skill: SKILL_ID, is_published: 'false' } },
  ];

  const results = [];
  for (const qd of QUEUES) {
    for (const v of variants) {
      const extra = { ...v.extra };
      if (v.label.includes('unpublished')) delete extra.is_published;
      const url = buildUrl('/overtime_slots', qd, extra);
      const { status, body } = await getJson(url, sessionHeaders());
      const slots = coerceSlots(body);
      let openCap = 0;
      let withCap = 0;
      for (const s of slots) {
        const m = slotMetrics(s);
        if (m.cap >= 1) {
          withCap++;
          openCap += m.cap;
        }
      }
      if (withCap > 0 || v.label.startsWith('skill=ott1')) {
        results.push({
          sg: qd.sg,
          variant: v.label,
          status,
          slots: slots.length,
          withCap,
          openCap,
          sample: slots[0]
            ? {
                start: slots[0].start_time || slots[0].startTime,
                cap: slotMetrics(slots[0]).cap,
                skills: slots[0].skills || slots[0].skill_ids,
              }
            : null,
        });
      }
    }
  }

  console.log('\nFetch matrix (non-zero or skill=ott1):');
  console.table(results);

  const best = results.filter((r) => r.withCap > 0).sort((a, b) => b.openCap - a.openCap);
  if (best.length) {
    console.log('\nBEST:', best[0]);
    process.exit(0);
  }
  console.error('\nNo open-capacity slots found in peak window for any variant.');
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
