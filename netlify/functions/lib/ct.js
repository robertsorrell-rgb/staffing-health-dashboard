'use strict';

/** Calendar date string YYYY-MM-DD in America/Chicago */
function todayCTDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

/** Current hour 0–23 in America/Chicago */
function currentCTHour() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour');
  return h ? parseInt(h.value, 10) : 0;
}

/**
 * Sunday–Saturday week in America/Chicago that contains "now".
 * @returns {{ week_start: string, week_end: string, label: string }}
 */
function currentChicagoWeekSundayToSaturday() {
  let t = Date.now();
  let wdShort = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
  }).format(new Date(t));
  for (let i = 0; i < 8 && wdShort !== 'Sun'; i++) {
    t -= 24 * 3600 * 1000;
    wdShort = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
    }).format(new Date(t));
  }
  const weekStartYmd = new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const weekEndTs = t + 6 * 24 * 3600 * 1000;
  const weekEndYmd = new Date(weekEndTs).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const fmtMd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
  });
  const fmtYear = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
  });
  const startPretty = fmtMd.format(new Date(t));
  const endPretty = fmtMd.format(new Date(weekEndTs));
  const year = fmtYear.format(new Date(weekEndTs));
  const label = `Sun ${startPretty} – Sat ${endPretty}, ${year}`;
  return { week_start: weekStartYmd, week_end: weekEndYmd, label };
}

module.exports = { todayCTDateStr, currentCTHour, currentChicagoWeekSundayToSaturday };
