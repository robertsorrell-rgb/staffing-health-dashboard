/*************************************************************
 * TARGETED VTO BOT — WEEKLY SUMMARY TAB  v1.4.0
 * Add this file to the same Apps Script project as targeted-vto-bot.gs
 *   so rvtoGetConfig_ / rvtoLoadPgcMap_ / rvtoNormalizeName_ are reused (v1.6.4+ PGC).
 *
 * Writes a VTO_Weekly_Summary tab with two time windows:
 *   - This Week  (Mon–Sun of current week)
 *   - This Month (1st through end of today)
 *
 * "Approved" = Status is COMMITTED or ACCEPTED
 * Hourly rate read live from VTO_Summary!B2 (falls back to $25)
 *
 * CHANGELOG v1.4.0
 *   - REMOVED: Upcoming week-block campaign tracker table (per-campaign × queue grid).
 *   - NEW: Two-month **approved VTO hours** wall calendars (current month + next, Chicago).
 *     Each day shows total committed/accepted hours on that **VTO calendar day**; **hover**
 *     (cell Note) lists hours by sales group (Queue). Week-block hours split across Days:
 *     in Notes or across Date range when no day list.
 *   - FIX: Month calendar `getRange` used (row,col,endRow,endCol); Apps Script expects
 *     (row,col,numRows,numColumns) — was throwing "data has 1 but the range has 30".
 *   - UX: Calendar cells show **day of month** (Chicago) + approved hours on a second line;
 *     text format, wrap, centered; padding days blank. Clarifies true wall-calendar layout.
 *   - CHORE: Removed temporary `[RVTO_WS_DEBUG]` / build-tag execution logs used while validating calendars.
 * CHANGELOG v1.3.0
 *   - NEW: Sent-at calendar digest for This Week — Mon–Sun activity by outcome + SPARKLINE.
 *   - FIX: Week-block detection — Offer ID RVTO_WK and/or Notes WEEK_VTO (single-day Date).
 *
 * CHANGELOG v1.2.4
 *   - Week-block "living tracker": all week-block rows whose campaign Date range **ends on or after today**
 *     (Chicago), every Sent At — not limited to offers sent this calendar week/month.
 *   - Subtotal row after each campaign week (all queues combined); grand total at bottom.
 *   - Single tracker under THIS WEEK; removed duplicate week-block table under THIS MONTH.
 *
 * CHANGELOG v1.2.3
 *   - Week-block campaigns table: add TOTAL row summing offers/approved/declined/expired/open/hours
 *     and overall accept % across all campaign×queue rows in the window.
 *
 * CHANGELOG v1.2.2
 *   - Week-block shift hours: fixed at 8 in script (no sheet row; no Config read for summary math).
 *   - Section order (each window): stat band → business approved KPI row → IMPACT → week-block campaigns
 *     → PGC stats → manager / queue / top reps.
 *   - Stat band: counts written as text so Sheets does not auto-format (e.g. Expired as currency).
 *
 * CHANGELOG v1.2.1
 *   - Fix rvtoWS_writeWeekBlockCampaignsTable_: Sheet.getRange(row, col, numRows, numColumns) uses
 *     height/width, not end row/column. getRange(row,1,row,9) was numRows=row (~12 rows) vs 1 row of data.
 *
 * CHANGELOG v1.2.0
 *   - Week-block campaign table (per window): groups week-block rows (Date contains " to ")
 *     with Sent At in the same This Week / This Month window by campaign date range + Queue (SG).
 *     Columns: offers, approved, declined, expired, open/misc, approved hours (same calc as stat band),
 *     accept rate. Sheet layout NUM_COLS widened to 9 for consistent merges.
 *
 * CHANGELOG v1.1.0
 *   - Week-block VTO support (v1.7.0+):
 *     Week-block offers write Date as "2026-06-01 to 2026-06-07" and leave
 *     Start/End blank. The old calcHours_ would silently return 0 for every
 *     week-block row, understating approved hours and all dollar figures.
 *     Fix: rvtoWS_calcHours_() detects the range date string and parses
 *     the scheduled day list from the Notes column ("WEEK_VTO | Days: ...").
 *     Hours = number of scheduled days × WEEK_VTO_ASSUMED_SHIFT_HOURS
 *     (Config tab row, default 8). Falls back to 8 if not set.
 *     rvtoWS_aggregate_() now passes the Notes column (col 22) to calcHours_.
 *     A WEEK_VTO offer count column is added to the stat band.
 *     Week-block offers are correctly bucketed in queue/manager/rep tables.
 *
 * Menu: merge "Refresh Weekly Summary" into the existing onOpen, or use
 *   addRvtoWeeklySummaryMenuItem() (full menu) once.
 *
 * Trigger: setupRvtoWeeklySummaryTrigger() → every 30 minutes
 *************************************************************/

/*************************************************************
 * CONFIG
 *************************************************************/
var RVTO_WS_CFG = {
  OFFERS_TAB:            'Offers',
  SUMMARY_TAB:           'VTO_Weekly_Summary',
  RATE_TAB:              'VTO_Summary',
  RATE_CELL:             'B2',
  FALLBACK_RATE:         25,
  FALLBACK_SHIFT_HOURS:  8,    // v1.2.2: week-block hour math always uses this value (8) in this summary
  TIMEZONE:              'America/Chicago',
  APPROVED_STATUSES:     ['COMMITTED', 'ACCEPTED'],
  /** Same prefix as main bot RVTO_APP.WEEK_BLOCK_PREFIX */
  WEEK_BLOCK_ID_PREFIX: 'RVTO_WK',
};

/*************************************************************
 * COLUMN INDICES (0-based) from rvtoAppendOfferRow_ / rvtoAppendWeekBlockOfferRow_
 *************************************************************/
var RVTO_WS_COL = {
  OFFER_ID: 0,
  DATE:     2,
  START:    3,
  END:      4,
  NAME:     5,
  QUEUE:    8,
  MANAGER:  9,
  SENT_AT:  10,
  STATUS:   13,
  NOTES:    22,
};

/*************************************************************
 * COLORS
 *************************************************************/
var RVTO_WS_COLORS = {
  headerDark:  '#1F4E78',
  weekBg:      '#1a5276',
  monthBg:     '#1a6b3a',
  pgcBg:       '#1a3d6b',
  sectionBg:   '#2e4053',
  subHeader:   '#2471a3',
  altRow:      '#f8f9fa',
  white:       '#ffffff',
  statLabel:   '#d5e8f4',
  statValue:   '#ffffff',
  green:       '#b7e1cd',
  greenDark:   '#0d652d',
  amber:       '#ffd966',
  amberDark:   '#7a4f00',
  tableHeader: '#37474f',
  calAccent:   '#1abc9c',
};

/**
 * One row, columns c1..c2 (inclusive).
 */
function rvtoWS_rangeOneRow_(sh, r, c1, c2) {
  var w = c2 - c1 + 1;
  if (w < 1) w = 1;
  return sh.getRange(r, c1).offset(0, 0, 1, w);
}

/**
 * Unmerge the whole used grid before rebuild.
 */
function rvtoWS_unmergeEntireSheet_(sh) {
  var mR = Math.min(sh.getMaxRows(), 2000);
  var mC = Math.min(sh.getMaxColumns(), 100);
  if (mR < 1 || mC < 1) return;
  sh.getRange(1, 1, mR, mC).breakApart();
}

/** A1 column letter for 1-based column index 1–26 */
function rvtoWS_colLetter1_(n) {
  var s = '';
  var k = Math.floor(Number(n)) || 0;
  while (k > 0) {
    var r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s || 'A';
}

/*************************************************************
 * PGC — same behavior as main bot; works standalone with fallbacks
 *************************************************************/
function rvtoWS_loadPgcMap_() {
  if (typeof rvtoGetConfig_ === 'function' && typeof rvtoLoadPgcMap_ === 'function') {
    return rvtoLoadPgcMap_(rvtoGetConfig_());
  }
  return {};
}

function rvtoWS_normName_(name) {
  if (typeof rvtoNormalizeName_ === 'function') {
    return rvtoNormalizeName_(name);
  }
  return String(name || '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
}

function rvtoWS_median_(arr) {
  if (!arr || !arr.length) return null;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var n = s.length;
  var m = Math.floor(n / 2);
  if (n % 2) return s[m];
  return (s[m - 1] + s[m]) / 2;
}

function rvtoWS_mean_(arr) {
  if (!arr || !arr.length) return null;
  var t = 0;
  for (var i = 0; i < arr.length; i++) t += arr[i];
  return t / arr.length;
}

function rvtoWS_p25_(arr) {
  if (!arr || !arr.length) return null;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var i = Math.max(0, Math.floor(0.25 * (s.length - 1)));
  return s[i];
}

function rvtoWS_pgcForName_(pgcMap, name) {
  if (!pgcMap || !name) return null;
  var k = rvtoWS_normName_(name);
  if (!Object.prototype.hasOwnProperty.call(pgcMap, k) || pgcMap[k] === null || pgcMap[k] === undefined) {
    return null;
  }
  var v = Number(pgcMap[k]);
  return isFinite(v) ? v : null;
}

function rvtoWS_pgcReleaseNotesLines_() {
  return [
    'v1.6.4 PGC: Offers prioritize reps with no PGC row, then lowest PGC (Config USE_PGC_PRIORITY; Script Property PGC_SPREADSHEET_ID).',
    'v1.6.5 Audit: PGC_ORDER rows in Audit tab + Config PGC_DEBUG_TOP_N to verify email order (no_row vs numeric PGC).',
  ];
}

/*************************************************************
 * WEEK-BLOCK DETECTION (v1.3.0 — aligned with main bot)
 *************************************************************/

/**
 * Date cell is legacy week-block range string (e.g. "2026-06-01 to 2026-06-07" or same-day range).
 */
function rvtoWS_isWeekBlock_(dateVal) {
  if (!dateVal) return false;
  if (dateVal instanceof Date) return false;
  return String(dateVal).indexOf(' to ') !== -1;
}

/**
 * True for week-block / bundle / individual-day campaign rows (matches main bot dedup signals).
 */
function rvtoWS_isWeekBlockRow_(row, COL) {
  var id = String(row[COL.OFFER_ID] || '').trim();
  if (id.indexOf(RVTO_WS_CFG.WEEK_BLOCK_ID_PREFIX) === 0) return true;
  var notes = String(row[COL.NOTES] || '');
  if (notes.indexOf('WEEK_VTO') !== -1) return true;
  return rvtoWS_isWeekBlock_(row[COL.DATE]);
}

function rvtoWS_parseWeekBlockDays_(notesVal) {
  if (!notesVal) return [];
  var s = String(notesVal);
  var m = s.match(/Days:\s*([^\s|]+)/);
  if (!m) return [];
  return m[1].split(',').map(function(d) { return d.trim(); }).filter(Boolean);
}

function rvtoWS_getAssumedShiftHours_() {
  try {
    if (typeof rvtoGetConfig_ === 'function') {
      var cfg = rvtoGetConfig_();
      var v   = parseFloat(cfg.WEEK_VTO_ASSUMED_SHIFT_HOURS);
      if (!isNaN(v) && v > 0) return v;
    }
  } catch (e) { /* fall through */ }
  return RVTO_WS_CFG.FALLBACK_SHIFT_HOURS;
}

/*************************************************************
 * APPROVED HOURS — TWO-MONTH CALENDAR (v1.4.0)
 * Current month through end of next month (Chicago). Cell = approved hours that
 * VTO calendar day; setNote() = hours per queue (sales group), sorted high→low.
 *************************************************************/

function rvtoWS_pad2_(n) {
  return (Number(n) < 10 ? '0' : '') + Number(n);
}

/** First day of this calendar month → last day of next month (yyyy-MM-dd, Chicago). */
function rvtoWS_twoMonthInclusiveRange_(now, tz) {
  var y = parseInt(Utilities.formatDate(now, tz, 'yyyy'), 10);
  var mo = parseInt(Utilities.formatDate(now, tz, 'MM'), 10);
  var startYmd = y + '-' + rvtoWS_pad2_(mo) + '-01';
  var endMo = mo + 1;
  var endY = y;
  if (endMo > 12) {
    endMo = 1;
    endY++;
  }
  var lastD = new Date(endY, endMo, 0).getDate();
  var endYmd = endY + '-' + rvtoWS_pad2_(endMo) + '-' + rvtoWS_pad2_(lastD);
  return { startYmd: startYmd, endYmd: endYmd };
}

function rvtoWS_enumerateYmdInclusive_(startYmd, endYmd, tz) {
  var out = [];
  var d0 = Utilities.parseDate(startYmd + 'T12:00:00', tz, "yyyy-MM-dd'T'HH:mm:ss");
  var d1 = Utilities.parseDate(endYmd + 'T12:00:00', tz, "yyyy-MM-dd'T'HH:mm:ss");
  if (!d0 || !d1 || isNaN(d0.getTime()) || isNaN(d1.getTime())) return out;
  var cur = new Date(d0.getTime());
  var endT = d1.getTime();
  while (cur.getTime() <= endT) {
    out.push(Utilities.formatDate(cur, tz, 'yyyy-MM-dd'));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function rvtoWS_parseRangeInclusiveYmds_(dateVal, tz) {
  if (!rvtoWS_isWeekBlock_(dateVal)) return [];
  var parts = String(dateVal).split(' to ');
  if (parts.length !== 2) return [];
  var a = parts[0].trim();
  var b = parts[1].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return [];
  return rvtoWS_enumerateYmdInclusive_(a, b, tz);
}

/** Monday-start grid anchor (ISO weekday u: 1=Mon … 7=Sun in America/Chicago). */
function rvtoWS_firstMondayGrid_(firstOfMonthNoon, tz) {
  var ymd = Utilities.formatDate(firstOfMonthNoon, tz, 'yyyy-MM-dd');
  var noon = Utilities.parseDate(ymd + 'T12:00:00', tz, "yyyy-MM-dd'T'HH:mm:ss");
  if (!noon || isNaN(noon.getTime())) return rvtoWS_midnight_(new Date(firstOfMonthNoon.getTime()));
  var u = parseInt(Utilities.formatDate(noon, tz, 'u'), 10);
  if (isNaN(u) || u < 1 || u > 7) u = 1;
  var off = (u + 6) % 7;
  var cur = new Date(noon.getTime());
  cur.setDate(cur.getDate() - off);
  return rvtoWS_midnight_(cur);
}

function rvtoWS_noteForApprovedDay_(dayData) {
  if (!dayData || !dayData.byQueue) return '';
  var keys = [];
  for (var q in dayData.byQueue) {
    if (Object.prototype.hasOwnProperty.call(dayData.byQueue, q)) keys.push(q);
  }
  keys.sort(function(a, b) {
    var hb = Number(dayData.byQueue[b]) || 0;
    var ha = Number(dayData.byQueue[a]) || 0;
    if (hb !== ha) return hb - ha;
    return String(a).localeCompare(String(b));
  });
  var lines = [];
  for (var i = 0; i < keys.length; i++) {
    var qq = keys[i];
    lines.push(qq + ': ' + (Number(dayData.byQueue[qq]) || 0).toFixed(2) + 'h');
  }
  return lines.join('\n');
}

/**
 * Approved COMMITTED/ACCEPTED hours by VTO calendar day (Chicago ymd).
 * Week-block: per listed day in Notes, else each day in Date range, else single yyyy-MM-dd + WEEK_VTO.
 * Intraday: full row hours on Date.
 */
function rvtoWS_collectApprovedHoursByDay_(rows, rangeStartYmd, rangeEndYmd, tz, COL, assumedShiftHours) {
  assumedShiftHours = (assumedShiftHours > 0) ? assumedShiftHours : RVTO_WS_CFG.FALLBACK_SHIFT_HOURS;
  var approvedSet = {};
  RVTO_WS_CFG.APPROVED_STATUSES.forEach(function(s) { approvedSet[s] = true; });

  var dayMap = {};
  function ensure(ymd) {
    if (!dayMap[ymd]) dayMap[ymd] = { total: 0, byQueue: {} };
  }
  function addHours(ymd, queue, hrs) {
    if (ymd < rangeStartYmd || ymd > rangeEndYmd) return;
    if (!(Number(hrs) > 0)) return;
    ensure(ymd);
    dayMap[ymd].total += hrs;
    var q = String(queue || '').trim() || '(unknown)';
    dayMap[ymd].byQueue[q] = (dayMap[ymd].byQueue[q] || 0) + hrs;
  }

  rows.forEach(function(row) {
    var status = String(row[COL.STATUS] || '').trim().toUpperCase();
    if (!approvedSet[status]) return;
    var notes = String(row[COL.NOTES] || '');
    var dateVal = row[COL.DATE];
    var queue = row[COL.QUEUE];
    var isWkNotes = notes.indexOf('WEEK_VTO') !== -1;
    var per = assumedShiftHours;

    var listed = rvtoWS_parseWeekBlockDays_(notes);
    if (listed.length) {
      for (var li = 0; li < listed.length; li++) {
        var ymdL = listed[li];
        if (/^\d{4}-\d{2}-\d{2}$/.test(ymdL)) addHours(ymdL, queue, per);
      }
      return;
    }

    if (rvtoWS_isWeekBlock_(dateVal)) {
      var ymds = rvtoWS_parseRangeInclusiveYmds_(dateVal, tz);
      for (var ri = 0; ri < ymds.length; ri++) addHours(ymds[ri], queue, per);
      return;
    }

    if (isWkNotes) {
      var dOnly = dateVal instanceof Date
        ? Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd')
        : String(dateVal || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dOnly)) addHours(dOnly, queue, per);
      return;
    }

    var totalH = rvtoWS_calcHours_(dateVal, row[COL.START], row[COL.END], tz, notes, assumedShiftHours);
    var ymdInt = '';
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
      ymdInt = Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd');
    } else {
      var ds = String(dateVal || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) ymdInt = ds;
      else if (/^\d{4}-\d{2}-\d{2}/.test(ds)) ymdInt = ds.substring(0, 10);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymdInt)) return;
    addHours(ymdInt, queue, totalH);
  });

  return dayMap;
}

/** Compact hour label for calendar cell (e.g. 8, 7.5, 26.25). */
function rvtoWS_fmtHoursShort_(hrs) {
  var r = Math.round(Number(hrs) * 100) / 100;
  if (!isFinite(r) || r <= 0) return '';
  if (Math.abs(r - Math.round(r)) < 0.001) return String(Math.round(r));
  return String(r);
}

function rvtoWS_writeApprovedMonthCalendar_(sh, startRow, year, month1, dayMap, tz, numCols) {
  var monthStartStr = year + '-' + rvtoWS_pad2_(month1) + '-01';
  var lastD = new Date(year, month1, 0).getDate();
  var monthEndStr = year + '-' + rvtoWS_pad2_(month1) + '-' + rvtoWS_pad2_(lastD);

  var first = Utilities.parseDate(monthStartStr + 'T12:00:00', tz, "yyyy-MM-dd'T'HH:mm:ss");
  if (!first || isNaN(first.getTime())) first = new Date();

  var gridStart = rvtoWS_firstMondayGrid_(first, tz);

  var hdr = rvtoWS_rangeOneRow_(sh, startRow, 1, numCols);
  hdr.merge();
  hdr.setValue(
    '🗓 ' + Utilities.formatDate(first, tz, 'MMMM yyyy') +
      ' — each cell: day of month, then approved hours (' + tz + '). Same weekday column = different weeks. Hover for queue (SG) split.'
  )
    .setBackground(RVTO_WS_COLORS.calAccent)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('left');
  sh.setRowHeight(startRow, 24);
  startRow++;

  var dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var headRow = [''];
  for (var h = 0; h < 7; h++) headRow.push(dayLabels[h]);
  while (headRow.length < numCols) headRow.push('');
  sh.getRange(startRow, 1, 1, numCols).setValues([headRow])
    .setBackground(RVTO_WS_COLORS.tableHeader)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold');
  startRow++;

  var cur = new Date(gridStart.getTime());
  var gridTop = startRow;
  for (var gr = 0; gr < 6; gr++) {
    var values = [];
    for (var gc = 0; gc < 7; gc++) {
      var ymd = Utilities.formatDate(cur, tz, 'yyyy-MM-dd');
      var inMonth = (ymd >= monthStartStr && ymd <= monthEndStr);
      var dom = parseInt(ymd.substring(8, 10), 10);
      var val = '';
      if (inMonth) {
        var dm = dayMap[ymd];
        var hrs = dm && dm.total > 0.0005 ? Math.round(dm.total * 100) / 100 : 0;
        if (hrs > 0) {
          val = String(dom) + '\n' + rvtoWS_fmtHoursShort_(hrs) + 'h';
        } else {
          val = String(dom);
        }
      }
      values.push(val);
      cur.setDate(cur.getDate() + 1);
    }
    sh.getRange(gridTop + gr, 2, 1, 7).setValues([values]);
  }

  cur = new Date(gridStart.getTime());
  for (var gr2 = 0; gr2 < 6; gr2++) {
    for (var gc2 = 0; gc2 < 7; gc2++) {
      var ymd2 = Utilities.formatDate(cur, tz, 'yyyy-MM-dd');
      var inM = (ymd2 >= monthStartStr && ymd2 <= monthEndStr);
      var cell = sh.getRange(gridTop + gr2, 2 + gc2);
      if (!inM) {
        cell.setBackground('#eceff1').setFontColor('#90a4ae').setNote(null);
        cell.setNumberFormat('@');
      } else {
        cell.setBackground((gr2 % 2 === 0) ? RVTO_WS_COLORS.altRow : RVTO_WS_COLORS.white).setFontColor('#111111');
        var dm2 = dayMap[ymd2];
        var nt = (dm2 && dm2.total > 0) ? rvtoWS_noteForApprovedDay_(dm2) : '';
        if (nt) cell.setNote(nt);
        else cell.setNote(null);
        cell.setNumberFormat('@');
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  var gridRng = sh.getRange(gridTop, 2, 6, 7);
  gridRng.setFontSize(10);
  gridRng.setWrap(true);
  gridRng.setVerticalAlignment('middle');
  gridRng.setHorizontalAlignment('center');
  for (var rh = 0; rh < 6; rh++) sh.setRowHeight(gridTop + rh, 52);

  return gridTop + 6;
}

function rvtoWS_writeApprovedHoursTwoMonthCalendars_(sh, startRow, rows, now, tz, numCols, assumedShiftHours) {
  var rng = rvtoWS_twoMonthInclusiveRange_(now, tz);
  var dayMap = rvtoWS_collectApprovedHoursByDay_(rows, rng.startYmd, rng.endYmd, tz, RVTO_WS_COL, assumedShiftHours);

  var y = parseInt(Utilities.formatDate(now, tz, 'yyyy'), 10);
  var mo = parseInt(Utilities.formatDate(now, tz, 'MM'), 10);
  startRow = rvtoWS_writeApprovedMonthCalendar_(sh, startRow, y, mo, dayMap, tz, numCols);
  startRow++;
  var mo2 = mo + 1;
  var y2 = y;
  if (mo2 > 12) {
    mo2 = 1;
    y2++;
  }
  startRow = rvtoWS_writeApprovedMonthCalendar_(sh, startRow, y2, mo2, dayMap, tz, numCols);

  return startRow;
}

/*************************************************************
 * SENT-AT CALENDAR DIGEST (v1.3.0) — Mon–Sun, Chicago
 *************************************************************/

/**
 * @returns {{ label: string, ymd: string, sent: number, approved: number, declined: number, expired: number, open: number, wb: number, apprHrs: number }[]}
 */
function rvtoWS_aggregateSentByDay_(rows, weekStart, weekEnd, tz, COL, assumedShiftHours) {
  assumedShiftHours = (assumedShiftHours > 0) ? assumedShiftHours : RVTO_WS_CFG.FALLBACK_SHIFT_HOURS;
  var days = [];
  var cur = new Date(weekStart.getTime());
  while (cur < weekEnd) {
    days.push({
      ymd: Utilities.formatDate(cur, tz, 'yyyy-MM-dd'),
      label: Utilities.formatDate(cur, tz, 'EEE M/d'),
      sent: 0,
      approved: 0,
      declined: 0,
      expired: 0,
      open: 0,
      wb: 0,
      apprHrs: 0,
    });
    cur.setDate(cur.getDate() + 1);
  }
  var byYmd = {};
  for (var i = 0; i < days.length; i++) byYmd[days[i].ymd] = days[i];

  var approvedSet = {};
  RVTO_WS_CFG.APPROVED_STATUSES.forEach(function(s) { approvedSet[s] = true; });

  rows.forEach(function(row) {
    var sentAtRaw = row[COL.SENT_AT];
    var sentAt = (sentAtRaw instanceof Date) ? sentAtRaw : new Date(sentAtRaw);
    if (isNaN(sentAt.getTime())) return;
    if (sentAt < weekStart || sentAt >= weekEnd) return;
    var ymd = Utilities.formatDate(sentAt, tz, 'yyyy-MM-dd');
    var b = byYmd[ymd];
    if (!b) return;

    var status = String(row[COL.STATUS] || '').trim().toUpperCase();
    if (!status || status === 'SEND_FAILED') return;

    b.sent++;
    var notes = String(row[COL.NOTES] || '');
    if (rvtoWS_isWeekBlockRow_(row, COL)) b.wb++;

    var hrs = rvtoWS_calcHours_(row[COL.DATE], row[COL.START], row[COL.END], tz, notes, assumedShiftHours);
    if (approvedSet[status]) {
      b.approved++;
      b.apprHrs += hrs;
    } else if (status === 'DECLINED') {
      b.declined++;
    } else if (status === 'EXPIRED' || status === 'COMMIT_FAILED') {
      b.expired++;
    } else {
      b.open++;
    }
  });
  return days;
}

/**
 * Writes a compact grid: row labels + 7 day columns + week total + optional SPARKLINE.
 */
function rvtoWS_writeSentAtCalendarDigest_(sh, startRow, rows, weekStart, weekEnd, tz, assumedShiftHours, numCols) {
  var COL = RVTO_WS_COL;
  var days = rvtoWS_aggregateSentByDay_(rows, weekStart, weekEnd, tz, COL, assumedShiftHours);

  var hdr = rvtoWS_rangeOneRow_(sh, startRow, 1, numCols);
  hdr.merge();
  hdr.setValue('📊 Sent-at activity (Mon–Sun, ' + tz + ') — when the offer email/row was created, split by outcome')
    .setBackground(RVTO_WS_COLORS.calAccent)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('left');
  sh.setRowHeight(startRow, 26);
  startRow++;

  var heads = ['Metric'];
  for (var h = 0; h < days.length; h++) heads.push(days[h].label);
  heads.push('Week Σ');
  while (heads.length < numCols) heads.push('');
  sh.getRange(startRow, 1, 1, numCols).setValues([heads])
    .setBackground(RVTO_WS_COLORS.tableHeader)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold');
  startRow++;

  function sumField(key) {
    var t = 0;
    for (var z = 0; z < days.length; z++) t += Number(days[z][key]) || 0;
    return t;
  }

  var specs = [
    { label: 'Offers sent', key: 'sent', bold: true },
    { label: '… Approved (C/A)', key: 'approved', bold: false },
    { label: '… Declined', key: 'declined', bold: false },
    { label: '… Expired / fail', key: 'expired', bold: false },
    { label: '… Open / other', key: 'open', bold: false },
    { label: 'Week-block-style rows', key: 'wb', bold: false },
    { label: 'Approved hours', key: 'apprHrs', bold: true, num: true },
  ];

  var dataStartRow = startRow;
  for (var r = 0; r < specs.length; r++) {
    var sp = specs[r];
    var line = [sp.label];
    for (var c = 0; c < days.length; c++) {
      var v = days[c][sp.key];
      line.push(sp.num ? (Number(v) || 0).toFixed(2) : String(v));
    }
    line.push(sp.num ? sumField(sp.key).toFixed(2) : String(sumField(sp.key)));
    while (line.length < numCols) line.push('');
    sh.getRange(startRow, 1, 1, numCols).setValues([line])
      .setBackground(r % 2 === 0 ? RVTO_WS_COLORS.altRow : RVTO_WS_COLORS.white)
      .setFontWeight(sp.bold ? 'bold' : 'normal');
    startRow++;
  }

  var sparkRow = startRow;
  sh.getRange(sparkRow, 1).setValue('SPARKLINE (outcomes / day)').setFontWeight('bold').setBackground('#eafaf8');
  var rAppr = dataStartRow + 1;
  var rOpen = dataStartRow + 4;
  for (var u = 0; u < days.length; u++) {
    var col = 2 + u;
    var cLetter = rvtoWS_colLetter1_(col);
    var formula =
      '=IF(SUM(' + cLetter + rAppr + ':' + cLetter + rOpen + ')=0,"",SPARKLINE({' +
      cLetter + rAppr + ',' + cLetter + (rAppr + 1) + ',' + cLetter + (rAppr + 2) + ',' + cLetter + (rAppr + 3) +
      '},{"charttype","column"}))';
    sh.getRange(sparkRow, col).setFormula(formula).setBackground('#eafaf8');
  }
  if (numCols > 2 + days.length) {
    sh.getRange(sparkRow, 2 + days.length, sparkRow, numCols).merge();
    sh.getRange(sparkRow, 2 + days.length)
      .setValue('← column chart: approved, declined, expired, open (same order as rows above)')
      .setFontSize(9)
      .setFontColor('#555555')
      .setBackground('#eafaf8')
      .setWrap(true);
  }
  sh.setRowHeight(sparkRow, 72);
  startRow++;

  return startRow;
}

/*************************************************************
 * MAIN ENTRY
 *************************************************************/
function buildRvtoWeeklySummary() {
  var ss  = SpreadsheetApp.getActive();
  var tz  = RVTO_WS_CFG.TIMEZONE;
  var now = new Date();

  var pgcMap = rvtoWS_loadPgcMap_();
  var pgcLoaded = 0;
  (function() {
    for (var k in pgcMap) {
      if (Object.prototype.hasOwnProperty.call(pgcMap, k)) pgcLoaded++;
    }
  })();

  var hourlyRate = RVTO_WS_CFG.FALLBACK_RATE;
  try {
    var rateSheet = ss.getSheetByName(RVTO_WS_CFG.RATE_TAB);
    if (rateSheet) {
      var rv = parseFloat(rateSheet.getRange(RVTO_WS_CFG.RATE_CELL).getValue());
      if (!isNaN(rv) && rv > 0) hourlyRate = rv;
    }
  } catch (e) {
    Logger.log('RVTO Weekly Summary: could not read rate');
  }

  var assumedShiftHours = rvtoWS_getAssumedShiftHours_();

  var dayOfWeek  = now.getDay();
  var diffToMon  = (dayOfWeek === 0) ? -6 : 1 - dayOfWeek;
  var weekStart  = rvtoWS_midnight_(new Date(now.getTime() + diffToMon * 86400000));
  var weekEnd    = new Date(weekStart.getTime() + 7 * 86400000);
  var monthStart = rvtoWS_midnight_(new Date(now.getFullYear(), now.getMonth(), 1));
  var monthEnd   = new Date(rvtoWS_midnight_(now).getTime() + 86400000);

  var weekLabel  = Utilities.formatDate(weekStart, tz, 'MMM d') + '–' +
                   Utilities.formatDate(new Date(weekEnd.getTime() - 86400000), tz, 'MMM d, yyyy');
  var monthLabel = Utilities.formatDate(monthStart, tz, 'MMMM yyyy');

  var offersSheet = ss.getSheetByName(RVTO_WS_CFG.OFFERS_TAB);
  if (!offersSheet) {
    Logger.log('RVTO Weekly Summary: Offers tab not found');
    return;
  }
  var data    = offersSheet.getDataRange().getValues();
  var rows    = data.slice(1).filter(function(r) { return r.some(function(c) { return c !== ''; }); });

  var weekAgg  = rvtoWS_aggregate_(rows, weekStart,  weekEnd,  tz, pgcMap, assumedShiftHours);
  var monthAgg = rvtoWS_aggregate_(rows, monthStart, monthEnd, tz, pgcMap, assumedShiftHours);

  var sh = ss.getSheetByName(RVTO_WS_CFG.SUMMARY_TAB);
  if (!sh) sh = ss.insertSheet(RVTO_WS_CFG.SUMMARY_TAB);
  rvtoWS_unmergeEntireSheet_(sh);
  sh.clearContents();
  sh.clearFormats();

  var NUM_COLS = 9;
  sh.setColumnWidths(1, NUM_COLS, 150);
  sh.setColumnWidth(1, 220);

  var row = 1;

  var titleRange = rvtoWS_rangeOneRow_(sh, row, 1, NUM_COLS);
  titleRange.merge();
  titleRange.setValue('TARGETED VTO BOT — WEEKLY SUMMARY (v1.4.0)')
    .setBackground(RVTO_WS_COLORS.headerDark)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold')
    .setFontSize(13)
    .setHorizontalAlignment('center');
  sh.setRowHeight(row, 36);
  row++;

  sh.getRange(row, 1).setValue('Last Refreshed').setFontWeight('bold');
  sh.getRange(row, 2).setValue(Utilities.formatDate(now, tz, 'MMM d, yyyy h:mm a') + ' CST');
  sh.getRange(row, 3).setValue('Hourly Rate').setFontWeight('bold');
  sh.getRange(row, 4).setValue('$' + hourlyRate.toFixed(2));
  sh.getRange(row, 5).setValue('PGC names loaded').setFontWeight('bold');
  sh.getRange(row, 6).setValue(pgcLoaded > 0 ? pgcLoaded : '— (set PGC_SPREADSHEET_ID)');
  row++;

  row = rvtoWS_writePgcReleaseNotesBlock_(sh, row, NUM_COLS);

  row = rvtoWS_writeStatBand_(sh, row, '📅  THIS WEEK  (' + weekLabel + ')', weekAgg, RVTO_WS_COLORS.weekBg, NUM_COLS, hourlyRate);
  row++;
  row = rvtoWS_writeSentAtCalendarDigest_(sh, row, rows, weekStart, weekEnd, tz, assumedShiftHours, NUM_COLS);
  row++;
  var weekBundle = rvtoWS_pgcLensBundle_(weekAgg, pgcMap, hourlyRate);
  row = rvtoWS_writeBusinessApprovedKpi_(sh, row, 'This week (' + weekLabel + ')', weekAgg, NUM_COLS);
  row++;
  row = rvtoWS_writePgcImpactOnly_(sh, row, weekAgg, pgcMap, NUM_COLS, weekBundle);
  row++;
  row = rvtoWS_writeApprovedHoursTwoMonthCalendars_(sh, row, rows, now, tz, NUM_COLS, assumedShiftHours);
  row++;
  row = rvtoWS_writePgcLensStatsOnly_(sh, row, 'PGC — This Week (approved offers)', NUM_COLS, weekBundle);
  row++;
  row = rvtoWS_writeManagerTable_(sh, row, weekAgg, NUM_COLS, hourlyRate, 'Manager Breakdown — This Week');
  row++;
  row = rvtoWS_writeQueueTable_(sh, row, weekAgg, NUM_COLS, 'Offers by Queue — This Week');
  row++;
  row = rvtoWS_writeTopRepTable_(sh, row, weekAgg, pgcMap, 'Most Frequent Recipients — This Week', NUM_COLS);
  row += 2;

  row = rvtoWS_writeStatBand_(sh, row, '📅  THIS MONTH  (' + monthLabel + ')', monthAgg, RVTO_WS_COLORS.monthBg, NUM_COLS, hourlyRate);
  row++;
  var monthBundle = rvtoWS_pgcLensBundle_(monthAgg, pgcMap, hourlyRate);
  row = rvtoWS_writeBusinessApprovedKpi_(sh, row, 'This month (' + monthLabel + ')', monthAgg, NUM_COLS);
  row++;
  row = rvtoWS_writePgcImpactOnly_(sh, row, monthAgg, pgcMap, NUM_COLS, monthBundle);
  row++;
  row = rvtoWS_writePgcLensStatsOnly_(sh, row, 'PGC — This Month (approved offers)', NUM_COLS, monthBundle);
  row++;
  row = rvtoWS_writeManagerTable_(sh, row, monthAgg, NUM_COLS, hourlyRate, 'Manager Breakdown — This Month');
  row++;
  row = rvtoWS_writeQueueTable_(sh, row, monthAgg, NUM_COLS, 'Offers by Queue — This Month');
  row++;
  row = rvtoWS_writeTopRepTable_(sh, row, monthAgg, pgcMap, 'Most Frequent Recipients — This Month', NUM_COLS);

  sh.setFrozenRows(1);
  sh.setTabColor('#e67e22');

  Logger.log('VTO Weekly Summary v1.4.0 built. PGC map size: ' + pgcLoaded + ' | Assumed shift hrs: ' + assumedShiftHours);
}

/*************************************************************
 * PGC: release blurb (static) + stat lens
 *************************************************************/
function rvtoWS_writePgcReleaseNotesBlock_(sh, startRow, numCols) {
  var lines = rvtoWS_pgcReleaseNotesLines_();
  var r = rvtoWS_rangeOneRow_(sh, startRow, 1, numCols);
  r.merge();
  r.setValue('PGC PRIORITY (SOP) — ' + lines[0] + ' | ' + lines[1])
    .setBackground(RVTO_WS_COLORS.pgcBg)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontSize(9)
    .setWrap(true);
  sh.setRowHeight(startRow, 48);
  return startRow + 1;
}

function rvtoWS_pgcLensBundle_(agg, pgcMap, hourlyRate) {
  var list   = agg.approvedPgcList || [];
  var nKnown = list.length;
  var nNoRow = agg.approvedNoPgcNameMatch || 0;
  var appr   = agg.approved || 0;
  var meanP  = rvtoWS_mean_(list);
  var medP   = rvtoWS_median_(list);

  var fileVals = [];
  (function() {
    for (var k in pgcMap) {
      if (!Object.prototype.hasOwnProperty.call(pgcMap, k)) continue;
      var v = Number(pgcMap[k]);
      if (isFinite(v)) fileVals.push(v);
    }
  })();
  var fileMed = fileVals.length ? rvtoWS_median_(fileVals) : null;
  var fileP25 = fileVals.length ? rvtoWS_p25_(fileVals) : null;

  var aH   = Number(agg.approvedHours) || 0;
  var tot$ = aH * hourlyRate;
  var hPri = (Number(agg.hoursNoPgcRow) || 0) + (Number(agg.hoursBelowFileMedian) || 0);
  var pri$ = hPri * hourlyRate;
  var pctH = aH > 0 ? (hPri / aH * 100) : null;
  var gapP = (fileMed != null && meanP != null) ? (fileMed - meanP) : null;

  return {
    list: list,
    nKnown: nKnown,
    nNoRow: nNoRow,
    appr: appr,
    meanP: meanP,
    medP: medP,
    fileMed: fileMed,
    fileP25: fileP25,
    d: meanP != null ? meanP.toFixed(2) : '—',
    e: medP != null ? medP.toFixed(2) : '—',
    f: fileMed != null ? fileMed.toFixed(2) : '—',
    aH: aH,
    tot$: tot$,
    hPri: hPri,
    pri$: pri$,
    pctH: pctH,
    gapP: gapP,
  };
}

function rvtoWS_writeBusinessApprovedKpi_(sh, startRow, windowLabel, agg, numCols) {
  var appr = Number(agg.approved) || 0;
  var tot  = Number(agg.totalOffers) || 0;
  var rate = tot > 0 ? ((appr / tot) * 100).toFixed(1) + '%' : '—';
  var r = rvtoWS_rangeOneRow_(sh, startRow, 1, numCols);
  r.merge();
  r.setValue(
    'Business total — approved offers (' + windowLabel + '): ' + String(appr) +
      ' committed/accepted (all queues combined). ' +
      'Offers sent in window: ' + String(tot) + '  ·  Share of offers approved: ' + rate +
      '  ·  Sent-at calendar above + two-month approved calendar below reconcile bundle / single-day campaigns.'
  )
    .setBackground('#d7bde2')
    .setFontColor('#1a1a1a')
    .setFontWeight('bold')
    .setFontSize(10)
    .setWrap(true)
    .setVerticalAlignment('middle');
  sh.setRowHeight(startRow, 44);
  return startRow + 1;
}

function rvtoWS_writePgcImpactOnly_(sh, startRow, agg, pgcMap, numCols, b) {
  var fileMed = b.fileMed;
  var meanP = b.meanP;
  var nKnown = b.nKnown;
  var tot$ = b.tot$;
  var pri$ = b.pri$;
  var pctH = b.pctH;
  var gapP = b.gapP;
  var aH = b.aH;

  var rImp = rvtoWS_rangeOneRow_(sh, startRow, 1, numCols);
  rImp.merge();
  rImp.setValue('IMPACT  —  Labor $ & PGC "priority" alignment (see SOP)')
    .setBackground(RVTO_WS_COLORS.greenDark)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold')
    .setFontSize(10);
  sh.setRowHeight(startRow, 22);
  startRow++;

  rvtoWS_rangeOneRow_(sh, startRow, 1, numCols).setBackground('#e8f6e8');
  sh.getRange(startRow, 1).setValue('Est. labor savings (all approved VTO)').setFontWeight('bold').setBackground('#b7e1cd');
  sh.getRange(startRow, 2).setValue('$' + tot$.toFixed(2)).setBackground(RVTO_WS_COLORS.white).setFontWeight('bold');
  sh.getRange(startRow, 3).setValue('Approved hours in window').setFontWeight('bold').setBackground('#b7e1cd');
  sh.getRange(startRow, 4).setValue(aH.toFixed(2) + ' hrs').setBackground(RVTO_WS_COLORS.white);
  sh.getRange(startRow, 5).setValue('Priority band — est. $').setFontWeight('bold').setBackground('#b7e1cd');
  sh.getRange(startRow, 6)
    .setValue('$' + pri$.toFixed(2) + (pctH != null ? '  (' + pctH.toFixed(0) + '% of hrs)' : ''))
    .setBackground(RVTO_WS_COLORS.white);
  startRow++;

  rvtoWS_rangeOneRow_(sh, startRow, 1, numCols).setBackground('#f0faf0');
  sh.getRange(startRow, 1).setValue('Priority split (hours)').setFontSize(9).setBackground('#d5f0d5');
  sh.getRange(startRow, 2).setValue('No PGC row: ' + (Number(agg.hoursNoPgcRow) || 0).toFixed(2) + 'h').setBackground(RVTO_WS_COLORS.white);
  sh.getRange(startRow, 3).setValue('PGC < median: ' + (Number(agg.hoursBelowFileMedian) || 0).toFixed(2) + 'h').setFontSize(9);
  rvtoWS_rangeOneRow_(sh, startRow, 4, 6).merge();
  sh.getRange(startRow, 4)
    .setValue(fileMed == null ? '(set PGC file to get median & split.)' : 'File median PGC: ' + fileMed.toFixed(1))
    .setFontSize(8)
    .setFontColor('#555555');
  startRow++;

  rvtoWS_rangeOneRow_(sh, startRow, 1, numCols).setBackground('#e8f6e8');
  sh.getRange(startRow, 1).setValue('Priority').setFontSize(9).setFontWeight('bold');
  var subR = rvtoWS_rangeOneRow_(sh, startRow, 2, numCols);
  subR.setBackground('#e8f6e8').merge();
  subR.setValue('Hours: no PGC name match, OR known PGC was below the full-file median (the cohort the bot is designed to reach first — SOP v1.6.4 / v1.6.5).')
    .setFontSize(9)
    .setFontStyle('italic');
  startRow++;

  var rN = rvtoWS_rangeOneRow_(sh, startRow, 1, numCols);
  rN.merge();
  var narr = 'Savings: $' + tot$.toFixed(2) + ' total. Priority-targeted: ~$' + pri$.toFixed(2) + ' (hours with no PGC name match, or PGC under file median). ';
  if (aH > 0) narr += 'That is ~' + (pctH != null ? pctH.toFixed(0) : '0') + '% of approved VTO hours this period. ';
  if (gapP != null && fileMed != null && meanP != null && nKnown > 0) {
    narr += 'Where PGC is known, approver avg is ' + meanP.toFixed(1) + ' vs file median ' + fileMed.toFixed(1) + ' (' + (gapP > 0.5 ? 'cohort is ' + gapP.toFixed(1) + ' PGC points below overall median' : 'see table') + '). ';
  }
  if (!Object.keys(pgcMap || {}).length) {
    narr += ' (Map PGC via Script Property PGC_SPREADSHEET_ID in the same project as the bot for comparison rows.)';
  }
  rN.setValue(narr)
    .setBackground('#fff9e6')
    .setFontSize(9)
    .setWrap(true)
    .setVerticalAlignment('top');
  sh.setRowHeight(startRow, 52);
  startRow++;

  return startRow;
}

function rvtoWS_writePgcLensStatsOnly_(sh, startRow, title, numCols, b) {
  var appr = b.appr;
  var nKnown = b.nKnown;
  var nNoRow = b.nNoRow;
  var d = b.d;
  var e = b.e;
  var f = b.f;
  var fileP25 = b.fileP25;

  var hdr2 = rvtoWS_rangeOneRow_(sh, startRow, 1, numCols);
  hdr2.merge();
  hdr2.setValue(title)
    .setBackground(RVTO_WS_COLORS.pgcBg)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('left');
  sh.setRowHeight(startRow, 24);
  startRow++;

  rvtoWS_rangeOneRow_(sh, startRow, 1, numCols).setBackground('#dce9f5');
  sh.getRange(startRow, 1).setValue('Approved (total)').setFontWeight('bold').setBackground('#dce9f5');
  sh.getRange(startRow, 2).setValue(String(appr)).setBackground(RVTO_WS_COLORS.white);
  sh.getRange(startRow, 3).setValue('Approved w/ PGC in file').setFontWeight('bold').setBackground('#dce9f5');
  sh.getRange(startRow, 4).setValue(String(nKnown) + (appr > 0 ? ' (' + (nKnown / appr * 100).toFixed(0) + '%)' : '')).setBackground(RVTO_WS_COLORS.white);
  sh.getRange(startRow, 5).setValue('Approved, no PGC name match').setFontWeight('bold').setBackground('#dce9f5');
  sh.getRange(startRow, 6).setValue(String(nNoRow)).setBackground(RVTO_WS_COLORS.white);
  startRow++;

  rvtoWS_rangeOneRow_(sh, startRow, 1, numCols).setBackground('#dce9f5');
  sh.getRange(startRow, 1).setValue('Mean PGC (approved, known)').setFontWeight('bold').setBackground('#dce9f5');
  sh.getRange(startRow, 2).setValue(d).setBackground(RVTO_WS_COLORS.white);
  sh.getRange(startRow, 3).setValue('Median PGC (approved, known)').setFontWeight('bold').setBackground('#dce9f5');
  sh.getRange(startRow, 4).setValue(e).setBackground(RVTO_WS_COLORS.white);
  sh.getRange(startRow, 5).setValue('PGC file median (all reps)').setFontWeight('bold').setBackground('#dce9f5');
  sh.getRange(startRow, 6).setValue(f + (fileP25 != null ? '  |  File p25: ' + fileP25.toFixed(1) : '')).setBackground(RVTO_WS_COLORS.white);
  startRow++;

  return startRow;
}

/*************************************************************
 * AGGREGATE
 *************************************************************/
function rvtoWS_aggregate_(rows, startDate, endDate, tz, pgcMap, assumedShiftHours) {
  pgcMap            = pgcMap || {};
  assumedShiftHours = (assumedShiftHours > 0) ? assumedShiftHours : RVTO_WS_CFG.FALLBACK_SHIFT_HOURS;

  var fileVals0 = [];
  (function() {
    for (var k in pgcMap) {
      if (!Object.prototype.hasOwnProperty.call(pgcMap, k)) continue;
      var vv = Number(pgcMap[k]);
      if (isFinite(vv)) fileVals0.push(vv);
    }
  })();
  var fileMedAgg = fileVals0.length ? rvtoWS_median_(fileVals0) : null;

  var agg = {
    totalOffers:    0,
    approved:       0,
    declined:       0,
    expired:        0,
    sent:           0,
    other:          0,
    weekBlockOffers: 0,
    approvedHours:  0,
    byManager: {},
    byQueue:   {},
    byRep:     {},
    approvedPgcList:        [],
    approvedNoPgcNameMatch: 0,
    hoursNoPgcRow:          0,
    hoursBelowFileMedian:   0,
  };

  var COL = RVTO_WS_COL;
  var approvedSet = {};
  RVTO_WS_CFG.APPROVED_STATUSES.forEach(function(s) { approvedSet[s] = true; });

  rows.forEach(function(row) {
    var sentAtRaw = row[COL.SENT_AT];
    var sentAt    = (sentAtRaw instanceof Date) ? sentAtRaw : new Date(sentAtRaw);
    if (isNaN(sentAt.getTime())) return;
    if (sentAt < startDate || sentAt >= endDate) return;

    agg.totalOffers++;

    var status  = String(row[COL.STATUS]  || '').trim().toUpperCase();
    var queue   = String(row[COL.QUEUE]   || '').trim();
    var manager = String(row[COL.MANAGER] || '').trim();
    var name    = String(row[COL.NAME]    || '').trim();
    var notes   = String(row[COL.NOTES]   || '').trim();

    if (rvtoWS_isWeekBlockRow_(row, COL)) agg.weekBlockOffers++;

    var offerHrs = rvtoWS_calcHours_(
      row[COL.DATE], row[COL.START], row[COL.END], tz,
      notes, assumedShiftHours
    );

    var isApproved = !!approvedSet[status];
    var isDeclined = (status === 'DECLINED');
    var isExpired  = (status === 'EXPIRED' || status === 'COMMIT_FAILED');
    var isSent     = (status === 'SENT' || status === 'PENDING_SEND');

    if (isApproved) {
      agg.approved++;
      agg.approvedHours += offerHrs;

      var pgcN2 = rvtoWS_pgcForName_(pgcMap, name);
      if (pgcN2 != null) {
        agg.approvedPgcList.push(pgcN2);
        if (fileMedAgg != null && pgcN2 < fileMedAgg) {
          agg.hoursBelowFileMedian += offerHrs;
        }
      } else {
        agg.approvedNoPgcNameMatch++;
        agg.hoursNoPgcRow += offerHrs;
      }
    } else if (isDeclined) {
      agg.declined++;
    } else if (isExpired) {
      agg.expired++;
    } else if (isSent) {
      agg.sent++;
    } else {
      agg.other++;
    }

    if (!agg.byManager[manager]) agg.byManager[manager] = { offers: 0, approved: 0, declined: 0, expired: 0, sent: 0, hours: 0 };
    agg.byManager[manager].offers++;
    if (isApproved) { agg.byManager[manager].approved++; agg.byManager[manager].hours += offerHrs; }
    if (isDeclined)   agg.byManager[manager].declined++;
    if (isExpired)    agg.byManager[manager].expired++;
    if (isSent)       agg.byManager[manager].sent++;

    if (!agg.byQueue[queue]) agg.byQueue[queue] = { offers: 0, approved: 0, hours: 0 };
    agg.byQueue[queue].offers++;
    if (isApproved) { agg.byQueue[queue].approved++; agg.byQueue[queue].hours += offerHrs; }

    if (!agg.byRep[name]) agg.byRep[name] = { offers: 0, approved: 0 };
    agg.byRep[name].offers++;
    if (isApproved) agg.byRep[name].approved++;
  });

  return agg;
}

/*************************************************************
 * HOURS, TIME, MIDNIGHT
 *************************************************************/
function rvtoWS_calcHours_(dateVal, startRaw, endRaw, tz, notesVal, assumedShiftHours) {
  assumedShiftHours = (assumedShiftHours > 0) ? assumedShiftHours : RVTO_WS_CFG.FALLBACK_SHIFT_HOURS;

  var notesStr = String(notesVal || '');
  var isWkNotes = notesStr.indexOf('WEEK_VTO') !== -1;
  var dateOnly = (dateVal instanceof Date)
    ? Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd')
    : String(dateVal || '').trim();

  if (rvtoWS_isWeekBlock_(dateVal) || isWkNotes) {
    var days = rvtoWS_parseWeekBlockDays_(notesVal);
    if (days.length) {
      return days.length * assumedShiftHours;
    }
    if (rvtoWS_isWeekBlock_(dateVal)) {
      var parts = String(dateVal).split(' to ');
      if (parts.length === 2) {
        var d1 = new Date(parts[0].trim() + 'T12:00:00');
        var d2 = new Date(parts[1].trim() + 'T12:00:00');
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime()) && d2 >= d1) {
          var calDays = Math.round((d2 - d1) / 86400000) + 1;
          return calDays * assumedShiftHours;
        }
      }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      return assumedShiftHours;
    }
    return 0;
  }

  if (!dateVal || !startRaw || !endRaw) return 0;
  try {
    var dateStr  = (dateVal instanceof Date)
      ? Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd')
      : String(dateVal).trim();
    var startStr = rvtoWS_toTimeStr_(startRaw, tz);
    var endStr   = rvtoWS_toTimeStr_(endRaw,   tz);
    if (!startStr || !endStr) return 0;
    var s = Utilities.parseDate(dateStr + 'T' + startStr + ':00', tz, "yyyy-MM-dd'T'HH:mm:ss");
    var e = Utilities.parseDate(dateStr + 'T' + endStr   + ':00', tz, "yyyy-MM-dd'T'HH:mm:ss");
    if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    return Math.max(0, (e.getTime() - s.getTime()) / 3600000);
  } catch (ex) { return 0; }
}

function rvtoWS_toTimeStr_(raw, tz) {
  if (!raw) return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, tz, 'HH:mm');
  var s = String(raw).trim();
  if (s.match(/^\d{1,2}:\d{2}(:\d{2})?$/)) return s.substring(0, 5);
  return s;
}

function rvtoWS_midnight_(d) {
  var out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/*************************************************************
 * STAT BAND
 *************************************************************/
function rvtoWS_writeStatBand_(sh, row, label, agg, bg, numCols, hourlyRate) {
  var hdr = rvtoWS_rangeOneRow_(sh, row, 1, numCols);
  hdr.merge();
  hdr.setValue(label)
    .setBackground(bg)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold')
    .setFontSize(12)
    .setHorizontalAlignment('center');
  sh.setRowHeight(row, 30);
  row++;

  var approvalRate = agg.totalOffers > 0 ? (agg.approved / agg.totalOffers * 100).toFixed(1) + '%' : '—';
  var savings      = '$' + (agg.approvedHours * hourlyRate).toFixed(2);
  var wkLabel      = agg.weekBlockOffers > 0
    ? agg.weekBlockOffers + ' (week-block style)'
    : '0';

  var stats = [
    ['Total Offers Sent',          String(agg.totalOffers),                    'Approved (Committed)',  String(agg.approved),      'Approval Rate',        approvalRate],
    ['Declined',                   String(agg.declined),                       'Expired / No Response', String(agg.expired),       'Still Open (SENT)',     String(agg.sent)],
    ['Week-Block Offers',          wkLabel,                                    'Approved Hours',        agg.approvedHours.toFixed(2) + ' hrs', 'Est. Labor Savings', savings],
  ];

  stats.forEach(function(pair) {
    sh.getRange(row, 1).setValue(pair[0]).setFontWeight('bold').setBackground('#dce9f5');
    sh.getRange(row, 2).setValue(pair[1]).setBackground(RVTO_WS_COLORS.white);
    if (pair[2]) {
      sh.getRange(row, 3).setValue(pair[2]).setFontWeight('bold').setBackground('#dce9f5');
      sh.getRange(row, 4).setValue(pair[3]).setBackground(RVTO_WS_COLORS.white);
    }
    if (pair[4]) {
      sh.getRange(row, 5).setValue(pair[4]).setFontWeight('bold').setBackground('#dce9f5');
      sh.getRange(row, 6).setValue(pair[5]).setBackground(RVTO_WS_COLORS.white).setFontWeight('bold');
    }
    row++;
  });

  return row;
}

/*************************************************************
 * MANAGER TABLE
 *************************************************************/
function rvtoWS_writeManagerTable_(sh, row, agg, numCols, hourlyRate, title) {
  var managers = Object.keys(agg.byManager);
  if (!managers.length) return row;

  var hdr = rvtoWS_rangeOneRow_(sh, row, 1, numCols);
  hdr.merge();
  hdr.setValue(title)
    .setBackground(RVTO_WS_COLORS.sectionBg)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold')
    .setHorizontalAlignment('left');
  row++;

  var cols = ['Manager', 'Total Offers', 'Approved', 'Declined', 'Expired', 'Approved Hrs', 'Est. Savings', 'Accept Rate'];
  var numDataCols = cols.length;
  while (sh.getMaxColumns() < numDataCols) sh.insertColumnAfter(sh.getMaxColumns());

  rvtoWS_rangeOneRow_(sh, row, 1, numDataCols).setValues([cols])
    .setBackground(RVTO_WS_COLORS.tableHeader)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold');
  row++;

  managers.sort(function(a, b) {
    return (agg.byManager[b].approved || 0) - (agg.byManager[a].approved || 0);
  });

  managers.forEach(function(mgr, idx) {
    var m    = agg.byManager[mgr];
    var rate = m.offers > 0 ? (m.approved / m.offers * 100).toFixed(1) + '%' : '—';
    var sav  = '$' + (m.hours * hourlyRate).toFixed(2);
    var bg   = (idx % 2 === 0) ? RVTO_WS_COLORS.altRow : RVTO_WS_COLORS.white;
    rvtoWS_rangeOneRow_(sh, row, 1, numDataCols).setValues([[
      mgr || '(unknown)', m.offers, m.approved, m.declined, m.expired, m.hours.toFixed(2), sav, rate
    ]]).setBackground(bg);
    row++;
  });

  return row;
}

/*************************************************************
 * QUEUE TABLE
 *************************************************************/
function rvtoWS_writeQueueTable_(sh, row, agg, numCols, title) {
  var queues = Object.keys(agg.byQueue);
  if (!queues.length) return row;

  var hdr = rvtoWS_rangeOneRow_(sh, row, 1, numCols);
  hdr.merge();
  hdr.setValue(title)
    .setBackground(RVTO_WS_COLORS.sectionBg)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold')
    .setHorizontalAlignment('left');
  row++;

  var numDataCols = 4;
  while (sh.getMaxColumns() < numDataCols) sh.insertColumnAfter(sh.getMaxColumns());
  rvtoWS_rangeOneRow_(sh, row, 1, numDataCols).setValues([['Queue', 'Total Offers', 'Approved', 'Accept Rate']])
    .setBackground(RVTO_WS_COLORS.tableHeader)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold');
  row++;

  queues.sort(function(a, b) { return (agg.byQueue[b].approved || 0) - (agg.byQueue[a].approved || 0); });
  queues.forEach(function(q, idx) {
    var qd   = agg.byQueue[q];
    var ar   = qd.offers > 0 ? (qd.approved / qd.offers * 100).toFixed(1) + '%' : '—';
    var bg2  = (idx % 2 === 0) ? RVTO_WS_COLORS.altRow : RVTO_WS_COLORS.white;
    rvtoWS_rangeOneRow_(sh, row, 1, numDataCols).setValues([[q || '(unknown)', qd.offers, qd.approved, ar]]).setBackground(bg2);
    row++;
  });
  return row;
}

/*************************************************************
 * TOP REPS
 *************************************************************/
function rvtoWS_writeTopRepTable_(sh, row, agg, pgcMap, title, sectionMergeCols) {
  pgcMap = pgcMap || {};
  var reps = Object.keys(agg.byRep);
  if (!reps.length) return row;

  sectionMergeCols = sectionMergeCols || 9;
  var hdr3 = rvtoWS_rangeOneRow_(sh, row, 1, sectionMergeCols);
  hdr3.merge();
  hdr3.setValue(title)
    .setBackground(RVTO_WS_COLORS.sectionBg)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold')
    .setHorizontalAlignment('left');
  row++;

  var numDataCols = 4;
  while (sh.getMaxColumns() < numDataCols) sh.insertColumnAfter(sh.getMaxColumns());
  rvtoWS_rangeOneRow_(sh, row, 1, numDataCols).setValues([['Rep Name', 'Offers Received', 'Accepted', 'PGC (file)']])
    .setBackground(RVTO_WS_COLORS.tableHeader)
    .setFontColor(RVTO_WS_COLORS.white)
    .setFontWeight('bold');
  row++;

  reps.sort(function(a, b) { return (agg.byRep[b].offers || 0) - (agg.byRep[a].offers || 0); });
  reps.slice(0, 20).forEach(function(rep, idx) {
    var rd  = agg.byRep[rep];
    var pgc = rvtoWS_pgcForName_(pgcMap, rep);
    var pgcS = pgc != null ? pgc.toFixed(2) : '—';
    var bg2  = (idx % 2 === 0) ? RVTO_WS_COLORS.altRow : RVTO_WS_COLORS.white;
    rvtoWS_rangeOneRow_(sh, row, 1, numDataCols).setValues([[rep || '(unknown)', rd.offers, rd.approved, pgcS]]).setBackground(bg2);
    row++;
  });
  return row;
}

/*************************************************************
 * MENU & TRIGGER
 *************************************************************/
function menuRefreshRvtoWeeklySummary() {
  buildRvtoWeeklySummary();
  SpreadsheetApp.getUi().alert('Targeted VTO Weekly Summary refreshed.');
}

function addRvtoWeeklySummaryMenuItem() {
  var ui = SpreadsheetApp.getUi();
  if (ui) {
    ui.createMenu('Reverse VTO')
      .addItem('Run Now', 'runReverseVto')
      .addItem('Run Week / Single-Day VTO', 'runWeekBlockVto')
      .addSeparator()
      .addItem('Expire Open Offers', 'expireRvtoOffersMenu')
      .addItem('Clear All Offers', 'clearRvtoOffers')
      .addSeparator()
      .addItem('Refresh Weekly Summary', 'menuRefreshRvtoWeeklySummary')
      .addSeparator()
      .addItem('Setup Workbook', 'setupRvtoWorkbook')
      .addItem('Cleanup Legacy Tabs', 'cleanupLegacyTabs')
      .addToUi();
  }
}

function setupRvtoWeeklySummaryTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'buildRvtoWeeklySummary') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildRvtoWeeklySummary')
    .timeBased()
    .everyMinutes(30)
    .create();
  Logger.log('Trigger: buildRvtoWeeklySummary every 30 min');
}
