'use strict';

/**
 * Non-secret defaults for production Netlify/AWS Lambda.
 *
 * Lambda bundles all site env vars into each function and the total must stay
 * under ~4KB — GOOGLE_SERVICE_ACCOUNT_JSON alone is usually 2–3KB.
 * Set only secrets in Netlify (Google JSON + optional ASSEMBLED_API_KEY);
 * spreadsheet IDs / tabs live here and can still be overridden via env if needed.
 */
const DEFAULTS = {
  CAPACITY_PULL_SPREADSHEET_ID: '1gU2f7IQdlpWojwWnsQbpRP1Vge79I0tr4n1AjI1K3uw',
  CAPACITY_PULL_TAB: 'Capacity Pull',
  CAPACITY_PULL_CACHE_SECONDS: '180',
  CAPACITY_PULL_SOURCE: 'auto',
  IDLE_CONSUMER_SPREADSHEET_ID: '1MlHy2dB9JieEk4q72YhsEJLwvFFYJZ_fAI7s4M7mDLk',
  IDLE_CONSUMER_HOURLY_LOG_TAB: 'CS_Hourly_Log',
  IDLE_HOURLY_LOG_CACHE_SECONDS: '180',
  ADHERENCE_SPREADSHEET_ID: '16OLaJrpyNHzh9Oqd5GV3JdSx0YJeyu8a4qD38WTpcgU',
  ADHERENCE_ALERTS_TAB: 'Adherence_Alert_Log',
  ADHERENCE_CACHE_SECONDS: '120',
  TARGETED_VTO_SPREADSHEET_ID: '1znBYs9PemirPw_is3b8Blj74wEz7Hb6iGH88DH2qWmU',
  TARGETED_VTO_TAB: 'Offers',
  TARGETED_VTO_SUMMARY_TAB: 'VTO_Summary',
  TARGETED_VTO_SUMMARY_RANGE: 'A1:F25',
  TARGETED_VTO_CACHE_SECONDS: '300',
  AUTO_VTO_SPREADSHEET_ID: '1gU2f7IQdlpWojwWnsQbpRP1Vge79I0tr4n1AjI1K3uw',
  AUTO_VTO_TAB: 'Requests_Submissions',
  AUTO_VTO_CACHE_SECONDS: '300',
  BOBBOT_SPREADSHEET_ID: '1gndsQQZdIJ5sr0XPP6aafRnQ95ZT4KXPQk5882To4F0',
  BOBBOT_TAB: 'Bobbot_History',
  BOBBOT_CACHE_SECONDS: '300',
  CALLOUT_SPREADSHEET_ID: '16O9z0bFmKO5cWHhY_KoYIkxsbGcBELdrNnUNUwsqR5Y',
  CALLOUT_MAIN_TAB: 'Sheet1',
  CALLOUT_ATTENDANCE_TAB: 'Attendance Notification Log',
  CALLOUT_CACHE_SECONDS: '300',
  ASSEMBLED_SITE_NAME: 'Consumer Sales',
  ASSEMBLED_CHANNEL: 'phone',
  ASSEMBLED_INTERVAL_SECONDS: '1800',
  ASSEMBLED_PAGE_SIZE: '20',
  ASSEMBLED_OP_START_MINUTE: '420',
  ASSEMBLED_OP_END_MINUTE: '1320',
  ASSEMBLED_API_BASE: 'https://api.assembledhq.com/v0',
};

/**
 * Env var or baked-in default (empty string if neither).
 * @param {string} name
 * @returns {string}
 */
function env(name) {
  const raw = process.env[name];
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') return String(raw).trim();
  if (DEFAULTS[name] !== undefined) return String(DEFAULTS[name]);
  return '';
}

module.exports = { env, DEFAULTS };
