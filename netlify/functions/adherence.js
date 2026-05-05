'use strict';

const { getSheetValues, normalizeDateCell, ok, bad, errorResponse, handleOptions } = require('./_sheets.js');
const { todayCTDateStr } = require('./lib/ct.js');
const { env } = require('./lib/deploy-defaults.js');

const CACHE_SEC = parseInt(env('ADHERENCE_CACHE_SECONDS'), 10);

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const spreadsheetId = env('ADHERENCE_SPREADSHEET_ID');
  const alertsTab = env('ADHERENCE_ALERTS_TAB') || 'Adherence_Alert_Log';
  const alertsRange =
    (process.env.ADHERENCE_ALERTS_RANGE || '').trim() || `'${alertsTab.replace(/'/g, "''")}'!A1:Z50000`;
  const digestUrl = (process.env.ADHERENCE_DIGEST_URL || '').trim();

  if (!spreadsheetId) {
    return ok(
      {
        configured: false,
        ping1_today: null,
        ping2_today: null,
        top_managers: [],
        digest_url: digestUrl || null,
        note: 'ADHERENCE_SPREADSHEET_ID not set',
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  }

  try {
    const values = await getSheetValues(spreadsheetId, alertsRange, {
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });
    const today = todayCTDateStr();
    const headers = (values[0] || []).map((h) => String(h || '').trim().toLowerCase());

    const findCol = (pred) => headers.findIndex(pred);
    const dateCol = findCol((h) => h.includes('date') || h === 'day' || h.includes('timestamp'));
    const mgrCol = findCol((h) => h.includes('manager') || h.includes('supervisor') || h.includes('lead'));

    let typeCol = findCol((h) => /ping|alert|level|tier|type|alert_type/.test(h));
    if (typeCol < 0) typeCol = findCol((h) => h.includes('notification'));

    const dc = dateCol >= 0 ? dateCol : 0;

    let ping1 = 0;
    let ping2 = 0;
    const mgrCounts = {};

    for (let r = 1; r < values.length; r++) {
      const row = values[r] || [];
      if (normalizeDateCell(row[dc]) !== today) continue;
      const typeRaw = typeCol >= 0 ? String(row[typeCol] || '').toLowerCase() : '';
      if (/ping\s*1|^p1\b|first\s*ping|tier\s*1|level\s*1/.test(typeRaw)) ping1++;
      else if (/ping\s*2|^p2\b|second\s*ping|tier\s*2|level\s*2/.test(typeRaw)) ping2++;
      else if (/ping/.test(typeRaw)) {
        if (typeRaw.includes('2')) ping2++;
        else if (typeRaw.includes('1')) ping1++;
      }

      if (mgrCol >= 0) {
        const m = String(row[mgrCol] || '').trim();
        if (m) mgrCounts[m] = (mgrCounts[m] || 0) + 1;
      }
    }

    const topManagers = Object.entries(mgrCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    return ok(
      {
        configured: true,
        ping1_today: ping1,
        ping2_today: ping2,
        top_managers: topManagers,
        digest_url: digestUrl || null,
        fetched_at: new Date().toISOString(),
      },
      CACHE_SEC
    );
  } catch (err) {
    return errorResponse(err, 'adherence');
  }
};
