'use strict';

const STORE_NAME = 'staffing-dashboard-daily-v1';

function getStoreOrNull() {
  try {
    const { getStore } = require('@netlify/blobs');
    return getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[dashboard-snapshot-store] Blobs unavailable:', e.message);
    return null;
  }
}

async function saveSnapshot(dateIso, payload) {
  const store = getStoreOrNull();
  if (!store) throw new Error('Netlify Blobs store unavailable (deploy on Netlify with Blobs enabled)');
  const key = `daily/${dateIso}`;
  await store.setJSON(key, payload);
  let manifest = (await store.get('manifest', { type: 'json' })) || { dates: [] };
  const set = new Set(Array.isArray(manifest.dates) ? manifest.dates : []);
  set.add(dateIso);
  manifest.dates = [...set].sort();
  await store.setJSON('manifest', manifest);
}

async function readSnapshot(dateIso) {
  const store = getStoreOrNull();
  if (!store) return null;
  const data = await store.get(`daily/${dateIso}`, { type: 'json' });
  return data || null;
}

async function listSnapshotDates() {
  const store = getStoreOrNull();
  if (!store) return [];
  const manifest = await store.get('manifest', { type: 'json' });
  if (manifest && Array.isArray(manifest.dates)) return manifest.dates;
  return [];
}

module.exports = {
  saveSnapshot,
  readSnapshot,
  listSnapshotDates,
  getStoreOrNull,
};
