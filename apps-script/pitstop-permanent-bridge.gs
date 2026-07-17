/************************************************************
 * Pitstop ↔ Permanent Schedule Publisher bridge
 *
 * Deploy from the SAME Apps Script project as the Permanent Schedule Publisher.
 * Netlify env: PITSTOP_PERMANENT_LOGIC_URL = web app /exec URL
 *
 * evaluate: validates pattern, always routes to WFM review (matches sheet workflow)
 * commit:   appends Schedule Changes row with Apply?=TRUE and runs apply for one row
 ************************************************************/

function doPost(e) {
  return pitstopPermDoPost_(e);
}

function pitstopPermDoPost_(e) {
  try {
    pitstopPermVerifySecret_(e);
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    var action = String(body.action || '').trim();
    if (action === 'evaluate') return pitstopPermJson_(pitstopPermEvaluate_(body.payload || {}));
    if (action === 'commit') return pitstopPermJson_(pitstopPermCommit_(body));
    return pitstopPermJson_({ error: 'Unknown action' });
  } catch (err) {
    return pitstopPermJson_({ error: String(err && err.message ? err.message : err) });
  }
}

function pitstopPermVerifySecret_(e) {
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

function pitstopPermJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function pitstopPermEvaluate_(payload) {
  var slackId = String(payload.consultantSlackId || '').trim();
  var startDate = payload.startDate;
  var pattern = payload.pattern || {};
  var audit = [];

  if (!slackId || !startDate) {
    return {
      decision: 'review',
      reasoning: 'Missing consultant Slack ID or start date.',
      autoCommit: false,
      sheetAudit: audit,
      source: 'permanent-schedule-publisher'
    };
  }

  try {
    normalizeSlackId_(slackId);
    var row = {
      repSlackId: normalizeSlackId_(slackId),
      repEmail: slackIdToEmail_(normalizeSlackId_(slackId)),
      startDate: coerceDate_(startDate),
      weeks: payload.weeks || CFG.DEFAULT_WEEKS,
      pattern: pattern
    };
    if (!row.startDate) throw new Error('Invalid start date');
    var typeIds = getMappedActivityTypeIds_();
    var windowEnd = addDays_(row.startDate, (row.weeks || CFG.DEFAULT_WEEKS) * 7);
    buildSegmentsFromPattern_(row, typeIds, windowEnd);
    audit.push('Pattern parses OK; ' + row.weeks + ' weeks from ' + formatDate_(row.startDate, 'yyyy-MM-dd'));
  } catch (e) {
    return {
      decision: 'deny',
      reasoning: 'Invalid schedule pattern: ' + String(e.message || e),
      autoCommit: false,
      sheetAudit: audit,
      source: 'permanent-schedule-publisher'
    };
  }

  return {
    decision: 'review',
    reasoning: 'Permanent schedule change logged for WFM approval — same rules as Schedule Changes tab before Apply.',
    autoCommit: false,
    sheetAudit: audit,
    source: 'permanent-schedule-publisher'
  };
}

function pitstopPermCommit_(body) {
  var payload = body.payload || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllTabs_();
  var input = ss.getSheetByName(CFG.TAB_INPUT);
  var slackId = normalizeSlackId_(String(payload.consultantSlackId || ''));
  var pattern = payload.pattern || {};
  var weeks = payload.weeks || CFG.DEFAULT_WEEKS;

  input.appendRow([
    slackId,
    coerceDate_(payload.startDate),
    weeks,
    pattern.Mon || '',
    pattern.Tue || '',
    pattern.Wed || '',
    pattern.Thu || '',
    pattern.Fri || '',
    pattern.Sat || '',
    pattern.Sun || '',
    true
  ]);

  var rows = readInputRows_(input);
  var last = rows[rows.length - 1];
  if (!last) throw new Error('Could not read appended row');

  menuApply_();

  return {
    ok: true,
    message: 'Permanent schedule apply triggered for ' + last.repEmail + ' (Schedule Changes)',
    details: { pitstopRequestId: body.requestId }
  };
}
