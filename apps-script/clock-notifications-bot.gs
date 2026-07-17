/*************************************************************
 * CLOCK NOTIFICATIONS BOT — Call Out Main Flow spreadsheet
 * v1.2.0
 *
 * TABS (exact names):
 *   "Clock Notifications Bot" — editable config (Key | Value | Notes).
 *     Thresholds: minutes *before* shift start / meal / shift end to Slack DM.
 *   "Schedule Pull" — filled by crPullScheduleToSchedulePull() every 2h.
 *   "Clock Notifications Audit" — log + **dedupe**: one shift-start and one shift-end per rep per calendar day; meals dedupe by start time.
 *
 * TRIGGERS (crInstallClockNotificationTriggers):
 *   • crPullScheduleToSchedulePull — every 2 hours
 *   • crProcessClockNotifications — every 5 minutes
 *
 * SCRIPT PROPERTIES:
 *   ASSEMBLED_API_KEY, SLACK_BOT_TOKEN (same as Targeted OT bot)
 *
 * Roster: optional pipe-list in config key ROSTER_EMAILS. If blank, every email
 *   present in the latest Schedule Pull snapshot is eligible.
 *
 * MENU: call crClockNotificationsOnOpen() from this spreadsheet’s onOpen().
 *************************************************************/

var CNB = {
  VERSION: 'v1.2.0',
  API_BASE: 'https://api.assembledhq.com/v0',
  SHEETS: {
    BOT:      'Clock Notifications Bot',
    AUDIT:    'Clock Notifications Audit',
    SCHEDULE: 'Schedule Pull'
  },
  TRIGGER_PULL: 'crPullScheduleToSchedulePull',
  TRIGGER_NOTIFY: 'crProcessClockNotifications'
};

var CNB_DEFAULT_PRODUCTIVE = ['phone', 'chat', 'sms'];
var CNB_DEFAULT_MEAL = ['meal', 'lunch', 'rest break'];

/** Schedule Pull headers (row 1). */
var CNB_SCHEDULE_HEADERS = [
  'Pulled At', 'Email', 'Name', 'Agent ID', 'Activity Type', 'Start', 'End', 'Activity Id'
];

function crClockNotificationsOnOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Clock Notifications')
    .addItem('Ensure bot tab layout (seed defaults)', 'crSeedClockNotificationsBotTab')
    .addItem('Pull schedule now → Schedule Pull', 'crPullScheduleToSchedulePull')
    .addItem('Run notifications now', 'crProcessClockNotifications')
    .addSeparator()
    .addItem('Install triggers (2h pull + 5m notify)', 'crInstallClockNotificationTriggers')
    .addItem('Remove Clock Notification triggers', 'crRemoveClockNotificationTriggers')
    .addToUi();
}

/*************************************************************
 * SCHEDULE PULL — every 2 hours (trigger)
 *************************************************************/
function crPullScheduleToSchedulePull() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var cfg = cnbGetBotConfig_();
    var tz = String(cfg.TIMEZONE || 'America/Chicago').trim() || 'America/Chicago';
    var now = new Date();
    var dayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var dayStart = cnbParseInTz_(dayKey + 'T00:00:00', tz);
    var pullHours = Math.max(12, Math.min(72, Number(cfg.SCHEDULE_PULL_HOURS || 36)));
    if (!dayStart || isNaN(dayStart.getTime())) {
      cnbAudit_('PULL', '', 'Invalid TIMEZONE / day start', 'FAILED');
      return;
    }
    var windowEnd = new Date(dayStart.getTime() + pullHours * 60 * 60 * 1000);
    var startSec = Math.floor(dayStart.getTime() / 1000);
    var endSec = Math.floor(windowEnd.getTime() / 1000);

    var rows;
    try {
      rows = cnbFetchActivitiesWindow_(startSec, endSec);
    } catch (err) {
      cnbAudit_('PULL', '', String(err), 'FAILED');
      return;
    }

    var sheet = SpreadsheetApp.getActive().getSheetByName(CNB.SHEETS.SCHEDULE);
    if (!sheet) {
      cnbAudit_('PULL', '', 'Missing tab: ' + CNB.SHEETS.SCHEDULE, 'FAILED');
      return;
    }

    cnbEnsureScheduleHeaders_(sheet);
    var last = sheet.getLastRow();
    if (last > 1) {
      var numDataRows = last - 1;
      sheet.getRange(2, 1, numDataRows, CNB_SCHEDULE_HEADERS.length).clearContent();
    }

    var pulledAt = new Date();
    var out = [];
    rows.forEach(function(r) {
      out.push([
        pulledAt,
        r.email,
        r.displayName || '',
        r.agentId,
        r.typeName,
        r.start,
        r.end,
        r.activityId
      ]);
    });

    if (out.length) {
      sheet.getRange(2, 1, out.length, CNB_SCHEDULE_HEADERS.length).setValues(out);
    }
    sheet.autoResizeColumns(1, CNB_SCHEDULE_HEADERS.length);
    cnbAudit_('PULL', dayKey, 'Rows written: ' + out.length + ' | window ' + pullHours + 'h', 'OK');
  } finally {
    lock.releaseLock();
  }
}

/*************************************************************
 * NOTIFICATIONS — every 5 minutes (trigger); one Slack per Event Key ever logged SENT
 *************************************************************/
function crProcessClockNotifications() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var cfg = cnbGetBotConfig_();
    var tz = String(cfg.TIMEZONE || 'America/Chicago').trim() || 'America/Chicago';
    var token = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
    if (!token) {
      cnbAudit_('NOTIFY', '', 'SLACK_BOT_TOKEN missing', 'WARN');
      return;
    }

    var acts = cnbReadSchedulePullAsActivities_();
    if (!acts.length) return;

    var rosterFilter = cnbParseRosterFilter_(cfg.ROSTER_EMAILS);
    var productive = cnbParsePipeList_(cfg.CR_PRODUCTIVE_ACTIVITY_NAMES, CNB_DEFAULT_PRODUCTIVE);
    var mealNames = cnbParsePipeList_(cfg.CR_MEAL_ACTIVITY_NAMES, CNB_DEFAULT_MEAL);

    var leadStart = cnbNum_(cfg.MINUTES_BEFORE_SHIFT_START, 5);
    var leadMeal = cnbNum_(cfg.MINUTES_BEFORE_MEAL, 5);
    var leadEnd = cnbNum_(cfg.MINUTES_BEFORE_SHIFT_END, 10);

    var doStart = cnbConfigBool_(cfg.NOTIFY_SHIFT_START, true);
    var doMeal = cnbConfigBool_(cfg.NOTIFY_MEAL, true);
    var doEnd = cnbConfigBool_(cfg.NOTIFY_SHIFT_END, true);

    var now = new Date();
    var dayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var byEmail = cnbGroupActivitiesByEmail_(acts, productive, mealNames, rosterFilter, tz, dayKey);
    var sentKeys = cnbLoadSentEventKeys_();

    Object.keys(byEmail).forEach(function(email) {
      var pack = byEmail[email];
      var displayName = pack.displayName || email;

      if (doStart && pack.firstProdStart) {
        cnbTrySendOne_({
          eventKey: dayKey + '|' + email + '|SHIFT_START',
          idealFireMs: pack.firstProdStart.getTime() - leadStart * 60 * 1000,
          anchorEndMs: pack.firstProdStart.getTime(),
          email: email,
          message: cnbMsgShiftStart_(displayName, pack.firstProdStart, tz),
          sentKeys: sentKeys,
          token: token
        });
      }

      if (doMeal) {
        pack.mealStarts.forEach(function(ms) {
          cnbTrySendOne_({
            eventKey: dayKey + '|' + email + '|MEAL|' + ms.getTime(),
            idealFireMs: ms.getTime() - leadMeal * 60 * 1000,
            anchorEndMs: ms.getTime(),
            email: email,
            message: cnbMsgMeal_(displayName, ms, tz),
            sentKeys: sentKeys,
            token: token
          });
        });
      }

      if (doEnd && pack.lastProdEnd) {
        cnbTrySendOne_({
          eventKey: dayKey + '|' + email + '|SHIFT_END',
          idealFireMs: pack.lastProdEnd.getTime() - leadEnd * 60 * 1000,
          anchorEndMs: pack.lastProdEnd.getTime(),
          email: email,
          message: cnbMsgShiftEnd_(displayName, pack.lastProdEnd, tz),
          sentKeys: sentKeys,
          token: token
        });
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Fire once: now >= idealFire, and anchor not already passed (no late clock-in spam),
 * and Event Key not in Audit as sent.
 */
function cnbTrySendOne_(o) {
  var now = new Date().getTime();
  if (o.sentKeys.has(o.eventKey)) return;
  if (now < o.idealFireMs) return;
  if (now > o.anchorEndMs) return;

  var userId = cnbGetSlackUserId_(o.email);
  if (!userId) {
    cnbAuditAppendRow_(o.eventKey, '—', o.email, 'No Slack user for ' + o.email, 'SKIPPED');
    o.sentKeys.add(o.eventKey);
    return;
  }

  try {
    cnbSendSlackDm_(userId, o.message, o.token);
    cnbAuditAppendRow_(o.eventKey, o.eventKey.split('|')[2] || '—', o.email, 'DM sent', 'SENT');
    o.sentKeys.add(o.eventKey);
  } catch (err) {
    cnbAuditAppendRow_(o.eventKey, o.eventKey.split('|')[2] || '—', o.email, String(err), 'FAILED');
  }
}

/*************************************************************
 * CONFIG — "Clock Notifications Bot" tab: Key (A) | Value (B) | Notes (C)
 *************************************************************/
function cnbGetBotConfig_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CNB.SHEETS.BOT);
  var out = {};
  if (!sheet) return out;
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var key = String(values[r][0] || '').trim();
    if (!key || key.toLowerCase() === 'key') continue;
    out[key] = values[r][1];
  }
  return out;
}

/** Seed row 1 + default keys if A1 is not "Key", or header exists but body never wrote (failed seed). */
function crSeedClockNotificationsBotTab() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CNB.SHEETS.BOT);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Missing tab: ' + CNB.SHEETS.BOT);
    return;
  }
  var a1 = String(sheet.getRange(1, 1).getValue() || '').trim().toLowerCase();
  var a2 = String(sheet.getRange(2, 1).getValue() || '').trim();
  var rows = [
    ['TIMEZONE', 'America/Chicago', 'Calendar day + reminder text'],
    ['MINUTES_BEFORE_SHIFT_START', 5, 'Slack this many minutes before first productive block (align with 5m trigger)'],
    ['MINUTES_BEFORE_MEAL', 5, 'Before each scheduled meal/lunch block'],
    ['MINUTES_BEFORE_SHIFT_END', 10, 'Before last productive block ends'],
    ['NOTIFY_SHIFT_START', 'TRUE', 'Set FALSE to disable shift-start pings'],
    ['NOTIFY_MEAL', 'TRUE', 'Set FALSE to disable meal pings'],
    ['NOTIFY_SHIFT_END', 'TRUE', 'Set FALSE to disable shift-end pings'],
    ['SCHEDULE_PULL_HOURS', 36, 'How many hours from local midnight to fetch (12–72)'],
    ['ROSTER_EMAILS', '', 'Optional: pipe | separated emails; blank = all in Schedule Pull'],
    ['CR_PRODUCTIVE_ACTIVITY_NAMES', 'phone|chat|sms', 'Assembled type substring match (lowercase)'],
    ['CR_MEAL_ACTIVITY_NAMES', 'meal|lunch|rest break', 'Meal type substring match']
  ];
  if (a1 !== 'key') {
    sheet.clear();
    sheet.getRange(1, 1, 1, 3).setValues([['Key', 'Value', 'Notes']]).setFontWeight('bold');
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 3).setBackground('#1565c0').setFontColor('#ffffff');
    sheet.autoResizeColumns(1, 3);
  } else if (!a2) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 3).setBackground('#1565c0').setFontColor('#ffffff');
    sheet.autoResizeColumns(1, 3);
  }
  SpreadsheetApp.getUi().alert('Clock Notifications Bot tab is ready. Edit the Value column as needed.');
}

/*************************************************************
 * SCHEDULE PULL tab → activity objects
 *************************************************************/
function cnbEnsureScheduleHeaders_(sheet) {
  var h = sheet.getRange(1, 1, 1, CNB_SCHEDULE_HEADERS.length).getValues()[0];
  var ok = h.length >= CNB_SCHEDULE_HEADERS.length;
  if (ok) {
    for (var i = 0; i < CNB_SCHEDULE_HEADERS.length; i++) {
      if (String(h[i] || '').trim() !== CNB_SCHEDULE_HEADERS[i]) { ok = false; break; }
    }
  }
  if (!ok) {
    sheet.getRange(1, 1, 1, CNB_SCHEDULE_HEADERS.length)
      .setValues([CNB_SCHEDULE_HEADERS])
      .setFontWeight('bold');
  }
}

function cnbReadSchedulePullAsActivities_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CNB.SHEETS.SCHEDULE);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var iEmail = headers.indexOf('Email');
  var iName = headers.indexOf('Name');
  var iType = headers.indexOf('Activity Type');
  var iStart = headers.indexOf('Start');
  var iEnd = headers.indexOf('End');
  var iAgent = headers.indexOf('Agent ID');
  var iActId = headers.indexOf('Activity Id');
  if (iEmail < 0 || iType < 0 || iStart < 0 || iEnd < 0) return [];

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var email = String(values[r][iEmail] || '').trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) continue;
    var s = values[r][iStart];
    var e = values[r][iEnd];
    var ds = s instanceof Date ? s : new Date(s);
    var de = e instanceof Date ? e : new Date(e);
    if (!ds || !de || isNaN(ds.getTime()) || isNaN(de.getTime())) continue;
    out.push({
      email: email,
      displayName: iName >= 0 ? String(values[r][iName] || '').trim() : '',
      agentId: iAgent >= 0 ? String(values[r][iAgent] || '').trim() : '',
      typeName: String(values[r][iType] || '').toLowerCase().trim(),
      start: ds,
      end: de,
      activityId: iActId >= 0 ? String(values[r][iActId] || '').trim() : ''
    });
  }
  return out;
}

/*************************************************************
 * ASSEMBLED API
 *************************************************************/
function cnbFetchActivitiesWindow_(startSec, endSec) {
  var apiKey = cnbGetApiKey_();
  var url = CNB.API_BASE + '/activities'
    + '?start_time=' + encodeURIComponent(String(startSec))
    + '&end_time='   + encodeURIComponent(String(endSec))
    + '&include_agents=true'
    + '&include_activity_types=true';

  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: cnbAuthHeaders_(apiKey),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Assembled /activities ' + code + ': ' + text.substring(0, 200));
  }

  var data = JSON.parse(text);
  var activities = data.activities || {};
  var agents = data.agents || {};
  var activityTypes = data.activity_types || {};

  var typeNameMap = {};
  Object.keys(activityTypes).forEach(function(id) {
    typeNameMap[id] = String(activityTypes[id].name || '').toLowerCase().trim();
  });

  var actList = Array.isArray(activities)
    ? activities
    : Object.keys(activities).map(function(k) {
        var a = activities[k];
        if (!a.id) a.id = k;
        return a;
      });

  var rows = [];
  actList.forEach(function(act) {
    var typeName = typeNameMap[act.type_id] || '';
    var startTime = act.start_time ? new Date(act.start_time * 1000) : null;
    var endTime = act.end_time ? new Date(act.end_time * 1000) : null;
    if (!startTime || !endTime || isNaN(startTime.getTime()) || isNaN(endTime.getTime())) return;
    var agentId = String(act.agent_id || '').trim();
    var agent = agents[agentId] || {};
    var email = String(agent.email || agent.primary_email || '').trim().toLowerCase();
    if (!email) return;
    var nm = String(agent.name || agent.full_name || agent.display_name || '').trim();
    rows.push({
      email: email,
      displayName: nm,
      agentId: agentId,
      typeName: typeName,
      start: startTime,
      end: endTime,
      activityId: String(act.id || '').trim()
    });
  });
  return rows;
}

function cnbGroupActivitiesByEmail_(rows, productiveList, mealList, rosterFilter, tz, dayKey) {
  var out = {};
  rows.forEach(function(row) {
    if (rosterFilter && !rosterFilter.has(row.email)) return;

    if (!out[row.email]) {
      out[row.email] = {
        displayName: row.displayName,
        firstProdStart: null,
        lastProdEnd: null,
        mealStarts: []
      };
    }
    var pack = out[row.email];
    if (row.displayName) pack.displayName = row.displayName;
    var t = row.typeName;

    if (cnbTypeMatches_(t, productiveList)) {
      if (cnbCalendarDayKey_(row.start, tz) === dayKey) {
        if (!pack.firstProdStart || row.start < pack.firstProdStart) pack.firstProdStart = row.start;
      }
      if (cnbCalendarDayKey_(row.end, tz) === dayKey) {
        if (!pack.lastProdEnd || row.end > pack.lastProdEnd) pack.lastProdEnd = row.end;
      }
    }
    if (cnbTypeMatches_(t, mealList) && cnbCalendarDayKey_(row.start, tz) === dayKey) {
      pack.mealStarts.push(row.start);
    }
  });

  Object.keys(out).forEach(function(email) {
    out[email].mealStarts.sort(function(a, b) { return a - b; });
  });
  return out;
}

function cnbTypeMatches_(typeNameLower, list) {
  var t = String(typeNameLower || '').trim();
  for (var i = 0; i < list.length; i++) {
    var needle = String(list[i] || '').trim().toLowerCase();
    if (!needle) continue;
    if (t.indexOf(needle) !== -1) return true;
  }
  return false;
}

function cnbParseRosterFilter_(cell) {
  var s = String(cell || '').trim();
  if (!s) return null;
  var set = new Set();
  s.split('|').forEach(function(x) {
    var e = String(x || '').trim().toLowerCase();
    if (e && e.indexOf('@') !== -1) set.add(e);
  });
  return set.size ? set : null;
}

function cnbParsePipeList_(cell, defaults) {
  var s = String(cell || '').trim();
  if (!s) return defaults.slice();
  return s.split('|').map(function(x) { return x.trim().toLowerCase(); }).filter(Boolean);
}

/*************************************************************
 * AUDIT — dedupe by Event Key (column B); SENT / SKIPPED block resend
 *************************************************************/
/** Only writes headers on a blank tab — never clears an existing Audit sheet. */
function cnbEnsureAuditHeaders_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.getRange(1, 1, 1, 6).setValues([[
    'Timestamp', 'Event Key', 'Kind', 'Email', 'Details', 'Result'
  ]]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 6).setBackground('#37474f').setFontColor('#ffffff');
}

function cnbAuditHeaderMap_(sheet) {
  var lastCol = Math.max(6, sheet.getLastColumn());
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var norm = headers.map(function(h) { return String(h || '').trim().toLowerCase(); });
  function idx(name) {
    var i = norm.indexOf(name);
    return i >= 0 ? i : -1;
  }
  return {
    'timestamp': idx('timestamp'),
    'event key': idx('event key'),
    'kind': idx('kind'),
    'email': idx('email'),
    'details': idx('details'),
    'result': idx('result')
  };
}

function cnbLoadSentEventKeys_() {
  var set = new Set();
  var sheet = SpreadsheetApp.getActive().getSheetByName(CNB.SHEETS.AUDIT);
  if (!sheet || sheet.getLastRow() < 2) return set;

  var map = cnbAuditHeaderMap_(sheet);
  var iKey = map['event key'] >= 0 ? map['event key'] : 1;
  var iRes = map.result >= 0 ? map.result : 5;

  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var res = String(values[r][iRes] || '').trim().toUpperCase();
    if (res !== 'SENT' && res !== 'SKIPPED') continue;
    var k = String(values[r][iKey] || '').trim();
    if (k) set.add(k);
  }
  return set;
}

function cnbAuditAppendRow_(eventKey, kind, email, details, result) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CNB.SHEETS.AUDIT);
  if (!sheet) return;
  cnbEnsureAuditHeaders_(sheet);
  var map = cnbAuditHeaderMap_(sheet);
  var lastCol = sheet.getLastColumn();
  if (lastCol < 6) lastCol = 6;
  var row = new Array(lastCol);
  for (var c = 0; c < row.length; c++) row[c] = '';
  function put(name, val, fallbackCol) {
    var i = map[name];
    if (typeof i !== 'number' || i < 0) i = fallbackCol;
    if (i < row.length) row[i] = val;
  }
  put('timestamp', new Date(), 0);
  put('event key', eventKey, 1);
  put('kind', kind, 2);
  put('email', email, 3);
  put('details', details, 4);
  put('result', result, 5);
  sheet.appendRow(row);
}

function cnbAudit_(event, ref, details, result) {
  cnbAuditAppendRow_(ref, event, '', details, result);
}

/*************************************************************
 * SLACK
 *************************************************************/
function cnbGetSlackUserId_(aliasOrEmail) {
  var email = String(aliasOrEmail || '').trim().toLowerCase();
  if (!email) return null;
  if (email.indexOf('@') === -1) email = email + '@varsitytutors.com';
  try {
    var token = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
    if (!token) return null;
    var resp = UrlFetchApp.fetch(
      'https://slack.com/api/users.lookupByEmail?email=' + encodeURIComponent(email),
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );
    var data = JSON.parse(resp.getContentText());
    if (data.ok) return data.user.id;
  } catch (e) { /* ignore */ }
  return null;
}

function cnbSendSlackDm_(userId, message, token) {
  var openRes = UrlFetchApp.fetch('https://slack.com/api/conversations.open', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ users: userId }),
    muteHttpExceptions: true
  });
  var openData = JSON.parse(openRes.getContentText());
  if (!openData.ok) throw new Error('conversations.open: ' + openData.error);

  var msgRes = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ channel: openData.channel.id, text: message }),
    muteHttpExceptions: true
  });
  var msgData = JSON.parse(msgRes.getContentText());
  if (!msgData.ok) throw new Error('chat.postMessage: ' + msgData.error);
}

function cnbMsgShiftStart_(name, when, tz) {
  var t = Utilities.formatDate(when, tz, 'h:mm a');
  return '*Clock-in reminder*\nHi ' + name + ', your shift is scheduled to start at *' + t + '* (' + tz + '). Please remember to clock in in Paylocity.';
}

function cnbMsgMeal_(name, when, tz) {
  var t = Utilities.formatDate(when, tz, 'h:mm a');
  return '*Meal reminder*\nHi ' + name + ', meal is scheduled at *' + t + '* (' + tz + '). Please switch to *meal* in Assembled before the break.';
}

function cnbMsgShiftEnd_(name, when, tz) {
  var t = Utilities.formatDate(when, tz, 'h:mm a');
  return '*Clock-out reminder*\nHi ' + name + ', your shift is scheduled to end at *' + t + '* (' + tz + '). Please remember to clock out in Paylocity.';
}

/*************************************************************
 * TRIGGERS
 *************************************************************/
function crInstallClockNotificationTriggers() {
  crRemoveClockNotificationTriggers();

  ScriptApp.newTrigger(CNB.TRIGGER_PULL)
    .timeBased()
    .everyHours(2)
    .create();

  ScriptApp.newTrigger(CNB.TRIGGER_NOTIFY)
    .timeBased()
    .everyMinutes(5)
    .create();

  cnbAudit_('TRIGGER', '', 'Installed: every 2h ' + CNB.TRIGGER_PULL + ', every 5m ' + CNB.TRIGGER_NOTIFY, 'OK');
  try {
    SpreadsheetApp.getUi().alert(
      'Installed:\n• Schedule pull every 2 hours\n• Notifications every 5 minutes\n\nRun “Ensure bot tab layout” if the bot tab still needs default keys.'
    );
  } catch (e) { /* headless */ }
}

function crRemoveClockNotificationTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var n = 0;
  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === CNB.TRIGGER_PULL || fn === CNB.TRIGGER_NOTIFY) {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  cnbAudit_('TRIGGER', '', 'Removed ' + n + ' trigger(s)', 'OK');
  try {
    SpreadsheetApp.getUi().alert('Removed ' + n + ' Clock Notification trigger(s).');
  } catch (e) { /* headless */ }
}

/*************************************************************
 * UTIL
 *************************************************************/
function cnbGetApiKey_() {
  var key = (PropertiesService.getScriptProperties().getProperty('ASSEMBLED_API_KEY') || '').trim();
  if (!key) throw new Error('Script Property ASSEMBLED_API_KEY is not set.');
  return key;
}

function cnbAuthHeaders_(apiKey) {
  return {
    Authorization: 'Basic ' + Utilities.base64Encode(apiKey + ':'),
    'Content-Type': 'application/json'
  };
}

function cnbParseInTz_(isoLocal, tz) {
  var d = Utilities.parseDate(isoLocal, tz, "yyyy-MM-dd'T'HH:mm:ss");
  return (!d || isNaN(d.getTime())) ? null : d;
}

function cnbCalendarDayKey_(date, tz) {
  if (!date || isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd');
}

function cnbNum_(cell, defaultVal) {
  var n = Number(cell);
  if (!isFinite(n) || n < 0) return defaultVal;
  return n;
}

function cnbConfigBool_(value, defaultVal) {
  if (value === undefined || value === null || String(value).trim() === '') return defaultVal;
  return String(value).trim().toUpperCase() === 'TRUE';
}
