/***************************************
 * MEETING GOVERNOR v1.8.9
 * Meeting Capacity Gate for Consumer Sales
 *
 * OVERVIEW:
 *   (Same as v1.5.1, plus)
 *   BOOK IT: Denied requests that include alternative windows embed Slack links
 *   (<url|📅 Book it>). One click opens the deployed web app (doGet), which commits
 *   the Meeting activity to Assembled, appends Requests, and DMs the submitter (Meet link).
 *
 *   Script Property MG_WEB_APP_URL — full deployed URL ending in /exec (no trailing slash).
 *
 *   GOOGLE CALENDAR: After Assembled Meeting blocks are written, creates an event and invites
 *   the manager + committed reps as guests (sendUpdates=all). Tries the manager calendar first;
 *   falls back to the script runner's primary calendar so invites still go out when managers
 *   have not shared their calendar. Name/email aliases (e.g. Shilo Gator + Wheeler) are both
 *   invited. Toggle: GOOGLE_CALENDAR_INVITES_ENABLED (calendar still runs when TEST_MODE is on).
 *
 * SETUP:
 *   Script Properties: ASSEMBLED_API_KEY, SLACK_BOT_TOKEN, MG_WEB_APP_URL
 *   Deploy → Web app → Execute as: Me → Who has access: Anyone
 *
 * CHANGELOG (header): v1.8.9 — FIX queue map for New Sales / ELD managers (e.g. Kimberly Murdock): normalize work-group keys, expand aliases (K6, E&LD, singular Learning Difference, People-tab labels), majority-vote queue from full manager team when filtered attendees lack work groups; menu Reprocess Selected Row.
 *   v1.8.8 — Calendar invites: manager + consultants as guests; Shilo Gator/Wheeler both invited; fall back to script primary calendar when manager share missing; calendar no longer skipped solely by TEST_MODE.
 *   v1.8.7 — Unauthorized meeting scan: WFM Slack only for Flagged Meetings (not tool-submitted); min 4 reps + 30 min; Consumer Sales five queues only; dedupe by manager/date/start + Slack already sent.
 *   v1.8.6 — Meeting policy: alt/split recommendations 9 AM–5 PM CT Mon–Fri; min post-meeting net buffer -2 (Config tab keys MIN_NET_STAFFING_BUFFER, ALT_SEARCH_START_HOUR, ALT_SEARCH_END_HOUR).
 *   v1.8.5 — FIX split sessions: Session 2 excludes Session 1's time window so both groups are not booked at the same slot.
 *   v1.8.4 — ERROR Slack ping: any Requests ERROR (or Assembled commit failure decision) DMs robert.sorrell; recurring weekly ERROR + init failures also ping.
 *   v1.8.3 — FIX alt-window + split search: scan full ops day (8 AM–6 PM CT), not requested time ±2h; split groups use half-team size (capacity checked per slot, not capped by requested-time net).
 *   v1.8.2 — FIX queue resolution for segment-manager teams: infer Assembled queue from Leadership role when Import Roster work group is blank/unmapped; fuzzy work-group→queue matching.
 *   v1.8.1 — FIX Leadership segment managers (e.g. HS Manager): map role to sales group; resolve team via Import Roster column F (Senior) when column E empty; fuzzy manager name match (forrest/forest).
 *   v1.8.0 — Recurring meetings: BOOKED Slack "Make this recurring" link; Friday auto-book for following week; reschedule ping with Book it alts; Scheduled Recurring Meetings tab + analytics; stop recurring link on recurring BOOKED pings.
 *   v1.7.26 — BOOKED Slack Add reps link: web form (max 2 names) adds Meeting blocks in Assembled + Google Calendar guests with Meet link.
 *   v1.7.25 — BOOKED Slack adds +15 min link: extends Google Calendar invite and Assembled Meeting blocks (reuses cancel token; repeatable while meeting active).
 *   v1.7.24 — Google Calendar + Meet links use Config Manager Slack Aliases for manager email (same as v1.7.23 Slack); legacy MEET_LINK rows copied forward on sync.
 *   v1.7.23 — Slack DM lookup uses Config Manager Slack Aliases + fallback emails (fixes renamed managers e.g. Shilo Gater vs Wheeler roster email).
 *   v1.7.22 — Cancel meeting: after removing Assembled Meeting blocks, write Phone blocks for the same window so reps are not left unscheduled.
 *   v1.7.21 — FIX manual override still skipped: dedicated col I scan (getLastRow), fresh row reads, regex decision match, month-name timestamp parse.
 *   v1.7.20 — FIX manual override ping: Decision already "APPROVED — manual override" sends BOOKED Slack + L=Y without Assembled commit; robust col A timestamp parse.
 *   v1.7.19 — Decision "APPROVED — manual override" + column L (Manual Override Sent): Run Now sends BOOKED Slack ping once; L=Y when processed. Requests timestamped on/after 2026-06-09 only.
 *   v1.7.18 — Pending manager Matt McCarthy (@Matt.Mccarthy → matt.mccarthy@varsitytutors.com); manual attendees match full roster until Import Roster column E.
 *   v1.7.17 — Config MEETING_BLACKOUT_DATES + MEETING_BLACKOUT_DAYS_OF_WEEK auto-deny.
 *   v1.7.16 — BOOKED Slack includes Cancel meeting link (web app); removes Assembled Meeting blocks + calendar event (v1.7.22 restores Phone blocks).
 *   v1.7.15 — Super submitter (robert.sorrell): any request auto-books — audience all/names/groups; skips capacity; full commit in TEST_MODE.
 *   v1.7.14 — Leadership tab: coach/lead submitter → sales group (Coach PC→prof certs, Coach HS→high school, etc.).
 *   v1.7.13 — Manual attendee list only matches that manager's roster team (training submits safe).
 *   v1.7.12 — John Riordan vs Johnpaul Riordan: riordon/riordan typos, john paul ↔ johnpaul, john blocked from first-name-only.
 *   v1.7.11 — Lock + row claim prevents duplicate Slack DMs when Run Now overlaps the 5-min trigger.
 *   v1.7.10 — Shilo gater/gator → Wheeler; unique first name wins over wrong last name (except Emily).
 *   v1.7.9 — Manager aliases (e.g. Shilo gator → Shilo Wheeler); first-name roster match except Emily.
 *   v1.7.8 — Skip blank padded rows on Requests (fixes ERROR spam on empty rows 20+).
 *   v1.7.7 — Staffing-risk scan uses live Intraday Leads sheet (Today vs S&OP) during meeting hours.
 *   v1.7.6 — Staffing-risk scan alerts WFM only (no manager DM).
 *   v1.7.5 — Meeting scan flags approved meetings when net staffing drops below buffer.
 *   v1.7.4 — Denial copy reflects manual attendee list vs full team; approval DMs note Calendar invites sent.
 *   v1.7.3 — Auto-append MEET_LINK_ rows for new roster managers on each run (append-only).
 *   v1.7.2 — Manual DENIED→APPROVED re-run commits + DMs; first-name + last-initial attendee match.
 *   v1.7.1 — Fix Slack DM lookup for submitter display names (e.g. "Emily Krenzke").
 *   v1.7.0 — Google Calendar invites on manager calendar with reps as guests.
 *   v1.6.2 — Fix getRange in mgCreateBookingToken_.
 *   v1.6.1 — Fix Book it Date coercion on token read.
 ***************************************/

/***************************************
 * CONSTANTS
 ***************************************/
const MG = {
  VERSION: 'v1.8.9',
  /** Requests with timestamp (col A) on/after this date use column L manual-override ping tracking. */
  MANUAL_OVERRIDE_CUTOFF: '2026-06-09',
  INTRADAY_LEADS: {
    DEFAULT_SPREADSHEET_ID: '1clGnZjpQSJOhy65yH6Gx4V33UxyYa_eAHhDu15lrm-k',
    DEFAULT_TAB:            'Intraday Leads 4 16.csv'
  },
  SHEETS: {
    REQUESTS:         'Requests',
    IMPORT_ROSTER:    'Imported Roster',
    AUDIT:            'Audit',
    CONFIG:           'Config',
    FLAGGED_MEETINGS:  'Flagged Meetings',
    STAFFING_RISK:     'Staffing Risk Meetings',
    CHANGELOG:        'Changelog',
    BOOKING_TOKENS:   'Booking Tokens',
    CANCEL_TOKENS:    'Cancel Tokens',
    LEADERSHIP:       'Leadership',
    RECURRING_MEETINGS:     'Scheduled Recurring Meetings',
    RECURRING_WEEKLY_LOG:   'Recurring Weekly Log',
    RECURRING_OPT_IN_TOKENS:'Recurring Opt-In Tokens'
  },
  LEADERSHIP_COLS: {
    NAME:  1,
    ROLE:  2,
    GROUP: 3
  },
  ASSEMBLED: {
    BASE_URL:    'https://api.assembledhq.com/v0',
    SITE_NAME:   'Consumer Sales',
    CHANNEL:     'phone',
    INTERVAL:    1800,
    PAGE_SIZE:   20,
    SLEEP_MS:    300
  },
  WORK_GROUP_TO_QUEUE: {
    'stem high school test group':       'High School_CC90_New',
    'k12 test prep':                     'High School_CC90_New',
    'k 12 test prep':                    'High School_CC90_New',
    'high school':                       'High School_CC90_New',
    'hs':                                'High School_CC90_New',
    'graduate test prep':                'College and Grad TP_CC90_New',
    'stem college test group':           'College and Grad TP_CC90_New',
    'college':                           'College and Grad TP_CC90_New',
    'college and grad':                  'College and Grad TP_CC90_New',
    'core test group':                   'Adult Learner_CC90_New',
    'languages test group':              'Adult Learner_CC90_New',
    'adult learning':                    'Adult Learner_CC90_New',
    'adult learner':                     'Adult Learner_CC90_New',
    'professional certifications':       'Prof Certs_CC90_New',
    'professional certification':        'Prof Certs_CC90_New',
    'prof certs':                        'Prof Certs_CC90_New',
    'pc':                                'Prof Certs_CC90_New',
    'k-6 test group':                    'Elementary and LD_CC90_New',
    'k6 test group':                     'Elementary and LD_CC90_New',
    'k 6 test group':                    'Elementary and LD_CC90_New',
    'learning differences test group':   'Elementary and LD_CC90_New',
    'learning difference test group':    'Elementary and LD_CC90_New',
    'elementary':                        'Elementary and LD_CC90_New',
    'elementary and ld':                 'Elementary and LD_CC90_New',
    'e&ld':                              'Elementary and LD_CC90_New',
    'e & ld':                            'Elementary and LD_CC90_New',
    'eld':                               'Elementary and LD_CC90_New',
    'initial support consultant':        'ISC_New',
    'isc':                               'ISC_New'
  },
  MIN_BUFFER:             -2,
  BOOKING_TOKEN_TTL_MS:   7 * 24 * 60 * 60 * 1000,
  CANCEL_TOKEN_TTL_MS:    7 * 24 * 60 * 60 * 1000,
  EXTEND_MINUTES:         15,
  ADD_REPS_MAX:           2,
  TEST_MODE_KEY:          'TEST_MODE',
  SCAN_ENABLED_KEY:       'MEETING_SCAN_ENABLED',
  SCAN_MIN_REPS:          4,
  SCAN_MIN_DURATION_MIN:  30,
  SCAN_LOOKAHEAD_HOURS:   24,
  SEARCH_DAYS:            7,
  /** Alternative / split window search: weekdays 9 AM–5 PM CT (see Config tab). */
  ALT_SEARCH_START_HOUR:  9,
  ALT_SEARCH_END_HOUR:    17,
  BOOK_COLS: {
    TOKEN:            1,
    CREATED_AT:       2,
    STATUS:           3,
    MANAGER_RAW:      4,
    SUBMITTER_RAW:    5,
    TITLE:            6,
    MANUAL_ATTENDEES: 7,
    DATE_STR:         8,
    START_STR:        9,
    END_STR:          10,
    EMAILS_CSV:       11,
    SOURCE_ROW:       12,
    RECURRING_ID:     13
  },
  RECURRING_COLS: {
    ID:                 1,
    CREATED_AT:         2,
    STATUS:             3,
    MANAGER:            4,
    SUBMITTER:          5,
    TITLE:              6,
    MANUAL_ATTENDEES:   7,
    DAY_OF_WEEK:        8,
    START_TIME:         9,
    END_TIME:           10,
    SOURCE_ROW:         11,
    WEEKS_SCHEDULED:    12,
    WEEKS_BOOKED_ALT:   13,
    WEEKS_NO_ALT:       14,
    LAST_TARGET_WEEK:   15
  },
  RECURRING_LOG_COLS: {
    LOGGED_AT:          1,
    RECURRING_ID:       2,
    TARGET_WEEK_KEY:    3,
    TARGET_DATE:        4,
    OUTCOME:            5,
    REQUEST_ROW:        6,
    NOTES:              7
  },
  RECURRING_OPT_COLS: {
    TOKEN:              1,
    CREATED_AT:         2,
    STATUS:             3,
    SOURCE_ROW:         4,
    MANAGER_RAW:        5,
    SUBMITTER_RAW:      6,
    TITLE:              7,
    MANUAL_ATTENDEES:   8,
    DAY_OF_WEEK:        9,
    START_TIME:         10,
    END_TIME:           11,
    MANAGER_EMAIL:      12
  },
  CANCEL_COLS: {
    TOKEN:            1,
    CREATED_AT:       2,
    STATUS:           3,
    MANAGER_RAW:      4,
    SUBMITTER_RAW:    5,
    TITLE:            6,
    DATE_STR:         7,
    START_STR:        8,
    END_STR:          9,
    EMAILS_CSV:       10,
    SOURCE_ROW:       11,
    ACTIVITY_JSON:    12,
    CALENDAR_EVENT:   13,
    MANAGER_EMAIL:    14
  },
  CFG: {
    MIN_DURATION_MINUTES: 'MIN_MEETING_DURATION_MINUTES',
    MIN_ATTENDEES:        'MIN_MEETING_ATTENDEES',
    MIN_NOTICE_HOURS:     'MIN_NOTICE_HOURS',
    L7_OVERRIDE:          'L7_OVERRIDE_ENABLED',
    CALENDAR_INVITES:     'GOOGLE_CALENDAR_INVITES_ENABLED',
    STAFFING_RISK_SCAN:   'STAFFING_RISK_SCAN_ENABLED',
    LEAD_PACE_SCAN:       'LEAD_PACE_SCAN_ENABLED',
    LEAD_PACE_RISK_PCT:   'LEAD_PACE_RISK_PCT',
    INTRADAY_LEADS_SS:    'INTRADAY_LEADS_SPREADSHEET_ID',
    INTRADAY_LEADS_TAB:   'INTRADAY_LEADS_TAB',
    BLACKOUT_DATES:       'MEETING_BLACKOUT_DATES',
    BLACKOUT_DOW:         'MEETING_BLACKOUT_DAYS_OF_WEEK',
    MIN_NET_BUFFER:       'MIN_NET_STAFFING_BUFFER',
    ALT_SEARCH_START_HOUR:'ALT_SEARCH_START_HOUR',
    ALT_SEARCH_END_HOUR:  'ALT_SEARCH_END_HOUR',
    SCAN_MIN_REPS:        'SCAN_MIN_REPS',
    SCAN_MIN_DURATION:    'SCAN_MIN_DURATION_MINUTES',
    STAFFING_RISK_WFM_SLACK:'STAFFING_RISK_WFM_SLACK_ENABLED'
  },
  COLS: {
    TIMESTAMP:      1,
    MANAGER:        2,
    TITLE:          3,
    DATE:           4,
    START:          5,
    END:            6,
    ATTENDEES:      7,
    SUBMITTER:      8,
    DECISION:              9,
    RECOMMENDATION:        10,
    MANUAL_OVERRIDE_SENT:  12
  },
  ROSTER: {
    EMAIL:      1,
    NAME:       2,
    MANAGER:    5,
    SENIOR:     6,
    WORK_GROUP: 11
  },
  FLAG_COLS: {
    DETECTED_AT:        1,
    MANAGER:            2,
    TEAM_SIZE_IMPACTED: 3,
    REP_NAMES:          4,
    QUEUE:              5,
    MEETING_DATE:       6,
    START_TIME:         7,
    END_TIME:           8,
    MATCHED_TO_REQUEST: 9,
    SLACK_ALERT_SENT:   10
  },
  RISK_COLS: {
    DETECTED_AT:   1,
    MANAGER:       2,
    TITLE:         3,
    REP_COUNT:     4,
    REP_NAMES:     5,
    QUEUE:         6,
    MEETING_DATE:  7,
    START_TIME:    8,
    END_TIME:      9,
    NET_STAFFING:  10,
    POST_NET:      11,
    MANAGER_SLACK: 12,
    WFM_SLACK:     13,
    RISK_REASON:   14,
    LEAD_PACE_MAX: 15
  },
  TZ: 'America/Chicago'
};

/** Same section header as adherence Config (Manager Name → Slack alias). */
const MG_CONFIG_ALIAS_HEADER = '\u2014 Manager Slack Aliases \u2014';

const MG_WFM_AUTO_SUBMITTERS = [
  'aftynn.peters',
  'taylor.wisnasky',
  'joshua.langford',
  'yago.lupi'
];

/** Submitter alias — auto-approve any request; audience = all | group aliases | names (full Import Roster). */
const MG_SUPER_SUBMITTERS = [
  'robert.sorrell'
];

/** Consumer Sales Assembled queues eligible for unauthorized-meeting scan alerts. */
const MG_CONSUMER_SALES_QUEUES = [
  'High School_CC90_New',
  'College and Grad TP_CC90_New',
  'Adult Learner_CC90_New',
  'Prof Certs_CC90_New',
  'Elementary and LD_CC90_New'
];

/** Slack alias pinged when any request ERROR or partial Assembled commit failure is written. */
const MG_WFM_ERROR_NOTIFY = 'robert.sorrell';

/** Nicknames / form typos / Slack handles → canonical Import Roster manager name (column E). */
const MG_MANAGER_ALIASES = {
  'shilo gator':       'Shilo Wheeler',
  'shilo gater':       'Shilo Wheeler',
  'shilo wheeler':     'Shilo Wheeler',
  'john riordan':      'John Riordan',
  'john riordon':      'John Riordan',
  'johnpaul riordan':  'Johnpaul Riordan',
  'johnpaul riordon':  'Johnpaul Riordan',
  'john paul riordan': 'Johnpaul Riordan',
  'john paul riordon': 'Johnpaul Riordan',
  'john paul':         'Johnpaul Riordan',
  'johnpaul':          'Johnpaul Riordan',
  'john p':            'Johnpaul Riordan',
  'matt mccarthy':     'Matt McCarthy',
  'matt.mccarthy':     'Matt McCarthy',
  'jamie forest':      'Jamie Forrest',
  'jamie.forrest':     'Jamie Forrest'
};

/**
 * Extra Google / Slack emails for renamed managers so calendar invites land on every mailbox
 * they still use (Gator/Gater mailboxes alongside Wheeler).
 */
const MG_MANAGER_EXTRA_EMAILS = {
  'shilo wheeler': [
    'shilo.wheeler@varsitytutors.com',
    'shilo.gator@varsitytutors.com',
    'shilo.gater@varsitytutors.com'
  ]
};

/**
 * Managers not yet listed on Import Roster column E — require comma-separated attendees (column G);
 * rep names resolve against the full Import Roster until the manager has a roster team.
 */
const MG_PENDING_MANAGERS = {
  'matt mccarthy': {
    displayName: 'Matt McCarthy',
    email:       'matt.mccarthy@varsitytutors.com'
  }
};

/** Normalized person keys (manager + attendee) → canonical key before roster match. */
const MG_PERSON_ALIASES = {
  'shilo gator':       'shilo wheeler',
  'shilo gater':       'shilo wheeler',
  'john paul riordan': 'johnpaul riordan',
  'john paul riordon': 'johnpaul riordan',
  'johnpaul riordon':  'johnpaul riordan',
  'john p riordan':    'johnpaul riordan',
  'john p riordon':    'johnpaul riordan',
  'john p':            'johnpaul riordan',
  'john riordon':      'john riordan'
};

/** First-name-only matching blocked — multiple managers share this name on roster. */
const MG_MANAGER_FIRST_ONLY_BLOCK = ['emily', 'john'];

/** Manager-facing product name (Slack, Book it page, calendar) — not "Governor". */
const MG_MANAGER_BRAND = 'Meeting Optimizer';

/** Manager-facing Slack status labels (not APPROVED / DENIED). */
const MG_SLACK_LABEL = {
  BOOKED:    'BOOKED',
  CANT_BOOK: 'CAN\'T BOOK'
};

function mgSlackMeetingHeader_(statusLabel, title) {
  var icon = statusLabel === MG_SLACK_LABEL.BOOKED ? '\u2705' : '\u274C';
  return icon + ' *' + statusLabel + '* — Meeting: _' + title + '_\n';
}

function mgIsWfmAutoSubmitter_(submitterRaw) {
  var a = String(submitterRaw || '').replace(/^@/, '').trim().toLowerCase();
  return MG_WFM_AUTO_SUBMITTERS.indexOf(a) !== -1;
}

function mgIsSuperSubmitter_(submitterRaw) {
  var a = String(submitterRaw || '').replace(/^@/, '').trim().toLowerCase();
  if (MG_SUPER_SUBMITTERS.indexOf(a) !== -1) return true;
  if (a.indexOf('@') === -1 && mgNormPersonName_(a) === 'robert sorrell') return true;
  return false;
}

/** Super-submit audience field: entire Consumer Sales roster. */
function mgIsAllAudienceToken_(raw) {
  var k = mgNormPersonName_(String(raw || '').trim());
  if (!k) return false;
  return k === 'all' || k === 'everyone' || k === 'all reps' || k === 'all consumer sales' ||
    k === 'consumer sales' || k === 'entire roster' || k === 'full roster' || k === 'all groups';
}

/** Ignore trailing empty rows included in getDataRange() (formatting / padding below last request). */
function mgIsBlankRequestRow_(row) {
  const manager = String(row[MG.COLS.MANAGER - 1] || '').trim();
  const title   = String(row[MG.COLS.TITLE - 1]   || '').trim();
  const dateRaw = row[MG.COLS.DATE - 1];
  const hasDate = dateRaw !== null && dateRaw !== undefined && String(dateRaw).trim() !== '';
  return !manager && !title && !hasDate;
}

/***************************************
 * MENU
 ***************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(MG_MANAGER_BRAND)
    .addItem('▶ Run Now', 'mgRunNow')
    .addItem('▶ Run Meeting Scan', 'scanForUnauthorizedMeetings')
    .addItem('▶ Run Recurring (Friday logic)', 'mgRunRecurringNow')
    .addItem('↺ Reprocess Selected Row', 'mgReprocessSelectedRow')
    .addSeparator()
    .addItem('Setup Workbook', 'setupMeetingGovernor')
    .addItem('🎥 Setup Meet Links', 'mgSetupMeetLinks')
    .addToUi();
}

/** Clear Decision/Recommendation and re-run mgProcessRow_ for the active Requests row. */
function mgReprocessSelectedRow() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.REQUESTS);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Requests tab not found.');
    return;
  }
  var rowNum = SpreadsheetApp.getActiveRange().getRow();
  if (rowNum < 2) {
    SpreadsheetApp.getUi().alert('Select a data row on the Requests tab (not the header).');
    return;
  }
  var result = mgReprocessRequestRow(rowNum);
  SpreadsheetApp.getUi().alert(result.message || ('Reprocessed row ' + rowNum));
}

/**
 * Clear prior Decision and reprocess one Requests row (e.g. after a mapping fix).
 * @param {number} rowNum
 * @return {{ok:boolean, message:string, decision?:string}}
 */
function mgReprocessRequestRow(rowNum) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.REQUESTS);
  if (!sheet) return { ok: false, message: 'Requests tab not found' };
  rowNum = Number(rowNum) || 0;
  if (rowNum < 2) return { ok: false, message: 'Invalid row' };
  var lastCol = Math.max(sheet.getLastColumn(), MG.COLS.RECOMMENDATION);
  var row = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];
  if (mgIsBlankRequestRow_(row)) {
    return { ok: false, message: 'Row ' + rowNum + ' is blank' };
  }
  sheet.getRange(rowNum, MG.COLS.DECISION).setValue('');
  sheet.getRange(rowNum, MG.COLS.RECOMMENDATION).setValue('');
  SpreadsheetApp.flush();
  mgAudit_('REPROCESS', 'Row ' + rowNum, 'Cleared Decision — re-running mgProcessRow_', 'INFO');
  mgProcessRow_(sheet, row, rowNum);
  var decision = String(sheet.getRange(rowNum, MG.COLS.DECISION).getValue() || '').trim();
  var rec = String(sheet.getRange(rowNum, MG.COLS.RECOMMENDATION).getValue() || '').trim();
  return {
    ok: true,
    message: 'Row ' + rowNum + ' → ' + decision + (rec ? (' — ' + rec) : ''),
    decision: decision
  };
}

/** Convenience for editor/run: reprocess Requests row 111. */
function mgReprocessRow111() {
  return mgReprocessRequestRow(111);
}

function mgRunNow() {
  const testMode = mgIsTestMode_();
  var pingCount = processMeetingRequests();
  SpreadsheetApp.getUi().alert(
    'Run complete.\n\n' +
    (pingCount > 0
      ? '\u2705 Manual override pings sent: ' + pingCount + ' (column L = Y).\n\n'
      : '') +
    (testMode
      ? '\u26a0\ufe0f  TEST MODE is ON — Slack DMs redirected to @robert.sorrell instead of the requesting manager.\nCheck the Decision/Recommendation columns and Audit tab for results.\nFlip TEST_MODE to FALSE in the Config tab to go live.'
      : '\u2705 Live mode — Slack DMs sent to requesting managers for any processed rows.')
  );
}

/***************************************
 * MAIN ENTRY POINT
 ***************************************/
function processMeetingRequests() {
  const runLock = LockService.getScriptLock();
  if (!runLock.tryLock(120000)) {
    mgAudit_('LOCK', '', 'Skipped processMeetingRequests — another run in progress', 'INFO');
    return 0;
  }
  try {
    return processMeetingRequestsUnlocked_();
  } finally {
    runLock.releaseLock();
  }
}

function processMeetingRequestsUnlocked_() {
  try {
    mgEnsureNewManagerMeetLinks_();
  } catch (err) {
    mgAudit_('MEET_SETUP', 'auto', String(err && err.stack ? err.stack : err), 'WARN');
  }
  try {
    mgEnsureConfigBlackoutRows_();
    mgEnsureConfigMeetingPolicyRows_();
    mgEnsureConfigScanRows_();
  } catch (err) {
    mgAudit_('CONFIG', 'blackout', String(err && err.stack ? err.stack : err), 'WARN');
  }

  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const requestSheet = ss.getSheetByName(MG.SHEETS.REQUESTS);
  if (!requestSheet) {
    mgAudit_('INIT', '', 'Requests tab not found', 'FAILED');
    mgNotifyWfmError_('Run failed', ['Requests tab not found in Meeting Optimizer spreadsheet.']);
    return 0;
  }

  var manualPingCount = mgScanAndProcessManualOverridePings_(requestSheet);

  const values = requestSheet.getDataRange().getValues();
  if (values.length <= 1) return manualPingCount;
  for (var i = 1; i < values.length; i++) {
    const row            = values[i];
    const rowNum         = i + 1;
    if (mgIsBlankRequestRow_(row)) continue;

    const decision       = String(requestSheet.getRange(rowNum, MG.COLS.DECISION).getValue() || '').trim();
    const recommendation = String(requestSheet.getRange(rowNum, MG.COLS.RECOMMENDATION).getValue() || '').trim();
    if (mgIsManualOverrideDecision_(decision)) continue;
    if (mgIsLegacyManualApprovalPending_(decision, recommendation)) {
      try {
        mgProcessManualApproval_(requestSheet, row, rowNum);
      } catch (err) {
        mgAudit_('ROW_ERROR', 'Row ' + rowNum, 'Manual approval: ' + String(err && err.stack ? err.stack : err), 'FAILED');
        mgWriteResult_(requestSheet, rowNum, 'ERROR', 'Manual approval failed — check Audit tab.');
      }
      continue;
    }
    if (decision !== '') continue;
    try {
      mgProcessRow_(requestSheet, row, rowNum);
    } catch (err) {
      mgAudit_('ROW_ERROR', 'Row ' + rowNum, String(err && err.stack ? err.stack : err), 'FAILED');
      mgWriteResult_(requestSheet, rowNum, 'ERROR', 'Script error — check Audit tab.');
    }
  }
  return manualPingCount;
}

/** Normalize decision text — any dash type, collapsed whitespace. */
function mgNormDecisionKey_(decision) {
  return String(decision || '').trim().toUpperCase()
    .replace(/[\u2010-\u2015\u2212\-]/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Decision column value is a WFM manual override (not a system APPROVED). */
function mgIsManualOverrideDecision_(decision) {
  var d = mgNormDecisionKey_(decision);
  if (!d) return false;
  return d.indexOf('APPROVED') === 0 && d.indexOf('MANUAL') !== -1 && d.indexOf('OVERRIDE') !== -1;
}

function mgParseRequestTimestamp_(raw) {
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
  if (raw === null || raw === undefined || raw === '') return null;
  var s = String(raw).trim();
  if (!s) return null;
  var iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    var isoDate = mgBuildDateTime_(iso[1], '12:00');
    if (isoDate) return isoDate;
  }
  var cleaned = s.replace(/(\d+)(st|nd|rd|th)/gi, '$1');
  var patterns = [
    "MMMM d, yyyy 'at' h:mm a zzz",
    "MMMM d, yyyy 'at' h:mm a z",
    'MMMM d, yyyy h:mm a zzz',
    'MMMM d, yyyy'
  ];
  var p;
  for (p = 0; p < patterns.length; p++) {
    try {
      var parsed = Utilities.parseDate(cleaned, MG.TZ, patterns[p]);
      if (parsed && !isNaN(parsed.getTime())) return parsed;
    } catch (ignore) {}
  }
  var monthMatch = cleaned.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b\s+(\d{1,2})\b[^0-9]*(\d{4})/i);
  if (monthMatch) {
    var built = mgBuildDateTime_(monthMatch[3] + '-' + mgMonthNameToNum_(monthMatch[1]) + '-' + mgPad2_(parseInt(monthMatch[2], 10)), '12:00');
    if (built) return built;
  }
  var d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d;
  d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function mgMonthNameToNum_(name) {
  var months = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
  };
  return months[String(name || '').toLowerCase()] || '01';
}

/** True when Requests col A is on or after MG.MANUAL_OVERRIDE_CUTOFF (America/Chicago date). */
function mgIsOnOrAfterManualOverrideCutoff_(timestampRaw) {
  var ts = mgParseRequestTimestamp_(timestampRaw);
  if (!ts) return false;
  var tsDateStr = Utilities.formatDate(ts, MG.TZ, 'yyyy-MM-dd');
  return tsDateStr >= MG.MANUAL_OVERRIDE_CUTOFF;
}

function mgIsManualOverrideSent_(sheet, rowNum) {
  var val = String(sheet.getRange(rowNum, MG.COLS.MANUAL_OVERRIDE_SENT).getValue() || '').trim().toUpperCase();
  return val === 'Y';
}

function mgMarkManualOverrideSent_(sheet, rowNum) {
  sheet.getRange(rowNum, MG.COLS.MANUAL_OVERRIDE_SENT).setValue('Y');
  SpreadsheetApp.flush();
}

/**
 * Dedicated pass: scan Decision column (I) row-by-row — does not rely on getDataRange bounds.
 * @return {number} pings sent
 */
function mgScanAndProcessManualOverridePings_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var sent = 0;
  var rowNum;
  for (rowNum = 2; rowNum <= lastRow; rowNum++) {
    var decision = String(sheet.getRange(rowNum, MG.COLS.DECISION).getValue() || '').trim();
    if (!mgIsManualOverrideDecision_(decision)) continue;
    if (mgIsManualOverrideSent_(sheet, rowNum)) continue;

    var timestampRaw = sheet.getRange(rowNum, MG.COLS.TIMESTAMP).getValue();
    if (!mgIsOnOrAfterManualOverrideCutoff_(timestampRaw)) {
      mgAudit_('MANUAL_OVERRIDE_PING', 'Row ' + rowNum,
        'Skipped — timestamp before ' + MG.MANUAL_OVERRIDE_CUTOFF + ' (raw=' + String(timestampRaw) + ')', 'INFO');
      continue;
    }

    try {
      if (mgProcessManualOverridePing_(sheet, rowNum, timestampRaw)) sent++;
    } catch (err) {
      mgAudit_('ROW_ERROR', 'Row ' + rowNum, 'Manual override ping: ' + String(err && err.stack ? err.stack : err), 'FAILED');
      sheet.getRange(rowNum, MG.COLS.RECOMMENDATION).setValue('Manual override ping failed — check Audit tab.');
    }
  }
  return sent;
}

/** v1.7.2 — WFM set Decision to exactly "APPROVED" after a denial (Recommendation still filled). */
function mgIsLegacyManualApprovalPending_(decision, recommendation) {
  if (String(decision || '').trim().toUpperCase() !== 'APPROVED') return false;
  return String(recommendation || '').trim() !== '';
}

/**
 * WFM set Decision to "APPROVED — manual override" — send BOOKED Slack DM + column L = Y.
 * No Assembled write (WFM already approved outside the capacity gate).
 * @return {boolean} true when ping processed and L marked
 */
function mgProcessManualOverridePing_(sheet, rowNum, timestampRaw) {
  var rowVals = sheet.getRange(rowNum, 1, 1, MG.COLS.SUBMITTER).getValues()[0];
  const managerRaw   = String(rowVals[MG.COLS.MANAGER - 1]   || '').trim();
  const title        = String(rowVals[MG.COLS.TITLE - 1]     || '').trim();
  const dateRaw      = rowVals[MG.COLS.DATE - 1];
  const startRaw     = rowVals[MG.COLS.START - 1];
  const endRaw       = rowVals[MG.COLS.END - 1];
  const submitterRaw = String(rowVals[MG.COLS.SUBMITTER - 1] || '').trim();

  const dateStr  = mgParseDateStr_(dateRaw);
  const startStr = mgParseTimeInt_(startRaw);
  const endStr   = mgParseTimeInt_(endRaw);
  if (!dateStr || !startStr || !endStr) {
    mgAudit_('MANUAL_OVERRIDE_PING', 'Row ' + rowNum,
      'Could not parse date/time — date=' + dateRaw + ' start=' + startRaw + ' end=' + endRaw, 'FAILED');
    sheet.getRange(rowNum, MG.COLS.RECOMMENDATION).setValue(
      'Manual override ping failed — could not parse date/time.');
    return false;
  }

  mgAudit_('MANUAL_OVERRIDE_PING', 'Row ' + rowNum,
    'Sending BOOKED Slack for WFM manual override | ' + title + ' | submitter=' + submitterRaw, 'INFO');

  const roster      = mgLoadRoster_();
  const managerName = roster.length ? mgResolveManagerName_(managerRaw, roster) : mgNormalizeManagerName_(managerRaw);
  const managerEmail = managerName ? mgResolveManagerEmail_(managerName) : '';
  const meetLink    = mgGetManagerMeetLink_(managerEmail, managerName);
  const meetLine    = meetLink
    ? '\n\n\uD83C\uDF9E Your Google Meet link: ' + meetLink +
      '\nReps will see the Meet link on their Google Calendar invite.'
    : '';

  const slackMsg = mgBuildApprovalSlackMsg_(title, dateStr, startStr, endStr,
    'You\'re booked — added to your team\'s schedules. You\'re good to go!',
    meetLine, null, '', MG_SLACK_LABEL.BOOKED, '');
  mgMarkManualOverrideSent_(sheet, rowNum);
  mgSlackDmSubmitter_(submitterRaw, slackMsg);
  mgAudit_('MANUAL_OVERRIDE_PING', 'Row ' + rowNum,
    'BOOKED Slack sent to ' + submitterRaw + ' | L=Y | ts=' +
    (mgParseRequestTimestamp_(timestampRaw)
      ? Utilities.formatDate(mgParseRequestTimestamp_(timestampRaw), MG.TZ, 'yyyy-MM-dd HH:mm')
      : String(timestampRaw)),
    'OK');
  return true;
}

/**
 * Legacy manual override: commit Meeting blocks + approval DM, bypassing capacity gate.
 * Triggered when WFM sets Decision to exactly "APPROVED" (keeps denial Recommendation).
 */
function mgProcessManualApproval_(sheet, row, rowNum) {
  const managerRaw   = String(row[MG.COLS.MANAGER - 1]   || '').trim();
  const title        = String(row[MG.COLS.TITLE - 1]     || '').trim();
  const dateRaw      = row[MG.COLS.DATE - 1];
  const startRaw     = row[MG.COLS.START - 1];
  const endRaw       = row[MG.COLS.END - 1];
  const submitterRaw = String(row[MG.COLS.SUBMITTER - 1] || '').trim();
  const manualRaw    = row[MG.COLS.ATTENDEES - 1];

  mgAudit_('MANUAL_APPROVE', 'Row ' + rowNum,
    'WFM override — committing without capacity check | ' + title, 'INFO');

  const roster = mgLoadRoster_();
  if (!roster.length) {
    mgWriteResult_(sheet, rowNum, 'ERROR', 'Import Roster tab is empty or missing.');
    return;
  }

  const managerName = mgResolveManagerName_(managerRaw, roster);
  if (!managerName) {
    mgWriteResult_(sheet, rowNum, 'ERROR', 'Could not parse manager name from: ' + managerRaw);
    return;
  }
  if (mgNormManagerKey_(managerRaw) !== mgNormManagerKey_(managerName)) {
    mgAudit_('MANAGER_MATCH', 'Row ' + rowNum, 'Resolved "' + managerRaw + '" → "' + managerName + '"', 'INFO');
  }
  const managerEmail = mgResolveManagerEmail_(managerName);

  const dateStr  = mgParseDateStr_(dateRaw);
  const startStr = mgParseTimeInt_(startRaw);
  const endStr   = mgParseTimeInt_(endRaw);
  if (!dateStr || !startStr || !endStr) {
    mgWriteResult_(sheet, rowNum, 'ERROR',
      'Could not parse date/time. Got: date=' + dateRaw + ' start=' + startRaw + ' end=' + endRaw);
    return;
  }

  const meetingStart = mgBuildDateTime_(dateStr, startStr);
  const meetingEnd   = mgBuildDateTime_(dateStr, endStr);
  if (!meetingStart || !meetingEnd || meetingEnd <= meetingStart) {
    mgWriteResult_(sheet, rowNum, 'ERROR', 'Invalid meeting window: ' + dateStr + ' ' + startStr + '-' + endStr);
    return;
  }

  const teamRes = mgResolveManagerTeamForRequest_(roster, managerName, managerRaw, manualRaw);
  if (!teamRes.ok) {
    mgWriteResult_(sheet, rowNum, 'ERROR', teamRes.error);
    return;
  }
  const teamFull = teamRes.teamFull;

  const filterRes = mgApplyManualAttendeeFilter_(teamFull, manualRaw, roster, managerName);
  if (filterRes.error) {
    mgWriteResult_(sheet, rowNum, 'ERROR', filterRes.error);
    return;
  }
  const team = filterRes.members;
  if (filterRes.unmatched && filterRes.unmatched.length) {
    mgAudit_('ATTENDEE_FILTER', 'Row ' + rowNum,
      'Some names did not match the roster: ' + filterRes.unmatched.join('; '), 'WARN');
  }

  const apiKey  = mgGetApiKey_();
  const headers = mgAuthHeaders_(apiKey);
  const scheduledEmails    = mgGetScheduledEmails_(headers, meetingStart, meetingEnd);
  const scheduledAttendees = team.filter(function(r) {
    return scheduledEmails.has(r.email);
  });

  mgAudit_('MANUAL_APPROVE', 'Row ' + rowNum,
    'Scheduled during window: ' + scheduledAttendees.length + ' of ' + team.length, 'INFO');

  if (!scheduledAttendees.length) {
    mgWriteResult_(sheet, rowNum, 'ERROR',
      'Manual approval: no attendees from this list are scheduled during the window. Check times or roster.');
    return;
  }

  const testMode      = mgIsTestMode_();
  const commitTargets = testMode ? scheduledAttendees.slice(0, 1) : scheduledAttendees;
  const commitResult  = mgCommitMeetingToAssembled_(
    headers, commitTargets, meetingStart, meetingEnd, rowNum, title, managerEmail, managerName
  );

  const meetLink = mgGetManagerMeetLink_(managerEmail, managerName);

  var decision;
  var slackMsg;
  if (!commitResult.failed.length) {
    const addedName = commitTargets[0] ? commitTargets[0].name : 'unknown';
    const meetLine = mgFormatMeetSlackLine_(meetLink, commitResult.calendar);
    decision = testMode
      ? 'APPROVED — manual override (TEST: ' + addedName + ')'
      : 'APPROVED — manual override';
    var footer = testMode
      ? '\n\n_\u26a0\ufe0f TEST MODE — only ' + addedName +
        '\'s schedule was updated in Assembled as a proof of concept. Please remove it manually._'
      : '';
    slackMsg = mgWrapApprovalSlack_(title, dateStr, startStr, endStr,
      'You\'re booked — added to your team\'s schedules. You\'re good to go!',
      meetLine, commitResult, footer, {
        managerRaw: managerRaw, submitterRaw: submitterRaw, sourceRowNum: rowNum, managerEmail: managerEmail
      });
  } else {
    const failedNames = commitResult.failed.join(', ');
    decision = 'APPROVED — manual override — Assembled Error: ' + failedNames;
    var intro = 'You\'re booked';
    if (commitResult.succeeded.length) {
      intro += ' — added to most of your team\'s schedules.';
    } else {
      intro += ', but there was an error writing to Assembled.';
    }
    intro += ' WFM has been notified of the scheduling error for: ' + failedNames + '.';
    slackMsg = mgWrapApprovalSlack_(title, dateStr, startStr, endStr, intro,
      mgFormatMeetSlackLine_(meetLink, commitResult.calendar), commitResult, '', {
        managerRaw: managerRaw, submitterRaw: submitterRaw, sourceRowNum: rowNum, managerEmail: managerEmail
      });
  }

  var rec = 'WFM manual override (capacity gate bypassed).';
  if (filterRes.unmatched && filterRes.unmatched.length) {
    rec += ' Unmatched names: ' + filterRes.unmatched.join('; ');
  }

  mgWriteResult_(sheet, rowNum, decision, rec);
  mgSlackDmSubmitter_(submitterRaw, slackMsg);
  var tsRaw = sheet.getRange(rowNum, MG.COLS.TIMESTAMP).getValue();
  if (mgIsOnOrAfterManualOverrideCutoff_(tsRaw)) {
    mgMarkManualOverrideSent_(sheet, rowNum);
  }
  mgAudit_('DECISION', 'Row ' + rowNum, 'MANUAL OVERRIDE — committed ' + commitResult.succeeded.length + ' rep(s)', 'OK');
}

/***************************************
 * ROW PROCESSOR
 ***************************************/
/** Claim row before slow Assembled/Slack work — avoids duplicate DMs if Run Now overlaps the 5-min trigger. */
function mgTryClaimRequestRow_(sheet, rowNum) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) {
    mgAudit_('LOCK', 'Row ' + rowNum, 'Could not acquire lock to claim row', 'WARN');
    return false;
  }
  try {
    const decision = String(sheet.getRange(rowNum, MG.COLS.DECISION).getValue() || '').trim();
    if (decision !== '') {
      mgAudit_('SKIP', 'Row ' + rowNum, 'Already processed: ' + decision, 'INFO');
      return false;
    }
    sheet.getRange(rowNum, MG.COLS.DECISION).setValue('PROCESSING');
    SpreadsheetApp.flush();
    return true;
  } finally {
    lock.releaseLock();
  }
}

function mgProcessRow_(sheet, row, rowNum) {
  if (!mgTryClaimRequestRow_(sheet, rowNum)) return;

  const managerRaw   = String(row[MG.COLS.MANAGER - 1]   || '').trim();
  const title        = String(row[MG.COLS.TITLE - 1]     || '').trim();
  const dateRaw      = row[MG.COLS.DATE - 1];
  const startRaw     = row[MG.COLS.START - 1];
  const endRaw       = row[MG.COLS.END - 1];
  const submitterRaw = String(row[MG.COLS.SUBMITTER - 1] || '').trim();

  mgAudit_('PROCESS', 'Row ' + rowNum,
    'Manager: ' + managerRaw + ' | Title: ' + title +
    ' | Date: ' + dateRaw + ' | Start: ' + startRaw + ' | End: ' + endRaw +
    ' | Manual attendees: ' + String(row[MG.COLS.ATTENDEES - 1] || '').trim(),
    'INFO');

  const dateStr  = mgParseDateStr_(dateRaw);
  const startStr = mgParseTimeInt_(startRaw);
  const endStr   = mgParseTimeInt_(endRaw);
  if (!dateStr || !startStr || !endStr) {
    mgWriteResult_(sheet, rowNum, 'ERROR',
      'Could not parse date/time. Got: date=' + dateRaw + ' start=' + startRaw + ' end=' + endRaw);
    return;
  }

  const meetingStart = mgBuildDateTime_(dateStr, startStr);
  const meetingEnd   = mgBuildDateTime_(dateStr, endStr);
  if (!meetingStart || !meetingEnd || meetingEnd <= meetingStart) {
    mgWriteResult_(sheet, rowNum, 'ERROR', 'Invalid meeting window: ' + dateStr + ' ' + startStr + '-' + endStr);
    return;
  }

  const roster = mgLoadRoster_();
  if (!roster.length) {
    mgWriteResult_(sheet, rowNum, 'ERROR', 'Import Roster tab is empty or missing.');
    return;
  }

  const managerName = mgResolveManagerName_(managerRaw, roster);
  if (!managerName) {
    mgWriteResult_(sheet, rowNum, 'ERROR', 'Could not parse manager name from: ' + managerRaw);
    return;
  }
  if (mgNormManagerKey_(managerRaw) !== mgNormManagerKey_(managerName)) {
    mgAudit_('MANAGER_MATCH', 'Row ' + rowNum, 'Resolved "' + managerRaw + '" → "' + managerName + '"', 'INFO');
  }

  const managerEmail = mgResolveManagerEmail_(managerName);
  const manualRaw    = row[MG.COLS.ATTENDEES - 1];

  if (mgIsSuperSubmitter_(submitterRaw)) {
    mgProcessSuperSubmitApprove_(sheet, rowNum, roster, managerName, managerEmail, title, dateStr, startStr, endStr,
      meetingStart, meetingEnd, submitterRaw, manualRaw);
    return;
  }

  const config    = mgLoadConfig_();
  const isWfmAuto = mgIsWfmAutoSubmitter_(submitterRaw);

  var blackoutHit = mgGetMeetingBlackoutHit_(dateStr, meetingStart, config);
  if (blackoutHit) {
    mgDenyMeetingBlackout_(sheet, rowNum, title, dateStr, startStr, endStr, submitterRaw, blackoutHit);
    return;
  }

  if (!isWfmAuto) {
    const minNoticeHours = Number(config[MG.CFG.MIN_NOTICE_HOURS] || 2);
    const noticeMs       = minNoticeHours * 60 * 60 * 1000;
    const now            = new Date();
    if (meetingStart.getTime() - now.getTime() < noticeMs) {
      const msg = mgSlackMeetingHeader_(MG_SLACK_LABEL.CANT_BOOK, title) +
        'Requested: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
        'Meeting requests must be submitted at least ' + minNoticeHours + ' hour(s) in advance. ' +
        'Please resubmit with more notice.';
      mgWriteResult_(sheet, rowNum, 'DENIED — insufficient notice', '');
      mgSlackDmSubmitter_(submitterRaw, msg);
      mgAudit_('NOTICE_CHECK', 'Row ' + rowNum,
        'Denied — meeting starts in less than ' + minNoticeHours + 'h', 'OK');
      return;
    }
  }

  if (!isWfmAuto) {
    const minDurationMins = Number(config[MG.CFG.MIN_DURATION_MINUTES] || 30);
    const durationMins    = (meetingEnd.getTime() - meetingStart.getTime()) / 60000;
    if (durationMins < minDurationMins) {
      const meetLink = mgGetManagerMeetLink_(managerEmail, managerName);
      const meetLine = meetLink ? '\n\n\uD83C\uDF9E Your Google Meet link: ' + meetLink : '';
      const msg = mgSlackMeetingHeader_(MG_SLACK_LABEL.BOOKED, title) +
        'Date: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
        'Meetings under ' + minDurationMins + ' minutes are auto-booked. You\'re good to go!' + meetLine;
      mgWriteResult_(sheet, rowNum, 'APPROVED — under duration threshold', '');
      mgSlackDmSubmitter_(submitterRaw, msg);
      mgAudit_('DURATION_CHECK', 'Row ' + rowNum,
        'Auto-approved — ' + durationMins + ' min is under threshold of ' + minDurationMins + ' min', 'OK');
      return;
    }
  }

  const coachCtx      = mgCoachLeadGroupContext_(manualRaw, submitterRaw, roster, managerName);
  const effectiveManual = coachCtx.effectiveManual;
  const teamRes = mgResolveManagerTeamForRequest_(roster, managerName, managerRaw, effectiveManual);
  if (!teamRes.ok) {
    var coachMgrHint = mgCoachLeadManagerFieldHint_(managerName, submitterRaw, roster);
    mgWriteResult_(sheet, rowNum, 'ERROR', teamRes.error + (coachMgrHint ? (' ' + coachMgrHint) : ''));
    return;
  }
  const teamFull = teamRes.teamFull;
  if (coachCtx.groupAlias) {
    mgAudit_('COACH_GROUP', 'Row ' + rowNum,
      'Submitter scoped to "' + coachCtx.groupAlias + '" from Leadership role "' + coachCtx.role + '"',
      'INFO');
  }
  const filterRes = mgApplyManualAttendeeFilter_(teamFull, effectiveManual, roster, managerName);
  if (filterRes.error) {
    mgWriteResult_(sheet, rowNum, 'ERROR', filterRes.error);
    return;
  }
  const team = filterRes.members;
  if (filterRes.unmatched && filterRes.unmatched.length) {
    mgAudit_('ATTENDEE_FILTER', 'Row ' + rowNum,
      'Some names did not match the roster: ' + filterRes.unmatched.join('; '), 'WARN');
  }

  if (isWfmAuto) {
    mgProcessWfmAutoApprove_(sheet, rowNum, team, title, dateStr, startStr, endStr,
      meetingStart, meetingEnd, submitterRaw, filterRes.unmatched, managerEmail, managerName, managerRaw, roster);
    return;
  }

  mgAudit_('TEAM', 'Row ' + rowNum,
    'Manager: ' + managerName + ' | Pool: ' + team.length +
    (String(manualRaw || '').trim() ? ' (manual list)' : ' (full team)') +
    ' | Queue: ' + (mgResolveTeamQueue_(team, managerName, submitterRaw, roster) || 'unknown'),
    'INFO');

  const l7Enabled = mgConfigBool_(config, MG.CFG.L7_OVERRIDE, true);
  const isL7      = l7Enabled && mgIsL7Manager_(roster, managerName);

  if (isL7) {
    mgAudit_('L7_OVERRIDE', 'Row ' + rowNum,
      managerName + ' is a Senior Manager — auto-approving', 'OK');

    const apiKeyL7  = mgGetApiKey_();
    const headersL7 = mgAuthHeaders_(apiKeyL7);
    const scheduledEmailsL7 = mgGetScheduledEmails_(headersL7, meetingStart, meetingEnd);
    const scheduledAttendeesL7 = team.filter(function(r) {
      return scheduledEmailsL7.has(r.email);
    });

    const siteIdL7  = mgResolveSiteId_(headersL7, MG.ASSEMBLED.SITE_NAME);
    const queueIdL7 = mgResolveQueueId_(headersL7, mgResolveTeamQueue_(team, managerName, submitterRaw, roster) || '');
    var netL7 = 'N/A';
    if (queueIdL7) {
      netL7 = mgGetNetStaffingForWindow_(headersL7, siteIdL7, queueIdL7, meetingStart, meetingEnd);
    }

    const testMode      = mgIsTestMode_();
    const commitTargets = testMode ? scheduledAttendeesL7.slice(0, 1) : scheduledAttendeesL7;
    const commitResult  = mgCommitMeetingToAssembled_(headersL7, commitTargets, meetingStart, meetingEnd, rowNum, title, managerEmail, managerName);
    const failedNames   = commitResult.failed.join(', ');
    const decision      = commitResult.failed.length
      ? 'APPROVED (L7) — Assembled Error: ' + failedNames
      : (testMode ? 'APPROVED (L7) — TEST: added to ' + (commitTargets[0] ? commitTargets[0].name : '') : 'APPROVED (L7)');

    const meetLink = mgGetManagerMeetLink_(managerEmail, managerName);
    const managerMsg = mgWrapApprovalSlack_(title, dateStr, startStr, endStr,
      'You\'re booked — added to your team\'s schedules.',
      mgFormatMeetSlackLine_(meetLink, commitResult.calendar), commitResult, '', {
        managerRaw: managerRaw, submitterRaw: submitterRaw, sourceRowNum: rowNum, managerEmail: managerEmail
      });
    mgSlackDmSubmitter_(submitterRaw, managerMsg);

    const postNet   = isFinite(Number(netL7)) ? (Number(netL7) - scheduledAttendeesL7.length) : 'N/A';
    const bobbyMsg  = '\u26a0\ufe0f *L7 Override — Meeting Auto-Approved*\n' +
      'Manager: *' + managerName + '*\n' +
      'Meeting: _' + title + '_\n' +
      'Date: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
      'Scheduled attendees: ' + scheduledAttendeesL7.length + '\n' +
      'Net staffing before: ' + netL7 + ' | After: ' + postNet + '\n' +
      '_This meeting bypassed the capacity gate as an L7 override._';
    const bobbyId = mgSlackLookupUserId_('robert.sorrell');
    if (bobbyId) mgSlackSendDm_(bobbyId, bobbyMsg);

    mgWriteResult_(sheet, rowNum, decision, '');
    return;
  }

  const queue = mgResolveTeamQueue_(team, managerName, submitterRaw, roster);
  if (!queue) {
    mgWriteResult_(sheet, rowNum, 'ERROR',
      'Could not map work group to Assembled queue for ' + managerName + '\'s team.');
    return;
  }

  const apiKey  = mgGetApiKey_();
  const headers = mgAuthHeaders_(apiKey);
  const scheduledEmails    = mgGetScheduledEmails_(headers, meetingStart, meetingEnd);
  const scheduledAttendees = team.filter(function(r) {
    return scheduledEmails.has(r.email);
  });

  mgAudit_('SCHEDULED', 'Row ' + rowNum,
    'Team members scheduled during window: ' + scheduledAttendees.length + ' of ' + team.length,
    'INFO');

  if (!scheduledAttendees.length) {
    const msg = '\u26a0\ufe0f *HEADS UP* — Meeting: _' + title + '_\n' +
      'Requested: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
      'We don\'t see any of your team scheduled during this window. Are you sure this is the right time?\n\n' +
      'If this is intentional, no staffing impact was found. If not, please resubmit with the correct time.';
    mgWriteResult_(sheet, rowNum, 'FLAGGED — no scheduled attendees', '');
    mgSlackDmSubmitter_(submitterRaw, msg);
    return;
  }

  const minAttendees = Number(config[MG.CFG.MIN_ATTENDEES] || 3);
  if (scheduledAttendees.length < minAttendees) {
    const meetLink = mgGetManagerMeetLink_(managerEmail, managerName);
    const meetLine = meetLink ? '\n\n\uD83C\uDF9E Your Google Meet link: ' + meetLink : '';
    const msg = mgSlackMeetingHeader_(MG_SLACK_LABEL.BOOKED, title) +
      'Date: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
      'Meetings with fewer than ' + minAttendees + ' scheduled attendees are auto-booked. You\'re good to go!' + meetLine;
    mgWriteResult_(sheet, rowNum, 'APPROVED — under attendee threshold', '');
    mgSlackDmSubmitter_(submitterRaw, msg);
    mgAudit_('ATTENDEE_CHECK', 'Row ' + rowNum,
      'Auto-approved — ' + scheduledAttendees.length + ' attendees is under threshold of ' + minAttendees, 'OK');
    return;
  }

  const siteId  = mgResolveSiteId_(headers, MG.ASSEMBLED.SITE_NAME);
  const queueId = mgResolveQueueId_(headers, queue);
  if (!queueId) {
    mgWriteResult_(sheet, rowNum, 'ERROR', 'Could not resolve Assembled queue ID for: ' + queue);
    return;
  }

  const netStaffing = mgGetNetStaffingForWindow_(headers, siteId, queueId, meetingStart, meetingEnd);
  mgAudit_('NET_STAFFING', 'Row ' + rowNum,
    'Queue: ' + queue + ' | Net: ' + netStaffing + ' | Attendees: ' + scheduledAttendees.length +
    ' | Post-meeting net: ' + (netStaffing - scheduledAttendees.length),
    'INFO');

  const postMeetingNet      = netStaffing - scheduledAttendees.length;
  const minBuffer           = mgGetStaffingMinBuffer_(config);
  const maxRepsAtRequested  = Math.max(0, Math.floor(netStaffing - minBuffer));

  if (postMeetingNet >= minBuffer) {
    mgAudit_('DECISION', 'Row ' + rowNum, 'APPROVED — committing to Assembled', 'OK');
    const testMode      = mgIsTestMode_();
    const commitTargets = testMode ? scheduledAttendees.slice(0, 1) : scheduledAttendees;

    if (testMode) {
      mgAudit_('ASSEMBLED_COMMIT', 'Row ' + rowNum,
        'TEST MODE — committing first rep only: ' +
        (commitTargets[0] ? commitTargets[0].name + ' (' + commitTargets[0].email + ')' : 'none'),
        'INFO');
    }

    const commitResult = mgCommitMeetingToAssembled_(
      headers, commitTargets, meetingStart, meetingEnd, rowNum, title, managerEmail, managerName
    );

    const meetLink = mgGetManagerMeetLink_(managerEmail, managerName);

    var decision;
    var slackMsg;
    if (!commitResult.failed.length) {
      const addedName = commitTargets[0] ? commitTargets[0].name : 'unknown';
      const meetLine = mgFormatMeetSlackLine_(meetLink, commitResult.calendar);
      decision = testMode ? 'APPROVED — TEST: added to ' + addedName : 'APPROVED';
      var approveFooter = testMode
        ? '\n\n_\u26a0\ufe0f TEST MODE — only ' + addedName +
          '\'s schedule was updated in Assembled as a proof of concept. Please remove it manually._'
        : '';
      slackMsg = mgWrapApprovalSlack_(title, dateStr, startStr, endStr,
        'You\'re booked — added to your team\'s schedules. You\'re good to go!',
        meetLine, commitResult, approveFooter, {
          managerRaw: managerRaw, submitterRaw: submitterRaw, sourceRowNum: rowNum, managerEmail: managerEmail,
          manualRaw: String(row[MG.COLS.ATTENDEES - 1] || '')
        });
    } else {
      const failedNames = commitResult.failed.join(', ');
      decision = 'APPROVED — Assembled Error: ' + failedNames;
      var partialIntro = 'You\'re booked';
      if (commitResult.succeeded.length) {
        partialIntro += ' — added to most of your team\'s schedules.';
      } else {
        partialIntro += ', but there was an error writing to Assembled.';
      }
      partialIntro += ' WFM has been notified of the scheduling error for: ' + failedNames + '.';
      slackMsg = mgWrapApprovalSlack_(title, dateStr, startStr, endStr, partialIntro,
        mgFormatMeetSlackLine_(meetLink, commitResult.calendar), commitResult, '', {
          managerRaw: managerRaw, submitterRaw: submitterRaw, sourceRowNum: rowNum, managerEmail: managerEmail
        });
    }

    mgWriteResult_(sheet, rowNum, decision, '');
    mgSlackDmSubmitter_(submitterRaw, slackMsg);
    return;
  }

  var attendeeCtx = mgAttendeeGroupDescriptor_(manualRaw, scheduledAttendees.length, team.length);

  mgAudit_('SEARCH', 'Row ' + rowNum,
    'Denied — searching next ' + MG.SEARCH_DAYS + ' days for alternative windows', 'INFO');

  const meetingDurationMs = meetingEnd.getTime() - meetingStart.getTime();
  const alternatives      = mgFindAlternativeWindows_(
    headers, siteId, queueId, meetingStart, scheduledAttendees.length,
    meetingDurationMs, MG.SEARCH_DAYS, meetingStart, meetingEnd
  );

  if (alternatives.length) {
    var emailsCsv = scheduledAttendees.map(function(r) { return r.email; }).join(',');
    var manualRawStr = String(row[MG.COLS.ATTENDEES - 1] || '');
    const altLines = alternatives.slice(0, 3).map(function(a) {
      var tok = mgCreateBookingToken_({
        managerRaw:   managerRaw,
        submitterRaw: submitterRaw,
        title:        title,
        manualRaw:    manualRawStr,
        dateStr:      a.dateStr,
        startStr:     a.startStr,
        endStr:       a.endStr,
        emailsCsv:    emailsCsv,
        sourceRowNum: rowNum
      });
      var book = mgBuildBookItSlackLink_(tok);
      var line = '\u2022 ' + mgFriendlyDate_(a.dateStr) + ', ' + mgFriendlyTime_(a.startStr) + '\u2013' + mgFriendlyTime_(a.endStr) + ' CT';
      return book ? (line + '  ' + book) : line;
    });
    var capLineAlt = mgCapLineAtRequested_(maxRepsAtRequested, scheduledAttendees.length, attendeeCtx);
    if (maxRepsAtRequested > 0) {
      capLineAlt += ' If you still want that exact time, resubmit with that many (or fewer) people on your attendee list.';
    }
    var bookHint = mgGetWebAppUrl_()
      ? '\n\n_Tap the 📅 Book it link next to a time to reserve instantly — no form required._'
      : '\n\n_Set Script Property MG_WEB_APP_URL to enable one-click Book it links._';
    const msg = mgSlackMeetingHeader_(MG_SLACK_LABEL.CANT_BOOK, title) +
      'Requested: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
      'Can\'t book at that time with ' + attendeeCtx.groupPhrase + '.' + capLineAlt + '\n\n' +
      '*These times work:*\n' + altLines.join('\n') + bookHint;
    mgWriteResult_(sheet, rowNum, 'DENIED',
      'Max at requested time: ' + maxRepsAtRequested + ' rep(s). Alt windows: ' + alternatives.slice(0, 3).map(function(a) {
        return a.dateStr + ' ' + a.startStr + '-' + a.endStr;
      }).join(' | '));
    mgSlackDmSubmitter_(submitterRaw, msg);
    mgAudit_('DECISION', 'Row ' + rowNum, 'DENIED — alternatives found (+ Book it)', 'OK');
    return;
  }

  mgAudit_('SPLIT', 'Row ' + rowNum, 'No single window found — attempting split', 'INFO');
  const splitSize = Math.ceil(scheduledAttendees.length / 2);
  mgAudit_('SPLIT', 'Row ' + rowNum,
    'Net at requested: ' + netStaffing + ' | Split size: ' + splitSize +
    ' | Total scheduled: ' + scheduledAttendees.length,
    'INFO');

  const groupA = scheduledAttendees.slice(0, splitSize);
  const groupB = scheduledAttendees.slice(splitSize);

  const slotA = mgFindAlternativeWindows_(
    headers, siteId, queueId, meetingStart, groupA.length, meetingDurationMs, MG.SEARCH_DAYS, meetingStart, meetingEnd
  );
  const slotB = mgFindAlternativeWindows_(
    headers, siteId, queueId, meetingStart, groupB.length, meetingDurationMs, MG.SEARCH_DAYS, meetingStart, meetingEnd,
    { excludeSlots: slotA.length ? [slotA[0]] : [], maxResults: 1 }
  );

  const groupANames = groupA.map(function(r) { return r.name; }).join(', ');
  const groupBNames = groupB.map(function(r) { return r.name; }).join(', ');

  var capLineSplit = mgCapLineAtRequested_(maxRepsAtRequested, scheduledAttendees.length, attendeeCtx);
  if (maxRepsAtRequested > 0) {
    capLineSplit += ' If you still want that exact time, resubmit with that many (or fewer) people on your attendee list.';
  }

  var manualRawStrSplit = String(row[MG.COLS.ATTENDEES - 1] || '');
  var splitBookHint = mgGetWebAppUrl_()
    ? '\n\n_Tap 📅 Book it next to each session time to reserve._'
    : '';

  var splitMsg;
  var splitRec;
  if (slotA.length && slotB.length) {
    var tokA = mgCreateBookingToken_({
      managerRaw: managerRaw, submitterRaw: submitterRaw, title: title + ' (Session 1)',
      manualRaw: manualRawStrSplit,
      dateStr: slotA[0].dateStr, startStr: slotA[0].startStr, endStr: slotA[0].endStr,
      emailsCsv: groupA.map(function(r) { return r.email; }).join(','),
      sourceRowNum: rowNum
    });
    var tokB = mgCreateBookingToken_({
      managerRaw: managerRaw, submitterRaw: submitterRaw, title: title + ' (Session 2)',
      manualRaw: manualRawStrSplit,
      dateStr: slotB[0].dateStr, startStr: slotB[0].startStr, endStr: slotB[0].endStr,
      emailsCsv: groupB.map(function(r) { return r.email; }).join(','),
      sourceRowNum: rowNum
    });
    var bookA = mgBuildBookItSlackLink_(tokA);
    var bookB = mgBuildBookItSlackLink_(tokB);
    var lineA = '\u2022 ' + mgFriendlyDate_(slotA[0].dateStr) + ', ' + mgFriendlyTime_(slotA[0].startStr) + '\u2013' + mgFriendlyTime_(slotA[0].endStr) + ' CT';
    var lineB = '\u2022 ' + mgFriendlyDate_(slotB[0].dateStr) + ', ' + mgFriendlyTime_(slotB[0].startStr) + '\u2013' + mgFriendlyTime_(slotB[0].endStr) + ' CT';
    splitMsg = mgSlackMeetingHeader_(MG_SLACK_LABEL.CANT_BOOK, title) +
      'Requested: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
      'Can\'t book everyone at once.' + capLineSplit + '\n\n*Split into two sessions:*\n\n' +
      '\uD83D\uDC65 *Session 1* (' + groupA.length + '): ' + groupANames + '\n' +
      lineA + (bookA ? ('  ' + bookA) : '') + '\n\n' +
      '\uD83D\uDC65 *Session 2* (' + groupB.length + '): ' + groupBNames + '\n' +
      lineB + (bookB ? ('  ' + bookB) : '') + splitBookHint + '\n\n' +
      '_Book each session separately, or resubmit manually._';
    splitRec = 'Max at requested time: ' + maxRepsAtRequested + ' rep(s). Split recommended. Session 1 (' + groupA.length + '): ' + slotA[0].dateStr + ' ' + slotA[0].startStr +
      ' | Session 2 (' + groupB.length + '): ' + slotB[0].dateStr + ' ' + slotB[0].startStr;
  } else if (slotA.length && !slotB.length) {
    splitMsg = mgBuildCantBookNoWindowsMsg_(title, dateStr, startStr, endStr, attendeeCtx, capLineSplit);
    splitRec = 'Max at requested time: ' + maxRepsAtRequested + ' rep(s). Async recommended — Session 2 (' + groupB.length + ' reps) exceeds capacity across 7 days.';
  } else {
    splitMsg = mgBuildCantBookNoWindowsMsg_(title, dateStr, startStr, endStr, attendeeCtx, capLineSplit);
    splitRec = 'Max at requested time: ' + maxRepsAtRequested + ' rep(s). Async recommended — no viable windows found across 7 days.';
  }

  mgWriteResult_(sheet, rowNum, 'DENIED', splitRec);
  mgSlackDmSubmitter_(submitterRaw, splitMsg);
  mgAudit_('DECISION', 'Row ' + rowNum, 'DENIED — split attempted. SlotA: ' + slotA.length + ' SlotB: ' + slotB.length, 'OK');
}

/***************************************
 * SUPER SUBMITTER AUTO-APPROVE (admin)
 ***************************************/
function mgResolveSuperSubmitPool_(manualRaw, roster, managerName) {
  var raw = String(manualRaw || '').trim();
  if (mgIsAllAudienceToken_(raw)) {
    var all = roster.filter(function(r) { return r.email && r.queue; });
    if (!all.length) {
      return { members: [], unmatched: [], error: 'No Import Roster rows with a mapped Consumer Sales queue.' };
    }
    return { members: all, unmatched: [], error: null, scope: 'all consumer sales' };
  }
  if (!raw) {
    var team = mgGetTeamForManager_(roster, managerName);
    if (team.length) {
      return { members: team, unmatched: [], error: null, scope: 'manager team' };
    }
    return {
      members:   [],
      unmatched: [],
      error:     'Enter attendees: *all*, a group (hs, college, pc, eld, al, ...), or rep names.',
      scope:     ''
    };
  }
  var filterRes = mgApplyManualAttendeeFilter_(roster, manualRaw, roster);
  if (filterRes.error) {
    return { members: [], unmatched: filterRes.unmatched, error: filterRes.error, scope: 'manual' };
  }
  return {
    members:   filterRes.members,
    unmatched: filterRes.unmatched,
    error:     null,
    scope:     'manual'
  };
}

function mgProcessSuperSubmitApprove_(sheet, rowNum, roster, managerName, managerEmail, title, dateStr, startStr, endStr,
  meetingStart, meetingEnd, submitterRaw, manualRaw) {
  mgAudit_('SUPER_SUBMIT', 'Row ' + rowNum,
    'Admin auto-approve | Manager: ' + managerName + ' | Audience: ' + String(manualRaw || '').trim(),
    'OK');

  var poolRes = mgResolveSuperSubmitPool_(manualRaw, roster, managerName);
  if (poolRes.error) {
    mgWriteResult_(sheet, rowNum, 'ERROR', poolRes.error);
    return;
  }
  if (!poolRes.members.length) {
    mgWriteResult_(sheet, rowNum, 'ERROR', 'No attendees resolved for this request.');
    return;
  }

  var apiKey  = mgGetApiKey_();
  var headers = mgAuthHeaders_(apiKey);
  var scheduledEmails    = mgGetScheduledEmails_(headers, meetingStart, meetingEnd);
  var scheduledAttendees = poolRes.members.filter(function(r) {
    return scheduledEmails.has(r.email);
  });

  var commitTargets = scheduledAttendees;
  var commitResult  = mgCommitMeetingToAssembled_(headers, commitTargets, meetingStart, meetingEnd, rowNum, title, managerEmail, managerName);
  var failedNames   = commitResult.failed.join(', ');

  var decision = !commitResult.failed.length
    ? 'APPROVED (super submit)'
    : 'APPROVED (super submit) — Assembled Error: ' + failedNames;

  var rec = 'Scope: ' + (poolRes.scope || 'manual') + ' | Pool: ' + poolRes.members.length +
    ' | Scheduled in window: ' + scheduledAttendees.length;
  if (poolRes.unmatched && poolRes.unmatched.length) {
    rec += ' | Unmatched: ' + poolRes.unmatched.join('; ');
  }

  var meetLink = mgGetManagerMeetLink_(managerEmail, managerName);
  var meetLine = mgFormatMeetSlackLine_(meetLink, commitResult.calendar);

  var intro = 'Auto-booked (admin submitter) — Meeting blocks written for *' + scheduledAttendees.length +
    '* rep' + (scheduledAttendees.length === 1 ? '' : 's') + ' scheduled in this window';
  if (poolRes.scope === 'all consumer sales') {
    intro += ' (all Consumer Sales groups)';
  } else if (poolRes.scope === 'manager team') {
    intro += ' (' + managerName + '\'s full team)';
  }
  intro += '.';
  if (!scheduledAttendees.length) {
    intro += '\n\n_Note: No one in your audience pool was on a working schedule during this window; nothing was written to Assembled._';
  } else if (scheduledAttendees.length < poolRes.members.length) {
    intro += '\n\n_' + (poolRes.members.length - scheduledAttendees.length) +
      ' roster match(es) were not on schedule in this window and were skipped._';
  }
  if (mgIsTestMode_()) {
    intro += '\n\n_TEST MODE is on for Slack only — this admin path still committed all scheduled matches above._';
  }

  var slackMsg = mgWrapApprovalSlack_(title, dateStr, startStr, endStr, intro, meetLine, commitResult, '', {
    managerRaw: managerName, submitterRaw: submitterRaw, sourceRowNum: rowNum, managerEmail: managerEmail,
    emailsCsv: scheduledAttendees.map(function(r) { return r.email; }).join(',')
  });
  mgWriteResult_(sheet, rowNum, decision, rec);
  mgSlackDmSubmitter_(submitterRaw, slackMsg);
}

/***************************************
 * WFM AUTO-APPROVE PATH
 ***************************************/
function mgProcessWfmAutoApprove_(sheet, rowNum, team, title, dateStr, startStr, endStr,
  meetingStart, meetingEnd, submitterRaw, unmatchedTokens, managerEmail, managerName, managerRaw, fullRoster) {
  mgAudit_('WFM_AUTO', 'Row ' + rowNum, 'WFM allow-list submitter — auto-approving', 'OK');

  const apiKey  = mgGetApiKey_();
  const headers = mgAuthHeaders_(apiKey);
  const scheduledEmails    = mgGetScheduledEmails_(headers, meetingStart, meetingEnd);
  const scheduledAttendees = team.filter(function(r) {
    return scheduledEmails.has(r.email);
  });

  const testMode      = mgIsTestMode_();
  const commitTargets = testMode ? scheduledAttendees.slice(0, 1) : scheduledAttendees;
  const commitResult  = mgCommitMeetingToAssembled_(headers, commitTargets, meetingStart, meetingEnd, rowNum, title, managerEmail, managerName);
  const failedNames   = commitResult.failed.join(', ');

  var decision = !commitResult.failed.length
    ? (testMode ? 'APPROVED (WFM) — TEST: added to ' + (commitTargets[0] ? commitTargets[0].name : '') : 'APPROVED (WFM submitter)')
    : 'APPROVED (WFM) — Assembled Error: ' + failedNames;

  var rec = '';
  if (unmatchedTokens && unmatchedTokens.length) {
    rec = 'Unmatched manual names (ignored): ' + unmatchedTokens.join('; ');
  }

  const meetLink = mgGetManagerMeetLink_(managerEmail, managerName);
  const meetLine = mgFormatMeetSlackLine_(meetLink, commitResult.calendar);

  var wfmIntro = 'This meeting was auto-booked as a WFM submission.';
  if (!scheduledAttendees.length) {
    wfmIntro += '\n\n_Note: No one from your attendee list was on the schedule during this window; no Meeting blocks were written to Assembled._';
  }
  var wfmFooter = (testMode && commitTargets[0])
    ? '\n\n_\u26a0\ufe0f TEST MODE — only ' + commitTargets[0].name + '\'s schedule was updated in Assembled._'
    : '';
  var slackMsg = mgWrapApprovalSlack_(title, dateStr, startStr, endStr, wfmIntro, meetLine, commitResult, wfmFooter, {
    managerRaw: managerName, submitterRaw: submitterRaw, sourceRowNum: rowNum, managerEmail: managerEmail,
    emailsCsv: scheduledAttendees.map(function(r) { return r.email; }).join(',')
  });

  mgWriteResult_(sheet, rowNum, decision, rec);
  mgSlackDmSubmitter_(submitterRaw, slackMsg);
}

function mgHasManualAttendeeList_(manualRaw) {
  return String(manualRaw || '').trim() !== '';
}

function mgGetPendingManagerEntry_(managerName) {
  var key = mgNormManagerKey_(managerName);
  return MG_PENDING_MANAGERS[key] || null;
}

function mgIsPendingManager_(managerName) {
  return !!mgGetPendingManagerEntry_(managerName);
}

function mgGetPendingManagerByEmail_(email) {
  var low = String(email || '').trim().toLowerCase();
  if (!low) return null;
  var key;
  for (key in MG_PENDING_MANAGERS) {
    if (MG_PENDING_MANAGERS[key].email === low) return MG_PENDING_MANAGERS[key];
  }
  return null;
}

function mgResolveManagerEmail_(managerName) {
  var pending = mgGetPendingManagerEntry_(managerName);
  if (pending && pending.email) return pending.email;
  return mgResolveManagerGoogleEmail_(managerName);
}

/**
 * Google Calendar / Meet / Slack email for a roster manager name.
 * Prefers Config "Manager Slack Aliases" (same map as adherence), then name-derived email.
 */
function mgResolveManagerGoogleEmail_(managerName) {
  if (!managerName) return '';
  var aliasMap = mgLoadManagerSlackAliasMap_();

  if (aliasMap[managerName]) {
    return mgSlackEmailFromAlias_(aliasMap[managerName]);
  }

  var normMgr = mgNormManagerKey_(managerName);
  for (var name in aliasMap) {
    if (mgNormManagerKey_(name) === normMgr) {
      return mgSlackEmailFromAlias_(aliasMap[name]);
    }
  }

  var first = normMgr.split(' ')[0];
  if (first && first !== 'emily') {
    var sameFirst = [];
    for (var cfgName in aliasMap) {
      if (mgNormManagerKey_(cfgName).split(' ')[0] === first) sameFirst.push(cfgName);
    }
    if (sameFirst.length === 1) {
      return mgSlackEmailFromAlias_(aliasMap[sameFirst[0]]);
    }
  }

  return mgManagerNameToEmail_(managerName);
}

/** Ordered calendar emails: alias-resolved first, then legacy roster-derived, then renamed-mailbox extras. */
function mgManagerCalendarEmails_(managerName, managerEmail) {
  var emails = [];
  var seen = {};
  var add = function(email) {
    var e = String(email || '').trim().toLowerCase();
    if (!e || seen[e]) return;
    seen[e] = true;
    emails.push(e);
  };
  if (managerName) {
    add(mgResolveManagerGoogleEmail_(managerName));
    add(mgManagerNameToEmail_(managerName));
    var canonKey = mgNormManagerKey_(managerName);
    var aliasCanon = MG_MANAGER_ALIASES[canonKey];
    if (aliasCanon) {
      add(mgResolveManagerGoogleEmail_(aliasCanon));
      add(mgManagerNameToEmail_(aliasCanon));
      canonKey = mgNormManagerKey_(aliasCanon);
    }
    var extras = MG_MANAGER_EXTRA_EMAILS[canonKey] || [];
    for (var xi = 0; xi < extras.length; xi++) add(extras[xi]);
  }
  add(managerEmail);
  return emails;
}

/**
 * Roster team for capacity checks. Pending managers (not on column E yet) require manual attendees.
 * @return {{ok: boolean, teamFull: Array, error?: string}}
 */
function mgResolveManagerTeamForRequest_(roster, managerName, managerRaw, manualRaw) {
  var teamFull = mgGetTeamForManager_(roster, managerName);
  if (teamFull.length) {
    return { ok: true, teamFull: teamFull };
  }
  if (mgIsPendingManager_(managerName)) {
    if (!mgHasManualAttendeeList_(manualRaw)) {
      return {
        ok:    false,
        error: 'Manager "' + managerName + '" is not on Import Roster yet. List who is attending in the Attendees column (comma-separated names as they appear on Import Roster).'
      };
    }
    mgAudit_('PENDING_MANAGER', managerName,
      'No roster team — matching manual attendees against full Import Roster', 'INFO');
    return { ok: true, teamFull: [] };
  }
  var leadershipHint = '';
  var leadEntry = mgFindLeadershipEntryByName_(managerName);
  if (leadEntry && leadEntry.role) {
    leadershipHint = ' Leadership tab lists this person as "' + leadEntry.role + '"';
    if (leadEntry.groupAlias) leadershipHint += ' (' + leadEntry.groupAlias + ' segment)';
    leadershipHint += '.';
  }
  return {
    ok:    false,
    error: 'No team members found for manager "' + managerName + '" (from: ' + managerRaw +
      '). Check Import Roster column E (Manager) or column F (Senior).' + leadershipHint
  };
}

/** Labels for Slack denial/approval copy (manual column G vs full team). */
function mgAttendeeGroupDescriptor_(manualRaw, scheduledCount, poolCount) {
  if (mgHasManualAttendeeList_(manualRaw)) {
    var n = scheduledCount;
    return {
      isManualList:     true,
      groupPhrase:      'your ' + n + ' listed attendee' + (n === 1 ? '' : 's'),
      altWindowsPhrase: 'your ' + n + ' attendee' + (n === 1 ? '' : 's'),
      listHint:         ''
    };
  }
  return {
    isManualList:     false,
    groupPhrase:      'your full team (' + scheduledCount + ' scheduled of ' + poolCount + ')',
    altWindowsPhrase: 'your full group (' + scheduledCount + ' scheduled)',
    listHint:         '\n\n_Tip: For a smaller workshop, name only who\u2019s attending in your request (not your whole team)._'
  };
}

function mgCapLineAtRequested_(maxRepsAtRequested, scheduledCount, attendeeCtx) {
  if (maxRepsAtRequested === 0) {
    if (attendeeCtx.isManualList) {
      return '\n\nAt the time you requested, we can\u2019t pull ' + attendeeCtx.groupPhrase +
        ' off the floor and keep our staffing buffer.';
    }
    return '\n\nAt the time you requested, we can\u2019t pull anyone off the floor for a live meeting and keep our staffing buffer.';
  }
  var line = '\n\nAt the time you requested, staffing allows *up to ' + maxRepsAtRequested + ' rep' +
    (maxRepsAtRequested === 1 ? '' : 's') + '* in a meeting with the buffer. You had *' + scheduledCount + ' scheduled*';
  if (attendeeCtx.isManualList) {
    line += ' from your attendee list.';
  } else {
    line += ' (full team).';
  }
  return line;
}

/** No alt windows / split failed — concise CAN'T BOOK + touchpoint + async (workshop tip at most once). */
function mgBuildCantBookNoWindowsMsg_(title, dateStr, startStr, endStr, attendeeCtx, capLineAtRequested) {
  var msg = mgSlackMeetingHeader_(MG_SLACK_LABEL.CANT_BOOK, title) +
    'Requested: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT';
  var cap = String(capLineAtRequested || '').replace(/^\n\n/, '\n');
  if (cap) msg += cap;
  msg += '\n\nNo staffed window in the next ' + MG.SEARCH_DAYS + ' days works for ' + attendeeCtx.altWindowsPhrase + '.';
  if (attendeeCtx.listHint) msg += attendeeCtx.listHint;
  msg += '\n\n*\uD83D\uDC65 Quick touchpoint:* Meet with a couple of reps at a time for a quick touchpoint.';
  msg += '\n\n*\uD83D\uDCCB Async:* Share a Loom with your team, or contact WFM if you need everyone live.';
  return msg;
}

function mgFormatMeetSlackLine_(meetLink, calendar) {
  if (calendar && calendar.sent) {
    var names = (calendar.invitedNames || []).join(', ');
    var block = '\n\n\uD83D\uDCC5 On your calendar';
    if (names) block += ' \u2014 invites to ' + names;
    block += '. Meet link is on each invite';
    if (meetLink) block += ': ' + meetLink;
    return block + '.';
  }
  if (!meetLink) return '';
  return '\n\n\uD83C\uDF9E Your Google Meet link: ' + meetLink +
    '\nReps will see the Meet link on their Google Calendar invite.';
}

function mgBuildApprovalSlackMsg_(title, dateStr, startStr, endStr, introLine, meetLine, commitResult, footer, statusWord, cancelToken, linkExtras) {
  linkExtras = linkExtras || {};
  var status = String(statusWord || MG_SLACK_LABEL.BOOKED).trim().toUpperCase() || MG_SLACK_LABEL.BOOKED;
  var msg = '\u2705 *' + status + '* — Meeting: _' + title + '_\n' +
    'Date: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
    introLine;
  msg += (meetLine || '');
  if (footer) msg += footer;
  var actionLinks = [];
  var addRepsLink = mgBuildAddRepsSlackLink_(cancelToken);
  if (addRepsLink) actionLinks.push(addRepsLink);
  var extendLink = mgBuildExtendSlackLink_(cancelToken);
  if (extendLink) actionLinks.push(extendLink);
  var cancelLink = mgBuildCancelSlackLink_(cancelToken);
  if (cancelLink) actionLinks.push(cancelLink);
  var makeRecurringLink = mgBuildMakeRecurringSlackLink_(linkExtras.makeRecurringToken);
  if (makeRecurringLink) actionLinks.push(makeRecurringLink);
  var stopRecurringLink = mgBuildStopRecurringSlackLink_(linkExtras.recurringId);
  if (stopRecurringLink) actionLinks.push(stopRecurringLink);
  if (actionLinks.length) msg += '\n\n' + actionLinks.join('  ');
  return msg;
}

/** After a successful Assembled commit, optional Cancel link in BOOKED Slack DM. */
function mgWrapApprovalSlack_(title, dateStr, startStr, endStr, introLine, meetLine, commitResult, footer, meta) {
  meta = meta || {};
  var cancelToken = '';
  var linkExtras = {};
  if (meta.recurringId) {
    linkExtras.recurringId = meta.recurringId;
  }
  if (commitResult.activityCommits && commitResult.activityCommits.length && mgGetWebAppUrl_()) {
    cancelToken = mgCreateCancelToken_({
      managerRaw:      meta.managerRaw || '',
      submitterRaw:    meta.submitterRaw || '',
      title:           title,
      dateStr:         dateStr,
      startStr:        startStr,
      endStr:          endStr,
      emailsCsv:       meta.emailsCsv || commitResult.activityCommits.map(function(c) { return c.email; }).join(','),
      sourceRowNum:    meta.sourceRowNum || '',
      activityJson:    JSON.stringify(commitResult.activityCommits),
      calendarEventId: (commitResult.calendar && commitResult.calendar.eventId) || '',
      managerEmail:    meta.managerEmail || ''
    });
    if (!meta.recurringId && !meta.skipMakeRecurring) {
      linkExtras.makeRecurringToken = mgCreateRecurringOptInToken_({
        sourceRowNum:   meta.sourceRowNum || '',
        managerRaw:     meta.managerRaw || '',
        submitterRaw:   meta.submitterRaw || '',
        title:          title,
        manualRaw:      meta.manualRaw || '',
        dateStr:        dateStr,
        startStr:       startStr,
        endStr:         endStr,
        managerEmail:   meta.managerEmail || ''
      });
    }
  }
  return mgBuildApprovalSlackMsg_(title, dateStr, startStr, endStr, introLine, meetLine, commitResult, footer, null, cancelToken, linkExtras);
}

const MG_GROUP_ALIASES = {
  'college':                    'college_and_grad',
  'grad':                       'college_and_grad',
  'college and grad':           'college_and_grad',
  'college & grad':             'college_and_grad',
  'high school':                'high_school',
  'hs':                         'high_school',
  'highschool':                 'high_school',
  'adult learning':             'adult_learner',
  'adult learner':              'adult_learner',
  'al':                         'adult_learner',
  'adult':                      'adult_learner',
  'prof certs':                 'prof_certs',
  'professional certifications':'prof_certs',
  'pc':                         'prof_certs',
  'prof cert':                  'prof_certs',
  'elementary':                 'elementary_and_ld',
  'eld':                        'elementary_and_ld',
  'learning differences':       'elementary_and_ld',
  'elem':                       'elementary_and_ld'
};

/** MG_GROUP_ALIASES normalized values → Assembled queue name (Consumer Sales). */
const MG_GROUP_ALIAS_TO_QUEUE = {
  'high_school':        'High School_CC90_New',
  'college_and_grad':   'College and Grad TP_CC90_New',
  'adult_learner':      'Adult Learner_CC90_New',
  'prof_certs':         'Prof Certs_CC90_New',
  'elementary_and_ld':  'Elementary and LD_CC90_New'
};

/**
 * Leadership tab role titles → attendee group alias (column G shorthand).
 * Plain Coach / Lead / Manager (no segment) → no auto-scope.
 */
const MG_LEADERSHIP_ROLE_TO_GROUP = {
  'coach pc':              'pc',
  'coach eld':             'eld',
  'coach hs':              'hs',
  'coach interim hs':      'hs',
  'coach canada hs':       'hs',
  'sales coach hs':        'hs',
  'hs manager':            'hs',
  'manager hs':            'hs',
  'high school manager':   'hs',
  'coach college':         'college',
  'lead college':          'college',
  'college manager':       'college',
  'manager college':       'college',
  'coach al':              'al',
  'al manager':            'al',
  'adult learning manager': 'al',
  'coach pc manager':      'pc',
  'pc manager':            'pc',
  'prof certs manager':    'pc',
  'coach eld manager':     'eld',
  'eld manager':           'eld',
  'elementary manager':    'eld'
};

function mgNormPersonName_(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** riordon→riordan, john paul→johnpaul, MG_PERSON_ALIASES — used for managers and manual attendees. */
function mgCanonicalizePersonKey_(key) {
  var k = mgNormPersonName_(key);
  if (!k) return k;

  if (MG_PERSON_ALIASES[k]) return MG_PERSON_ALIASES[k];

  var parts = k.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    var last = parts[parts.length - 1];
    if (/riordon/i.test(last)) {
      parts[parts.length - 1] = last.replace(/riordon/gi, 'riordan');
      k = parts.join(' ');
      if (MG_PERSON_ALIASES[k]) return MG_PERSON_ALIASES[k];
    }
    if (parts.length >= 3 && parts[0] === 'john' && parts[1] === 'paul' &&
        parts[parts.length - 1] === 'riordan') {
      return 'johnpaul riordan';
    }
  }
  return k;
}

/**
 * Match a manual attendee token to a roster row (team first, then full roster).
 * Supports full name, substring, "First L" / "First L." last-initial, and "First Lastprefix".
 */
function mgMatchAttendeeToken_(tok, teamFull, fullRoster) {
  var key = mgCanonicalizePersonKey_(mgNormPersonName_(tok));
  if (!key) return { hit: null, reason: 'empty' };

  var pools = [];
  if (teamFull && teamFull.length) pools.push(teamFull);
  if (fullRoster && fullRoster.length) {
    var seenPool = teamFull === fullRoster;
    if (!seenPool) pools.push(fullRoster);
  }
  if (!pools.length) return { hit: null, reason: 'no_pool' };

  var findInPool = function(pool) {
    var byName = {};
    pool.forEach(function(r) {
      var rn = mgNormPersonName_(r.name);
      byName[rn] = r;
      var cn = mgCanonicalizePersonKey_(rn);
      if (cn !== rn) byName[cn] = r;
    });

    if (byName[key]) return { hit: byName[key], ambiguous: false };

    var i;
    for (i = 0; i < pool.length; i++) {
      var rn = mgCanonicalizePersonKey_(mgNormPersonName_(pool[i].name));
      if (rn.indexOf(key) !== -1 || key.indexOf(rn) !== -1) {
        return { hit: pool[i], ambiguous: false };
      }
    }

    var initialMatch = key.match(/^(.+?)\s+([a-z])\.?$/);
    if (initialMatch) {
      var first = initialMatch[1].trim();
      var lastInit = initialMatch[2];
      var byInit = pool.filter(function(r) {
        var parts = mgNormPersonName_(r.name).split(' ');
        if (parts.length < 2 || parts[0] !== first) return false;
        return parts[parts.length - 1].charAt(0) === lastInit;
      });
      if (byInit.length === 1) return { hit: byInit[0], ambiguous: false };
      if (byInit.length > 1) return { hit: null, ambiguous: true, count: byInit.length };
    }

    var partsKey = key.split(' ');
    if (partsKey.length >= 2 && partsKey[partsKey.length - 1].length >= 2) {
      var firstPrefix = partsKey[0];
      var lastPrefix  = partsKey[partsKey.length - 1];
      var byPrefix = pool.filter(function(r) {
        var parts = mgNormPersonName_(r.name).split(' ');
        if (parts.length < 2 || parts[0] !== firstPrefix) return false;
        return parts[parts.length - 1].indexOf(lastPrefix) === 0;
      });
      if (byPrefix.length === 1) return { hit: byPrefix[0], ambiguous: false };
      if (byPrefix.length > 1) return { hit: null, ambiguous: true, count: byPrefix.length };
    }

    return { hit: null, ambiguous: false };
  };

  var p;
  for (p = 0; p < pools.length; p++) {
    var res = findInPool(pools[p]);
    if (res.hit) return res;
    if (res.ambiguous) return res;
  }
  return { hit: null, ambiguous: false };
}

function mgNormRoleTitle_(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Map Leadership role title to MG_GROUP_ALIASES key (e.g. Coach PC → pc). */
function mgRoleTitleToGroupAlias_(roleTitle) {
  var r = mgNormRoleTitle_(roleTitle);
  if (!r) return null;
  if (MG_LEADERSHIP_ROLE_TO_GROUP[r]) return MG_LEADERSHIP_ROLE_TO_GROUP[r];
  if (r === 'coach' || r === 'lead' || r === 'manager' || r === 'senior' || r === 'srd') return null;
  if (/\bmanager\b/.test(r) || /\bsrd\b/.test(r)) {
    if (/\bpc\b/.test(r) || /prof/.test(r)) return 'pc';
    if (/\beld\b/.test(r) || /elementary/.test(r) || /learning diff/.test(r)) return 'eld';
    if (/\bhs\b/.test(r) || /high school/.test(r) || /canada hs/.test(r) || /interim hs/.test(r)) return 'hs';
    if (/college/.test(r) || /\bgrad\b/.test(r)) return 'college';
    if (/\bal\b/.test(r) || /adult/.test(r)) return 'al';
  }
  if (/\bcoach\b/.test(r) || /\blead\b/.test(r) || /sales coach/.test(r)) {
    if (/\bpc\b/.test(r) || /prof/.test(r)) return 'pc';
    if (/\beld\b/.test(r)) return 'eld';
    if (/\bhs\b/.test(r) || /high school/.test(r) || /canada hs/.test(r) || /interim hs/.test(r)) return 'hs';
    if (/college/.test(r) && !/^manager\b/.test(r)) return 'college';
    if (/\bal\b/.test(r) || /adult/.test(r)) return 'al';
  }
  return null;
}

function mgLoadLeadership_() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MG.SHEETS.LEADERSHIP);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var out    = [];
  var i;
  for (i = 1; i < values.length; i++) {
    var name = String(values[i][MG.LEADERSHIP_COLS.NAME - 1] || '').trim();
    var role = String(values[i][MG.LEADERSHIP_COLS.ROLE - 1] || '').trim();
    if (!name) continue;
    var groupRaw = String(values[i][MG.LEADERSHIP_COLS.GROUP - 1] || '').trim().toLowerCase();
    var groupAlias = null;
    if (groupRaw && MG_GROUP_ALIASES[groupRaw]) {
      groupAlias = groupRaw;
    } else if (groupRaw) {
      var gk = mgNormPersonName_(groupRaw);
      if (MG_GROUP_ALIASES[gk]) groupAlias = gk;
    }
    if (!groupAlias) groupAlias = mgRoleTitleToGroupAlias_(role);
    out.push({ name: name, role: role, groupAlias: groupAlias });
  }
  return out;
}

function mgResolveSubmitterDisplayName_(submitterRaw, roster) {
  var raw = String(submitterRaw || '').trim();
  if (!raw) return '';
  if (raw.indexOf(' ') !== -1 && raw.indexOf('@') === -1) return raw;
  var alias = raw.replace(/^@/, '').trim().toLowerCase();
  var email = alias.indexOf('@') !== -1 ? alias : (alias + '@varsitytutors.com');
  var j;
  for (j = 0; j < roster.length; j++) {
    if (roster[j].email === email) return roster[j].name;
  }
  var parts = alias.split('@')[0].split('.');
  if (parts.length >= 2) {
    return parts.map(function(p) {
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' ');
  }
  return raw;
}

function mgFindLeadershipEntryByName_(name) {
  var list = mgLoadLeadership_();
  if (!list.length || !name) return null;
  var key = mgCanonicalizePersonKey_(mgNormPersonName_(name));
  var i;
  for (i = 0; i < list.length; i++) {
    if (mgCanonicalizePersonKey_(mgNormPersonName_(list[i].name)) === key) return list[i];
    var match = mgMatchAttendeeToken_(name, [{ email: '', name: list[i].name }], null);
    if (match.hit) return list[i];
  }
  return null;
}

function mgFindLeadershipEntryForSubmitter_(submitterRaw, roster) {
  var list = mgLoadLeadership_();
  if (!list.length) return null;
  var display = mgResolveSubmitterDisplayName_(submitterRaw, roster);
  if (!display) return null;
  return mgFindLeadershipEntryByName_(display);
}

/** When column G is blank, infer sales group from Leadership tab + submitter or manager name. */
function mgCoachLeadGroupContext_(manualRaw, submitterRaw, roster, managerName) {
  var manual = String(manualRaw || '').trim();
  if (manual) {
    return { effectiveManual: manualRaw, groupAlias: null, role: '' };
  }
  var entry = mgFindLeadershipEntryForSubmitter_(submitterRaw, roster);
  if (!entry && managerName) {
    entry = mgFindLeadershipEntryByName_(managerName);
  }
  if (!entry || !entry.groupAlias) {
    return { effectiveManual: manualRaw, groupAlias: null, role: entry ? entry.role : '' };
  }
  return {
    effectiveManual: entry.groupAlias,
    groupAlias:      entry.groupAlias,
    role:            entry.role
  };
}

function mgCoachLeadManagerFieldHint_(managerName, submitterRaw, roster) {
  var entry = mgFindLeadershipEntryByName_(managerName);
  if (entry && entry.groupAlias) {
    return 'The Manager field looks like a coach/lead (' + entry.role + '). Enter your *sales manager* name; attendees will auto-scope to ' +
      entry.groupAlias + ' from your submitter role.';
  }
  var sub = mgFindLeadershipEntryForSubmitter_(submitterRaw, roster);
  if (sub && sub.groupAlias) {
    return 'Enter your sales manager in the Manager field (not your coach name). Your submitter role will scope to ' + sub.groupAlias + '.';
  }
  return '';
}

function mgApplyManualAttendeeFilter_(teamFull, manualRaw, fullRoster, managerName) {
  var raw = String(manualRaw || '').trim();
  if (!raw) {
    return { members: teamFull, unmatched: [], error: null };
  }

  /** Named attendees only resolve on this manager's team (e.g. training books new reps under John). */
  var searchPool = teamFull && teamFull.length ? teamFull : (fullRoster || []);
  var matchRosterFallback = null;
  if (mgIsPendingManager_(managerName)) {
    matchRosterFallback = fullRoster || [];
  }

  var tokens = raw.split(/[,;\n]+/).map(function(t) { return t.trim(); }).filter(Boolean);

  var normQueue = function(q) {
    return String(q || '').toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  };

  var out       = [];
  var seen      = {};
  var unmatched = [];

  var addRep = function(r) {
    var id = r.email || mgNormPersonName_(r.name);
    if (!seen[id]) { seen[id] = true; out.push(r); }
  };

  tokens.forEach(function(tok) {
    var key = mgCanonicalizePersonKey_(mgNormPersonName_(tok));

    var groupKey = MG_GROUP_ALIASES[key];
    if (groupKey) {
      var groupMatches = searchPool.filter(function(r) {
        return normQueue(r.queue).indexOf(groupKey) !== -1;
      });
      if (groupMatches.length) {
        groupMatches.forEach(addRep);
        mgAudit_('ATTENDEE_FILTER', tok, 'Group alias "' + tok + '" → ' + groupMatches.length + ' reps', 'INFO');
      } else {
        mgAudit_('ATTENDEE_FILTER', tok, 'Group alias "' + tok + '" matched no reps in roster', 'WARN');
        unmatched.push(tok + ' (group — no reps found)');
      }
      return;
    }

    var matchRes = mgMatchAttendeeToken_(tok, teamFull, matchRosterFallback);
    if (matchRes.hit) {
      addRep(matchRes.hit);
      if (mgNormPersonName_(matchRes.hit.name) !== key) {
        mgAudit_('ATTENDEE_FILTER', tok, 'Matched roster name "' + matchRes.hit.name + '"', 'INFO');
      }
    } else if (matchRes.ambiguous) {
      unmatched.push(tok + ' (ambiguous — ' + matchRes.count + ' roster matches)');
      mgAudit_('ATTENDEE_FILTER', tok, 'Ambiguous — ' + matchRes.count + ' matches on roster', 'WARN');
    } else {
      unmatched.push(tok);
    }
  });

  if (!out.length) {
    var pendingErr = mgIsPendingManager_(managerName)
      ? 'No attendee names matched Import Roster. List rep names separated by commas (as they appear on Import Roster).'
      : 'No attendee names matched anyone on this manager\'s team in Import Roster. Check spelling, or leave the attendee field blank to use the manager\'s full team.\n' +
        'New reps in training must be listed under this manager on Import Roster before booking.\n' +
        'Valid group aliases (subset of this manager\'s team): college, grad, high school, hs, adult learning, al, prof certs, pc, elementary, eld';
    return { members: [], unmatched: unmatched, error: pendingErr };
  }

  return { members: out, unmatched: unmatched, error: null };
}

function mgLoadRoster_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MG.SHEETS.IMPORT_ROSTER);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const values = sheet.getDataRange().getValues();
  const out    = [];
  for (var i = 1; i < values.length; i++) {
    const row    = values[i];
    const email  = String(row[MG.ROSTER.EMAIL - 1]      || '').trim().toLowerCase();
    const name   = String(row[MG.ROSTER.NAME - 1]       || '').trim();
    const mgr    = String(row[MG.ROSTER.MANAGER - 1]    || '').trim();
    const senior = String(row[MG.ROSTER.SENIOR - 1]     || '').trim();
    const wg     = String(row[MG.ROSTER.WORK_GROUP - 1] || '').trim();
    if (!email || !name) continue;
    const queue = mgWorkGroupToQueue_(wg);
    out.push({ email: email, name: name, manager: mgr, senior: senior, workGroup: wg, queue: queue });
  }
  return out;
}

/** Fuzzy match manager names on Import Roster (column E/F), e.g. Forrest/Forest typos. */
function mgManagerKeysMatch_(requested, rosterManager) {
  var a = mgCanonicalizePersonKey_(mgNormManagerKey_(requested));
  var b = mgCanonicalizePersonKey_(mgNormManagerKey_(rosterManager));
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.replace(/forest/g, 'forrest') === b.replace(/forest/g, 'forrest')) return true;
  var aParts = a.split(' ').filter(Boolean);
  var bParts = b.split(' ').filter(Boolean);
  if (aParts.length >= 2 && bParts.length >= 2 &&
      aParts[0] === bParts[0] && aParts[aParts.length - 1] === bParts[bParts.length - 1]) {
    return true;
  }
  return false;
}

function mgGetTeamForManager_(roster, managerName) {
  var byManager = roster.filter(function(r) {
    return mgManagerKeysMatch_(managerName, r.manager);
  });
  if (byManager.length) return byManager;

  // Segment / senior managers (e.g. HS Manager on Leadership): reps may list them in column F only.
  var bySenior = roster.filter(function(r) {
    return mgManagerKeysMatch_(managerName, r.senior);
  });
  if (bySenior.length) {
    mgAudit_('TEAM_SENIOR', managerName,
      'Resolved ' + bySenior.length + ' rep(s) via Import Roster column F (Senior)', 'INFO');
    return bySenior;
  }
  return [];
}

function mgGetScheduledEmails_(headers, windowStart, windowEnd) {
  const startSec = Math.floor(windowStart.getTime() / 1000);
  const endSec   = Math.floor(windowEnd.getTime()   / 1000);
  const url = MG.ASSEMBLED.BASE_URL + '/activities' +
    '?start_time=' + startSec +
    '&end_time='   + endSec +
    '&include_agents=true' +
    '&include_activity_types=true';
  const resp = UrlFetchApp.fetch(url, {
    method: 'get', headers: headers, muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code < 200 || code >= 300) {
    mgAudit_('ASSEMBLED', '/activities', 'Error ' + code + ': ' + text, 'FAILED');
    return new Set();
  }
  const data          = JSON.parse(text);
  const activities    = data.activities     || {};
  const agents        = data.agents         || {};
  const activityTypes = data.activity_types || {};
  const typeNames = {};
  Object.keys(activityTypes).forEach(function(id) {
    typeNames[id] = (activityTypes[id].name || '').toLowerCase().trim();
  });
  const WORKING = ['phone', 'meal', 'break', 'lunch', 'rest break', 'chat', 'sms'];
  const actList = Array.isArray(activities)
    ? activities
    : Object.keys(activities).map(function(k) { return activities[k]; });
  const scheduledEmails = new Set();
  actList.forEach(function(act) {
    const typeName = typeNames[act.type_id] || '';
    if (WORKING.indexOf(typeName) === -1) return;
    const actStart = act.start_time ? new Date(act.start_time * 1000) : null;
    const actEnd   = act.end_time   ? new Date(act.end_time   * 1000) : null;
    if (!actStart || !actEnd) return;
    if (actEnd <= windowStart || actStart >= windowEnd) return;
    const agentId = (act.agent_id || '').trim();
    const agent   = agents[agentId] || {};
    const email   = (agent.email || agent.primary_email || '').trim().toLowerCase();
    if (email) scheduledEmails.add(email);
  });
  return scheduledEmails;
}

function mgGetNetStaffingForWindow_(headers, siteId, queueId, windowStart, windowEnd) {
  const startSec  = Math.floor(mgAlignDown_(windowStart.getTime() / 1000, MG.ASSEMBLED.INTERVAL));
  const endSec    = Math.floor(mgAlignDown_(windowEnd.getTime()   / 1000, MG.ASSEMBLED.INTERVAL));
  const intervals = mgFetchForecastIntervals_(headers, siteId, queueId, startSec, endSec);
  if (!intervals.length) return 0;
  const nets = intervals.map(function(it) {
    const scheduled = mgNum_(it.staffing_scheduled);
    const required  = mgNum_(it.staffing_required && it.staffing_required.forecasted);
    if (mgIsNum_(it.staffing_net)) return Number(it.staffing_net);
    return scheduled - required;
  }).filter(function(n) { return isFinite(n); });
  if (!nets.length) return 0;
  return Math.min.apply(null, nets);
}

/** True when two alternative-window slots overlap in time (same or partial overlap). */
function mgSlotsOverlap_(slotA, slotB) {
  if (!slotA || !slotB) return false;
  var startA = mgBuildDateTime_(slotA.dateStr, slotA.startStr);
  var endA   = mgBuildDateTime_(slotA.dateStr, slotA.endStr);
  var startB = mgBuildDateTime_(slotB.dateStr, slotB.startStr);
  var endB   = mgBuildDateTime_(slotB.dateStr, slotB.endStr);
  if (!startA || !endA || !startB || !endB) return false;
  return startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime();
}

function mgFindAlternativeWindows_(headers, siteId, queueId, referenceStart, attendeeCount, durationMs, searchDays, scheduledStart, scheduledEnd, opts) {
  opts = opts || {};
  var maxResults   = opts.maxResults != null ? opts.maxResults : 3;
  var excludeSlots = opts.excludeSlots || [];
  var config       = opts.config || mgLoadConfig_();
  var minBuffer    = mgGetStaffingMinBuffer_(config);
  var band         = mgGetAltSearchBand_(config);
  const alternatives  = [];
  const tz            = MG.TZ;
  const bandStartHour = band.startHour;
  const bandEndHour   = band.endHour;

  for (var d = 0; d < searchDays; d++) {
    const dayStart = new Date(referenceStart.getTime() + d * 24 * 60 * 60 * 1000);
    const dateStr  = Utilities.formatDate(dayStart, tz, 'yyyy-MM-dd');
    const dow      = parseInt(Utilities.formatDate(dayStart, tz, 'u'), 10);
    if (dow === 6 || dow === 7) continue;
    const bandStart = mgBuildDateTime_(dateStr, mgPad2_(bandStartHour) + ':00');
    const bandEnd   = mgBuildDateTime_(dateStr, mgPad2_(bandEndHour)   + ':00');
    if (!bandStart || !bandEnd) continue;
    const startSec  = Math.floor(mgAlignDown_(bandStart.getTime() / 1000, MG.ASSEMBLED.INTERVAL));
    const endSec    = Math.floor(mgAlignDown_(bandEnd.getTime()   / 1000, MG.ASSEMBLED.INTERVAL));
    const intervals = mgFetchForecastIntervals_(headers, siteId, queueId, startSec, endSec);
    if (!intervals.length) continue;
    for (var i = 0; i < intervals.length; i++) {
      const it = intervals[i];
      if (!it.start_time || !it.end_time) continue;
      const slotStart = new Date(it.start_time * 1000);
      const slotEnd   = new Date(slotStart.getTime() + durationMs);
      if (slotStart < bandStart || slotEnd > bandEnd) continue;
      var windowOk   = true;
      var minPostNet = Infinity;
      for (var j = i; j < intervals.length; j++) {
        const jt = intervals[j];
        if (!jt.start_time) continue;
        const jStart = new Date(jt.start_time * 1000);
        if (jStart >= slotEnd) break;
        const scheduled = mgNum_(jt.staffing_scheduled);
        const required  = mgNum_(jt.staffing_required && jt.staffing_required.forecasted);
        const net       = mgIsNum_(jt.staffing_net) ? Number(jt.staffing_net) : (scheduled - required);
        const postNet   = net - attendeeCount;
        if (postNet < minBuffer) { windowOk = false; break; }
        if (postNet < minPostNet) minPostNet = postNet;
      }
      if (windowOk && isFinite(minPostNet)) {
        var candidate = {
          dateStr:  Utilities.formatDate(slotStart, tz, 'yyyy-MM-dd'),
          startStr: Utilities.formatDate(slotStart, tz, 'HH:mm'),
          endStr:   Utilities.formatDate(slotEnd,   tz, 'HH:mm'),
          postNet:  Math.round(minPostNet * 10) / 10
        };
        var blocked = false;
        for (var x = 0; x < excludeSlots.length; x++) {
          if (mgSlotsOverlap_(candidate, excludeSlots[x])) { blocked = true; break; }
        }
        if (!blocked) {
          alternatives.push(candidate);
          i += Math.floor(durationMs / (MG.ASSEMBLED.INTERVAL * 1000));
        }
      }
    }
    if (alternatives.length >= maxResults) break;
  }
  return alternatives;
}

function mgFetchForecastIntervals_(headers, siteId, queueId, startSec, endSec) {
  var all    = [];
  var offset = 0;
  while (true) {
    var res;
    try {
      res = mgAssembledGet_(headers, '/forecasted_vs_actuals', {
        start_time: startSec,
        end_time:   endSec,
        channel:    MG.ASSEMBLED.CHANNEL,
        interval:   MG.ASSEMBLED.INTERVAL,
        site:       siteId,
        queue:      queueId,
        limit:      MG.ASSEMBLED.PAGE_SIZE,
        offset:     offset
      });
      Utilities.sleep(MG.ASSEMBLED.SLEEP_MS);
    } catch (err) {
      mgAudit_('ASSEMBLED', '/forecasted_vs_actuals', 'Error (offset ' + offset + '): ' + err, 'FAILED');
      break;
    }
    const page = res.forecasts_vs_actuals || res.forecasted_vs_actuals || [];
    all = all.concat(Array.isArray(page) ? page : []);
    if (page.length < MG.ASSEMBLED.PAGE_SIZE) break;
    offset += page.length;
  }
  return all;
}

function mgCommitMeetingToAssembled_(headers, scheduledAttendees, meetingStart, meetingEnd, rowNum, title, managerEmail, managerName) {
  const succeeded = [];
  const failed    = [];
  const activityCommits = [];
  const emptyCal = { sent: false, invitedNames: [], eventId: '' };

  const activityTypeId = mgResolveMeetingActivityTypeId_(headers);
  if (!activityTypeId) {
    mgAudit_('ASSEMBLED_COMMIT', 'Row ' + rowNum,
      'Could not resolve "Meeting" activity type from Assembled /activity_types', 'FAILED');
    scheduledAttendees.forEach(function(rep) { failed.push(rep.name); });
    return { succeeded: succeeded, failed: failed, calendar: emptyCal, activityCommits: activityCommits };
  }

  const startSec = Math.floor(meetingStart.getTime() / 1000);
  const endSec   = Math.floor(meetingEnd.getTime()   / 1000);

  const meetLink   = mgGetManagerMeetLink_(managerEmail, managerName);
  var description  = title || '';
  if (meetLink) {
    description += (description ? ' | ' : '') + 'Join: ' + meetLink;
  }

  scheduledAttendees.forEach(function(rep) {
    var agentId = rep.agentId || '';
    if (!agentId) {
      agentId = mgResolveAgentIdByEmail_(headers, rep.email);
    }
    if (!agentId) {
      mgAudit_('ASSEMBLED_COMMIT', 'Row ' + rowNum,
        'No agent ID found for ' + rep.email + ' — skipping', 'FAILED');
      failed.push(rep.name);
      return;
    }
    const payload = {
      agent_id:    agentId,
      type_id:     activityTypeId,
      start_time:  startSec,
      end_time:    endSec,
      description: description
    };
    try {
      const resp  = mgAssembledPost_(headers, '/activities', payload);
      const actId = String(resp.id || (resp.activity && resp.activity.id) || '').trim();
      mgAudit_('ASSEMBLED_COMMIT', 'Row ' + rowNum,
        'Committed for ' + rep.email + ' | Activity ID: ' + actId, 'OK');
      succeeded.push(rep.name);
      if (actId) {
        activityCommits.push({
          email:      rep.email,
          name:       rep.name,
          agentId:    agentId,
          activityId: actId,
          startSec:   startSec,
          endSec:     endSec
        });
      }
    } catch (err) {
      mgAudit_('ASSEMBLED_COMMIT', 'Row ' + rowNum,
        'POST failed for ' + rep.email + ': ' + String(err), 'FAILED');
      failed.push(rep.name);
    }
    Utilities.sleep(MG.ASSEMBLED.SLEEP_MS);
  });

  var calendar = mgMaybeCreateManagerCalendarInvite_(
    managerEmail, title, meetingStart, meetingEnd, scheduledAttendees, succeeded, rowNum, managerName
  );

  return { succeeded: succeeded, failed: failed, calendar: calendar, activityCommits: activityCommits };
}

/**
 * After Assembled Meeting activities succeed: create a Google Calendar event and invite the
 * manager (all known emails, including rename aliases) + reps who succeeded as guests.
 * Tries manager calendars first; falls back to script runner primary so invites still send when
 * the manager has not shared their calendar. sendUpdates=all. Skipped only when
 * GOOGLE_CALENDAR_INVITES_ENABLED is FALSE (not skipped solely for TEST_MODE).
 */
function mgMaybeCreateManagerCalendarInvite_(managerEmail, title, meetingStart, meetingEnd, commitAttemptReps, succeededNames, rowRef, managerName) {
  var none = { sent: false, invitedNames: [], eventId: '' };
  var config = mgLoadConfig_();
  if (!mgConfigBool_(config, MG.CFG.CALENDAR_INVITES, true)) {
    mgAudit_('CALENDAR_INVITE', 'Row ' + rowRef, 'Skipped — GOOGLE_CALENDAR_INVITES_ENABLED is FALSE', 'INFO');
    return none;
  }
  if (!managerEmail && !managerName) {
    mgAudit_('CALENDAR_INVITE', 'Row ' + rowRef, 'No manager email', 'WARN');
    return none;
  }
  var invited = (commitAttemptReps || []).filter(function(r) {
    return succeededNames.indexOf(r.name) !== -1 && r.email;
  });
  if (!invited.length) {
    mgAudit_('CALENDAR_INVITE', 'Row ' + rowRef, 'No successful commits to invite', 'INFO');
    return none;
  }
  var invitedNames = invited.map(function(r) { return r.name; });
  var managerEmails = mgManagerCalendarEmails_(managerName, managerEmail);

  var meetLink = mgGetManagerMeetLink_(managerEmail, managerName);
  var desc = (title || 'Team meeting') + '\n\n';
  if (meetLink) desc += 'Join (Google Meet): ' + meetLink + '\n\n';
  desc += 'Meeting blocks added in Assembled for this time.';

  var startDt = Utilities.formatDate(meetingStart, MG.TZ, "yyyy-MM-dd'T'HH:mm:ss");
  var endDt   = Utilities.formatDate(meetingEnd,   MG.TZ, "yyyy-MM-dd'T'HH:mm:ss");

  var attendeeEmails = {};
  var attendees = [];
  var addAttendee = function(email) {
    var e = String(email || '').trim().toLowerCase();
    if (!e || attendeeEmails[e]) return;
    attendeeEmails[e] = true;
    attendees.push({ email: e });
  };
  for (var mi = 0; mi < managerEmails.length; mi++) addAttendee(managerEmails[mi]);
  for (var ri = 0; ri < invited.length; ri++) addAttendee(invited[ri].email);

  var event = {
    summary:     title || 'Team meeting',
    description: desc,
    start:       { dateTime: startDt, timeZone: MG.TZ },
    end:         { dateTime: endDt,   timeZone: MG.TZ },
    attendees:   attendees,
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    reminders: { useDefault: true }
  };

  // Host calendars to try: manager mailboxes first, then script runner primary (always works).
  var hostCalendars = managerEmails.slice();
  if (hostCalendars.indexOf('primary') === -1) hostCalendars.push('primary');

  var lastErr = '';
  for (var ci = 0; ci < hostCalendars.length; ci++) {
    var calendarId = hostCalendars[ci];
    try {
      var created = Calendar.Events.insert(event, calendarId, {
        sendUpdates: 'all'
      });
      var evId = created && created.id ? created.id : '';
      var hostLabel = calendarId === 'primary' ? 'script primary' : calendarId;
      var via = (calendarId === 'primary' || ci > 0) ? ' (fallback)' : '';
      mgAudit_('CALENDAR_INVITE', 'Row ' + rowRef,
        'Event on ' + hostLabel + via + ' | Guests: manager emails [' + managerEmails.join(', ') +
        '] + ' + invited.length + ' rep(s) | id=' + evId, 'OK');
      return {
        sent: true,
        invitedNames: invitedNames,
        eventId: evId,
        calendarEmail: calendarId === 'primary' ? 'primary' : calendarId
      };
    } catch (err) {
      lastErr = String(err);
      mgAudit_('CALENDAR_INVITE', 'Row ' + rowRef,
        'Failed for calendar ' + calendarId + ': ' + lastErr, 'WARN');
    }
  }
  mgAudit_('CALENDAR_INVITE', 'Row ' + rowRef,
    'All calendar attempts failed (' + hostCalendars.join(', ') + ') — last error: ' + lastErr, 'WARN');
  return none;
}

/**
 * Each processMeetingRequests run: append MEET_LINK_|email rows for roster managers
 * not yet on Config. Never edits or removes existing rows.
 */
function mgEnsureNewManagerMeetLinks_() {
  return mgSyncMeetLinks_({ appendOnly: true, auditPrefix: 'auto' });
}

/**
 * @param {{appendOnly?: boolean, auditPrefix?: string}} opts
 *   appendOnly true — skip managers who already have a MEET_LINK_| row (any value).
 *   appendOnly false — also fill rows that exist but lack meet.google.com (menu setup).
 * @return {{created: number, skipped: number, failed: number}}
 */
function mgSyncMeetLinks_(opts) {
  opts = opts || {};
  var appendOnly  = !!opts.appendOnly;
  var auditPrefix = opts.auditPrefix || 'manual';

  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName(MG.SHEETS.CONFIG);
  if (!configSheet) {
    throw new Error('Config tab not found');
  }

  const roster   = mgLoadRoster_();
  const managers = {};
  roster.forEach(function(r) {
    if (r.manager) {
      const email = mgResolveManagerEmail_(r.manager);
      if (email) managers[email] = r.manager;
    }
  });
  Object.keys(MG_PENDING_MANAGERS).forEach(function(key) {
    var p = MG_PENDING_MANAGERS[key];
    if (p.email && p.displayName) managers[p.email] = p.displayName;
  });

  const managerList = Object.keys(managers);
  if (!managerList.length) {
    return { created: 0, skipped: 0, failed: 0 };
  }

  const configValues = configSheet.getDataRange().getValues();
  const existingKeys = {};
  configValues.forEach(function(row, i) {
    if (i === 0) return;
    existingKeys[String(row[0]).trim()] = i + 1;
  });

  var created = 0;
  var skipped = 0;
  var failed  = 0;

  managerList.forEach(function(managerEmail) {
    const managerName = managers[managerEmail];
    const configKey = 'MEET_LINK_|' + managerEmail;
    const legacyEmail = managerName ? mgManagerNameToEmail_(managerName) : '';
    const legacyKey = legacyEmail ? 'MEET_LINK_|' + legacyEmail : '';

    if (legacyKey && legacyKey !== configKey && !existingKeys[configKey] && existingKeys[legacyKey]) {
      const legacyLink = String(configValues[existingKeys[legacyKey] - 1][1] || '').trim();
      if (legacyLink.indexOf('meet.google.com') !== -1) {
        configSheet.appendRow([
          configKey,
          legacyLink,
          'Copied from legacy email row for ' + managerName
        ]);
        existingKeys[configKey] = configSheet.getLastRow();
        mgAudit_('MEET_SETUP', managerEmail, 'Copied Meet link from ' + legacyEmail, 'OK');
        skipped++;
        return;
      }
    }

    if (existingKeys[configKey]) {
      if (appendOnly) {
        skipped++;
        return;
      }
      const existingVal = String(configValues[existingKeys[configKey] - 1][1] || '').trim();
      if (existingVal.indexOf('meet.google.com') !== -1) {
        mgAudit_('MEET_SETUP', managerEmail, 'Already has Meet link — skipping', 'INFO');
        skipped++;
        return;
      }
    }

    try {
      const meetLink = mgGenerateMeetLink_(managers[managerEmail]);
      if (!meetLink) {
        mgAudit_('MEET_SETUP', managerEmail, 'No Meet link returned from Calendar API', 'WARN');
        failed++;
        return;
      }

      if (existingKeys[configKey] && !appendOnly) {
        configSheet.getRange(existingKeys[configKey], 2).setValue(meetLink);
        configSheet.getRange(existingKeys[configKey], 3).setValue('Auto-generated Meet link for ' + managers[managerEmail]);
      } else {
        configSheet.appendRow([
          configKey,
          meetLink,
          'Auto-generated Meet link for ' + managers[managerEmail]
        ]);
        existingKeys[configKey] = configSheet.getLastRow();
      }

      SpreadsheetApp.flush();
      mgAudit_('MEET_SETUP', auditPrefix + ' ' + managerEmail, 'Meet link stored: ' + meetLink, 'OK');
      created++;
      Utilities.sleep(500);
    } catch (err) {
      mgAudit_('MEET_SETUP', managerEmail, 'Error: ' + String(err), 'FAILED');
      failed++;
    }
  });

  if (created > 0) {
    mgAudit_('MEET_SETUP', auditPrefix, 'Added Meet links for ' + created + ' new manager(s)', 'OK');
  }

  return { created: created, skipped: skipped, failed: failed };
}

function mgSetupMeetLinks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(MG.SHEETS.CONFIG)) {
    SpreadsheetApp.getUi().alert('Config tab not found. Run Setup Workbook first.');
    return;
  }

  const roster = mgLoadRoster_();
  if (!roster.length) {
    SpreadsheetApp.getUi().alert('Import Roster tab is empty or missing.');
    return;
  }

  mgAudit_('MEET_SETUP', 'manual', 'Generating Meet links for roster managers', 'INFO');
  const result = mgSyncMeetLinks_({ appendOnly: false, auditPrefix: 'manual' });

  SpreadsheetApp.getUi().alert(
    'Meet link setup complete.\n\n' +
    '\u2705 Created: ' + result.created + '\n' +
    '\u23ED Skipped (already had link): ' + result.skipped + '\n' +
    '\u274C Failed: ' + result.failed + '\n\n' +
    'Check the Audit tab for details on any failures.'
  );
}

function mgGenerateMeetLink_(managerName) {
  try {
    const now       = new Date();
    const oneHour   = new Date(now.getTime() + 60 * 60 * 1000);
    const requestId = 'mg-meet-' + Utilities.getUuid();

    const event = {
      summary: managerName + ' — Team Meeting Room',
      start:   { dateTime: now.toISOString() },
      end:     { dateTime: oneHour.toISOString() },
      conferenceData: {
        createRequest: {
          requestId:             requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    };

    const created = Calendar.Events.insert(event, 'primary', {
      conferenceDataVersion: 1
    });

    var meetLink    = null;
    const entryPoints = (created.conferenceData && created.conferenceData.entryPoints) || [];
    entryPoints.forEach(function(ep) {
      if (ep.entryPointType === 'video' && ep.uri) {
        meetLink = ep.uri;
      }
    });

    try {
      Calendar.Events.remove('primary', created.id);
    } catch (e) {
      mgAudit_('MEET_SETUP', managerName, 'Could not delete throwaway calendar event ' + created.id + ' — harmless', 'WARN');
    }

    return meetLink;
  } catch (err) {
    throw new Error('Calendar API error for ' + managerName + ': ' + String(err));
  }
}

function mgGetManagerMeetLinkByEmail_(managerEmail) {
  if (!managerEmail) return null;
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sheet  = ss.getSheetByName(MG.SHEETS.CONFIG);
  if (!sheet) return null;
  const values = sheet.getDataRange().getValues();
  const target = 'MEET_LINK_|' + String(managerEmail).trim().toLowerCase();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === target) {
      return String(values[i][1]).trim() || null;
    }
  }
  return null;
}

function mgGetManagerMeetLink_(managerEmail, managerName) {
  var emails = mgManagerCalendarEmails_(managerName, managerEmail);
  for (var i = 0; i < emails.length; i++) {
    var link = mgGetManagerMeetLinkByEmail_(emails[i]);
    if (link) {
      if (i > 0) {
        mgAudit_('MEET_LINK', emails[i], 'Resolved via fallback email for ' + (managerName || managerEmail), 'INFO');
      }
      return link;
    }
  }
  return null;
}

function mgManagerNameToEmail_(name) {
  if (!name) return null;
  return name.trim().toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9.]/g, '') + '@varsitytutors.com';
}

function mgListActivityTypes_(headers) {
  const res  = mgAssembledGet_(headers, '/activity_types', {});
  const raw  = res.activity_types || {};
  return Array.isArray(raw)
    ? raw
    : Object.keys(raw).map(function(k) {
        const a = raw[k];
        if (!a.id) a.id = k;
        return a;
      });
}

function mgResolveActivityTypeIdByName_(headers, typeName, auditLabel) {
  try {
    const target = String(typeName || '').trim().toLowerCase();
    const list   = mgListActivityTypes_(headers);
    for (var i = 0; i < list.length; i++) {
      if ((list[i].name || '').trim().toLowerCase() === target) {
        return String(list[i].id || '').trim();
      }
    }
    mgAudit_('ASSEMBLED', '/activity_types',
      'No activity type named "' + typeName + '" found. Available: ' +
      list.map(function(t) { return t.name; }).join(', '), 'WARN');
  } catch (err) {
    mgAudit_('ASSEMBLED', auditLabel || '/activity_types', 'Error: ' + String(err), 'FAILED');
  }
  return null;
}

function mgResolveMeetingActivityTypeId_(headers) {
  return mgResolveActivityTypeIdByName_(headers, 'Meeting', '/activity_types');
}

function mgResolvePhoneActivityTypeId_(headers) {
  return mgResolveActivityTypeIdByName_(headers, 'Phone', '/activity_types');
}

function mgResolveAgentIdByEmail_(headers, email) {
  const target = email.trim().toLowerCase();
  const LIMIT  = 100;
  var offset   = 0;
  while (true) {
    var res;
    try {
      res = mgAssembledGet_(headers, '/people', { limit: LIMIT, offset: offset });
    } catch (err) {
      mgAudit_('ASSEMBLED', '/people', 'Error (offset ' + offset + '): ' + String(err), 'FAILED');
      return '';
    }
    const people = res.people || {};
    const total  = res.total  || 0;
    const keys   = Object.keys(people);
    for (var i = 0; i < keys.length; i++) {
      const person      = people[keys[i]];
      const personEmail = (person.email || '').trim().toLowerCase();
      const agentId     = (person.agent_id || keys[i] || '').trim();
      if (personEmail === target && agentId) return agentId;
    }
    if (keys.length < LIMIT || offset + LIMIT >= total) break;
    offset += LIMIT;
    Utilities.sleep(200);
  }
  return '';
}

function mgAssembledPost_(headers, path, payload) {
  const url  = MG.ASSEMBLED.BASE_URL + path;
  const resp = UrlFetchApp.fetch(url, {
    method:             'post',
    headers:            headers,
    payload:            JSON.stringify(payload || {}),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Assembled POST ' + path + ' failed (' + code + '): ' + text);
  }
  return text ? JSON.parse(text) : {};
}

function mgResolveSiteId_(headers, siteName) {
  const res    = mgAssembledGet_(headers, '/sites', {});
  const sites  = res.sites || {};
  const target = mgNormalizeToken_(siteName);
  for (var id in sites) {
    if (mgNormalizeToken_(sites[id].name) === target) return sites[id].id || id;
  }
  throw new Error('Site not found: ' + siteName);
}

function mgResolveQueueId_(headers, queueName) {
  const res    = mgAssembledGet_(headers, '/queues', {});
  const queues = res.queues || {};
  const target = mgNormalizeToken_(queueName);
  for (var id in queues) {
    if (mgNormalizeToken_(queues[id].name) === target) return queues[id].id || id;
  }
  mgAudit_('ASSEMBLED', '/queues', 'Queue not found: ' + queueName, 'WARN');
  return null;
}

function mgAssembledGet_(headers, path, params) {
  const url  = mgBuildUrl_(MG.ASSEMBLED.BASE_URL + path, params);
  const resp = UrlFetchApp.fetch(url, {
    method: 'get', headers: headers, muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Assembled GET ' + path + ' failed (' + code + '): ' + text);
  }
  return text ? JSON.parse(text) : {};
}

function mgIsTestMode_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MG.SHEETS.CONFIG);
  if (!sheet) return false;
  const values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === MG.TEST_MODE_KEY) {
      return String(values[i][1]).trim().toUpperCase() === 'TRUE';
    }
  }
  return false;
}

function mgSlackDmSubmitter_(submitterRaw, message) {
  if (mgIsTestMode_()) {
    const testAlias  = 'robert.sorrell';
    const testUserId = mgSlackLookupUserId_(testAlias);
    if (testUserId) {
      const testMsg = '*[TEST MODE — would have gone to ' + submitterRaw + ']*\n\n' + message;
      mgSlackSendDm_(testUserId, testMsg);
      mgAudit_('SLACK_DM_TEST', 'Redirected to ' + testAlias, 'Original recipient: ' + submitterRaw, 'INFO');
    } else {
      mgAudit_('SLACK_DM_TEST', 'Redirect failed', 'Could not resolve ' + testAlias + ' — check SLACK_BOT_TOKEN', 'WARN');
    }
    return;
  }
  var alias = submitterRaw.replace(/^@/, '').trim();
  if (!alias) {
    mgAudit_('SLACK', 'DM', 'No submitter alias to DM', 'WARN');
    return;
  }
  const userId = mgSlackLookupUserId_(alias);
  if (!userId) return;
  mgSlackSendDm_(userId, message);
}

function mgLoadManagerSlackAliasMapFromSheet_(ss) {
  var aliasMap = {};
  if (!ss) return aliasMap;
  var sheet = ss.getSheetByName(MG.SHEETS.CONFIG);
  if (!sheet) return aliasMap;
  var values = sheet.getDataRange().getValues();
  var inSection = false;
  for (var i = 0; i < values.length; i++) {
    var cellA = String(values[i][0] || '').trim();
    var cellB = String(values[i][1] || '').trim();
    if (cellA === MG_CONFIG_ALIAS_HEADER) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (!cellA) break;
      if (cellA === 'Manager Name' || cellA === 'Slack Alias') continue;
      if (cellB) aliasMap[cellA] = cellB;
    }
  }
  return aliasMap;
}

function mgLoadManagerSlackAliasMap_() {
  var merged = {};
  var extId = PropertiesService.getScriptProperties().getProperty('GOOGLE_SHEET_ID');
  if (extId) {
    try {
      merged = mgLoadManagerSlackAliasMapFromSheet_(SpreadsheetApp.openById(String(extId).trim()));
    } catch (err) {
      mgAudit_('CONFIG', 'alias map', 'GOOGLE_SHEET_ID alias load failed: ' + String(err), 'WARN');
    }
  }
  var local = mgLoadManagerSlackAliasMapFromSheet_(SpreadsheetApp.getActiveSpreadsheet());
  for (var name in local) merged[name] = local[name];
  return merged;
}

function mgSlackEmailFromAlias_(alias) {
  if (!alias) return null;
  return String(alias).trim().toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9.]/g, '') + '@varsitytutors.com';
}

function mgSlackCandidateEmails_(alias) {
  var candidates = [];
  var seen = {};
  var add = function(email) {
    var e = String(email || '').trim().toLowerCase();
    if (!e || seen[e]) return;
    seen[e] = true;
    candidates.push(e);
  };

  var raw = String(alias || '').replace(/^@/, '').trim();
  if (!raw) return candidates;
  if (raw.indexOf('@') !== -1) {
    add(raw);
    return candidates;
  }

  var roster = mgLoadRoster_();
  var managerName = mgResolveManagerName_(raw, roster);
  var aliasMap = mgLoadManagerSlackAliasMap_();

  if (managerName && aliasMap[managerName]) {
    add(mgSlackEmailFromAlias_(aliasMap[managerName]));
  }

  if (managerName) {
    var normMgr = mgNormManagerKey_(managerName);
    for (var name in aliasMap) {
      if (mgNormManagerKey_(name) === normMgr) {
        add(mgSlackEmailFromAlias_(aliasMap[name]));
      }
    }
    var first = normMgr.split(' ')[0];
    if (first && first !== 'emily') {
      var sameFirst = [];
      for (var cfgName in aliasMap) {
        if (mgNormManagerKey_(cfgName).split(' ')[0] === first) sameFirst.push(cfgName);
      }
      if (sameFirst.length === 1) {
        add(mgSlackEmailFromAlias_(aliasMap[sameFirst[0]]));
      }
    }
  }

  add(mgManagerNameToEmail_(raw));
  if (managerName) add(mgResolveManagerEmail_(managerName));
  return candidates;
}

function mgSlackLookupUserIdByEmail_(email) {
  if (!email) return null;
  try {
    const token = mgGetSlackToken_();
    const url   = 'https://slack.com/api/users.lookupByEmail?email=' + encodeURIComponent(email);
    const resp  = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    const data = JSON.parse(resp.getContentText());
    if (data.ok) return data.user.id;
  } catch (err) {
    mgAudit_('SLACK', 'lookup', 'Exception for ' + email + ': ' + String(err), 'WARN');
  }
  return null;
}

function mgSlackLookupUserId_(alias) {
  var emails = mgSlackCandidateEmails_(alias);
  if (!emails.length) return null;
  for (var i = 0; i < emails.length; i++) {
    var userId = mgSlackLookupUserIdByEmail_(emails[i]);
    if (userId) {
      if (i > 0) {
        mgAudit_('SLACK', 'lookup', 'Resolved ' + alias + ' via fallback ' + emails[i], 'INFO');
      }
      return userId;
    }
  }
  mgAudit_('SLACK', 'lookup', 'Failed for ' + alias + ' (tried: ' + emails.join(', ') + ')', 'WARN');
  return null;
}

function mgSlackSendDm_(userId, message) {
  try {
    const token   = mgGetSlackToken_();
    const openRes = UrlFetchApp.fetch('https://slack.com/api/conversations.open', {
      method:  'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ users: userId }),
      muteHttpExceptions: true
    });
    const openData = JSON.parse(openRes.getContentText());
    if (!openData.ok) {
      mgAudit_('SLACK', 'DM', 'Failed to open channel: ' + openData.error, 'WARN');
      return;
    }
    const msgRes = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method:  'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ channel: openData.channel.id, text: message }),
      muteHttpExceptions: true
    });
    const msgData = JSON.parse(msgRes.getContentText());
    if (!msgData.ok) mgAudit_('SLACK', 'DM', 'Failed to send: ' + msgData.error, 'WARN');
    else mgAudit_('SLACK', 'DM', 'Sent to user ' + userId, 'OK');
  } catch (err) {
    mgAudit_('SLACK', 'DM', 'Exception: ' + String(err), 'WARN');
  }
}

/** True when Decision column should trigger a WFM error Slack ping. */
function mgIsErrorDecision_(decision) {
  var d = mgNormDecisionKey_(decision);
  if (!d) return false;
  if (d === 'ERROR' || d.indexOf('ERROR') === 0) return true;
  if (d.indexOf('ASSEMBLED ERROR') !== -1) return true;
  return false;
}

function mgNotifyWfmError_(title, detailLines) {
  var userId = mgSlackLookupUserId_(MG_WFM_ERROR_NOTIFY);
  if (!userId) {
    mgAudit_('SLACK', 'WFM_ERROR', 'Could not resolve Slack for ' + MG_WFM_ERROR_NOTIFY, 'WARN');
    return;
  }
  var lines = [':x: *Meeting Optimizer — ' + title + '*'];
  for (var i = 0; i < detailLines.length; i++) {
    if (detailLines[i]) lines.push(detailLines[i]);
  }
  lines.push('_Check Meeting Optimizer (Requests + Audit tabs)._');
  mgSlackSendDm_(userId, lines.join('\n'));
}

function mgNotifyWfmRequestError_(sheet, rowNum, decision, recommendation) {
  var detail = [
    '*Requests row ' + rowNum + '*',
    '*Decision:* ' + String(decision || 'ERROR')
  ];
  if (recommendation) detail.push('*Detail:* ' + String(recommendation));
  if (sheet && rowNum) {
    try {
      var mgr = String(sheet.getRange(rowNum, MG.COLS.MANAGER).getValue() || '').trim();
      var title = String(sheet.getRange(rowNum, MG.COLS.TITLE).getValue() || '').trim();
      var sub = String(sheet.getRange(rowNum, MG.COLS.SUBMITTER).getValue() || '').trim();
      if (mgr) detail.push('*Manager:* ' + mgr);
      if (title) detail.push('*Meeting:* _' + title + '_');
      if (sub) detail.push('*Submitter:* ' + sub);
    } catch (ignore) {}
  }
  mgNotifyWfmError_('Request failed', detail);
}

function mgWriteResult_(sheet, rowNum, decision, recommendation) {
  sheet.getRange(rowNum, MG.COLS.DECISION).setValue(decision);
  sheet.getRange(rowNum, MG.COLS.RECOMMENDATION).setValue(recommendation);
  SpreadsheetApp.flush();
  if (mgIsErrorDecision_(decision)) {
    mgNotifyWfmRequestError_(sheet, rowNum, decision, recommendation);
  }
}

/***************************************
 * CANCEL MEETING — Web app + Cancel Tokens tab
 ***************************************/

function mgGetOrCreateCancelTokensSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MG.SHEETS.CANCEL_TOKENS);
  if (!sheet) {
    sheet = ss.insertSheet(MG.SHEETS.CANCEL_TOKENS);
    var headers = [
      'Token', 'Created At', 'Status', 'Manager', 'Submitter', 'Title',
      'Date', 'Start', 'End', 'Emails', 'Source Row', 'Activity JSON', 'Calendar Event Id', 'Manager Email'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1F4E78')
      .setFontColor('#ffffff');
  }
  return sheet;
}

function mgCreateCancelToken_(opts) {
  mgGetOrCreateCancelTokensSheet_();
  var token = Utilities.getUuid().replace(/-/g, '');
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.CANCEL_TOKENS);
  sheet.appendRow([
    token,
    new Date(),
    'ACTIVE',
    opts.managerRaw || '',
    opts.submitterRaw || '',
    opts.title || '',
    opts.dateStr || '',
    opts.startStr || '',
    opts.endStr || '',
    opts.emailsCsv || '',
    opts.sourceRowNum || '',
    opts.activityJson || '[]',
    opts.calendarEventId || '',
    opts.managerEmail || ''
  ]);
  var lr = sheet.getLastRow();
  var nCols = MG.CANCEL_COLS.END_STR - MG.CANCEL_COLS.DATE_STR + 1;
  var rDt = sheet.getRange(lr, MG.CANCEL_COLS.DATE_STR, 1, nCols);
  rDt.setNumberFormat('@');
  rDt.setValues([[String(opts.dateStr || ''), String(opts.startStr || ''), String(opts.endStr || '')]]);
  SpreadsheetApp.flush();
  mgAudit_('CANCEL_TOKEN', token, 'Meeting cancel link issued', 'OK');
  return token;
}

function mgBuildCancelSlackLink_(token) {
  var base = mgGetWebAppUrl_();
  if (!base || !token) return '';
  var url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'cancel=' + encodeURIComponent(token);
  return '<' + url + '|\u274C Cancel meeting>';
}

function mgLookupCancelTokenRow_(token) {
  var t = String(token || '').trim().toLowerCase();
  if (!t) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.CANCEL_TOKENS);
  if (!sheet || sheet.getLastRow() <= 1) return null;
  var values = sheet.getDataRange().getValues();
  var i;
  for (i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === t) {
      return { rowNum: i + 1, row: values[i] };
    }
  }
  return null;
}

function mgUpdateCancelTokenStatus_(rowNum, status) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.CANCEL_TOKENS);
  if (!sheet || !rowNum) return;
  sheet.getRange(rowNum, MG.CANCEL_COLS.STATUS).setValue(status);
  SpreadsheetApp.flush();
}

function mgMarkRequestRowCancelled_(sourceRowNum, note) {
  var rowNum = Number(sourceRowNum || 0);
  if (!rowNum || rowNum < 2) return;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.REQUESTS);
  if (!sheet) return;
  sheet.getRange(rowNum, MG.COLS.DECISION).setValue('CANCELLED');
  sheet.getRange(rowNum, MG.COLS.RECOMMENDATION).setValue(String(note || 'Cancelled via Slack link.'));
  SpreadsheetApp.flush();
}

function mgMaybeDeleteCalendarEvent_(managerEmail, eventId, rowRef, managerName) {
  if (!eventId) return false;
  var calendars = mgManagerCalendarEmails_(managerName, managerEmail);
  if (calendars.indexOf('primary') === -1) calendars.push('primary');
  if (managerEmail && calendars.indexOf(String(managerEmail).toLowerCase()) === -1) {
    calendars.unshift(String(managerEmail).toLowerCase());
  }
  for (var i = 0; i < calendars.length; i++) {
    try {
      Calendar.Events.remove(calendars[i], eventId);
      mgAudit_('CALENDAR_CANCEL', 'Row ' + rowRef, 'Removed event ' + eventId + ' from ' + calendars[i], 'OK');
      return true;
    } catch (err) {
      mgAudit_('CALENDAR_CANCEL', 'Row ' + rowRef,
        'Could not remove from ' + calendars[i] + ': ' + String(err), 'WARN');
    }
  }
  return false;
}

function mgAssembledDelete_(headers, path, body) {
  var url = MG.ASSEMBLED.BASE_URL + path;
  var opts = {
    method:             'delete',
    headers:            headers,
    muteHttpExceptions: true
  };
  if (body) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(body);
  }
  return UrlFetchApp.fetch(url, opts).getResponseCode();
}

function mgGetAgentMeetingActivities_(headers, agentId, startSec, endSec, meetingTypeId) {
  var data = mgAssembledGet_(headers, '/activities', {
    start_time:           startSec,
    end_time:             endSec,
    include_activity_types: true,
    agents:               agentId
  });
  var activities = data.activities || {};
  var actList = Array.isArray(activities)
    ? activities
    : Object.keys(activities).map(function(k) { return activities[k]; });
  return actList.filter(function(act) {
    return String(act.type_id || '') === String(meetingTypeId || '');
  });
}

function mgDeleteMeetingActivityCommit_(headers, commit, meetingTypeId, rowRef) {
  if (!commit || !commit.agentId) return false;
  var startSec = Number(commit.startSec);
  var endSec   = Number(commit.endSec);
  if (commit.activityId) {
    var codeId = mgAssembledDelete_(headers, '/activities/' + commit.activityId, null);
    if (codeId >= 200 && codeId < 300) {
      mgAudit_('CANCEL_COMMIT', rowRef, 'Deleted activity id ' + commit.activityId + ' (' + commit.email + ')', 'OK');
      return true;
    }
  }
  var meetings = mgGetAgentMeetingActivities_(headers, commit.agentId, startSec, endSec, meetingTypeId);
  if (!meetings.length) {
    mgAudit_('CANCEL_COMMIT', rowRef, 'No Meeting activity found for ' + commit.email, 'WARN');
    return false;
  }
  var ok = true;
  meetings.forEach(function(act) {
    var body = {
      start_time: act.start_time,
      end_time:   act.end_time,
      agent_ids:  [commit.agentId]
    };
    var code = mgAssembledDelete_(headers, '/activities', body);
    if (code < 200 || code >= 300) {
      ok = false;
      mgAudit_('CANCEL_COMMIT', rowRef, 'DELETE failed ' + commit.email + ' (' + code + ')', 'WARN');
    } else {
      mgAudit_('CANCEL_COMMIT', rowRef, 'Deleted Meeting window for ' + commit.email, 'OK');
    }
    Utilities.sleep(MG.ASSEMBLED.SLEEP_MS);
  });
  return ok;
}

/** After a Meeting block is removed on cancel, restore Phone time for that same window. */
function mgCreatePhoneActivityCommit_(headers, commit, phoneTypeId, rowRef) {
  if (!commit || !commit.agentId || !phoneTypeId) return false;
  var startSec = Number(commit.startSec);
  var endSec   = Number(commit.endSec);
  if (!startSec || !endSec || endSec <= startSec) {
    mgAudit_('CANCEL_PHONE', rowRef, 'Invalid window for ' + (commit.email || commit.name || 'rep'), 'WARN');
    return false;
  }
  var payload = {
    agent_id:    commit.agentId,
    type_id:     phoneTypeId,
    start_time:  startSec,
    end_time:    endSec,
    description: 'Phone'
  };
  try {
    var resp  = mgAssembledPost_(headers, '/activities', payload);
    var actId = String(resp.id || (resp.activity && resp.activity.id) || '').trim();
    mgAudit_('CANCEL_PHONE', rowRef,
      'Restored Phone block for ' + commit.email + (actId ? ' | Activity ID: ' + actId : ''), 'OK');
    return true;
  } catch (err) {
    mgAudit_('CANCEL_PHONE', rowRef,
      'POST Phone failed for ' + commit.email + ': ' + String(err), 'WARN');
    return false;
  } finally {
    Utilities.sleep(MG.ASSEMBLED.SLEEP_MS);
  }
}

function mgCancelMeetingCommitReplacePhone_(headers, commit, meetingTypeId, phoneTypeId, rowRef) {
  if (!mgDeleteMeetingActivityCommit_(headers, commit, meetingTypeId, rowRef)) {
    return { removed: false, phoneRestored: false };
  }
  if (!phoneTypeId) {
    mgAudit_('CANCEL_PHONE', rowRef,
      'Meeting removed for ' + commit.email + ' but Phone type id unavailable — schedule left open', 'WARN');
    return { removed: true, phoneRestored: false };
  }
  return {
    removed: true,
    phoneRestored: mgCreatePhoneActivityCommit_(headers, commit, phoneTypeId, rowRef)
  };
}

function mgExecuteCancelToken_(token) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, message: 'Could not acquire lock. Try again in a moment.' };
  }
  try {
    var hit = mgLookupCancelTokenRow_(token);
    if (!hit) {
      return { ok: false, message: 'Invalid or unknown cancel link.' };
    }
    var row = hit.row;
    var rowNum = hit.rowNum;
    var status = String(row[MG.CANCEL_COLS.STATUS - 1] || '').trim().toUpperCase();
    if (status === 'CANCELLED') {
      return { ok: true, message: 'This meeting was already cancelled.' };
    }
    if (status !== 'ACTIVE') {
      return { ok: false, message: 'This cancel link is no longer active.' };
    }

    var createdAt = row[MG.CANCEL_COLS.CREATED_AT - 1];
    if (createdAt instanceof Date && !isNaN(createdAt.getTime())) {
      if (new Date().getTime() - createdAt.getTime() > MG.CANCEL_TOKEN_TTL_MS) {
        mgUpdateCancelTokenStatus_(rowNum, 'EXPIRED');
        return { ok: false, message: 'This cancel link has expired.' };
      }
    }

    var managerRaw   = String(row[MG.CANCEL_COLS.MANAGER_RAW - 1] || '').trim();
    var submitterRaw = String(row[MG.CANCEL_COLS.SUBMITTER_RAW - 1] || '').trim();
    var title        = String(row[MG.CANCEL_COLS.TITLE - 1] || '').trim();
    var dateStr      = mgParseDateStr_(row[MG.CANCEL_COLS.DATE_STR - 1]);
    var startStr     = mgParseTimeInt_(row[MG.CANCEL_COLS.START_STR - 1]);
    var endStr       = mgParseTimeInt_(row[MG.CANCEL_COLS.END_STR - 1]);
    var sourceRowNum = Number(row[MG.CANCEL_COLS.SOURCE_ROW - 1] || 0) || 0;
    var managerEmail = String(row[MG.CANCEL_COLS.MANAGER_EMAIL - 1] || '').trim();
    var calendarEventId = String(row[MG.CANCEL_COLS.CALENDAR_EVENT - 1] || '').trim();
    var activityJson = String(row[MG.CANCEL_COLS.ACTIVITY_JSON - 1] || '[]');

    var commits = [];
    try {
      commits = JSON.parse(activityJson);
    } catch (parseErr) {
      commits = [];
    }
    if (!commits.length) {
      return { ok: false, message: 'No stored meeting blocks to cancel.' };
    }

    var apiKey = mgGetApiKey_();
    var headers = mgAuthHeaders_(apiKey);
    var meetingTypeId = mgResolveMeetingActivityTypeId_(headers);
    var phoneTypeId   = mgResolvePhoneActivityTypeId_(headers);
    var rowRef = sourceRowNum ? ('Row ' + sourceRowNum) : ('cancel-' + token);

    var removed = 0;
    var failed  = 0;
    var phoneRestored = 0;
    var phoneFailed   = 0;
    commits.forEach(function(c) {
      var result = mgCancelMeetingCommitReplacePhone_(headers, c, meetingTypeId, phoneTypeId, rowRef);
      if (result.removed) {
        removed++;
        if (result.phoneRestored) phoneRestored++;
        else if (phoneTypeId) phoneFailed++;
      } else {
        failed++;
      }
    });

    mgMaybeDeleteCalendarEvent_(managerEmail, calendarEventId, rowRef, managerRaw);
    mgUpdateCancelTokenStatus_(rowNum, 'CANCELLED');
    if (sourceRowNum) {
      var cancelNote = 'Cancelled via link — removed ' + removed + ' Meeting block(s)';
      if (phoneRestored) cancelNote += ', restored ' + phoneRestored + ' Phone block(s)';
      cancelNote += '.';
      mgMarkRequestRowCancelled_(sourceRowNum, cancelNote);
    }

    var slackMsg = '\u274C *CANCELLED* — Meeting: _' + title + '_\n' +
      'Date: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
      'Removed Meeting blocks from *' + removed + '* schedule' + (removed === 1 ? '' : 's') + '.';
    if (phoneRestored) {
      slackMsg += '\nRestored Phone time on *' + phoneRestored + '* schedule' + (phoneRestored === 1 ? '' : 's') + '.';
    }
    if (failed) slackMsg += '\n_' + failed + ' Meeting block(s) could not be removed — check Audit tab._';
    if (phoneFailed) slackMsg += '\n_' + phoneFailed + ' Phone block(s) could not be restored — check Audit tab._';
    mgSlackDmSubmitter_(submitterRaw, slackMsg);

    mgAudit_('CANCEL_MEETING', token,
      'removed=' + removed + ' failed=' + failed + ' phone=' + phoneRestored + ' phone_failed=' + phoneFailed,
      removed ? 'OK' : 'WARN');

    if (!removed) {
      return { ok: false, message: 'Could not remove meeting blocks from Assembled. Check Audit tab.' };
    }
    var userMsg = 'Meeting cancelled — removed ' + removed + ' Meeting block(s) from Assembled.';
    if (phoneRestored) {
      userMsg += ' Restored Phone time on ' + phoneRestored + ' schedule' + (phoneRestored === 1 ? '' : 's') + '.';
    } else if (phoneFailed || !phoneTypeId) {
      userMsg += ' Warning: Phone blocks were not restored — check Audit tab.';
    }
    return {
      ok:      true,
      message: userMsg
    };
  } catch (err) {
    mgAudit_('CANCEL_MEETING', String(token || ''), String(err && err.stack ? err.stack : err), 'FAILED');
    return { ok: false, message: 'Something went wrong: ' + String(err) };
  } finally {
    lock.releaseLock();
  }
}

/***************************************
 * EXTEND MEETING +15 MIN — same Cancel Tokens tab / web app
 ***************************************/

function mgBuildExtendSlackLink_(token) {
  var base = mgGetWebAppUrl_();
  if (!base || !token) return '';
  var url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'extend=' + encodeURIComponent(token);
  return '<' + url + '|\u23F1 +15 min>';
}

function mgAddMinutesToTimeStr_(timeStr, minutes) {
  var parsed = mgParseTimeInt_(timeStr);
  if (!parsed) return String(timeStr || '');
  var d = mgBuildDateTime_('2000-01-01', parsed);
  if (!d) return parsed;
  d = new Date(d.getTime() + Number(minutes || 0) * 60000);
  return Utilities.formatDate(d, MG.TZ, 'HH:mm');
}

function mgUpdateCancelTokenAfterExtend_(rowNum, commits, endStr) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.CANCEL_TOKENS);
  if (!sheet || !rowNum) return;
  sheet.getRange(rowNum, MG.CANCEL_COLS.ACTIVITY_JSON).setValue(JSON.stringify(commits || []));
  sheet.getRange(rowNum, MG.CANCEL_COLS.END_STR).setValue(String(endStr || ''));
  SpreadsheetApp.flush();
}

function mgUpdateRequestEndTime_(sourceRowNum, endStr) {
  var rowNum = Number(sourceRowNum || 0);
  if (!rowNum || rowNum < 2 || !endStr) return;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.REQUESTS);
  if (!sheet) return;
  sheet.getRange(rowNum, MG.COLS.END).setValue(String(endStr));
  SpreadsheetApp.flush();
}

function mgExtendMeetingActivityCommit_(headers, commit, meetingTypeId, extraSec, description, rowRef) {
  extraSec = Number(extraSec || 0) || MG.EXTEND_MINUTES * 60;
  var startSec = Number(commit.startSec);
  var endSec   = Number(commit.endSec) + extraSec;
  if (!commit || !commit.agentId || !startSec || !endSec || endSec <= startSec) {
    return { ok: false };
  }

  if (commit.activityId) {
    mgAssembledDelete_(headers, '/activities/' + commit.activityId, null);
    Utilities.sleep(MG.ASSEMBLED.SLEEP_MS);
  }

  var payload = {
    agent_id:    commit.agentId,
    type_id:     meetingTypeId,
    start_time:  startSec,
    end_time:    endSec,
    description: description || 'Team meeting'
  };
  try {
    var resp  = mgAssembledPost_(headers, '/activities', payload);
    var actId = String(resp.id || (resp.activity && resp.activity.id) || '').trim();
    mgAudit_('EXTEND_COMMIT', rowRef,
      'Extended Meeting for ' + commit.email + ' | end=' + endSec + (actId ? ' | id=' + actId : ''), 'OK');
    return {
      ok: true,
      email: commit.email,
      name: commit.name,
      agentId: commit.agentId,
      activityId: actId || commit.activityId,
      startSec: startSec,
      endSec: endSec
    };
  } catch (err) {
    mgAudit_('EXTEND_COMMIT', rowRef,
      'POST failed for ' + commit.email + ': ' + String(err), 'FAILED');
    return { ok: false };
  } finally {
    Utilities.sleep(MG.ASSEMBLED.SLEEP_MS);
  }
}

function mgExtendCalendarEvent_(managerEmail, eventId, newMeetingEnd, rowRef, managerName) {
  if (!eventId || !newMeetingEnd) return false;
  var calendarEmails = mgManagerCalendarEmails_(managerName, managerEmail);
  if (calendarEmails.indexOf('primary') === -1) calendarEmails.push('primary');
  var endDt = Utilities.formatDate(newMeetingEnd, MG.TZ, "yyyy-MM-dd'T'HH:mm:ss");
  var i;
  for (i = 0; i < calendarEmails.length; i++) {
    try {
      var event = Calendar.Events.get(calendarEmails[i], eventId);
      event.end = { dateTime: endDt, timeZone: MG.TZ };
      Calendar.Events.update(event, calendarEmails[i], eventId, { sendUpdates: 'all' });
      mgAudit_('CALENDAR_EXTEND', rowRef,
        'Extended event ' + eventId + ' on ' + calendarEmails[i] + ' to ' + endDt, 'OK');
      return true;
    } catch (err) {
      mgAudit_('CALENDAR_EXTEND', rowRef,
        'Failed on ' + calendarEmails[i] + ': ' + String(err), 'WARN');
    }
  }
  return false;
}

function mgExecuteExtendToken_(token) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, message: 'Could not acquire lock. Try again in a moment.' };
  }
  try {
    var hit = mgLookupCancelTokenRow_(token);
    if (!hit) {
      return { ok: false, message: 'Invalid or unknown extend link.' };
    }

    var row = hit.row;
    var rowNum = hit.rowNum;
    var status = String(row[MG.CANCEL_COLS.STATUS - 1] || '').trim().toUpperCase();
    if (status === 'CANCELLED') {
      return { ok: false, message: 'This meeting was cancelled — cannot extend.' };
    }
    if (status !== 'ACTIVE') {
      return { ok: false, message: 'This extend link is no longer active.' };
    }

    var createdAt = row[MG.CANCEL_COLS.CREATED_AT - 1];
    if (createdAt instanceof Date && !isNaN(createdAt.getTime())) {
      if (new Date().getTime() - createdAt.getTime() > MG.CANCEL_TOKEN_TTL_MS) {
        mgUpdateCancelTokenStatus_(rowNum, 'EXPIRED');
        return { ok: false, message: 'This extend link has expired.' };
      }
    }

    var submitterRaw = String(row[MG.CANCEL_COLS.SUBMITTER_RAW - 1] || '').trim();
    var managerRaw   = String(row[MG.CANCEL_COLS.MANAGER_RAW - 1] || '').trim();
    var title        = String(row[MG.CANCEL_COLS.TITLE - 1] || '').trim();
    var dateStr      = mgParseDateStr_(row[MG.CANCEL_COLS.DATE_STR - 1]);
    var startStr     = mgParseTimeInt_(row[MG.CANCEL_COLS.START_STR - 1]);
    var endStr       = mgParseTimeInt_(row[MG.CANCEL_COLS.END_STR - 1]);
    var sourceRowNum = Number(row[MG.CANCEL_COLS.SOURCE_ROW - 1] || 0) || 0;
    var managerEmail = String(row[MG.CANCEL_COLS.MANAGER_EMAIL - 1] || '').trim();
    var calendarEventId = String(row[MG.CANCEL_COLS.CALENDAR_EVENT - 1] || '').trim();
    var activityJson = String(row[MG.CANCEL_COLS.ACTIVITY_JSON - 1] || '[]');

    if (!dateStr || !startStr || !endStr) {
      return { ok: false, message: 'Could not parse meeting time for extend.' };
    }

    var commits = [];
    try {
      commits = JSON.parse(activityJson);
    } catch (parseErr) {
      commits = [];
    }
    if (!commits.length) {
      return { ok: false, message: 'No stored meeting blocks to extend.' };
    }

    var roster = mgLoadRoster_();
    var managerName = roster.length ? mgResolveManagerName_(managerRaw, roster) : mgNormalizeManagerName_(managerRaw);
    var newEndStr = mgAddMinutesToTimeStr_(endStr, MG.EXTEND_MINUTES);
    var meetingEnd = mgBuildDateTime_(dateStr, newEndStr);
    if (!meetingEnd) {
      return { ok: false, message: 'Could not compute extended end time.' };
    }

    var apiKey = mgGetApiKey_();
    var headers = mgAuthHeaders_(apiKey);
    var meetingTypeId = mgResolveMeetingActivityTypeId_(headers);
    if (!meetingTypeId) {
      return { ok: false, message: 'Could not resolve Meeting activity type in Assembled.' };
    }

    var meetLink = mgGetManagerMeetLink_(managerEmail, managerName);
    var description = title || 'Team meeting';
    if (meetLink) description += (description ? ' | ' : '') + 'Join: ' + meetLink;

    var rowRef = sourceRowNum ? ('Row ' + sourceRowNum) : ('extend-' + token);
    var extended = 0;
    var failed = 0;
    var updatedCommits = [];

    commits.forEach(function(c) {
      var result = mgExtendMeetingActivityCommit_(
        headers, c, meetingTypeId, MG.EXTEND_MINUTES * 60, description, rowRef
      );
      if (result.ok) {
        extended++;
        updatedCommits.push(result);
      } else {
        failed++;
        updatedCommits.push(c);
      }
    });

    if (!extended) {
      return { ok: false, message: 'Could not extend meeting blocks in Assembled. Check Audit tab.' };
    }

    var calendarExtended = mgExtendCalendarEvent_(
      managerEmail, calendarEventId, meetingEnd, rowRef, managerName
    );

    mgUpdateCancelTokenAfterExtend_(rowNum, updatedCommits, newEndStr);
    if (sourceRowNum) {
      mgUpdateRequestEndTime_(sourceRowNum, newEndStr);
    }

    var slackMsg = '\u23F1 *EXTENDED +' + MG.EXTEND_MINUTES + ' MIN* — Meeting: _' + title + '_\n' +
      'New end time: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) +
      '\u2013' + mgFriendlyTime_(newEndStr) + ' CT\n' +
      'Updated *' + extended + '* Assembled schedule' + (extended === 1 ? '' : 's') + '.';
    if (calendarExtended) slackMsg += '\nGoogle Calendar invite updated.';
    else if (calendarEventId) slackMsg += '\n_Calendar could not be updated — check Audit tab._';
    if (failed) slackMsg += '\n_' + failed + ' schedule(s) failed to extend — check Audit tab._';
    mgSlackDmSubmitter_(submitterRaw, slackMsg);

    mgAudit_('EXTEND_MEETING', token,
      'extended=' + extended + ' failed=' + failed + ' calendar=' + (calendarExtended ? 'yes' : 'no'),
      extended ? 'OK' : 'WARN');

    var userMsg = 'Meeting extended by ' + MG.EXTEND_MINUTES + ' minutes — now ends at ' +
      mgFriendlyTime_(newEndStr) + ' CT.';
    if (calendarExtended) userMsg += ' Calendar invite updated.';
    return { ok: true, message: userMsg };
  } catch (err) {
    mgAudit_('EXTEND_MEETING', String(token || ''), String(err && err.stack ? err.stack : err), 'FAILED');
    return { ok: false, message: 'Something went wrong: ' + String(err) };
  } finally {
    lock.releaseLock();
  }
}

/***************************************
 * ADD REPS — web form (max 2) on BOOKED Slack ping
 ***************************************/

function mgBuildAddRepsSlackLink_(token) {
  var base = mgGetWebAppUrl_();
  if (!base || !token) return '';
  var url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'addreps=' + encodeURIComponent(token);
  return '<' + url + '|\uD83D\uDC65 Add reps>';
}

function mgLoadCancelTokenContext_(token) {
  var hit = mgLookupCancelTokenRow_(token);
  if (!hit) return { ok: false, error: 'Invalid or unknown link.' };

  var row = hit.row;
  var status = String(row[MG.CANCEL_COLS.STATUS - 1] || '').trim().toUpperCase();
  if (status === 'CANCELLED') {
    return { ok: false, error: 'This meeting was cancelled — cannot add reps.' };
  }
  if (status !== 'ACTIVE') {
    return { ok: false, error: 'This link is no longer active.' };
  }

  var createdAt = row[MG.CANCEL_COLS.CREATED_AT - 1];
  if (createdAt instanceof Date && !isNaN(createdAt.getTime())) {
    if (new Date().getTime() - createdAt.getTime() > MG.CANCEL_TOKEN_TTL_MS) {
      mgUpdateCancelTokenStatus_(hit.rowNum, 'EXPIRED');
      return { ok: false, error: 'This link has expired.' };
    }
  }

  var dateStr = mgParseDateStr_(row[MG.CANCEL_COLS.DATE_STR - 1]);
  var startStr = mgParseTimeInt_(row[MG.CANCEL_COLS.START_STR - 1]);
  var endStr = mgParseTimeInt_(row[MG.CANCEL_COLS.END_STR - 1]);
  if (!dateStr || !startStr || !endStr) {
    return { ok: false, error: 'Could not read meeting time for this link.' };
  }

  return {
    ok: true,
    hit: hit,
    meta: {
      title: String(row[MG.CANCEL_COLS.TITLE - 1] || '').trim() || 'Team meeting',
      whenLabel: mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT',
      dateStr: dateStr,
      startStr: startStr,
      endStr: endStr,
      managerRaw: String(row[MG.CANCEL_COLS.MANAGER_RAW - 1] || '').trim(),
      submitterRaw: String(row[MG.CANCEL_COLS.SUBMITTER_RAW - 1] || '').trim(),
      managerEmail: String(row[MG.CANCEL_COLS.MANAGER_EMAIL - 1] || '').trim(),
      calendarEventId: String(row[MG.CANCEL_COLS.CALENDAR_EVENT - 1] || '').trim(),
      sourceRowNum: Number(row[MG.CANCEL_COLS.SOURCE_ROW - 1] || 0) || 0,
      emailsCsv: String(row[MG.CANCEL_COLS.EMAILS_CSV - 1] || '').trim(),
      activityJson: String(row[MG.CANCEL_COLS.ACTIVITY_JSON - 1] || '[]')
    }
  };
}

function mgParseAddRepsNames_(raw) {
  var tokens = String(raw || '').split(/[,;\n]+/).map(function(t) { return t.trim(); }).filter(Boolean);
  var truncated = tokens.length > MG.ADD_REPS_MAX;
  return {
    names: tokens.slice(0, MG.ADD_REPS_MAX),
    truncated: truncated
  };
}

function mgAddRepsFormPage_(token, meta) {
  var postUrl = mgGetWebAppUrl_();
  var title = mgEscHtml_(meta.title || 'Team meeting');
  var when = mgEscHtml_(meta.whenLabel || '');
  var tok = mgEscHtml_(token);
  var url = mgEscHtml_(postUrl);
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1.0">',
    '<title>' + MG_MANAGER_BRAND + ' — Add reps</title></head>',
    '<body style="margin:0;padding:0;background:#1F4E78;font-family:Arial,sans-serif;color:#fff;">',
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">',
    '<div style="max-width:520px;width:100%;background:#2E6DA4;border-radius:16px;padding:32px;box-shadow:0 10px 30px rgba(0,0,0,0.25);">',
    '<div style="font-size:22px;font-weight:bold;margin-bottom:8px;">Add reps to meeting</div>',
    '<div style="font-size:15px;color:#cce4f7;margin-bottom:4px;">' + title + '</div>',
    '<div style="font-size:14px;color:#cce4f7;margin-bottom:20px;">' + when + '</div>',
    '<form method="POST" action="' + url + '">',
    '<input type="hidden" name="addreps" value="' + tok + '">',
    '<label style="display:block;font-size:14px;margin-bottom:8px;color:#fff;">Consultant names (max ' + MG.ADD_REPS_MAX + ', comma-separated)</label>',
    '<input type="text" name="names" required autocomplete="off" placeholder="e.g. Jane Doe, John Smith" ',
    'style="width:100%;box-sizing:border-box;padding:12px;border:none;border-radius:8px;font-size:16px;margin-bottom:16px;">',
    '<button type="submit" style="width:100%;padding:12px 16px;border:none;border-radius:8px;background:#1F4E78;color:#fff;font-size:16px;font-weight:600;cursor:pointer;">Add to meeting</button>',
    '</form>',
    '<div style="font-size:13px;color:#cce4f7;margin-top:16px;">Names must match Import Roster on your team. Reps get a Google Calendar invite with the Meet link and a Meeting block in Assembled.</div>',
    '</div></div></body></html>'
  ].join('');
}

function mgUpdateCancelTokenAfterAddReps_(rowNum, commits, emailsCsv) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.CANCEL_TOKENS);
  if (!sheet || !rowNum) return;
  sheet.getRange(rowNum, MG.CANCEL_COLS.ACTIVITY_JSON).setValue(JSON.stringify(commits || []));
  if (emailsCsv != null) sheet.getRange(rowNum, MG.CANCEL_COLS.EMAILS_CSV).setValue(String(emailsCsv));
  SpreadsheetApp.flush();
}

function mgAppendRequestAttendees_(sourceRowNum, newNames) {
  var rowNum = Number(sourceRowNum || 0);
  if (!rowNum || rowNum < 2 || !newNames || !newNames.length) return;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.REQUESTS);
  if (!sheet) return;
  var existing = String(sheet.getRange(rowNum, MG.COLS.ATTENDEES).getValue() || '').trim();
  var suffix = newNames.join(', ');
  var merged = existing ? (existing + ', ' + suffix) : suffix;
  sheet.getRange(rowNum, MG.COLS.ATTENDEES).setValue(merged);
  SpreadsheetApp.flush();
}

function mgCommitAddRepMeeting_(headers, rep, meetingStart, meetingEnd, meetingTypeId, description, rowRef) {
  var startSec = Math.floor(meetingStart.getTime() / 1000);
  var endSec = Math.floor(meetingEnd.getTime() / 1000);
  var agentId = mgResolveAgentIdByEmail_(headers, rep.email);
  if (!agentId) {
    mgAudit_('ADD_REPS_COMMIT', rowRef, 'No agent ID for ' + rep.email, 'FAILED');
    return { ok: false, name: rep.name, email: rep.email };
  }
  try {
    var resp = mgAssembledPost_(headers, '/activities', {
      agent_id: agentId,
      type_id: meetingTypeId,
      start_time: startSec,
      end_time: endSec,
      description: description || 'Team meeting'
    });
    var actId = String(resp.id || (resp.activity && resp.activity.id) || '').trim();
    mgAudit_('ADD_REPS_COMMIT', rowRef,
      'Added Meeting for ' + rep.email + (actId ? ' | id=' + actId : ''), 'OK');
    return {
      ok: true,
      email: rep.email,
      name: rep.name,
      agentId: agentId,
      activityId: actId,
      startSec: startSec,
      endSec: endSec
    };
  } catch (err) {
    mgAudit_('ADD_REPS_COMMIT', rowRef, 'POST failed for ' + rep.email + ': ' + String(err), 'FAILED');
    return { ok: false, name: rep.name, email: rep.email };
  } finally {
    Utilities.sleep(MG.ASSEMBLED.SLEEP_MS);
  }
}

function mgAddAttendeesToCalendarEvent_(managerEmail, eventId, newReps, rowRef, managerName) {
  if (!eventId || !newReps || !newReps.length) return { ok: false, added: 0 };
  var config = mgLoadConfig_();
  if (!mgConfigBool_(config, MG.CFG.CALENDAR_INVITES, true)) {
    return { ok: false, added: 0, disabled: true };
  }

  var calendarEmails = mgManagerCalendarEmails_(managerName, managerEmail);
  if (calendarEmails.indexOf('primary') === -1) calendarEmails.push('primary');
  var ci;
  for (ci = 0; ci < calendarEmails.length; ci++) {
    try {
      var calendarId = calendarEmails[ci];
      var event = Calendar.Events.get(calendarId, eventId);
      var existing = {};
      (event.attendees || []).forEach(function(a) {
        if (a.email) existing[String(a.email).trim().toLowerCase()] = true;
      });
      var toInvite = newReps.filter(function(r) {
        return r.email && !existing[String(r.email).trim().toLowerCase()];
      });
      if (!toInvite.length) {
        return { ok: true, added: 0, alreadyOnInvite: true };
      }
      event.attendees = event.attendees || [];
      toInvite.forEach(function(r) {
        event.attendees.push({ email: r.email });
      });
      Calendar.Events.update(event, calendarId, eventId, { sendUpdates: 'all' });
      mgAudit_('CALENDAR_ADD_REPS', rowRef,
        'Invited ' + toInvite.length + ' guest(s) on ' + calendarId + ' event ' + eventId, 'OK');
      return {
        ok: true,
        added: toInvite.length,
        names: toInvite.map(function(r) { return r.name; })
      };
    } catch (err) {
      mgAudit_('CALENDAR_ADD_REPS', rowRef,
        'Failed on ' + calendarEmails[ci] + ': ' + String(err), 'WARN');
    }
  }
  return { ok: false, added: 0 };
}

function mgExecuteAddRepsToken_(token, namesRaw) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, message: 'Could not acquire lock. Try again in a moment.' };
  }
  try {
    var ctx = mgLoadCancelTokenContext_(token);
    if (!ctx.ok) return { ok: false, message: ctx.error };

    var parsed = mgParseAddRepsNames_(namesRaw);
    if (!parsed.names.length) {
      return { ok: false, message: 'Enter at least one consultant name (max ' + MG.ADD_REPS_MAX + ').' };
    }

    var meta = ctx.meta;
    var hit = ctx.hit;
    var roster = mgLoadRoster_();
    var managerName = roster.length
      ? mgResolveManagerName_(meta.managerRaw, roster)
      : mgNormalizeManagerName_(meta.managerRaw);
    var teamFull = mgGetTeamForManager_(roster, managerName);
    var filterRes = mgApplyManualAttendeeFilter_(teamFull, parsed.names.join(', '), roster, managerName);
    if (filterRes.error) {
      return { ok: false, message: filterRes.error };
    }
    if (filterRes.unmatched && filterRes.unmatched.length) {
      return {
        ok: false,
        message: 'Could not match: ' + filterRes.unmatched.join('; ') +
          '. Use names as they appear on Import Roster for your team.'
      };
    }

    var commits = [];
    try {
      commits = JSON.parse(meta.activityJson || '[]');
    } catch (ignore) {
      commits = [];
    }
    var existingEmails = {};
    commits.forEach(function(c) {
      if (c.email) existingEmails[String(c.email).trim().toLowerCase()] = true;
    });

    var toAdd = filterRes.members.filter(function(r) {
      return r.email && !existingEmails[String(r.email).trim().toLowerCase()];
    });
    if (!toAdd.length) {
      return { ok: false, message: 'Those reps are already on this meeting.' };
    }

    var meetingStart = mgBuildDateTime_(meta.dateStr, meta.startStr);
    var meetingEnd = mgBuildDateTime_(meta.dateStr, meta.endStr);
    if (!meetingStart || !meetingEnd) {
      return { ok: false, message: 'Could not parse meeting window.' };
    }

    var apiKey = mgGetApiKey_();
    var headers = mgAuthHeaders_(apiKey);
    var meetingTypeId = mgResolveMeetingActivityTypeId_(headers);
    if (!meetingTypeId) {
      return { ok: false, message: 'Could not resolve Meeting activity type in Assembled.' };
    }

    var meetLink = mgGetManagerMeetLink_(meta.managerEmail, managerName);
    var description = meta.title || 'Team meeting';
    if (meetLink) description += (description ? ' | ' : '') + 'Join: ' + meetLink;

    var rowRef = meta.sourceRowNum ? ('Row ' + meta.sourceRowNum) : ('addreps-' + token);
    var added = [];
    var failed = [];
    var updatedCommits = commits.slice();

    toAdd.forEach(function(rep) {
      var result = mgCommitAddRepMeeting_(
        headers, rep, meetingStart, meetingEnd, meetingTypeId, description, rowRef
      );
      if (result.ok) {
        added.push(result);
        updatedCommits.push(result);
      } else {
        failed.push(result.name || rep.name);
      }
    });

    if (!added.length) {
      return { ok: false, message: 'Could not add reps in Assembled. Check Audit tab.' };
    }

    var calendarResult = mgAddAttendeesToCalendarEvent_(
      meta.managerEmail, meta.calendarEventId, added, rowRef, managerName
    );

    var newEmails = added.map(function(c) { return c.email; });
    var emailsCsv = meta.emailsCsv;
    if (emailsCsv) emailsCsv += ',' + newEmails.join(',');
    else emailsCsv = newEmails.join(',');

    mgUpdateCancelTokenAfterAddReps_(hit.rowNum, updatedCommits, emailsCsv);
    if (meta.sourceRowNum) {
      mgAppendRequestAttendees_(meta.sourceRowNum, added.map(function(c) { return c.name; }));
    }

    var addedNames = added.map(function(c) { return c.name; }).join(', ');
    var slackMsg = '\uD83D\uDC65 *REPS ADDED* — Meeting: _' + meta.title + '_\n' +
      meta.whenLabel + '\n' +
      'Added *' + added.length + '* rep' + (added.length === 1 ? '' : 's') + ': ' + addedNames + '.';
    if (calendarResult.ok && calendarResult.added) {
      slackMsg += '\nGoogle Calendar invites sent with Meet link.';
    } else if (meta.calendarEventId && !calendarResult.ok) {
      slackMsg += '\n_Assembled updated; calendar invite could not be updated — check Audit tab._';
    } else if (!meta.calendarEventId) {
      slackMsg += '\n_Assembled updated (no calendar event on file for this meeting)._';
    }
    if (parsed.truncated) {
      slackMsg += '\n_Only the first ' + MG.ADD_REPS_MAX + ' names were processed._';
    }
    if (failed.length) {
      slackMsg += '\n_Failed for: ' + failed.join(', ') + ' — check Audit tab._';
    }
    mgSlackDmSubmitter_(meta.submitterRaw, slackMsg);

    mgAudit_('ADD_REPS', token, 'added=' + added.length + ' failed=' + failed.length, 'OK');

    var userMsg = 'Added ' + addedNames + ' to the meeting.';
    if (calendarResult.ok && calendarResult.added) {
      userMsg += ' Calendar invites sent.';
    }
    if (parsed.truncated) {
      userMsg += ' (Only ' + MG.ADD_REPS_MAX + ' names per submit.)';
    }
    return { ok: true, message: userMsg };
  } catch (err) {
    mgAudit_('ADD_REPS', String(token || ''), String(err && err.stack ? err.stack : err), 'FAILED');
    return { ok: false, message: 'Something went wrong: ' + String(err) };
  } finally {
    lock.releaseLock();
  }
}

/***************************************
 * BOOK IT — Web app + Booking Tokens tab
 ***************************************/

/** Deployed web app URL (…/exec). Same pattern as OT_WEB_APP_URL / RVTO_WEB_APP_URL. */
function mgGetWebAppUrl_() {
  return String(PropertiesService.getScriptProperties().getProperty('MG_WEB_APP_URL') || '').trim().replace(/\/+$/, '');
}

function mgGetOrCreateBookingTokensSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MG.SHEETS.BOOKING_TOKENS);
  if (!sheet) {
    sheet = ss.insertSheet(MG.SHEETS.BOOKING_TOKENS);
    var headers = [
      'Token', 'Created At', 'Status', 'Manager', 'Submitter', 'Title', 'Manual Attendees',
      'Date', 'Start', 'End', 'Emails', 'Source Row', 'Recurring ID'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1F4E78')
      .setFontColor('#ffffff');
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function mgCreateBookingToken_(opts) {
  mgGetOrCreateBookingTokensSheet_();
  var token = Utilities.getUuid().replace(/-/g, '');
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.BOOKING_TOKENS);
  sheet.appendRow([
    token,
    new Date(),
    'PENDING',
    opts.managerRaw || '',
    opts.submitterRaw || '',
    opts.title || '',
    opts.manualRaw || '',
    opts.dateStr || '',
    opts.startStr || '',
    opts.endStr || '',
    opts.emailsCsv || '',
    opts.sourceRowNum || '',
    opts.recurringId || ''
  ]);
  // Keep date / start / end as plain text so Sheets does not coerce to Date (breaks Book it reads)
  var lr = sheet.getLastRow();
  var nCols = MG.BOOK_COLS.END_STR - MG.BOOK_COLS.DATE_STR + 1;
  var rDt = sheet.getRange(lr, MG.BOOK_COLS.DATE_STR, 1, nCols);
  rDt.setNumberFormat('@');
  rDt.setValues([[String(opts.dateStr || ''), String(opts.startStr || ''), String(opts.endStr || '')]]);
  SpreadsheetApp.flush();
  mgAudit_('BOOK_TOKEN', token, 'slot ' + opts.dateStr + ' ' + opts.startStr + '-' + opts.endStr, 'OK');
  return token;
}

function mgBuildBookItSlackLink_(token) {
  var base = mgGetWebAppUrl_();
  if (!base) {
    return '';
  }
  var url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(token);
  return '<' + url + '|📅 Book it>';
}

function mgLookupBookingTokenRow_(token) {
  var t = String(token || '').trim().toLowerCase();
  if (!t) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.BOOKING_TOKENS);
  if (!sheet || sheet.getLastRow() <= 1) return null;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === t) {
      return { rowNum: i + 1, row: values[i] };
    }
  }
  return null;
}

function mgUpdateBookingTokenStatus_(rowNum, status) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.BOOKING_TOKENS);
  if (!sheet || !rowNum) return;
  sheet.getRange(rowNum, MG.BOOK_COLS.STATUS).setValue(status);
  SpreadsheetApp.flush();
}

function mgRosterMembersFromEmailsCsv_(roster, emailsCsv) {
  var set = {};
  String(emailsCsv || '').split(',').forEach(function(e) {
    var x = e.trim().toLowerCase();
    if (x) set[x] = true;
  });
  return roster.filter(function(r) { return set[r.email]; });
}

function mgAppendBookItRequestsRow_(managerRaw, title, dateStr, startStr, endStr, scheduledAttendees, submitterRaw, okCommit, commitResult, testMode) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.REQUESTS);
  if (!sheet) return;
  var dateCell = mgBuildDateTime_(dateStr, '12:00');
  var names = scheduledAttendees.map(function(r) { return r.name; }).join(', ');
  var decision = okCommit
    ? (testMode ? 'APPROVED — Book it (TEST: one rep)' : 'APPROVED — Book it')
    : 'APPROVED — Book it — Assembled Error: ' + commitResult.failed.join(', ');
  sheet.appendRow([
    new Date(),
    managerRaw,
    title,
    dateCell,
    startStr,
    endStr,
    names,
    submitterRaw,
    decision,
    'Self-booked via alternative-window link.'
  ]);
  SpreadsheetApp.flush();
}

function mgExecuteBookItToken_(token) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, message: 'Could not acquire lock. Try again in a moment.' };
  }
  try {
    var hit = mgLookupBookingTokenRow_(token);
    if (!hit) {
      return { ok: false, message: 'Invalid or unknown booking link.' };
    }

    var row = hit.row;
    var rowNum = hit.rowNum;
    var status = String(row[MG.BOOK_COLS.STATUS - 1] || '').trim().toUpperCase();
    if (status === 'USED') {
      return { ok: true, message: 'This meeting slot was already booked.' };
    }
    if (status !== 'PENDING') {
      return { ok: false, message: 'This booking link is no longer active.' };
    }

    var createdAt = row[MG.BOOK_COLS.CREATED_AT - 1];
    if (createdAt instanceof Date && !isNaN(createdAt.getTime())) {
      if (new Date().getTime() - createdAt.getTime() > MG.BOOKING_TOKEN_TTL_MS) {
        mgUpdateBookingTokenStatus_(rowNum, 'EXPIRED');
        return { ok: false, message: 'This booking link has expired. Submit a new meeting request.' };
      }
    }

    var managerRaw = String(row[MG.BOOK_COLS.MANAGER_RAW - 1] || '').trim();
    var submitterRaw = String(row[MG.BOOK_COLS.SUBMITTER_RAW - 1] || '').trim();
    var title = String(row[MG.BOOK_COLS.TITLE - 1] || '').trim();
    // Sheet may coerce yyyy-MM-dd / HH:mm to Date cells — never String() those into mgBuildDateTime_
    var dateStr  = mgParseDateStr_(row[MG.BOOK_COLS.DATE_STR - 1]);
    var startStr = mgParseTimeInt_(row[MG.BOOK_COLS.START_STR - 1]);
    var endStr   = mgParseTimeInt_(row[MG.BOOK_COLS.END_STR - 1]);
    var emailsCsv = String(row[MG.BOOK_COLS.EMAILS_CSV - 1] || '').trim();
    var sourceRowNum = Number(row[MG.BOOK_COLS.SOURCE_ROW - 1] || 0) || 0;
    var recurringId = String(row[MG.BOOK_COLS.RECURRING_ID - 1] || '').trim();

    var meetingStart = mgBuildDateTime_(dateStr, startStr);
    var meetingEnd = mgBuildDateTime_(dateStr, endStr);
    if (!meetingStart || !meetingEnd || meetingEnd <= meetingStart) {
      return { ok: false, message: 'Booking data is invalid (bad date/time).' };
    }

    var config = mgLoadConfig_();
    var blackoutHit = mgGetMeetingBlackoutHit_(dateStr, meetingStart, config);
    if (blackoutHit) {
      return { ok: false, message: 'This date is blocked for team meetings. Pick another day or contact WFM.' };
    }

    var roster = mgLoadRoster_();
    if (!roster.length) {
      return { ok: false, message: 'Roster unavailable. Try again later.' };
    }

    var managerName = mgResolveManagerName_(managerRaw, roster);
    if (!managerName) {
      return { ok: false, message: 'Could not parse manager name.' };
    }
    var managerEmail = mgResolveManagerEmail_(managerName);

    var pool = mgRosterMembersFromEmailsCsv_(roster, emailsCsv);
    if (!pool.length) {
      return { ok: false, message: 'No matching reps found for this booking.' };
    }

    var apiKey = mgGetApiKey_();
    var headers = mgAuthHeaders_(apiKey);
    var scheduledEmails = mgGetScheduledEmails_(headers, meetingStart, meetingEnd);
    var scheduledAttendees = pool.filter(function(r) { return scheduledEmails.has(r.email); });

    if (!scheduledAttendees.length) {
      return { ok: false, message: 'None of the intended reps are scheduled during this window anymore. Submit a new request.' };
    }

    var queue = scheduledAttendees[0].queue;
    if (!queue) {
      return { ok: false, message: 'Could not resolve queue for attendees.' };
    }

    var siteId = mgResolveSiteId_(headers, MG.ASSEMBLED.SITE_NAME);
    var queueId = mgResolveQueueId_(headers, queue);
    if (!queueId) {
      return { ok: false, message: 'Could not resolve Assembled queue.' };
    }

    var netStaffing = mgGetNetStaffingForWindow_(headers, siteId, queueId, meetingStart, meetingEnd);
    var postNet = netStaffing - scheduledAttendees.length;
    var minBuffer = mgGetStaffingMinBuffer_(config);
    if (postNet < minBuffer) {
      mgAudit_('BOOK_IT', token, 'Capacity fail net=' + netStaffing + ' n=' + scheduledAttendees.length, 'WARN');
      return { ok: false, message: 'Staffing changed — this slot is no longer available. Submit a new meeting request.' };
    }

    var testMode = mgIsTestMode_();
    var commitTargets = testMode ? scheduledAttendees.slice(0, 1) : scheduledAttendees;
    var auditRowLabel = sourceRowNum ? sourceRowNum : ('book-' + token);

    var commitResult = mgCommitMeetingToAssembled_(
      headers, commitTargets, meetingStart, meetingEnd, auditRowLabel, title, managerEmail, managerName
    );

    var meetLink = mgGetManagerMeetLink_(managerEmail, managerName);
    var meetLine = mgFormatMeetSlackLine_(meetLink, commitResult.calendar);

    var okCommit = !commitResult.failed.length;
    var slackMsg;
    if (okCommit) {
      var addedName = commitTargets[0] ? commitTargets[0].name : 'unknown';
      var bookFooter = testMode
        ? '\n\n_\u26a0\ufe0f TEST MODE — only ' + addedName + '\'s schedule was updated in Assembled._'
        : '';
      slackMsg = mgWrapApprovalSlack_(title, dateStr, startStr, endStr,
        'You\'re booked.\n',
        meetLine, commitResult, bookFooter, {
          managerRaw: managerRaw, submitterRaw: submitterRaw, sourceRowNum: sourceRowNum, managerEmail: managerEmail,
          emailsCsv: scheduledAttendees.map(function(r) { return r.email; }).join(','),
          recurringId: recurringId || '',
          skipMakeRecurring: !!recurringId
        });
      mgUpdateBookingTokenStatus_(rowNum, 'USED');
      if (recurringId) {
        mgMarkRecurringAltBooked_(recurringId, dateStr);
      }
    } else {
      slackMsg = mgWrapApprovalSlack_(title, dateStr, startStr, endStr,
        'Booking partially failed for: ' + commitResult.failed.join(', ') + '.\n',
        meetLine, commitResult, '', {
          managerRaw: managerRaw, submitterRaw: submitterRaw, sourceRowNum: sourceRowNum, managerEmail: managerEmail,
          emailsCsv: scheduledAttendees.map(function(r) { return r.email; }).join(',')
        });
      mgUpdateBookingTokenStatus_(rowNum, 'FAILED');
    }

    mgAppendBookItRequestsRow_(managerRaw, title, dateStr, startStr, endStr, scheduledAttendees, submitterRaw, okCommit, commitResult, testMode);
    mgSlackDmSubmitter_(submitterRaw, slackMsg);

    mgAudit_('BOOK_IT', token, 'ok=' + okCommit + ' attendees=' + scheduledAttendees.length, okCommit ? 'OK' : 'WARN');

    if (!okCommit) {
      return { ok: false, message: 'Booking partially failed for: ' + commitResult.failed.join(', ') + '. Check Slack for details.' };
    }
    return { ok: true, message: 'You\'re booked. Meeting blocks were added to Assembled. Check Slack for your Meet link.' };
  } catch (err) {
    mgAudit_('BOOK_IT', String(token || ''), String(err && err.stack ? err.stack : err), 'FAILED');
    return { ok: false, message: 'Something went wrong: ' + String(err) };
  } finally {
    lock.releaseLock();
  }
}

function mgEscHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mgBookingResponsePage_(message, isSuccess) {
  var bg = '#1F4E78';
  var card = '#2E6DA4';
  var accent = isSuccess ? '#b8ffcf' : '#ffd6d6';
  var sub = '#cce4f7';
  return [
    '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0">',
    '<title>' + MG_MANAGER_BRAND + '</title></head>',
    '<body style="margin:0;padding:0;background:' + bg + ';font-family:Arial,sans-serif;">',
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">',
    '<div style="max-width:520px;width:100%;background:' + card + ';border-radius:16px;padding:32px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.25);">',
    '<div style="font-size:22px;font-weight:bold;color:#fff;margin-bottom:16px;">' + MG_MANAGER_BRAND + '</div>',
    '<div style="font-size:17px;color:' + accent + ';font-weight:600;margin-bottom:12px;">' + mgEscHtml_(message) + '</div>',
    '<div style="font-size:14px;color:' + sub + ';">You can close this page.</div>',
    '</div></div></body></html>'
  ].join('');
}

function doGet(e) {
  var stopRecurringId = String((e.parameter && e.parameter.stoprecurring) || '').trim();
  if (stopRecurringId) {
    var stopResult = mgExecuteStopRecurring_(stopRecurringId);
    return HtmlService.createHtmlOutput(mgBookingResponsePage_(stopResult.message, stopResult.ok)).setTitle(MG_MANAGER_BRAND);
  }
  var recurringTok = String((e.parameter && e.parameter.recurring) || '').trim();
  if (recurringTok) {
    var recurringResult = mgExecuteRecurringOptIn_(recurringTok);
    return HtmlService.createHtmlOutput(mgBookingResponsePage_(recurringResult.message, recurringResult.ok)).setTitle(MG_MANAGER_BRAND);
  }
  var addRepsTok = String((e.parameter && e.parameter.addreps) || '').trim();
  if (addRepsTok) {
    var addCtx = mgLoadCancelTokenContext_(addRepsTok);
    if (!addCtx.ok) {
      return HtmlService.createHtmlOutput(mgBookingResponsePage_(addCtx.error, false)).setTitle(MG_MANAGER_BRAND);
    }
    return HtmlService.createHtmlOutput(mgAddRepsFormPage_(addRepsTok, addCtx.meta)).setTitle(MG_MANAGER_BRAND);
  }
  var extendTok = String((e.parameter && e.parameter.extend) || '').trim();
  if (extendTok) {
    var extendResult = mgExecuteExtendToken_(extendTok);
    return HtmlService.createHtmlOutput(mgBookingResponsePage_(extendResult.message, extendResult.ok)).setTitle(MG_MANAGER_BRAND);
  }
  var cancelTok = String((e.parameter && e.parameter.cancel) || '').trim();
  if (cancelTok) {
    var cancelResult = mgExecuteCancelToken_(cancelTok);
    return HtmlService.createHtmlOutput(mgBookingResponsePage_(cancelResult.message, cancelResult.ok)).setTitle(MG_MANAGER_BRAND);
  }
  var token = String((e.parameter && e.parameter.token) || '').trim();
  if (!token) {
    return HtmlService.createHtmlOutput(mgBookingResponsePage_('Missing booking token.', false)).setTitle(MG_MANAGER_BRAND);
  }
  var result = mgExecuteBookItToken_(token);
  return HtmlService.createHtmlOutput(mgBookingResponsePage_(result.message, result.ok)).setTitle(MG_MANAGER_BRAND);
}

/***************************************
 * SETUP
 ***************************************/
function setupMeetingGovernor() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  var configSheet = ss.getSheetByName(MG.SHEETS.CONFIG);
  if (!configSheet) {
    configSheet = ss.insertSheet(MG.SHEETS.CONFIG);
  }
  configSheet.clearContents();
  configSheet.getRange(1, 1, 1, 3).setValues([['Key', 'Value', 'Notes']]);
  configSheet.getRange(2, 1, 20, 3).setValues([
    ['TEST_MODE',                    'TRUE', 'Set TRUE to run full logic without sending Slack DMs to managers. Redirects to @robert.sorrell.'],
    ['MEETING_SCAN_ENABLED',         'TRUE', 'Set FALSE to disable the meeting scan (unauthorized + staffing risk) entirely.'],
    ['STAFFING_RISK_SCAN_ENABLED',   'TRUE', 'During meeting scan: re-check net staffing on approved meetings; logs Staffing Risk tab (WFM Slack off unless STAFFING_RISK_WFM_SLACK_ENABLED).'],
    ['LEAD_PACE_SCAN_ENABLED',       'TRUE', 'Use live Intraday Leads sheet (Today vs S&OP) in staffing-risk scan.'],
    ['LEAD_PACE_RISK_PCT',           10,     'Flag WFM if Today leads exceed S&OP by this % during the meeting window (e.g. 10 = +10%).'],
    ['INTRADAY_LEADS_SPREADSHEET_ID', MG.INTRADAY_LEADS.DEFAULT_SPREADSHEET_ID, 'Live leads workbook (share with script runner).'],
    ['INTRADAY_LEADS_TAB',           MG.INTRADAY_LEADS.DEFAULT_TAB, 'Tab with hour / Today / S&OP columns.'],
    ['SCAN_MIN_REPS',                4,      'Unauthorized meeting scan: minimum Consumer Sales reps in the block (Retention / unmapped excluded).'],
    ['SCAN_MIN_DURATION_MINUTES',    30,     'Unauthorized meeting scan: minimum meeting length in minutes.'],
    ['STAFFING_RISK_WFM_SLACK_ENABLED', 'FALSE', 'If TRUE, DM WFM when an approved (tool-submitted) meeting fails staffing-risk re-check. Default FALSE — WFM Slack is for Flagged Meetings (unauthorized) only.'],
    ['MIN_MEETING_DURATION_MINUTES', 30,     'Meetings shorter than this (in minutes) are auto-approved without a capacity check.'],
    ['MIN_MEETING_ATTENDEES',        3,      'Meetings with fewer scheduled attendees than this are auto-approved without a capacity check.'],
    ['MIN_NOTICE_HOURS',             2,      'Meetings starting within this many hours of submission are denied — not enough notice.'],
    ['L7_OVERRIDE_ENABLED',          'TRUE', 'Set TRUE to allow Senior Managers (col F of roster) to bypass the capacity gate and auto-approve.'],
    ['GOOGLE_CALENDAR_INVITES_ENABLED', 'TRUE', 'After Assembled commit: create calendar event and invite manager + reps (sendUpdates=all). Falls back to script primary calendar if manager calendar is not shared. Not skipped by TEST_MODE.'],
    ['MEETING_BLACKOUT_DATES',         '',     'Comma-separated dates (yyyy-MM-dd) that auto-deny, e.g. 2026-05-01, 2026-12-25'],
    ['MEETING_BLACKOUT_DAYS_OF_WEEK',  'sat, sun', 'Comma-separated days that auto-deny (mon, tue, wed, thu, fri, sat, sun).'],
    ['MIN_NET_STAFFING_BUFFER',        -2,     'Minimum post-meeting net staffing to approve (CT). -2 allows net down to -2 after the meeting.'],
    ['ALT_SEARCH_START_HOUR',          9,      'Alternative/split recommendation window start hour (CT, 24h). Weekdays Mon–Fri only.'],
    ['ALT_SEARCH_END_HOUR',            17,     'Alternative/split recommendation window end hour (CT, 24h). Meetings must end by this time.']
  ]);
  configSheet.setFrozenRows(1);
  configSheet.getRange(1, 1, 1, 3)
    .setFontWeight('bold')
    .setBackground('#1F4E78')
    .setFontColor('#ffffff');
  configSheet.autoResizeColumns(1, 3);

  var auditSheet = ss.getSheetByName(MG.SHEETS.AUDIT);
  if (!auditSheet) {
    auditSheet = ss.insertSheet(MG.SHEETS.AUDIT);
    auditSheet.getRange(1, 1, 1, 5).setValues([['Timestamp', 'Event', 'Reference', 'Details', 'Result']]);
    auditSheet.setFrozenRows(1);
    auditSheet.getRange(1, 1, 1, 5)
      .setFontWeight('bold')
      .setBackground('#1F4E78')
      .setFontColor('#ffffff');
  }

  mgSetupChangelog_(ss);
  mgSetupLeadershipTab_(ss);
  mgGetOrCreateFlagSheet_();
  mgGetOrCreateStaffingRiskSheet_();
  mgGetOrCreateBookingTokensSheet_();
  mgGetOrCreateCancelTokensSheet_();
  mgGetOrCreateRecurringSheets_();
  mgEnsureConfigBlackoutRows_();
  mgEnsureConfigMeetingPolicyRows_();
  mgEnsureConfigScanRows_();

  mgRemoveTrigger_('processMeetingRequests');
  ScriptApp.newTrigger('processMeetingRequests')
    .timeBased()
    .everyMinutes(5)
    .create();

  mgRemoveTrigger_('scanForUnauthorizedMeetings');
  ScriptApp.newTrigger('scanForUnauthorizedMeetings')
    .timeBased()
    .everyMinutes(30)
    .create();

  mgRemoveTrigger_('processRecurringMeetings');
  ScriptApp.newTrigger('processRecurringMeetings')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .create();

  mgAudit_('SETUP', '', MG_MANAGER_BRAND + ' ' + MG.VERSION + ' setup complete. TEST_MODE=TRUE. Triggers installed.', 'OK');
  SpreadsheetApp.getUi().alert(
    MG_MANAGER_BRAND + ' ' + MG.VERSION + ' setup complete.\n\n' +
    '\u26a0\ufe0f  TEST MODE is ON — Slack DMs redirected to @robert.sorrell until TEST_MODE = FALSE.\n\n' +
    'Required Script Properties:\n' +
    '  ASSEMBLED_API_KEY\n' +
    '  SLACK_BOT_TOKEN\n' +
    '  MG_WEB_APP_URL (deployed web app /exec URL for Book it links)\n\n' +
    'Required Advanced Service:\n' +
    '  Google Calendar API (Meet links + manager calendar invites)\n\n' +
    'Triggers installed:\n' +
    '  processMeetingRequests — every 5 minutes\n' +
    '  scanForUnauthorizedMeetings — every 30 minutes (unauthorized + staffing risk)\n' +
    '  processRecurringMeetings — daily at 9 AM CT (acts on Fridays only)\n\n' +
    'Next step: ' + MG_MANAGER_BRAND + ' menu → \uD83C\uDF9E Setup Meet Links'
  );
}

function mgRemoveTrigger_(fnName) {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === fnName) ScriptApp.deleteTrigger(t);
  });
}

function scanForUnauthorizedMeetings() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const config = mgLoadConfig_();
  const enabled = mgConfigBool_(config, MG.SCAN_ENABLED_KEY, true);
  if (!enabled) {
    mgAudit_('SCAN', '', 'MEETING_SCAN_ENABLED is FALSE — skipping', 'INFO');
    return;
  }

  mgAudit_('SCAN', '', 'Starting meeting scan (unauthorized + staffing risk, next ' + MG.SCAN_LOOKAHEAD_HOURS + 'h)', 'INFO');
  const now       = new Date();
  const windowEnd = new Date(now.getTime() + MG.SCAN_LOOKAHEAD_HOURS * 60 * 60 * 1000);
  const apiKey    = mgGetApiKey_();
  const headers   = mgAuthHeaders_(apiKey);

  const startSec = Math.floor(now.getTime() / 1000);
  const endSec   = Math.floor(windowEnd.getTime() / 1000);
  const url = MG.ASSEMBLED.BASE_URL + '/activities' +
    '?start_time=' + startSec +
    '&end_time='   + endSec +
    '&include_agents=true' +
    '&include_activity_types=true';

  const resp = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    mgAudit_('SCAN', '', 'Assembled /activities error ' + code, 'FAILED');
    return;
  }

  const data          = JSON.parse(resp.getContentText());
  const activities    = data.activities     || {};
  const agents        = data.agents         || {};
  const activityTypes = data.activity_types || {};

  const typeNames = {};
  Object.keys(activityTypes).forEach(function(id) {
    typeNames[id] = (activityTypes[id].name || '').toLowerCase().trim();
  });

  const actList = Array.isArray(activities)
    ? activities
    : Object.keys(activities).map(function(k) { return activities[k]; });

  const meetingActs = actList.filter(function(act) {
    return (typeNames[act.type_id] || '') === 'meeting';
  });

  mgAudit_('SCAN', '', 'Meeting activities found in next ' + MG.SCAN_LOOKAHEAD_HOURS + 'h: ' + meetingActs.length, 'INFO');

  const roster         = mgLoadRoster_();
  const emailToManager = {};
  const emailToName    = {};
  const emailToQueue   = {};
  roster.forEach(function(r) {
    emailToManager[r.email] = r.manager;
    emailToName[r.email]    = r.name;
    emailToQueue[r.email]   = r.queue;
  });

  const groups = {};
  meetingActs.forEach(function(act) {
    const agentId = (act.agent_id || '').trim();
    const agent   = agents[agentId] || {};
    const email   = (agent.email || agent.primary_email || '').trim().toLowerCase();
    if (!email) return;
    const manager = emailToManager[email];
    if (!manager) return;
    const startTime = act.start_time ? new Date(act.start_time * 1000) : null;
    const endTime   = act.end_time   ? new Date(act.end_time   * 1000) : null;
    if (!startTime || !endTime) return;
    const dow = parseInt(Utilities.formatDate(startTime, MG.TZ, 'u'), 10);
    if (dow === 6 || dow === 7) return;
    const startAligned = Math.floor(act.start_time / MG.ASSEMBLED.INTERVAL) * MG.ASSEMBLED.INTERVAL;
    const endAligned   = Math.floor(act.end_time   / MG.ASSEMBLED.INTERVAL) * MG.ASSEMBLED.INTERVAL;
    const key = manager + '|' + startAligned + '|' + endAligned;
    if (!groups[key]) {
      groups[key] = { manager: manager, startTime: startTime, endTime: endTime, reps: [] };
    }
    groups[key].reps.push({ email: email, name: emailToName[email] || email, queue: emailToQueue[email] || '' });
  });

  const flaggedGroups = Object.keys(groups).filter(function(k) {
    return mgScanGroupQualifies_(groups[k], config).ok;
  });

  var scanMinReps = mgConfigNum_(config, MG.CFG.SCAN_MIN_REPS, MG.SCAN_MIN_REPS);
  mgAudit_('SCAN', '', 'Groups qualifying for unauthorized scan (' + scanMinReps + '+ CS reps, ' +
    mgConfigNum_(config, MG.CFG.SCAN_MIN_DURATION, MG.SCAN_MIN_DURATION_MIN) + '+ min): ' +
    flaggedGroups.length, 'INFO');

  const approvedRequests = mgLoadApprovedRequests_();
  const flagSheet        = mgGetOrCreateFlagSheet_();

  flaggedGroups.forEach(function(key) {
    const group    = groups[key];
    const qual     = mgScanGroupQualifies_(group, config);
    const dateStr  = Utilities.formatDate(group.startTime, MG.TZ, 'yyyy-MM-dd');
    const startStr = Utilities.formatDate(group.startTime, MG.TZ, 'HH:mm');
    const endStr   = Utilities.formatDate(group.endTime,   MG.TZ, 'HH:mm');
    const repNames = group.reps.map(function(r) { return r.name; }).join(', ');
    const queue    = qual.queue || 'Unknown';

    const matched = mgMatchesApprovedRequest_(approvedRequests, group.manager, dateStr, group.startTime, group.endTime);
    if (matched) {
      mgAudit_('SCAN', group.manager, 'Group of ' + group.reps.length + ' matched approved request — skipping flag', 'INFO');
      return;
    }

    if (mgAlreadyFlagged_(flagSheet, group.manager, dateStr, startStr)) {
      mgAudit_('SCAN', group.manager, 'Already flagged / notified — skipping duplicate', 'INFO');
      return;
    }

    flagSheet.appendRow([
      new Date(), group.manager, group.reps.length, repNames, queue,
      dateStr, mgFriendlyTime_(startStr), mgFriendlyTime_(endStr), 'NO', 'PENDING'
    ]);
    SpreadsheetApp.flush();

    const slackMsg = '\u26a0\ufe0f *Unauthorized Group Meeting Detected*\n' +
      'Manager: *' + group.manager + '*\n' +
      'Date: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
      'Queue: ' + queue + '\n' +
      'Reps in meeting (' + group.reps.length + '): ' + repNames + '\n' +
      '_This meeting was not submitted through the meeting request workflow._';

    const userId  = mgSlackLookupUserId_(MG_WFM_ERROR_NOTIFY);
    var alertSent = false;
    if (userId) {
      mgSlackSendDm_(userId, slackMsg);
      alertSent = true;
    }

    const lastRow = flagSheet.getLastRow();
    flagSheet.getRange(lastRow, MG.FLAG_COLS.SLACK_ALERT_SENT).setValue(alertSent ? 'YES' : 'FAILED');
    SpreadsheetApp.flush();

    mgAudit_('SCAN', group.manager,
      'Flagged: ' + group.reps.length + ' reps | ' + dateStr + ' ' + startStr + '-' + endStr +
      ' | Slack alert: ' + (alertSent ? 'sent' : 'failed'), 'OK');
  });

  var leadPacing = null;
  if (mgConfigBool_(config, MG.CFG.LEAD_PACE_SCAN, true)) {
    leadPacing = mgLoadIntradayLeadPacing_(config);
  }
  mgScanStaffingRiskMeetings_(groups, approvedRequests, headers, config, leadPacing);
}

/**
 * Re-check net staffing + intraday lead pace for approved group meetings in the scan window.
 * Alerts WFM only when post-meeting net < buffer and/or Today leads exceed S&OP by threshold.
 */
function mgScanStaffingRiskMeetings_(groups, approvedRequests, headers, config, leadPacingByHour) {
  if (!mgConfigBool_(config, MG.CFG.STAFFING_RISK_SCAN, true)) {
    mgAudit_('STAFFING_RISK', '', 'STAFFING_RISK_SCAN_ENABLED is FALSE — skipping', 'INFO');
    return;
  }

  const minReps = mgConfigNum_(config, MG.CFG.SCAN_MIN_REPS, MG.SCAN_MIN_REPS);
  const minBuffer = mgGetStaffingMinBuffer_(config);
  const wfmSlackEnabled = mgConfigBool_(config, MG.CFG.STAFFING_RISK_WFM_SLACK, false);
  var siteId;
  try {
    siteId = mgResolveSiteId_(headers, MG.ASSEMBLED.SITE_NAME);
  } catch (err) {
    mgAudit_('STAFFING_RISK', '', 'Site resolve failed: ' + String(err), 'FAILED');
    return;
  }

  const riskSheet       = mgGetOrCreateStaffingRiskSheet_();
  const queueCache      = {};
  const leadThresholdPct = Number(config[MG.CFG.LEAD_PACE_RISK_PCT] || 10);
  var riskCount         = 0;

  Object.keys(groups).forEach(function(key) {
    const group = groups[key];
    if (group.reps.length < minReps) return;

    const dateStr  = Utilities.formatDate(group.startTime, MG.TZ, 'yyyy-MM-dd');
    const startStr = Utilities.formatDate(group.startTime, MG.TZ, 'HH:mm');
    const endStr   = Utilities.formatDate(group.endTime,   MG.TZ, 'HH:mm');

    const matchedReq = mgFindMatchingApprovedRequest_(approvedRequests, group.manager, dateStr, group.startTime, group.endTime);
    if (!matchedReq) return;

    if (mgAlreadyStaffingRiskFlagged_(riskSheet, group.manager, dateStr, startStr)) {
      mgAudit_('STAFFING_RISK', group.manager, 'Already flagged — skipping duplicate', 'INFO');
      return;
    }

    const queue = group.reps[0].queue || '';
    if (!queue) {
      mgAudit_('STAFFING_RISK', group.manager, 'No queue on roster for reps — skipping', 'WARN');
      return;
    }

    if (!queueCache[queue]) {
      queueCache[queue] = mgResolveQueueId_(headers, queue);
    }
    const queueId = queueCache[queue];
    if (!queueId) return;

    const netStaffing = mgGetNetStaffingForWindow_(headers, siteId, queueId, group.startTime, group.endTime);
    const postNet     = netStaffing - group.reps.length;
    const netRisk     = postNet < minBuffer;

    const leadWindow = leadPacingByHour
      ? mgGetLeadPaceForMeetingWindow_(leadPacingByHour, group.startTime, group.endTime)
      : { maxPctOverSop: 0, hourDetails: [] };
    const leadRisk = leadWindow.maxPctOverSop >= leadThresholdPct;

    if (!netRisk && !leadRisk) {
      mgAudit_('STAFFING_RISK', group.manager,
        'OK — net=' + netStaffing + ' post=' + postNet + ' | lead pace +' + leadWindow.maxPctOverSop + '% max', 'INFO');
      return;
    }

    const repNames = group.reps.map(function(r) { return r.name; }).join(', ');
    const title    = matchedReq.title || 'Team meeting';
    const whenLine = mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT';

    var riskReasons = [];
    if (netRisk) riskReasons.push('net staffing');
    if (leadRisk) riskReasons.push('lead pace');
    const riskReasonLabel = riskReasons.join(' + ');

    riskSheet.appendRow([
      new Date(),
      group.manager,
      title,
      group.reps.length,
      repNames,
      queue,
      dateStr,
      mgFriendlyTime_(startStr),
      mgFriendlyTime_(endStr),
      Math.round(netStaffing * 10) / 10,
      Math.round(postNet * 10) / 10,
      'N/A',
      'PENDING',
      riskReasonLabel,
      leadWindow.maxPctOverSop > 0 ? ('+' + leadWindow.maxPctOverSop + '%') : '—'
    ]);
    SpreadsheetApp.flush();

    var reasonLines = [];
    if (netRisk) {
      reasonLines.push('*Net staffing:* ' + Math.round(netStaffing * 10) / 10 + ' \u2192 post-meeting ' +
        Math.round(postNet * 10) / 10 + ' (buffer ' + minBuffer + ')');
    }
    if (leadRisk) {
      reasonLines.push('*Lead pace:* Today is up to *+' + leadWindow.maxPctOverSop + '%* vs S&OP during this window (threshold ' + leadThresholdPct + '%)');
      if (leadWindow.hourDetails.length) {
        reasonLines.push(leadWindow.hourDetails.join('\n'));
      }
    }

    const wfmMsg =
      '\u26a0\ufe0f *Approved meeting — reschedule recommended*\n' +
      reasonLines.join('\n') + '\n\n' +
      'Manager: *' + group.manager + '*\n' +
      'Meeting: _' + title + '_\n' +
      'When: ' + whenLine + '\n' +
      'Queue: ' + queue + ' | Reps: ' + group.reps.length + '\n' +
      'Reps: ' + repNames + '\n\n' +
      '_WFM only — ask the manager to cancel/reschedule or run async if needed._';

    var wfmSlack = 'NO';
    if (wfmSlackEnabled) {
      const wfmId = mgSlackLookupUserId_(MG_WFM_ERROR_NOTIFY);
      if (wfmId) {
        mgSlackSendDm_(wfmId, wfmMsg);
        wfmSlack = 'YES';
      } else {
        wfmSlack = 'FAILED';
      }
    } else {
      wfmSlack = 'SKIPPED';
    }

    const lastRow = riskSheet.getLastRow();
    riskSheet.getRange(lastRow, MG.RISK_COLS.WFM_SLACK).setValue(wfmSlack);
    SpreadsheetApp.flush();

    riskCount++;
    mgAudit_('STAFFING_RISK', group.manager,
      'Flagged ' + riskReasonLabel + ' | net=' + netStaffing + ' post=' + postNet +
      ' | lead=+' + leadWindow.maxPctOverSop + '% | WFM=' + wfmSlack, 'OK');
  });

  mgAudit_('STAFFING_RISK', '', 'Scan complete — ' + riskCount + ' staffing risk alert(s)', 'INFO');
}

/**
 * Live intraday leads workbook — col A hour, B Today, C S&OP (same as vCPU dashboard sheet).
 * @return {Object.<number, {today:number, sop:number, pctOverSop:number}>}
 */
function mgLoadIntradayLeadPacing_(config) {
  const ssId = mgConfigStr_(config, MG.CFG.INTRADAY_LEADS_SS, MG.INTRADAY_LEADS.DEFAULT_SPREADSHEET_ID);
  const tab  = mgConfigStr_(config, MG.CFG.INTRADAY_LEADS_TAB, MG.INTRADAY_LEADS.DEFAULT_TAB);
  if (!ssId) return {};

  try {
    const sheet = SpreadsheetApp.openById(ssId).getSheetByName(tab);
    if (!sheet) {
      mgAudit_('LEAD_PACE', tab, 'Tab not found on intraday leads workbook', 'WARN');
      return {};
    }
    const values = sheet.getDataRange().getValues();
    const byHour = {};
    for (var i = 1; i < values.length; i++) {
      const hour = mgParseIntradayHourCell_(values[i][0]);
      if (hour === null) continue;
      const today = mgNum_(values[i][1]);
      const sop   = mgNum_(values[i][2]);
      var pctOver = 0;
      if (sop > 0 && today > sop) {
        pctOver = Math.round((today - sop) / sop * 1000) / 10;
      }
      byHour[hour] = { today: today, sop: sop, pctOverSop: pctOver };
    }
    mgAudit_('LEAD_PACE', '', 'Loaded ' + Object.keys(byHour).length + ' hour row(s) from ' + tab, 'INFO');
    return byHour;
  } catch (err) {
    mgAudit_('LEAD_PACE', ssId, String(err && err.message ? err.message : err), 'WARN');
    return {};
  }
}

function mgParseIntradayHourCell_(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && isFinite(raw)) {
    const h = Math.floor(raw);
    return h >= 0 && h <= 23 ? h : null;
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  return h >= 0 && h <= 23 ? h : null;
}

/** Max Today-vs-S&OP % over clock hours touched by the meeting window (America/Chicago). */
function mgGetLeadPaceForMeetingWindow_(byHour, meetingStart, meetingEnd) {
  const hours = mgClockHoursInRange_(meetingStart, meetingEnd);
  var maxPct = 0;
  var details = [];
  hours.forEach(function(h) {
    const row = byHour[h];
    if (!row || row.pctOverSop <= 0) return;
    if (row.pctOverSop > maxPct) maxPct = row.pctOverSop;
    const label = mgFormatHourLabelCt_(h);
    details.push('\u2022 ' + label + ': ' + row.today + ' today vs ' + row.sop + ' S&OP (+' + row.pctOverSop + '%)');
  });
  return { maxPctOverSop: maxPct, hourDetails: details };
}

function mgClockHoursInRange_(start, end) {
  const tz = MG.TZ;
  const out = {};
  var t = start.getTime();
  const endMs = end.getTime();
  while (t < endMs) {
    out[parseInt(Utilities.formatDate(new Date(t), tz, 'H'), 10)] = true;
    t += 30 * 60 * 1000;
  }
  out[parseInt(Utilities.formatDate(end, tz, 'H'), 10)] = true;
  return Object.keys(out).map(function(k) { return parseInt(k, 10); });
}

function mgFormatHourLabelCt_(hour24) {
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const h12    = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return h12 + ':00 ' + suffix;
}

function mgConfigStr_(config, key, defaultVal) {
  var val = config[key];
  if (val === undefined || val === null || String(val).trim() === '') return defaultVal;
  return String(val).trim();
}

/** ISO weekday for America/Chicago: 1=Monday … 7=Sunday (Apps Script format u). */
function mgMeetingIsoWeekday_(meetingStart) {
  return parseInt(Utilities.formatDate(meetingStart, MG.TZ, 'u'), 10);
}

const MG_DOW_NAME_TO_ISO = {
  'mon': 1, 'monday': 1,
  'tue': 2, 'tues': 2, 'tuesday': 2,
  'wed': 3, 'wednesday': 3,
  'thu': 4, 'thur': 4, 'thurs': 4, 'thursday': 4,
  'fri': 5, 'friday': 5,
  'sat': 6, 'saturday': 6,
  'sun': 7, 'sunday': 7
};

function mgParseBlackoutDateSet_(raw) {
  var set = {};
  String(raw || '').split(/[,;\n]+/).forEach(function(tok) {
    var d = mgParseDateStr_(tok.trim());
    if (d) set[d] = true;
  });
  return set;
}

function mgParseBlackoutDowSet_(raw) {
  var set = {};
  String(raw || '').split(/[,;\n]+/).forEach(function(tok) {
    var k = String(tok || '').trim().toLowerCase();
    if (!k) return;
    if (MG_DOW_NAME_TO_ISO[k] !== undefined) {
      set[MG_DOW_NAME_TO_ISO[k]] = true;
      return;
    }
    var n = parseInt(k, 10);
    if (!isNaN(n) && n >= 0 && n <= 6) {
      set[n === 0 ? 7 : n] = true;
    }
  });
  return set;
}

function mgFormatIsoDowList_(isoSet) {
  var labels = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
  var keys = Object.keys(isoSet).map(function(k) { return parseInt(k, 10); }).sort();
  return keys.map(function(k) { return labels[k] || String(k); }).join(', ');
}

/**
 * @return {{kind: string, detail: string}|null} kind = blackout_date | blackout_dow
 */
function mgGetMeetingBlackoutHit_(dateStr, meetingStart, config) {
  var datesRaw = mgConfigStr_(config, MG.CFG.BLACKOUT_DATES, '');
  var dowRaw   = mgConfigStr_(config, MG.CFG.BLACKOUT_DOW, '');
  if (!datesRaw && !dowRaw) return null;

  var dateSet = mgParseBlackoutDateSet_(datesRaw);
  if (dateSet[dateStr]) {
    return { kind: 'blackout_date', detail: mgFriendlyDate_(dateStr) };
  }

  var dowSet = mgParseBlackoutDowSet_(dowRaw);
  var isoDow = mgMeetingIsoWeekday_(meetingStart);
  if (dowSet[isoDow]) {
    return { kind: 'blackout_dow', detail: mgFormatIsoDowList_(dowSet) };
  }
  return null;
}

function mgDenyMeetingBlackout_(sheet, rowNum, title, dateStr, startStr, endStr, submitterRaw, hit) {
  var reason;
  if (hit.kind === 'blackout_date') {
    reason = 'Blackout date (' + hit.detail + ')';
  } else {
    reason = 'Blackout day of week (' + hit.detail + ')';
  }
  var msg = mgSlackMeetingHeader_(MG_SLACK_LABEL.CANT_BOOK, title) +
    'Requested: ' + mgFriendlyDate_(dateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT\n' +
    'This date is blocked for live team meetings. Pick another day or contact WFM.';
  mgWriteResult_(sheet, rowNum, 'DENIED — blackout', reason);
  mgSlackDmSubmitter_(submitterRaw, msg);
  mgAudit_('BLACKOUT', 'Row ' + rowNum, reason, 'OK');
}

/** Append-only: ensure blackout Config rows exist (does not overwrite existing values). */
function mgEnsureConfigBlackoutRows_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MG.SHEETS.CONFIG);
  if (!sheet) return;
  var values = sheet.getDataRange().getValues();
  var existing = {};
  var i;
  for (i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) existing[key] = true;
  }
  var toAdd = [
    [MG.CFG.BLACKOUT_DATES, '',
     'Comma-separated dates (yyyy-MM-dd) that auto-deny all meeting requests, e.g. 2026-05-01, 2026-12-25'],
    [MG.CFG.BLACKOUT_DOW, 'sat, sun',
     'Comma-separated days of week that auto-deny (mon–sun). Example: sat, sun']
  ];
  toAdd.forEach(function(row) {
    if (!existing[row[0]]) {
      sheet.appendRow(row);
      existing[row[0]] = true;
    }
  });
}

/** Append-only: ensure meeting policy Config rows exist (does not overwrite existing values). */
function mgEnsureConfigMeetingPolicyRows_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MG.SHEETS.CONFIG);
  if (!sheet) return;
  var values = sheet.getDataRange().getValues();
  var existing = {};
  var i;
  for (i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) existing[key] = true;
  }
  var toAdd = [
    [MG.CFG.MIN_NET_BUFFER, -2,
     'Minimum post-meeting net staffing to approve (CT). -2 allows net down to -2 after the meeting.'],
    [MG.CFG.ALT_SEARCH_START_HOUR, 9,
     'Alternative/split recommendation window start hour (CT, 24h). Weekdays Mon–Fri only.'],
    [MG.CFG.ALT_SEARCH_END_HOUR, 17,
     'Alternative/split recommendation window end hour (CT, 24h). Meetings must end by this time.']
  ];
  toAdd.forEach(function(row) {
    if (!existing[row[0]]) {
      sheet.appendRow(row);
      existing[row[0]] = true;
    }
  });
}

/** Append-only: ensure unauthorized-scan Config rows exist (does not overwrite existing values). */
function mgEnsureConfigScanRows_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MG.SHEETS.CONFIG);
  if (!sheet) return;
  var values = sheet.getDataRange().getValues();
  var existing = {};
  var i;
  for (i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) existing[key] = true;
  }
  var toAdd = [
    [MG.CFG.SCAN_MIN_REPS, 4,
     'Unauthorized meeting scan: minimum Consumer Sales reps in the block (Retention / unmapped excluded).'],
    [MG.CFG.SCAN_MIN_DURATION, 30,
     'Unauthorized meeting scan: minimum meeting length in minutes.'],
    [MG.CFG.STAFFING_RISK_WFM_SLACK, 'FALSE',
     'If TRUE, DM WFM when an approved (tool-submitted) meeting fails staffing-risk re-check. Default FALSE — WFM Slack is for Flagged Meetings (unauthorized) only.']
  ];
  toAdd.forEach(function(row) {
    if (!existing[row[0]]) {
      sheet.appendRow(row);
      existing[row[0]] = true;
    }
  });
}

function mgSlackDmByManagerName_(managerName, message) {
  const email = mgResolveManagerEmail_(managerName);
  if (!email) {
    mgAudit_('SLACK', 'manager', 'No email for manager: ' + managerName, 'WARN');
    return false;
  }
  if (mgIsTestMode_()) {
    mgSlackDmSubmitter_(email, message);
    return true;
  }
  const userId = mgSlackLookupUserId_(email);
  if (!userId) return false;
  mgSlackSendDm_(userId, message);
  return true;
}

function mgIsL7Manager_(roster, managerName) {
  return roster.some(function(r) {
    return r.senior && mgManagerKeysMatch_(managerName, r.senior);
  });
}

function mgLoadConfig_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MG.SHEETS.CONFIG);
  if (!sheet) return {};
  const values = sheet.getDataRange().getValues();
  const out    = {};
  values.slice(1).forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (key) out[key] = row[1];
  });
  return out;
}

function mgConfigBool_(config, key, defaultVal) {
  var val = config[key];
  if (val === undefined || val === null || String(val).trim() === '') return defaultVal;
  return String(val).trim().toUpperCase() === 'TRUE';
}

function mgConfigNum_(config, key, defaultVal) {
  var val = config[key];
  if (val === undefined || val === null || String(val).trim() === '') return defaultVal;
  var n = Number(val);
  return isFinite(n) ? n : defaultVal;
}

function mgGetStaffingMinBuffer_(config) {
  config = config || mgLoadConfig_();
  return mgConfigNum_(config, MG.CFG.MIN_NET_BUFFER, MG.MIN_BUFFER);
}

function mgGetAltSearchBand_(config) {
  config = config || mgLoadConfig_();
  return {
    startHour: mgConfigNum_(config, MG.CFG.ALT_SEARCH_START_HOUR, MG.ALT_SEARCH_START_HOUR),
    endHour:   mgConfigNum_(config, MG.CFG.ALT_SEARCH_END_HOUR, MG.ALT_SEARCH_END_HOUR)
  };
}

function mgLoadApprovedRequests_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MG.SHEETS.REQUESTS);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const roster = mgLoadRoster_();
  const values = sheet.getDataRange().getValues();
  const out    = [];
  values.slice(1).forEach(function(row) {
    const decision = String(row[MG.COLS.DECISION - 1] || '').trim().toUpperCase();
    if (decision.indexOf('APPROVED') === -1) return;
    const manager  = mgResolveManagerName_(String(row[MG.COLS.MANAGER - 1] || ''), roster);
    const dateRaw  = row[MG.COLS.DATE - 1];
    const startRaw = row[MG.COLS.START - 1];
    const endRaw   = row[MG.COLS.END - 1];
    const dateStr  = mgParseDateStr_(dateRaw);
    const startStr = mgParseTimeInt_(startRaw);
    const endStr   = mgParseTimeInt_(endRaw);
    if (!dateStr || !startStr || !endStr) return;
    out.push({
      manager:   mgNormManagerKey_(manager),
      title:     String(row[MG.COLS.TITLE - 1] || '').trim(),
      dateStr:   dateStr,
      startTime: mgBuildDateTime_(dateStr, startStr),
      endTime:   mgBuildDateTime_(dateStr, endStr)
    });
  });
  return out;
}

function mgFindMatchingApprovedRequest_(approvedRequests, manager, dateStr, startTime, endTime) {
  const managerNorm = mgNormManagerKey_(manager);
  const toleranceMs = 30 * 60 * 1000;
  for (var i = 0; i < approvedRequests.length; i++) {
    const req = approvedRequests[i];
    if (req.manager !== managerNorm) continue;
    if (req.dateStr !== dateStr) continue;
    if (!req.startTime || !req.endTime) continue;
    if (Math.abs(req.startTime.getTime() - startTime.getTime()) <= toleranceMs &&
        Math.abs(req.endTime.getTime()   - endTime.getTime())   <= toleranceMs) {
      return req;
    }
  }
  return null;
}

function mgNormalizeScanStartKey_(startStr) {
  var raw = String(startStr || '').trim();
  if (!raw) return '';
  var d = mgBuildDateTime_('2000-01-01', raw);
  if (!d && /\d:\d{2}\s*[AP]M/i.test(raw)) {
    var m = raw.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    if (m) {
      var h = parseInt(m[1], 10);
      var ap = m[3].toUpperCase();
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      d = mgBuildDateTime_('2000-01-01', mgPad2_(h) + ':' + m[2]);
    }
  }
  return d ? Utilities.formatDate(d, MG.TZ, 'HH:mm') : raw;
}

function mgIsConsumerSalesScanQueue_(queueName) {
  var target = mgNormalizeToken_(queueName);
  if (!target) return false;
  for (var i = 0; i < MG_CONSUMER_SALES_QUEUES.length; i++) {
    if (mgNormalizeToken_(MG_CONSUMER_SALES_QUEUES[i]) === target) return true;
  }
  return false;
}

/** Unauthorized scan: duration, rep count, all-reps Consumer Sales queue (excludes Retention / unmapped). */
function mgScanGroupQualifies_(group, config) {
  config = config || mgLoadConfig_();
  var minReps = mgConfigNum_(config, MG.CFG.SCAN_MIN_REPS, MG.SCAN_MIN_REPS);
  var minDur  = mgConfigNum_(config, MG.CFG.SCAN_MIN_DURATION, MG.SCAN_MIN_DURATION_MIN);
  if (!group || !group.reps || !group.reps.length) {
    return { ok: false, reason: 'empty group' };
  }
  if (!group.startTime || !group.endTime) {
    return { ok: false, reason: 'missing times' };
  }
  var durationMin = (group.endTime.getTime() - group.startTime.getTime()) / 60000;
  if (durationMin < minDur) {
    return { ok: false, reason: 'under ' + minDur + ' min (' + Math.round(durationMin) + ' min)' };
  }
  var csReps = group.reps.filter(function(r) { return mgIsConsumerSalesScanQueue_(r.queue); });
  if (csReps.length < minReps) {
    return { ok: false, reason: 'fewer than ' + minReps + ' Consumer Sales reps (' + csReps.length + ')' };
  }
  if (csReps.length < group.reps.length) {
    return { ok: false, reason: 'non-Consumer Sales rep in group (Retention or unmapped)' };
  }
  return { ok: true, queue: csReps[0].queue, csReps: csReps };
}

function mgMatchesApprovedRequest_(approvedRequests, manager, dateStr, startTime, endTime) {
  return !!mgFindMatchingApprovedRequest_(approvedRequests, manager, dateStr, startTime, endTime);
}

function mgAlreadyFlagged_(sheet, manager, dateStr, startStr) {
  if (sheet.getLastRow() <= 1) return false;
  const values = sheet.getDataRange().getValues();
  const mgrKey = String(manager || '').trim().toLowerCase();
  const startKey = mgNormalizeScanStartKey_(startStr);
  return values.slice(1).some(function(row) {
    var rowMgr = String(row[MG.FLAG_COLS.MANAGER - 1] || '').trim().toLowerCase();
    var rowDate = String(row[MG.FLAG_COLS.MEETING_DATE - 1] || '').trim();
    var rowStart = mgNormalizeScanStartKey_(String(row[MG.FLAG_COLS.START_TIME - 1] || ''));
    if (rowMgr !== mgrKey || rowDate !== dateStr || rowStart !== startKey) return false;
    return true;
  });
}

function mgGetOrCreateFlagSheet_() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MG.SHEETS.FLAGGED_MEETINGS);
  if (!sheet) {
    sheet = ss.insertSheet(MG.SHEETS.FLAGGED_MEETINGS);
    const headers = [
      'Detected At', 'Manager', 'Team Size Impacted', 'Rep Names',
      'Queue', 'Meeting Date', 'Start Time', 'End Time',
      'Matched to Request?', 'Slack Alert Sent'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1F4E78')
      .setFontColor('#ffffff');
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function mgGetOrCreateStaffingRiskSheet_() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MG.SHEETS.STAFFING_RISK);
  if (!sheet) {
    sheet = ss.insertSheet(MG.SHEETS.STAFFING_RISK);
    const headers = [
      'Detected At', 'Manager', 'Title', 'Rep Count', 'Rep Names',
      'Queue', 'Meeting Date', 'Start Time', 'End Time',
      'Net Staffing', 'Post-Meeting Net', 'Manager Notified', 'WFM Slack',
      'Risk Reason', 'Max Lead % vs S&OP'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1F4E78')
      .setFontColor('#ffffff');
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function mgAlreadyStaffingRiskFlagged_(sheet, manager, dateStr, startStr) {
  if (sheet.getLastRow() <= 1) return false;
  const values = sheet.getDataRange().getValues();
  const friendlyStart = mgFriendlyTime_(startStr);
  return values.slice(1).some(function(row) {
    return String(row[MG.RISK_COLS.MANAGER - 1]      || '').trim().toLowerCase() === manager.toLowerCase().trim() &&
           String(row[MG.RISK_COLS.MEETING_DATE - 1] || '').trim() === dateStr &&
           String(row[MG.RISK_COLS.START_TIME - 1]   || '').trim() === friendlyStart;
  });
}

/**
 * Leadership tab: Name | Role | Implied sales group (formula).
 * Coaches/leads on this list auto-scope capacity to their segment when column G is blank.
 */
function mgSetupLeadershipTab_(ss) {
  var sheet = ss.getSheetByName(MG.SHEETS.LEADERSHIP);
  if (!sheet) sheet = ss.insertSheet(MG.SHEETS.LEADERSHIP);
  var h1 = String(sheet.getRange(1, 1).getValue() || '').trim();
  if (!h1) {
    sheet.getRange(1, 1, 1, 3).setValues([['Name', 'Role', 'Implied sales group']]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 3)
      .setFontWeight('bold')
      .setBackground('#1F4E78')
      .setFontColor('#ffffff');
  }
  var c2 = String(sheet.getRange(2, 3).getValue() || '').trim();
  if (!c2 || c2.charAt(0) === '=') {
    sheet.getRange(2, 3).setFormula(
      '=ARRAYFORMULA(IF(A2:A="","",' +
      'IF(REGEXMATCH(LOWER(B2:B),"^(coach|lead|manager|senior|srd)$"),"",' +
      'IF(REGEXMATCH(LOWER(B2:B),"coach pc"),"prof certs",' +
      'IF(REGEXMATCH(LOWER(B2:B),"coach eld"),"elementary",' +
      'IF(REGEXMATCH(LOWER(B2:B),"coach hs|coach interim hs|coach canada hs|sales coach hs|hs manager|manager hs|high school manager"),"high school",' +
      'IF(REGEXMATCH(LOWER(B2:B),"lead college|coach college|college manager|manager college"),"college",' +
      'IF(REGEXMATCH(LOWER(B2:B),"^coach al|al manager|adult learning manager"),"adult learning",' +
      'IF(REGEXMATCH(LOWER(B2:B),"coach pc|pc manager|prof certs manager"),"prof certs",' +
      'IF(REGEXMATCH(LOWER(B2:B),"coach eld|eld manager|elementary manager"),"elementary","")))))))))'
    );
  }
  sheet.getRange(3, 3).setNote(
    'Auto-filled from Role. Script + column G use this for coach/lead submitters. Plain Coach/Lead/Manager = no segment.'
  );
}

function mgSetupChangelog_(ss) {
  var sheet = ss.getSheetByName(MG.SHEETS.CHANGELOG);
  if (!sheet) sheet = ss.insertSheet(MG.SHEETS.CHANGELOG);
  const headers = ['Version', 'Date', 'Author', 'Change Summary', 'Impact', 'Status'];
  const history = [
    ['v1.8.9', '2026-07-14', 'Bobby Sorrell',
     'FIX Assembled queue map for New Sales / ELD managers (e.g. Kimberly Murdock row 111): normalize work-group keys; expand aliases (K6, E&LD, singular Learning Difference, People-tab labels, ISC); majority-vote queue from full Import Roster team when filtered attendees lack work groups; menu Reprocess Selected Row + mgReprocessRequestRow(n).',
     'Team meetings no longer ERROR with "Could not map work group to Assembled queue" when Import Roster work groups are blank on a subset of listed attendees but present on the manager\'s full team.',
     'Released'],
    ['v1.8.8', '2026-07-08', 'Bobby Sorrell',
     'Calendar invites: create event inviting manager + consultants; Shilo Gator/Gater/Wheeler all invited as guests; fall back to script primary calendar when manager share is missing; calendar no longer skipped solely by TEST_MODE; fixed Calendar API arg order on cancel/extend/add-reps.',
     'Managers (incl. renamed mailboxes) and reps actually receive Google Calendar invites even without calendar sharing.',
     'Released'],
    ['v1.8.7', '2026-06-30', 'Bobby Sorrell',
     'Unauthorized meeting scan: WFM Slack only for Flagged Meetings (not tool-submitted); min 4 CS reps + 30 min; five Consumer Sales queues only (no Retention); dedupe by manager/date/start. STAFFING_RISK_WFM_SLACK_ENABLED default FALSE.',
     'Stops repeat Slack on every scan run; retention managers no longer ping WFM for ad-hoc meetings.',
     'Released'],
    ['v1.8.6', '2026-06-30', 'Bobby Sorrell',
     'Meeting policy: alternative/split recommendations limited to 9 AM–5 PM CT Mon–Fri; min post-meeting net buffer -2. New Config keys MIN_NET_STAFFING_BUFFER, ALT_SEARCH_START_HOUR, ALT_SEARCH_END_HOUR.',
     'More afternoon slots qualify for approval; alt windows no longer suggest 8 AM or after 5 PM.',
     'Released'],
    ['v1.8.5', '2026-06-30', 'Bobby Sorrell',
     'FIX split sessions: Session 2 search excludes Session 1\'s time window so both groups are not recommended at the same slot.',
     'Split recommendations now assign distinct meeting times (e.g. 8 AM + 10 AM instead of 8 AM + 8 AM).',
     'Released'],
    ['v1.8.4', '2026-06-30', 'Bobby Sorrell',
     'ERROR Slack ping: any Requests ERROR or Assembled commit failure decision DMs robert.sorrell with row context; script exceptions and recurring weekly ERROR outcomes ping too.',
     'WFM gets immediate Slack on failures without polling the sheet.',
     'Released'],
    ['v1.8.3', '2026-06-30', 'Bobby Sorrell',
     'FIX alternative + split window search: scan full Consumer Sales day (8 AM–6 PM CT) instead of requested time ±2 hours; split uses half-team groups with per-slot capacity check (not capped by net at requested afternoon time).',
     'Denied requests now surface morning surplus slots (e.g. Wed +5 net) and viable split sessions on different days.',
     'Released'],
    ['v1.8.2', '2026-06-30', 'Bobby Sorrell',
     'FIX queue resolution for segment-manager teams (e.g. HS Manager): infer Assembled queue from Leadership role when Import Roster work group is blank or unmapped; fuzzy work-group→queue keyword matching.',
     'Jamie Forrest–style requests with named attendees no longer fail with "Could not map work group to Assembled queue" when reps list the segment manager in column F.',
     'Released'],
    ['v1.8.1', '2026-06-30', 'Bobby Sorrell',
     'FIX segment managers on Leadership (HS Manager, etc.): role→sales group mapping; coach context reads manager name; team lookup uses fuzzy name match + Import Roster column F (Senior) when column E is empty.',
     'Jamie Forrest–style HS managers can book team meetings when reps list them as Senior on Import Roster.',
     'Released'],
    ['v1.8.0', '2026-06-30', 'Bobby Sorrell',
     'Recurring meetings: BOOKED Slack Make this recurring link; Friday auto-book for following week (same DOW/time); CAN\'T BOOK RECURRING reschedule ping with 3 Book it alts; Scheduled Recurring Meetings + Recurring Weekly Log tabs; stop recurring + cancel on recurring BOOKED pings; Assembled + Google Calendar on auto-book.',
     'Managers can opt into weekly auto-booking from any approved meeting; WFM tracks scheduled / alt-booked / no-alt weeks per series.',
     'Released'],
    ['v1.7.26', '2026-06-10', 'Bobby Sorrell',
     'BOOKED Slack Add reps link (?addreps=token): web form for up to 2 consultant names; adds Assembled Meeting blocks + Google Calendar guests (Meet link).',
     'Managers can pull extra reps into a live booked meeting without re-submitting.',
     'Released'],
    ['v1.7.25', '2026-06-10', 'Bobby Sorrell',
     'BOOKED Slack DMs include +15 min link (web app ?extend=token). Extends Assembled Meeting blocks and manager Google Calendar invite; repeatable until cancel/expire.',
     'Managers can extend live meetings without re-submitting; reps get updated calendar invites.',
     'Released'],
    ['v1.7.24', '2026-06-10', 'Bobby Sorrell',
     'Google Calendar invites + Meet link lookup use Config Manager Slack Aliases for manager Google email (same as v1.7.23 Slack). Legacy MEET_LINK_|shilo.wheeler rows copy forward on sync.',
     'Renamed managers (e.g. Shilo Gater) see calendar events on their current account; Meet links resolve after alias change.',
     'Released'],
    ['v1.7.23', '2026-06-10', 'Bobby Sorrell',
     'Slack DM lookup uses Config Manager Slack Aliases + fallback emails when roster name/email differs from Slack (e.g. Shilo Gater vs Wheeler).',
     'Meeting BOOKED/CAN\'T BOOK pings reach managers after legal-name or Slack handle changes.',
     'Released'],
    ['v1.7.22', '2026-06-10', 'Bobby Sorrell',
     'Cancel meeting: after removing Assembled Meeting blocks, write Phone blocks for the same window so reps are not left with open schedule time.',
     'Cancelled meetings put reps back on phones in Assembled instead of leaving a gap.',
     'Released'],
    ['v1.7.21', '2026-06-10', 'Bobby Sorrell',
     'FIX manual override ping skipped on Run Now: dedicated getLastRow scan of col I before main loop; fresh getRange row reads; regex decision match; month-name col A parse; Run Now alert shows ping count; L=Y written before Slack send.',
     'Row 66 Emily Lopez manual override pings reliably.',
     'Released'],
    ['v1.7.20', '2026-06-10', 'Bobby Sorrell',
     'FIX manual override ping: Decision already "APPROVED — manual override" sends BOOKED Slack + column L=Y without Assembled commit or scheduled-attendee check. Fresh col A read + ordinal date parse (e.g. June 10th, 2026). Split from legacy APPROVED+Recommendation commit path.',
     'Row 66-style WFM overrides ping immediately on Run Now.',
     'Released'],
    ['v1.7.19', '2026-06-10', 'Bobby Sorrell',
     'WFM sets Decision to "APPROVED — manual override" on Requests (col I): Run Now sends BOOKED Slack DM like bot approval; column L (Manual Override Sent) = Y when processed. Applies only to requests timestamped on/after 2026-06-09 (col A). Legacy APPROVED + Recommendation path unchanged.',
     'Manual overrides get a one-time manager ping; L prevents duplicate DMs on re-run.',
     'Released'],
    ['v1.7.18', '2026-05-26', 'Bobby Sorrell',
     'Pending manager Matt McCarthy: @Matt.Mccarthy / matt.mccarthy@varsitytutors.com aliases; manual comma-separated attendees match full Import Roster until column E team exists; Meet link auto-setup.',
     'New managers can book named reps before their roster row is wired.',
     'Released'],
    ['v1.7.17', '2026-05-20', 'Bobby Sorrell',
     'Config MEETING_BLACKOUT_DATES (specific yyyy-MM-dd) and MEETING_BLACKOUT_DAYS_OF_WEEK (sat, sun, etc.) auto-deny before capacity. Book it respects blackouts. Rows append on Run Now if missing.',
     'Company holidays and weekends blocked without manual WFM denials.',
     'Released'],
    ['v1.7.16', '2026-05-20', 'Bobby Sorrell',
     'BOOKED Slack DMs include Cancel meeting link (same web app as Book it, ?cancel=token). Removes Assembled Meeting blocks + manager calendar event; updates Requests to CANCELLED.',
     'Managers can undo a booked meeting from Slack without WFM.',
     'Released'],
    ['v1.7.15', '2026-05-20', 'Bobby Sorrell',
     'Super submitter robert.sorrell: any request auto-approves — audience all (full Import Roster), group aliases, or names; skips capacity/notice; commits all scheduled matches even in TEST_MODE.',
     'Admin can book company-wide or targeted meetings without denial flow.',
     'Released'],
    ['v1.7.14', '2026-05-20', 'Bobby Sorrell',
     'Leadership tab: coach/lead submitters auto-scope to sales group (Coach PC→prof certs, Coach HS/Interim/Canada→high school, Coach ELD→elementary, Lead/Coach college→college, Coach AL→adult learning). Column C formula + mgCoachLeadGroupContext_.',
     'Coaches booking for their segment use manager + submitter; capacity checks correct queue subset.',
     'Released'],
    ['v1.7.13', '2026-05-20', 'Bobby Sorrell',
     'Manual attendee list (column G) matches only that manager\'s Import Roster team — not the whole company roster. Clearer error when training/new reps are missing from manager\'s team.',
     'Training coordinators can submit under John Riordan and name new reps without pulling in reps from other managers.',
     'Released'],
    ['v1.7.12', '2026-05-20', 'Bobby Sorrell',
     'John Riordan vs Johnpaul Riordan: MG_MANAGER_ALIASES + mgCanonicalizePersonKey_ (riordon→riordan, john paul→johnpaul). john in FIRST_ONLY_BLOCK. Attendee + manager paths.',
     'Slack/form typos and @john.riordan vs @johnpaul.riordan resolve to the right manager, team, and Meet link.',
     'Released'],
    ['v1.7.11', '2026-05-20', 'Bobby Sorrell',
     'FIX duplicate Slack DMs: ScriptLock on processMeetingRequests; per-row PROCESSING claim before Assembled/Slack; fresh Decision read each loop (not stale getValues snapshot).',
     'Run Now + 5-min trigger (or double Run Now) no longer sends two identical CAN\'T BOOK messages.',
     'Released'],
    ['v1.7.10', '2026-05-20', 'Bobby Sorrell',
     'FIX mgResolveManagerName_: Shilo gater + gator aliases; if exactly one roster manager shares the first name (non-Emily), use them even when the submitted last name differs (e.g. @shilo.gater → Shilo Wheeler team).',
     'Slack handle gater/gator matches Wheeler roster team.',
     'Released'],
    ['v1.7.9', '2026-05-20', 'Bobby Sorrell',
     'mgResolveManagerName_: aliases (Shilo gator → Shilo Wheeler), first-name match to roster managers except Emily (requires last name/initial). Used in Requests, Book it, Pitstop evaluate, approved-request scan matching.',
     'Form nicknames and first names resolve to the right team without manual roster edits.',
     'Released'],
    ['v1.7.8', '2026-05-20', 'Bobby Sorrell',
     'FIX processMeetingRequests: mgIsBlankRequestRow_ skips padded empty rows on Requests so Run Now no longer writes ERROR on rows with no manager/title/date.',
     'Stops audit noise and ERROR cells on rows 20+ when sheet data range extends past real requests.',
     'Released'],
    ['v1.7.7', '2026-05-19', 'Bobby Sorrell',
     'Staffing-risk scan reads Intraday Leads sheet (B Today vs C S&OP by hour). Flags WFM if meeting-hour lead pace exceeds LEAD_PACE_RISK_PCT and/or net post-meeting < buffer. Config: INTRADAY_LEADS_*, LEAD_PACE_*.',
     'Reschedule ping when floor is tight from staffing or hot lead volume; WFM-only.',
     'Released'],
    ['v1.7.6', '2026-05-19', 'Bobby Sorrell',
     'Staffing-risk scan: WFM-only Slack (no manager DM). Message recommends reschedule/cancel; Staffing Risk tab Manager Notified = N/A.',
     'WFM handles manager outreach when floor tightens after approval.',
     'Released'],
    ['v1.7.5', '2026-05-19', 'Bobby Sorrell',
     'Meeting scan: mgScanStaffingRiskMeetings_ re-checks net staffing on approved group meetings (3+ reps, matched Requests row). If post-meeting net < MIN_BUFFER, logs Staffing Risk Meetings tab + WFM DM. STAFFING_RISK_SCAN_ENABLED in Config.',
     'WFM visibility when floor tightens after approval; no auto-cancel.',
     'Released'],
    ['v1.7.4', '2026-05-19', 'Bobby Sorrell',
     'Slack denial copy uses manual attendee count vs full team (column G tip on async denials). Approval DMs include Google Calendar invite line with rep names when calendar create succeeds.',
     'Managers understand why workshops were denied; approvals confirm calendar invites.',
     'Released'],
    ['v1.7.3', '2026-05-19', 'Bobby Sorrell',
     'Each processMeetingRequests run calls mgEnsureNewManagerMeetLinks_: scans Import Roster for managers missing a MEET_LINK_|email Config row and appendRow only (never edits/deletes existing Config). Menu Setup Meet Links still backfills empty/broken rows.',
     'New managers get Meet links automatically without manual setup.',
     'Released'],
    ['v1.7.2', '2026-05-19', 'Bobby Sorrell',
     'Manual override: set Decision to APPROVED (keep Recommendation) after a denial, then Run Now — commits to Assembled + approval DM without capacity check; writes APPROVED — manual override. Attendee matching: "Alexis I" / "First L." resolves via last initial on manager team first.',
     'WFM can force-approve denied rows; shorthand rep names in column G work.',
     'Released'],
    ['v1.7.1', '2026-05-18', 'Bobby Sorrell',
     'FIX mgSlackLookupUserId_: submitter display names (e.g. "Emily Krenzke") now use mgManagerNameToEmail_ instead of appending @varsitytutors.com to the raw string (which produced invalid emails like "Emily Krenzke@varsitytutors.com" and users_not_found).',
     'Managers who submit with a full name in the Submitter column receive denial/approval DMs.',
     'Released'],
    ['v1.7.0', '2026-05-15', 'Bobby Sorrell',
     'Google Calendar: after successful Assembled Meeting commits, mgMaybeCreateManagerCalendarInvite_ creates an event on the manager calendar (Calendar.Events.insert with calendarId = manager email) and invites reps who succeeded as guests (sendUpdates=all). Centralized call from mgCommitMeetingToAssembled_. Config GOOGLE_CALENDAR_INVITES_ENABLED (default TRUE). Skipped in TEST_MODE. Requires managers share calendar with script runner.',
     'Managers get a native Calendar event; reps receive Google invites with Meet link in description.',
     'Released'],
    ['v1.6.2', '2026-05-15', 'Bobby Sorrell',
     'FIX mgCreateBookingToken_: Sheet.getRange(row,col,numRows,numCols) was called with (lr,8,lr,10), so numRows=lr (e.g. 5) instead of 1 — setValues threw row count mismatch. Now getRange(lr, DATE_STR, 1, nCols).',
     'Denials with Book it links no longer error when writing tokens.',
     'Released'],
    ['v1.6.1', '2026-05-15', 'Bobby Sorrell',
     'FIX Book it: Booking Tokens date/time columns were auto-converted to Date by Sheets; String()+parseDate threw Invalid argument. mgExecuteBookItToken_ now uses mgParseDateStr_ + mgParseTimeInt_. mgParseTimeInt_ accepts Date (time-only cells). New tokens rewrite H–J as plain text (@ format).',
     'Book it links work for existing and new token rows.',
     'Released'],
    ['v1.6.0', '2026-05-15', 'Bobby Sorrell',
     'Book it flow: Booking Tokens tab; Slack hyperlinks on denied alternatives + split sessions; web app doGet(token) commits Meeting activities, appends Requests, DMs submitter. Script Property MG_WEB_APP_URL. Tokens expire after 7 days; capacity re-checked on click; LockService prevents double-book.',
     'Managers one-click book suggested slots without re-submitting the workflow.',
     'Released'],
    ['v1.5.1', '2026-05-15', 'Bobby Sorrell',
     'Group alias support in optional attendees field (col G).',
     'Org-wide group expansion + mixed tokens.',
     'Released'],
    ['v1.5.0', '2026-05-15', 'Bobby Sorrell',
     'Google Meet link support via Calendar API; Config tab MEET_LINK_|email.',
     'Meet links in Assembled descriptions + approval DMs.',
     'Released'],
    ['v1.4.0', '2026-05-14', 'Bobby Sorrell',
     'Optional manual attendees; WFM auto-approve; columns A–J.',
     'Subset teams + WFM fast path.',
     'Released'],
    ['v1.3.0', '2026-05-01', 'Bobby Sorrell',
     'Threshold Config rows (duration, attendees, notice, L7).',
     'Kevin threshold suggestions.',
     'Released'],
    ['v1.2.2', '2026-05-01', 'Bobby Sorrell',
     'Changelog tab; Flagged Meetings upfront.',
     'Audit trail in-sheet.',
     'Released'],
    ['v1.2.1', '2026-05-01', 'Bobby Sorrell',
     'M-F filter on alternatives + scan.',
     'No weekend noise.',
     'Released'],
    ['v1.2.0', '2026-05-01', 'Bobby Sorrell',
     'Unauthorized meeting scanner.',
     'Catches off-workflow Meeting blocks.',
     'Released'],
    ['v1.1.5', '2026-05-01', 'Bobby Sorrell',
     'Meeting title in Assembled description.',
     'Clarity on rep calendars.',
     'Released'],
    ['v1.1.4', '2026-05-01', 'Bobby Sorrell',
     'Async recommendation when split fails.',
     'Constructive fallback.',
     'Released'],
    ['v1.1.3', '2026-05-01', 'Bobby Sorrell',
     'Split size from net staffing.',
     'Viable split sizes.',
     'Released'],
    ['v1.1.2', '2026-05-01', 'Bobby Sorrell',
     'Alternatives ±2hr band.',
     'No 2AM suggestions.',
     'Released'],
    ['v1.1.1', '2026-05-01', 'Bobby Sorrell',
     'FIX: 1–6 PM assumption; zero attendees FLAGGED.',
     'Parsing + safety.',
     'Released'],
    ['v1.1.0', '2026-05-01', 'Bobby Sorrell',
     'Commit approved meetings to Assembled.',
     'Closed loop scheduling.',
     'Released'],
    ['v1.0.0', '2026-05-01', 'Bobby Sorrell',
     'Initial Meeting Governor.',
     'Automated gate.',
     'Released']
  ];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(2, 1, history.length, headers.length).setValues(history);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#1F4E78')
    .setFontColor('#ffffff');
  sheet.autoResizeColumns(1, headers.length);
}

function mgAudit_(event, ref, details, result) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MG.SHEETS.AUDIT);
  if (!sheet) return;
  sheet.appendRow([new Date(), event, ref, details, result]);
}

function mgNormWorkGroupKey_(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mgWorkGroupToQueue_(workGroup) {
  var key = mgNormWorkGroupKey_(workGroup);
  if (!key) return null;
  if (MG.WORK_GROUP_TO_QUEUE[key]) return MG.WORK_GROUP_TO_QUEUE[key];
  // Exact map also keyed with hyphens (legacy) before full normalize.
  var hyphenKey = String(workGroup || '').toLowerCase().trim();
  if (MG.WORK_GROUP_TO_QUEUE[hyphenKey]) return MG.WORK_GROUP_TO_QUEUE[hyphenKey];
  if (/high\s*school|\bhs\b|k\s*12|k12|stem high|test prep high/.test(key)) {
    return 'High School_CC90_New';
  }
  if (/college|graduate|\bgrad\b|stem college/.test(key)) {
    return 'College and Grad TP_CC90_New';
  }
  if (/adult|languages test|core test/.test(key)) {
    return 'Adult Learner_CC90_New';
  }
  if (/prof|cert|\bpc\b/.test(key)) {
    return 'Prof Certs_CC90_New';
  }
  if (
    /elementary|learning diff|k\s*6|\bk6\b|\beld\b|e\s*&\s*ld|\be\s*and\s*ld\b/.test(key)
  ) {
    return 'Elementary and LD_CC90_New';
  }
  if (/\bisc\b|initial support/.test(key)) {
    return 'ISC_New';
  }
  return null;
}

/** Majority Assembled queue across roster rows' work groups / queue fields. */
function mgMajorityQueueFromPool_(pool) {
  var counts = {};
  var i;
  for (i = 0; i < (pool || []).length; i++) {
    var q = pool[i].queue || mgWorkGroupToQueue_(pool[i].workGroup);
    if (!q) continue;
    counts[q] = (counts[q] || 0) + 1;
  }
  var best = null;
  var bestN = 0;
  for (var k in counts) {
    if (counts[k] > bestN) {
      bestN = counts[k];
      best = k;
    }
  }
  return best;
}

/** Default Assembled queue for a Leadership / group alias (hs, college, …). */
function mgGroupAliasToQueue_(groupAlias) {
  var raw = String(groupAlias || '').toLowerCase().trim();
  if (!raw) return null;
  var norm = MG_GROUP_ALIASES[raw] || raw;
  return MG_GROUP_ALIAS_TO_QUEUE[norm] || null;
}

/**
 * Resolve Consumer Sales Assembled queue for a meeting team.
 * Order: rep queue fields → fuzzy work group → majority of filtered team →
 * full manager roster team majority → Leadership role on manager → submitter.
 */
function mgResolveTeamQueue_(team, managerName, submitterRaw, roster) {
  var pool = team || [];
  var i;
  for (i = 0; i < pool.length; i++) {
    if (pool[i].queue) return pool[i].queue;
  }
  for (i = 0; i < pool.length; i++) {
    var fromWg = mgWorkGroupToQueue_(pool[i].workGroup);
    if (fromWg) return fromWg;
  }
  var majority = mgMajorityQueueFromPool_(pool);
  if (majority) {
    mgAudit_('QUEUE_INFER', managerName || '',
      'Inferred queue by majority work group on attendee pool → ' + majority, 'INFO');
    return majority;
  }
  if (managerName && roster && roster.length) {
    var fullTeam = mgGetTeamForManager_(roster, managerName);
    var fullMaj = mgMajorityQueueFromPool_(fullTeam);
    if (fullMaj) {
      mgAudit_('QUEUE_INFER', managerName,
        'Inferred queue from full Import Roster team (' + fullTeam.length +
        ' rep(s)) → ' + fullMaj, 'INFO');
      return fullMaj;
    }
    for (i = 0; i < fullTeam.length; i++) {
      var wgQ = mgWorkGroupToQueue_(fullTeam[i].workGroup);
      if (wgQ) return wgQ;
    }
  }
  var entry = mgFindLeadershipEntryByName_(managerName);
  if (entry && entry.groupAlias) {
    var fromMgr = mgGroupAliasToQueue_(entry.groupAlias);
    if (fromMgr) {
      mgAudit_('QUEUE_INFER', managerName,
        'Inferred queue from Leadership role "' + entry.role + '" → ' + fromMgr, 'INFO');
      return fromMgr;
    }
  }
  entry = mgFindLeadershipEntryForSubmitter_(submitterRaw, roster || []);
  if (entry && entry.groupAlias) {
    var fromSub = mgGroupAliasToQueue_(entry.groupAlias);
    if (fromSub) {
      mgAudit_('QUEUE_INFER', String(submitterRaw || ''),
        'Inferred queue from submitter Leadership role "' + entry.role + '" → ' + fromSub, 'INFO');
      return fromSub;
    }
  }
  var seenWg = [];
  for (i = 0; i < pool.length; i++) {
    var wg = String(pool[i].workGroup || '').trim();
    if (wg && seenWg.indexOf(wg) === -1) seenWg.push(wg);
  }
  mgAudit_('QUEUE_MISS', managerName || '',
    'No Assembled queue mapped. Sample work groups: ' +
    (seenWg.length ? seenWg.slice(0, 5).join(' | ') : '(blank)'),
    'WARN');
  return null;
}

function mgNormalizeManagerName_(raw) {
  var s = String(raw || '').replace(/^@/, '').trim();
  if (s.indexOf('.') !== -1 && s.indexOf(' ') === -1) {
    s = s.split('.').map(function(part) {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join(' ');
  }
  return s.trim();
}

function mgNormManagerKey_(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function mgCollectRosterManagers_(roster) {
  var seen = {};
  var list = [];
  (roster || []).forEach(function(r) {
    var m = String(r.manager || '').trim();
    if (!m) return;
    var k = mgNormManagerKey_(m);
    if (!seen[k]) {
      seen[k] = true;
      list.push(m);
    }
  });
  return list;
}

/** Managers on roster with exactly one match for this first name (except Emily). */
function mgManagersByFirstName_(managers, first) {
  return managers.filter(function(m) {
    return mgNormManagerKey_(m).split(' ')[0] === first;
  });
}

/**
 * Map form/Slack manager input to canonical Import Roster name (column E).
 * Aliases (e.g. Shilo gater), unique first-name match (wrong last name OK), Emily needs last name.
 */
function mgResolveManagerName_(raw, roster) {
  var rawStr = String(raw || '').trim();
  if (!rawStr) return '';

  var emailLow = rawStr.toLowerCase().replace(/^@/, '');
  if (emailLow.indexOf('@varsitytutors.com') !== -1) {
    var byEmail = mgGetPendingManagerByEmail_(emailLow);
    if (byEmail) return byEmail.displayName;
  }

  var normalized = mgNormalizeManagerName_(rawStr);
  if (!normalized) return '';

  var key = mgCanonicalizePersonKey_(mgNormManagerKey_(normalized));
  if (MG_MANAGER_ALIASES[key]) {
    return MG_MANAGER_ALIASES[key];
  }

  var managers = mgCollectRosterManagers_(roster);
  if (!managers.length) return normalized;

  var i;
  for (i = 0; i < managers.length; i++) {
    if (mgCanonicalizePersonKey_(mgNormManagerKey_(managers[i])) === key) return managers[i];
  }

  var parts = key.split(' ').filter(Boolean);
  if (!parts.length) return normalized;

  var first = parts[0];

  if (first === 'emily') {
    if (parts.length === 1) return normalized;
    var lastTok = parts[parts.length - 1];
    var emilyHits = managers.filter(function(m) {
      var mp = mgNormManagerKey_(m).split(' ');
      if (mp[0] !== 'emily' || mp.length < 2) return false;
      var last = mp[mp.length - 1];
      if (lastTok.length === 1) return last.charAt(0) === lastTok;
      return last.indexOf(lastTok) === 0 || mgNormManagerKey_(m).indexOf(key) !== -1;
    });
    if (emilyHits.length === 1) return emilyHits[0];
    return normalized;
  }

  if (MG_MANAGER_FIRST_ONLY_BLOCK.indexOf(first) === -1) {
    var byFirst = mgManagersByFirstName_(managers, first);
    if (byFirst.length === 1) return byFirst[0];
  }

  if (parts.length === 1) {
    return normalized;
  }

  var fuzzy = managers.filter(function(m) {
    var mk = mgCanonicalizePersonKey_(mgNormManagerKey_(m));
    return mk === key || mk.indexOf(key) === 0 || key.indexOf(mk) !== -1;
  });
  if (fuzzy.length === 1) return fuzzy[0];

  return normalized;
}

function mgParseTimeInt_(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  // Google Sheets time-only cells often round-trip as Date (base 1899-12-30)
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return Utilities.formatDate(raw, MG.TZ, 'HH:mm');
  }
  var s = String(raw).trim();
  if (s.indexOf(':') !== -1) {
    var col = s.match(/^(\d{1,2}):(\d{2})\s*(.*)$/i);
    if (col) {
      var h    = parseInt(col[1], 10);
      var m    = parseInt(col[2], 10);
      if (isNaN(h) || isNaN(m) || m < 0 || m > 59) return null;
      var tail = String(col[3] || '').trim().toUpperCase().replace(/\./g, '');
      var hasPM = false;
      var hasAM = false;
      if (tail) {
        if (tail.charAt(0) === 'P') hasPM = true;
        else if (tail.charAt(0) === 'A') hasAM = true;
      }
      if (hasPM && h < 12) h += 12;
      if (hasAM && h === 12) h = 0;
      if (!tail && h >= 1 && h <= 6) h += 12;
      if (h < 0 || h > 23) return null;
      return mgPad2_(h) + ':' + mgPad2_(m);
    }
  }
  var n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  if (isNaN(n)) return null;
  var hours, mins;
  if (n < 100) {
    hours = n;
    mins  = 0;
  } else {
    hours = Math.floor(n / 100);
    mins  = n % 100;
  }
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  if (hours >= 1 && hours <= 6) hours += 12;
  return mgPad2_(hours) + ':' + mgPad2_(mins);
}

function mgParseDateStr_(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    return Utilities.formatDate(raw, MG.TZ, 'yyyy-MM-dd');
  }
  var s = String(raw).trim();
  if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return s;
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, MG.TZ, 'yyyy-MM-dd');
  return null;
}

function mgBuildDateTime_(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const iso = dateStr.trim() + 'T' + timeStr.trim() + ':00';
  const d   = Utilities.parseDate(iso, MG.TZ, "yyyy-MM-dd'T'HH:mm:ss");
  return (!d || isNaN(d.getTime())) ? null : d;
}

function mgGetApiKey_() {
  const key = (PropertiesService.getScriptProperties().getProperty('ASSEMBLED_API_KEY') || '').trim();
  if (!key) throw new Error('Script Property "ASSEMBLED_API_KEY" is not set.');
  return key;
}

function mgGetSlackToken_() {
  const token = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
  if (!token) throw new Error('Script Property "SLACK_BOT_TOKEN" is not set.');
  return token;
}

function mgAuthHeaders_(apiKey) {
  return {
    'Authorization': 'Basic ' + Utilities.base64Encode(apiKey + ':'),
    'Content-Type':  'application/json'
  };
}

function mgBuildUrl_(base, params) {
  const keys = Object.keys(params || {}).filter(function(k) {
    return params[k] !== undefined && params[k] !== null && params[k] !== '';
  });
  if (!keys.length) return base;
  return base + '?' + keys.map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]));
  }).join('&');
}

function mgAlignDown_(n, mod) { return n - (n % mod); }

function mgNormalizeToken_(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function mgNum_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function mgIsNum_(value) {
  return value !== null && value !== undefined && value !== '' && isFinite(Number(value));
}

function mgPad2_(n) { return n < 10 ? '0' + n : String(n); }

function mgFriendlyDate_(dateStr) {
  var d = mgBuildDateTime_(dateStr, '12:00');
  if (!d) return dateStr;
  return Utilities.formatDate(d, MG.TZ, 'EEE, MMM d');
}

function mgFriendlyTime_(timeStr) {
  if (!timeStr) return timeStr;
  var d = mgBuildDateTime_('2000-01-01', timeStr);
  if (!d) return timeStr;
  return Utilities.formatDate(d, MG.TZ, 'h:mm a');
}

/***************************************
 * RECURRING MEETINGS
 ***************************************/
function mgGetOrCreateRecurringSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var styleHeader = function(sheet, nCols) {
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, nCols)
      .setFontWeight('bold')
      .setBackground('#1F4E78')
      .setFontColor('#ffffff');
    sheet.autoResizeColumns(1, nCols);
  };

  var main = ss.getSheetByName(MG.SHEETS.RECURRING_MEETINGS);
  if (!main) {
    main = ss.insertSheet(MG.SHEETS.RECURRING_MEETINGS);
    main.getRange(1, 1, 1, 15).setValues([[
      'Recurring ID', 'Created At', 'Status', 'Manager', 'Submitter', 'Title', 'Manual Attendees',
      'Day of Week', 'Start Time', 'End Time', 'Source Request Row',
      'Weeks Scheduled', 'Weeks Booked Alt', 'Weeks No Alt Selected', 'Last Target Week'
    ]]);
    styleHeader(main, 15);
  }

  var log = ss.getSheetByName(MG.SHEETS.RECURRING_WEEKLY_LOG);
  if (!log) {
    log = ss.insertSheet(MG.SHEETS.RECURRING_WEEKLY_LOG);
    log.getRange(1, 1, 1, 7).setValues([[
      'Logged At', 'Recurring ID', 'Target Week Key', 'Target Date', 'Outcome', 'Request Row', 'Notes'
    ]]);
    styleHeader(log, 7);
  }

  var opt = ss.getSheetByName(MG.SHEETS.RECURRING_OPT_IN_TOKENS);
  if (!opt) {
    opt = ss.insertSheet(MG.SHEETS.RECURRING_OPT_IN_TOKENS);
    opt.getRange(1, 1, 1, 12).setValues([[
      'Token', 'Created At', 'Status', 'Source Row', 'Manager', 'Submitter', 'Title',
      'Manual Attendees', 'Day of Week', 'Start', 'End', 'Manager Email'
    ]]);
    styleHeader(opt, 12);
  }
}

function mgBuildMakeRecurringSlackLink_(token) {
  var base = mgGetWebAppUrl_();
  if (!base || !token) return '';
  var url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'recurring=' + encodeURIComponent(token);
  return '<' + url + '|\uD83D\uDD01 Make this recurring>';
}

function mgBuildStopRecurringSlackLink_(recurringId) {
  var base = mgGetWebAppUrl_();
  if (!base || !recurringId) return '';
  var url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'stoprecurring=' + encodeURIComponent(recurringId);
  return '<' + url + '|\u23F9 Stop this recurring meeting>';
}

function mgDayOfWeekFromDateStr_(dateStr) {
  var d = mgBuildDateTime_(dateStr, '12:00');
  if (!d) return 0;
  return parseInt(Utilities.formatDate(d, MG.TZ, 'u'), 10);
}

function mgWeekMondayKey_(dateStr) {
  var d = mgBuildDateTime_(dateStr, '12:00');
  if (!d) return '';
  var dow = parseInt(Utilities.formatDate(d, MG.TZ, 'u'), 10);
  var monday = new Date(d.getTime() - (dow - 1) * 86400000);
  return Utilities.formatDate(monday, MG.TZ, 'yyyy-MM-dd');
}

function mgNextWeekTargetDate_(dayOfWeek) {
  var tz = MG.TZ;
  var now = new Date();
  var todayDow = parseInt(Utilities.formatDate(now, tz, 'u'), 10);
  var daysToMonday = ((8 - todayDow) % 7) || 7;
  var nextMonday = new Date(now.getTime() + daysToMonday * 86400000);
  var target = new Date(nextMonday.getTime() + (Number(dayOfWeek) - 1) * 86400000);
  return Utilities.formatDate(target, tz, 'yyyy-MM-dd');
}

function mgCreateRecurringOptInToken_(opts) {
  mgGetOrCreateRecurringSheets_();
  var token = Utilities.getUuid().replace(/-/g, '');
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_OPT_IN_TOKENS);
  var dow = mgDayOfWeekFromDateStr_(opts.dateStr);
  sheet.appendRow([
    token,
    new Date(),
    'PENDING',
    opts.sourceRowNum || '',
    opts.managerRaw || '',
    opts.submitterRaw || '',
    opts.title || '',
    opts.manualRaw || '',
    dow,
    opts.startStr || '',
    opts.endStr || '',
    opts.managerEmail || ''
  ]);
  var lr = sheet.getLastRow();
  sheet.getRange(lr, MG.RECURRING_OPT_COLS.START_TIME, 1, 2).setNumberFormat('@');
  sheet.getRange(lr, MG.RECURRING_OPT_COLS.START_TIME, 1, 2)
    .setValues([[String(opts.startStr || ''), String(opts.endStr || '')]]);
  SpreadsheetApp.flush();
  mgAudit_('RECURRING_OPT', token, 'source row ' + (opts.sourceRowNum || ''), 'OK');
  return token;
}

function mgLookupRecurringOptInToken_(token) {
  var t = String(token || '').trim().toLowerCase();
  if (!t) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_OPT_IN_TOKENS);
  if (!sheet || sheet.getLastRow() <= 1) return null;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === t) {
      return { rowNum: i + 1, row: values[i] };
    }
  }
  return null;
}

function mgLookupRecurringMeetingRow_(recurringId) {
  var id = String(recurringId || '').trim().toLowerCase();
  if (!id) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_MEETINGS);
  if (!sheet || sheet.getLastRow() <= 1) return null;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][MG.RECURRING_COLS.ID - 1] || '').trim().toLowerCase() === id) {
      return { rowNum: i + 1, row: values[i] };
    }
  }
  return null;
}

function mgExecuteRecurringOptIn_(token) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, message: 'Could not acquire lock. Try again in a moment.' };
  }
  try {
    var hit = mgLookupRecurringOptInToken_(token);
    if (!hit) return { ok: false, message: 'Invalid or unknown recurring link.' };
    var row = hit.row;
    var rowNum = hit.rowNum;
    var status = String(row[MG.RECURRING_OPT_COLS.STATUS - 1] || '').trim().toUpperCase();
    if (status === 'USED') {
      return { ok: true, message: 'This meeting is already set up as recurring.' };
    }
    if (status !== 'PENDING') {
      return { ok: false, message: 'This recurring link is no longer active.' };
    }

    var recurringId = Utilities.getUuid().replace(/-/g, '');
    var main = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_MEETINGS);
    main.appendRow([
      recurringId,
      new Date(),
      'ACTIVE',
      row[MG.RECURRING_OPT_COLS.MANAGER_RAW - 1],
      row[MG.RECURRING_OPT_COLS.SUBMITTER_RAW - 1],
      row[MG.RECURRING_OPT_COLS.TITLE - 1],
      row[MG.RECURRING_OPT_COLS.MANUAL_ATTENDEES - 1],
      row[MG.RECURRING_OPT_COLS.DAY_OF_WEEK - 1],
      row[MG.RECURRING_OPT_COLS.START_TIME - 1],
      row[MG.RECURRING_OPT_COLS.END_TIME - 1],
      row[MG.RECURRING_OPT_COLS.SOURCE_ROW - 1],
      0, 0, 0, ''
    ]);
    SpreadsheetApp.flush();

    var optSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_OPT_IN_TOKENS);
    optSheet.getRange(rowNum, MG.RECURRING_OPT_COLS.STATUS).setValue('USED');
    SpreadsheetApp.flush();

    var title = String(row[MG.RECURRING_OPT_COLS.TITLE - 1] || 'Team meeting');
    var submitter = String(row[MG.RECURRING_OPT_COLS.SUBMITTER_RAW - 1] || '');
    var dowNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var dow = Number(row[MG.RECURRING_OPT_COLS.DAY_OF_WEEK - 1] || 0);
    var slackMsg = '\uD83D\uDD01 *RECURRING ENABLED* — Meeting: _' + title + '_\n' +
      'Every ' + (dowNames[dow] || 'week') + ' at ' +
      mgFriendlyTime_(mgParseTimeInt_(row[MG.RECURRING_OPT_COLS.START_TIME - 1])) + '\u2013' +
      mgFriendlyTime_(mgParseTimeInt_(row[MG.RECURRING_OPT_COLS.END_TIME - 1])) + ' CT.\n' +
      'We\'ll try to book the following week each Friday. You\'ll get a BOOKED ping when it lands.';
    mgSlackDmSubmitter_(submitter, slackMsg);
    mgAudit_('RECURRING_OPT', token, 'created recurring ' + recurringId, 'OK');
    return { ok: true, message: 'Recurring meeting enabled. You\'ll get a confirmation in Slack.' };
  } catch (err) {
    mgAudit_('RECURRING_OPT', String(token || ''), String(err), 'FAILED');
    return { ok: false, message: 'Something went wrong: ' + String(err) };
  } finally {
    lock.releaseLock();
  }
}

function mgExecuteStopRecurring_(recurringId) {
  var hit = mgLookupRecurringMeetingRow_(recurringId);
  if (!hit) return { ok: false, message: 'Recurring meeting not found.' };
  var row = hit.row;
  var status = String(row[MG.RECURRING_COLS.STATUS - 1] || '').trim().toUpperCase();
  if (status === 'STOPPED') {
    return { ok: true, message: 'This recurring meeting was already stopped.' };
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_MEETINGS);
  sheet.getRange(hit.rowNum, MG.RECURRING_COLS.STATUS).setValue('STOPPED');
  SpreadsheetApp.flush();
  var title = String(row[MG.RECURRING_COLS.TITLE - 1] || 'Team meeting');
  var submitter = String(row[MG.RECURRING_COLS.SUBMITTER - 1] || '');
  mgSlackDmSubmitter_(submitter,
    '\u23F9 *RECURRING STOPPED* — Meeting: _' + title + '_\n' +
    'We won\'t auto-book this meeting going forward. Already-booked weeks are unchanged.');
  mgAudit_('RECURRING_STOP', recurringId, title, 'OK');
  return { ok: true, message: 'Recurring meeting stopped. Future auto-bookings are cancelled.' };
}

function mgIncrementRecurringCounter_(recurringId, colKey, amount) {
  var hit = mgLookupRecurringMeetingRow_(recurringId);
  if (!hit) return;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_MEETINGS);
  var col = MG.RECURRING_COLS[colKey];
  if (!col) return;
  var current = Number(hit.row[col - 1] || 0);
  sheet.getRange(hit.rowNum, col).setValue(current + (amount || 1));
  SpreadsheetApp.flush();
}

function mgSetRecurringLastTargetWeek_(recurringId, weekKey) {
  var hit = mgLookupRecurringMeetingRow_(recurringId);
  if (!hit) return;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_MEETINGS);
  sheet.getRange(hit.rowNum, MG.RECURRING_COLS.LAST_TARGET_WEEK).setValue(weekKey);
  SpreadsheetApp.flush();
}

function mgLogRecurringWeek_(recurringId, weekKey, targetDate, outcome, requestRow, notes) {
  mgGetOrCreateRecurringSheets_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_WEEKLY_LOG);
  sheet.appendRow([new Date(), recurringId, weekKey, targetDate, outcome, requestRow || '', notes || '']);
  SpreadsheetApp.flush();
  if (String(outcome || '').trim().toUpperCase() === 'ERROR') {
    var recurringDetail = [
      '*Recurring ID:* ' + recurringId,
      '*Week:* ' + weekKey,
      '*Target date:* ' + targetDate
    ];
    if (requestRow) recurringDetail.push('*Requests row:* ' + requestRow);
    if (notes) recurringDetail.push('*Detail:* ' + notes);
    mgNotifyWfmError_('Recurring meeting failed', recurringDetail);
  }
}

function mgMarkRecurringAltBooked_(recurringId, bookedDateStr) {
  var weekKey = mgWeekMondayKey_(bookedDateStr);
  var logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_WEEKLY_LOG);
  if (!logSheet || logSheet.getLastRow() <= 1) return;
  var values = logSheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    var rid = String(values[i][MG.RECURRING_LOG_COLS.RECURRING_ID - 1] || '').trim().toLowerCase();
    var wk = String(values[i][MG.RECURRING_LOG_COLS.TARGET_WEEK_KEY - 1] || '').trim();
    var outcome = String(values[i][MG.RECURRING_LOG_COLS.OUTCOME - 1] || '').trim().toUpperCase();
    if (rid === String(recurringId).trim().toLowerCase() && wk === weekKey && outcome === 'ALT_OFFERED') {
      logSheet.getRange(i + 1, MG.RECURRING_LOG_COLS.OUTCOME).setValue('ALT_BOOKED');
      logSheet.getRange(i + 1, MG.RECURRING_LOG_COLS.NOTES).setValue('Booked via alternative link for ' + bookedDateStr);
      SpreadsheetApp.flush();
      mgIncrementRecurringCounter_(recurringId, 'WEEKS_BOOKED_ALT', 1);
      return;
    }
  }
}

function mgCloseOutRecurringPendingWeeks_() {
  var logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_WEEKLY_LOG);
  if (!logSheet || logSheet.getLastRow() <= 1) return;
  var currentWeekKey = mgWeekMondayKey_(mgNextWeekTargetDate_(1));
  var values = logSheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var outcome = String(values[i][MG.RECURRING_LOG_COLS.OUTCOME - 1] || '').trim().toUpperCase();
    var weekKey = String(values[i][MG.RECURRING_LOG_COLS.TARGET_WEEK_KEY - 1] || '').trim();
    if (outcome !== 'ALT_OFFERED') continue;
    if (weekKey >= currentWeekKey) continue;
    logSheet.getRange(i + 1, MG.RECURRING_LOG_COLS.OUTCOME).setValue('NO_ALT_SELECTED');
    logSheet.getRange(i + 1, MG.RECURRING_LOG_COLS.NOTES).setValue('No alternative selected before next Friday run.');
    var recurringId = String(values[i][MG.RECURRING_LOG_COLS.RECURRING_ID - 1] || '').trim();
    if (recurringId) mgIncrementRecurringCounter_(recurringId, 'WEEKS_NO_ALT', 1);
  }
  SpreadsheetApp.flush();
}

function mgFindAlternativeWindowsInWeek_(headers, siteId, queueId, weekMondayDateStr, attendeeCount, durationMs, preferredDateStr, scheduledStart, scheduledEnd) {
  var alternatives = [];
  var tz = MG.TZ;
  var monday = mgBuildDateTime_(weekMondayDateStr, '12:00');
  if (!monday) return alternatives;
  for (var d = 0; d < 5; d++) {
    var dayStart = new Date(monday.getTime() + d * 86400000);
    var dateStr = Utilities.formatDate(dayStart, tz, 'yyyy-MM-dd');
    var dayAlts = mgFindAlternativeWindows_(
      headers, siteId, queueId, dayStart, attendeeCount, durationMs, 1, scheduledStart, scheduledEnd
    );
    dayAlts.forEach(function(a) {
      if (alternatives.length < 3) alternatives.push(a);
    });
    if (alternatives.length >= 3) break;
  }
  if (preferredDateStr && alternatives.length > 1) {
    alternatives.sort(function(a, b) {
      var aPref = a.dateStr === preferredDateStr ? 0 : 1;
      var bPref = b.dateStr === preferredDateStr ? 0 : 1;
      return aPref - bPref;
    });
  }
  return alternatives.slice(0, 3);
}

function mgEvaluateRecurringSlot_(managerRaw, submitterRaw, title, manualRaw, dateStr, startStr, endStr) {
  var roster = mgLoadRoster_();
  if (!roster.length) return { ok: false, error: 'Roster unavailable.' };
  var managerName = mgResolveManagerName_(managerRaw, roster);
  if (!managerName) return { ok: false, error: 'Could not parse manager name.' };
  var managerEmail = mgResolveManagerEmail_(managerName);
  var meetingStart = mgBuildDateTime_(dateStr, startStr);
  var meetingEnd = mgBuildDateTime_(dateStr, endStr);
  if (!meetingStart || !meetingEnd || meetingEnd <= meetingStart) {
    return { ok: false, error: 'Invalid meeting window.' };
  }
  var config = mgLoadConfig_();
  var blackoutHit = mgGetMeetingBlackoutHit_(dateStr, meetingStart, config);
  if (blackoutHit) return { ok: false, error: 'Blackout date: ' + blackoutHit, blackout: true };

  var coachCtx = mgCoachLeadGroupContext_(manualRaw, submitterRaw, roster, managerName);
  var teamRes = mgResolveManagerTeamForRequest_(roster, managerName, managerRaw, coachCtx.effectiveManual);
  if (!teamRes.ok) return { ok: false, error: teamRes.error || 'Could not resolve team.' };
  var team = teamRes.team;

  var apiKey = mgGetApiKey_();
  var headers = mgAuthHeaders_(apiKey);
  var scheduledEmails = mgGetScheduledEmails_(headers, meetingStart, meetingEnd);
  var scheduledAttendees = team.filter(function(r) { return scheduledEmails.has(r.email); });
  if (!scheduledAttendees.length) {
    return { ok: true, canBook: false, reason: 'no_scheduled', scheduledAttendees: [], team: team, headers: headers,
      managerName: managerName, managerEmail: managerEmail, managerRaw: managerRaw, meetingStart: meetingStart, meetingEnd: meetingEnd };
  }

  var queue = mgResolveTeamQueue_(scheduledAttendees.length ? scheduledAttendees : team, managerName, submitterRaw, roster);
  if (!queue) return { ok: false, error: 'Could not resolve queue.' };
  var siteId = mgResolveSiteId_(headers, MG.ASSEMBLED.SITE_NAME);
  var queueId = mgResolveQueueId_(headers, queue);
  if (!queueId) return { ok: false, error: 'Could not resolve queue ID.' };

  var netStaffing = mgGetNetStaffingForWindow_(headers, siteId, queueId, meetingStart, meetingEnd);
  var postMeetingNet = netStaffing - scheduledAttendees.length;
  var minBuffer = mgGetStaffingMinBuffer_(config);
  return {
    ok: true,
    canBook: postMeetingNet >= minBuffer,
    scheduledAttendees: scheduledAttendees,
    team: team,
    headers: headers,
    siteId: siteId,
    queueId: queueId,
    queue: queue,
    netStaffing: netStaffing,
    postMeetingNet: postMeetingNet,
    managerName: managerName,
    managerEmail: managerEmail,
    managerRaw: managerRaw,
    meetingStart: meetingStart,
    meetingEnd: meetingEnd,
    manualRaw: manualRaw
  };
}

function mgAppendRecurringRequestsRow_(managerRaw, title, dateStr, startStr, endStr, scheduledAttendees, submitterRaw, okCommit, recurringId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.REQUESTS);
  if (!sheet) return 0;
  var dateCell = mgBuildDateTime_(dateStr, '12:00');
  var names = scheduledAttendees.map(function(r) { return r.name; }).join(', ');
  var decision = okCommit
    ? 'APPROVED — recurring auto-book'
    : 'APPROVED — recurring auto-book — Assembled Error';
  sheet.appendRow([
    new Date(), managerRaw, title, dateCell, startStr, endStr, names, submitterRaw, decision,
    'Recurring ID ' + recurringId
  ]);
  SpreadsheetApp.flush();
  return sheet.getLastRow();
}

function mgBookRecurringSlot_(recurringId, recurringRow, targetDateStr, evalResult, submitterRaw) {
  var title = String(recurringRow[MG.RECURRING_COLS.TITLE - 1] || 'Team meeting');
  var startStr = mgParseTimeInt_(recurringRow[MG.RECURRING_COLS.START_TIME - 1]);
  var endStr = mgParseTimeInt_(recurringRow[MG.RECURRING_COLS.END_TIME - 1]);
  var managerRaw = String(recurringRow[MG.RECURRING_COLS.MANAGER - 1] || '');
  var testMode = mgIsTestMode_();
  var commitTargets = testMode
    ? evalResult.scheduledAttendees.slice(0, 1)
    : evalResult.scheduledAttendees;

  var requestRowNum = mgAppendRecurringRequestsRow_(
    managerRaw, title, targetDateStr, startStr, endStr, evalResult.scheduledAttendees,
    submitterRaw, true, recurringId
  );

  var commitResult = mgCommitMeetingToAssembled_(
    evalResult.headers, commitTargets, evalResult.meetingStart, evalResult.meetingEnd,
    requestRowNum, title, evalResult.managerEmail, evalResult.managerName
  );

  var meetLink = mgGetManagerMeetLink_(evalResult.managerEmail, evalResult.managerName);
  var meetLine = mgFormatMeetSlackLine_(meetLink, commitResult.calendar);
  var okCommit = !commitResult.failed.length;
  var bookFooter = testMode
    ? '\n\n_\u26a0\ufe0f TEST MODE — only one rep schedule updated._'
    : '\n\n_Recurring meeting — auto-booked for next week._';

  var slackMsg;
  if (okCommit) {
    slackMsg = mgWrapApprovalSlack_(title, targetDateStr, startStr, endStr,
      'You\'re booked — added to your team\'s schedules. You\'re good to go!',
      meetLine, commitResult, bookFooter, {
        managerRaw: managerRaw,
        submitterRaw: submitterRaw,
        sourceRowNum: requestRowNum,
        managerEmail: evalResult.managerEmail,
        emailsCsv: evalResult.scheduledAttendees.map(function(r) { return r.email; }).join(','),
        recurringId: recurringId,
        skipMakeRecurring: true
      });
  } else {
    slackMsg = mgWrapApprovalSlack_(title, targetDateStr, startStr, endStr,
      'Recurring booking partially failed: ' + commitResult.failed.join(', ') + '.',
      meetLine, commitResult, bookFooter, {
        managerRaw: managerRaw,
        submitterRaw: submitterRaw,
        sourceRowNum: requestRowNum,
        managerEmail: evalResult.managerEmail,
        recurringId: recurringId,
        skipMakeRecurring: true
      });
  }
  mgSlackDmSubmitter_(submitterRaw, slackMsg);
  return { okCommit: okCommit, requestRowNum: requestRowNum };
}

function mgSendRecurringReschedulePing_(recurringId, recurringRow, targetDateStr, evalResult, submitterRaw) {
  var title = String(recurringRow[MG.RECURRING_COLS.TITLE - 1] || 'Team meeting');
  var startStr = mgParseTimeInt_(recurringRow[MG.RECURRING_COLS.START_TIME - 1]);
  var endStr = mgParseTimeInt_(recurringRow[MG.RECURRING_COLS.END_TIME - 1]);
  var managerRaw = String(recurringRow[MG.RECURRING_COLS.MANAGER - 1] || '');
  var manualRaw = String(recurringRow[MG.RECURRING_COLS.MANUAL_ATTENDEES - 1] || '');
  var weekKey = mgWeekMondayKey_(targetDateStr);
  var durationMs = evalResult.meetingEnd.getTime() - evalResult.meetingStart.getTime();
  var attendeeCount = evalResult.scheduledAttendees.length || 1;

  var alternatives = mgFindAlternativeWindowsInWeek_(
    evalResult.headers, evalResult.siteId, evalResult.queueId, weekKey, attendeeCount,
    durationMs, targetDateStr, evalResult.meetingStart, evalResult.meetingEnd
  );

  var emailsCsv = (evalResult.scheduledAttendees || []).map(function(r) { return r.email; }).join(',');
  var altLines = [];
  if (alternatives.length && mgGetWebAppUrl_()) {
    altLines = alternatives.map(function(a) {
      var tok = mgCreateBookingToken_({
        managerRaw: managerRaw,
        submitterRaw: submitterRaw,
        title: title,
        manualRaw: manualRaw,
        dateStr: a.dateStr,
        startStr: a.startStr,
        endStr: a.endStr,
        emailsCsv: emailsCsv,
        sourceRowNum: '',
        recurringId: recurringId
      });
      var book = mgBuildBookItSlackLink_(tok);
      var line = '\u2022 ' + mgFriendlyDate_(a.dateStr) + ', ' + mgFriendlyTime_(a.startStr) + '\u2013' + mgFriendlyTime_(a.endStr) + ' CT';
      return book ? (line + '  ' + book) : line;
    });
  }

  var msg = '\u274C *CAN\'T BOOK RECURRING* — Meeting: _' + title + '_\n' +
    'We can\'t book your recurring meeting at the regular time next week (' +
    mgFriendlyDate_(targetDateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' + mgFriendlyTime_(endStr) + ' CT).\n' +
    'Please elect one of these alternatives instead.';

  if (altLines.length) {
    msg += '\n\n*These times work next week:*\n' + altLines.join('\n');
    msg += '\n\n_Tap the \uD83D\uDCC5 Book it link next to a time to reserve instantly \u2014 no form required._';
  } else {
    msg += '\n\n_No alternative slots were found for next week._';
  }
  msg += '\n\n_If none of these times work for you, please request an alternative through the flow._';
  var stopLink = mgBuildStopRecurringSlackLink_(recurringId);
  if (stopLink) msg += '\n\n' + stopLink;

  mgSlackDmSubmitter_(submitterRaw, msg);
  mgLogRecurringWeek_(recurringId, weekKey, targetDateStr, altLines.length ? 'ALT_OFFERED' : 'NO_ALT_SELECTED',
    '', altLines.length ? 'Reschedule ping sent' : 'No alternatives found');
  if (!altLines.length) mgIncrementRecurringCounter_(recurringId, 'WEEKS_NO_ALT', 1);
}

function mgProcessRecurringMeetingRow_(recurringId, recurringRow) {
  var status = String(recurringRow[MG.RECURRING_COLS.STATUS - 1] || '').trim().toUpperCase();
  if (status !== 'ACTIVE') return;

  var dayOfWeek = Number(recurringRow[MG.RECURRING_COLS.DAY_OF_WEEK - 1] || 0);
  var targetDateStr = mgNextWeekTargetDate_(dayOfWeek);
  var weekKey = mgWeekMondayKey_(targetDateStr);
  var lastWeek = String(recurringRow[MG.RECURRING_COLS.LAST_TARGET_WEEK - 1] || '').trim();
  if (lastWeek === weekKey) return;

  var submitterRaw = String(recurringRow[MG.RECURRING_COLS.SUBMITTER - 1] || '');
  var managerRaw = String(recurringRow[MG.RECURRING_COLS.MANAGER - 1] || '');
  var title = String(recurringRow[MG.RECURRING_COLS.TITLE - 1] || 'Team meeting');
  var manualRaw = String(recurringRow[MG.RECURRING_COLS.MANUAL_ATTENDEES - 1] || '');
  var startStr = mgParseTimeInt_(recurringRow[MG.RECURRING_COLS.START_TIME - 1]);
  var endStr = mgParseTimeInt_(recurringRow[MG.RECURRING_COLS.END_TIME - 1]);

  var evalResult = mgEvaluateRecurringSlot_(managerRaw, submitterRaw, title, manualRaw, targetDateStr, startStr, endStr);
  if (!evalResult.ok) {
    mgLogRecurringWeek_(recurringId, weekKey, targetDateStr, 'ERROR', '', evalResult.error || 'evaluate failed');
    mgSetRecurringLastTargetWeek_(recurringId, weekKey);
    return;
  }

  if (evalResult.reason === 'no_scheduled') {
    var headsUp = '\u26a0\ufe0f *RECURRING — NO TEAM SCHEDULED* — Meeting: _' + title + '_\n' +
      'Next week\'s slot (' + mgFriendlyDate_(targetDateStr) + ', ' + mgFriendlyTime_(startStr) + '\u2013' +
      mgFriendlyTime_(endStr) + ' CT) has no scheduled reps. Please request an alternative through the flow if needed.';
    mgSlackDmSubmitter_(submitterRaw, headsUp);
    mgLogRecurringWeek_(recurringId, weekKey, targetDateStr, 'NO_ALT_SELECTED', '', 'No scheduled attendees');
    mgIncrementRecurringCounter_(recurringId, 'WEEKS_NO_ALT', 1);
    mgSetRecurringLastTargetWeek_(recurringId, weekKey);
    return;
  }

  if (evalResult.canBook) {
    var bookResult = mgBookRecurringSlot_(recurringId, recurringRow, targetDateStr, evalResult, submitterRaw);
    mgLogRecurringWeek_(recurringId, weekKey, targetDateStr, bookResult.okCommit ? 'SCHEDULED' : 'ERROR',
      bookResult.requestRowNum, bookResult.okCommit ? 'Auto-booked at regular time' : 'Assembled commit failed');
    if (bookResult.okCommit) mgIncrementRecurringCounter_(recurringId, 'WEEKS_SCHEDULED', 1);
    mgSetRecurringLastTargetWeek_(recurringId, weekKey);
    return;
  }

  mgSendRecurringReschedulePing_(recurringId, recurringRow, targetDateStr, evalResult, submitterRaw);
  mgSetRecurringLastTargetWeek_(recurringId, weekKey);
}

function processRecurringMeetings() {
  var tz = MG.TZ;
  var dow = parseInt(Utilities.formatDate(new Date(), tz, 'u'), 10);
  if (dow !== 5) return;
  mgProcessRecurringMeetingsCore_();
}

function mgRunRecurringNow() {
  mgProcessRecurringMeetingsCore_();
  SpreadsheetApp.getUi().alert('Recurring run complete. Check Scheduled Recurring Meetings, Recurring Weekly Log, and Audit.');
}

function mgProcessRecurringMeetingsCore_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) {
    mgAudit_('RECURRING', '', 'Skipped — lock held', 'INFO');
    return;
  }
  try {
    mgGetOrCreateRecurringSheets_();
    mgCloseOutRecurringPendingWeeks_();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MG.SHEETS.RECURRING_MEETINGS);
    if (!sheet || sheet.getLastRow() <= 1) {
      mgAudit_('RECURRING', '', 'No recurring meetings', 'INFO');
      return;
    }
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var recurringId = String(values[i][MG.RECURRING_COLS.ID - 1] || '').trim();
      if (!recurringId) continue;
      try {
        mgProcessRecurringMeetingRow_(recurringId, values[i]);
      } catch (rowErr) {
        mgAudit_('RECURRING', recurringId, String(rowErr), 'FAILED');
      }
    }
    mgAudit_('RECURRING', '', 'Friday recurring run complete', 'OK');
  } finally {
    lock.releaseLock();
  }
}

/***************************************
 * PITSTOP API — sheet logic backend for Pitstop UI
 * Deploy this script as Web app (doPost). Set Script Property PITSTOP_BRIDGE_SECRET.
 * Netlify env: PITSTOP_MEETING_LOGIC_URL = deployed /exec URL
 ***************************************/

function doPost(e) {
  var addRepsTok = String((e.parameter && e.parameter.addreps) || '').trim();
  if (addRepsTok) {
    var namesRaw = String((e.parameter && e.parameter.names) || '').trim();
    var addResult = mgExecuteAddRepsToken_(addRepsTok, namesRaw);
    return HtmlService.createHtmlOutput(mgBookingResponsePage_(addResult.message, addResult.ok)).setTitle(MG_MANAGER_BRAND);
  }
  return pitstopDoPost_(e);
}

function pitstopDoPost_(e) {
  try {
  pitstopVerifySecret_(e);
  var raw = (e.postData && e.postData.contents) ? e.postData.contents : '{}';
  var body = JSON.parse(raw);
  var action = String(body.action || '').trim();

  if (action === 'evaluate') {
    return pitstopJson_(pitstopRouteEvaluate_(body));
  }
  if (action === 'commit') {
    return pitstopJson_(pitstopRouteCommit_(body));
  }
  return pitstopJson_({ error: 'Unknown action: ' + action });
  } catch (err) {
  return pitstopJson_({ error: String(err && err.message ? err.message : err) });
  }
}

function pitstopVerifySecret_(e) {
  var expected = String(PropertiesService.getScriptProperties().getProperty('PITSTOP_BRIDGE_SECRET') || '').trim();
  if (!expected) return;
  var got = '';
  if (e.parameter && e.parameter.secret) got = String(e.parameter.secret).trim();
  try {
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (body.secret) got = String(body.secret).trim();
  } catch (ignore) {}
  if (got !== expected) throw new Error('Invalid Pitstop bridge secret');
}

function pitstopJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function pitstopRouteEvaluate_(body) {
  var changeType = String(body.changeType || '').trim();
  var payload = body.payload || {};
  var audit = [];

  if (changeType === 'add_meeting') {
    return pitstopEvaluateMeeting_(payload, audit);
  }
  if (changeType === 'permanent_schedule_change') {
    return {
      decision: 'review',
      reasoning: 'Permanent schedule changes require WFM approval before Apply runs in Schedule Changes.',
      autoCommit: false,
      sheetAudit: ['Permanent changes always queue for WFM in Pitstop'],
      source: 'meeting-governor-bridge'
    };
  }
  return pitstopEvaluateOneOff_(payload, audit);
}

function pitstopRouteCommit_(body) {
  var changeType = String(body.changeType || '').trim();
  var payload = body.payload || {};
  if (changeType === 'add_meeting') {
    return pitstopCommitMeeting_(payload, body);
  }
  return { ok: false, message: 'Commit not implemented for changeType: ' + changeType };
}

/**
 * Meeting Governor dry-run: same net-staffing / alternatives as mgProcessRow_, no Slack DMs.
 */
function pitstopEvaluateMeeting_(payload, audit) {
  audit = audit || [];
  var managerRaw = String(payload.managerName || payload.managerEmail || '').trim();
  var title = String(payload.title || 'Team meeting').trim();
  var dateStr = String(payload.date || '').trim();
  var startStr = String(payload.startTime || '').trim();
  var endStr = String(payload.endTime || '').trim();
  var manualRaw = payload.manualAttendees || payload.attendeeEmails || '';

  if (!managerRaw || !dateStr || !startStr || !endStr) {
    return {
      decision: 'review',
      reasoning: 'Missing manager, date, or time — WFM must complete request.',
      autoCommit: false,
      sheetAudit: audit,
      source: 'meeting-governor'
    };
  }

  var rosterEarly = mgLoadRoster_();
  var managerName = mgResolveManagerName_(managerRaw, rosterEarly);
  if (!managerName) {
    return { decision: 'review', reasoning: 'Could not parse manager name.', autoCommit: false, sheetAudit: audit, source: 'meeting-governor' };
  }

  var meetingStart = mgBuildDateTime_(dateStr, startStr);
  var meetingEnd = mgBuildDateTime_(dateStr, endStr);
  if (!meetingStart || !meetingEnd || meetingEnd <= meetingStart) {
    return { decision: 'deny', reasoning: 'Invalid meeting window.', autoCommit: false, sheetAudit: audit, source: 'meeting-governor' };
  }

  var config = mgLoadConfig_();
  var durationMins = (meetingEnd.getTime() - meetingStart.getTime()) / 60000;
  var minDurationMins = Number(config[MG.CFG.MIN_DURATION_MINUTES] || 30);
  if (durationMins < minDurationMins) {
    audit.push('Under duration threshold — auto-approve');
    return {
      decision: 'approve',
      reasoning: 'Meetings under ' + minDurationMins + ' minutes auto-approve (standard threshold).',
      autoCommit: true,
      sheetAudit: audit,
      source: 'meeting-governor'
    };
  }

  var roster = rosterEarly.length ? rosterEarly : mgLoadRoster_();
  if (!roster.length) {
    return { decision: 'review', reasoning: 'Import Roster empty.', autoCommit: false, sheetAudit: audit, source: 'meeting-governor' };
  }

  var teamRes = mgResolveManagerTeamForRequest_(roster, managerName, managerRaw, manualRaw);
  if (!teamRes.ok) {
    return { decision: 'review', reasoning: teamRes.error, autoCommit: false, sheetAudit: audit, source: 'meeting-governor' };
  }
  var teamFull = teamRes.teamFull;

  var filterRes = mgApplyManualAttendeeFilter_(teamFull, manualRaw, roster, managerName);
  if (filterRes.error) {
    return { decision: 'deny', reasoning: filterRes.error, autoCommit: false, sheetAudit: audit, source: 'meeting-governor' };
  }
  var team = filterRes.members;

  var queue = mgResolveTeamQueue_(team, managerName, submitterRaw, roster);
  if (!queue) {
    return { decision: 'review', reasoning: 'Could not map work group to queue.', autoCommit: false, sheetAudit: audit, source: 'meeting-governor' };
  }

  var apiKey = mgGetApiKey_();
  var headers = mgAuthHeaders_(apiKey);
  var siteId = mgResolveSiteId_(headers, MG.ASSEMBLED.SITE_NAME);
  var queueId = mgResolveQueueId_(headers, queue);
  if (!queueId) {
    return { decision: 'review', reasoning: 'Could not resolve queue: ' + queue, autoCommit: false, sheetAudit: audit, source: 'meeting-governor' };
  }

  var scheduledEmails = mgGetScheduledEmails_(headers, meetingStart, meetingEnd);
  var scheduledAttendees = team.filter(function(r) { return scheduledEmails.has(r.email); });

  if (!scheduledAttendees.length) {
    audit.push('No scheduled attendees in window');
    return {
      decision: 'review',
      reasoning: 'No team members scheduled during this window — flagged for review.',
      autoCommit: false,
      sheetAudit: audit,
      source: 'meeting-governor'
    };
  }

  var minAttendees = Number(config[MG.CFG.MIN_ATTENDEES] || 3);
  if (scheduledAttendees.length < minAttendees) {
    audit.push('Under attendee threshold — auto-approve');
    return {
      decision: 'approve',
      reasoning: 'Fewer than ' + minAttendees + ' attendees — auto-approve (standard threshold).',
      autoCommit: true,
      sheetAudit: audit,
      source: 'meeting-governor'
    };
  }

  var netStaffing = mgGetNetStaffingForWindow_(headers, siteId, queueId, meetingStart, meetingEnd);
  var postMeetingNet = netStaffing - scheduledAttendees.length;
  var minBuffer = mgGetStaffingMinBuffer_(config);
  audit.push('Net=' + netStaffing + ' attendees=' + scheduledAttendees.length + ' post=' + postMeetingNet);

  if (postMeetingNet >= minBuffer) {
    return {
      decision: 'approve',
      reasoning: 'Post-meeting net staffing (' + postMeetingNet + ') meets buffer (≥' + minBuffer + ').',
      autoCommit: true,
      sheetAudit: audit,
      details: { netStaffing: netStaffing, postMeetingNet: postMeetingNet, attendeeCount: scheduledAttendees.length, queue: queue },
      source: 'meeting-governor'
    };
  }

  var meetingDurationMs = meetingEnd.getTime() - meetingStart.getTime();
  var altRows = mgFindAlternativeWindows_(headers, siteId, queueId, meetingStart, scheduledAttendees.length, meetingDurationMs, MG.SEARCH_DAYS, meetingStart, meetingEnd);
  var alternatives = altRows.slice(0, 3).map(function(a) {
    var st = mgBuildDateTime_(a.dateStr, a.startStr);
    var en = mgBuildDateTime_(a.dateStr, a.endStr);
    return {
      start: st ? st.toISOString() : '',
      end: en ? en.toISOString() : '',
      label: mgFriendlyDate_(a.dateStr) + ' ' + mgFriendlyTime_(a.startStr) + '–' + mgFriendlyTime_(a.endStr) + ' CT'
    };
  });

  return {
    decision: 'deny',
    reasoning: 'Would drop below net staffing buffer (post-meeting net ' + postMeetingNet + ').',
    alternatives: alternatives,
    autoCommit: false,
    sheetAudit: audit,
    details: { netStaffing: netStaffing, postMeetingNet: postMeetingNet, attendeeCount: scheduledAttendees.length, queue: queue },
    source: 'meeting-governor'
  };
}

function pitstopEvaluateOneOff_(payload, audit) {
  audit.push('One-off change — review unless net staffing ported');
  return {
    decision: 'review',
    reasoning: 'One-off block changes: WFM review until net-staffing check is wired for activity edits.',
    autoCommit: false,
    sheetAudit: audit,
    source: 'meeting-governor'
  };
}

function pitstopCommitMeeting_(payload, body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MG.SHEETS.REQUESTS);
  if (!sheet) throw new Error('Missing Requests sheet');

  var managerRaw = String(payload.managerName || payload.managerEmail || '').trim();
  var row = [
    new Date(),
    managerRaw,
    String(payload.title || 'Team meeting'),
    payload.date,
    payload.startTime,
    payload.endTime,
    payload.manualAttendees || (payload.attendeeEmails || []).join(', '),
    body.requesterEmail || '',
    '', ''
  ];
  sheet.appendRow(row);
  var rowNum = sheet.getLastRow();
  pitstopAudit_('PITSTOP_COMMIT', body.requestId || '', 'Appended Requests row ' + rowNum, 'OK');

  mgProcessRow_(sheet, sheet.getRange(rowNum, 1, 1, 10).getValues()[0], rowNum);

  return { ok: true, message: 'Meeting booked (Requests row ' + rowNum + ')', details: { rowNum: rowNum } };
}

function pitstopAudit_(action, ref, message, status) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(MG.SHEETS.AUDIT);
    if (!sh) return;
    sh.appendRow([new Date(), action, ref, message, status || 'INFO', 'Pitstop']);
  } catch (e) {}
}
