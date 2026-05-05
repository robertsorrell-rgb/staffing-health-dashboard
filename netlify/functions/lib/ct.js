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

module.exports = { todayCTDateStr, currentCTHour };
