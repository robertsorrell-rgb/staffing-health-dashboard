/*************************************************************
 * TARGETED OT BOT v1.3.7
 * Mirrors the Targeted VTO Bot architecture.
 *
 * Core loop (trigger: every 10-15 min):
 *   1. GET overtime_slots via session auth (app.assembledhq.com)
 *      Per queue, channel=phone. Filters to slots with remaining
 *      seats > 0 and start >= 1 hour from now.
 *   2. Subtract SENT/PENDING_SEND rows in Offers sheet from
 *      remaining seats (bridges offer-sent → rep-accept gap).
 *   3. Merge contiguous open 30-min intervals into blocks per queue.
 *   4. Pull schedules via public API (through latest OT block + LOOKAHEAD_DAYS).
 *      Find reps NOT scheduled for phone/chat/sms/meal/break during those windows.
 *   5. Filter eligibility: queue work group match, no-fly,
 *      shadow exclusion, daily/24h caps, min gap.
 *   6. Sort by PGC descending (highest performers first).
 *   7. Send offer Slack DMs (REP_OT_SLACK), track in Offers sheet.
 *      Optional: email instead when REP_OT_SLACK=FALSE and SEND_EMAILS=TRUE.
 *   8. On accept (doGet):
 *      a. POST /activities via public API (schedule commit)
 *      b. POST overtime claim via session auth (slot fill)
 *      c. Slack DM to manager (MANAGER_OT_SLACK + Manager_Aliases)
 *
 * AUTH:
 *   Slot GET + claim POST → session cookie + CSRF (app subdomain)
 *   Schedule pull + activity commit → API key (api subdomain)
 *   401 on session calls → Slack alert to ops user
 *
 * SCRIPT PROPERTIES:
 *   ASSEMBLED_API_KEY        public API key (sk_live_...)
 *   ASSEMBLED_SESSION        session cookie value
 *   ASSEMBLED_CSRF           CSRF token
 *   OT_WEB_APP_URL           deployed web app URL
 *   ASSEMBLED_OT_ACTIVITY_ID activity type UUID for OT/Extra Work
 *   SLACK_BOT_TOKEN          rep/manager DMs + session expiry alerts (see Slack setup below)
 *   SLACK_OPS_USER_ID        your Slack user ID (U…) for 401 alerts; may be work email → same lookup as reps
 *   MANAGER_CHANNEL_ID       optional; Slack channel ID (C…) for Sales Manager OT digests (or Config tab)
 *   OT_SLACK_TEST_EMAIL      optional; your work email for “Test: OT ping DM to me” (users.lookupByEmail — same as reps)
 *   OT_SLACK_TEST_USER_ID    optional Slack user ID for that test menu; used if OT_SLACK_TEST_EMAIL is empty
 *
 * SLACK (Workspace app):
 *   Create or reuse a Slack app; install to workspace; Bot User OAuth Token → SLACK_BOT_TOKEN.
 *   Bot token scopes: chat:write, im:write, users:read.email
 *     (conversations.open + chat.postMessage + users.lookupByEmail).
 *   Channel digests also need chat:write.public if the bot is not invited to the channel.
 *   Invite the bot to the workspace (no channel needed for DMs).
 *   Manager DMs: Config MANAGER_OT_SLACK=TRUE, Manager_Aliases maps Roster manager names → Slack email/handle.
 *   Rep offer DMs: Config REP_OT_SLACK=TRUE (default delivery); lookup uses Roster email (must match Slack account email).
 *   Menu “Send OT availability pings (Slack)”: manual broadcast DMs by sales group (tab Roster - Sales; see OT_BULK_SLACK_* constants), plus Test DM to you.
 *   Bulk pings use the same schedule gate as targeted offers — only reps with at least one
 *   open OT block they are not on phone/meal/break for receive a DM.
 *   Sales Manager channel digests (Config MANAGER_CHANNEL_SLACK=TRUE, MANAGER_CHANNEL_ID):
 *     8AM CT — next 3 days; 2PM CT — tomorrow needs; 5PM CT — 7-day outlook.
 *     Triggers: runOtChannelMorningOutlook_ / runOtChannelTomorrowNeeds_ / runOtChannelWeekOutlook_
 *     Bot scopes: chat:write (+ chat:write.public if posting without channel invite).
 *   On-demand slash command in #ops-for-sales-managers (same web app URL as doPost):
 *     /ops HS | COL tomorrow — hour-level gaps from OT_By_Hour tab (ephemeral: only requester sees command + reply)
 *     (Targeted OT Bot workbook, gid=473477945). Refresh via Targeted OT → Refresh Overtime Review.
 *     Slack app → Slash Commands → Request URL = OT_WEB_APP_URL (/exec).
 *     Config MANAGER_CHANNEL_NAME=ops-for-sales-managers; MANAGER_CHANNEL_ID=C… (or Script Property).
 *     Config CHANNEL_SLASH_ENABLED=TRUE; CHANNEL_SLASH_RESTRICT_CHANNEL=TRUE limits to that channel.
 *   PGC_SPREADSHEET_ID       Looker PGC export sheet
 *   PGC_SHEET_NAME           optional tab name (omit = first sheet)
 *
 * OVERTIME REVIEW (same spreadsheet as this bot):
 *   Tab “Overtime_Review” — Targeted OT → Refresh Overtime Review.
 *   Tab “OT_By_Hour” — same refresh; take rate by sales group, calendar day, and
 *   slot-start hour (CT) for REVIEW_HOUR_LOOKBACK_DAYS (default 7) complete days
 *   before today plus today and REVIEW_HOUR_LOOKAHEAD_DAYS (default 7) ahead.
 *   Fetches REVIEW_LOOKBACK_DAYS (default 14) before today plus up to
 *   REVIEW_FETCH_DAYS ahead (or auto ≥21d). Table lists the lookback window,
 *   then today forward until REVIEW_BLANK_STOP_STREAK (default 3) consecutive
 *   days have no open OT seats in any queue — those days and anything after
 *   are omitted.
 *
 * SETUP:
 *   1. Run setupOtWorkbook() once
 *   2. Set Script Properties above
 *   3. Populate Roster sheet (can IMPORTRANGE from VTO bot)
 *   4. Deploy as web app (execute as: me, anyone can access)
 *   5. Set time-based trigger on runTargetedOt() every 10-15 min
 *   6. Optional: time trigger on runOvertimeReviewReport() and/or runOtDashboardReport()
 *      (or runOvertimeReviewAndDashboard_ for both). OT_Dashboard = COMMITTED hours by window.
 *   7. Optional: Sales Manager channel digests — Config MANAGER_CHANNEL_SLACK=TRUE,
 *      MANAGER_CHANNEL_ID=C…; time triggers runOtChannelMorningOutlook_ (~8AM),
 *      runOtChannelTomorrowNeeds_ (~2PM CT), runOtChannelWeekOutlook_ (~5PM CT).
 *   8. Optional: /ot-needs slash command — Slack app slash command → same web app URL;
 *      OT_SLACK_VERIFICATION_TOKEN; Config CHANNEL_SLASH_ENABLED=TRUE.
 *************************************************************/

/*************************************************************
 * CONSTANTS
 *************************************************************/
const OT_APP = {
  VERSION: 'V1.3.7',

  /** Row order in Overtime_Review (matches manual workbook). */
  REVIEW_SG_ORDER: ['AL', 'COL', 'ELD', 'HS', 'PC'],

  // Public REST API — API key auth
  API_BASE: 'https://api.assembledhq.com/v0',

  // Internal UI API — session cookie + CSRF auth
  APP_BASE: 'https://app.assembledhq.com/api',

  SHEETS: {
    CONFIG:           'Config',
    ROSTER:           'Roster',
    NO_FLY:           'No_Fly',
    SHADOW_EXCLUSION: 'Shadow_Exclusion',
    OFFERS:           'Offers',
    AUDIT:            'Audit',
    CHANGELOG:        'Changelog',
    MANAGER_ALIASES:  'Manager_Aliases',
    OVERTIME_REVIEW:  'Overtime_Review',
    OT_BY_HOUR:       'OT_By_Hour',
    OT_DASHBOARD:     'OT_Dashboard'
  },

  // Consumer Sales queues only.
  // queueAppId = internal string ID used by app.assembledhq.com/api
  // workGroupPattern = pipe-delimited substrings matched against
  //   Roster "Work Group" column (same patterns as VTO bot)
  QUEUE_DEFS: [
    {
      name:             'Adult Learner_CC90_New',
      queueAppId:       'expertalcc90new-1741983982',
      workGroupPattern: 'Core Test Group|Languages Test Group',
      key:              'Adult_Learner_CC90_New',
      sg:               'AL'
    },
    {
      name:             'Prof Certs_CC90_New',
      queueAppId:       'expertpccc90new-1741987887',
      workGroupPattern: 'Professional Certifications',
      key:              'Prof_Certs_CC90_New',
      sg:               'PC'
    },
    {
      name:             'College and Grad TP_CC90_New',
      queueAppId:       'expertcolcc90new-1741984259',
      workGroupPattern: 'STEM College Test Group|Graduate Test Prep',
      key:              'College_and_Grad_TP_CC90_New',
      sg:               'COL'
    },
    {
      name:             'Elementary and LD_CC90_New',
      queueAppId:       'experteldcc90new-1741984392',
      workGroupPattern: 'K-6 Test Group|Learning Differences Test Group',
      key:              'Elementary_and_LD_CC90_New',
      sg:               'ELD'
    },
    {
      name:             'High School_CC90_New',
      queueAppId:       'experthscc90new-1741984136',
      workGroupPattern: 'STEM High School Test Group|K12 Test Prep',
      key:              'High_School_CC90_New',
      sg:               'HS'
    }
  ],

  OFFER_STATUSES: {
    PENDING_SEND:  'PENDING_SEND',
    SENT:          'SENT',
    ACCEPTED:      'ACCEPTED',
    DECLINED:      'DECLINED',
    EXPIRED:       'EXPIRED',
    COMMITTED:     'COMMITTED',
    COMMIT_FAILED: 'COMMIT_FAILED',
    SEND_FAILED:   'SEND_FAILED'
  }
};

/** Bulk Slack “OT is open” roster: tab with IMPORTRANGE; A=Email, B=Name, K=Work Group (1-based column indices). */
const OT_BULK_SLACK_ROSTER_SHEET = 'Roster - Sales';
const OT_BULK_SLACK_COL_EMAIL = 1;
const OT_BULK_SLACK_COL_NAME = 2;
const OT_BULK_SLACK_COL_WORK_GROUP = 11;

/*************************************************************
 * MENU
 *************************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Targeted OT')
    .addItem('Run Now', 'runTargetedOt')
    .addSeparator()
    .addItem('Expire Open Offers', 'expireOtOffersMenu')
    .addItem('Clear All Offers', 'clearOtOffers')
    .addSeparator()
    .addItem('Refresh Overtime Review', 'runOvertimeReviewReport')
    .addItem('Refresh OT Dashboard', 'runOtDashboardReport')
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('Send OT availability pings (Slack)')
        .addItem('Test: OT ping DM to me', 'otPingSlackTestToMe')
        .addSeparator()
        .addItem('AL — Adult Learner', 'otPingSlack_AL')
        .addItem('COL — College & Grad', 'otPingSlack_COL')
        .addItem('ELD — Elementary & LD', 'otPingSlack_ELD')
        .addItem('HS — High School', 'otPingSlack_HS')
        .addItem('PC — Prof Certs', 'otPingSlack_PC')
    )
    .addSeparator()
    .addItem('Post 3-day OT outlook (Slack)', 'otPostMorningOutlookMenu_')
    .addItem('Post tomorrow OT needs (Slack)', 'otPostTomorrowNeedsMenu_')
    .addItem('Post 7-day OT outlook (Slack)', 'otPostWeekOutlookMenu_')
    .addSeparator()
    .addItem('Install channel digest triggers (8AM + 2PM + 5PM)', 'otSetupChannelDigestTriggersMenu_')
    .addItem('Remove channel digest triggers', 'otRemoveChannelDigestTriggersMenu_')
    .addItem('Show /ops slash command setup', 'otShowSlackSlashSetupMenu_')
    .addItem('Setup Workbook', 'setupOtWorkbook')
    .addToUi();
}

/**
 * Sends one Slack DM with the same body as bulk OT pings. Recipient (first match):
 *   OT_SLACK_TEST_EMAIL → users.lookupByEmail
 *   else OT_SLACK_TEST_USER_ID (member U… id, or an email string → lookup)
 *   else SLACK_OPS_USER_ID (member id, or email → lookup)
 * Does not message any reps.
 */
function otPingSlackTestToMe() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const token = (props.getProperty('SLACK_BOT_TOKEN') || '').trim();
  if (!token) {
    ui.alert('Set SLACK_BOT_TOKEN in Script Properties.');
    return;
  }

  const testEmailProp = (props.getProperty('OT_SLACK_TEST_EMAIL') || '').trim();
  const testIdProp = (props.getProperty('OT_SLACK_TEST_USER_ID') || '').trim();
  const opsProp = (props.getProperty('SLACK_OPS_USER_ID') || '').trim();

  var userId = '';
  var recipientNote = '';

  if (testEmailProp) {
    userId = otGetSlackUserId_(testEmailProp) || '';
    recipientNote = testEmailProp;
  } else if (testIdProp) {
    userId = testIdProp.indexOf('@') !== -1
      ? (otGetSlackUserId_(testIdProp) || '')
      : testIdProp;
    recipientNote = testIdProp;
  } else if (opsProp) {
    userId = opsProp.indexOf('@') !== -1
      ? (otGetSlackUserId_(opsProp) || '')
      : opsProp;
    recipientNote = opsProp;
  }

  if (!userId) {
    ui.alert(
      'Set one of these in Script Properties:\n' +
      '• OT_SLACK_TEST_EMAIL — your work email (e.g. you@varsitytutors.com), or\n' +
      '• OT_SLACK_TEST_USER_ID — Slack member ID (U…), or\n' +
      '• SLACK_OPS_USER_ID — same as for 401 alerts (U… or email).\n\n' +
      'Email must match the address on your Slack account.'
    );
    return;
  }

  const config = otGetConfig_();
  const body = otOtAvailabilitySlackMessage_(config) + '\n\n_Test only — no reps were messaged._';
  otSendSlackDm_(userId, body);
  otAudit_('OT_SLACK_BULK', 'TEST',
    'Test ping DM — Slack user ' + userId + (recipientNote ? ' — ' + recipientNote : ''),
    'OK');
  ui.alert('Test Slack DM sent. Check your Slack DMs from the bot.');
}

function otPingSlack_AL()  { otSendOtAvailabilitySlackPingsForSg_('AL'); }
function otPingSlack_COL() { otSendOtAvailabilitySlackPingsForSg_('COL'); }
function otPingSlack_ELD() { otSendOtAvailabilitySlackPingsForSg_('ELD'); }
function otPingSlack_HS()  { otSendOtAvailabilitySlackPingsForSg_('HS'); }
function otPingSlack_PC()  { otSendOtAvailabilitySlackPingsForSg_('PC'); }

function otOtAvailabilitySlackMessage_(config) {
  const custom = config && String(config.OT_AVAILABILITY_SLACK_MESSAGE || '').trim();
  if (custom) return custom;
  return '*New OT opportunities are now available!* Hop in and snag what you can while seats last.';
}

/**
 * Slack-DMs reps on OT_BULK_SLACK_ROSTER_SHEET whose Work Group matches the SG queue,
 * excluding anyone scheduled (phone/meal/break/etc.) during every current open OT block
 * for that queue — same schedule gate as targeted offers.
 */
function otSendOtAvailabilitySlackPingsForSg_(sg) {
  const ui = SpreadsheetApp.getUi();
  const qd = OT_APP.QUEUE_DEFS.filter(function(x) { return x.sg === sg; })[0];
  if (!qd) {
    ui.alert('Unknown sales group code: ' + sg);
    return;
  }

  const props = PropertiesService.getScriptProperties();
  if (!(props.getProperty('SLACK_BOT_TOKEN') || '').trim()) {
    ui.alert('Set Script Property SLACK_BOT_TOKEN (same bot as rep/manager DMs).');
    return;
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_BULK_SLACK_ROSTER_SHEET);
  if (!sheet) {
    ui.alert('Sheet not found: ' + OT_BULK_SLACK_ROSTER_SHEET);
    return;
  }

  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) {
    ui.alert('No rows in ' + OT_BULK_SLACK_ROSTER_SHEET + '.');
    return;
  }

  const iEmail = OT_BULK_SLACK_COL_EMAIL - 1;
  const iName = OT_BULK_SLACK_COL_NAME - 1;
  const iWg = OT_BULK_SLACK_COL_WORK_GROUP - 1;

  const seen = {};
  const rosterTargets = [];
  for (var r = 1; r < rows.length; r++) {
    const email = String(rows[r][iEmail] || '').trim().toLowerCase();
    const name = String(rows[r][iName] || '').trim();
    const wg = String(rows[r][iWg] || '').trim();
    if (!email || email.indexOf('@') === -1) continue;
    if (!wg || !otWorkGroupMatches_(wg, qd.workGroupPattern)) continue;
    if (seen[email]) continue;
    seen[email] = true;
    rosterTargets.push({ email: email, name: name });
  }

  if (!rosterTargets.length) {
    ui.alert('No reps matched ' + sg + ' (' + qd.name + ') on tab "' + OT_BULK_SLACK_ROSTER_SHEET + '".');
    return;
  }

  const config = otGetConfig_();
  const rules = otGetRules_(config);
  const ctx = otBuildContext_(config, rules);
  ctx.enabledQueues = [qd];

  var openSlots = [];
  try {
    openSlots = otFetchOpenSlots_(ctx);
  } catch (fetchErr) {
    ui.alert('Could not fetch open OT slots: ' + String(fetchErr));
    return;
  }

  const blocks = otMergeSlotBlocks_(
    openSlots.filter(function(s) { return s.queue === qd.name; }),
    ctx
  );

  if (!blocks.length) {
    ui.alert('No open OT blocks for *' + sg + '* (' + qd.name + ') — no pings sent.');
    return;
  }

  const schedIdx = otBuildSchedIdx_(
    otPullSchedules_(ctx, otComputeSchedulePullEnd_(ctx, blocks))
  );

  const targets = [];
  var skippedScheduled = 0;
  rosterTargets.forEach(function(t) {
    if (!otHasUnblockedOtWindow_(t.email, t.name, blocks, schedIdx)) {
      skippedScheduled++;
      otAudit_('OT_SLACK_BULK', sg,
        'Skipped — scheduled during all open OT blocks — ' + t.email +
        (t.name ? ' — ' + t.name : ''),
        'OK');
      return;
    }
    targets.push(t);
  });

  if (!targets.length) {
    ui.alert(
      'All ' + rosterTargets.length + ' matched rep(s) for *' + sg + '* are scheduled during ' +
      'current open OT windows — no pings sent.'
    );
    otAudit_('OT_SLACK_BULK', sg,
      'SUMMARY — sent 0 | skipped scheduled ' + skippedScheduled +
      ' | roster matched ' + rosterTargets.length + ' | queue ' + qd.name,
      'OK');
    return;
  }

  var confirmDetail = 'Send OT availability message to ' + targets.length + ' rep(s) for *' + sg +
    '* — ' + qd.name + '?';
  if (skippedScheduled) {
    confirmDetail += '\n\n' + skippedScheduled + ' rep(s) skipped (on phone/shift during all open OT blocks).';
  }
  const confirm = ui.alert('Send Slack DMs', confirmDetail, ui.ButtonSet.OK_CANCEL);
  if (confirm !== ui.Button.OK) return;

  const msg = otOtAvailabilitySlackMessage_(config);
  var ok = 0;
  var miss = 0;

  targets.forEach(function(t, idx) {
    const userId = otGetSlackUserId_(t.email);
    if (!userId) {
      miss++;
      otAudit_('OT_SLACK_BULK', sg, 'No Slack user for ' + t.email, 'WARN');
      return;
    }
    otSendSlackDm_(userId, msg);
    ok++;
    otAudit_('OT_SLACK_BULK', sg,
      'DM sent — ' + t.email + (t.name ? ' — ' + t.name : ''),
      'OK');
    if ((idx + 1) % 15 === 0) Utilities.sleep(400);
  });

  otAudit_('OT_SLACK_BULK', sg,
    'SUMMARY — sent ' + ok + ' | skipped scheduled ' + skippedScheduled +
    ' | no Slack match ' + miss + ' | open blocks ' + blocks.length +
    ' | queue ' + qd.name,
    'OK');
  ui.alert(
    'Done. Slack DMs sent: ' + ok + '.' +
    (skippedScheduled ? ' Skipped (scheduled): ' + skippedScheduled + '.' : '') +
    (miss ? ' No Slack user match: ' + miss + '.' : '')
  );
}

/*************************************************************
 * ENTRY POINT
 *************************************************************/
function runTargetedOt() {
  expireOtOffers_();

  const config = otGetConfig_();
  const rules  = otGetRules_(config);
  const ctx    = otBuildContext_(config, rules);

  ctx.enabledQueues = otGetEnabledQueues_(config);

  if (!ctx.enabledQueues.length) {
    otAudit_('RUN', '', 'No queues enabled — check QUEUE_ENABLED_* config rows', 'WARN');
    return;
  }

  // Fetch open OT slots from Assembled (session auth, per queue, channel=phone)
  const openSlots = otFetchOpenSlots_(ctx);

  if (!openSlots.length) {
    otAudit_('RUN', '', 'No open OT slots found across all enabled queues', 'OK');
    return;
  }

  // Merge contiguous 30-min slots into sendable blocks
  const blocks = otMergeSlotBlocks_(openSlots, ctx);

  if (!blocks.length) {
    otAudit_('RUN', '', 'No qualifying OT blocks after merge/filter', 'OK');
    return;
  }

  // Pull agent schedules through the latest OT block (not just SCHEDULE_PULL_HOURS)
  const scheduleThrough = otComputeSchedulePullEnd_(ctx, blocks);
  const schedules = otPullSchedules_(ctx, scheduleThrough);
  const schedIdx  = otBuildSchedIdx_(schedules);
  const roster    = otGetRoster_(ctx);

  const sendSlack  = otConfigBool_(config.REP_OT_SLACK, true);
  const sendEmails = otConfigBool_(config.SEND_EMAILS, false) && !sendSlack;
  const webAppUrl  = otGetWebAppUrl_(config);
  const holdHours  = Number(rules.OFFER_HOLD_HOURS || 1);

  let totalOffers = 0;
  let totalSent   = 0;

  blocks.forEach(function(block) {
    // Subtract bot's own pending/sent offers from Assembled remaining seats
    const reserved  = otCountReservedOffers_(block, ctx.offerObjects || [], ctx.timezone);
    const available = Math.max(0, block.remainingSeats - reserved);

    if (!available) {
      otAudit_('RUN', block.blockId,
        'Skipped — all seats reserved. ' +
        'Assembled remaining: ' + block.remainingSeats +
        ' | Bot reserved: ' + reserved, 'OK');
      return;
    }

    otAudit_('OT_BLOCK', block.blockId,
      'Queue: ' + block.queue +
      ' | Window: ' + block.start + '-' + block.end +
      ' | Date: ' + block.date +
      ' | Assembled remaining: ' + block.remainingSeats +
      ' | Bot reserved: ' + reserved +
      ' | Available to offer: ' + available +
      ' | Slots merged: ' + block.slotCount,
      'INFO');

    const eligible = otFindEligible_(block, roster, schedIdx, ctx);
    if (!eligible.length) return;

    const selected = eligible.slice(0, available);

    selected.forEach(function(person) {
      const offerId    = otBuildId_('OT_OFF');
      const token      = otCreateToken_(offerId, person.email);
      const acceptUrl  = webAppUrl
        ? (webAppUrl + '?offer_id=' + encodeURIComponent(offerId) +
           '&action=accept&token=' + encodeURIComponent(token))
        : '';
      const declineUrl = webAppUrl
        ? (webAppUrl + '?offer_id=' + encodeURIComponent(offerId) +
           '&action=decline&token=' + encodeURIComponent(token))
        : '';

      const sentAt = new Date();

      // Expiry = earlier of (sentAt + holdHours) or (block start + 5 min)
      const holdExpiry  = otAddHours_(sentAt, holdHours);
      const blockExpiry = new Date(block.startTime.getTime() + 5 * 60 * 1000);
      const expiresAt   = (blockExpiry < holdExpiry) ? blockExpiry : holdExpiry;

      if (!sendSlack && !sendEmails) {
        otAppendOfferRow_({
          offerId:    offerId,
          blockId:    block.blockId,
          date:       block.date,
          start:      block.start,
          end:        block.end,
          name:       person.name,
          email:      person.email,
          agentId:    person.agentId || '',
          queue:      block.queue,
          queueAppId: block.queueAppId,
          manager:    person.manager || '',
          sentAt:     sentAt,
          expiresAt:  expiresAt,
          holdHours:  holdHours,
          status:     OT_APP.OFFER_STATUSES.PENDING_SEND,
          token:      token,
          acceptUrl:  acceptUrl,
          declineUrl: declineUrl,
          slotIds:    block.slotIds.join(',')
        });
        SpreadsheetApp.flush();
        totalOffers++;
        otIncrementOfferHistory_(ctx.offersByEmail, person.email, sentAt);
        return;
      }

      let sent = false;
      try {
        if (sendSlack) {
          sent = otSendOfferSlack_({
            config:     config,
            offerId:    offerId,
            email:      person.email,
            name:       person.name,
            queue:      block.queue,
            date:       block.date,
            start:      block.start,
            end:        block.end,
            expiresAt:  expiresAt,
            acceptUrl:  acceptUrl,
            declineUrl: declineUrl
          });
        } else {
          sent = otSendOfferEmail_({
            config:     config,
            offerId:    offerId,
            email:      person.email,
            name:       person.name,
            queue:      block.queue,
            date:       block.date,
            start:      block.start,
            end:        block.end,
            expiresAt:  expiresAt,
            acceptUrl:  acceptUrl,
            declineUrl: declineUrl
          });
        }
      } catch (err) {
        otAudit_(sendSlack ? 'SEND_SLACK' : 'SEND_EMAIL', offerId,
          'Unhandled exception: ' + String(err), 'FAILED');
      }

      const finalStatus = sent
        ? OT_APP.OFFER_STATUSES.SENT
        : OT_APP.OFFER_STATUSES.SEND_FAILED;

      otAppendOfferRow_({
        offerId:    offerId,
        blockId:    block.blockId,
        date:       block.date,
        start:      block.start,
        end:        block.end,
        name:       person.name,
        email:      person.email,
        agentId:    person.agentId || '',
        queue:      block.queue,
        queueAppId: block.queueAppId,
        manager:    person.manager || '',
        sentAt:     sentAt,
        expiresAt:  expiresAt,
        holdHours:  holdHours,
        status:     finalStatus,
        token:      token,
        acceptUrl:  acceptUrl,
        declineUrl: declineUrl,
        slotIds:    block.slotIds.join(',')
      });
      SpreadsheetApp.flush();

      totalOffers++;
      if (sent) totalSent++;
      if (sent) otIncrementOfferHistory_(ctx.offersByEmail, person.email, sentAt);
    });
  });

  otAudit_('RUN', '',
    'Queues active: ' + ctx.enabledQueues.length +
    ' | OT blocks: ' + blocks.length +
    ' | Offers: ' + totalOffers +
    ' | Sent: ' + totalSent,
    'OK');
}

function expireOtOffersMenu() {
  const count = expireOtOffers_();
  SpreadsheetApp.getUi().alert('Expired ' + count + ' offer(s).');
}

function clearOtOffers() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.OFFERS);
  if (!sheet) return;
  otClearSheetBody_(sheet);
  SpreadsheetApp.getUi().alert('All offers cleared.');
}

/*************************************************************
 * OVERTIME REVIEW — daily snapshot (replaces manual roll-up)
 * Open = sum(published capacity) per 30-min slot; Filled = approved (+ optional
 * pending) capped at capacity — only on slots with capacity > 0 (matches
 * Assembled Extra work / Approved extra work rows). Superseded API rows with
 * capacity 0 and stale approvals are deduped out. SG order: AL, COL, ELD, HS, PC.
 *************************************************************/

/** capacity / approved / pending from overtime_slots (snake_case or camelCase). */
function otReviewSlotMetricNumbers_(slot) {
  const cap = Number(
    slot.capacity != null ? slot.capacity
      : (slot.capacity_count != null ? slot.capacity_count : 0)
  );
  const appr = Number(
    slot.num_approved_requests != null ? slot.num_approved_requests
      : (slot.numApprovedRequests != null ? slot.numApprovedRequests
        : (slot.approved_requests != null ? slot.approved_requests : 0))
  );
  const pend = Number(
    slot.num_pending_requests != null ? slot.num_pending_requests
      : (slot.numPendingRequests != null ? slot.numPendingRequests
        : (slot.pending_requests != null ? slot.pending_requests : 0))
  );
  return {
    capacity: isFinite(cap) ? cap : 0,
    approved: isFinite(appr) ? appr : 0,
    pending: isFinite(pend) ? pend : 0
  };
}

/**
 * Open/filled for one slot — aligned to Assembled Voluntary Time grid.
 * Returns null when capacity < 1 (no Extra work slot published that interval).
 */
function otReviewSlotOpenFilled_(slot, includePending) {
  const m = otReviewSlotMetricNumbers_(slot);
  if (m.capacity < 1) return null;
  const raw = includePending ? m.approved + m.pending : m.approved;
  return {
    capacity: m.capacity,
    filled: Math.max(0, Math.min(m.capacity, raw))
  };
}

/** One slot per start/end window — keep highest capacity (current publish). */
function otReviewDedupeSlotsByWindow_(slots) {
  const byKey = {};
  slots.forEach(function(slot) {
    const startMs = new Date(slot.start_time || slot.startTime).getTime();
    if (isNaN(startMs)) return;
    const endMs = new Date(slot.end_time || slot.endTime).getTime();
    const key = startMs + '\t' + (isNaN(endMs) ? '' : endMs);
    const cap = otReviewSlotMetricNumbers_(slot).capacity;
    const prev = byKey[key];
    if (!prev || otReviewSlotMetricNumbers_(prev).capacity < cap) {
      byKey[key] = slot;
    }
  });
  return Object.keys(byKey).map(function(k) { return byKey[k]; });
}

/** True if any queue still has remaining capacity (open − filled) that day. */
function otReviewDayHasOpenSeats_(agg, dateKey) {
  for (var i = 0; i < OT_APP.REVIEW_SG_ORDER.length; i++) {
    const sg = OT_APP.REVIEW_SG_ORDER[i];
    const c  = agg[dateKey + '\t' + sg] || { open: 0, filled: 0 };
    if (c.open - c.filled > 0) return true;
  }
  return false;
}

/** True when dateKey is in the OT_By_Hour window: N past days before today, or today through M days ahead. */
function otIsInHourReportWindow_(dayKey, todayStart, tz, lookbackDays, lookaheadDays) {
  const todayKey = Utilities.formatDate(todayStart, tz, 'yyyy-MM-dd');
  if (lookbackDays > 0) {
    const firstPastKey = otAddDaysToDateKey_(todayKey, -lookbackDays, tz);
    if (dayKey >= firstPastKey && dayKey < todayKey) return true;
  }
  const ahead = Math.max(0, Number(lookaheadDays) || 0);
  if (ahead >= 0) {
    const lastAheadKey = otAddDaysToDateKey_(todayKey, ahead, tz);
    if (dayKey >= todayKey && dayKey <= lastAheadKey) return true;
  }
  return false;
}

/** yyyy-MM-dd keys for OT_By_Hour: past N complete days, then today through M days ahead. */
function otHourReportDateKeys_(todayStart, tz, lookbackDays, lookaheadDays) {
  const todayKey = Utilities.formatDate(todayStart, tz, 'yyyy-MM-dd');
  const keys = [];
  const past = Math.max(0, Number(lookbackDays) || 0);
  for (var d = past; d >= 1; d--) {
    keys.push(otAddDaysToDateKey_(todayKey, -d, tz));
  }
  const ahead = Math.max(0, Number(lookaheadDays) || 0);
  for (var f = 0; f <= ahead; f++) {
    keys.push(otAddDaysToDateKey_(todayKey, f, tz));
  }
  return keys;
}

/** Display label for hour-of-day bucket (slot start, CT). */
function otHourBucketLabel_(slotStart, tz) {
  return Utilities.formatDate(slotStart, tz, 'h a');
}

/** Date keys for the N calendar days before today (excludes today). */
function otReviewBuildPastDateKeys_(todayStart, tz, lookbackDays) {
  if (!lookbackDays) return [];
  const todayKey = Utilities.formatDate(todayStart, tz, 'yyyy-MM-dd');
  const keys = [];
  for (var d = lookbackDays; d >= 1; d--) {
    keys.push(otAddDaysToDateKey_(todayKey, -d, tz));
  }
  return keys;
}

/**
 * Calendar days from windowStart for fetchDays length; trim after the first run
 * of blankStreak consecutive days with no open seats in any queue.
 */
function otReviewBuildDateKeysAfterBlankStreak_(windowStart, tz, fetchDays, agg, blankStreak) {
  const allKeys = [];
  var curKey = Utilities.formatDate(windowStart, tz, 'yyyy-MM-dd');
  for (var n = 0; n < fetchDays; n++) {
    allKeys.push(curKey);
    const cd = otBuildDateTime_(curKey, '12:00', tz);
    if (!cd || n === fetchDays - 1) break;
    curKey = Utilities.formatDate(new Date(cd.getTime() + 86400000), tz, 'yyyy-MM-dd');
  }

  const dateKeys = [];
  for (var i = 0; i < allKeys.length; i++) {
    if (i + blankStreak <= allKeys.length) {
      var streakAllBare = true;
      for (var j = 0; j < blankStreak; j++) {
        if (otReviewDayHasOpenSeats_(agg, allKeys[i + j])) {
          streakAllBare = false;
          break;
        }
      }
      if (streakAllBare) break;
    }
    dateKeys.push(allKeys[i]);
  }
  return dateKeys;
}

/**
 * Normalizes overtime_slots API payloads — some queues return { slots: [...] }
 * or a map instead of a bare array.
 */
function otCoerceOvertimeSlotsArray_(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.overtime_slots)) return parsed.overtime_slots;
  if (Array.isArray(parsed.slots)) return parsed.slots;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (typeof parsed === 'object') {
    var vals = Object.keys(parsed).map(function(k) { return parsed[k]; });
    var looksLikeSlot = function(x) {
      return x && (x.start_time || x.startTime) && (x.id || x.slot_id);
    };
    if (vals.length && vals.every(looksLikeSlot)) return vals;
  }
  return [];
}

/**
 * Fetches and aggregates OT slot data for Overtime_Review and Slack channel digests.
 * @param {Object} config
 * @param {{headless?: boolean}} [options]
 * @returns {{ok: boolean, error?: string, tz?: string, agg?: Object, dateKeys?: string[], rows?: Array, fetchDays?: number, lookbackDays?: number, blankStreak?: number, lastDayKey?: string, firstDayKey?: string}}
 */
function otBuildOvertimeReviewAgg_(config, options) {
  options = options || {};
  const tz     = config.TIMEZONE || 'America/Chicago';
  const reportMinDays = Math.max(1, Math.min(21, Number(config.REVIEW_REPORT_DAYS || 6)));
  const explicitFetch = Number(config.REVIEW_FETCH_DAYS || 0);
  const fetchDays = Math.max(1, Math.min(60, explicitFetch > 0
    ? explicitFetch
    : Math.max(reportMinDays, Number(config.LOOKAHEAD_DAYS || 3), 21)));
  const lookbackDays = Math.max(0, Math.min(30, Number(config.REVIEW_LOOKBACK_DAYS || 14)));
  const hourLookbackDays = Math.max(1, Math.min(30, Number(config.REVIEW_HOUR_LOOKBACK_DAYS || 7)));
  const hourLookaheadDays = Math.max(0, Math.min(30, Number(config.REVIEW_HOUR_LOOKAHEAD_DAYS || 7)));
  const includePending = otConfigBool_(config.REVIEW_FILLED_INCLUDES_PENDING, true);
  const blankStreak = Math.max(2, Math.min(10, Number(config.REVIEW_BLANK_STOP_STREAK || 3)));

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const fetchStart = new Date(todayStart.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const windowEndFetch = new Date(todayStart.getTime() + fetchDays * 24 * 60 * 60 * 1000);

  var sessionHeaders;
  try {
    sessionHeaders = otGetSessionHeaders_();
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  const agg = {};
  /** Last N complete days before today: key = dayKey + '\t' + sg + '\t' + hour (0–23). */
  const hourDayAgg = {};
  /** Same window, all SGs combined: key = dayKey + '\t' + hour. */
  const hourDayAllAgg = {};
  var sessionAlertSent = false;

  OT_APP.QUEUE_DEFS.forEach(function(qd) {
    const url = OT_APP.APP_BASE + '/overtime_slots'
      + '?start_time=' + encodeURIComponent(fetchStart.toISOString())
      + '&end_time='   + encodeURIComponent(windowEndFetch.toISOString())
      + '&channel=phone'
      + '&queue='      + encodeURIComponent(qd.queueAppId)
      + '&is_published=true';

    var resp;
    try {
      resp = UrlFetchApp.fetch(url, {
        method: 'get', headers: sessionHeaders, muteHttpExceptions: true
      });
      Utilities.sleep(300);
    } catch (err) {
      otAudit_('REVIEW_FETCH', qd.name, 'Fetch exception: ' + String(err), 'FAILED');
      return;
    }

    const code = resp.getResponseCode();
    if (code === 401) {
      otAudit_('REVIEW_FETCH', qd.name, 'Session expired (401)', 'FAILED');
      if (!sessionAlertSent) {
        otSendSessionExpiryAlert_(config);
        sessionAlertSent = true;
      }
      return;
    }
    if (code < 200 || code >= 300) {
      otAudit_('REVIEW_FETCH', qd.name, 'HTTP ' + code + ': ' + resp.getContentText().substring(0, 120), 'FAILED');
      return;
    }

    var slots;
    try {
      slots = otCoerceOvertimeSlotsArray_(JSON.parse(resp.getContentText()));
    } catch (pe) {
      otAudit_('REVIEW_FETCH', qd.name, 'JSON parse: ' + String(pe), 'FAILED');
      return;
    }

    slots = otReviewDedupeSlotsByWindow_(slots);

    slots.forEach(function(slot) {
      const slotStart = new Date(slot.start_time || slot.startTime);
      if (isNaN(slotStart.getTime())) return;
      if (slotStart.getTime() < fetchStart.getTime() || slotStart.getTime() >= windowEndFetch.getTime()) return;

      const counts = otReviewSlotOpenFilled_(slot, includePending);
      if (!counts) return;

      const dayKey = Utilities.formatDate(slotStart, tz, 'yyyy-MM-dd');
      const cap    = counts.capacity;
      const filled = counts.filled;

      const mapKey = dayKey + '\t' + qd.sg;
      if (!agg[mapKey]) agg[mapKey] = { open: 0, filled: 0 };
      agg[mapKey].open   += cap;
      agg[mapKey].filled += filled;

      if (otIsInHourReportWindow_(dayKey, todayStart, tz, hourLookbackDays, hourLookaheadDays)) {
        const hour = Number(Utilities.formatDate(slotStart, tz, 'H'));
        const hourDaySgKey = dayKey + '\t' + qd.sg + '\t' + hour;
        if (!hourDayAgg[hourDaySgKey]) hourDayAgg[hourDaySgKey] = { open: 0, filled: 0 };
        hourDayAgg[hourDaySgKey].open   += cap;
        hourDayAgg[hourDaySgKey].filled += filled;

        const hourDayAllKey = dayKey + '\t' + hour;
        if (!hourDayAllAgg[hourDayAllKey]) hourDayAllAgg[hourDayAllKey] = { open: 0, filled: 0 };
        hourDayAllAgg[hourDayAllKey].open   += cap;
        hourDayAllAgg[hourDayAllKey].filled += filled;
      }
    });

    otAudit_('REVIEW_FETCH', qd.name, 'Raw: ' + slots.length + ' slots → aggregated', 'INFO');
  });

  const pastDateKeys = otReviewBuildPastDateKeys_(todayStart, tz, lookbackDays);
  const forwardDateKeys = otReviewBuildDateKeysAfterBlankStreak_(
    todayStart, tz, fetchDays, agg, blankStreak);
  const dateKeys = pastDateKeys.concat(forwardDateKeys);
  const firstDayKey = dateKeys.length ? dateKeys[0] : '';
  const lastDayKey = dateKeys.length ? dateKeys[dateKeys.length - 1] : '';

  const rows = [];
  dateKeys.forEach(function(dateKey) {
    OT_APP.REVIEW_SG_ORDER.forEach(function(sg) {
      const cell = agg[dateKey + '\t' + sg] || { open: 0, filled: 0 };
      const pct  = cell.open > 0 ? (cell.filled / cell.open) : '';
      const dayDt = otBuildDateTime_(dateKey, '12:00', tz);
      const dayDisplay = dayDt
        ? Utilities.formatDate(dayDt, tz, 'M/d/yyyy')
        : dateKey;
      rows.push([sg, dayDisplay, cell.open, cell.filled, pct]);
    });
  });

  const hourLookbackKeys = otHourReportDateKeys_(todayStart, tz, hourLookbackDays, hourLookaheadDays);

  return {
    ok: true,
    tz: tz,
    agg: agg,
    hourDayAgg: hourDayAgg,
    hourDayAllAgg: hourDayAllAgg,
    hourLookbackDays: hourLookbackDays,
    hourLookaheadDays: hourLookaheadDays,
    hourLookbackKeys: hourLookbackKeys,
    dateKeys: dateKeys,
    rows: rows,
    fetchDays: fetchDays,
    lookbackDays: lookbackDays,
    blankStreak: blankStreak,
    firstDayKey: firstDayKey,
    lastDayKey: lastDayKey
  };
}

/** Writes Overtime_Review tab from otBuildOvertimeReviewAgg_ result. */
function otWriteOvertimeReviewSheet_(result, config) {
  const rows = result.rows || [];
  const dateKeys = result.dateKeys || [];
  const lastDayKey = result.lastDayKey || '';

  const sheet = otGetOrCreate_(OT_APP.SHEETS.OVERTIME_REVIEW);
  sheet.clear();
  sheet.clearConditionalFormatRules();

  sheet.getRange(1, 1, 1, 5).merge();
  sheet.getRange(1, 1).setValue('OVERTIME REVIEW')
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('center');
  sheet.getRange(1, 1, 1, 5).setBackground('#ffff00');

  const headers = ['SG', 'Day', 'Open slots (hours x2)', 'Filled (hours x2)', '% filled'];
  sheet.getRange(2, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

  const firstData = 3;
  if (rows.length) {
    sheet.getRange(firstData, 1, rows.length, 5).setValues(rows);
    sheet.getRange(firstData, 3, rows.length, 2).setNumberFormat('0');
    sheet.getRange(firstData, 5, rows.length, 1).setNumberFormat('0.00%');
  }

  otApplyOvertimeReviewConditionalFormat_(sheet, firstData, firstData + Math.max(0, rows.length - 1));
  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, 5);

  otAudit_('REVIEW_REPORT', '',
    'Lookback: ' + (result.lookbackDays || 0) + 'd | Fetch ahead: ' + result.fetchDays + 'd' +
    ' | Blank-stop streak: ' + result.blankStreak +
    ' | Table: ' + dateKeys.length + ' day(s) ' +
    (result.firstDayKey ? result.firstDayKey + ' \u2192 ' : '') + lastDayKey +
    ' | Rows: ' + rows.length,
    'OK');
}

/**
 * OT take rate by sales group, calendar day, and hour-of-day (slot start, CT)
 * for the last N complete days before today. Written alongside Overtime_Review.
 */
function otWriteOvertimeByHourSheet_(result, config) {
  const tz = result.tz || config.TIMEZONE || 'America/Chicago';
  const hourDayAgg = result.hourDayAgg || {};
  const hourDayAllAgg = result.hourDayAllAgg || {};
  const lookbackDays = result.hourLookbackDays || 7;
  const lookaheadDays = result.hourLookaheadDays || 7;
  const lookbackKeys = result.hourLookbackKeys || [];
  const firstKey = lookbackKeys.length ? lookbackKeys[0] : '';
  const lastKey = lookbackKeys.length ? lookbackKeys[lookbackKeys.length - 1] : '';
  const numCols = 6;
  const openCol = 'D';
  const filledCol = 'E';
  const pctCol = 'F';

  const sheet = otGetOrCreate_(OT_APP.SHEETS.OT_BY_HOUR);
  sheet.clear();
  sheet.clearConditionalFormatRules();

  var r = 1;
  sheet.getRange(r, 1, 1, numCols).merge();
  sheet.getRange(r, 1).setValue('OT TAKE RATE BY HOUR')
    .setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center')
    .setBackground('#1F6F44').setFontColor('#ffffff');
  r++;
  sheet.getRange(r, 1, 1, numCols).merge();
  sheet.getRange(r, 1).setValue(
    'Last ' + lookbackDays + ' complete day(s) before today, plus today and ' +
    lookaheadDays + ' day(s) ahead (' +
    (firstKey && lastKey ? firstKey + ' \u2192 ' + lastKey : 'n/a') +
    ') | Per day, per SG, per slot-start hour in ' + tz +
    ' | Open/filled = 30-min slot counts (hours \u00d7 2)'
  ).setWrap(true);
  r += 2;

  sheet.getRange(r, 1).setValue('All audiences').setFontWeight(true);
  r++;
  const allHeader = ['SG', 'Day', 'Hour (CT)', 'Open slots (hours x2)', 'Filled (hours x2)', '% filled'];
  sheet.getRange(r, 1, 1, allHeader.length).setValues([allHeader]).setFontWeight(true);
  r++;

  const allRows = [];
  var allDataStart = 0;
  lookbackKeys.forEach(function(dayKey) {
    const dayDisplay = otDayDisplay_(dayKey, tz);
    for (var h = 0; h < 24; h++) {
      const cell = hourDayAllAgg[dayKey + '\t' + h] || { open: 0, filled: 0 };
      if (cell.open < 1 && cell.filled < 1) continue;
      const sample = otBuildDateTime_(dayKey, otPad2_(h) + ':00', tz);
      const label = sample ? Utilities.formatDate(sample, tz, 'h a') : String(h);
      const pct = cell.open > 0 ? (cell.filled / cell.open) : '';
      allRows.push(['ALL', dayDisplay, label, cell.open, cell.filled, pct]);
    }
  });
  if (allRows.length) {
    allDataStart = r;
    sheet.getRange(r, 1, allRows.length, numCols).setValues(allRows);
    sheet.getRange(r, 4, allRows.length, 2).setNumberFormat('0');
    sheet.getRange(r, 6, allRows.length, 1).setNumberFormat('0.00%');
    r += allRows.length;
  } else {
    sheet.getRange(r, 1).setValue('No OT slots in lookback window.');
    r++;
  }
  r++;

  sheet.getRange(r, 1).setValue('By audience (SG)').setFontWeight(true);
  r++;
  const sgHeader = ['SG', 'Day', 'Hour (CT)', 'Open slots (hours x2)', 'Filled (hours x2)', '% filled'];
  sheet.getRange(r, 1, 1, sgHeader.length).setValues([sgHeader]).setFontWeight(true);
  r++;

  const sgRows = [];
  var sgDataStart = 0;
  lookbackKeys.forEach(function(dayKey2) {
    const dayDisplay2 = otDayDisplay_(dayKey2, tz);
    OT_APP.REVIEW_SG_ORDER.forEach(function(sg) {
      for (var h2 = 0; h2 < 24; h2++) {
        const cell2 = hourDayAgg[dayKey2 + '\t' + sg + '\t' + h2] || { open: 0, filled: 0 };
        if (cell2.open < 1 && cell2.filled < 1) continue;
        const sample2 = otBuildDateTime_(dayKey2, otPad2_(h2) + ':00', tz);
        const label2 = sample2 ? Utilities.formatDate(sample2, tz, 'h a') : String(h2);
        const pct2 = cell2.open > 0 ? (cell2.filled / cell2.open) : '';
        sgRows.push([sg, dayDisplay2, label2, cell2.open, cell2.filled, pct2]);
      }
    });
  });
  if (sgRows.length) {
    sgDataStart = r;
    sheet.getRange(r, 1, sgRows.length, numCols).setValues(sgRows);
    sheet.getRange(r, 4, sgRows.length, 2).setNumberFormat('0');
    sheet.getRange(r, 6, sgRows.length, 1).setNumberFormat('0.00%');
  } else {
    sheet.getRange(r, 1).setValue('No OT slots in lookback window.');
  }

  const cfRules = [];
  if (allDataStart && allRows.length) {
  cfRules.push.apply(cfRules, otBuildOvertimeReviewConditionalFormatRules_(
      sheet, allDataStart, allDataStart + allRows.length - 1, openCol, filledCol, pctCol, numCols));
  }
  if (sgDataStart && sgRows.length) {
    cfRules.push.apply(cfRules, otBuildOvertimeReviewConditionalFormatRules_(
      sheet, sgDataStart, sgDataStart + sgRows.length - 1, openCol, filledCol, pctCol, numCols));
  }
  if (cfRules.length) sheet.setConditionalFormatRules(cfRules);

  sheet.setFrozenRows(5);
  sheet.autoResizeColumns(1, numCols);

  otAudit_('REVIEW_BY_HOUR', '',
    'Hour lookback: ' + lookbackDays + 'd | ' +
    (firstKey ? firstKey + ' \u2192 ' + lastKey : 'empty') +
    ' | All-audience rows: ' + allRows.length +
    ' | SG rows: ' + sgRows.length,
    'OK');
}

/** M/d/yyyy display for a yyyy-MM-dd key in the workbook timezone. */
function otDayDisplay_(dayKey, tz) {
  const dayDt = otBuildDateTime_(dayKey, '12:00', tz);
  return dayDt ? Utilities.formatDate(dayDt, tz, 'M/d/yyyy') : dayKey;
}

/**
 * Menu + optional time trigger: rebuilds Overtime_Review tab from Assembled.
 * @param {{headless?: boolean}} [options]
 */
function runOvertimeReviewReport(options) {
  options = options || {};
  const config = otGetConfig_();
  const result = otBuildOvertimeReviewAgg_(config, options);
  if (!result.ok) {
    if (!options.headless) {
      try {
        SpreadsheetApp.getUi().alert('Session not configured: ' + (result.error || 'unknown'));
      } catch (uiErr) { /* headless */ }
    }
    return result;
  }
  otWriteOvertimeReviewSheet_(result, config);
  otWriteOvertimeByHourSheet_(result, config);
  if (!options.headless) {
    try {
      SpreadsheetApp.getUi().alert(
        'Overtime Review updated on “' + OT_APP.SHEETS.OVERTIME_REVIEW +
        '” (' + result.rows.length + ' rows, ' + result.dateKeys.length +
        ' day(s) ' + (result.firstDayKey || '') +
        (result.firstDayKey && result.lastDayKey ? ' → ' : '') +
        (result.lastDayKey || '') + ').\n\n' +
        'OT take rate by hour: “' + OT_APP.SHEETS.OT_BY_HOUR + '” (' +
        (result.hourLookbackDays || 7) + ' past days + today +' +
        (result.hourLookaheadDays || 7) + ' ahead, per SG/day/hour).'
      );
    } catch (uiErr) { /* headless */ }
  }
  return result;
}

/**
 * Row colors by % filled (pctCol): gray = no slots; red <50%; orange 50–70%;
 * yellow 71–83%; green >83% up to 100%.
 * @returns {GoogleAppsScript.Spreadsheet.ConditionalFormatRule[]}
 */
function otBuildOvertimeReviewConditionalFormatRules_(sheet, startRow, endRow, openCol, filledCol, pctCol, width) {
  if (endRow < startRow) return [];
  openCol = openCol || 'C';
  filledCol = filledCol || 'D';
  pctCol = pctCol || 'E';
  width = width || 5;
  const numRows = endRow - startRow + 1;
  const all = sheet.getRange(startRow, 1, numRows, width);
  const p = 'INDIRECT("' + pctCol + '"&ROW())';
  const o = 'INDIRECT("' + openCol + '"&ROW())';
  const rules = [];

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + o + '=0,' + 'INDIRECT("' + filledCol + '"&ROW())=0)')
    .setBackground('#d9d9d9')
    .setFontColor('#666666')
    .setRanges([all])
    .build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + o + '>0,' + p + '>0.83,' + p + '<=1)')
    .setBackground('#c6efce')
    .setFontColor('#006100')
    .setRanges([all])
    .build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + o + '>0,' + p + '>0.7,' + p + '<=0.83)')
    .setBackground('#fff2cc')
    .setFontColor('#7f6000')
    .setRanges([all])
    .build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + o + '>0,' + p + '>=0.5,' + p + '<=0.7)')
    .setBackground('#fce4d6')
    .setFontColor('#c65911')
    .setRanges([all])
    .build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + o + '>0,' + p + '<0.5)')
    .setBackground('#ffc7ce')
    .setFontColor('#9c0006')
    .setRanges([all])
    .build());

  return rules;
}

function otApplyOvertimeReviewConditionalFormat_(sheet, startRow, endRow, openCol, filledCol, pctCol, width) {
  const rules = otBuildOvertimeReviewConditionalFormatRules_(
    sheet, startRow, endRow, openCol, filledCol, pctCol, width);
  if (rules.length) sheet.setConditionalFormatRules(rules);
}

/*************************************************************
 * SALES MANAGER SLACK CHANNEL DIGESTS (2PM tomorrow / 5PM week)
 *************************************************************/

function otSlotsToHours_(slots) {
  return Math.round((Number(slots) || 0) * 5) / 10;
}

function otFillPct_(open, filled) {
  const o = Number(open) || 0;
  const f = Number(filled) || 0;
  if (o < 1) return null;
  return Math.round((f / o) * 1000) / 10;
}

function otFillRatio_(open, filled) {
  const o = Number(open) || 0;
  const f = Number(filled) || 0;
  if (o < 1) return null;
  return f / o;
}

function otProgressBar_(ratio) {
  if (ratio == null || !isFinite(ratio)) return '\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591';
  const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  var bar = '';
  for (var i = 0; i < 10; i += 1) {
    bar += i < filled ? '\u2588' : '\u2591';
  }
  return bar;
}

function otDateKeyCT_(date, tz) {
  return Utilities.formatDate(date || new Date(), tz, 'yyyy-MM-dd');
}

function otAddDaysToDateKey_(dateKey, days, tz) {
  const cd = otBuildDateTime_(dateKey, '12:00', tz);
  if (!cd) return dateKey;
  return Utilities.formatDate(new Date(cd.getTime() + days * 86400000), tz, 'yyyy-MM-dd');
}

function otCalendarDayRange_(startDateKey, count, tz) {
  const keys = [];
  var cur = startDateKey;
  for (var i = 0; i < count; i += 1) {
    keys.push(cur);
    cur = otAddDaysToDateKey_(cur, 1, tz);
  }
  return keys;
}

function otFormatDayLabelShort_(dateKey, tz) {
  const d = otBuildDateTime_(dateKey, '12:00', tz);
  if (!d) return dateKey;
  return Utilities.formatDate(d, tz, 'EEE M/d');
}

function otGetManagerChannelId_(config) {
  const fromConfig = String(config.MANAGER_CHANNEL_ID || '').trim();
  if (fromConfig) return fromConfig;
  return String(PropertiesService.getScriptProperties().getProperty('MANAGER_CHANNEL_ID') || '').trim();
}

function otGetOtClaimUrl_(config) {
  const custom = String(config.OT_CLAIM_URL || '').trim();
  if (custom) return custom;
  return otGetWebAppUrl_(config) || '';
}

function otChannelDigestActionLinks_(config) {
  const parts = [];
  const claimUrl = otGetOtClaimUrl_(config);
  if (claimUrl) parts.push(otSlackMrkdwnLink_(claimUrl, 'Claim OT on Nerd Desk'));
  try {
    const sheetUrl = SpreadsheetApp.getActive().getUrl();
    if (sheetUrl) parts.push(otSlackMrkdwnLink_(sheetUrl, 'Full OT review sheet'));
  } catch (e) { /* headless */ }
  return parts.length ? parts.join('   ·   ') : '';
}

function otChannelDigestRateLimitKey_(mode) {
  if (mode === 'tomorrow') return 'OT_CHANNEL_LAST_2PM';
  if (mode === 'morning') return 'OT_CHANNEL_LAST_8AM';
  return 'OT_CHANNEL_LAST_5PM';
}

function otChannelDigestAuditTag_(mode) {
  if (mode === 'tomorrow') return 'TOMORROW';
  if (mode === 'morning') return 'MORNING';
  return 'WEEK';
}

function otChannelDigestRateLimited_(mode, force) {
  if (force) return false;
  const props = PropertiesService.getScriptProperties();
  const propKey = otChannelDigestRateLimitKey_(mode);
  const config = otGetConfig_();
  const tz = config.TIMEZONE || 'America/Chicago';
  const today = otDateKeyCT_(new Date(), tz);
  return props.getProperty(propKey) === today;
}

function otMarkChannelDigestPosted_(mode) {
  const props = PropertiesService.getScriptProperties();
  const propKey = otChannelDigestRateLimitKey_(mode);
  const config = otGetConfig_();
  const tz = config.TIMEZONE || 'America/Chicago';
  props.setProperty(propKey, otDateKeyCT_(new Date(), tz));
}

function otCellHasUnfilledHours_(cell) {
  const open = Number(cell && cell.open) || 0;
  const filled = Number(cell && cell.filled) || 0;
  return open > 0 && filled < open;
}

function otChannelDigestHerePrefix_() {
  return '<!here>';
}

function otNaturalHoursShort_(hrs) {
  const n = Math.round(Number(hrs) * 10) / 10;
  return '~' + n + 'h';
}

function otJoinNaturalList_(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

function otTomorrowSummaryLine_(gapRows, tomorrowLabel) {
  if (!gapRows.length) {
    return 'Looking good for *' + tomorrowLabel + '* \u2014 nothing open that needs a push right now.';
  }
  var totalUnfilled = 0;
  gapRows.forEach(function(row) { totalUnfilled += row.unfilledHrs; });
  const names = gapRows.slice(0, 3).map(function(row) { return '*' + row.sg + '*'; });
  const total = Math.round(totalUnfilled * 10) / 10;
  return 'Quick look at *' + tomorrowLabel + '* \u2014 about *' + total +
    ' hours* still on the table. Would love help on ' + otJoinNaturalList_(names) + '.';
}

function otMorningSummaryLine_(dayCount, totalUnfilledHrs, startLabel, endLabel) {
  if (dayCount < 1) {
    return 'Looking clear from *' + startLabel + '* through *' + endLabel + '*.';
  }
  const dayWord = dayCount === 1 ? 'day' : 'days';
  return 'Open hours on *' + dayCount + ' ' + dayWord +
    '* in this window \u2014 roughly *' + totalUnfilledHrs + ' hours* still to pick up.';
}

function otWeekSummaryLine_(dayCount, totalUnfilledHrs, startLabel, endLabel) {
  if (dayCount < 1) {
    return 'Looking clear from *' + startLabel + '* through *' + endLabel + '*.';
  }
  const dayWord = dayCount === 1 ? 'day' : 'days';
  return 'Still seeing open hours on *' + dayCount + ' ' + dayWord +
    '* \u2014 roughly *' + totalUnfilledHrs + ' hours* to pick up across the week.';
}

function otFormatOtGapLine_(sg, cell, config) {
  const fillAlert = Number(config.CHANNEL_DIGEST_FILL_ALERT || 0.35);
  const ratio = otFillRatio_(cell.open, cell.filled);
  const fillPct = otFillPct_(cell.open, cell.filled);
  const unfilledHrs = otSlotsToHours_(cell.open - cell.filled);
  const warn = fillPct != null && fillPct < fillAlert * 100 ? ' \u26a0\ufe0f' : '';
  return '  *' + sg + '*  ' + otProgressBar_(ratio) + '  ' + fillPct + '% filled \u00b7 ' +
    otNaturalHoursShort_(unfilledHrs) + ' open' + warn;
}

/**
 * Day section showing only SGs that still have unfilled OT hours.
 * @returns {{text: string, dayUnfilledSlots: number, sgCount: number}|null}
 */
function otBuildDayNeedsSection_(dateKey, agg, config, tz) {
  const dayLabel = otFormatDayLabelShort_(dateKey, tz);
  var lines = [];
  var dayUnfilledSlots = 0;

  OT_APP.REVIEW_SG_ORDER.forEach(function(sg) {
    const cell = agg[dateKey + '\t' + sg] || { open: 0, filled: 0 };
    if (!otCellHasUnfilledHours_(cell)) return;
    dayUnfilledSlots += cell.open - cell.filled;
    lines.push(otFormatOtGapLine_(sg, cell, config));
  });

  if (!lines.length) return null;

  return {
    text: '*' + dayLabel + '*\n' + lines.join('\n'),
    dayUnfilledSlots: dayUnfilledSlots,
    sgCount: lines.length
  };
}

function otBuildTomorrowNeedsDigest_(aggResult, config) {
  const tz = aggResult.tz || config.TIMEZONE || 'America/Chicago';
  const agg = aggResult.agg || {};
  const minOpenHrs = Number(config.TOMORROW_MIN_OPEN_HOURS || 4);
  const postAllClear = otConfigBool_(config.TOMORROW_POST_ALL_CLEAR, false);
  const todayKey = otDateKeyCT_(new Date(), tz);
  const tomorrowKey = otAddDaysToDateKey_(todayKey, 1, tz);
  const tomorrowLabel = otFormatDayLabelShort_(tomorrowKey, tz);

  var gapRows = [];

  OT_APP.REVIEW_SG_ORDER.forEach(function(sg) {
    const cell = agg[tomorrowKey + '\t' + sg] || { open: 0, filled: 0 };
    if (!otCellHasUnfilledHours_(cell)) return;
    const unfilledHrs = otSlotsToHours_(cell.open - cell.filled);
    if (unfilledHrs < minOpenHrs) return;
    gapRows.push({
      sg: sg,
      open: cell.open,
      filled: cell.filled,
      unfilledHrs: unfilledHrs,
      fillPct: otFillPct_(cell.open, cell.filled)
    });
  });

  gapRows.sort(function(a, b) {
    return b.unfilledHrs - a.unfilledHrs ||
      (a.fillPct != null ? a.fillPct : 0) - (b.fillPct != null ? b.fillPct : 0);
  });

  const shouldPost = gapRows.length > 0 || postAllClear;
  if (!shouldPost) {
    return { text: '', blocks: [], shouldPost: false };
  }

  const summary = otTomorrowSummaryLine_(gapRows, tomorrowLabel);
  var bodyLines = [];
  if (gapRows.length) {
    gapRows.forEach(function(row) {
      bodyLines.push(otFormatOtGapLine_(row.sg, { open: row.open, filled: row.filled }, config));
    });
    bodyLines.push('');
    bodyLines.push('_If you have a minute, a nudge to your team before EOD would really help \u2014 thanks!_');
  }

  const body = otChannelDigestHerePrefix_() + '\n\nHey team \u2014 ' + summary +
    (bodyLines.length ? '\n\n' + bodyLines.join('\n') : '');
  const fallback = body;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: body.substring(0, 3000) } }
  ];

  return { text: fallback, blocks: blocks, shouldPost: true };
}

function otBuildMultiDayOutlookDigest_(aggResult, config, opts) {
  opts = opts || {};
  const tz = aggResult.tz || config.TIMEZONE || 'America/Chicago';
  const agg = aggResult.agg || {};
  const dayCount = Math.max(1, Math.min(14, Number(opts.dayCount || 7)));
  const startOffset = Math.max(0, Number(opts.startOffset != null ? opts.startOffset : 0));
  const todayKey = otDateKeyCT_(new Date(), tz);
  const rangeStart = otAddDaysToDateKey_(todayKey, startOffset, tz);
  const dateKeys = otCalendarDayRange_(rangeStart, dayCount, tz);
  const rangeEnd = dateKeys.length ? dateKeys[dateKeys.length - 1] : rangeStart;

  var sections = [];
  var unfilledSlots = 0;

  dateKeys.forEach(function(dateKey) {
    const section = otBuildDayNeedsSection_(dateKey, agg, config, tz);
    if (!section) return;
    sections.push(section.text);
    unfilledSlots += section.dayUnfilledSlots;
  });

  const startLabel = otFormatDayLabelShort_(rangeStart, tz);
  const endLabel = otFormatDayLabelShort_(rangeEnd, tz);

  if (!sections.length) {
    return { text: '', blocks: [], shouldPost: false };
  }

  const totalUnfilledHrs = otSlotsToHours_(unfilledSlots);
  const summary = opts.summaryLine(sections.length, totalUnfilledHrs, startLabel, endLabel);
  const intro = opts.introLine(startLabel, endLabel, dayCount);
  const body = otChannelDigestHerePrefix_() + '\n\n' + intro + '\n\n' + summary +
    '\n\n' + sections.join('\n\n');
  const fallback = body;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: body.substring(0, 3000) } }
  ];

  return { text: fallback, blocks: blocks, shouldPost: true };
}

function otBuildMorningOutlookDigest_(aggResult, config) {
  const days = Math.max(1, Math.min(7, Number(config.CHANNEL_MORNING_DAYS || 3)));
  return otBuildMultiDayOutlookDigest_(aggResult, config, {
    dayCount: days,
    startOffset: Number(config.CHANNEL_MORNING_START_DAY || 0),
    summaryLine: otMorningSummaryLine_,
    introLine: function(start, end, count) {
      return 'Hey team \u2014 next ' + count + ' days of OT (*' + start + ' \u2013 ' + end + '*).';
    }
  });
}

function otBuildWeekOutlookDigest_(aggResult, config) {
  return otBuildMultiDayOutlookDigest_(aggResult, config, {
    dayCount: Number(config.CHANNEL_WEEK_DAYS || 7),
    startOffset: Number(config.CHANNEL_WEEK_START_DAY || 0),
    summaryLine: otWeekSummaryLine_,
    introLine: function(start, end) {
      return 'Hey team \u2014 week-ahead OT (*' + start + ' \u2013 ' + end + '*).';
    }
  });
}

function otSendSlackChannelMessage_(channelId, text, blocks) {
  const token = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
  if (!token) throw new Error('SLACK_BOT_TOKEN is not set');
  if (!channelId) throw new Error('MANAGER_CHANNEL_ID is not set');

  const payload = { channel: channelId, text: text || 'OT Take Pulse' };
  if (blocks && blocks.length) payload.blocks = blocks;

  const resp = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const data = JSON.parse(resp.getContentText());
  if (!data.ok) throw new Error('chat.postMessage: ' + (data.error || 'unknown error'));
  return data;
}

/**
 * @param {'tomorrow'|'morning'|'week'} mode
 * @param {{force?: boolean, aggResult?: Object}} [options]
 */
function otPostManagerChannelDigest_(mode, options) {
  options = options || {};
  const config = otGetConfig_();
  const auditTag = otChannelDigestAuditTag_(mode);

  if (otChannelPostsPaused_(config)) {
    otAudit_('OT_CHANNEL_' + auditTag, '', 'CHANNEL_POSTS_PAUSED=TRUE — skipped', 'INFO');
    return { ok: false, skipped: true, reason: 'paused' };
  }

  if (!otConfigBool_(config.MANAGER_CHANNEL_SLACK, false)) {
    otAudit_('OT_CHANNEL_' + auditTag, '',
      'MANAGER_CHANNEL_SLACK is not TRUE — skipped', 'INFO');
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  if (otChannelDigestRateLimited_(mode, options.force)) {
    otAudit_('OT_CHANNEL_' + auditTag, '',
      'Rate limited — already posted today', 'INFO');
    return { ok: false, skipped: true, reason: 'rate_limited' };
  }

  const channelId = otGetManagerChannelId_(config);
  const token = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
  if (!token) {
    otAudit_('OT_CHANNEL_' + auditTag, '', 'SLACK_BOT_TOKEN missing', 'WARN');
    return { ok: false, skipped: true, reason: 'no_token' };
  }
  if (!channelId) {
    otAudit_('OT_CHANNEL_' + auditTag, '', 'MANAGER_CHANNEL_ID missing', 'WARN');
    return { ok: false, skipped: true, reason: 'no_channel' };
  }

  const aggResult = options.aggResult || otBuildOvertimeReviewAgg_(config, { headless: true });
  if (!aggResult.ok) {
    otAudit_('OT_CHANNEL_' + auditTag, '',
      'Agg failed: ' + (aggResult.error || 'unknown'), 'FAILED');
    return { ok: false, skipped: true, reason: 'agg_failed' };
  }

  var digest;
  if (mode === 'tomorrow') {
    digest = otBuildTomorrowNeedsDigest_(aggResult, config);
  } else if (mode === 'morning') {
    digest = otBuildMorningOutlookDigest_(aggResult, config);
  } else {
    digest = otBuildWeekOutlookDigest_(aggResult, config);
  }

  if (!digest.shouldPost) {
    otAudit_('OT_CHANNEL_' + auditTag, '', 'No qualifying content — post skipped', 'INFO');
    return { ok: false, skipped: true, reason: 'nothing_to_post' };
  }

  try {
    otSendSlackChannelMessage_(channelId, digest.text, digest.blocks);
    otMarkChannelDigestPosted_(mode);
    otAudit_('OT_CHANNEL_' + auditTag, channelId, 'Posted to channel | mode=' + mode, 'OK');
    return { ok: true };
  } catch (err) {
    otAudit_('OT_CHANNEL_' + auditTag, '', String(err), 'FAILED');
    return { ok: false, error: String(err) };
  }
}

/** Time trigger ~8AM CT: refresh review + post next-3-days outlook. */
function runOtChannelMorningOutlook_() {
  const result = runOvertimeReviewReport({ headless: true });
  if (!result || !result.ok) return;
  otPostManagerChannelDigest_('morning', { aggResult: result });
}

/** Time trigger ~2PM CT: refresh review + post tomorrow needs. */
function runOtChannelTomorrowNeeds_() {
  const result = runOvertimeReviewReport({ headless: true });
  if (!result || !result.ok) return;
  otPostManagerChannelDigest_('tomorrow', { aggResult: result });
}

/** Time trigger ~5PM CT: refresh review + post 7-day outlook. */
function runOtChannelWeekOutlook_() {
  const result = runOvertimeReviewReport({ headless: true });
  if (!result || !result.ok) return;
  otPostManagerChannelDigest_('week', { aggResult: result });
}

function otPostMorningOutlookMenu_() {
  const ui = SpreadsheetApp.getUi();
  const result = runOvertimeReviewReport({ headless: true });
  if (!result || !result.ok) {
    ui.alert('Could not refresh Overtime Review: ' + (result && result.error ? result.error : 'unknown'));
    return;
  }
  const post = otPostManagerChannelDigest_('morning', { force: true, aggResult: result });
  if (post.ok) {
    ui.alert('3-day OT outlook posted to Sales Manager channel.');
  } else if (post.reason === 'nothing_to_post') {
    ui.alert('No open OT gaps in the next 3 days — nothing posted.');
  } else if (post.reason === 'disabled') {
    ui.alert('Set Config MANAGER_CHANNEL_SLACK=TRUE and MANAGER_CHANNEL_ID.');
  } else {
    ui.alert('Post skipped or failed: ' + (post.reason || post.error || 'unknown'));
  }
}

function otPostTomorrowNeedsMenu_() {
  const ui = SpreadsheetApp.getUi();
  const result = runOvertimeReviewReport({ headless: true });
  if (!result || !result.ok) {
    ui.alert('Could not refresh Overtime Review: ' + (result && result.error ? result.error : 'unknown'));
    return;
  }
  const post = otPostManagerChannelDigest_('tomorrow', { force: true, aggResult: result });
  if (post.ok) {
    ui.alert('Tomorrow OT needs posted to Sales Manager channel.');
  } else if (post.reason === 'nothing_to_post') {
    ui.alert('No major OT gaps for tomorrow — nothing posted.');
  } else if (post.reason === 'disabled') {
    ui.alert('Set Config MANAGER_CHANNEL_SLACK=TRUE and MANAGER_CHANNEL_ID.');
  } else {
    ui.alert('Post skipped or failed: ' + (post.reason || post.error || 'unknown'));
  }
}

function otPostWeekOutlookMenu_() {
  const ui = SpreadsheetApp.getUi();
  const result = runOvertimeReviewReport({ headless: true });
  if (!result || !result.ok) {
    ui.alert('Could not refresh Overtime Review: ' + (result && result.error ? result.error : 'unknown'));
    return;
  }
  const post = otPostManagerChannelDigest_('week', { force: true, aggResult: result });
  if (post.ok) {
    ui.alert('7-day OT outlook posted to Sales Manager channel.');
  } else if (post.reason === 'nothing_to_post') {
    ui.alert('No open OT gaps in the next 7 days — nothing posted.');
  } else if (post.reason === 'disabled') {
    ui.alert('Set Config MANAGER_CHANNEL_SLACK=TRUE and MANAGER_CHANNEL_ID.');
  } else {
    ui.alert('Post skipped or failed: ' + (post.reason || post.error || 'unknown'));
  }
}

/*************************************************************
 * CHANNEL DIGEST TRIGGERS — install / remove daily 8AM + 2PM + 5PM
 *
 * Run otInstallChannelDigestTriggers_() once (or use the menu).
 * Trigger times use Config CHANNEL_8AM_* / CHANNEL_2PM_* / CHANNEL_5PM_*
 * and run in the Apps Script *project timezone* — set that to Config TIMEZONE.
 *************************************************************/

const OT_CHANNEL_DIGEST_HANDLERS_ = [
  'runOtChannelMorningOutlook_',
  'runOtChannelTomorrowNeeds_',
  'runOtChannelWeekOutlook_'
];

function otPad2_(n) {
  n = Number(n) || 0;
  return n < 10 ? '0' + n : String(n);
}

/** Apps Script nearMinute only supports 0, 15, 30, 45. */
function otSnapTriggerMinute_(minute) {
  const m = Math.max(0, Math.min(59, Number(minute) || 0));
  if (m < 8) return 0;
  if (m < 23) return 15;
  if (m < 38) return 30;
  if (m < 53) return 45;
  return 0;
}

function otSnapTriggerHourMinute_(hour, minute) {
  return {
    hour: Math.max(0, Math.min(23, Number(hour) || 0)),
    minute: otSnapTriggerMinute_(minute)
  };
}

function otRemoveTriggersForHandlers_(handlerNames) {
  const want = {};
  handlerNames.forEach(function(name) { want[name] = true; });
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (want[trigger.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });
  return removed;
}

function otChannelDigestTriggerSchedule_(config) {
  const tz = String(config.TIMEZONE || 'America/Chicago');
  const t8 = otSnapTriggerHourMinute_(
    config.CHANNEL_8AM_HOUR_CT || 8,
    config.CHANNEL_8AM_MINUTE_CT || 0
  );
  const t2 = otSnapTriggerHourMinute_(
    config.CHANNEL_2PM_HOUR_CT || 14,
    config.CHANNEL_2PM_MINUTE_CT || 0
  );
  const t5 = otSnapTriggerHourMinute_(
    config.CHANNEL_5PM_HOUR_CT || 17,
    config.CHANNEL_5PM_MINUTE_CT || 0
  );
  return {
    timezone: tz,
    morning: { handler: 'runOtChannelMorningOutlook_', hour: t8.hour, minute: t8.minute },
    tomorrow: { handler: 'runOtChannelTomorrowNeeds_', hour: t2.hour, minute: t2.minute },
    week: { handler: 'runOtChannelWeekOutlook_', hour: t5.hour, minute: t5.minute }
  };
}

/** Removes old channel digest triggers and creates fresh daily 8AM + 2PM + 5PM triggers. */
function otInstallChannelDigestTriggers_() {
  const config = otGetConfig_();
  const schedule = otChannelDigestTriggerSchedule_(config);

  otRemoveTriggersForHandlers_(OT_CHANNEL_DIGEST_HANDLERS_);

  ScriptApp.newTrigger(schedule.morning.handler)
    .timeBased()
    .everyDays(1)
    .atHour(schedule.morning.hour)
    .nearMinute(schedule.morning.minute)
    .create();

  ScriptApp.newTrigger(schedule.tomorrow.handler)
    .timeBased()
    .everyDays(1)
    .atHour(schedule.tomorrow.hour)
    .nearMinute(schedule.tomorrow.minute)
    .create();

  ScriptApp.newTrigger(schedule.week.handler)
    .timeBased()
    .everyDays(1)
    .atHour(schedule.week.hour)
    .nearMinute(schedule.week.minute)
    .create();

  otAudit_('CHANNEL_TRIGGERS', '',
    'Installed ' + schedule.morning.handler + ' @ ' +
    schedule.morning.hour + ':' + otPad2_(schedule.morning.minute) + ', ' +
    schedule.tomorrow.handler + ' @ ' +
    schedule.tomorrow.hour + ':' + otPad2_(schedule.tomorrow.minute) + ', ' +
    schedule.week.handler + ' @ ' +
    schedule.week.hour + ':' + otPad2_(schedule.week.minute) +
    ' (project TZ should be ' + schedule.timezone + ')',
    'OK');

  return schedule;
}

/** Deletes daily channel digest triggers only. */
function otRemoveChannelDigestTriggers_() {
  const removed = otRemoveTriggersForHandlers_(OT_CHANNEL_DIGEST_HANDLERS_);
  otAudit_('CHANNEL_TRIGGERS', '', 'Removed ' + removed + ' channel digest trigger(s)', 'OK');
  return removed;
}

function otSetupChannelDigestTriggersMenu_() {
  const ui = SpreadsheetApp.getUi();
  const config = otGetConfig_();
  const tz = String(config.TIMEZONE || 'America/Chicago');
  const schedule = otInstallChannelDigestTriggers_();
  ui.alert([
    'Channel digest triggers installed.',
    '',
    'Morning (3-day): ' + schedule.morning.handler + ' — daily at ' +
      schedule.morning.hour + ':' + otPad2_(schedule.morning.minute),
    'Tomorrow: ' + schedule.tomorrow.handler + ' — daily at ' +
      schedule.tomorrow.hour + ':' + otPad2_(schedule.tomorrow.minute),
    'Week (7-day): ' + schedule.week.handler + ' — daily at ' +
      schedule.week.hour + ':' + otPad2_(schedule.week.minute),
    '',
    'Triggers run in the Apps Script *project timezone*.',
    'Set Apps Script → Project Settings → Time zone to: ' + tz,
    '',
    'To change times later, edit Config CHANNEL_8AM_* / CHANNEL_2PM_* / CHANNEL_5PM_*',
    'and run this menu item again.'
  ].join('\n'));
}

function otRemoveChannelDigestTriggersMenu_() {
  const ui = SpreadsheetApp.getUi();
  const removed = otRemoveChannelDigestTriggers_();
  ui.alert('Removed ' + removed + ' channel digest trigger(s).');
}

/*************************************************************
 * SLACK SLASH COMMAND — /ops (OT_By_Hour gaps by SG/hour)
 * Workbook: Targeted OT Bot → tab OT_By_Hour (gid 473477945)
 * Channel: #ops-for-sales-managers
 *************************************************************/

function otGetOtByHourSheetUrl_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(OT_APP.SHEETS.OT_BY_HOUR);
  const gid = sheet ? sheet.getSheetId() : 473477945;
  return ss.getUrl().replace(/#.*$/, '') + '#gid=' + gid;
}

function otShowSlackSlashSetupMenu_() {
  const config = otGetConfig_();
  const webUrl = otGetWebAppUrl_(config) || '(deploy web app and set OT_WEB_APP_URL)';
  const channelId = otGetManagerChannelId_(config) || '(set MANAGER_CHANNEL_ID)';
  const channelName = String(config.MANAGER_CHANNEL_NAME || 'ops-for-sales-managers').trim();
  SpreadsheetApp.getUi().alert([
    '/ops — OT gaps by sales group from OT_By_Hour tab',
    '',
    'Workbook: Targeted OT Bot (this file)',
    'Tab: OT_By_Hour (hourly view)',
    'Channel: #' + channelName,
    '',
    '1. Slack app → Slash Commands → /ops',
    '   Request URL: ' + webUrl,
    '   Usage hint: [high school | COL tomorrow | gaps for AL]',
    '',
    '2. Config: CHANNEL_SLASH_ENABLED=TRUE',
    '   MANAGER_CHANNEL_NAME=' + channelName,
    '   MANAGER_CHANNEL_ID=' + channelId,
    '',
    '3. Redeploy web app (Execute as: Me, Anyone can access)',
    '',
    'Examples in #' + channelName + ':',
    '  /ops what are high school ot needs like?',
    '  /ops when does COL need OT?',
    '  /ops what gaps are left for AL',
    '  /ops ELD tomorrow'
  ].join('\n'));
}

function otParseSlackSlashParamsFromDoPost_(e) {
  const params = (e && e.parameter) || {};
  const command = String(params.command || '').trim().toLowerCase();
  if (!command) return null;
  return {
    command: command,
    text: String(params.text || '').trim(),
    channelId: String(params.channel_id || '').trim(),
    channelName: String(params.channel_name || '').trim(),
    userId: String(params.user_id || '').trim(),
    userName: String(params.user_name || '').trim(),
    responseUrl: String(params.response_url || '').trim(),
    triggerId: String(params.trigger_id || '').trim(),
    token: String(params.token || '').trim(),
    teamId: String(params.team_id || '').trim()
  };
}

function otVerifySlackSlashRequest_(params, e) {
  const props = PropertiesService.getScriptProperties();
  const expectedToken = (props.getProperty('OT_SLACK_VERIFICATION_TOKEN') || '').trim();
  if (expectedToken && String(params.token || '') !== expectedToken) {
    return { ok: false, error: 'Invalid Slack verification token.' };
  }

  const signingSecret = (props.getProperty('OT_SLACK_SIGNING_SECRET') || '').trim();
  if (signingSecret && e && e.postData && e.postData.contents) {
    const headers = (e && e.headers) || {};
    const slackSig = String(headers['X-Slack-Signature'] || headers['x-slack-signature'] || '').trim();
    const slackTs = String(headers['X-Slack-Request-Timestamp'] || headers['x-slack-request-timestamp'] || '').trim();
    if (!slackSig || !slackTs) {
      return { ok: false, error: 'Missing Slack signature headers.' };
    }
    const ageSec = Math.abs(Number(new Date()) / 1000 - Number(slackTs));
    if (ageSec > 60 * 5) {
      return { ok: false, error: 'Slack request timestamp too old.' };
    }
    const base = 'v0:' + slackTs + ':' + e.postData.contents;
    const digest = Utilities.computeHmacSha256Signature(base, signingSecret);
    const hex = digest.map(function(b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
    const computed = 'v0=' + hex;
    if (computed !== slackSig) {
      return { ok: false, error: 'Invalid Slack signature.' };
    }
  }

  return { ok: true };
}

function otChannelPostsPaused_(config) {
  return otConfigBool_(config.CHANNEL_POSTS_PAUSED, false);
}

function otSlackSlashEnabled_(config) {
  if (otChannelPostsPaused_(config)) return false;
  if (!otConfigBool_(config.CHANNEL_SLASH_ENABLED, true)) return false;
  if (!otConfigBool_(config.MANAGER_CHANNEL_SLACK, false)) return false;
  return true;
}

function otSlackSlashChannelAllowed_(params, config) {
  if (!otConfigBool_(config.CHANNEL_SLASH_RESTRICT_CHANNEL, true)) return true;
  const allowedId = otGetManagerChannelId_(config);
  if (allowedId && params.channelId === allowedId) return true;
  const allowedName = String(config.MANAGER_CHANNEL_NAME || 'ops-for-sales-managers').trim().toLowerCase();
  const channelName = String(params.channelName || '').trim().toLowerCase();
  if (allowedName && channelName === allowedName) return true;
  return false;
}

/** Fuzzy SG phrases → code (longest/most specific phrases first). */
function otSlashSgAliasRules_() {
  return [
    { sg: 'HS', re: [/\bhigh\s*schools?\b/i, /\bhighschool\b/i] },
    { sg: 'AL', re: [
      /\badult\s*learn(?:ing|ers?)\b/i,
      /\blanguages?\s*(?:\+|and|&)\s*core\b/i,
      /\blang(?:uage)?\s*(?:\+|and|&)\s*core\b/i
    ]},
    { sg: 'ELD', re: [/\belementary\b/i] },
    { sg: 'COL', re: [/\bcollege\b/i] },
    { sg: 'PC', re: [/\bparent\s*consults?\b/i] }
  ];
}

function otResolveSlashSg_(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  var i;
  var j;
  const rules = otSlashSgAliasRules_();
  for (i = 0; i < rules.length; i += 1) {
    for (j = 0; j < rules[i].re.length; j += 1) {
      if (rules[i].re[j].test(raw)) return rules[i].sg;
    }
  }
  var sg = '';
  OT_APP.REVIEW_SG_ORDER.forEach(function(code) {
    if (sg) return;
    if (new RegExp('\\b' + code + '\\b', 'i').test(raw)) sg = code;
  });
  return sg;
}

/** Parse /ops text — e.g. "what are high school ot needs like?", "COL tomorrow". */
function otParseSlashOtQuery_(text) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  const sg = otResolveSlashSg_(raw);
  var scope = 'upcoming';
  if (/\btomorrow\b|\btmrw\b|\btom\b/.test(lower)) scope = 'tomorrow';
  else if (/\btoday\b/.test(lower)) scope = 'today';
  else if (/\bweek\b|\b7[\s-]?day/.test(lower)) scope = 'week';
  else if (/\b3[\s-]?day|\b3day\b/.test(lower)) scope = '3day';

  const detail = /\b(detail|all hours|verbose|breakdown|hour by hour)\b/i.test(raw);

  return { sg: sg, scope: scope, raw: raw, detail: detail };
}

function otParseOtByHourSheetDateKey_(display, tz) {
  const s = String(display || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const iso = m[3] + '-' + otPad2_(Number(m[1])) + '-' + otPad2_(Number(m[2]));
  return otBuildDateTime_(iso, '12:00', tz) ? iso : '';
}

function otFindOtByHourSgDataStart_(values) {
  var headerCount = 0;
  for (var i = 0; i < values.length; i++) {
    const a = String(values[i][0] || '').trim();
    const b = String(values[i][1] || '').trim();
    if (a === 'SG' && b === 'Day' && String(values[i][2] || '').indexOf('Hour') !== -1) {
      headerCount += 1;
      if (headerCount >= 2) return i + 1;
    }
  }
  return -1;
}

function otLoadOtByHourFromSheet_(config) {
  const tz = config.TIMEZONE || 'America/Chicago';
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.OT_BY_HOUR);
  if (!sheet) {
    return { ok: false, error: 'OT_By_Hour tab not found — run Targeted OT → Refresh Overtime Review.' };
  }

  const values = sheet.getDataRange().getValues();
  const start = otFindOtByHourSgDataStart_(values);
  if (start < 0) {
    return { ok: false, error: 'OT_By_Hour SG table not found — refresh Overtime Review first.' };
  }

  const rows = [];
  for (var r = start; r < values.length; r++) {
    const sg = String(values[r][0] || '').trim().toUpperCase();
    if (!sg || sg === 'SG' || OT_APP.REVIEW_SG_ORDER.indexOf(sg) === -1) continue;

    const dayDisplay = String(values[r][1] || '').trim();
    const hourLabel = String(values[r][2] || '').trim();
    const openSlots = Number(values[r][3]) || 0;
    const filledSlots = Number(values[r][4]) || 0;
    if (openSlots < 1 || !dayDisplay || !hourLabel) continue;
    if (!/^\d{1,2}:\d{2}\s*[AP]M$/i.test(hourLabel)) continue;

    const dateKey = otParseOtByHourSheetDateKey_(dayDisplay, tz);
    if (!dateKey) continue;

    const gapSlots = Math.max(0, openSlots - filledSlots);
    var pctFilled = '';
    if (typeof values[r][5] === 'number') {
      pctFilled = Math.round(values[r][5] * 100) + '%';
    } else {
      pctFilled = String(values[r][5] || '').trim();
    }

    rows.push({
      sg: sg,
      dateKey: dateKey,
      dayDisplay: dayDisplay,
      hourLabel: hourLabel,
      openSlots: openSlots,
      filledSlots: filledSlots,
      gapSlots: gapSlots,
      gapHours: gapSlots / 2,
      pctFilled: pctFilled,
      hasGap: gapSlots >= 1
    });
  }

  return { ok: true, rows: rows, tz: tz, sheetUrl: otGetOtByHourSheetUrl_() };
}

/** @deprecated alias — prefer otLoadOtByHourFromSheet_ + gap filter */
function otLoadOtByHourGapsFromSheet_(config) {
  const loadResult = otLoadOtByHourFromSheet_(config);
  if (!loadResult.ok) return loadResult;
  return {
    ok: true,
    rows: (loadResult.rows || []).filter(function(row) { return row.hasGap; }),
    allRows: loadResult.rows,
    tz: loadResult.tz,
    sheetUrl: loadResult.sheetUrl
  };
}

function otSlashQueryDateKeys_(scope, config, tz) {
  const todayKey = otDateKeyCT_(new Date(), tz);
  if (scope === 'today') return [todayKey];
  if (scope === 'tomorrow') return [otAddDaysToDateKey_(todayKey, 1, tz)];
  if (scope === '3day') {
    return [todayKey, otAddDaysToDateKey_(todayKey, 1, tz), otAddDaysToDateKey_(todayKey, 2, tz)];
  }
  if (scope === 'week') {
    return otCalendarDayRange_(todayKey, Number(config.CHANNEL_WEEK_DAYS || 7) || 7, tz);
  }
  const ahead = Number(config.REVIEW_HOUR_LOOKAHEAD_DAYS || 7) || 7;
  return otCalendarDayRange_(todayKey, ahead + 1, tz);
}

function otFilterOtByHourRowsForQuery_(allRows, query, config, tz, gapsOnly) {
  const allowedKeys = otSlashQueryDateKeys_(query.scope, config, tz);
  const keySet = {};
  allowedKeys.forEach(function(k) { keySet[k] = true; });
  const todayKey = otDateKeyCT_(new Date(), tz);

  return allRows.filter(function(row) {
    if (query.sg && row.sg !== query.sg) return false;
    if (query.scope === 'upcoming' && row.dateKey < todayKey) return false;
    if (query.scope !== 'upcoming' && !keySet[row.dateKey]) return false;
    if (gapsOnly && !row.hasGap) return false;
    return true;
  }).sort(function(a, b) {
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    return otHourLabelToMinutes_(a.hourLabel) - otHourLabelToMinutes_(b.hourLabel);
  });
}

function otFilterOtByHourGapsForQuery_(allRows, query, config, tz) {
  return otFilterOtByHourRowsForQuery_(allRows, query, config, tz, true);
}

/** "7:00 AM" → minutes from midnight for chronological sort. */
function otHourLabelToMinutes_(label) {
  const m = String(label || '').trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!m) return -1;
  var h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3] === 'PM' && h !== 12) h += 12;
  if (m[3] === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function otSgDisplayName_(sg) {
  const map = { AL: 'Adult Learning', COL: 'College', ELD: 'Elementary', HS: 'High School', PC: 'Parent Consult' };
  return map[sg] || sg;
}

function otAggregateSgDayTotals_(rows) {
  const byDay = {};
  rows.forEach(function(row) {
    if (!byDay[row.dateKey]) {
      byDay[row.dateKey] = { open: 0, filled: 0, gapSlots: 0 };
    }
    byDay[row.dateKey].open += row.openSlots;
    byDay[row.dateKey].filled += row.filledSlots;
    byDay[row.dateKey].gapSlots += row.gapSlots;
  });
  return byDay;
}

function otBuildSlashSgDayBar_(dayLabel, open, filled, config, isToday) {
  const fillAlert = Number(config.CHANNEL_DIGEST_FILL_ALERT || 0.35);
  const ratio = otFillRatio_(open, filled);
  const fillPct = otFillPct_(open, filled);
  const unfilledHrs = otSlotsToHours_(open - filled);
  const warn = fillPct != null && fillPct < fillAlert * 100 ? ' \u26a0\ufe0f' : '';
  const todayTag = isToday ? ' \u00b7 *today*' : '';
  return '*' + dayLabel + '*' + todayTag + '\n  ' + otProgressBar_(ratio) + '  ' +
    fillPct + '% filled \u00b7 ' + otNaturalHoursShort_(unfilledHrs) + ' open' + warn;
}

function otHourLabelShort_(label) {
  return String(label || '').replace(':00 ', ' ');
}

function otBuildSlashOtCommitLine_(sg, gapRows, todayKey, tz) {
  if (!gapRows.length) return '';
  var hourGap = {};
  var dayGap = {};
  var totalHr = 0;
  gapRows.forEach(function(row) {
    totalHr += row.gapHours;
    const hourKey = otHourLabelShort_(row.hourLabel);
    hourGap[hourKey] = (hourGap[hourKey] || 0) + row.gapHours;
    dayGap[row.dateKey] = (dayGap[row.dateKey] || 0) + row.gapHours;
  });
  totalHr = Math.round(totalHr * 10) / 10;

  const topHours = Object.keys(hourGap).sort(function(a, b) {
    return hourGap[b] - hourGap[a];
  }).slice(0, 2);
  const topDays = Object.keys(dayGap).sort(function(a, b) {
    return dayGap[b] - dayGap[a];
  }).slice(0, 2);

  const dayLabels = topDays.map(function(key) {
    if (key === todayKey) return '*today*';
    return '*' + otFormatDayLabelShort_(key, tz) + '*';
  });
  const hourPhrase = topHours.length > 1
    ? '*' + topHours.join('* and *') + '* blocks'
    : '*' + (topHours[0] || 'peak hours') + '*';

  return '*' + sg + '* (' + otSgDisplayName_(sg) + ') still has ~*' + totalHr + 'h* open. ' +
    'Best push for OT commits: ' + otJoinNaturalList_(dayLabels) + ', especially ' + hourPhrase + '.';
}

function otBuildSlashDetailLines_(gapRows, maxLines) {
  const sorted = gapRows.slice().sort(function(a, b) { return b.gapHours - a.gapHours; });
  const lines = [];
  var n = 0;
  sorted.forEach(function(row) {
    if (n >= maxLines) return;
    lines.push('• ' + otHourLabelShort_(row.hourLabel) + ' — ' + otFormatGapHours_(row.gapHours) + 'h open');
    n += 1;
  });
  if (sorted.length > maxLines) {
    lines.push('_+' + (sorted.length - maxLines) + ' more hours in OT_By_Hour_');
  }
  return lines;
}

function otFormatGapHours_(hours) {
  if (hours === Math.floor(hours)) return String(hours);
  return hours.toFixed(1).replace(/\.0$/, '');
}

function otBuildSlashOtHelpText_() {
  return [
    '*`/ops`* — OT outlook by sales group (from `OT_By_Hour`)',
    '',
    'Examples: `/ops high school` · `/ops language and core` · `/ops COL tomorrow`',
    'Groups: *AL* (adult learning / languages & core), *COL*, *ELD*, *HS*, *PC*'
  ].join('\n');
}

function otBuildOtByHourGapSlackAnswer_(query, loadResult, config) {
  const tz = loadResult.tz || config.TIMEZONE || 'America/Chicago';
  const sheetLink = loadResult.sheetUrl || otGetOtByHourSheetUrl_();
  const todayKey = otDateKeyCT_(new Date(), tz);
  const allRows = loadResult.rows || [];
  const maxDays = Math.max(3, Math.min(10, Number(config.SLASH_MAX_DAYS || 7) || 7));
  const gapRows = otFilterOtByHourGapsForQuery_(allRows, query, config, tz);

  if (!query.sg) {
    return {
      text: otBuildSlashOtHelpText_(),
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: otBuildSlashOtHelpText_() } }]
    };
  }

  if (!gapRows.length) {
    const scopeLabel = query.scope === 'tomorrow' ? 'tomorrow'
      : query.scope === 'today' ? 'today'
      : query.scope === 'week' ? 'this week'
      : 'the upcoming window';
    const msg = '\u2705 *' + query.sg + '* — no open OT gaps in ' + scopeLabel + '.';
    return {
      text: msg,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: msg } }]
    };
  }

  const dayTotals = otAggregateSgDayTotals_(gapRows);
  const dayKeys = Object.keys(dayTotals).sort();
  const windowStart = dayKeys.length ? otFormatDayLabelShort_(dayKeys[0], tz) : '';
  const windowEnd = dayKeys.length ? otFormatDayLabelShort_(dayKeys[dayKeys.length - 1], tz) : '';

  var lines = [
    otBuildSlashOtCommitLine_(query.sg, gapRows, todayKey, tz),
    '',
    '_' + windowStart + (dayKeys.length > 1 ? ' \u2013 ' + windowEnd : '') + '_',
    ''
  ];

  var shownDays = 0;
  dayKeys.forEach(function(dk) {
    if (shownDays >= maxDays) return;
    const cell = dayTotals[dk];
    if (!cell || cell.gapSlots < 1) return;
    lines.push(otBuildSlashSgDayBar_(
      otFormatDayLabelShort_(dk, tz),
      cell.open,
      cell.filled,
      config,
      dk === todayKey
    ));
    shownDays += 1;
  });
  if (dayKeys.length > maxDays) {
    lines.push('_+' + (dayKeys.length - maxDays) + ' more day(s) \u2014 see OT_By_Hour tab_');
  }

  if (query.detail) {
    lines.push('');
    lines.push('_Top open hours:_');
    otBuildSlashDetailLines_(gapRows, 6).forEach(function(l) { lines.push(l); });
  }

  lines.push('');
  lines.push('<' + sheetLink + '|OT_By_Hour \u2192>');

  const text = lines.join('\n').substring(0, 3900);
  return {
    text: text,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: text } }]
  };
}

function otPostSlackSlashResponse_(responseUrl, payload) {
  if (!responseUrl) return;
  const resp = UrlFetchApp.fetch(responseUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('response_url HTTP ' + code + ': ' + resp.getContentText().substring(0, 200));
  }
}

function otExecuteSlackSlashCommand_(payload) {
  const config = otGetConfig_();
  const query = otParseSlashOtQuery_(payload.text);

  if (!otSlackSlashEnabled_(config)) {
    const paused = otChannelPostsPaused_(config);
    otPostSlackSlashResponse_(payload.responseUrl, {
      response_type: 'ephemeral',
      text: paused
        ? 'Channel posts are paused. `/ops` will return when an admin re-enables posting.'
        : 'OT slash command is disabled. Set Config CHANNEL_SLASH_ENABLED=TRUE and MANAGER_CHANNEL_SLACK=TRUE.'
    });
    return;
  }

  if (!otSlackSlashChannelAllowed_(payload, config)) {
    const ch = String(config.MANAGER_CHANNEL_NAME || 'ops-for-sales-managers').trim();
    otPostSlackSlashResponse_(payload.responseUrl, {
      response_type: 'ephemeral',
      text: 'Use /ops in #' + ch + ' only.'
    });
    return;
  }

  const loadResult = otLoadOtByHourFromSheet_(config);
  if (!loadResult.ok) {
    otPostSlackSlashResponse_(payload.responseUrl, {
      response_type: 'ephemeral',
      text: loadResult.error || 'Could not read OT_By_Hour tab.'
    });
    otAudit_('OT_SLASH', payload.userName, loadResult.error || 'sheet load failed', 'FAILED');
    return;
  }

  const tz = loadResult.tz || config.TIMEZONE || 'America/Chicago';
  const gapRows = otFilterOtByHourGapsForQuery_(loadResult.rows || [], query, config, tz);
  const answer = otBuildOtByHourGapSlackAnswer_(query, loadResult, config);

  var body = answer.text || 'No OT gap data.';

  const blocks = (answer.blocks && answer.blocks.length)
    ? answer.blocks.slice()
    : [{ type: 'section', text: { type: 'mrkdwn', text: body.substring(0, 3000) } }];
  if (blocks[0] && blocks[0].text) {
    blocks[0].text.text = (blocks[0].text.text || '').substring(0, 3900);
  }

  otPostSlackSlashResponse_(payload.responseUrl, {
    response_type: 'ephemeral',
    text: body.substring(0, 4000),
    blocks: blocks
  });

  otAudit_('OT_SLASH', query.sg || 'help', payload.text + ' → ' + gapRows.length + ' gap row(s)', 'OK');
}

function otEnqueueSlackSlashCommandJob_(payload) {
  const cache = CacheService.getScriptCache();
  const jobId = payload.triggerId || Utilities.getUuid();
  cache.put('OT_SLACK_JOB_' + jobId, JSON.stringify(payload), 600);
  PropertiesService.getScriptProperties().setProperty('OT_SLACK_JOB_ID', jobId);

  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'otProcessSlackSlashCommandJob_') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('otProcessSlackSlashCommandJob_')
    .timeBased()
    .after(500)
    .create();
}

/** Time trigger handler — runs /ops async so Slack gets a fast ack. */
function otProcessSlackSlashCommandJob_() {
  const props = PropertiesService.getScriptProperties();
  const jobId = props.getProperty('OT_SLACK_JOB_ID') || '';
  const cache = CacheService.getScriptCache();
  const raw = jobId ? cache.get('OT_SLACK_JOB_' + jobId) : null;
  if (!raw) return;

  cache.remove('OT_SLACK_JOB_' + jobId);
  props.deleteProperty('OT_SLACK_JOB_ID');

  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'otProcessSlackSlashCommandJob_') {
      ScriptApp.deleteTrigger(t);
    }
  });

  try {
    otExecuteSlackSlashCommand_(JSON.parse(raw));
  } catch (err) {
    otAudit_('OT_SLASH', '', 'Job failed: ' + String(err), 'FAILED');
  }
}

function otHandleSlackSlashDoPost_(e) {
  const params = otParseSlackSlashParamsFromDoPost_(e);
  if (!params) {
    return ContentService.createTextOutput('Not a Slack command.');
  }

  if (params.command !== '/ops' && params.command !== '/ot-needs' && params.command !== '/ot-gaps') {
    return ContentService.createTextOutput('Unknown command: ' + params.command);
  }

  const verify = otVerifySlackSlashRequest_(params, e);
  if (!verify.ok) {
    otAudit_('OT_SLASH', params.userName, verify.error, 'FAILED');
    return ContentService.createTextOutput(verify.error);
  }

  otEnqueueSlackSlashCommandJob_(params);
  return ContentService.createTextOutput('Looking up OT gaps from OT_By_Hour…');
}

function otIsSlackSlashDoPost_(e) {
  const params = (e && e.parameter) || {};
  const command = String(params.command || '').trim();
  if (command) return true;
  const postType = String((e && e.postData && e.postData.type) || '');
  return postType.indexOf('application/x-www-form-urlencoded') !== -1 &&
    String((e && e.postData && e.postData.contents) || '').indexOf('command=') !== -1;
}


/** Map Assembled queue display name → SG (audience) code. */
function otQueueNameToSg_(queueName) {
  const q = String(queueName || '').trim();
  for (var i = 0; i < OT_APP.QUEUE_DEFS.length; i++) {
    if (OT_APP.QUEUE_DEFS[i].name === q) return OT_APP.QUEUE_DEFS[i].sg;
  }
  return '—';
}

function otDashDateStr_(dateVal, tz) {
  if (dateVal instanceof Date && !isNaN(dateVal.getTime()))
    return Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd');
  return String(dateVal || '').trim();
}

function otDashTimeStr_(timeVal, tz) {
  if (timeVal instanceof Date && !isNaN(timeVal.getTime()))
    return Utilities.formatDate(timeVal, tz, 'HH:mm');
  return String(timeVal || '').trim();
}

/** Block length in hours from Offers Date / Start / End. */
function otOfferBlockHours_(dateVal, startVal, endVal, tz) {
  const d = otDashDateStr_(dateVal, tz);
  const s = otDashTimeStr_(startVal, tz);
  const e = otDashTimeStr_(endVal, tz);
  const t0 = otBuildDateTime_(d, s, tz);
  const t1 = otBuildDateTime_(d, e, tz);
  if (!t0 || !t1) return 0;
  var ms = t1.getTime() - t0.getTime();
  if (ms <= 0) ms += 24 * 60 * 60 * 1000;
  return ms / (60 * 60 * 1000);
}

function otDashSecuredAt_(obj) {
  const rt = obj['Response Time'] ? new Date(obj['Response Time']) : null;
  if (rt && !isNaN(rt.getTime())) return rt;
  const st = obj['Sent At'] ? new Date(obj['Sent At']) : null;
  if (st && !isNaN(st.getTime())) return st;
  return null;
}

function otBuildRosterByEmail_() {
  const out = {};
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.ROSTER);
  if (!sheet || sheet.getLastRow() <= 1) return out;
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  values.slice(1).forEach(function(row) {
    const o = otRowToObj_(headers, row);
    let email = String(o['Email'] || '').trim().toLowerCase();
    const name = String(o['Name'] || '').trim();
    if (!email && name) email = otDeriveEmail_(name);
    if (!email) return;
    out[email] = {
      name:    name,
      manager: String(o['Manager'] || '').trim()
    };
  });
  return out;
}

function otDashEmptyAgg_() {
  return { h24: 0, h7: 0, c24: 0, c7: 0 };
}

function otDashAdd_(agg, hours, in24, in7) {
  if (in7) {
    agg.h7 += hours;
    agg.c7++;
  }
  if (in24) {
    agg.h24 += hours;
    agg.c24++;
  }
}

/**
 * Rebuilds OT_Dashboard from Offers rows with Status = COMMITTED.
 * Rolling windows from Response Time (fallback Sent At): 24h and 7d.
 */
function runOtDashboardReport() {
  const config = otGetConfig_();
  const tz     = config.TIMEZONE || 'America/Chicago';
  const now    = new Date();
  const ms24   = 24 * 60 * 60 * 1000;
  const ms7    = 7 * ms24;
  const cut24  = new Date(now.getTime() - ms24);
  const cut7   = new Date(now.getTime() - ms7);

  const offersSheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.OFFERS);
  if (!offersSheet) {
    try {
      SpreadsheetApp.getUi().alert('Offers sheet not found.');
    } catch (e) { /* headless */ }
    return;
  }

  const values  = offersSheet.getDataRange().getValues();
  const headers = values.length ? values[0] : [];
  const roster  = otBuildRosterByEmail_();

  const total = otDashEmptyAgg_();
  const bySg  = {};
  const byRep = {};
  const byMgr = {};

  for (var i = 1; i < values.length; i++) {
    const obj = otRowToObj_(headers, values[i]);
    const status = String(obj['Status'] || '').trim().toUpperCase();
    if (status !== OT_APP.OFFER_STATUSES.COMMITTED) continue;

    const securedAt = otDashSecuredAt_(obj);
    if (!securedAt) continue;

    const in7  = securedAt >= cut7;
    const in24 = securedAt >= cut24;
    if (!in7) continue;

    const hours = otOfferBlockHours_(obj['Date'], obj['Start'], obj['End'], tz);
    if (hours <= 0) continue;

    const email = String(obj['Email'] || '').trim().toLowerCase();
    const name  = String(obj['Name'] || '').trim();
    const queue = String(obj['Queue'] || '').trim();
    const sg    = otQueueNameToSg_(queue);
    let manager = String(obj['Manager'] || '').trim();
    if (!manager && email && roster[email]) manager = roster[email].manager;
    const mgrKey = manager || '(no manager)';
    const repKey = email || ('(no email)' + i);

    otDashAdd_(total, hours, in24, in7);

    if (!bySg[sg]) bySg[sg] = otDashEmptyAgg_();
    otDashAdd_(bySg[sg], hours, in24, in7);

    if (!byRep[repKey]) {
      byRep[repKey] = {
        agg: otDashEmptyAgg_(), name: name, email: email, manager: mgrKey
      };
    }
    otDashAdd_(byRep[repKey].agg, hours, in24, in7);

    if (!byMgr[mgrKey]) byMgr[mgrKey] = otDashEmptyAgg_();
    otDashAdd_(byMgr[mgrKey], hours, in24, in7);
  }

  const dash = otGetOrCreate_(OT_APP.SHEETS.OT_DASHBOARD);
  dash.clear();
  dash.clearConditionalFormatRules();

  try {
    var r = 1;
    dash.getRange(r, 1, r, 8).merge();
    dash.getRange(r, 1).setValue('OT SECURED — ROLLING SUMMARY')
      .setFontWeight(true).setFontSize(14).setBackground('#1F6F44').setFontColor('#ffffff');
    r++;
    dash.getRange(r, 1).setValue(
      'Last refreshed: ' + Utilities.formatDate(now, tz, "EEE MMM d, yyyy 'at' h:mm a zzz") +
      ' | Source: Offers where Status = COMMITTED | Windows: rolling 24h / 7d from Response Time (fallback Sent At)'
    ).setWrap(true);
    r += 2;

    dash.getRange(r, 1).setValue('Roll-up').setFontWeight(true);
    r++;
    // getRange(row, col, numRows, numCols) — third arg is HEIGHT, not end row
    dash.getRange(r, 1, 1, 3).setValues([['Window', 'OT hours', '# commits']]);
    dash.getRange(r, 1, 1, 3).setFontWeight(true);
    r++;
    dash.getRange(r, 1, 2, 3).setValues([
      ['Last 24 hours', Number(total.h24), Number(total.c24)],
      ['Last 7 days',   Number(total.h7),  Number(total.c7)]
    ]);
    dash.getRange(r, 2, 2, 1).setNumberFormat('0.00');
    r += 3;

    dash.getRange(r, 1).setValue('By audience (SG)').setFontWeight(true);
    r++;
    const sgRows = [['SG', 'OT hours (24h)', 'OT hours (7d)', 'Commits (24h)', 'Commits (7d)']];
    OT_APP.REVIEW_SG_ORDER.forEach(function(sg) {
      const a = bySg[sg] || otDashEmptyAgg_();
      sgRows.push([sg, a.h24, a.h7, a.c24, a.c7]);
    });
    Object.keys(bySg).sort().forEach(function(sg) {
      if (OT_APP.REVIEW_SG_ORDER.indexOf(sg) !== -1) return;
      const a = bySg[sg];
      sgRows.push([sg, a.h24, a.h7, a.c24, a.c7]);
    });
    dash.getRange(r, 1, sgRows.length, 5).setValues(sgRows);
    dash.getRange(r + 1, 2, sgRows.length - 1, 2).setNumberFormat('0.00');
    r += sgRows.length + 1;

    dash.getRange(r, 1).setValue('By rep').setFontWeight(true);
    r++;
    const repHeader = [['Name', 'Email', 'Manager', 'OT hours (24h)', 'OT hours (7d)', 'Commits (24h)', 'Commits (7d)']];
    const repList = Object.keys(byRep).map(function(k) {
      const x = byRep[k];
      return [
        x.name, x.email, x.manager,
        x.agg.h24, x.agg.h7, x.agg.c24, x.agg.c7
      ];
    });
    repList.sort(function(a, b) {
      return (b[4] || 0) - (a[4] || 0);
    });
    const repRows = repHeader.concat(repList.length ? repList : [['—', '', '', 0, 0, 0, 0]]);
    dash.getRange(r, 1, repRows.length, 7).setValues(repRows);
    dash.getRange(r + 1, 4, repRows.length - 1, 2).setNumberFormat('0.00');
    r += repRows.length + 1;

    dash.getRange(r, 1).setValue('By manager').setFontWeight(true);
    r++;
    const mgrHeader = [['Manager', 'OT hours (24h)', 'OT hours (7d)', 'Commits (24h)', 'Commits (7d)']];
    const mgrList = Object.keys(byMgr).map(function(m) {
      const a = byMgr[m];
      return [m, a.h24, a.h7, a.c24, a.c7];
    });
    mgrList.sort(function(a, b) {
      return (b[2] || 0) - (a[2] || 0);
    });
    const mgrRows = mgrHeader.concat(mgrList.length ? mgrList : [['—', 0, 0, 0, 0]]);
    dash.getRange(r, 1, mgrRows.length, 5).setValues(mgrRows);
    dash.getRange(r + 1, 2, mgrRows.length - 1, 2).setNumberFormat('0.00');

    dash.setColumnWidth(1, 180);
    dash.setColumnWidth(2, 220);
    dash.autoResizeColumns(3, 6);

    otAudit_('OT_DASHBOARD', '', 'Rows: SG=' + (sgRows.length - 1) + ' rep=' + repList.length +
      ' mgr=' + mgrList.length + ' | Total h7=' + total.h7.toFixed(2), 'OK');
  } catch (writeErr) {
    otAudit_('OT_DASHBOARD', '', 'Write failed: ' + String(writeErr), 'FAILED');
    dash.getRange(10, 1, 1, 6).merge();
    dash.getRange(10, 1).setValue('OT_Dashboard build error: ' + String(writeErr))
      .setBackground('#f4cccc').setWrap(true);
    try {
      SpreadsheetApp.getUi().alert('OT Dashboard failed — see row 10 on this tab and Audit.');
    } catch (uiErr) { /* headless */ }
    return;
  }

  try {
    SpreadsheetApp.getUi().alert('OT Dashboard updated (“' + OT_APP.SHEETS.OT_DASHBOARD + '”).');
  } catch (uiErr) { /* headless */ }
}

/** Optional time trigger: refresh Overtime_Review then OT_Dashboard (works without UI). */
function runOvertimeReviewAndDashboard_() {
  runOvertimeReviewReport();
  runOtDashboardReport();
}

/*************************************************************
 * SLOT FETCHING — session auth (app.assembledhq.com)
 *************************************************************/

/**
 * Fetches published OT slots for all enabled queues.
 * Always sends channel=phone per queue.
 * Calculates remainingSeats = capacity - approved - pending.
 * Discards slots starting within 1 hour of now (lead time).
 * On 401: sends Slack alert to ops, skips remaining queues.
 */
function otFetchOpenSlots_(ctx) {
  const rules     = ctx.rules;
  const now       = new Date();
  const lookahead = Number(rules.LOOKAHEAD_DAYS || 3);

  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart.getTime() + lookahead * 24 * 60 * 60 * 1000);

  // 1-hour minimum lead time — don't surface slots starting within 1 hour
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  const startIso       = windowStart.toISOString();
  const endIso         = windowEnd.toISOString();
  const sessionHeaders = otGetSessionHeaders_();
  const allSlots       = [];
  var   sessionAlertSent = false;

  ctx.enabledQueues.forEach(function(qd) {
    // channel=phone always — OT slots are phone channel only
    const url = OT_APP.APP_BASE + '/overtime_slots'
      + '?start_time=' + encodeURIComponent(startIso)
      + '&end_time='   + encodeURIComponent(endIso)
      + '&channel=phone'
      + '&queue='      + encodeURIComponent(qd.queueAppId)
      + '&is_published=true';

    var resp;
    try {
      resp = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: sessionHeaders,
        muteHttpExceptions: true
      });
      Utilities.sleep(300);
    } catch (err) {
      otAudit_('FETCH_SLOTS', qd.name, 'Fetch exception: ' + String(err), 'FAILED');
      return;
    }

    const code = resp.getResponseCode();

    if (code === 401) {
      otAudit_('FETCH_SLOTS', qd.name,
        'Session expired (401). Refresh ASSEMBLED_SESSION and ASSEMBLED_CSRF.', 'FAILED');
      if (!sessionAlertSent) {
        otSendSessionExpiryAlert_(ctx.config);
        sessionAlertSent = true;
      }
      return;
    }

    if (code < 200 || code >= 300) {
      otAudit_('FETCH_SLOTS', qd.name,
        'API error ' + code + ': ' + resp.getContentText().substring(0, 200), 'FAILED');
      return;
    }

    var slots;
    try {
      slots = otCoerceOvertimeSlotsArray_(JSON.parse(resp.getContentText()));
    } catch (parseErr) {
      otAudit_('FETCH_SLOTS', qd.name, 'JSON parse error: ' + String(parseErr), 'FAILED');
      return;
    }

    if (!slots.length) {
      otAudit_('FETCH_SLOTS', qd.name,
        'Total: 0 | Open: 0 | Full: 0 | Past/too-soon: 0 (empty or unknown JSON shape)', 'INFO');
      return;
    }

    var queueOpen = 0;
    var queueFull = 0;
    var queuePast = 0;

    slots.forEach(function(slot) {
      const slotStart = new Date(slot.start_time);
      const slotEnd   = new Date(slot.end_time);

      // Skip past slots and slots starting within 1 hour
      if (slotEnd <= now)              { queuePast++; return; }
      if (slotStart < oneHourFromNow)  { queuePast++; return; }

      const capacity  = Number(slot.capacity              || 0);
      const approved  = Number(slot.num_approved_requests || 0);
      const pending   = Number(slot.num_pending_requests  || 0);
      const remaining = Math.max(0, capacity - approved - pending);

      if (remaining <= 0) { queueFull++; return; }

      queueOpen++;
      allSlots.push({
        id:             slot.id,
        queue:          qd.name,
        queueAppId:     qd.queueAppId,
        queueKey:       qd.key,
        startTime:      slotStart,
        endTime:        slotEnd,
        capacity:       capacity,
        approved:       approved,
        pending:        pending,
        remainingSeats: remaining
      });
    });

    otAudit_('FETCH_SLOTS', qd.name,
      'Total: ' + slots.length +
      ' | Open: ' + queueOpen +
      ' | Full: ' + queueFull +
      ' | Past/too-soon: ' + queuePast,
      'INFO');
  });

  return allSlots;
}

/*************************************************************
 * SLOT BLOCK MERGER
 *************************************************************/

/**
 * Merges contiguous 30-min open slots per queue into offer blocks.
 * remainingSeats = min remaining across all constituent slots
 * (tightest constraint governs how many offers can go out).
 * Blocks shorter than MIN_BLOCK_MINUTES are discarded.
 */
function otMergeSlotBlocks_(slots, ctx) {
  const tz              = ctx.timezone;
  const rules           = ctx.rules;
  const minBlockMinutes = Number(rules.MIN_BLOCK_MINUTES || 30);

  const sorted = slots.slice().sort(function(a, b) {
    if (a.queue !== b.queue) return a.queue.localeCompare(b.queue);
    return a.startTime - b.startTime;
  });

  const blocks = [];
  var current  = null;

  sorted.forEach(function(slot) {
    const sameQueue  = current && current.queue === slot.queue;
    const contiguous = current && current.endTime.getTime() === slot.startTime.getTime();

    if (!current || !sameQueue || !contiguous) {
      if (current) blocks.push(otFinalizeBlock_(current, tz));
      current = {
        queue:        slot.queue,
        queueAppId:   slot.queueAppId,
        queueKey:     slot.queueKey,
        startTime:    slot.startTime,
        endTime:      slot.endTime,
        slotIds:      [slot.id],
        remainingMin: slot.remainingSeats
      };
      return;
    }

    current.endTime    = slot.endTime;
    current.slotIds.push(slot.id);
    current.remainingMin = Math.min(current.remainingMin, slot.remainingSeats);
  });

  if (current) blocks.push(otFinalizeBlock_(current, tz));

  return blocks.filter(function(b) {
    const durationMinutes = (b.endTime.getTime() - b.startTime.getTime()) / 60000;
    return durationMinutes >= minBlockMinutes;
  });
}

function otFinalizeBlock_(block, tz) {
  return {
    blockId:        otBuildId_('OT_BLK'),
    queue:          block.queue,
    queueAppId:     block.queueAppId,
    queueKey:       block.queueKey,
    date:           Utilities.formatDate(block.startTime, tz, 'yyyy-MM-dd'),
    start:          Utilities.formatDate(block.startTime, tz, 'HH:mm'),
    end:            Utilities.formatDate(block.endTime,   tz, 'HH:mm'),
    startTime:      block.startTime,
    endTime:        block.endTime,
    slotIds:        block.slotIds,
    slotCount:      block.slotIds.length,
    remainingSeats: block.remainingMin
  };
}

/*************************************************************
 * RESERVED OFFER COUNT
 * Subtracts bot's in-flight SENT/PENDING offers so we don't
 * over-promise seats already spoken for but not yet accepted.
 * Matches on queue + normalized date/start/end (handles Sheets
 * Date/Time cells) OR any SlotID overlap with Notes (handles merge
 * drift when block start/end shifts between runs).
 * COMMITTED is reflected in Assembled's num_approved_requests.
 * ACCEPTED remains reserved here until the Assembled commit finishes.
 *************************************************************/
function otOfferWindowStrings_(obj, tz) {
  const tzUse = tz || 'America/Chicago';
  const date = (obj['Date'] instanceof Date)
    ? Utilities.formatDate(obj['Date'], tzUse, 'yyyy-MM-dd')
    : String(obj['Date'] || '').trim();
  const start = (obj['Start'] instanceof Date)
    ? Utilities.formatDate(obj['Start'], tzUse, 'HH:mm')
    : String(obj['Start'] || '').trim();
  const end = (obj['End'] instanceof Date)
    ? Utilities.formatDate(obj['End'], tzUse, 'HH:mm')
    : String(obj['End'] || '').trim();
  return { date: date, start: start, end: end };
}

function otSlotIdsFromOfferNotes_(notes) {
  return String(notes || '').replace('SlotIDs:', '').split('|')[0].trim()
    .split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

function otOfferReservesCapacity_(status, effectiveExpiry, now) {
  if (status === OT_APP.OFFER_STATUSES.ACCEPTED) return true;
  if ([
    OT_APP.OFFER_STATUSES.COMMITTED,
    OT_APP.OFFER_STATUSES.DECLINED,
    OT_APP.OFFER_STATUSES.EXPIRED,
    OT_APP.OFFER_STATUSES.SEND_FAILED
  ].indexOf(status) !== -1) return false;
  return !!(effectiveExpiry && now < effectiveExpiry);
}

function otCountReservedOffers_(block, offerObjects, tz) {
  const now = new Date();
  const blockSlots = {};
  (block.slotIds || []).forEach(function(id) {
    var k = String(id || '').trim();
    if (k) blockSlots[k] = true;
  });

  return offerObjects.filter(function(obj) {
    if (String(obj['Queue'] || '').trim() !== block.queue) return false;

    const win = otOfferWindowStrings_(obj, tz);
    const exact = win.date === block.date && win.start === block.start && win.end === block.end;

    var slotOverlap = false;
    if (!exact) {
      const ids = otSlotIdsFromOfferNotes_(obj['Notes']);
      for (var i = 0; i < ids.length; i++) {
        if (blockSlots[ids[i]]) {
          slotOverlap = true;
          break;
        }
      }
    }

    if (!exact && !slotOverlap) return false;

    const status = String(obj['Status'] || '').trim().toUpperCase();
    const sentAt    = obj['Sent At']    ? new Date(obj['Sent At'])    : null;
    const expiresAt = obj['Expires At'] ? new Date(obj['Expires At']) : null;
    const holdHours = Number(obj['Hold Hours'] || 1);
    const effectiveExpiry = (expiresAt && !isNaN(expiresAt.getTime()))
      ? expiresAt
      : (sentAt ? otAddHours_(sentAt, holdHours) : null);

    return otOfferReservesCapacity_(status, effectiveExpiry, now);
  }).length;
}

/*************************************************************
 * ELIGIBILITY
 * OT targets reps NOT currently scheduled during the block window.
 * Work group must match the queue's pattern.
 * PGC sort: descending (highest performers first — reward top reps
 * and put best people on OT windows).
 *************************************************************/
function otFindEligible_(block, roster, schedIdx, ctx) {
  const rules           = ctx.rules;
  const maxPerDay       = Number(rules.MAX_OFFERS_PER_PERSON_PER_DAY || 1);
  const maxPer24h       = Number(rules.MAX_EMAILS_PER_24H || 1);
  const minGapHours     = Number(rules.OFFER_MIN_GAP_HOURS || 1);
  const noFlySet        = ctx.noFlySet;
  const shadowEmails    = ctx.shadowExclusionEmails || new Set();
  const offersByEmail   = ctx.offersByEmail;
  const selectedThisRun = ctx.selectedThisRun || (ctx.selectedThisRun = new Set());

  const queueDef = OT_APP.QUEUE_DEFS.filter(function(qd) {
    return qd.name === block.queue;
  })[0];
  const workGroupPattern = queueDef ? queueDef.workGroupPattern : '';

  const eligible    = [];
  const debugCounts = {
    noEmail: 0, queueMismatch: 0, noFly: 0, shadowExcluded: 0,
    alreadyScheduled: 0, tooManyOffers: 0, passed: 0
  };

  roster.forEach(function(person) {
    const email = (person.email || '').trim().toLowerCase();
    if (!email) { debugCounts.noEmail++; return; }

    if (!otWorkGroupMatches_(person.workGroup, workGroupPattern)) {
      debugCounts.queueMismatch++; return;
    }
    if (noFlySet.has(otNormalizeName_(person.name))) { debugCounts.noFly++; return; }
    if (shadowEmails.has(email)) { debugCounts.shadowExcluded++; return; }

    // OT: rep must NOT be on phone (or other blocking shift activity) during this block
    if (otIsScheduledDuring_(email, block.startTime, block.endTime, schedIdx, person.name)) {
      debugCounts.alreadyScheduled++; return;
    }

    if (selectedThisRun.has(email)) { debugCounts.tooManyOffers++; return; }

    const history = offersByEmail[email] || { sentToday: 0, sentLast24h: 0, lastSentAt: null };
    if (history.sentToday >= maxPerDay || history.sentLast24h >= maxPer24h) {
      debugCounts.tooManyOffers++; return;
    }

    if (history.lastSentAt) {
      const gapMs       = minGapHours * 60 * 60 * 1000;
      const msSinceLast = new Date().getTime() - new Date(history.lastSentAt).getTime();
      if (msSinceLast < gapMs) { debugCounts.tooManyOffers++; return; }
    }

    debugCounts.passed++;
    selectedThisRun.add(email);

    const agentId = (function() {
      const bl = schedIdx[email] || [];
      for (var i = 0; i < bl.length; i++) { if (bl[i].agentId) return bl[i].agentId; }
      return '';
    }());

    eligible.push(Object.assign({}, person, { agentId: agentId }));
  });

  otAudit_('ELIGIBILITY', block.blockId,
    'Queue: ' + block.queue +
    ' | Window: ' + block.start + '-' + block.end +
    ' | Roster: ' + roster.length +
    ' | noEmail: ' + debugCounts.noEmail +
    ' | queueMismatch: ' + debugCounts.queueMismatch +
    ' | noFly: ' + debugCounts.noFly +
    ' | shadowExcluded: ' + debugCounts.shadowExcluded +
    ' | alreadyScheduled: ' + debugCounts.alreadyScheduled +
    ' | tooManyOffers: ' + debugCounts.tooManyOffers +
    ' | passed: ' + debugCounts.passed,
    debugCounts.passed > 0 ? 'OK' : 'WARN');

  // PGC sort: descending (highest first) — opposite of VTO bot
  const pgcMap = ctx.pgcByNormalizedName || {};
  const usePgc = otConfigBool_(ctx.config && ctx.config.USE_PGC_PRIORITY, true);
  if (usePgc && Object.keys(pgcMap).length) {
    eligible.sort(function(a, b) {
      var na = otNormalizeName_(a.name);
      var nb = otNormalizeName_(b.name);
      var ha = Object.prototype.hasOwnProperty.call(pgcMap, na);
      var hb = Object.prototype.hasOwnProperty.call(pgcMap, nb);
      // Known PGC first (unknown last — opposite of VTO)
      if (ha && !hb) return -1;
      if (!ha && hb) return 1;
      if (!ha && !hb) return (a.email || '').localeCompare(b.email || '');
      // Both known: highest PGC first (descending)
      return Number(pgcMap[nb]) - Number(pgcMap[na]);
    });
  }

  return eligible;
}

/**
 * Returns true if the rep has ANY blocking schedule activity overlapping the window.
 * Uses roster email, with normalized-name fallback when Assembled email differs.
 */
function otIsScheduledDuring_(email, blockStart, blockEnd, schedIdx, personName) {
  var blocks = schedIdx[(email || '').trim().toLowerCase()] || [];
  if (!blocks.length && personName && schedIdx.byName) {
    blocks = schedIdx.byName[otNormalizeName_(personName)] || [];
  }
  for (var i = 0; i < blocks.length; i++) {
    const oStart = Math.max(blocks[i].start.getTime(), blockStart.getTime());
    const oEnd   = Math.min(blocks[i].end.getTime(),   blockEnd.getTime());
    if (oEnd > oStart) return true;
  }
  return false;
}

/** True when the rep is free for at least one open OT block (bulk ping / eligibility). */
function otHasUnblockedOtWindow_(email, personName, blocks, schedIdx) {
  for (var i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!otIsScheduledDuring_(email, b.startTime, b.endTime, schedIdx, personName)) {
      return true;
    }
  }
  return false;
}

/*************************************************************
 * DESKTOP ALERTS — Shift Optimizer Web Push hub
 *************************************************************/
var OT_BID_ALERT_NOTIFY_URL = 'https://shift-optimizer-varsity-wfm.netlify.app/api/bid-alerts/notify';

function otOfferAlertDetail_(obj, action) {
  var name = String(obj['Name'] || obj['Email'] || 'Rep').trim();
  var tz = (otGetConfig_().TIMEZONE || 'America/Chicago');
  var date = (obj['Date'] instanceof Date)
    ? Utilities.formatDate(obj['Date'], tz, 'yyyy-MM-dd')
    : String(obj['Date'] || '').trim();
  var start = (obj['Start'] instanceof Date)
    ? Utilities.formatDate(obj['Start'], tz, 'HH:mm')
    : String(obj['Start'] || '').trim();
  var end = (obj['End'] instanceof Date)
    ? Utilities.formatDate(obj['End'], tz, 'HH:mm')
    : String(obj['End'] || '').trim();
  var queue = String(obj['Queue'] || '').trim();
  var verb = action === 'accept' ? 'accepted' : 'declined';
  var detail = name + ' ' + verb;
  if (date) detail += ': ' + date;
  if (start && end) detail += ' ' + start + '-' + end;
  if (queue) detail += ' (' + queue + ')';
  return detail;
}

function otOfferAlertNotify_(action, obj, offerId) {
  try {
    var props = PropertiesService.getScriptProperties();
    var config = otGetConfig_();
    var secret = (props.getProperty('BID_ALERT_NOTIFY_SECRET') || String(config.BID_ALERT_NOTIFY_SECRET || '')).trim();
    if (!secret) return;
    var url = (props.getProperty('BID_ALERT_NOTIFY_URL') || OT_BID_ALERT_NOTIFY_URL).trim();
    var kind = action === 'accept' ? 'accepted' : 'declined';
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Bid-Alert-Secret': secret },
      payload: JSON.stringify({
        source: 'ot',
        kind: kind,
        consultantName: String(obj['Name'] || obj['Email'] || 'Rep').trim(),
        consultantEmail: String(obj['Email'] || '').trim() || null,
        detail: otOfferAlertDetail_(obj, action),
        offerId: offerId
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    /* never disrupt accept/decline flow */
  }
}

/*************************************************************
 * WEB APP — handles Accept / Decline clicks
 *************************************************************/
function doGet(e) {
  const offerId = String((e.parameter && e.parameter.offer_id) || '').trim();
  const action  = String((e.parameter && e.parameter.action)   || '').trim().toLowerCase();
  const token   = String((e.parameter && e.parameter.token)    || '').trim();

  if (!offerId || !action || !token) {
    return HtmlService.createHtmlOutput(
      otResponsePage_('Missing required parameters.', false)
    ).setTitle('Targeted OT');
  }

  const result = otProcessResponse_(offerId, action, token);
  return HtmlService.createHtmlOutput(
    otResponsePage_(result.message, result.ok)
  ).setTitle('Targeted OT');
}

function otProcessResponse_(offerId, action, token) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return { ok: false, message: 'This offer is being updated. Please try again in a moment.' };
  }
  try {
    return otProcessResponseLocked_(offerId, action, token);
  } finally {
    lock.releaseLock();
  }
}

function otProcessResponseLocked_(offerId, action, token) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.OFFERS);
  if (!sheet) return { ok: false, message: 'Offer system unavailable.' };

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { ok: false, message: 'No offers found.' };

  const headers = values[0];
  const now     = new Date();
  const config  = otGetConfig_();

  for (var i = 1; i < values.length; i++) {
    const obj = otRowToObj_(headers, values[i]);
    if (String(obj['Offer ID'] || '').trim() !== offerId) continue;
    if (String(obj['Token']    || '').trim() !== token)
      return { ok: false, message: 'Invalid token.' };

    const status = String(obj['Status'] || '').trim().toUpperCase();

    if ([OT_APP.OFFER_STATUSES.DECLINED, OT_APP.OFFER_STATUSES.EXPIRED].indexOf(status) !== -1)
      return { ok: false, message: 'This offer is no longer active.' };

    if (status === OT_APP.OFFER_STATUSES.COMMITTED)
      return { ok: true, message: 'You have already accepted this offer — it has been recorded.' };

    if (status === OT_APP.OFFER_STATUSES.ACCEPTED)
      return { ok: true, message: 'You have already accepted this offer — scheduling is processing it.' };

    const sentAt       = obj['Sent At']    ? new Date(obj['Sent At'])    : null;
    const expiresAtRaw = obj['Expires At'] ? new Date(obj['Expires At']) : null;
    const holdHours    = Number(obj['Hold Hours'] || 1);
    const effectiveExpiry = (expiresAtRaw && !isNaN(expiresAtRaw.getTime()))
      ? expiresAtRaw
      : (sentAt ? otAddHours_(sentAt, holdHours) : null);

    if (effectiveExpiry && now >= effectiveExpiry) {
      otUpdateOfferField_(offerId, 'Status',          OT_APP.OFFER_STATUSES.EXPIRED);
      otUpdateOfferField_(offerId, 'Response Time',   now);
      otUpdateOfferField_(offerId, 'Response Action', 'expired_before_response');
      return { ok: false, message: 'This offer has expired.' };
    }

    if (action === 'accept') {
      otUpdateOfferField_(offerId, 'Status',          OT_APP.OFFER_STATUSES.ACCEPTED);
      otUpdateOfferField_(offerId, 'Response Time',   now);
      otUpdateOfferField_(offerId, 'Response Action', 'accept');
      SpreadsheetApp.flush();
      otAudit_('OFFER_ACCEPTED', offerId, 'Accepted by ' + obj['Email'], 'OK');

      const commitEnabled = otConfigBool_(config.ASSEMBLED_COMMIT, true);
      if (commitEnabled) {
        var commitResult;
        try {
          commitResult = otCommitToAssembled_(offerId, obj, config);
        } catch (err) {
          otAudit_('COMMIT', offerId, 'Unhandled exception: ' + String(err), 'FAILED');
          return { ok: false, message: 'Your acceptance was recorded but could not be written to Assembled.' };
        }
        otOfferAlertNotify_('accept', obj, offerId);
        return commitResult.ok
          ? { ok: true,  message: 'Thanks! Your OT shift has been accepted and recorded in your schedule.' }
          : { ok: false, message: 'Your acceptance was recorded but could not be fully written to Assembled. Scheduling will follow up.' };
      }
      otOfferAlertNotify_('accept', obj, offerId);
      return { ok: true, message: 'Thanks! Your OT shift has been recorded.' };
    }

    if (action === 'decline') {
      otUpdateOfferField_(offerId, 'Status',          OT_APP.OFFER_STATUSES.DECLINED);
      otUpdateOfferField_(offerId, 'Response Time',   now);
      otUpdateOfferField_(offerId, 'Response Action', 'decline');
      otAudit_('OFFER_DECLINED', offerId, 'Declined by ' + obj['Email'], 'OK');
      otOfferAlertNotify_('decline', obj, offerId);
      return { ok: true, message: 'Got it — you have declined this offer.' };
    }

    return { ok: false, message: 'Invalid action.' };
  }
  return { ok: false, message: 'Offer not found.' };
}

/*************************************************************
 * ASSEMBLED COMMIT
 * Two steps on accept:
 *   1. POST /activities (public API) — puts OT block on schedule
 *   2. Claim OT slot (session auth) — fills slot in Assembled UI
 *
 * The claim POST endpoint is undocumented. We try two candidate
 * patterns and log which succeeds in the Audit tab.
 * Once confirmed, the losing branch can be removed.
 *************************************************************/
function otCommitToAssembled_(offerId, obj, config) {
  const email = String(obj['Email'] || '').trim().toLowerCase();
  const tz    = config.TIMEZONE || 'America/Chicago';

  const date  = (obj['Date']  instanceof Date)
    ? Utilities.formatDate(obj['Date'],  tz, 'yyyy-MM-dd')
    : String(obj['Date']  || '').trim();
  const start = (obj['Start'] instanceof Date)
    ? Utilities.formatDate(obj['Start'], tz, 'HH:mm')
    : String(obj['Start'] || '').trim();
  const end   = (obj['End']   instanceof Date)
    ? Utilities.formatDate(obj['End'],   tz, 'HH:mm')
    : String(obj['End']   || '').trim();

  // ── Step 1: Resolve agent ID ──────────────────────────────
  var agentId = String(obj['Agent ID'] || '').trim();
  if (!agentId) {
    otAudit_('COMMIT', offerId, 'agentId blank — /people lookup for ' + email, 'INFO');
    agentId = otResolveAgentId_(email);
    if (!agentId) {
      otUpdateOfferField_(offerId, 'Status',           OT_APP.OFFER_STATUSES.COMMIT_FAILED);
      otUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
      otAudit_('COMMIT', offerId, 'No agent UUID for ' + email, 'FAILED');
      return { ok: false };
    }
    otUpdateOfferField_(offerId, 'Agent ID', agentId);
  }

  // ── Step 2: Resolve OT activity type ID ──────────────────
  const activityTypeId = otResolveOtTypeId_(config);
  if (!activityTypeId) {
    otUpdateOfferField_(offerId, 'Status',           OT_APP.OFFER_STATUSES.COMMIT_FAILED);
    otUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
    otAudit_('COMMIT', offerId, 'Missing OT activity type ID', 'FAILED');
    return { ok: false };
  }

  // ── Step 3: Build timestamps ──────────────────────────────
  const startTime = otBuildDateTime_(date, start, tz);
  const endTime   = otBuildDateTime_(date, end,   tz);
  if (!startTime || !endTime) {
    otUpdateOfferField_(offerId, 'Status',           OT_APP.OFFER_STATUSES.COMMIT_FAILED);
    otUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
    otAudit_('COMMIT', offerId, 'Invalid datetime: ' + date + ' ' + start + '-' + end, 'FAILED');
    return { ok: false };
  }

  // ── Step 4: POST /activities (public API) ────────────────
  const apiKey  = otGetApiKey_();
  const payload = {
    agent_id:   agentId,
    type_id:    activityTypeId,
    start_time: Math.floor(startTime.getTime() / 1000),
    end_time:   Math.floor(endTime.getTime()   / 1000)
  };

  var activityId = '';
  try {
    const actResp = otAssembledPost_(otAuthHeaders_(apiKey), '/activities', payload);
    activityId    = String(actResp.id || (actResp.activity && actResp.activity.id) || '').trim();
    otAudit_('COMMIT', offerId, 'Activity committed. ID: ' + activityId, 'OK');
  } catch (err) {
    otUpdateOfferField_(offerId, 'Status',           OT_APP.OFFER_STATUSES.COMMIT_FAILED);
    otUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
    otAudit_('COMMIT', offerId, '/activities POST failed: ' + String(err), 'FAILED');
    return { ok: false };
  }

  // ── Step 5: Claim OT slot (session auth) ─────────────────
  // Slot IDs stored in Notes column at offer send time.
  const notes   = String(obj['Notes'] || '');
  const slotIds = notes.replace('SlotIDs:', '').split('|')[0].trim()
    .split(',').map(function(s) { return s.trim(); }).filter(Boolean);

  const queueAppId = String(obj['Queue App ID'] || '').trim();
  var claimOk  = false;
  var claimLog = [];

  if (slotIds.length && agentId) {
    claimOk = otClaimOtSlots_(slotIds, agentId, queueAppId, claimLog);
  } else {
    claimLog.push('No slot IDs or agentId available — claim skipped');
  }

  otAudit_('COMMIT_CLAIM', offerId, claimLog.join(' | '), claimOk ? 'OK' : 'WARN');

  // ── Step 6: Update offer row ─────────────────────────────
  otUpdateOfferField_(offerId, 'Status',               OT_APP.OFFER_STATUSES.COMMITTED);
  otUpdateOfferField_(offerId, 'Assembled Status',     'COMMITTED');
  otUpdateOfferField_(offerId, 'Assembled Request ID', activityId);
  otUpdateOfferField_(offerId, 'Notes',
    notes + ' | Activity:' + activityId +
    (claimOk ? ' | SlotClaimed' : ' | SlotClaimFailed(check audit)'));

  // ── Step 7: Notify manager ───────────────────────────────
  const dateDisp = otFormatDateDisplay_(date, tz);
  const timeDisp = otFormatTimeRange_(date, start, end, tz);
  const dmMsg    = '\u2705 OT Committed \u2014 ' + email + ', ' + dateDisp + ', ' + timeDisp;
  otNotifyManagerOnCommit_(email, email, dmMsg, config);

  return { ok: true };
}

/**
 * Claims OT slots via the session auth internal API.
 * Tries two endpoint patterns; logs which works.
 * Once confirmed via Audit tab, losing branch can be removed.
 *
 * Pattern 1: POST /api/overtime_requests
 *   { overtime_slot_id, agent_id }
 *
 * Pattern 2: POST /api/overtime_slots/:id/requests
 *   { agent_id }
 */
function otClaimOtSlots_(slotIds, agentId, queueAppId, logArr) {
  const headers = otGetSessionHeaders_();
  var   anyOk   = false;

  slotIds.forEach(function(slotId) {
    var claimed = false;

    // Try Pattern 1
    try {
      const url1  = OT_APP.APP_BASE + '/overtime_requests';
      const body1 = JSON.stringify({ overtime_slot_id: slotId, agent_id: agentId });
      const resp1 = UrlFetchApp.fetch(url1, {
        method: 'post', headers: headers, payload: body1, muteHttpExceptions: true
      });
      const code1 = resp1.getResponseCode();
      if (code1 >= 200 && code1 < 300) {
        logArr.push('Pattern1 OK slot=' + slotId + ' HTTP=' + code1);
        claimed = true;
        anyOk   = true;
      } else {
        logArr.push('Pattern1 FAILED slot=' + slotId +
          ' HTTP=' + code1 + ' body=' + resp1.getContentText().substring(0, 80));
      }
    } catch (err1) {
      logArr.push('Pattern1 exception slot=' + slotId + ': ' + String(err1));
    }

    // Try Pattern 2 if Pattern 1 failed
    if (!claimed) {
      try {
        const url2  = OT_APP.APP_BASE + '/overtime_slots/' + slotId + '/requests';
        const body2 = JSON.stringify({ agent_id: agentId });
        const resp2 = UrlFetchApp.fetch(url2, {
          method: 'post', headers: headers, payload: body2, muteHttpExceptions: true
        });
        const code2 = resp2.getResponseCode();
        if (code2 >= 200 && code2 < 300) {
          logArr.push('Pattern2 OK slot=' + slotId + ' HTTP=' + code2);
          anyOk = true;
        } else {
          logArr.push('Pattern2 FAILED slot=' + slotId +
            ' HTTP=' + code2 + ' body=' + resp2.getContentText().substring(0, 80));
        }
      } catch (err2) {
        logArr.push('Pattern2 exception slot=' + slotId + ': ' + String(err2));
      }
    }
  });

  return anyOk;
}

/*************************************************************
 * SESSION EXPIRY ALERT — Slack DM to ops
 *************************************************************/
function otSendSessionExpiryAlert_(config) {
  try {
    const props  = PropertiesService.getScriptProperties();
    const token  = (props.getProperty('SLACK_BOT_TOKEN')   || '').trim();
    var   userId = (props.getProperty('SLACK_OPS_USER_ID') || '').trim();
    if (userId.indexOf('@') !== -1) {
      userId = otGetSlackUserId_(userId) || '';
    }
    if (!token || !userId) {
      otAudit_('SESSION_ALERT', '',
        'SLACK_BOT_TOKEN missing, or SLACK_OPS_USER_ID not set / email lookup failed — cannot send 401 alert', 'WARN');
      return;
    }

    const openRes = UrlFetchApp.fetch('https://slack.com/api/conversations.open', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ users: userId }),
      muteHttpExceptions: true
    });
    const openData = JSON.parse(openRes.getContentText());
    if (!openData.ok) {
      otAudit_('SESSION_ALERT', '', 'conversations.open failed: ' + openData.error, 'WARN');
      return;
    }

    UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        channel: openData.channel.id,
        text: '\u26a0\ufe0f *Targeted OT Bot \u2014 Session Expired*\n' +
              'Assembled returned 401 on overtime_slots GET.\n' +
              'OT slot reads are failing. Please refresh ' +
              '`ASSEMBLED_SESSION` and `ASSEMBLED_CSRF` in Script Properties.'
      }),
      muteHttpExceptions: true
    });
    otAudit_('SESSION_ALERT', '', 'Slack 401 alert sent to ops', 'OK');
  } catch (err) {
    otAudit_('SESSION_ALERT', '', 'Failed to send alert: ' + String(err), 'WARN');
  }
}

/*************************************************************
 * SCHEDULE PULL — public API (API key)
 *************************************************************/

/** Midnight today in Config TIMEZONE (not Apps Script project TZ). */
function otTodayStartInTz_(now, tz) {
  const key = Utilities.formatDate(now || new Date(), tz, 'yyyy-MM-dd');
  return otBuildDateTime_(key, '00:00', tz) || new Date(now);
}

/**
 * Activity types that block OT offers (rep is already on shift / on a break).
 * Matches exact Assembled names and common variants ("Phone - Inbound", etc.).
 */
function otIsScheduleBlockingType_(typeName) {
  const t = String(typeName || '').toLowerCase().trim();
  if (!t) return false;
  const EXACT = ['phone', 'meal', 'break', 'lunch', 'rest break', 'chat', 'sms', 'extra work'];
  if (EXACT.indexOf(t) !== -1) return true;
  if (t.indexOf('phone') !== -1) return true;
  if (t.indexOf('chat') !== -1) return true;
  if (t.indexOf('sms') !== -1) return true;
  if (t.indexOf('meal') !== -1 || t.indexOf('break') !== -1 || t.indexOf('lunch') !== -1) return true;
  if (t.indexOf('extra work') !== -1 || t.indexOf('overtime') !== -1) return true;
  return false;
}

/** Pull end must cover every OT block we might offer plus LOOKAHEAD_DAYS. */
function otComputeSchedulePullEnd_(ctx, blocks) {
  const tz = ctx.timezone || (ctx.config && ctx.config.TIMEZONE) || 'America/Chicago';
  const config = ctx.config || {};
  const rules = ctx.rules || {};
  const todayStart = otTodayStartInTz_(new Date(), tz);
  const baseMs = todayStart.getTime() +
    Number(config.SCHEDULE_PULL_HOURS || rules.SCHEDULE_PULL_HOURS || 78) * 3600000;
  const lookaheadMs = todayStart.getTime() +
    Math.max(1, Number(rules.LOOKAHEAD_DAYS || config.LOOKAHEAD_DAYS || 3)) * 86400000;
  var endMs = Math.max(baseMs, lookaheadMs);
  (blocks || []).forEach(function(b) {
    if (b && b.endTime && !isNaN(b.endTime.getTime())) {
      endMs = Math.max(endMs, b.endTime.getTime() + 3600000);
    }
  });
  return new Date(endMs);
}

/**
 * @param {Object} ctx
 * @param {Date} [pullThroughEnd] — extend activities fetch through this instant
 */
function otPullSchedules_(ctx, pullThroughEnd) {
  const apiKey = otGetApiKey_();
  const config = ctx.config;
  const tz = ctx.timezone || config.TIMEZONE || 'America/Chicago';
  const hours  = Number(config.SCHEDULE_PULL_HOURS || 78);
  const now    = new Date();

  const todayStart = otTodayStartInTz_(now, tz);
  var end = new Date(todayStart.getTime() + hours * 60 * 60 * 1000);
  if (pullThroughEnd && pullThroughEnd.getTime() > end.getTime()) {
    end = new Date(pullThroughEnd.getTime());
  }

  const url = OT_APP.API_BASE + '/activities'
    + '?start_time=' + Math.floor(todayStart.getTime() / 1000)
    + '&end_time='   + Math.floor(end.getTime() / 1000)
    + '&include_agents=true'
    + '&include_activity_types=true';

  const resp = UrlFetchApp.fetch(url, {
    method: 'get', headers: otAuthHeaders_(apiKey), muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();

  if (code < 200 || code >= 300) {
    otAudit_('PULL_SCHEDULES', '', 'API error ' + code + ': ' + text.substring(0, 200), 'FAILED');
    return [];
  }

  const data          = JSON.parse(text);
  const activities    = data.activities     || {};
  const agents        = data.agents         || {};
  const activityTypes = data.activity_types || {};

  const typeNameMap = {};
  Object.keys(activityTypes).forEach(function(id) {
    typeNameMap[id] = (activityTypes[id].name || '').toLowerCase().trim();
  });

  const actList = Array.isArray(activities)
    ? activities
    : Object.keys(activities).map(function(k) {
        const a = activities[k]; if (!a.id) a.id = k; return a;
      });

  const shadowEmails  = ctx.shadowExclusionEmails || new Set();
  const rows          = [];
  var typeSkipCounts  = {};

  actList.forEach(function(act) {
    const typeName = typeNameMap[act.type_id] || '';
    if (!otIsScheduleBlockingType_(typeName)) {
      if (typeName) typeSkipCounts[typeName] = (typeSkipCounts[typeName] || 0) + 1;
      return;
    }
    const startTime = act.start_time ? new Date(act.start_time * 1000) : null;
    const endTime   = act.end_time   ? new Date(act.end_time   * 1000) : null;
    if (!startTime || !endTime) return;
    const agentId = (act.agent_id || '').trim();
    const agent   = agents[agentId] || {};
    const email   = (agent.email || agent.primary_email || '').trim().toLowerCase();
    const agentName = String(agent.name || agent.display_name || '').trim();
    if (shadowEmails.has(email)) return;
    rows.push({
      email: email,
      agentId: agentId,
      agentName: agentName,
      startTime: startTime,
      endTime: endTime
    });
  });

  otAudit_('PULL_SCHEDULES', '',
    'Window: ' + Utilities.formatDate(todayStart, tz, 'yyyy-MM-dd HH:mm') +
    ' \u2192 ' + Utilities.formatDate(end, tz, 'yyyy-MM-dd HH:mm') + ' ' + tz +
    ' | Activities: ' + actList.length + ' | Blocking rows: ' + rows.length +
    (Object.keys(typeSkipCounts).length
      ? ' | Skipped types (sample): ' + Object.keys(typeSkipCounts).slice(0, 6).join(', ')
      : ''),
    'INFO');
  return rows;
}

function otBuildSchedIdx_(schedules) {
  const idx = { byName: {} };
  schedules.forEach(function(row) {
    const email = (row.email || '').trim().toLowerCase();
    const entry = {
      start: row.startTime,
      end: row.endTime,
      agentId: row.agentId || ''
    };
    if (email) {
      if (!idx[email]) idx[email] = [];
      idx[email].push(entry);
    }
    const nm = otNormalizeName_(row.agentName || '');
    if (nm) {
      if (!idx.byName[nm]) idx.byName[nm] = [];
      idx.byName[nm].push(entry);
    }
  });
  return idx;
}

/*************************************************************
 * OFFER EXPIRY
 *************************************************************/
function expireOtOffers_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.OFFERS);
  if (!sheet) return 0;
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return 0;

  const headers = values[0];
  const now     = new Date();
  var   count   = 0;

  for (var i = 1; i < values.length; i++) {
    const obj    = otRowToObj_(headers, values[i]);
    const status = String(obj['Status'] || '').trim().toUpperCase();

    if ([
      OT_APP.OFFER_STATUSES.ACCEPTED, OT_APP.OFFER_STATUSES.COMMITTED,
      OT_APP.OFFER_STATUSES.DECLINED, OT_APP.OFFER_STATUSES.EXPIRED,
      OT_APP.OFFER_STATUSES.COMMIT_FAILED
    ].indexOf(status) !== -1) continue;

    const sentAt       = obj['Sent At']    ? new Date(obj['Sent At'])    : null;
    const expiresAtRaw = obj['Expires At'] ? new Date(obj['Expires At']) : null;
    const holdHours    = Number(obj['Hold Hours'] || 1);
    if (!sentAt || isNaN(sentAt.getTime())) continue;

    const effectiveExpiry = (expiresAtRaw && !isNaN(expiresAtRaw.getTime()))
      ? expiresAtRaw
      : otAddHours_(sentAt, holdHours);

    if (now >= effectiveExpiry) {
      const idxStatus = headers.indexOf('Status');
      const idxNotes  = headers.indexOf('Notes');
      if (idxStatus !== -1) sheet.getRange(i + 1, idxStatus + 1).setValue(OT_APP.OFFER_STATUSES.EXPIRED);
      if (idxNotes  !== -1) sheet.getRange(i + 1, idxNotes  + 1).setValue('Expired after hold window.');
      otAudit_('EXPIRE_OFFER', String(obj['Offer ID'] || ''), 'Expired', 'OK');
      count++;
    }
  }
  return count;
}

/*************************************************************
 * OFFER EMAIL
 *************************************************************/
function otSendOfferEmail_(opts) {
  const config    = opts.config;
  const tz        = config.TIMEZONE || 'America/Chicago';
  const fromName  = config.EMAIL_FROM_NAME || 'Scheduling Bot';
  const dateDisp  = otFormatDateDisplay_(opts.date, tz);
  const timeDisp  = otFormatTimeRange_(opts.date, opts.start, opts.end, tz);
  const subject   = (config.EMAIL_SUBJECT_PREFIX || 'OT Opportunity') +
                    ' \u2014 ' + dateDisp + ', ' + timeDisp;
  const expiresStr = Utilities.formatDate(opts.expiresAt, tz, "EEE, MMM d 'at' h:mm a") + ' CT';

  const firstName = otFirstName_(opts.name);
  var actionHtml = '';
  if (opts.acceptUrl || opts.declineUrl) {
    var parts = [];
    if (opts.acceptUrl) {
      parts.push("<a href='" + otEscHtml_(opts.acceptUrl) +
        "' style='font-size:16px;font-weight:bold;'>Accept</a>");
    }
    if (opts.declineUrl) {
      parts.push("<a href='" + otEscHtml_(opts.declineUrl) + "'>Decline</a>");
    }
    actionHtml = "<p>" + parts.join(' &nbsp;&middot;&nbsp; ') + "</p>";
  }

  const html = [
    "<div style='font-family:Arial,sans-serif;font-size:14px;line-height:1.5;'>",
    "<p>Hi " + otEscHtml_(firstName) + ",</p>",
    "<p>You have an <strong>overtime opportunity</strong> available.</p>",
    "<p><strong>Date:</strong> "  + otEscHtml_(dateDisp)  + "<br>",
    "<strong>Time:</strong> "     + otEscHtml_(timeDisp)  + "<br>",
    "<strong>Queue:</strong> "    + otEscHtml_(opts.queue) + "</p>",
    "<p>Please respond before this offer expires.<br>",
    "<strong>Offer expires:</strong> " + otEscHtml_(expiresStr) + "</p>",
    actionHtml,
    "<p>Thank you,</p><p>" + otEscHtml_(fromName) + "</p></div>"
  ].join('');

  try {
    GmailApp.sendEmail(opts.email, subject, otHtmlToPlain_(html), {
      name: fromName, htmlBody: html
    });
    otAudit_('SEND_EMAIL', opts.offerId, 'Sent to ' + opts.email, 'OK');
    return true;
  } catch (err) {
    otAudit_('SEND_EMAIL', opts.offerId, String(err), 'FAILED');
    return false;
  }
}

/*************************************************************
 * RESPONSE PAGE
 *************************************************************/
function otResponsePage_(message, isSuccess) {
  const bg     = '#1a3a52';
  const card   = '#1F6F44';   // dark green — matches workbook tab color
  const accent = isSuccess ? '#b8ffcf' : '#ffd6d6';
  const sub    = '#cce4f7';
  return [
    "<!DOCTYPE html><html><head>",
    "<meta name='viewport' content='width=device-width,initial-scale=1.0'>",
    "<title>OT Response</title></head>",
    "<body style='margin:0;padding:0;background:" + bg + ";font-family:Arial,sans-serif;'>",
    "<div style='min-height:100vh;display:flex;align-items:center;",
    "justify-content:center;padding:24px;'>",
    "<div style='max-width:520px;width:100%;background:" + card + ";border-radius:16px;",
    "padding:32px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.25);'>",
    "<div style='font-size:26px;font-weight:bold;color:#fff;margin-bottom:16px;'>",
    "OT Offer Response</div>",
    "<div style='font-size:18px;color:" + accent + ";font-weight:600;margin-bottom:12px;'>",
    otEscHtml_(message) + "</div>",
    "<div style='font-size:14px;color:" + sub + ";'>You can close this page.</div>",
    "</div></div></body></html>"
  ].join('');
}

/*************************************************************
 * CONTEXT BUILDER
 *************************************************************/
function otBuildContext_(config, rules) {
  const ctx = {
    config:   config,
    rules:    rules,
    now:      new Date(),
    timezone: config.TIMEZONE || 'America/Chicago'
  };

  const noFlySheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.NO_FLY);
  ctx.noFlySet = new Set();
  if (noFlySheet) {
    const vals = noFlySheet.getDataRange().getValues();
    vals.slice(1).forEach(function(row) {
      const name = String(row[0] || '').trim();
      if (name && name.toLowerCase() !== 'name') ctx.noFlySet.add(otNormalizeName_(name));
    });
  }

  ctx.offersByEmail         = otBuildOfferHistory_(ctx.now, 24);
  ctx.offerObjects          = otGetAllOfferObjects_();
  ctx.shadowExclusionEmails = otGetShadowExclusionEmails_();
  ctx.pgcByNormalizedName   = otLoadPgcMap_(config);

  return ctx;
}

function otGetAllOfferObjects_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.OFFERS);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(function(row) { return row.some(function(c) { return c !== ''; }); })
    .map(function(row) { return otRowToObj_(headers, row); });
}

function otGetShadowExclusionEmails_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.SHADOW_EXCLUSION);
  const out   = new Set();
  if (!sheet || sheet.getLastRow() <= 1) return out;
  const values   = sheet.getDataRange().getValues();
  const headers  = values[0];
  const emailCol = headers.findIndex(function(h) {
    return String(h).trim().toLowerCase() === 'email';
  });
  if (emailCol === -1) return out;
  values.slice(1).forEach(function(row) {
    const email = String(row[emailCol] || '').trim().toLowerCase();
    if (email && email !== 'email') out.add(email);
  });
  return out;
}

function otBuildOfferHistory_(now, hoursBack) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.OFFERS);
  if (!sheet) return {};
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return {};

  const headers   = values[0];
  const cutoff24h = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
  const todayKey  = Utilities.formatDate(now, 'America/Chicago', 'yyyy-MM-dd');
  const out       = {};

  values.slice(1).forEach(function(row) {
    const obj    = otRowToObj_(headers, row);
    const email  = String(obj['Email'] || '').trim().toLowerCase();
    const status = String(obj['Status'] || '').trim().toUpperCase();
    if (!email) return;
    if (status === OT_APP.OFFER_STATUSES.SEND_FAILED || status === '') return;

    // Hot rep reset: COMMITTED clears caps so they can receive another OT offer
    if (status === OT_APP.OFFER_STATUSES.COMMITTED) {
      if (out[email]) {
        out[email].sentToday   = 0;
        out[email].sentLast24h = 0;
        out[email].lastSentAt  = null;
      }
      return;
    }

    const sentAt = obj['Sent At'] ? new Date(obj['Sent At']) : null;
    const offerDate = (obj['Date'] instanceof Date)
      ? Utilities.formatDate(obj['Date'], 'America/Chicago', 'yyyy-MM-dd')
      : String(obj['Date'] || '').trim();

    if (!out[email]) out[email] = { sentToday: 0, sentLast24h: 0, lastSentAt: null };

    // Hard decline freeze
    if (status === OT_APP.OFFER_STATUSES.DECLINED) {
      out[email].sentToday   = 999;
      out[email].sentLast24h = 999;
      out[email].lastSentAt  = sentAt || out[email].lastSentAt;
      return;
    }

    if (offerDate === todayKey) out[email].sentToday++;
    if (sentAt && !isNaN(sentAt.getTime()) && sentAt >= cutoff24h) {
      out[email].sentLast24h++;
      if (!out[email].lastSentAt || sentAt > out[email].lastSentAt) {
        out[email].lastSentAt = sentAt;
      }
    } else if (status === OT_APP.OFFER_STATUSES.PENDING_SEND && offerDate === todayKey) {
      out[email].sentLast24h++;
    }
  });

  return out;
}

function otIncrementOfferHistory_(offersByEmail, email, sentAt) {
  const key = email.trim().toLowerCase();
  if (!offersByEmail[key]) offersByEmail[key] = { sentToday: 0, sentLast24h: 0, lastSentAt: null };
  offersByEmail[key].sentToday++;
  offersByEmail[key].sentLast24h++;
  if (!offersByEmail[key].lastSentAt || sentAt > offersByEmail[key].lastSentAt) {
    offersByEmail[key].lastSentAt = sentAt;
  }
}

/*************************************************************
 * ROSTER READER
 *************************************************************/
function otGetRoster_(ctx) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.ROSTER);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(function(row) { return row.some(function(c) { return c !== ''; }); })
    .map(function(row) {
      const obj   = otRowToObj_(headers, row);
      const name  = String(obj['Name']  || '').trim();
      let   email = String(obj['Email'] || '').trim().toLowerCase();
      if (!email && name) email = otDeriveEmail_(name);
      return {
        name:      name,
        email:     email,
        workGroup: String(obj['Work Group'] || '').trim(),
        manager:   String(obj['Manager']    || '').trim()
      };
    })
    .filter(function(p) { return !!p.name && !!p.email; });
}

function otDeriveEmail_(name) {
  const parts = name.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);
  if (parts.length < 2) return '';
  return parts.join('.') + '@varsitytutors.com';
}

/*************************************************************
 * CONFIG / RULES
 *************************************************************/
function otGetConfig_() {
  const sheet  = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.CONFIG);
  const values = sheet ? sheet.getDataRange().getValues() : [];
  const out    = {};
  values.slice(1).forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (key) out[key] = row[1];
  });
  return out;
}

function otGetRules_(config) {
  return {
    LOOKAHEAD_DAYS:                Number(config.LOOKAHEAD_DAYS                || 3),
    SCHEDULE_PULL_HOURS:           Number(config.SCHEDULE_PULL_HOURS           || 78),
    MIN_BLOCK_MINUTES:             Number(config.MIN_BLOCK_MINUTES             || 30),
    OFFER_HOLD_HOURS:              Number(config.OFFER_HOLD_HOURS              || 1),
    MAX_OFFERS_PER_PERSON_PER_DAY: Number(config.MAX_OFFERS_PER_PERSON_PER_DAY || 1),
    MAX_EMAILS_PER_24H:            Number(config.MAX_EMAILS_PER_24H            || 1),
    OFFER_MIN_GAP_HOURS:           Number(config.OFFER_MIN_GAP_HOURS           || 1)
  };
}

function otGetEnabledQueues_(config) {
  return OT_APP.QUEUE_DEFS.filter(function(qd) {
    const cfgKey = 'QUEUE_ENABLED_' + qd.key;
    const val    = config[cfgKey];
    if (val === undefined || val === null || String(val).trim() === '') return true;
    return String(val).trim().toUpperCase() === 'TRUE';
  });
}

function otConfigBool_(value, defaultVal) {
  if (value === undefined || value === null || String(value).trim() === '') return defaultVal;
  return String(value).trim().toUpperCase() === 'TRUE';
}

/*************************************************************
 * PGC MAP
 *************************************************************/
function otLoadPgcMap_(config) {
  const map = {};
  if (!otConfigBool_(config && config.USE_PGC_PRIORITY, true)) return map;
  const props = PropertiesService.getScriptProperties();
  const id    = String(props.getProperty('PGC_SPREADSHEET_ID') || '').trim();
  if (!id) return map;
  try {
    const ss        = SpreadsheetApp.openById(id);
    const sheetName = String(props.getProperty('PGC_SHEET_NAME') || '').trim();
    const sh        = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
    if (!sh) { otAudit_('PGC_LOAD', '', 'PGC sheet not found', 'WARN'); return map; }
    const values = sh.getDataRange().getValues();
    for (var r = 1; r < values.length; r++) {
      const name = String(values[r][1] || '').trim();
      if (!name || name.toLowerCase() === 'name') continue;
      const raw = values[r][6];
      if (raw === '' || raw === null || raw === undefined) continue;
      var n = Number(raw);
      if (!isFinite(n)) continue;
      if (n > 0 && n <= 1) n = n * 100;
      map[otNormalizeName_(name)] = n;
    }
    otAudit_('PGC_LOAD', '', 'Loaded PGC for ' + Object.keys(map).length + ' name(s)', 'OK');
  } catch (err) {
    otAudit_('PGC_LOAD', '', String(err), 'WARN');
  }
  return map;
}

/*************************************************************
 * MANAGER SLACK NOTIFICATIONS
 *************************************************************/
function otGetManagerAliasMap_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.MANAGER_ALIASES);
  if (!sheet || sheet.getLastRow() <= 1) return {};
  const values = sheet.getDataRange().getValues();
  const out    = {};
  values.slice(1).forEach(function(row) {
    const name  = String(row[0] || '').trim();
    const alias = String(row[1] || '').trim();
    if (name && alias) out[name] = alias;
  });
  return out;
}

function otGetManagerForRep_(repEmail) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.ROSTER);
  if (!sheet) return '';
  const values  = sheet.getDataRange().getValues();
  if (values.length <= 1) return '';
  const headers  = values[0];
  const emailCol = headers.findIndex(function(h) {
    return String(h).trim().toLowerCase() === 'email';
  });
  const mgrCol   = headers.findIndex(function(h) {
    return String(h).trim().toLowerCase() === 'manager';
  });
  if (emailCol === -1 || mgrCol === -1) return '';
  const target = repEmail.trim().toLowerCase();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][emailCol] || '').trim().toLowerCase() === target) {
      return String(values[i][mgrCol] || '').trim();
    }
  }
  return '';
}

function otGetSlackUserId_(alias) {
  const email = alias.indexOf('@') !== -1 ? alias : (alias + '@varsitytutors.com');
  try {
    const token = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
    if (!token) return null;
    const resp = UrlFetchApp.fetch(
      'https://slack.com/api/users.lookupByEmail?email=' + encodeURIComponent(email),
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );
    const data = JSON.parse(resp.getContentText());
    if (data.ok) return data.user.id;
    otAudit_('SLACK_DM', '', 'Lookup failed for ' + email + ': ' + data.error, 'WARN');
  } catch (err) {
    otAudit_('SLACK_DM', '', 'Lookup exception: ' + String(err), 'WARN');
  }
  return null;
}

function otSendSlackDm_(userId, message) {
  try {
    const token   = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
    const openRes = UrlFetchApp.fetch('https://slack.com/api/conversations.open', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ users: userId }),
      muteHttpExceptions: true
    });
    const openData = JSON.parse(openRes.getContentText());
    if (!openData.ok) { otAudit_('SLACK_DM', '', 'open failed: ' + openData.error, 'WARN'); return false; }
    const msgRes = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ channel: openData.channel.id, text: message }),
      muteHttpExceptions: true
    });
    const msgData = JSON.parse(msgRes.getContentText());
    if (!msgData.ok) {
      otAudit_('SLACK_DM', '', 'postMessage failed: ' + msgData.error, 'WARN');
      return false;
    }
    return true;
  } catch (err) {
    otAudit_('SLACK_DM', '', 'DM exception: ' + String(err), 'WARN');
    return false;
  }
}

/**
 * Primary offer delivery via Slack DM. Uses users.lookupByEmail(rep email).
 * @returns {boolean} true when the DM was sent successfully
 */
function otSendOfferSlack_(opts) {
  const config = opts.config;
  const token  = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
  if (!token) {
    otAudit_('SEND_SLACK', opts.offerId || '', 'SLACK_BOT_TOKEN missing', 'FAILED');
    return false;
  }

  const tz         = (config && config.TIMEZONE) || 'America/Chicago';
  const dateDisp   = otFormatDateDisplay_(opts.date, tz);
  const timeDisp   = otFormatTimeRange_(opts.date, opts.start, opts.end, tz);
  const expiresStr = opts.expiresAt
    ? Utilities.formatDate(opts.expiresAt, tz, "EEE, MMM d 'at' h:mm a") + ' (' + tz + ')'
    : '';

  const userId = otGetSlackUserId_(opts.email);
  if (!userId) {
    otAudit_('SEND_SLACK', opts.offerId || '', 'No Slack user for ' + opts.email, 'FAILED');
    return false;
  }

  const firstName = otFirstName_(opts.name);
  var msg = '*OT opportunity*\nHi ' + firstName + ', you have overtime available.\n' +
    '• *Date:* ' + dateDisp + '\n' +
    '• *Time:* ' + timeDisp + '\n' +
    '• *Queue:* ' + opts.queue + '\n';
  if (expiresStr) msg += '• *Respond by:* ' + expiresStr + '\n';
  if (opts.acceptUrl || opts.declineUrl) {
    var actionParts = [];
    if (opts.acceptUrl) actionParts.push(otSlackMrkdwnLink_(opts.acceptUrl, 'Accept'));
    if (opts.declineUrl) actionParts.push(otSlackMrkdwnLink_(opts.declineUrl, 'Decline'));
    msg += '\n' + actionParts.join('   ');
  } else {
    msg += '\n_OT_WEB_APP_URL is not configured — accept/decline links unavailable._';
  }

  try {
    if (!otSendSlackDm_(userId, msg)) {
      otAudit_('SEND_SLACK', opts.offerId || '', 'Slack DM failed for ' + opts.email, 'FAILED');
      return false;
    }
    otAudit_('SEND_SLACK', opts.offerId || '', 'Sent to ' + opts.email, 'OK');
    return true;
  } catch (err) {
    otAudit_('SEND_SLACK', opts.offerId || '', String(err), 'FAILED');
    return false;
  }
}

function otNotifyManagerOnCommit_(repEmail, repName, message, config) {
  try {
    if (!otConfigBool_(config && config.MANAGER_OT_SLACK, true)) return;
    const managerName = otGetManagerForRep_(repEmail);
    if (!managerName) {
      otAudit_('SLACK_DM', '', 'No manager found for ' + repEmail, 'INFO');
      return;
    }
    const aliasMap = otGetManagerAliasMap_();
    const alias    = aliasMap[managerName];
    if (!alias) {
      otAudit_('SLACK_DM', '', 'No alias for manager "' + managerName + '"', 'WARN');
      return;
    }
    const userId = otGetSlackUserId_(alias);
    if (!userId) return;
    otSendSlackDm_(userId, message);
    otAudit_('SLACK_DM', '', 'Manager notify sent to ' + managerName + ' for ' + repName, 'OK');
  } catch (err) {
    otAudit_('SLACK_DM', '', 'Unhandled exception: ' + String(err), 'WARN');
  }
}

/*************************************************************
 * ASSEMBLED PUBLIC API HELPERS
 *************************************************************/
function otGetApiKey_() {
  const key = (PropertiesService.getScriptProperties().getProperty('ASSEMBLED_API_KEY') || '').trim();
  if (!key) throw new Error('Script Property "ASSEMBLED_API_KEY" is not set.');
  return key;
}

function otGetWebAppUrl_(config) {
  return (
    PropertiesService.getScriptProperties().getProperty('OT_WEB_APP_URL') ||
    (config && config.OT_WEB_APP_URL) || ''
  ).trim();
}

function otAuthHeaders_(apiKey) {
  return {
    'Authorization': 'Basic ' + Utilities.base64Encode(apiKey + ':'),
    'Content-Type':  'application/json'
  };
}

function otAssembledPost_(headers, path, payload) {
  const url  = OT_APP.API_BASE + path;
  const resp = UrlFetchApp.fetch(url, {
    method: 'post', headers: headers,
    payload: JSON.stringify(payload || {}), muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code < 200 || code >= 300)
    throw new Error('Assembled POST ' + path + ' failed (' + code + '): ' + text);
  return text ? JSON.parse(text) : {};
}

function otResolveAgentId_(email) {
  if (!email) return '';
  const apiKey  = otGetApiKey_();
  const headers = otAuthHeaders_(apiKey);
  const target  = email.trim().toLowerCase();
  const LIMIT   = 100;
  var   offset  = 0;
  while (true) {
    var data;
    try {
      const url = OT_APP.API_BASE + '/people?limit=' + LIMIT + '&offset=' + offset;
      const r   = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
      data      = JSON.parse(r.getContentText());
    } catch (err) {
      otAudit_('RESOLVE_AGENT', '', 'Error at offset ' + offset + ': ' + err, 'FAILED');
      return '';
    }
    const people = data.people || {};
    const total  = data.total  || 0;
    const keys   = Object.keys(people);
    for (var i = 0; i < keys.length; i++) {
      const p      = people[keys[i]];
      const pEmail = (p.email || '').trim().toLowerCase();
      const aId    = (p.agent_id || keys[i] || '').trim();
      if (pEmail === target && aId) return aId;
    }
    if (keys.length < LIMIT || offset + LIMIT >= total) break;
    offset += LIMIT;
    Utilities.sleep(200);
  }
  return '';
}

function otResolveOtTypeId_(config) {
  const direct = (PropertiesService.getScriptProperties()
    .getProperty('ASSEMBLED_OT_ACTIVITY_ID') || '').trim();
  if (direct) return direct;
  const apiKey  = otGetApiKey_();
  const desired = (config.OT_ACTIVITY_NAME || 'Extra Work').trim().toUpperCase();
  try {
    const r    = UrlFetchApp.fetch(OT_APP.API_BASE + '/activity_types', {
      method: 'get', headers: otAuthHeaders_(apiKey), muteHttpExceptions: true
    });
    const res  = JSON.parse(r.getContentText());
    const raw  = res.activity_types || {};
    const list = Array.isArray(raw)
      ? raw
      : Object.keys(raw).map(function(k) { const a = raw[k]; if (!a.id) a.id = k; return a; });
    for (var i = 0; i < list.length; i++) {
      if ((list[i].name || '').trim().toUpperCase() === desired)
        return String(list[i].id || '').trim();
    }
    otAudit_('RESOLVE_OT_TYPE', '',
      'No match for "' + desired + '". Set ASSEMBLED_OT_ACTIVITY_ID in Script Properties.', 'WARN');
  } catch (err) {
    otAudit_('RESOLVE_OT_TYPE', '', String(err), 'FAILED');
  }
  return '';
}

/*************************************************************
 * SESSION HEADERS — internal app API
 *************************************************************/
function otGetSessionHeaders_() {
  const props   = PropertiesService.getScriptProperties();
  const session = (props.getProperty('ASSEMBLED_SESSION') || '').trim();
  const csrf    = (props.getProperty('ASSEMBLED_CSRF')    || '').trim();
  if (!session || !csrf)
    throw new Error('ASSEMBLED_SESSION or ASSEMBLED_CSRF not set in Script Properties.');
  return {
    'Content-Type':  'application/json',
    'accept':        'application/json',
    'cookie':        'assembled-session=' + session,
    'x-csrf-token':  csrf
  };
}

/*************************************************************
 * OFFER SHEET HELPERS
 *************************************************************/

/**
 * Appends one offer row to the Offers sheet.
 * Notes column stores SlotIDs for the commit step's claim POST.
 */
function otAppendOfferRow_(o) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.OFFERS);
  if (!sheet) return;
  const notes = 'SlotIDs:' + (o.slotIds || '');
  sheet.appendRow([
    o.offerId, o.blockId,
    String(o.date), String(o.start), String(o.end),
    o.name, o.email, o.agentId, o.queue, o.queueAppId, o.manager,
    o.sentAt, o.expiresAt, o.holdHours, o.status,
    '', '', o.token, o.acceptUrl, o.declineUrl,
    '', '', '', notes
  ]);
}

function otUpdateOfferField_(offerId, columnName, value) {
  const sheet  = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.OFFERS);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  const headers = values[0];
  const col     = headers.indexOf(columnName);
  if (col === -1) return;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][headers.indexOf('Offer ID')] || '').trim() === offerId) {
      sheet.getRange(i + 1, col + 1).setValue(value);
      return;
    }
  }
}

/*************************************************************
 * AUDIT
 *************************************************************/
function otAudit_(event, refId, details, result) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.AUDIT);
  if (!sheet) return;
  sheet.appendRow([new Date(), event, refId, details, result]);
}

/*************************************************************
 * SETUP
 *************************************************************/
function setupOtWorkbook() {
  const configSheet          = otGetOrCreate_(OT_APP.SHEETS.CONFIG);
  const rosterSheet          = otGetOrCreate_(OT_APP.SHEETS.ROSTER);
  const noFlySheet           = otGetOrCreate_(OT_APP.SHEETS.NO_FLY);
  const shadowExclusionSheet = otGetOrCreate_(OT_APP.SHEETS.SHADOW_EXCLUSION);
  const offersSheet          = otGetOrCreate_(OT_APP.SHEETS.OFFERS);
  const auditSheet           = otGetOrCreate_(OT_APP.SHEETS.AUDIT);
  const changelogSheet       = otGetOrCreate_(OT_APP.SHEETS.CHANGELOG);
  const managerAliasSheet    = otGetOrCreate_(OT_APP.SHEETS.MANAGER_ALIASES);
  const overtimeReviewSheet  = otGetOrCreate_(OT_APP.SHEETS.OVERTIME_REVIEW);
  const otByHourSheet        = otGetOrCreate_(OT_APP.SHEETS.OT_BY_HOUR);
  const otDashboardSheet     = otGetOrCreate_(OT_APP.SHEETS.OT_DASHBOARD);

  const queueToggleRows = OT_APP.QUEUE_DEFS.map(function(qd) {
    return ['QUEUE_ENABLED_' + qd.key, 'TRUE',
            'Enable/disable queue: ' + qd.name];
  });

  otSetSheetData_(configSheet,
    ['Key', 'Value', 'Notes'],
    [
      ['TIMEZONE',                      'America/Chicago', 'Timezone for all date/time formatting'],
      ['LOOKAHEAD_DAYS',                3,                 'Days ahead to look for open OT slots'],
      ['SCHEDULE_PULL_HOURS',           78,                'Hours of schedule data to pull from Assembled'],
      ['MIN_BLOCK_MINUTES',             30,                'Minimum merged block length in minutes to send an offer'],
      ['OFFER_HOLD_HOURS',              1,                 'How long an offer stays open before expiring'],
      ['MAX_OFFERS_PER_PERSON_PER_DAY', 1,                 'Max OT offers per rep per calendar day'],
      ['MAX_EMAILS_PER_24H',            1,                 'Max emails per rep in rolling 24h window'],
      ['OFFER_MIN_GAP_HOURS',           1,                 'Min hours between offers to the same rep (rolling)'],
      ['SEND_EMAILS',                   'FALSE',           'TRUE = email offers (legacy). FALSE + REP_OT_SLACK=TRUE sends Slack DMs instead.'],
      ['ASSEMBLED_COMMIT',              'TRUE',            'Write accepted offers back to Assembled'],
      ['OT_ACTIVITY_NAME',              'Extra Work',      'Assembled activity type name for OT (fallback if ASSEMBLED_OT_ACTIVITY_ID not set)'],
      ['EMAIL_SUBJECT_PREFIX',          'OT Opportunity',  'Subject line prefix for offer emails'],
      ['EMAIL_FROM_NAME',               'Scheduling Bot',  'Display name for outbound emails'],
      ['USE_PGC_PRIORITY',              'TRUE',            'Sort eligible reps by PGC descending (highest first). Requires PGC_SPREADSHEET_ID Script Property.'],
      ['MANAGER_OT_SLACK',              'TRUE',            'Slack DM to manager when rep accepts (commit). Needs SLACK_BOT_TOKEN + Manager_Aliases.'],
      ['REP_OT_SLACK',                  'TRUE',            'Slack DM to rep when an offer is sent (default channel). Needs SLACK_BOT_TOKEN; rep email must match Slack login email.'],
      ['OT_AVAILABILITY_SLACK_MESSAGE', '',                'Optional. Custom text for menu “Send OT availability pings (Slack)”. Empty = built-in default.'],
      ['REVIEW_LOOKBACK_DAYS',          14,                'Overtime_Review: days before today to fetch and show (0–30; past rows always included)'],
      ['REVIEW_REPORT_DAYS',            6,                 'Overtime_Review: when REVIEW_FETCH_DAYS=0, auto fetch uses max(this, LOOKAHEAD_DAYS, 21) days ahead'],
      ['REVIEW_FETCH_DAYS',             0,                 'Overtime_Review: days ahead to query Assembled; 0 = auto max(REPORT_DAYS, LOOKAHEAD_DAYS, 21), max 60'],
      ['REVIEW_BLANK_STOP_STREAK',      3,                 'Overtime_Review: stop the table before this many consecutive days with no open seats in any queue (2–10)'],
      ['REVIEW_FILLED_INCLUDES_PENDING', 'TRUE',         'Overtime_Review: Filled = approved + pending when TRUE; approved only when FALSE'],
      ['REVIEW_HOUR_LOOKBACK_DAYS',     7,                 'OT_By_Hour: complete days before today (1–30)'],
      ['REVIEW_HOUR_LOOKAHEAD_DAYS',    7,                 'OT_By_Hour: days ahead from today inclusive (0–30; 7 = through today+7)'],
      ['MANAGER_CHANNEL_SLACK',         'FALSE',           'Post OT Take Pulse digests to Sales Manager Slack channel'],
      ['MANAGER_CHANNEL_ID',            '',                'Slack channel ID (C…) for #ops-for-sales-managers; or Script Property MANAGER_CHANNEL_ID'],
      ['MANAGER_CHANNEL_NAME',          'ops-for-sales-managers', 'Slash command + digest channel name when ID not set'],
      ['CHANNEL_8AM_HOUR_CT',           8,                 '3-day morning digest: hour in TIMEZONE (default 8AM)'],
      ['CHANNEL_8AM_MINUTE_CT',         0,                 '3-day morning digest: minute'],
      ['CHANNEL_MORNING_DAYS',          3,                 'Days shown in 8AM outlook (default 3)'],
      ['CHANNEL_MORNING_START_DAY',     0,                 '8AM outlook start offset from today (0 = include today)'],
      ['CHANNEL_2PM_HOUR_CT',           14,                'Tomorrow-needs digest: hour in TIMEZONE (default 2PM)'],
      ['CHANNEL_2PM_MINUTE_CT',         0,                 'Tomorrow-needs digest: minute'],
      ['CHANNEL_5PM_HOUR_CT',           17,                '7-day outlook digest: hour in TIMEZONE (default 5PM)'],
      ['CHANNEL_5PM_MINUTE_CT',         0,                 '7-day outlook digest: minute'],
      ['CHANNEL_WEEK_DAYS',             7,                 'Days shown in 5PM outlook (default 7)'],
      ['CHANNEL_WEEK_START_DAY',        0,                 '5PM outlook start offset from today (0 = include today)'],
      ['CHANNEL_DIGEST_FILL_ALERT',     0.35,              'Below this fill ratio = warning in digests'],
      ['TOMORROW_MIN_OPEN_HOURS',       4,                 '2PM post: min unfilled hours per SG to include'],
      ['TOMORROW_POST_ALL_CLEAR',       'FALSE',           '2PM post: send all-clear message when no gaps qualify'],
      ['WEEK_SKIP_EMPTY_DAYS',          'FALSE',           '5PM post: omit days with no OT in any SG'],
      ['CHANNEL_POSTS_PAUSED',          'TRUE',            'Master kill switch — no digests or /ops posts to manager channel when TRUE'],
      ['CHANNEL_SLASH_ENABLED',         'FALSE',           '/ops in #ops-for-sales-managers — private (ephemeral) reply to requester only'],
      ['CHANNEL_SLASH_RESTRICT_CHANNEL', 'TRUE',           '/ops only in MANAGER_CHANNEL_ID / MANAGER_CHANNEL_NAME when TRUE'],
      ['SLASH_MAX_DAYS',                7,                 '/ops: max days in fill-% bar view'],
      ['OT_CLAIM_URL',                  '',                'Link in digest action row; empty = OT_WEB_APP_URL Script Property / Config'],
    ].concat(queueToggleRows)
  );

  otPreserveSheet_(rosterSheet, ['Name', 'Email', 'Work Group', 'Manager']);
  otPreserveSheet_(noFlySheet, ['Name']);
  otPreserveSheet_(shadowExclusionSheet, ['Name', 'Email', 'Notes']);
  otPreserveSheet_(managerAliasSheet, ['Name', 'Slack Alias', 'Notes']);
  otPopulateManagerAliasesFromRoster_(managerAliasSheet);

  otPreserveSheet_(overtimeReviewSheet, [
    'SG', 'Day', 'Open slots (hours x2)', 'Filled (hours x2)', '% filled'
  ]);

  otPreserveSheet_(otByHourSheet, [
    'SG', 'Day', 'Hour (CT)', 'Open slots (hours x2)', 'Filled (hours x2)', '% filled'
  ]);

  otPreserveSheet_(otDashboardSheet, [
    'Use Targeted OT → Refresh OT Dashboard (or time trigger: runOtDashboardReport / runOvertimeReviewAndDashboard_)'
  ]);

  otPreserveSheet_(offersSheet, [
    'Offer ID', 'Block ID', 'Date', 'Start', 'End',
    'Name', 'Email', 'Agent ID', 'Queue', 'Queue App ID', 'Manager',
    'Sent At', 'Expires At', 'Hold Hours', 'Status',
    'Response Time', 'Response Action',
    'Token', 'Accept URL', 'Decline URL',
    'Assembled Request ID', 'Assembled Status', 'Assembled Response', 'Notes'
  ]);

  otPreserveSheet_(auditSheet,
    ['Timestamp', 'Event', 'Reference ID', 'Details', 'Result']);

  otPreserveSheet_(changelogSheet,
    ['Version', 'Date', 'Author', 'Change Summary', 'Impact', 'Status']);

  if (changelogSheet.getLastRow() <= 1) {
    changelogSheet.getRange(2, 1, 1, 6).setValues([[
      'v1.0.0', '2026-05-04', 'Bobby Cotner',
      'Initial release. Session-auth slot polling (channel=phone per queue), ' +
      'public-API schedule pull + activity commit, PGC-descending sort, ' +
      'manager Slack DM, dual-pattern claim POST with audit logging.',
      'Proactive targeted OT offers aligned to published Assembled overtime slots ' +
      'across all five Consumer Sales queues.',
      'Released'
    ]]);
  }

  otFormatSheets_();
  otEnsureChangelogEntry_(
    'v1.3.7',
    'Bulk OT Slack pings (by SG menu) use the same schedule gate as targeted offers: ' +
    'only reps with at least one open OT block they are not on phone/shift for receive a DM.'
  );
  otEnsureChangelogEntry_(
    'v1.3.6',
    'Targeted OT eligibility: extend schedule pull through latest OT block + LOOKAHEAD_DAYS; ' +
    'recognize Phone activity type variants; name fallback when Assembled email differs from Roster. ' +
    'Fixes offers sent to consultants already scheduled for phone.'
  );
  otEnsureChangelogEntry_(
    'v1.3.5',
    '/ops slash replies are ephemeral — only the manager who ran the command sees the query and OT outlook.'
  );
  otEnsureChangelogEntry_(
    'v1.3.4',
    'Overtime_Review filled counts: ignore superseded slots with capacity 0, dedupe by time window, ' +
    'cap filled at capacity per slot — matches Assembled Approved extra work (fixes inflated filled vs open).'
  );
  otEnsureChangelogEntry_(
    'v1.3.1',
    '/ops fuzzy SG matching: elementary→ELD, high school→HS, college→COL, adult learning / languages & core→AL.'
  );
  otEnsureChangelogEntry_(
    'v1.3.0',
    '/ops concise outlook: 1–2 sentence commit push + per-day fill-% bars (morning digest style). Ops Bot /ops only.'
  );
  otEnsureChangelogEntry_(
    'v1.2.0',
    '/ops replies summarized: top time blocks per day from OT_By_Hour (chronological sort, ' +
    'skip invalid rows, merge contiguous hours). Use "detail" for hour breakdown.'
  );
  otEnsureChangelogEntry_(
    'v1.1.9',
    'Slash command renamed to /ops — reads OT_By_Hour for #ops-for-sales-managers; ' +
    'parses natural phrases like "what are high school ot needs like?".'
  );
  otEnsureChangelogEntry_(
    'v1.1.8',
    '/ops (was /ot-needs) reads OT_By_Hour tab (hourly SG gaps) for #ops-for-sales-managers.'
  );
  otEnsureChangelogEntry_(
    'v1.1.6',
    'OT_By_Hour includes today and REVIEW_HOUR_LOOKAHEAD_DAYS (default 7) ahead — not only past lookback days.'
  );
  otEnsureChangelogEntry_(
    'v1.1.5',
    'OT_By_Hour: apply conditional-format rules for All-audience and SG tables in one pass (second table was wiping colors).'
  );
  otEnsureChangelogEntry_(
    'v1.1.4',
    'Overtime_Review + OT_By_Hour row colors: red <50%, orange 50–70%, yellow 71–83%, green >83%.'
  );
  otEnsureChangelogEntry_(
    'v1.1.3',
    'OT_By_Hour refresh: fix Sheet.getRange(row,col,numRows,numCols) usage — row-count mismatch exception and column E % formatting.'
  );
  otEnsureChangelogEntry_(
    'v1.1.2',
    'OT_By_Hour / Overtime_Review: fix getRange end-row/column for % format — Filled column no longer shows slot counts as 600%.'
  );
  otEnsureChangelogEntry_(
    'v1.1.1',
    'OT_By_Hour tab: take rate broken out by SG, calendar day, and slot-start hour (CT) ' +
    'for the last REVIEW_HOUR_LOOKBACK_DAYS — no longer rolled up across days.'
  );
  otEnsureChangelogEntry_(
    'v1.1.0',
    'OT_By_Hour tab: take rate by slot-start hour (CT) for the last REVIEW_HOUR_LOOKBACK_DAYS ' +
    '(default 7) complete days. Refreshed with Overtime_Review from the same Assembled pull.'
  );
  otEnsureChangelogEntry_(
    'v1.0.9',
    'Overtime_Review fetches and displays REVIEW_LOOKBACK_DAYS (default 14) before today, ' +
    'plus today and the existing forward horizon. Past rows are always shown; blank-stop trimming applies only from today forward.'
  );
  otEnsureChangelogEntry_(
    'v1.0.8',
    'Offer delivery defaults to Slack DM (REP_OT_SLACK=TRUE, SEND_EMAILS=FALSE). ' +
    'Targeted offers no longer use GmailApp; avoids daily email quota failures. Email remains available when REP_OT_SLACK=FALSE and SEND_EMAILS=TRUE.'
  );
  otEnsureChangelogEntry_(
    'v1.0.7',
    'Sales Manager Slack channel digests: 2PM tomorrow-needs alert and 5PM seven-day outlook. ' +
    'Config MANAGER_CHANNEL_SLACK + MANAGER_CHANNEL_ID; triggers runOtChannelMorningOutlook_ / runOtChannelTomorrowNeeds_ / runOtChannelWeekOutlook_.'
  );
  otAudit_('SETUP', '', 'Workbook setup complete (' + OT_APP.VERSION + ')', 'OK');

  SpreadsheetApp.getUi().alert([
    'Targeted OT Bot ' + OT_APP.VERSION + ' setup complete.',
    '',
    'Next steps:',
    '1. Set Script Properties:',
    '   ASSEMBLED_API_KEY     — public API key (sk_live_...)',
    '   ASSEMBLED_SESSION     — session cookie from browser DevTools',
    '   ASSEMBLED_CSRF        — CSRF token from browser DevTools',
    '   OT_WEB_APP_URL        — deployed web app URL',
    '   ASSEMBLED_OT_ACTIVITY_ID — activity type UUID for Extra Work',
    '   SLACK_BOT_TOKEN       — same token as VTO/Adherence bots (chat:write, im:write, users:read.email)',
    '   SLACK_OPS_USER_ID     — your Slack user ID for 401 alerts (U… or email for test DM resolution)',
    '   OT_SLACK_TEST_EMAIL   — optional; work email for “Test: OT ping DM to me” (lookup; easiest)',
    '   OT_SLACK_TEST_USER_ID — optional; Slack user U… for test ping if no test email set',
    '   Config REP_OT_SLACK=TRUE (default) — targeted offers DM reps on Slack; set SEND_EMAILS=TRUE only for legacy email delivery',
    '   Optional: Targeted OT → Send OT availability pings (Slack) — broadcast by SG (Roster - Sales tab)',
    '   PGC_SPREADSHEET_ID    — optional, for PGC-priority sorting',
    '',
    '2. Populate Roster tab (or IMPORTRANGE from VTO bot Roster)',
    '3. Deploy as web app (execute as: me, anyone can access)',
    '4. Set time-based trigger on runTargetedOt() every 10-15 min',
    '5. Optional: hourly trigger on runOvertimeReviewAndDashboard_() (Overtime_Review + OT_Dashboard tabs)',
    '6. Optional Sales Manager channel digests:',
    '   Config MANAGER_CHANNEL_SLACK=TRUE, MANAGER_CHANNEL_ID=C… (invite bot to channel)',
    '   Targeted OT → Install channel digest triggers (8AM + 2PM + 5PM)',
    '   (or run otInstallChannelDigestTriggers_ in the script editor)',
    '   Set Apps Script Project Settings → Time zone = America/Chicago',
    '   Or test via Post tomorrow OT needs / Post 7-day OT outlook',
    '7. Optional /ot-needs slash command (on-demand gaps in manager channel):',
    '   Targeted OT → Show /ot-needs slash command setup',
    '   Slack app → Slash Commands → /ot-needs → Request URL = OT_WEB_APP_URL',
    '   Script Property OT_SLACK_VERIFICATION_TOKEN; Config CHANNEL_SLASH_ENABLED=TRUE',
    '',
    'FIRST ACCEPT: Check the Audit tab for COMMIT_CLAIM rows.',
    'They show which claim POST pattern (1 or 2) worked.',
    'Report back and the confirmed pattern will be hardcoded in a later release.'
  ].join('\n'));
}

function otEnsureChangelogEntry_(version, summary) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.CHANGELOG);
  if (!sheet) return;
  const values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === version) return;
  }
  sheet.appendRow([
    version,
    Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd'),
    'Bobby Cotner',
    summary,
    'Automated OT Take Pulse posts for Sales Manager Slack channel.',
    'Released'
  ]);
}

function otPopulateManagerAliasesFromRoster_(aliasSheet) {
  const rosterSheet = SpreadsheetApp.getActive().getSheetByName(OT_APP.SHEETS.ROSTER);
  if (!rosterSheet || rosterSheet.getLastRow() <= 1) return;
  const rosterValues  = rosterSheet.getDataRange().getValues();
  const rosterHeaders = rosterValues[0];
  const mgrCol        = rosterHeaders.findIndex(function(h) {
    return String(h).trim().toLowerCase() === 'manager';
  });
  if (mgrCol === -1) return;

  const managerSet = new Set();
  rosterValues.slice(1).forEach(function(row) {
    const mgr = String(row[mgrCol] || '').trim();
    if (mgr && mgr.toLowerCase() !== 'no match') managerSet.add(mgr);
  });

  const existingData  = aliasSheet.getDataRange().getValues();
  const existingNames = new Set();
  existingData.slice(1).forEach(function(row) {
    const name = String(row[0] || '').trim();
    if (name) existingNames.add(name);
  });

  const newManagers = Array.from(managerSet)
    .filter(function(m) { return !existingNames.has(m); })
    .sort();
  if (!newManagers.length) return;

  const startRow = aliasSheet.getLastRow() + 1;
  newManagers.forEach(function(name, idx) {
    const parts = name.trim().split(/\s+/);
    const alias = parts.length >= 2
      ? (parts[0] + '.' + parts[parts.length - 1]).toLowerCase()
      : parts[0].toLowerCase();
    aliasSheet.getRange(startRow + idx, 1).setValue(name);
    aliasSheet.getRange(startRow + idx, 2).setValue(alias);
  });
  SpreadsheetApp.flush();
}

/*************************************************************
 * SETUP HELPERS
 *************************************************************/
function otGetOrCreate_(name) {
  const ss    = SpreadsheetApp.getActive();
  var   sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function otSetSheetData_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.clearFormats();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function otPreserveSheet_(sheet, fallbackHeaders) {
  if (sheet.getLastRow() > 1) return;
  otSetSheetData_(sheet, fallbackHeaders, []);
}

function otClearSheetBody_(sheet) {
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
}

function otFormatSheets_() {
  const ss = SpreadsheetApp.getActive();
  Object.values(OT_APP.SHEETS).forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastColumn() === 0) return;
    if (name === OT_APP.SHEETS.OVERTIME_REVIEW || name === OT_APP.SHEETS.OT_DASHBOARD) return;
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn())
      .setFontWeight('bold')
      .setBackground('#1F6F44')   // dark green — distinct from VTO bot (navy)
      .setFontColor('#ffffff');
    sheet.autoResizeColumns(1, sheet.getLastColumn());
  });
}

/*************************************************************
 * GENERAL UTILITIES
 *************************************************************/
function otRowToObj_(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  return obj;
}

function otBuildId_(prefix) {
  return prefix + '_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100000);
}

function otCreateToken_(offerId, email) {
  const raw    = offerId + '|' + email + '|' + new Date().getTime() + '|' + Math.random();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digest.map(function(b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function otAddHours_(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function otWorkGroupMatches_(personWorkGroup, pattern) {
  if (!pattern) return true;
  const left = (personWorkGroup || '').toLowerCase().trim();
  return pattern.split('|').some(function(opt) {
    return left.indexOf(opt.toLowerCase().trim()) !== -1;
  });
}

function otNormalizeName_(name) {
  return String(name || '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
}

/** First token of display name for Slack/email salutation (e.g. "Jenna Bass" → "Jenna"). */
function otFirstName_(name) {
  const n = String(name || '').trim();
  if (!n) return 'there';
  return n.split(/\s+/)[0];
}

/** Slack mrkdwn hyperlink: <url|label> (hides raw URL in the client). */
function otSlackMrkdwnLink_(url, label) {
  const u = String(url || '').trim();
  const l = String(label || 'link').replace(/[<>|]/g, '');
  if (!u) return l;
  return '<' + u + '|' + l + '>';
}

function otBuildDateTime_(dateStr, timeStr, tz) {
  if (!dateStr || !timeStr) return null;
  const iso = dateStr.trim() + 'T' + timeStr.trim() + ':00';
  const d   = Utilities.parseDate(iso, tz, "yyyy-MM-dd'T'HH:mm:ss");
  return (!d || isNaN(d.getTime())) ? null : d;
}

function otFormatDateDisplay_(dateStr, tz) {
  const d = otBuildDateTime_(dateStr, '12:00', tz);
  return d ? Utilities.formatDate(d, tz, 'EEE, MMM d') : dateStr;
}

function otFormatTimeRange_(dateStr, start, end, tz) {
  const s = otBuildDateTime_(dateStr, start, tz);
  const e = otBuildDateTime_(dateStr, end,   tz);
  if (!s || !e) return start + ' - ' + end;
  return Utilities.formatDate(s, tz, 'h:mm a') + ' - ' +
         Utilities.formatDate(e, tz, 'h:mm a') + ' CT';
}

function otEscHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function otHtmlToPlain_(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim();
}

/*************************************************************
 * QUICK SETUP — paste at bottom, save, run from editor dropdown
 *
 * 1. Apps Script → Project Settings → Time zone → (GMT-06:00) Central Time
 * 2. Select SETUP_OT_SLACK_TRIGGERS → Run → Authorize
 * 3. Check Triggers (clock icon): 3 daily triggers at 8 AM, 2 PM, 5 PM
 *
 * Requires runOtChannelMorningOutlook_, runOtChannelTomorrowNeeds_,
 * and runOtChannelWeekOutlook_ elsewhere in this file (channel digest section).
 *************************************************************/

/** Run once: installs daily 8 AM, 2 PM, and 5 PM Central triggers. */
function SETUP_OT_SLACK_TRIGGERS() {
  const SPECS = [
    { fn: 'runOtChannelMorningOutlook_', hour: 8,  label: '8:00 AM CT — 3-day outlook' },
    { fn: 'runOtChannelTomorrowNeeds_',  hour: 14, label: '2:00 PM CT — tomorrow needs' },
    { fn: 'runOtChannelWeekOutlook_',    hour: 17, label: '5:00 PM CT — 7-day outlook' }
  ];

  REMOVE_OT_SLACK_TRIGGERS();

  SPECS.forEach(function(spec) {
    ScriptApp.newTrigger(spec.fn)
      .timeBased()
      .everyDays(1)
      .atHour(spec.hour)
      .nearMinute(0)
      .create();
  });

  const summary = SPECS.map(function(s) { return s.label + ' \u2192 ' + s.fn; }).join('\n');
  Logger.log('SETUP_OT_SLACK_TRIGGERS OK\n' + summary);

  try {
    SpreadsheetApp.getUi().alert([
      'OT Slack triggers installed.',
      '',
      summary,
      '',
      'Times use the Apps Script *project timezone*.',
      'Set Project Settings \u2192 Time zone to America/Chicago (Central).'
    ].join('\n'));
  } catch (e) { /* run from editor without sheet UI */ }
}

/** Removes the three OT Slack digest triggers only. */
function REMOVE_OT_SLACK_TRIGGERS() {
  const want = {
    runOtChannelMorningOutlook_: true,
    runOtChannelTomorrowNeeds_: true,
    runOtChannelWeekOutlook_: true
  };
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (want[trigger.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });
  Logger.log('REMOVE_OT_SLACK_TRIGGERS: removed ' + removed);
  try {
    SpreadsheetApp.getUi().alert('Removed ' + removed + ' OT Slack trigger(s).');
  } catch (e) { /* headless */ }
}

/** Lists installed OT Slack digest triggers (Execution log + alert). */
function LIST_OT_SLACK_TRIGGERS() {
  const want = {
    runOtChannelMorningOutlook_: true,
    runOtChannelTomorrowNeeds_: true,
    runOtChannelWeekOutlook_: true
  };
  var lines = [];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (want[trigger.getHandlerFunction()]) {
      lines.push(trigger.getHandlerFunction());
    }
  });
  const msg = lines.length ? lines.join('\n') : 'No OT Slack triggers found. Run SETUP_OT_SLACK_TRIGGERS.';
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) { /* headless */ }
}

/*************************************************************
 * OT COMMIT BRIDGE — Shift Optimizer batch commit (doPost)
 * Deploy web app with "Anyone" access. Set Script Property:
 *   OT_COMMIT_BRIDGE_SECRET — shared secret with shift-optimizer
 * Node env: OT_COMMIT_BRIDGE_URL, OT_COMMIT_BRIDGE_SECRET
 *************************************************************/
function doPost(e) {
  try {
    if (otIsSlackSlashDoPost_(e)) {
      return otHandleSlackSlashDoPost_(e);
    }
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'ot_commit_batch') {
      return otCommitJsonResponse_(otCommitBatchFromApi_(body));
    }
    return otCommitJsonResponse_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return otCommitJsonResponse_({ ok: false, error: String(err) });
  }
}

function otCommitJsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Batch commit from shift-optimizer OT Commit submit (live mode only).
 * Reuses otCommitToAssembled_ for activity POST + slot claim.
 */
function otCommitBatchFromApi_(body) {
  var secret = (PropertiesService.getScriptProperties().getProperty('OT_COMMIT_BRIDGE_SECRET') || '').trim();
  if (!secret || String(body.secret || '') !== secret) {
    return { ok: false, error: 'Unauthorized' };
  }

  var config = otGetConfig_();
  var email = String(body.consultantEmail || '').trim().toLowerCase();
  var agentId = String(body.agentId || '').trim();
  var selections = body.selections || [];
  var results = [];
  var allOk = true;

  selections.forEach(function(sel) {
    var offerId = 'ot-commit-' + Utilities.getUuid();
    var slotIds = (sel.slotIds && sel.slotIds.length) ? sel.slotIds : [];
    if (!slotIds.length && sel.slotId) slotIds = [String(sel.slotId)];
    var obj = {
      'Email': email,
      'Agent ID': agentId,
      'Date': String(sel.date || ''),
      'Start': String(sel.start || ''),
      'End': String(sel.end || ''),
      'Notes': slotIds.length ? ('SlotIDs:' + slotIds.join(',')) : '',
      'Queue App ID': String(sel.queueAppId || '')
    };
    var out = otCommitToAssembled_(offerId, obj, config);
    if (!out.ok) allOk = false;
    results.push({ slotId: sel.slotId, ok: out.ok, offerId: offerId });
  });

  otAudit_('OT_COMMIT_BATCH', email, 'token=' + String(body.token || '') + ' n=' + selections.length, allOk ? 'OK' : 'WARN');

  return {
    ok: allOk,
    message: allOk ? 'Batch committed' : 'Some selections failed — check Audit tab',
    results: results
  };
}