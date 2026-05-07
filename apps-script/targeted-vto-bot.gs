/*************************************************************
 * TARGETED VTO BOT v1.9.7
 * Mirrors the VTO engine pattern exactly:
 *   1. Poll Assembled net staffing
 *   2. Find surplus windows (net >= threshold) — VTO opportunity
 *   3. Match eligible reps (right queue + scheduled + not on no-fly)
 *   4. Send email with Accept / Decline links
 *   5. doGet handles response -> writes VTO activity to Assembled
 *
 * CHANGELOG v1.9.7
 *   - FIX: Week-block headroom gate was conflating MIN_SURPLUS (used to
 *     IDENTIFY surplus intervals) with the post-VTO safety floor. The old
 *     check `(entry.net - 1) < minSurplus` made it impossible to ever offer
 *     VTO that touched an interval at exactly the surplus threshold — every
 *     +2 (or +3 for ELD) interval was an instant chokepoint. With dozens of
 *     +2/+2.x dips scattered across a typical week, virtually no rep could
 *     pass the gate even when most intervals had +5 to +16 headroom.
 *     Symptom: 84 candidates passed eligibility, only 1 offer sent.
 *
 *     New config HEADROOM_FLOOR (default 0) controls only the post-VTO
 *     safety floor. MIN_SURPLUS retains its original meaning. The gate is
 *     now `(entry.net - 1) < headroomFloor`, so with the default a +2
 *     surplus interval can absorb 2 reps before headroom hits zero, and a
 *     +5 interval can absorb 5. Optional per-queue override:
 *     HEADROOM_FLOOR_<QUEUE_KEY> (same suffix as QUEUE_ENABLED_*).
 *     Audit row format updated to log surplusFloor + headroomFloor side by
 *     side so operators can see both numbers when reconciling.
 *
 * CHANGELOG v1.9.6
 *   - FIX: Week-block headroom math was double-counting reps' meal/break/
 *     lunch blocks against low-headroom intervals, causing mass false-
 *     negative "insufficient headroom" rejections. Built a dedicated
 *     phone-only schedule index (rvtoBuildPhoneSchedIdx_) sourced from a
 *     phone/chat/sms subset of the activity pull. Headroom map,
 *     rvtoRepCanFitInHeadroom_, rvtoConsumeHeadroom_, and
 *     rvtoRepPersonalFloor_ now use the phone-only index. Full schedIdx
 *     remains for eligibility/overlap checks where lunch/break correctly
 *     count as "scheduled". Audit upgrade: WEEK_BLOCK_HEADROOM rejections
 *     now log the exact chokepoint interval (timestamp, current net,
 *     projected post-VTO net, floor) instead of the generic
 *     "insufficient headroom" message.
 *
 * CHANGELOG v1.9.5
 *   - NEW: Optional per-queue MIN_SURPLUS override — Config key MIN_SURPLUS_<QUEUE_KEY>
 *     (same suffix as QUEUE_ENABLED_*), e.g. MIN_SURPLUS_Elementary_and_LD_CC90_New.
 *     Blank uses global MIN_SURPLUS. Applies to intraday surplus merge, SURPLUS_BLOCK audit,
 *     and week-block surplus intervals / headroom for that queue.
 *
 * CHANGELOG v1.9.4
 *   - NEW: Audit SURPLUS_BLOCK per intraday merged surplus window that passes filters.
 *     Logs RVTO_DEF id (matches Offers Deficit ID), interpreted net min/max, Assembled
 *     netRaw, Ramp_Inclusion ramp boost, scheduled & required forecast, site aggregate
 *     interpreted net (same gate as merge; ISC_New omitted from aggregate sum), merge
 *     interval count, headsNeeded. Explains bot staffing vs UI when reconciling offers.
 *
 * CHANGELOG v1.9.3
 *   - FIX: Ramp_Inclusion must add to interpreted net, not subtract. New hires increase
 *     effective staffing vs Assembled alone → more surplus headroom → more VTO room.
 *     rvtoRampNetBoostPerQueue_ (same overlap/N split) is now added to net in
 *     rvtoFindDeficits_ and rvtoFindWeekBlockSurplusDays_. (v1.9.2 had the sign inverted.)
 *
 * CHANGELOG v1.9.2
 *   - NEW: Ramp_Inclusion tab — model new-hire capacity not yet in Assembled (see v1.9.3
 *     for correct net adjustment direction).
 *
 * CHANGELOG v1.9.1
 *   - FIX: rvtoCheckQuota_() must not call UrlFetchApp.getRemainingDailyQuota — that
 *     method is not part of the public Apps Script API and throws TypeError at runtime.
 *     Google does not expose remaining UrlFetch byte quota to user scripts. The hook
 *     now: (1) returns false if Script Property RVTO_ABORT_RUNS is exactly TRUE
 *     (manual ops kill-switch); (2) otherwise returns true. Config QUOTA_SAFE_THRESHOLD_MB
 *     remains for operator reference only until/if Google adds a supported quota read.
 *
 * CHANGELOG v1.9.0
 *   - FIX: rvtoConfigBool_() for all Sheet-driven booleans. Google Sheets can store
 *     real boolean FALSE in the Value column; String(false) is "false" and the old
 *     `|| 'TRUE'` pattern incorrectly forced TRUE. SEND_EMAILS=FALSE now reliably
 *     suppresses email for both intraday and week-block runs.
 *   - WEEK-BLOCK: surplus intervals now retain per-interval .net from Assembled.
 *     rvtoBuildHeadroomMap_ / rvtoRepCanFitInHeadroom_ / rvtoConsumeHeadroom_ gate
 *     offers using running net headroom during each rep's scheduled hours, pre-
 *     deducting active WEEK_VTO sheet rows and consuming headroom after each offer
 *     (including SEND_EMAILS=FALSE dry-run rows). Audit: WEEK_BLOCK_HEADROOM.
 *
 * CHANGELOG v1.8.2
 *   - NEW: 1-hour minimum lead time on all offers (hardcoded, CST).
 *     Surplus blocks that start within 1 hour of the current time are
 *     discarded entirely in rvtoMergeDeficitBlocks_() before any offers
 *     are attempted. For partially-elapsed blocks where the rep's shift
 *     has already started, rvtoGetRepOfferWindow_() now clips the offer
 *     window start to now + 1 hour (rounded to the next 30-min boundary)
 *     rather than just now. If the remaining window after clipping is
 *     shorter than MIN_BLOCK_MINUTES, the offer is skipped.
 *     Prevents reps from receiving offers for shifts starting imminently
 *     with no realistic time to respond and action.
 *
 * CHANGELOG v1.8.1
 *   - NEW: Minimum offer gap (OFFER_MIN_GAP_HOURS, default 1). A rep cannot
 *     receive a second offer until at least this many hours have elapsed since
 *     their last sent offer, regardless of MAX_EMAILS_PER_24H setting. Rolling
 *     window — not reset at midnight. Prevents back-to-back trigger runs from
 *     sending near-identical offers to the same rep when multiple surplus
 *     windows are detected close together.
 *     rvtoBuildOfferHistory_() now tracks lastSentAt per rep. The gap check
 *     runs in rvtoFindEligible_() before the rep is selected. On COMMITTED,
 *     lastSentAt resets to null so hot reps can receive again immediately.
 *     On DECLINED, lastSentAt is preserved alongside the 999 pin.
 *
 * CHANGELOG v1.8.0
 *   - NEW: Hard decline freeze. A DECLINED row in rvtoBuildOfferHistory_()
 *     now pins the rep's sentToday and sentLast24h counters to 999,
 *     blocking any further offers for the full 24-hour window regardless
 *     of MAX_EMAILS_PER_24H config value. Previously, declines only counted
 *     as 1 against the cap — raising MAX_EMAILS_PER_24H above 1 (e.g. to 2
 *     or 3 during high take-rate periods) would allow a second offer to go
 *     out to a rep who already declined. The pin is also immune to the hot
 *     rep COMMITTED reset (v1.7.8): a subsequent COMMITTED row in the same
 *     sheet scan can no longer override a decline freeze.
 *
 * CHANGELOG v1.7.9
 *   - NEW: Manager Slack DM on VTO commit. When a rep's offer is committed
 *     to Assembled, their manager receives a Slack DM with the rep name,
 *     date, and time window (intraday) or full week range (week-block).
 *     Requires SLACK_BOT_TOKEN Script Property (same token as Adherence Bot).
 *     Config toggle: MANAGER_VTO_SLACK (default TRUE).
 *     New tab: Manager_Aliases (Name | Slack Alias). Auto-populated from
 *     Roster on Setup Workbook run, same firstname.lastname derivation as
 *     Adherence Bot. Never overwrites existing entries.
 *     Failures are audit-logged only — never disrupts the commit flow.
 *     New functions: rvtoGetManagerAliasMap_(), rvtoGetManagerForRep_(),
 *     rvtoGetSlackUserId_(), rvtoSendSlackDm_(),
 *     rvtoNotifyManagerOnCommit_(), rvtoPopulateManagerAliasesFromRoster_().
 *
 * CHANGELOG v1.7.8
 *   - NEW: "Hot rep" re-eligibility. When rvtoBuildOfferHistory_() encounters
 *     a COMMITTED row for a rep, their daily and 24h cap counters are reset to
 *     zero. A rep who accepts and commits an offer becomes immediately eligible
 *     for another offer on the next run. Their counter increments again when
 *     the next offer is sent and normal cap rules resume from there.
 *     Rows are processed in sheet order so a COMMITTED row always supersedes
 *     earlier sent rows for the same rep within the same session.
 *
 * CHANGELOG v1.7.7
 *   - Offer email subject lines now include date and time so reps can
 *     accept or decline from their inbox preview without opening the email.
 *     Standard: "VTO Opportunity — Fri Apr 29, 2:00 PM - 6:00 PM CT"
 *     Week-block: "VTO Opportunity — Mon Jun 1 – Fri Jun 7"
 *     EMAIL_SUBJECT_PREFIX config row still controls the prefix.
 *
 * CHANGELOG v1.7.6
 *   - NEW: Per-rep 15% surplus gate for week-block offers. Config row
 *     WEEK_VTO_MIN_SURPLUS_PCT (default 15). A rep only receives a week-block
 *     offer if the hours of their scheduled shifts that overlap surplus
 *     intervals are >= this % of their total scheduled hours for the week.
 *     Replaces the queue-level majority-of-days gate.
 *   - NEW: Midday sort tiebreaker. After PGC sort, reps with earlier average
 *     shift end times are offered VTO first within the same PGC tier. Protects
 *     evening staffing by prioritising reps who finish earlier in the day.
 *   - rvtoFindWeekBlockSurplusDays_() now returns surplus intervals per queue
 *     per day (not just a boolean day list) to enable per-rep overlap math.
 *   - New helpers: rvtoCalcRepSurplusPct_(), rvtoAvgShiftEndMinutes_().
 *   - Audit rows now show belowSurplusPct count and per-queue surplus day counts.
 *
 * CHANGELOG v1.7.5
 *   - FIX: rvtoFindWeekBlockSurplusDays_() was passing end_time as 23:59 to
 *     the Assembled /forecasted_vs_actuals API, which requires end_time to
 *     land on an exact 30-minute boundary (1800s increment). Assembled
 *     returned 400 "expect end in an increment of 1800" for every day/queue
 *     combination, causing all surplus checks to fail and zero offers to send.
 *     Fixed by using midnight of the next day as end_time, matching the same
 *     pattern already used in rvtoFindDeficits_().
 *     Also aligned rvtoPullSchedulesForDateRange_() end boundary to midnight
 *     of the day after WEEK_VTO_END_DATE for consistency.
 *
 * CHANGELOG v1.7.4
 *   - FIX: WEEK_VTO_START_DATE and WEEK_VTO_END_DATE are now normalised before
 *     parsing. Google Sheets auto-converts yyyy-MM-dd config cells to Date
 *     objects on read, causing rvtoBuildDateTime_() to receive a full Date
 *     toString() string (e.g. "Mon Jun 01 2026 00:00:00 GMT-0500") instead of
 *     "2026-06-01", throwing "Invalid argument". New helper
 *     rvtoWkNormDateStr_() detects Date objects and string dates and normalises
 *     both to yyyy-MM-dd before any further parsing.
 *
 * CHANGELOG v1.7.3
 *   - FIX: Week-block Assembled commits now post one VTO activity per actual
 *     scheduled working block rather than a generic 08:00-17:00 daily range.
 *     At offer-send time, rvtoGetRepScheduledBlocks_() serialises the rep's
 *     exact shift windows (clipped to each surplus day) into the Offers sheet
 *     Notes column as "Blocks: yyyy-MM-dd HH:mm-HH:mm|...". On accept,
 *     rvtoCommitWeekBlockToAssembled_() parses these and posts one /activities
 *     POST per block. Falls back to 08:00-17:00 per day for offers created
 *     before v1.7.3 (no Blocks data in Notes).
 *     New helper: rvtoGetRepScheduledBlocks_().
 *
 * CHANGELOG v1.7.2
 *   - NEW: STANDARD_VTO_ENABLED config row (default TRUE). Set FALSE to
 *     disable the intraday runReverseVto() trigger entirely while leaving
 *     week-block VTO unaffected. Useful when running a week-block campaign
 *     and wanting to suppress normal per-surplus offers for that period.
 *     Defaults TRUE on existing deployments even if Setup Workbook has not
 *     been re-run (missing or blank value treated as TRUE).
 *
 * CHANGELOG v1.7.1
 *   - FIX: Week-block schedule pull now uses rvtoPullSchedulesForDateRange_()
 *     instead of rvtoPullSchedules_(). The normal pull uses SCHEDULE_PULL_HOURS
 *     (currently 78h) which cannot reach future week-block dates (e.g. 34 days
 *     out). The new function pulls exactly from WEEK_VTO_START_DATE 00:00 to
 *     WEEK_VTO_END_DATE 23:59, ignoring SCHEDULE_PULL_HOURS entirely.
 *     SCHEDULE_PULL_HOURS is unchanged and still governs the normal intraday
 *     runReverseVto() flow only.
 *
 * CHANGELOG v1.7.0
 *   - Week-Block VTO: offer a full working week of VTO in a single
 *     email. Reps accept or decline the entire date range at once.
 *     Config tab rows: WEEK_VTO_ENABLED (TRUE/FALSE), WEEK_VTO_START_DATE
 *     (yyyy-MM-dd), WEEK_VTO_END_DATE (yyyy-MM-dd).
 *     Surplus gate: a majority of targeted days must have net staffing
 *     >= MIN_SURPLUS on at least one interval per day, per queue.
 *     Eligibility: same pipeline as normal VTO (no-fly, work group,
 *     schedule overlap, shadow exclusion). Cap-EXEMPT — week-block
 *     offers do not count against daily/24h caps so normal VTO runs
 *     independently. On accept, commits a VTO activity to Assembled
 *     for every targeted day the rep is scheduled.
 *     New menu item: Run Week-Block VTO -> runWeekBlockVto().
 *     New functions: runWeekBlockVto(), rvtoRunWeekBlock_(),
 *     rvtoFindWeekBlockSurplusDays_(), rvtoGetWeekBlockDates_(),
 *     rvtoSendWeekBlockOfferEmail_(), rvtoCommitWeekBlockToAssembled_(),
 *     rvtoProcessWeekBlockResponse_(). Offer rows tagged WEEK_VTO in
 *     Notes. doGet routes week-block offer IDs to the new handler.
 *
 * CHANGELOG v1.6.5
 *   - Audit: PGC_ORDER logs the first N eligible reps after PGC sort
 *     (email + PGC=no_row or numeric). Config PGC_DEBUG_TOP_N (default 8,
 *     set 0 to disable). Proves ordering without opening the PGC sheet.
 *
 * CHANGELOG v1.6.4
 *   - PGC priority layer: daily PGC % from an external Google Sheet
 *     (Script Properties only: PGC_SPREADSHEET_ID; optional PGC_SHEET_NAME).
 *     Column B = rep name, column G = PGC. Among eligible reps, those
 *     with no matching PGC row are sorted first; then lowest PGC first.
 *     Toggle via Config USE_PGC_PRIORITY (default TRUE).
 *   - rvtoLoadPgcMap_(), rvtoParsePgcValue_(), rvtoSortEligibleByPgc_().
 *
 * CHANGELOG v1.6.3
 *   - Added Shadow_Exclusion tab. Reps listed here (Name + Email)
 *     are silently removed from the Assembled schedule pull before
 *     any surplus or eligibility math runs. Their scheduled hours
 *     do not count toward staffing, and they cannot receive offers.
 *     Assembled is never touched — the exclusion is bot-side only.
 *     Intended for reps pending termination who should not be
 *     counted as available headcount without their knowledge.
 *     Added rvtoGetShadowExclusionSet_() reader and
 *     rvtoGetShadowExclusionEmails_() context loader.
 *
 * CHANGELOG v1.6.2
 *   - Added quota guard to runReverseVto(). Checks remaining
 *     UrlFetch bandwidth before executing. If less than
 *     QUOTA_SAFE_THRESHOLD_MB (10MB) remains for the day, the
 *     run is aborted and logged to Audit. Prevents this script
 *     from contributing to account-wide bandwidth exhaustion
 *     that blocks other scripts (e.g. Schedule Repair Bot).
 *     Google's daily UrlFetch limit is 100MB shared across all
 *     scripts in the account.
 *
 * CHANGELOG v1.6.1
 *   - FIX: blockExpiry was computed using deficit.start (the raw surplus
 *     block start) instead of offerWindow.start (the rep's actual clipped
 *     offer window start). For reps whose shifts started hours after the
 *     surplus block began, blockStart + 5 min resolved to a time already
 *     in the past, causing offers to expire immediately on the next expiry
 *     sweep — sometimes before they were even sent.
 *   - Fix: offerWindow is now computed BEFORE the expiry block.
 *     blockExpiry uses offerWindow.date + offerWindow.start so the 5-minute
 *     grace window is anchored to the rep's actual offer start, not the
 *     deficit block start.
 *
 * CHANGELOG v1.6
 *   - NEW: Offer expiry now uses the EARLIER of:
 *       (a) sentAt + OFFER_HOLD_HOURS  (existing hold-window cap)
 *       (b) blockStart + 5 minutes     (offer dies 5 min after the
 *           VTO period begins so reps cannot accept a window that
 *           is already underway)
 *     Expires At is computed at send time and written to the Offers
 *     sheet. expireRvtoOffers_() is unchanged — it already reads
 *     Expires At directly from the sheet.
 *   - Email body: removed hold-hours sentence, replaced with
 *     "Please respond before this offer expires."
 *   - Changelog sheet row added for v1.6.
 *
 * CHANGELOG v1.5.9
 *   - FIX: Timeout-orphaned PENDING_SEND rows eliminated by reversing
 *     the send/append order. Email is now attempted BEFORE the row is
 *     appended to the Offers sheet. The row is written once with the
 *     correct final status (SENT or SEND_FAILED) rather than being
 *     written as PENDING_SEND and updated afterward. A 6-minute
 *     Apps Script timeout mid-loop no longer leaves stuck
 *     PENDING_SEND rows because no row exists until the send result
 *     is known. PENDING_SEND is retained as a status only for the
 *     SEND_EMAILS=FALSE dry-run path. SpreadsheetApp.flush() added
 *     after appendRow to ensure the row is committed to the sheet
 *     before execution continues.
 *
 * CHANGELOG v1.5.8
 *   - FIX: Rolling 24h cap window was only looking back MAX_EMAILS_PER_24H
 *     hours instead of 24 hours. rvtoBuildOfferHistory_ was called with
 *     hoursBack = MAX_EMAILS_PER_24H (typically 1), so the cutoff was only
 *     1 hour in the past. Reps who received an offer more than 1 hour ago
 *     were invisible to the cap and received duplicates. Fixed by hardcoding
 *     the lookback to 24 hours and using MAX_EMAILS_PER_24H only as the
 *     count threshold.
 *   - FIX: In-memory offersByEmail is now updated immediately after each
 *     offer is committed in the current run, so reps selected for multiple
 *     deficit windows in the same execution are correctly blocked after the
 *     first offer regardless of selectedThisRun behavior.
 *
 * CHANGELOG v1.5.7
 *   - FIX: PENDING_SEND rows were being excluded from the 24h/daily
 *     cap check in rvtoBuildOfferHistory_, allowing duplicate offers
 *     to be sent when a trigger fired while a row was still in
 *     PENDING_SEND state (i.e. between appendRow and the subsequent
 *     status update to SENT). PENDING_SEND now counts against both
 *     caps. Only SEND_FAILED and blank-status rows are skipped.
 *     Also added a 24h-cap fallback for PENDING_SEND rows that have
 *     no sentAt yet: if the offer date is today, it counts against
 *     sentLast24h regardless.
 *
 * CHANGELOG v1.5.6
 *   - FIX: Daily offer cap was not being enforced across runs because
 *     Google Sheets auto-converts the Date column back to a Date object
 *     on read. rvtoBuildOfferHistory_ now checks instanceof Date and
 *     formats correctly before comparing to todayKey, so existing SENT
 *     rows are correctly counted against the per-day cap.
 *
 * CHANGELOG v1.5.5
 *   - FIX: Offer window start is now clipped to the next 30-minute
 *     boundary after the current time when the offer date is today
 *     and the rep's shift has already started. If the remaining
 *     clipped window is shorter than MIN_BLOCK_MINUTES, the offer
 *     is skipped entirely for that rep rather than sending a window
 *     that is too short to be meaningful.
 *
 * CHANGELOG v1.5.4
 *   - FIX: Offer window now reflects the rep's actual scheduled
 *     shift within the surplus block, not the full surplus span.
 *     e.g. if surplus is 07:00-22:00 but rep is scheduled 09:00-17:00,
 *     the offer shows 09:00-17:00. Rep schedule blocks overlapping
 *     the deficit are merged and used as offer start/end.
 *   - FIX: 24-hour offer cap now correctly enforced across manual
 *     re-runs. offersByEmail now counts all non-pending, non-failed
 *     statuses. selectedThisRun set prevents duplicates within a
 *     single execution regardless of sheet flush timing.
 *   - Added Changelog sheet, pre-populated with full version history.
 *
 * CHANGELOG v1.5.3
 *   - Added Changelog sheet to workbook setup.
 *
 * CHANGELOG v1.5.2
 *   - Replaced full-span schedule coverage check with overlap-based
 *     check (rvtoHasScheduleOverlap_).
 *   - Added MIN_SCHEDULE_OVERLAP_HOURS config row (default: 2).
 *
 * CHANGELOG v1.5.1
 *   - Fixed surplus block filter: changed blockStart < now to
 *     blockEnd <= now so partially-elapsed blocks are retained.
 *
 * CHANGELOG v1.5
 *   - Added Support site queues.
 *   - Per-site ID resolution.
 *   - Per-queue enable/disable config toggles.
 *   - Added ASSEMBLED_SITE_SUPPORT property.
 *
 * CHANGELOG v1.4
 *   - Fixed past-shift offer bug.
 *
 * CHANGELOG v1.3
 *   - Fixed date/time storage bug in rvtoAppendOfferRow_.
 *
 * CHANGELOG v1.2
 *   - Fixed Assembled commit agent ID lookup via /people API.
 *   - Fixed activity type ID resolution.
 *
 * CHANGELOG v1.1
 *   - Fixed timezone bug in rvtoMergeDeficitBlocks_.
 *
 * SETUP
 *   1. Run setupRvtoWorkbook() once (or re-run to add new config rows)
 *   2. Set Script Properties:
 *        ASSEMBLED_API_KEY
 *        RVTO_WEB_APP_URL
 *        ASSEMBLED_VTO_ACTIVITY_ID
 *        PGC_SPREADSHEET_ID (Looker PGC sheet — column B name, G = PGC)
 *        PGC_SHEET_NAME (optional tab name; omit = first sheet)
 *   3. Populate the Roster sheet
 *   4. Deploy as web app (execute as: me, anyone can access)
 *   5. Set a time-based trigger on runReverseVto() (e.g. every 10 min)
 *************************************************************/

/*************************************************************
 * CONSTANTS
 *************************************************************/
const RVTO_APP = {
  VERSION: 'V1.9.7',
  BASE_URL: 'https://api.assembledhq.com/v0',

  SHEETS: {
    CONFIG:           'Config',
    ROSTER:           'Roster',
    NO_FLY:           'No_Fly',
    SHADOW_EXCLUSION: 'Shadow_Exclusion',
    RAMP_INCLUSION:   'Ramp_Inclusion',
    OFFERS:           'Offers',
    AUDIT:            'Audit',
    CHANGELOG:        'Changelog',
    MANAGER_ALIASES:  'Manager_Aliases'
  },

  SITES: {
    CONSUMER_SALES: 'consumer_sales',
    SUPPORT:        'support'
  },

  SITE_NAMES: {
    consumer_sales: 'Consumer Sales',
    support:        'Support'
  },

  QUEUE_DEFS: [
    {
      name:             'Adult Learner_CC90_New',
      site:             'consumer_sales',
      workGroupPattern: 'Core Test Group|Languages Test Group',
      key:              'Adult_Learner_CC90_New'
    },
    {
      name:             'Prof Certs_CC90_New',
      site:             'consumer_sales',
      workGroupPattern: 'Professional Certifications',
      key:              'Prof_Certs_CC90_New'
    },
    {
      name:             'College and Grad TP_CC90_New',
      site:             'consumer_sales',
      workGroupPattern: 'STEM College Test Group|Graduate Test Prep',
      key:              'College_and_Grad_TP_CC90_New'
    },
    {
      name:             'Elementary and LD_CC90_New',
      site:             'consumer_sales',
      workGroupPattern: 'K-6 Test Group|Learning Differences Test Group',
      key:              'Elementary_and_LD_CC90_New'
    },
    {
      name:             'ISC_New',
      site:             'consumer_sales',
      workGroupPattern: 'ISC|Initial Support Consultant',
      key:              'ISC_New'
    },
    {
      name:             'High School_CC90_New',
      site:             'consumer_sales',
      workGroupPattern: 'STEM High School Test Group|K12 Test Prep',
      key:              'High_School_CC90_New'
    },
    {
      name:             'Client Chat',
      site:             'support',
      workGroupPattern: 'Support Operations',
      key:              'Client_Chat'
    },
    {
      name:             'Client SMS',
      site:             'support',
      workGroupPattern: 'Support Operations',
      key:              'Client_SMS'
    },
    {
      name:             'RTN IB Phone Tier 2',
      site:             'support',
      workGroupPattern: 'Phone - RTN',
      key:              'RTN_IB_Phone_Tier_2'
    },
    {
      name:             'RTN IB Phone Tier 3',
      site:             'support',
      workGroupPattern: 'Phone - RTN',
      key:              'RTN_IB_Phone_Tier_3'
    },
    {
      name:             'CEP IB Phone',
      site:             'support',
      workGroupPattern: 'Phone - CEP',
      key:              'CEP_IB_Phone'
    },
    {
      name:             'Tutor Chat',
      site:             'support',
      workGroupPattern: 'Support Operations',
      key:              'Tutor_Chat'
    },
    {
      name:             'Platform Support Chat',
      site:             'support',
      workGroupPattern: 'Support Operations',
      key:              'Platform_Support_Chat'
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
  },

  WEEK_BLOCK_PREFIX: 'RVTO_WK'
};

/*************************************************************
 * MENU
 *************************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Reverse VTO')
    .addItem('Run Now', 'runReverseVto')
    .addItem('Run Week-Block VTO', 'runWeekBlockVto')
    .addSeparator()
    .addItem('Expire Open Offers', 'expireRvtoOffersMenu')
    .addItem('Clear All Offers', 'clearRvtoOffers')
    .addSeparator()
    .addItem('Setup Workbook', 'setupRvtoWorkbook')
    .addItem('Cleanup Legacy Tabs', 'cleanupLegacyTabs')
    .addToUi();
}

/**
 * v1.9.1: Google Apps Script does not provide a supported way to read remaining
 * UrlFetch daily bandwidth (UrlFetchApp.getRemainingDailyQuota is not a public API).
 * Use Script Property RVTO_ABORT_RUNS=TRUE to skip intraday runs when ops need to
 * stop UrlFetch-heavy scripts manually. Config QUOTA_SAFE_THRESHOLD_MB is unused here
 * until Google documents a real quota query.
 */
function rvtoCheckQuota_(config) {
  var abort = (PropertiesService.getScriptProperties().getProperty('RVTO_ABORT_RUNS') || '')
    .trim()
    .toUpperCase() === 'TRUE';
  if (abort) {
    rvtoAudit_('RUN', '',
      'Aborted — Script Property RVTO_ABORT_RUNS=TRUE (manual UrlFetch / run kill-switch)',
      'WARN');
    return false;
  }
  return true;
}

/*************************************************************
 * ENTRY POINTS
 *************************************************************/
function runReverseVto() {
  expireRvtoOffers_();

  const config = rvtoGetConfig_();

  if (!rvtoCheckQuota_(config)) {
    return;
  }

  // STANDARD_VTO_ENABLED defaults TRUE so existing deployments are unaffected
  // if the config row hasn't been added yet via Setup Workbook.
  const standardEnabled = rvtoConfigBool_(config.STANDARD_VTO_ENABLED, true);

  if (!standardEnabled) {
    rvtoAudit_('RUN', '', 'Skipped — STANDARD_VTO_ENABLED is FALSE', 'OK');
    return;
  }

  const rules  = rvtoGetRules_(config);
  const ctx    = rvtoBuildContext_(config, rules);

  ctx.enabledQueues = rvtoGetEnabledQueues_(config);

  if (!ctx.enabledQueues.length) {
    rvtoAudit_('RUN', '', 'No queues enabled — check QUEUE_ENABLED_* config rows', 'WARN');
    return;
  }

  const deficits  = rvtoFindDeficits_(ctx);

  if (!deficits.length) {
    rvtoAudit_('RUN', '', 'No surplus windows found', 'OK');
    return;
  }

  const roster    = rvtoGetRoster_(ctx);
  const schedules = rvtoPullSchedules_(ctx);
  const schedIdx  = rvtoBuildSchedIdx_(schedules);

  let totalOffers = 0;
  let totalSent   = 0;

  const sendEmails = rvtoConfigBool_(config.SEND_EMAILS, true);

  deficits.forEach(function(deficit) {
    const eligible = rvtoFindEligible_(deficit, roster, schedIdx, ctx);
    if (!eligible.length) return;

    const reservedSeats  = rvtoCountReservedSeats_(deficit, ctx.offerObjects || []);
    const seatsAvailable = Math.max(0, deficit.headsNeeded - reservedSeats);

    if (!seatsAvailable) {
      rvtoAudit_('RUN', deficit.deficitId,
        'Skipped — all seats reserved. Reserved: ' + reservedSeats + ' / Needed: ' + deficit.headsNeeded,
        'OK');
      return;
    }

    const selected = eligible.slice(0, seatsAvailable);

    selected.forEach(function(person) {
      const offerId   = rvtoBuildId_('RVTO_OFF');
      const token     = rvtoCreateToken_(offerId, person.email);
      const webAppUrl = rvtoGetWebAppUrl_(config);

      const offerWindow = rvtoGetRepOfferWindow_(
        person.email, deficit.startTime, deficit.endTime, schedIdx, ctx.timezone,
        new Date(), rules.MIN_BLOCK_MINUTES
      );
      if (!offerWindow) {
        rvtoAudit_('RUN', deficit.deficitId,
          'Skipped offer for ' + person.email + ' — remaining window too short after clipping to now', 'OK');
        return;
      }

      const acceptUrl  = webAppUrl
        ? (webAppUrl + '?offer_id=' + encodeURIComponent(offerId) + '&action=accept&token='  + encodeURIComponent(token))
        : '';
      const declineUrl = webAppUrl
        ? (webAppUrl + '?offer_id=' + encodeURIComponent(offerId) + '&action=decline&token=' + encodeURIComponent(token))
        : '';

      const holdHours = Number(rules.OFFER_HOLD_HOURS || 1);
      const sentAt    = new Date();

      const holdExpiry          = rvtoAddHours_(sentAt, holdHours);
      const offerWindowStart    = rvtoBuildDateTime_(offerWindow.date, offerWindow.start, ctx.timezone);
      const blockExpiry         = offerWindowStart
        ? new Date(offerWindowStart.getTime() + 5 * 60 * 1000)
        : holdExpiry;
      const expiresAt           = (blockExpiry < holdExpiry) ? blockExpiry : holdExpiry;

      if (!sendEmails) {
        rvtoAppendOfferRow_({
          offerId:    offerId,
          deficitId:  deficit.deficitId,
          date:       offerWindow.date,
          start:      offerWindow.start,
          end:        offerWindow.end,
          name:       person.name,
          email:      person.email,
          agentId:    person.agentId || '',
          queue:      deficit.queue,
          manager:    person.manager || '',
          sentAt:     sentAt,
          expiresAt:  expiresAt,
          holdHours:  holdHours,
          status:     RVTO_APP.OFFER_STATUSES.PENDING_SEND,
          token:      token,
          acceptUrl:  acceptUrl,
          declineUrl: declineUrl
        });
        SpreadsheetApp.flush();
        totalOffers++;

        const emailKeyDry = person.email.trim().toLowerCase();
        if (!ctx.offersByEmail[emailKeyDry]) ctx.offersByEmail[emailKeyDry] = { sentToday: 0, sentLast24h: 0 };
        ctx.offersByEmail[emailKeyDry].sentToday++;
        ctx.offersByEmail[emailKeyDry].sentLast24h++;
        return;
      }

      let sent = false;
      try {
        sent = rvtoSendOfferEmail_({
          config:     config,
          offerId:    offerId,
          email:      person.email,
          name:       person.name,
          queue:      deficit.queue,
          date:       offerWindow.date,
          start:      offerWindow.start,
          end:        offerWindow.end,
          holdHours:  holdHours,
          expiresAt:  expiresAt,
          acceptUrl:  acceptUrl,
          declineUrl: declineUrl
        });
      } catch (sendErr) {
        rvtoAudit_('SEND_EMAIL', offerId, 'Unhandled exception: ' + String(sendErr), 'FAILED');
        sent = false;
      }

      const finalStatus = sent
        ? RVTO_APP.OFFER_STATUSES.SENT
        : RVTO_APP.OFFER_STATUSES.SEND_FAILED;

      rvtoAppendOfferRow_({
        offerId:    offerId,
        deficitId:  deficit.deficitId,
        date:       offerWindow.date,
        start:      offerWindow.start,
        end:        offerWindow.end,
        name:       person.name,
        email:      person.email,
        agentId:    person.agentId || '',
        queue:      deficit.queue,
        manager:    person.manager || '',
        sentAt:     sentAt,
        expiresAt:  expiresAt,
        holdHours:  holdHours,
        status:     finalStatus,
        token:      token,
        acceptUrl:  acceptUrl,
        declineUrl: declineUrl
      });
      SpreadsheetApp.flush();

      totalOffers++;
      if (sent) totalSent++;

      const emailKey = person.email.trim().toLowerCase();
      if (!ctx.offersByEmail[emailKey]) ctx.offersByEmail[emailKey] = { sentToday: 0, sentLast24h: 0 };
      ctx.offersByEmail[emailKey].sentToday++;
      ctx.offersByEmail[emailKey].sentLast24h++;
    });
  });

  rvtoAudit_('RUN', '',
    'Queues active: ' + ctx.enabledQueues.length +
    ' | Surpluses: ' + deficits.length +
    ' | Offers: ' + totalOffers +
    ' | Sent: ' + totalSent,
    'OK');
}

function expireRvtoOffersMenu() {
  const count = expireRvtoOffers_();
  SpreadsheetApp.getUi().alert('Expired ' + count + ' offer(s).');
}

function clearRvtoOffers() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return;
  rvtoClearSheetBody_(sheet);
  SpreadsheetApp.getUi().alert('All offers cleared.');
}

/*************************************************************
 * WEEK-BLOCK VTO — ENTRY POINT (v1.7.0)
 *************************************************************/

/**
 * Manual entry point: Reverse VTO menu -> Run Week-Block VTO.
 * Reads WEEK_VTO_ENABLED, WEEK_VTO_START_DATE, WEEK_VTO_END_DATE from Config.
 * For each enabled queue, checks that a majority of targeted days show surplus.
 * Sends one email per eligible rep covering the full date range.
 * Cap-exempt: does not increment offersByEmail so normal VTO runs independently.
 */
function runWeekBlockVto() {
  const config = rvtoGetConfig_();
  const rules  = rvtoGetRules_(config);
  const ctx    = rvtoBuildContext_(config, rules);

  ctx.enabledQueues = rvtoGetEnabledQueues_(config);

  const enabled = rvtoConfigBool_(config.WEEK_VTO_ENABLED, false);
  if (!enabled) {
    SpreadsheetApp.getUi().alert('Week-Block VTO is disabled.\nSet WEEK_VTO_ENABLED = TRUE in the Config tab to activate it.');
    rvtoAudit_('WEEK_BLOCK_RUN', '', 'Aborted — WEEK_VTO_ENABLED is FALSE', 'WARN');
    return;
  }

  const dates = rvtoGetWeekBlockDates_(config, ctx.timezone);
  if (!dates) {
    SpreadsheetApp.getUi().alert('Invalid or missing week-block dates.\nSet WEEK_VTO_START_DATE and WEEK_VTO_END_DATE in the Config tab (format: yyyy-MM-dd).');
    rvtoAudit_('WEEK_BLOCK_RUN', '', 'Aborted — invalid or missing WEEK_VTO_START_DATE / WEEK_VTO_END_DATE', 'WARN');
    return;
  }

  if (!ctx.enabledQueues.length) {
    rvtoAudit_('WEEK_BLOCK_RUN', '', 'No queues enabled — check QUEUE_ENABLED_* config rows', 'WARN');
    SpreadsheetApp.getUi().alert('No queues are enabled. Check QUEUE_ENABLED_* rows in Config.');
    return;
  }

  rvtoAudit_('WEEK_BLOCK_RUN', '',
    'Starting week-block run: ' + dates.startDateStr + ' to ' + dates.endDateStr +
    ' | Days: ' + dates.dateList.length +
    ' | Queues: ' + ctx.enabledQueues.length,
    'INFO');

  const result = rvtoRunWeekBlock_(ctx, dates);

  SpreadsheetApp.getUi().alert([
    'Week-Block VTO run complete.',
    'Date range: ' + dates.startDateStr + ' to ' + dates.endDateStr,
    'Queues checked: ' + ctx.enabledQueues.length,
    'Offers sent: ' + result.sent,
    'Offers failed: ' + result.failed,
    'Reps skipped (no qualifying queue): ' + result.skipped
  ].join('\n'));
}

/**
 * Core week-block logic. Called by runWeekBlockVto().
 * Returns { sent, failed, skipped }.
 */
function rvtoRunWeekBlock_(ctx, dates) {
  const config     = ctx.config;
  const sendEmails = rvtoConfigBool_(config.SEND_EMAILS, true);
  const webAppUrl  = rvtoGetWebAppUrl_(config);
  const holdHours  = Number(ctx.rules.OFFER_HOLD_HOURS || 1);

  const schedules     = rvtoPullSchedulesForDateRange_(ctx, dates.startDate, dates.endDate);
  const schedIdx      = rvtoBuildSchedIdx_(schedules);
  // v1.9.6: Phone-only index for headroom math. See rvtoBuildPhoneSchedIdx_()
  // and rvtoRepCanFitInHeadroom_() comments for why this is separate.
  const phoneSchedIdx = rvtoBuildPhoneSchedIdx_(schedules.phoneRows || []);
  const roster        = rvtoGetRoster_(ctx);

  const surplusIntervalsByQueue = rvtoFindWeekBlockSurplusDays_(ctx, dates);

  rvtoAudit_('WEEK_BLOCK_SURPLUS', '',
    'Surplus day counts by queue: ' +
    Object.keys(surplusIntervalsByQueue).map(function(q) {
      return q + '=' + Object.keys(surplusIntervalsByQueue[q] || {}).length + '/' + dates.dateList.length;
    }).join(', '),
    'INFO');

  const qualifyingQueues = ctx.enabledQueues.filter(function(qd) {
    return Object.keys(surplusIntervalsByQueue[qd.name] || {}).length > 0;
  });

  if (!qualifyingQueues.length) {
    rvtoAudit_('WEEK_BLOCK_RUN', '', 'No queues had any surplus days in the target range — no offers sent', 'OK');
    return { sent: 0, failed: 0, skipped: 0 };
  }

  rvtoAudit_('WEEK_BLOCK_RUN', '',
    'Qualifying queues (have surplus days): ' + qualifyingQueues.map(function(q) {
      return q.name + '(' + Object.keys(surplusIntervalsByQueue[q.name] || {}).length + 'd)';
    }).join(', '),
    'INFO');

  const weekBlockSentThisRun = new Set();
  let sent    = 0;
  let failed  = 0;
  let skipped = 0;

  qualifyingQueues.forEach(function(qd) {
    // v1.9.7: surplus floor (detection) and headroom floor (post-VTO safety) are
    // now independent. MIN_SURPLUS controls which intervals enter the headroom map.
    // HEADROOM_FLOOR controls how far we'll let an interval drop after offering VTO.
    const qMinSurplus    = rvtoEffectiveMinSurplusForQueue_(qd.name, ctx.rules);
    const qHeadroomFloor = rvtoEffectiveHeadroomFloorForQueue_(qd.name, ctx.rules);
    const surplusDays           = Object.keys(surplusIntervalsByQueue[qd.name] || {});
    const queueSurplusIntervals = surplusIntervalsByQueue[qd.name] || {};
    // v1.9.6: Headroom map and downstream gates use phone-only index.
    const headroomMap           = rvtoBuildHeadroomMap_(
      queueSurplusIntervals,
      ctx.offerObjects || [],
      qd.name,
      phoneSchedIdx
    );

    var headroomSummary = [];
    Object.keys(headroomMap).forEach(function(k) {
      var e = headroomMap[k];
      headroomSummary.push(
        Utilities.formatDate(e.start, ctx.timezone, 'MM-dd HH:mm') + '=+' + (Math.round(e.net * 10) / 10)
      );
    });
    rvtoAudit_('WEEK_BLOCK_HEADROOM', qd.name,
      'Initial headroom (' + Object.keys(headroomMap).length + ' intervals, surplusFloor=' + qMinSurplus +
      ', headroomFloor=' + qHeadroomFloor + '): ' +
      headroomSummary.slice(0, 20).join(' | ') +
      (headroomSummary.length > 20 ? ' (+' + (headroomSummary.length - 20) + ' more)' : ''),
      'INFO');

    const syntheticDeficit = {
      deficitId:   rvtoBuildId_('RVTO_WK_DEF'),
      queue:       qd.name,
      site:        qd.site,
      date:        dates.startDateStr,
      start:       '00:00',
      end:         '23:59',
      netMin:      1,
      headsNeeded: 999,
      startTime:   dates.startDate,
      endTime:     dates.endDate
    };

    const eligible = rvtoFindWeekBlockEligible_(
      syntheticDeficit, roster, schedIdx, ctx, dates, queueSurplusIntervals
    );

    if (!eligible.length) {
      rvtoAudit_('WEEK_BLOCK_ELIGIBILITY', qd.name, 'No eligible reps found for this queue', 'WARN');
      skipped++;
      return;
    }

    eligible.forEach(function(person) {
      const email = person.email.trim().toLowerCase();
      if (weekBlockSentThisRun.has(email)) {
        skipped++;
        return;
      }

      if (!rvtoRepCanFitInHeadroom_(email, phoneSchedIdx, headroomMap, qMinSurplus, qd.name, qHeadroomFloor)) {
        skipped++;
        return;
      }

      const repScheduledDays = rvtoGetRepScheduledDays_(email, surplusDays, schedIdx, ctx.timezone);
      if (!repScheduledDays.length) {
        rvtoAudit_('WEEK_BLOCK_RUN', '', 'Skipped ' + email + ' — not scheduled on any surplus day', 'OK');
        skipped++;
        return;
      }

      const repScheduledBlocks = rvtoGetRepScheduledBlocks_(email, repScheduledDays, schedIdx, ctx.timezone);

      // v1.9.6: personalFloor uses phone-only schedule for the same reason as headroom.
      var personalFloor = rvtoRepPersonalFloor_(email, phoneSchedIdx, queueSurplusIntervals);
      rvtoAudit_('WEEK_BLOCK_HEADROOM', qd.name,
        'Candidate ' + email + ' | personalFloor=+' +
        (isFinite(personalFloor) ? (Math.round(personalFloor * 10) / 10) : 'n/a'),
        'INFO');

      const offerId    = rvtoBuildId_(RVTO_APP.WEEK_BLOCK_PREFIX);
      const token      = rvtoCreateToken_(offerId, email);
      const acceptUrl  = webAppUrl
        ? (webAppUrl + '?offer_id=' + encodeURIComponent(offerId) + '&action=accept&token='  + encodeURIComponent(token) + '&offer_type=week_block')
        : '';
      const declineUrl = webAppUrl
        ? (webAppUrl + '?offer_id=' + encodeURIComponent(offerId) + '&action=decline&token=' + encodeURIComponent(token) + '&offer_type=week_block')
        : '';

      const sentAt    = new Date();
      const expiresAt = rvtoAddHours_(sentAt, holdHours);

      var didSend = false;

      if (!sendEmails) {
        rvtoAppendWeekBlockOfferRow_({
          offerId:         offerId,
          date:            dates.startDateStr + ' to ' + dates.endDateStr,
          name:            person.name,
          email:           email,
          agentId:         person.agentId || '',
          queue:           qd.name,
          manager:         person.manager || '',
          sentAt:          sentAt,
          expiresAt:       expiresAt,
          holdHours:       holdHours,
          status:          RVTO_APP.OFFER_STATUSES.PENDING_SEND,
          token:           token,
          acceptUrl:       acceptUrl,
          declineUrl:      declineUrl,
          scheduledDays:   repScheduledDays.join(','),
          scheduledBlocks: repScheduledBlocks.join('|')
        });
        SpreadsheetApp.flush();
        rvtoConsumeHeadroom_(email, phoneSchedIdx, headroomMap);
        weekBlockSentThisRun.add(email);
        sent++;
        return;
      }

      try {
        didSend = rvtoSendWeekBlockOfferEmail_({
          config:        config,
          offerId:       offerId,
          email:         email,
          name:          person.name,
          queue:         qd.name,
          startDateStr:  dates.startDateStr,
          endDateStr:    dates.endDateStr,
          scheduledDays: repScheduledDays,
          expiresAt:     expiresAt,
          acceptUrl:     acceptUrl,
          declineUrl:    declineUrl,
          timezone:      ctx.timezone
        });
      } catch (err) {
        rvtoAudit_('WEEK_BLOCK_SEND', offerId, 'Unhandled exception: ' + String(err), 'FAILED');
        didSend = false;
      }

      const finalStatus = didSend
        ? RVTO_APP.OFFER_STATUSES.SENT
        : RVTO_APP.OFFER_STATUSES.SEND_FAILED;

      rvtoAppendWeekBlockOfferRow_({
        offerId:         offerId,
        date:            dates.startDateStr + ' to ' + dates.endDateStr,
        name:            person.name,
        email:           email,
        agentId:         person.agentId || '',
        queue:           qd.name,
        manager:         person.manager || '',
        sentAt:          sentAt,
        expiresAt:       expiresAt,
        holdHours:       holdHours,
        status:          finalStatus,
        token:           token,
        acceptUrl:       acceptUrl,
        declineUrl:      declineUrl,
        scheduledDays:   repScheduledDays.join(','),
        scheduledBlocks: repScheduledBlocks.join('|')
      });
      SpreadsheetApp.flush();

      if (didSend) {
        rvtoConsumeHeadroom_(email, phoneSchedIdx, headroomMap);
        weekBlockSentThisRun.add(email);
        sent++;
      } else {
        failed++;
      }
    });

    var finalSummary = [];
    Object.keys(headroomMap).forEach(function(k) {
      var e = headroomMap[k];
      finalSummary.push(
        Utilities.formatDate(e.start, ctx.timezone, 'MM-dd HH:mm') + '=+' + (Math.round(e.net * 10) / 10)
      );
    });
    rvtoAudit_('WEEK_BLOCK_HEADROOM', qd.name,
      'Final headroom after offers: ' +
      finalSummary.slice(0, 20).join(' | ') +
      (finalSummary.length > 20 ? ' (+' + (finalSummary.length - 20) + ' more)' : ''),
      'INFO');
  });

  rvtoAudit_('WEEK_BLOCK_RUN', '',
    'Complete | Sent: ' + sent + ' | Failed: ' + failed + ' | Skipped: ' + skipped,
    'OK');

  return { sent: sent, failed: failed, skipped: skipped };
}

/**
 * Parses and validates WEEK_VTO_START_DATE and WEEK_VTO_END_DATE from config.
 * Returns { startDate, endDate, startDateStr, endDateStr, dateList } or null.
 * dateList is an array of 'yyyy-MM-dd' strings for each day in the range.
 */
function rvtoGetWeekBlockDates_(config, tz) {
  // Google Sheets auto-converts yyyy-MM-dd cells to Date objects on read.
  // Normalise both values to 'yyyy-MM-dd' strings before parsing.
  const startStr = rvtoWkNormDateStr_(config.WEEK_VTO_START_DATE, tz);
  const endStr   = rvtoWkNormDateStr_(config.WEEK_VTO_END_DATE,   tz);
  if (!startStr || !endStr) return null;

  const startDate = rvtoBuildDateTime_(startStr, '00:00', tz);
  const endDate   = rvtoBuildDateTime_(endStr,   '23:59', tz);
  if (!startDate || !endDate || endDate <= startDate) return null;

  const dateList = [];
  const cursor   = new Date(startDate);
  while (cursor <= endDate) {
    dateList.push(Utilities.formatDate(cursor, tz, 'yyyy-MM-dd'));
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    startDate:    startDate,
    endDate:      endDate,
    startDateStr: startStr,
    endDateStr:   endStr,
    dateList:     dateList
  };
}

/**
 * Normalises a Config cell value that may be a Date object (Sheets auto-converts
 * yyyy-MM-dd cells) or a plain string into a 'yyyy-MM-dd' string.
 * Returns '' if the value is missing or unparseable.
 */
function rvtoWkNormDateStr_(value, tz) {
  if (!value && value !== 0) return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, tz || 'America/Chicago', 'yyyy-MM-dd');
  }
  var s = String(value).trim();
  // Already in yyyy-MM-dd format
  if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return s;
  // Try parsing as a date string (handles any other Sheets date serialisation)
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, tz || 'America/Chicago', 'yyyy-MM-dd');
  }
  return '';
}

/**
 * v1.7.6: Polls surplus data for each enabled queue across the week-block date
 * range. Returns surplus intervals per queue per day so per-rep surplus % can
 * be calculated downstream.
 *
 * Return shape:
 *   {
 *     [queueName]: {
 *       [dateStr]: [ { start: Date, end: Date }, ... ]  // surplus intervals only
 *     }
 *   }
 *
 * A day with no surplus intervals is omitted from the inner map.
 * Callers use Object.keys(byQueue[q]) to get surplus days, and the interval
 * arrays to calculate per-rep overlap hours.
 */
function rvtoFindWeekBlockSurplusDays_(ctx, dates) {
  const apiKey     = rvtoGetApiKey_();
  const headers    = rvtoAuthHeaders_(apiKey);
  const config     = ctx.config;
  const rules        = ctx.rules;
  const tz           = ctx.timezone;
  const interval     = Number(config.INTERVAL_SECONDS || 1800);
  const channel      = config.ASSEMBLED_CHANNEL || 'phone';

  const sitesNeeded = {};
  ctx.enabledQueues.forEach(function(qd) { sitesNeeded[qd.site] = true; });
  const siteIds = {};
  Object.keys(sitesNeeded).forEach(function(siteKey) {
    const siteName = rvtoResolveSiteName_(config, siteKey);
    siteIds[siteKey] = rvtoResolveSiteId_(headers, siteName);
  });

  const queuesBySite = {};
  ctx.enabledQueues.forEach(function(qd) {
    if (!queuesBySite[qd.site]) queuesBySite[qd.site] = [];
    queuesBySite[qd.site].push(qd.name);
  });
  const queueMap = {};
  Object.keys(queuesBySite).forEach(function(siteKey) {
    const resolved = rvtoResolveQueueIds_(headers, queuesBySite[siteKey]);
    Object.keys(resolved).forEach(function(qName) { queueMap[qName] = resolved[qName]; });
  });

  const surplusIntervalsByQueue = {};

  ctx.enabledQueues.forEach(function(qd) {
    const queueName = qd.name;
    const queueId   = queueMap[queueName];
    const siteId    = siteIds[qd.site];
    const qMinSurplus = rvtoEffectiveMinSurplusForQueue_(queueName, rules);
    surplusIntervalsByQueue[queueName] = {};

    dates.dateList.forEach(function(dateStr) {
      const dayBegin = rvtoBuildDateTime_(dateStr, '00:00', tz);
      if (!dayBegin) return;
      const dayEnd = new Date(dayBegin.getTime() + 24 * 60 * 60 * 1000);

      const startSec = Math.floor(dayBegin.getTime() / 1000);
      const endSec   = Math.floor(dayEnd.getTime()   / 1000);

      const ASSEMBLED_PAGE_SIZE = 20;
      let offset       = 0;
      let keepPaging   = true;
      const dayIntervals = [];

      while (keepPaging) {
        var pageRes;
        try {
          pageRes = rvtoAssembledGet_(headers, '/forecasted_vs_actuals', {
            start_time: startSec,
            end_time:   endSec,
            interval:   interval,
            channel:    channel,
            site:       siteId,
            queue:      queueId,
            limit:      ASSEMBLED_PAGE_SIZE,
            offset:     offset
          });
          Utilities.sleep(300);
        } catch (err) {
          rvtoAudit_('WEEK_BLOCK_SURPLUS', queueName,
            'API error for ' + dateStr + ' (offset ' + offset + '): ' + err, 'FAILED');
          break;
        }

        const pageIntervals = pageRes.forecasts_vs_actuals || [];
        pageIntervals.forEach(function(it) {
          const scheduled = rvtoNum_(it.staffing_scheduled);
          const required  = rvtoNum_(it.staffing_required && it.staffing_required.forecasted);
          const netRaw    = rvtoIsNum_(it.staffing_net) ? Number(it.staffing_net) : (scheduled - required);
          const iStart    = new Date(it.start_time * 1000);
          const iEnd      = new Date(it.end_time   * 1000);
          const rampBoost = rvtoRampNetBoostPerQueue_(iStart, iEnd, ctx, ctx.enabledQueues.length);
          const net         = netRaw + rampBoost;
          if (net >= qMinSurplus && it.start_time && it.end_time) {
            dayIntervals.push({
              start: iStart,
              end:   iEnd,
              net:   net
            });
          }
        });

        if (pageIntervals.length < ASSEMBLED_PAGE_SIZE) keepPaging = false;
        else offset += ASSEMBLED_PAGE_SIZE;
      }

      if (dayIntervals.length) {
        surplusIntervalsByQueue[queueName][dateStr] = dayIntervals;
      }
    });

    const surplusDayCount = Object.keys(surplusIntervalsByQueue[queueName]).length;
    rvtoAudit_('WEEK_BLOCK_SURPLUS', queueName,
      'Surplus days: ' + surplusDayCount + '/' + dates.dateList.length, 'INFO');
  });

  return surplusIntervalsByQueue;
}

/**
 * v1.7.6: Eligibility for week-block offers. Same pipeline as rvtoFindEligible_ but:
 *  - Cap-exempt: does not check or update offersByEmail
 *  - 15% surplus gate: rep's scheduled hours overlapping surplus intervals must
 *    be >= WEEK_VTO_MIN_SURPLUS_PCT % of their total scheduled hours for the week
 *  - Sort: PGC primary (unknown first, then lowest), midday secondary
 *    (earlier avg shift end time first within same PGC tier)
 *
 * surplusIntervalsByQueue: { dateStr: [{start,end}, ...] } for this queue
 */

function rvtoRepPersonalFloor_(email, schedIdx, surplusIntervalsByQueue) {
  const blocks = schedIdx[email] || [];
  if (!blocks.length) return Infinity;

  var minNet = Infinity;
  Object.keys(surplusIntervalsByQueue).forEach(function(dateStr) {
    (surplusIntervalsByQueue[dateStr] || []).forEach(function(interval) {
      for (var bi = 0; bi < blocks.length; bi++) {
        var block = blocks[bi];
        var oStart = Math.max(block.start.getTime(), interval.start.getTime());
        var oEnd   = Math.min(block.end.getTime(),   interval.end.getTime());
        if (oEnd > oStart && interval.net < minNet) minNet = interval.net;
      }
    });
  });
  return minNet;
}

function rvtoBuildHeadroomMap_(surplusIntervalsByQueue, offerObjects, queueName, schedIdx) {
  const map = {};

  Object.keys(surplusIntervalsByQueue).forEach(function(dateStr) {
    (surplusIntervalsByQueue[dateStr] || []).forEach(function(interval) {
      const key = rvtoHeadroomMapKey_(interval.start, interval.end);
      if (!map[key]) {
        map[key] = { net: interval.net, start: interval.start, end: interval.end };
      }
    });
  });

  const ACTIVE_STATUSES = ['SENT', 'PENDING_SEND', 'ACCEPTED', 'COMMITTED'];

  (offerObjects || []).forEach(function(obj) {
    var offerQueue = String(obj['Queue'] || '').trim();
    var status     = String(obj['Status'] || '').trim().toUpperCase();
    var notes      = String(obj['Notes']  || '');
    if (offerQueue !== queueName) return;
    if (notes.indexOf('WEEK_VTO') === -1) return;
    if (ACTIVE_STATUSES.indexOf(status) === -1) return;

    var email = String(obj['Email'] || '').trim().toLowerCase();
    if (!email) return;

    var repBlocks = schedIdx[email] || [];
    Object.keys(map).forEach(function(key) {
      var entry = map[key];
      for (var i = 0; i < repBlocks.length; i++) {
        var block = repBlocks[i];
        var oStart = Math.max(block.start.getTime(), entry.start.getTime());
        var oEnd   = Math.min(block.end.getTime(),   entry.end.getTime());
        if (oEnd > oStart) entry.net -= 1;
      }
    });
  });

  return map;
}

function rvtoConsumeHeadroom_(email, schedIdx, headroomMap) {
  var blocks = schedIdx[email] || [];
  Object.keys(headroomMap).forEach(function(key) {
    var entry = headroomMap[key];
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var oStart = Math.max(block.start.getTime(), entry.start.getTime());
      var oEnd   = Math.min(block.end.getTime(),   entry.end.getTime());
      if (oEnd > oStart) entry.net -= 1;
    }
  });
}

/**
 * v1.9.6: schedIdx parameter is now expected to be a PHONE-ONLY index
 * (rvtoBuildPhoneSchedIdx_). Passing the full schedIdx will incorrectly
 * gate reps whose meal/break blocks overlap low-headroom intervals.
 *
 * v1.9.6: queueName is optional but enables a precise audit row showing
 * exactly which interval caused rejection — replaces the generic
 * "insufficient headroom" message that hid the root cause.
 *
 * v1.9.7: headroomFloor is now a separate parameter from minSurplus.
 *   - minSurplus is the SURPLUS DETECTION threshold (which intervals are in
 *     the headroom map at all). Used in the audit message for context only.
 *   - headroomFloor is the POST-VTO SAFETY floor. Defaults to 0 when not
 *     provided. The gate rejects only if approving the rep would push an
 *     interval below this floor.
 *   Old behaviour (`(net - 1) < minSurplus`) made it impossible to ever
 *   approve VTO that touched an interval at exactly the surplus threshold,
 *   because every +2 (or +3 for ELD) interval was an instant chokepoint.
 */
function rvtoRepCanFitInHeadroom_(email, schedIdx, headroomMap, minSurplus, queueName, headroomFloor) {
  var floor = (headroomFloor === undefined || headroomFloor === null || !isFinite(Number(headroomFloor)))
    ? 0
    : Number(headroomFloor);
  var blocks = schedIdx[email] || [];
  if (!blocks.length) {
    if (queueName) {
      rvtoAudit_('WEEK_BLOCK_HEADROOM', queueName,
        'Skipped ' + email + ' — no phone-coverage blocks scheduled (lunch/breaks only or no shift)',
        'INFO');
    }
    return false;
  }

  var hasOverlap = false;
  var keys = Object.keys(headroomMap);
  for (var ki = 0; ki < keys.length; ki++) {
    var entry = headroomMap[keys[ki]];
    for (var bi = 0; bi < blocks.length; bi++) {
      var block = blocks[bi];
      var oStart = Math.max(block.start.getTime(), entry.start.getTime());
      var oEnd   = Math.min(block.end.getTime(),   entry.end.getTime());
      if (oEnd > oStart) {
        hasOverlap = true;
        if ((entry.net - 1) < floor) {
          if (queueName) {
            var tz = (Session && Session.getScriptTimeZone && Session.getScriptTimeZone()) || 'America/Chicago';
            var when = Utilities.formatDate(entry.start, tz, 'MM-dd HH:mm');
            rvtoAudit_('WEEK_BLOCK_HEADROOM', queueName,
              'Skipped ' + email + ' — chokepoint at ' + when +
              ' (net=+' + (Math.round(entry.net * 10) / 10) +
              ', would drop to +' + (Math.round((entry.net - 1) * 10) / 10) +
              ', surplusFloor=' + minSurplus + ', headroomFloor=' + floor + ')',
              'INFO');
          }
          return false;
        }
      }
    }
  }
  if (!hasOverlap && queueName) {
    rvtoAudit_('WEEK_BLOCK_HEADROOM', queueName,
      'Skipped ' + email + ' — no phone-coverage overlap with any surplus interval',
      'INFO');
  }
  return hasOverlap;
}

function rvtoFindWeekBlockEligible_(syntheticDeficit, roster, schedIdx, ctx, dates, surplusIntervalsByQueue) {
  const rules           = ctx.rules;
  const minOverlapHours = Number(rules.MIN_SCHEDULE_OVERLAP_HOURS || 2);
  const noFlySet        = ctx.noFlySet;
  const shadowEmails    = ctx.shadowExclusionEmails || new Set();
  const tz              = ctx.timezone;
  const queueDef        = RVTO_APP.QUEUE_DEFS.filter(function(qd) { return qd.name === syntheticDeficit.queue; })[0];
  const workGroupPattern = queueDef ? queueDef.workGroupPattern : '';

  // Min surplus % threshold (default 15)
  const minSurplusPct = (function() {
    var raw = ctx.config && ctx.config.WEEK_VTO_MIN_SURPLUS_PCT;
    if (raw === undefined || raw === null || String(raw).trim() === '') return 15;
    var n = Number(raw);
    return isFinite(n) && n > 0 ? n : 15;
  }());

  // Flatten surplus intervals across all days for this queue
  const surplusDays = Object.keys(surplusIntervalsByQueue);

  const eligible = [];
  var debugCounts = {
    noEmail: 0, queueMismatch: 0, noFly: 0, shadowExcluded: 0,
    notScheduled: 0, belowSurplusPct: 0, passed: 0
  };

  roster.forEach(function(person) {
    const email = (person.email || '').trim().toLowerCase();
    if (!email) { debugCounts.noEmail++; return; }
    if (!rvtoWorkGroupMatches_(person.workGroup, workGroupPattern)) { debugCounts.queueMismatch++; return; }
    if (noFlySet.has(rvtoNormalizeName_(person.name))) { debugCounts.noFly++; return; }
    if (shadowEmails.has(email)) { debugCounts.shadowExcluded++; return; }

    // Must be scheduled on at least one surplus day
    const hasAnySurplusDay = surplusDays.some(function(dateStr) {
      const dayStart = rvtoBuildDateTime_(dateStr, '00:00', tz);
      const dayEnd   = rvtoBuildDateTime_(dateStr, '23:59', tz);
      if (!dayStart || !dayEnd) return false;
      return rvtoHasScheduleOverlap_(email, dayStart, dayEnd, schedIdx, minOverlapHours);
    });
    if (!hasAnySurplusDay) { debugCounts.notScheduled++; return; }

    // 15% surplus gate: surplus-overlapping hours / total scheduled hours
    const surplusPct = rvtoCalcRepSurplusPct_(email, schedIdx, surplusIntervalsByQueue, dates, tz);
    if (surplusPct < minSurplusPct) {
      debugCounts.belowSurplusPct++;
      return;
    }

    debugCounts.passed++;

    const agentId = (function() {
      const bl = schedIdx[email] || [];
      for (var i = 0; i < bl.length; i++) { if (bl[i].agentId) return bl[i].agentId; }
      return '';
    }());

    // Store surplusPct and avg shift end for sorting
    const avgEndMins = rvtoAvgShiftEndMinutes_(email, schedIdx, dates, tz);
    eligible.push(Object.assign({}, person, {
      agentId:     agentId,
      surplusPct:  surplusPct,
      avgEndMins:  avgEndMins
    }));
  });

  rvtoAudit_('WEEK_BLOCK_ELIGIBILITY', syntheticDeficit.queue,
    'Queue: ' + syntheticDeficit.queue +
    ' | Roster: ' + roster.length +
    ' | noEmail: ' + debugCounts.noEmail +
    ' | queueMismatch: ' + debugCounts.queueMismatch +
    ' | noFly: ' + debugCounts.noFly +
    ' | shadowExcluded: ' + debugCounts.shadowExcluded +
    ' | notScheduled: ' + debugCounts.notScheduled +
    ' | belowSurplusPct (<' + minSurplusPct + '%): ' + debugCounts.belowSurplusPct +
    ' | passed: ' + debugCounts.passed,
    debugCounts.passed > 0 ? 'OK' : 'WARN');

  // Sort: PGC primary, midday (earlier avg end time) secondary
  var usePgc = rvtoConfigBool_(ctx.config && ctx.config.USE_PGC_PRIORITY, true);
  var pgcMap = ctx.pgcByNormalizedName || {};
  if (usePgc && Object.keys(pgcMap).length) {
    eligible.sort(function(a, b) {
      var na = rvtoNormalizeName_(a.name);
      var nb = rvtoNormalizeName_(b.name);
      var ha = Object.prototype.hasOwnProperty.call(pgcMap, na) && pgcMap[na] !== null && pgcMap[na] !== undefined;
      var hb = Object.prototype.hasOwnProperty.call(pgcMap, nb) && pgcMap[nb] !== null && pgcMap[nb] !== undefined;
      // Unknown PGC first
      if (!ha && hb) return -1;
      if (ha && !hb) return 1;
      if (!ha && !hb) {
        // Both unknown: midday tiebreak (earlier end first)
        return (a.avgEndMins || 0) - (b.avgEndMins || 0);
      }
      var pa = Number(pgcMap[na]);
      var pb = Number(pgcMap[nb]);
      if (pa !== pb) return pa - pb;
      // Same PGC: midday tiebreak
      return (a.avgEndMins || 0) - (b.avgEndMins || 0);
    });
  } else {
    // PGC disabled: sort by midday only
    eligible.sort(function(a, b) {
      return (a.avgEndMins || 0) - (b.avgEndMins || 0);
    });
  }

  return eligible;
}

/**
 * Returns the subset of surplusDays on which a given rep is scheduled
 * (with at least MIN_SCHEDULE_OVERLAP_HOURS overlap).
 */
function rvtoGetRepScheduledDays_(email, surplusDays, schedIdx, tz) {
  return surplusDays.filter(function(dateStr) {
    const dayStart = rvtoBuildDateTime_(dateStr, '00:00', tz);
    const dayEnd   = rvtoBuildDateTime_(dateStr, '23:59', tz);
    if (!dayStart || !dayEnd) return false;
    return rvtoHasScheduleOverlap_(email, dayStart, dayEnd, schedIdx, 0);
  });
}

/**
 * v1.7.3: For each surplus day the rep is scheduled on, returns their actual
 * schedule blocks clipped to that day as "yyyy-MM-dd HH:mm-HH:mm" strings.
 * Multiple blocks per day (split shifts, etc.) each become their own entry.
 * Serialised into offer Notes at send time so rvtoCommitWeekBlockToAssembled_
 * can post precise per-block VTO activities instead of a generic daily range.
 */
function rvtoGetRepScheduledBlocks_(email, surplusDays, schedIdx, tz) {
  const blocks = schedIdx[email] || [];
  const result = [];

  surplusDays.forEach(function(dateStr) {
    const dayStart = rvtoBuildDateTime_(dateStr, '00:00', tz);
    const dayEnd   = rvtoBuildDateTime_(dateStr, '23:59', tz);
    if (!dayStart || !dayEnd) return;

    blocks.forEach(function(block) {
      const clippedStart = new Date(Math.max(block.start.getTime(), dayStart.getTime()));
      const clippedEnd   = new Date(Math.min(block.end.getTime(),   dayEnd.getTime()));
      if (clippedEnd <= clippedStart) return;

      const startStr = Utilities.formatDate(clippedStart, tz, 'HH:mm');
      const endStr   = Utilities.formatDate(clippedEnd,   tz, 'HH:mm');
      result.push(dateStr + ' ' + startStr + '-' + endStr);
    });
  });

  return result; // e.g. ["2026-06-02 09:00-17:00", "2026-06-03 09:00-17:00"]
}

/**
 * v1.7.6: Calculates what percentage of a rep's total scheduled hours for the
 * week fall within surplus intervals for their queue.
 *
 * surplusIntervalsByQueue: { dateStr: [{start,end}, ...] }
 * Returns a number 0-100. Returns 0 if the rep has no scheduled hours.
 */
function rvtoCalcRepSurplusPct_(email, schedIdx, surplusIntervalsByQueue, dates, tz) {
  const blocks = schedIdx[email] || [];
  if (!blocks.length) return 0;

  var totalScheduledMs  = 0;
  var surplusOverlapMs  = 0;

  dates.dateList.forEach(function(dateStr) {
    const dayStart = rvtoBuildDateTime_(dateStr, '00:00', tz);
    const dayEnd   = rvtoBuildDateTime_(dateStr, '23:59', tz);
    if (!dayStart || !dayEnd) return;

    const surplusIntervals = surplusIntervalsByQueue[dateStr] || [];

    blocks.forEach(function(block) {
      // Clip block to this day
      const bStart = new Date(Math.max(block.start.getTime(), dayStart.getTime()));
      const bEnd   = new Date(Math.min(block.end.getTime(),   dayEnd.getTime()));
      if (bEnd <= bStart) return;

      totalScheduledMs += (bEnd.getTime() - bStart.getTime());

      // Intersect this block with each surplus interval
      surplusIntervals.forEach(function(si) {
        const oStart = new Date(Math.max(bStart.getTime(), si.start.getTime()));
        const oEnd   = new Date(Math.min(bEnd.getTime(),   si.end.getTime()));
        if (oEnd > oStart) surplusOverlapMs += (oEnd.getTime() - oStart.getTime());
      });
    });
  });

  if (totalScheduledMs === 0) return 0;
  return (surplusOverlapMs / totalScheduledMs) * 100;
}

/**
 * v1.7.6: Returns the average shift end time in minutes-since-midnight across
 * all scheduled days in the date range. Used as the midday sort tiebreaker —
 * lower value means the rep's shifts end earlier (less evening exposure).
 * Returns 1440 (end of day) if no schedule found, sorting unknown-schedule
 * reps last within their PGC tier.
 */
function rvtoAvgShiftEndMinutes_(email, schedIdx, dates, tz) {
  const blocks = schedIdx[email] || [];
  if (!blocks.length) return 1440;

  var totalEndMins = 0;
  var count        = 0;

  dates.dateList.forEach(function(dateStr) {
    const dayStart = rvtoBuildDateTime_(dateStr, '00:00', tz);
    const dayEnd   = rvtoBuildDateTime_(dateStr, '23:59', tz);
    if (!dayStart || !dayEnd) return;

    var latestEnd = null;
    blocks.forEach(function(block) {
      const bStart = new Date(Math.max(block.start.getTime(), dayStart.getTime()));
      const bEnd   = new Date(Math.min(block.end.getTime(),   dayEnd.getTime()));
      if (bEnd <= bStart) return;
      if (!latestEnd || bEnd > latestEnd) latestEnd = bEnd;
    });

    if (latestEnd) {
      // Convert to minutes since midnight in the rep's timezone
      const endStr = Utilities.formatDate(latestEnd, tz, 'HH:mm');
      const parts  = endStr.split(':');
      totalEndMins += (parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10));
      count++;
    }
  });

  return count > 0 ? totalEndMins / count : 1440;
}

/**
 * Sends the week-block offer email. Single email, lists all scheduled days,
 * one Accept link and one Decline link for the full block.
 */
function rvtoSendWeekBlockOfferEmail_(opts) {
  const config   = opts.config;
  const tz       = opts.timezone || config.TIMEZONE || 'America/Chicago';
  const fromName = config.EMAIL_FROM_NAME || 'Scheduling Bot';
  const startDisplay = rvtoFormatDateDisplay_(opts.startDateStr, tz);
  const endDisplay   = rvtoFormatDateDisplay_(opts.endDateStr,   tz);
  // v1.7.7: include date range in subject for inbox preview
  const subject  = (config.EMAIL_SUBJECT_PREFIX || 'VTO Opportunity') + ' — ' + startDisplay + ' – ' + endDisplay;
  const expiresStr   = Utilities.formatDate(opts.expiresAt, tz, "EEE, MMM d 'at' h:mm a") + ' CT';

  // Format scheduled days as a readable list
  const dayLines = opts.scheduledDays.map(function(dateStr) {
    return '<li>' + rvtoFormatDateDisplay_(dateStr, tz) + '</li>';
  }).join('');

  const html = [
    "<div style='font-family:Arial,sans-serif;font-size:14px;line-height:1.5;'>",
    "<p>Hi " + rvtoEscHtml_(opts.name || 'there') + ",</p>",
    "<p>You have a <strong>full week voluntary time off</strong> opportunity available.</p>",
    "<p><strong>Date Range:</strong> " + rvtoEscHtml_(startDisplay) + " &ndash; " + rvtoEscHtml_(endDisplay) + "<br>",
    "<strong>Queue:</strong> " + rvtoEscHtml_(opts.queue) + "</p>",
    "<p><strong>Your scheduled days included in this offer:</strong></p>",
    "<ul>" + dayLines + "</ul>",
    "<p>Accepting this offer covers <em>all</em> of the days listed above. You are accepting or declining the full week as a single block.</p>",
    "<p>Please respond before this offer expires.<br>",
    "<strong>Offer expires:</strong> " + rvtoEscHtml_(expiresStr) + "</p>",
    opts.acceptUrl  ? "<p><a href='" + rvtoEscHtml_(opts.acceptUrl)  + "' style='font-size:16px;font-weight:bold;'>✅ Accept Full Week VTO</a></p>" : '',
    opts.declineUrl ? "<p><a href='" + rvtoEscHtml_(opts.declineUrl) + "'>No thanks - Decline</a></p>" : '',
    "<p>Thank you,</p><p>" + rvtoEscHtml_(fromName) + "</p></div>"
  ].join('');

  try {
    GmailApp.sendEmail(opts.email, subject, rvtoHtmlToPlain_(html), { name: fromName, htmlBody: html });
    rvtoAudit_('WEEK_BLOCK_SEND', opts.offerId, 'Sent to ' + opts.email, 'OK');
    return true;
  } catch (err) {
    rvtoAudit_('WEEK_BLOCK_SEND', opts.offerId, String(err), 'FAILED');
    return false;
  }
}

/**
 * Appends a week-block offer row to the Offers sheet.
 * Date column holds the range string. Notes column is tagged WEEK_VTO.
 * scheduledDays stored in Notes alongside the tag.
 */
function rvtoAppendWeekBlockOfferRow_(o) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return;
  // v1.7.3: Notes stores both the day list (for summary script) and the
  // per-block schedule (for precise Assembled commits).
  // Format: WEEK_VTO | Days: yyyy-MM-dd,... | Blocks: yyyy-MM-dd HH:mm-HH:mm|...
  var notes = 'WEEK_VTO | Days: ' + (o.scheduledDays || '');
  if (o.scheduledBlocks) notes += ' | Blocks: ' + o.scheduledBlocks;
  sheet.appendRow([
    o.offerId, '',
    String(o.date), '', '',
    o.name, o.email, o.agentId, o.queue, o.manager,
    o.sentAt, o.expiresAt, o.holdHours, o.status,
    '', '', o.token, o.acceptUrl, o.declineUrl,
    '', '', '', notes
  ]);
}

/**
 * Commits a week-block acceptance to Assembled.
 * Creates one VTO activity per scheduled day in the offer.
 */
function rvtoCommitWeekBlockToAssembled_(offerId, obj, config) {
  const email = String(obj['Email'] || '').trim().toLowerCase();
  const tz    = config.TIMEZONE || 'America/Chicago';

  // Extract scheduled days from Notes: "WEEK_VTO | Days: 2026-05-05,2026-05-06,..."
  const notes = String(obj['Notes'] || '');
  const daysMatch = notes.match(/Days:\s*([^\s|]+)/);
  if (!daysMatch) {
    rvtoAudit_('WEEK_BLOCK_COMMIT', offerId, 'Cannot parse scheduled days from Notes: ' + notes, 'FAILED');
    rvtoUpdateOfferField_(offerId, 'Status', RVTO_APP.OFFER_STATUSES.COMMIT_FAILED);
    rvtoUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
    return { ok: false };
  }
  const scheduledDays = daysMatch[1].split(',').map(function(d) { return d.trim(); }).filter(Boolean);

  var agentId = String(obj['Agent ID'] || '').trim();
  if (!agentId) {
    rvtoAudit_('WEEK_BLOCK_COMMIT', offerId, 'agentId blank — falling back to /people lookup for ' + email, 'INFO');
    agentId = rvtoResolveAgentId_(email);
    if (!agentId) {
      rvtoUpdateOfferField_(offerId, 'Status', RVTO_APP.OFFER_STATUSES.COMMIT_FAILED);
      rvtoUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
      rvtoUpdateOfferField_(offerId, 'Notes', notes + ' | COMMIT_FAILED: agent ID not found');
      rvtoAudit_('WEEK_BLOCK_COMMIT', offerId, 'No agent UUID found for ' + email, 'FAILED');
      return { ok: false };
    }
    rvtoUpdateOfferField_(offerId, 'Agent ID', agentId);
  }

  const activityTypeId = rvtoResolveVtoTypeId_(config);
  if (!activityTypeId) {
    rvtoUpdateOfferField_(offerId, 'Status', RVTO_APP.OFFER_STATUSES.COMMIT_FAILED);
    rvtoUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
    rvtoAudit_('WEEK_BLOCK_COMMIT', offerId, 'Missing VTO activity type ID', 'FAILED');
    return { ok: false };
  }

  // v1.7.3: Parse per-block schedule windows from Notes.
  // Format: "... | Blocks: 2026-06-02 09:00-17:00|2026-06-03 09:00-17:00|..."
  // Each block becomes one VTO activity aligned to the rep's actual working window.
  // Falls back to one activity per day (08:00-17:00) only if Blocks not present
  // (e.g. offer was created before v1.7.3).
  var scheduleBlocks = [];
  const blocksMatch = notes.match(/Blocks:\s*([^]+?)(?:\s*\|\s*Committed|$)/);
  if (blocksMatch) {
    scheduleBlocks = blocksMatch[1].split('|')
      .map(function(b) { return b.trim(); })
      .filter(function(b) { return b.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}-\d{2}:\d{2}$/); });
  }

  if (!scheduleBlocks.length) {
    rvtoAudit_('WEEK_BLOCK_COMMIT', offerId,
      'No Blocks data in Notes — falling back to daily 08:00-17:00 for ' + scheduledDays.length + ' day(s)', 'WARN');
    scheduleBlocks = scheduledDays.map(function(d) { return d + ' 08:00-17:00'; });
  }

  const apiKey      = rvtoGetApiKey_();
  const authHdrs    = rvtoAuthHeaders_(apiKey);
  const activityIds = [];
  let allOk = true;

  scheduleBlocks.forEach(function(blockStr) {
    // blockStr format: "yyyy-MM-dd HH:mm-HH:mm"
    const spaceIdx  = blockStr.indexOf(' ');
    if (spaceIdx === -1) return;
    const dateStr   = blockStr.substring(0, spaceIdx).trim();
    const timeStr   = blockStr.substring(spaceIdx + 1).trim();
    const dashIdx   = timeStr.indexOf('-');
    if (dashIdx === -1) return;
    const startHHMM = timeStr.substring(0, dashIdx).trim();
    const endHHMM   = timeStr.substring(dashIdx + 1).trim();

    const startTime = rvtoBuildDateTime_(dateStr, startHHMM, tz);
    const endTime   = rvtoBuildDateTime_(dateStr, endHHMM,   tz);
    if (!startTime || !endTime || endTime <= startTime) {
      rvtoAudit_('WEEK_BLOCK_COMMIT', offerId, 'Skipped invalid block: ' + blockStr, 'WARN');
      return;
    }

    const payload = {
      agent_id:   agentId,
      type_id:    activityTypeId,
      start_time: Math.floor(startTime.getTime() / 1000),
      end_time:   Math.floor(endTime.getTime()   / 1000)
    };

    try {
      const resp      = rvtoAssembledPost_(authHdrs, '/activities', payload);
      const requestId = String(resp.id || (resp.activity && resp.activity.id) || '').trim();
      activityIds.push(requestId);
      rvtoAudit_('WEEK_BLOCK_COMMIT', offerId,
        'Committed ' + blockStr + ' | Activity ID: ' + requestId, 'OK');
    } catch (err) {
      rvtoAudit_('WEEK_BLOCK_COMMIT', offerId,
        'POST failed for ' + blockStr + ': ' + String(err), 'FAILED');
      allOk = false;
    }
  });

  if (allOk && activityIds.length) {
    rvtoUpdateOfferField_(offerId, 'Status',               RVTO_APP.OFFER_STATUSES.COMMITTED);
    rvtoUpdateOfferField_(offerId, 'Assembled Status',     'COMMITTED');
    rvtoUpdateOfferField_(offerId, 'Assembled Request ID', activityIds.join(','));
    rvtoUpdateOfferField_(offerId, 'Notes',                notes + ' | Committed. Activity IDs: ' + activityIds.join(','));

    // v1.7.9: Notify manager via Slack DM
    const dateRangeParts = String(obj['Date'] || '').split(' to ');
    const wkStartDisp    = dateRangeParts.length === 2
      ? rvtoFormatDateDisplay_(dateRangeParts[0].trim(), tz)
      : String(obj['Date'] || '');
    const wkEndDisp      = dateRangeParts.length === 2
      ? rvtoFormatDateDisplay_(dateRangeParts[1].trim(), tz)
      : '';
    const wkDmMsg = '\u2705 VTO Committed \u2014 ' + email +
      ', full week ' + wkStartDisp + (wkEndDisp ? ' \u2013 ' + wkEndDisp : '');
    rvtoNotifyManagerOnCommit_(email, email, wkDmMsg, config);

    return { ok: true };
  } else {
    rvtoUpdateOfferField_(offerId, 'Status',           RVTO_APP.OFFER_STATUSES.COMMIT_FAILED);
    rvtoUpdateOfferField_(offerId, 'Assembled Status', 'PARTIAL_FAILED');
    rvtoUpdateOfferField_(offerId, 'Notes',            notes + ' | Partial commit. IDs: ' + activityIds.join(','));
    return { ok: false };
  }
}

/**
 * Handles doGet responses for week-block offers.
 * Mirrors rvtoProcessResponse_ but delegates to rvtoCommitWeekBlockToAssembled_.
 */
function rvtoProcessWeekBlockResponse_(offerId, action, token) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return { ok: false, message: 'Offer system unavailable.' };

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { ok: false, message: 'No offers found.' };

  const headers = values[0];
  const now     = new Date();
  const config  = rvtoGetConfig_();

  for (var i = 1; i < values.length; i++) {
    const obj = rvtoRowToObj_(headers, values[i]);
    if (String(obj['Offer ID'] || '').trim() !== offerId) continue;
    if (String(obj['Token']    || '').trim() !== token)   return { ok: false, message: 'Invalid token.' };

    const status = String(obj['Status'] || '').trim().toUpperCase();

    if ([RVTO_APP.OFFER_STATUSES.DECLINED, RVTO_APP.OFFER_STATUSES.EXPIRED].indexOf(status) !== -1) {
      return { ok: false, message: 'This offer is no longer active.' };
    }
    if (status === RVTO_APP.OFFER_STATUSES.COMMITTED) {
      return { ok: true, message: 'You have already accepted this offer — it has been recorded.' };
    }

    const sentAt       = obj['Sent At']    ? new Date(obj['Sent At'])    : null;
    const expiresAtRaw = obj['Expires At'] ? new Date(obj['Expires At']) : null;
    const holdHours    = Number(obj['Hold Hours'] || 1);
    const effectiveExpiry = (expiresAtRaw && !isNaN(expiresAtRaw.getTime()))
      ? expiresAtRaw : (sentAt ? rvtoAddHours_(sentAt, holdHours) : null);

    if (effectiveExpiry && now >= effectiveExpiry) {
      rvtoUpdateOfferField_(offerId, 'Status',          RVTO_APP.OFFER_STATUSES.EXPIRED);
      rvtoUpdateOfferField_(offerId, 'Response Time',   now);
      rvtoUpdateOfferField_(offerId, 'Response Action', 'expired_before_response');
      return { ok: false, message: 'This offer has expired.' };
    }

    if (action === 'accept') {
      if (status !== RVTO_APP.OFFER_STATUSES.ACCEPTED) {
        rvtoUpdateOfferField_(offerId, 'Status',          RVTO_APP.OFFER_STATUSES.ACCEPTED);
        rvtoUpdateOfferField_(offerId, 'Response Time',   now);
        rvtoUpdateOfferField_(offerId, 'Response Action', 'accept');
        rvtoAudit_('WEEK_BLOCK_ACCEPTED', offerId, 'Accepted by ' + obj['Email'], 'OK');
      }

      const commitEnabled = rvtoConfigBool_(config.ASSEMBLED_COMMIT, true);
      if (commitEnabled) {
        var commitResult;
        try {
          commitResult = rvtoCommitWeekBlockToAssembled_(offerId, obj, config);
        } catch (err) {
          rvtoAudit_('WEEK_BLOCK_COMMIT', offerId, 'Unhandled exception: ' + String(err), 'FAILED');
          return { ok: false, message: 'Your acceptance was recorded but could not be written to Assembled.' };
        }
        return commitResult.ok
          ? { ok: true,  message: 'Thanks! Your full week VTO has been accepted and recorded in the schedule.' }
          : { ok: false, message: 'Your acceptance was recorded but could not be fully written to Assembled. Scheduling will follow up.' };
      }
      return { ok: true, message: 'Thanks! Your full week VTO has been recorded.' };
    }

    if (action === 'decline') {
      rvtoUpdateOfferField_(offerId, 'Status',          RVTO_APP.OFFER_STATUSES.DECLINED);
      rvtoUpdateOfferField_(offerId, 'Response Time',   now);
      rvtoUpdateOfferField_(offerId, 'Response Action', 'decline');
      rvtoAudit_('WEEK_BLOCK_DECLINED', offerId, 'Declined by ' + obj['Email'], 'OK');
      return { ok: true, message: 'Got it — you have declined this offer.' };
    }

    return { ok: false, message: 'Invalid action.' };
  }
  return { ok: false, message: 'Offer not found.' };
}

/*************************************************************
 * QUEUE TOGGLE HELPERS
 *************************************************************/
function rvtoGetEnabledQueues_(config) {
  return RVTO_APP.QUEUE_DEFS.filter(function(qd) {
    const cfgKey = 'QUEUE_ENABLED_' + qd.key;
    const val    = config[cfgKey];
    if (val === undefined || val === null || String(val).trim() === '') return true;
    return String(val).trim().toUpperCase() === 'TRUE';
  });
}

/*************************************************************
 * CLEANUP LEGACY TABS
 *************************************************************/
function cleanupLegacyTabs() {
  const ss = SpreadsheetApp.getActive();
  const LEGACY_TABS = [
    'Capacity Raw', 'Schedule Raw', 'Opportunities', 'Candidate Matches',
    'Offers Log', 'Fulfillment Log', 'Audit Log', 'No Fly',
    'Assembled_Net_Raw', 'Assembled_Net_Agg', 'Assembled_Activities_14d'
  ];

  const surviving = ss.getSheets().filter(function(s) {
    return LEGACY_TABS.indexOf(s.getName()) === -1;
  });

  let tempSheet = null;
  if (!surviving.length) tempSheet = ss.insertSheet('_temp_');

  const deleted = [];
  const missing = [];

  LEGACY_TABS.forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (sheet) { ss.deleteSheet(sheet); deleted.push(name); }
    else        { missing.push(name); }
  });

  if (tempSheet) ss.deleteSheet(tempSheet);

  SpreadsheetApp.getUi().alert([
    'Legacy tab cleanup complete.',
    'Deleted (' + deleted.length + '): ' + (deleted.join(', ') || 'none'),
    'Not found (' + missing.length + '): ' + (missing.join(', ') || 'none'),
    'Run Setup Workbook next.'
  ].join('\n'));
}

/*************************************************************
 * SETUP
 *************************************************************/
function setupRvtoWorkbook() {
  const configSheet          = rvtoGetOrCreate_(RVTO_APP.SHEETS.CONFIG);
  const rosterSheet          = rvtoGetOrCreate_(RVTO_APP.SHEETS.ROSTER);
  const noFlySheet           = rvtoGetOrCreate_(RVTO_APP.SHEETS.NO_FLY);
  const shadowExclusionSheet = rvtoGetOrCreate_(RVTO_APP.SHEETS.SHADOW_EXCLUSION);
  const rampInclusionSheet   = rvtoGetOrCreate_(RVTO_APP.SHEETS.RAMP_INCLUSION);
  const offersSheet          = rvtoGetOrCreate_(RVTO_APP.SHEETS.OFFERS);
  const auditSheet           = rvtoGetOrCreate_(RVTO_APP.SHEETS.AUDIT);
  const changelogSheet       = rvtoGetOrCreate_(RVTO_APP.SHEETS.CHANGELOG);

  const queueToggleRows = RVTO_APP.QUEUE_DEFS.map(function(qd) {
    return ['QUEUE_ENABLED_' + qd.key, 'TRUE', 'Enable/disable queue: ' + qd.name + ' (' + qd.site + ')'];
  });

  const queueMinSurplusRows = RVTO_APP.QUEUE_DEFS.map(function(qd) {
    return ['MIN_SURPLUS_' + qd.key, '', 'Optional: min interpreted net for ' + qd.name + '; blank uses MIN_SURPLUS'];
  });

  // v1.9.7: Optional per-queue HEADROOM_FLOOR override (post-VTO safety floor)
  const queueHeadroomFloorRows = RVTO_APP.QUEUE_DEFS.map(function(qd) {
    return ['HEADROOM_FLOOR_' + qd.key, '', 'Optional: post-VTO safety floor for ' + qd.name + '; blank uses HEADROOM_FLOOR'];
  });

  rvtoSetSheetData_(configSheet,
    ['Key', 'Value', 'Notes'],
    [
      ['TIMEZONE',                      'America/Chicago', 'Timezone for date/time formatting'],
      ['INTERVAL_SECONDS',              1800,              '30-min staffing intervals'],
      ['LOOKAHEAD_DAYS',                3,                 'How many days ahead to look for surpluses'],
      ['SCHEDULE_PULL_HOURS',           78,                'Hours of schedule data to pull (lookahead + buffer)'],
      ['PAGE_LIMIT',                    500,               'Assembled API page size'],
      ['VTO_ACTIVITY_NAME',             'VTO',             'Assembled activity type name for VTO (fallback if UUID not set)'],
      ['EMAIL_SUBJECT_PREFIX',          'VTO Opportunity', 'Subject line prefix for offer emails'],
      ['EMAIL_FROM_NAME',               'Scheduling Bot',  'Display name for outbound emails'],
      ['SEND_EMAILS',                   'TRUE',            'Set FALSE to create offers without emailing'],
      ['ASSEMBLED_COMMIT',              'TRUE',            'Write accepted offers back to Assembled'],
      ['MIN_SURPLUS',                   1,                 'SURPLUS DETECTION threshold — interpreted net (Assembled net + ramp) must be >= this for an interval to enter the headroom map. Optional per-queue MIN_SURPLUS_<QUEUE_KEY> rows below match QUEUE_ENABLED_* suffix.'],
      ['HEADROOM_FLOOR',                0,                 'POST-VTO SAFETY floor — net staffing must stay >= this value at every interval the offered rep overlaps. Independent of MIN_SURPLUS. Lower = more offers approved. Default 0 lets a surplus interval drain to zero before the bot stops offering. Per-queue override: HEADROOM_FLOOR_<QUEUE_KEY>.'],
      ['MIN_BLOCK_MINUTES',             120,               'Minimum surplus block length in minutes to trigger an offer'],
      ['OFFER_HOLD_HOURS',              1,                 'How long an offer stays open before expiring'],
      ['MAX_OFFERS_PER_PERSON_PER_DAY', 1,                 'Max offers per rep per calendar day'],
      ['MAX_EMAILS_PER_24H',            1,                 'Max emails per rep in a rolling 24-hour window'],
      ['OFFER_MIN_GAP_HOURS',           1,                 'Minimum hours between offers to the same rep (rolling window). Prevents back-to-back trigger runs sending overlapping offers regardless of MAX_EMAILS_PER_24H.'],
      ['MIN_SCHEDULE_OVERLAP_HOURS',    2,                 'Min hours a rep must overlap the surplus window to be eligible'],
      ['ASSEMBLED_SITE',                'Consumer Sales',  'Assembled site name for Consumer Sales queues'],
      ['ASSEMBLED_SITE_SUPPORT',        'Support',         'Assembled site name for Support queues'],
      ['ASSEMBLED_CHANNEL',             'phone',           'Assembled channel (applies to all sites)'],
      ['USE_PGC_PRIORITY',              'TRUE',            'Sort eligible reps: no PGC row first, then lowest PGC (Script Properties: PGC_SPREADSHEET_ID)'],
      ['PGC_DEBUG_TOP_N',               8,                 'PGC_ORDER audit: how many top sorted eligibles to log (0 = off)'],
      ['WEEK_VTO_MIN_SURPLUS_PCT',    15,                'Min % of a rep\'s scheduled hours that must fall in surplus windows to qualify for a week-block offer (default 15)'],
      ['MANAGER_VTO_SLACK', 'TRUE', 'Set FALSE to disable Slack DM to manager on VTO commit (requires SLACK_BOT_TOKEN in Script Properties)'],
      // v1.7.2 Standard VTO toggle
      ['STANDARD_VTO_ENABLED',          'TRUE',            'Set FALSE to disable the standard intraday VTO trigger (runReverseVto). Week-block VTO runs independently.'],
      // v1.7.0 Week-Block VTO config rows
      ['WEEK_VTO_ENABLED',              'FALSE',           'Set TRUE to enable week-block VTO offers (run manually via menu)'],
      ['WEEK_VTO_START_DATE',           '',                'Week-block VTO start date (yyyy-MM-dd), e.g. 2026-05-05'],
      ['WEEK_VTO_END_DATE',             '',                'Week-block VTO end date (yyyy-MM-dd), e.g. 2026-05-09'],
    ].concat(queueToggleRows).concat(queueMinSurplusRows).concat(queueHeadroomFloorRows)
  );

  rvtoPreserveSheet_(rosterSheet,
    ['Name', 'Email', 'Work Group', 'Manager', 'Sub Group', 'Functional Group', 'Senior']);

  rvtoPreserveSheet_(noFlySheet, ['Name']);

  rvtoPreserveSheet_(shadowExclusionSheet,
    ['Name', 'Email', 'Notes']);

  rvtoPreserveSheet_(rampInclusionSheet, [
    'Notes', 'Active', 'Headcount', 'Start_Date', 'End_Date',
    'Shift_Start', 'Shift_End', 'Weekdays'
  ]);

  // v1.7.9: Manager_Aliases tab — Name | Slack Alias | Notes
  const managerAliasSheet = rvtoGetOrCreate_(RVTO_APP.SHEETS.MANAGER_ALIASES);
  rvtoPreserveSheet_(managerAliasSheet, ['Name', 'Slack Alias', 'Notes']);
  rvtoPopulateManagerAliasesFromRoster_(managerAliasSheet);

  rvtoPreserveSheet_(offersSheet,
    ['Offer ID', 'Deficit ID', 'Date', 'Start', 'End',
     'Name', 'Email', 'Agent ID', 'Queue', 'Manager',
     'Sent At', 'Expires At', 'Hold Hours', 'Status',
     'Response Time', 'Response Action',
     'Token', 'Accept URL', 'Decline URL',
     'Assembled Request ID', 'Assembled Status', 'Assembled Response', 'Notes']);

  rvtoPreserveSheet_(auditSheet,
    ['Timestamp', 'Event', 'Reference ID', 'Details', 'Result']);

  rvtoSetupChangelog_(changelogSheet);
  rvtoFormatSheets_();
  rvtoAudit_('SETUP', '', 'Workbook setup complete (v1.9.7)', 'OK');

  SpreadsheetApp.getUi().alert([
    'Targeted VTO Bot v1.9.7 workbook setup complete.',
    '',
    'Next steps:',
    '1. Set Script Properties: ASSEMBLED_API_KEY, RVTO_WEB_APP_URL, ASSEMBLED_VTO_ACTIVITY_ID',
    '   Optional: PGC_SPREADSHEET_ID (+ PGC_SHEET_NAME) for PGC-based offer ordering',
    '2. Populate the Roster sheet',
    '3. Deploy as web app (execute as: me, anyone can access)',
    '4. Set a time-based trigger on runReverseVto()',
    '',
    'v1.9.7: HEADROOM_FLOOR (default 0) split out from MIN_SURPLUS so',
    '  week-block offers can actually drain a surplus interval. Existing',
    '  deployments will see the new row added with default 0 — week-block',
    '  runs will immediately approve more offers per chokepoint.',
    '  Per-queue override: HEADROOM_FLOOR_<QUEUE_KEY>.',
  ].join('\n'));
}

/*************************************************************
 * CHANGELOG SETUP
 *************************************************************/
function rvtoSetupChangelog_(sheet) {
  const headers = ['Version', 'Date', 'Author', 'Change Summary', 'Impact', 'Status'];

  const history = [
    ['v1.9.7', '2026-05-07', 'Bobby Sorrell',
     'FIX: Week-block headroom gate was conflating MIN_SURPLUS (surplus DETECTION threshold) with the post-VTO safety floor. The check `(entry.net - 1) < minSurplus` made it impossible to ever offer VTO that touched an interval at exactly the surplus threshold — every +2 (or +3 for ELD) interval was an instant chokepoint. With dozens of +2/+2.x dips in a typical week, virtually no rep could pass even when the bulk of the week had +5 to +16 net headroom. Symptom: 84 candidates passed eligibility, only 1 offer sent for 5/24-5/30. Added new HEADROOM_FLOOR config (default 0) controlling only the post-VTO safety floor, with optional HEADROOM_FLOOR_<QUEUE_KEY> per-queue overrides matching the MIN_SURPLUS pattern. New helper rvtoEffectiveHeadroomFloorForQueue_(). rvtoRepCanFitInHeadroom_ now takes headroomFloor as a parameter and uses it in the comparison; audit row format updated to log surplusFloor + headroomFloor side by side. WEEK_BLOCK_HEADROOM "Initial headroom" log now includes both numbers.',
     'Week-block runs immediately approve far more offers per chokepoint. With HEADROOM_FLOOR=0 a +2 surplus interval can absorb 2 reps (drains to +1, then 0, then blocks the 3rd); a +5 interval can absorb 5. Standard intraday runReverseVto() unaffected — uses its own surplus block detection, not the headroom map.',
     'Released'],
    ['v1.9.6', '2026-05-06', 'Bobby Sorrell',
     'FIX: Week-block headroom math was double-counting reps\' meal/break/lunch blocks against low-headroom intervals, causing mass false-negative "insufficient headroom" rejections. Built dedicated phone-only schedule index (rvtoBuildPhoneSchedIdx_) sourced from a phone/chat/sms subset of the activity pull. Headroom map, rvtoRepCanFitInHeadroom_, rvtoConsumeHeadroom_, and rvtoRepPersonalFloor_ now use the phone-only index. Full schedIdx remains for eligibility/overlap checks where lunch/break correctly count as "scheduled". Audit upgrade: WEEK_BLOCK_HEADROOM rejections now log the exact chokepoint interval (timestamp, current net, projected post-VTO net, floor) instead of generic "insufficient headroom" message.',
     'High School week-block run rejected all 28 eligible reps despite Assembled showing surpluses of +5 to +14 across most intervals; lunch blocks were intersecting +1/+1.5 morning intervals and triggering the (net - 1) < minSurplus gate. Fix correctly attributes coverage contribution to phone-time only; expected to dramatically increase week-block offer volume across all queues. Standard intraday runReverseVto() unaffected — uses its own surplus block detection, not headroom map.',
     'Released'],
    ['v1.9.5', '2026-04-30', 'Bobby Sorrell',
     'NEW: Optional per-queue MIN_SURPLUS_<QUEUE_KEY> (same suffix as QUEUE_ENABLED_*). Blank falls back to MIN_SURPLUS. Applies to intraday merge + SURPLUS_BLOCK audit + week-block surplus/headroom.',
     'Tighter surplus gate for specific audiences (e.g. ELD) without raising the threshold for every queue.',
     'Released'],
    ['v1.9.4', '2026-04-30', 'Bobby Sorrell',
     'NEW: SURPLUS_BLOCK audit rows after merge/filter — each intraday surplus window logs RVTO_DEF id, interpreted vs raw Assembled net, ramp boost, scheduled/required forecast, site aggregate net (ISC_New excluded), interval merge count, headsNeeded. Links offers to bot staffing inputs.',
     'Operators can reconcile VTO offers with charts and Ramp_Inclusion without guessing ramp or aggregate gating.',
     'Released'],
    ['v1.9.3', '2026-04-30', 'Bobby Sorrell',
     'FIX: Ramp_Inclusion — v1.9.2 applied ramp overlap as a subtraction from net (fewer VTO offers). Correct behavior is addition: new hires add effective staffing not yet in Assembled, so interpreted net is boosted by (overlap head-fraction / N enabled queues) in rvtoFindDeficits_ and rvtoFindWeekBlockSurplusDays_. Renamed helper to rvtoRampNetBoostPerQueue_.',
     'More surplus / headroom during ramp windows → aligns with ops expectation that extra cover supports more VTO approvals while Assembled still lags real schedules.',
     'Released'],
    ['v1.9.2', '2026-04-30', 'Bobby Sorrell',
     'NEW: Ramp_Inclusion tab — model new-hire capacity before it appears in Assembled. Rows: Active, Headcount, Start_Date, End_Date (optional), Shift_Start/End, Weekdays (blank=Mon–Fri or 7-char 1111100). Overlap head-fraction per staffing interval divided evenly across enabled queues. (Net adjustment sign corrected in v1.9.3.)',
     'Introduces operator-driven pro forma staffing for cohorts not yet in Assembled.',
     'Released'],
    ['v1.9.1', '2026-04-30', 'Bobby Sorrell',
     'FIX: rvtoCheckQuota_ — removed call to UrlFetchApp.getRemainingDailyQuota (not a public API; threw TypeError). Remaining UrlFetch quota is not queryable from script. rvtoCheckQuota_ now only honors Script Property RVTO_ABORT_RUNS=TRUE as a manual kill-switch for runReverseVto.',
     'Restores intraday runs; operators can still halt the bot via Script Properties without relying on a non-existent quota API.',
     'Released'],
    ['v1.9.0', '2026-04-30', 'Bobby Sorrell',
     'FIX: rvtoConfigBool_() — Sheets boolean FALSE no longer forces SEND_EMAILS (and other flags) to default TRUE. WEEK_BLOCK: surplus intervals now retain net; running headroom map gates offers per rep based on overlap of their scheduled hours with surplus intervals; consumes headroom after successful send and on SEND_EMAILS=FALSE dry-run; pre-deducts active WEEK_VTO sheet rows. Audit: WEEK_BLOCK_HEADROOM.',
     'Prevents accidental mass email when toggling SEND_EMAILS off; week-block offer volume now tracks Assembled net staffing during each rep actual working hours.',
     'Released'],

    ['v1.1', '2025-01-01', 'Bobby Sorrell',
     'Fixed timezone bug in surplus block detection (rvtoMergeDeficitBlocks_)',
     'Surplus windows were evaluated in UTC instead of America/Chicago, causing missed or incorrect offers near midnight boundaries.',
     'Released'],
    ['v1.2', '2025-01-01', 'Bobby Sorrell',
     'Fixed Assembled commit: agent ID now resolved via /people API. Fixed activity type ID resolution. Added rvtoResolveAgentId_().',
     'Accepted offers were failing to write back to Assembled due to incorrect agent ID lookup. Accept flow now commits reliably.',
     'Released'],
    ['v1.3', '2025-01-01', 'Bobby Sorrell',
     'Fixed date/time storage bug in rvtoAppendOfferRow_(). Added instanceof Date guards and String() wrapping on sheet writes.',
     'Dates written to the Offers sheet were being auto-converted by Google Sheets, causing downstream parsing failures in the accept/decline flow.',
     'Released'],
    ['v1.4', '2025-01-01', 'Bobby Sorrell',
     'Fixed past-shift offer bug: surplus blocks whose start time has already passed are now filtered out before offers are created.',
     'Bot was sending VTO offers for shifts that had already begun or ended, making them unusable for recipients.',
     'Released'],
    ['v1.5', '2025-01-01', 'Bobby Sorrell',
     'Added Support site queue coverage: Client Chat, Client SMS, RTN IB Phone Tier 2 & 3, CEP IB Phone, Tutor Chat, Platform Support Chat. Added per-site ID resolution and per-queue enable/disable config toggles (QUEUE_ENABLED_*). Added ASSEMBLED_SITE_SUPPORT property.',
     'Expanded VTO bot coverage from Consumer Sales only to include all Support queues. Queues can be toggled on/off via Config without code changes.',
     'Released'],
    ['v1.5.1', '2026-04-15', 'Bobby Sorrell',
     'Fixed surplus block filter: changed blockStart < now to blockEnd <= now in rvtoMergeDeficitBlocks_(). Blocks that have already started but have future time remaining are now correctly retained.',
     'Long surplus windows (e.g. 07:00-22:00) were being discarded entirely if the bot ran after the block start time. High School queue was generating zero offers as a result.',
     'Released'],
    ['v1.5.2', '2026-04-15', 'Bobby Sorrell',
     'Replaced full-span schedule coverage check with overlap-based check (rvtoHasScheduleOverlap_). Added MIN_SCHEDULE_OVERLAP_HOURS config row (default: 2).',
     'Previous logic required a rep\'s schedule to span the entire deficit window. All 54 High School reps were failing eligibility. New logic correctly identifies reps with meaningful scheduled time inside the window.',
     'Released'],
    ['v1.5.3', '2026-04-15', 'Bobby Sorrell',
     'Added Changelog sheet to workbook. Pre-populated with version history v1.1 through v1.5.3.',
     'Provides a persistent, human-readable record of bot changes for operational visibility and promotion documentation.',
     'Released'],
    ['v1.5.4', '2026-04-15', 'Bobby Sorrell',
     'FIX 1: Offer window now reflects each rep\'s actual scheduled shift within the surplus block. FIX 2: 24-hour offer cap now correctly enforced across manual re-runs.',
     'FIX 1: Reps were receiving offer emails showing windows as wide as 07:00-22:00. FIX 2: Reps were receiving multiple offers per day across manual runs.',
     'Released'],
    ['v1.5.5', '2026-04-15', 'Bobby Sorrell',
     'FIX: Offer window start clipped to next 30-min boundary after now when shift already started. Offers with remaining window shorter than MIN_BLOCK_MINUTES are skipped.',
     'Reps whose shifts started earlier received misleading offer windows. Now correctly shows remaining shift portion only.',
     'Released'],
    ['v1.5.6', '2026-04-15', 'Bobby Sorrell',
     'FIX: Daily offer cap enforcement broken by Google Sheets auto-converting Date column. Fixed with instanceof Date guard in rvtoBuildOfferHistory_.',
     'Reps were receiving duplicate offers across manual runs on the same day.',
     'Released'],
    ['v1.5.7', '2026-04-17', 'Bobby Sorrell',
     'FIX: PENDING_SEND rows excluded from cap check, allowing duplicates during trigger overlap. PENDING_SEND now counts against both daily and 24h caps.',
     'Reps received duplicate emails when trigger fired while prior run rows were still in PENDING_SEND state.',
     'Released'],
    ['v1.5.8', '2026-04-17', 'Bobby Sorrell',
     'FIX 1: Rolling 24h cap window was only looking back 1 hour instead of 24. FIX 2: offersByEmail in-memory map now updated immediately after each offer within a run.',
     'FIX 1: Reps received duplicate emails after the 1-hour window expired. FIX 2: Cross-deficit duplicates within same run were not blocked.',
     'Released'],
    ['v1.5.9', '2026-04-21', 'Bobby Sorrell',
     'FIX: Timeout-orphaned PENDING_SEND rows eliminated by reversing send/append order. Email attempted before row written. Row appended once with correct final status.',
     'Trigger timeout kills mid-loop left permanent orphaned PENDING_SEND rows with no send and no audit trail.',
     'Released'],
    ['v1.6', '2026-04-21', 'Bobby Sorrell',
     'NEW: Offer expiry uses the earlier of sentAt + OFFER_HOLD_HOURS or blockStart + 5 minutes. Email body updated to remove hold-hours sentence.',
     'Reps could accept VTO offers after the window had already begun. Offers now auto-expire 5 minutes after block start.',
     'Released'],
    ['v1.6.1', '2026-04-21', 'Bobby Sorrell',
     'FIX: blockExpiry anchored to deficit.start instead of offerWindow.start. offerWindow now computed before expiry block.',
     'Reps scheduled mid-block received offers that expired immediately at send time because blockStart + 5 min was already in the past.',
     'Released'],
    ['v1.6.2', '2026-04-27', 'Bobby Sorrell',
     'Added quota guard (rvtoCheckQuota_()) at top of runReverseVto(). Aborts and logs to Audit if UrlFetch bandwidth remaining < 10MB. Prevents this script from exhausting the account-wide 100MB daily quota and blocking other scripts.',
     'Schedule Repair Bot and other account scripts were failing due to bandwidth quota exhaustion caused partly by high-frequency VTO pipeline runs. Guard ensures graceful degradation under quota pressure rather than blind failure.',
     'Released'],
    ['v1.6.3', '2026-04-27', 'Bobby Sorrell',
     'Added Shadow_Exclusion tab (Name, Email, Notes columns). Reps listed here are silently removed from the Assembled schedule pull before surplus/eligibility math runs. Their hours do not count as staffing and they cannot receive offers. Assembled is never modified. Added rvtoGetShadowExclusionEmails_() reader; shadowExcluded counter added to ELIGIBILITY_DEBUG audit rows.',
     'Needed for reps pending termination who should not count as available headcount for VTO math, but whose Assembled schedules cannot be removed yet without tipping them off. Bot-side exclusion is invisible to Assembled and to the rep.',
     'Released'],
    ['v1.6.4', '2026-04-27', 'Bobby Sorrell',
     'PGC priority: Script Properties PGC_SPREADSHEET_ID (+ optional PGC_SHEET_NAME) point to daily Looker export. Names in col B, PGC in col G. Eligible reps sorted unknown-PGC-first, then lowest PGC first. Config USE_PGC_PRIORITY toggles.',
     'Surplus VTO offers reach consultants with missing PGC data first, then lowest performers, so stronger reps stay on the phones when business is slow.',
     'Released'],
    ['v1.6.5', '2026-04-27', 'Bobby Sorrell',
     'PGC_ORDER audit rows: after sorting, logs first PGC_DEBUG_TOP_N eligibles with email and PGC=no_row or numeric value. Default top N=8; set Config PGC_DEBUG_TOP_N to 0 to disable.',
     'Operators can verify PGC ordering from the Audit tab without cross-checking the Looker sheet.',
     'Released'],
    ['v1.8.2', '2026-04-29', 'Bobby Sorrell',
     'NEW: 1-hour minimum lead time on all offers (hardcoded). Surplus blocks starting within 1 hour of now are discarded before offers are attempted. Offer window start clipped to now + 1hr (rounded to next 30-min boundary) for partially-elapsed blocks. Offers skipped if remaining window after clip is shorter than MIN_BLOCK_MINUTES.',
     'Prevents reps from receiving offers for shifts starting imminently with no realistic time to respond. Protects offer channel quality and rep experience.',
     'Released'],
    ['v1.8.1', '2026-04-29', 'Bobby Sorrell',
     'NEW: Minimum offer gap (OFFER_MIN_GAP_HOURS, default 1h). Rep cannot receive a second offer until at least this many hours have elapsed since their last sent offer, regardless of MAX_EMAILS_PER_24H. Rolling window. Prevents back-to-back trigger runs from sending near-identical offers when multiple surplus windows are detected close together. lastSentAt tracked in offer history; resets on COMMITTED so hot reps re-qualify immediately.',
     'Eliminated scenario where rep receives two offers for overlapping shift windows within the same trigger cycle (e.g. 7:14AM and 7:47AM) when MAX_EMAILS_PER_24H > 1. Offer channel quality protected regardless of how take-rate tuning adjusts the daily cap.',
     'Released'],
    ['v1.8.0', '2026-04-28', 'Bobby Sorrell',
     'NEW: Hard decline freeze. DECLINED rows in rvtoBuildOfferHistory_() now pin sentToday and sentLast24h to 999, blocking further offers for the full 24h window regardless of MAX_EMAILS_PER_24H config value. Immune to hot rep COMMITTED reset — a decline cannot be overridden by a later COMMITTED row in the same scan.',
     'Previously, raising MAX_EMAILS_PER_24H above 1 during high take-rate periods would allow a second offer to a rep who already declined. Decline now always means no more offers today, regardless of config threshold.',
     'Released'],
    ['v1.7.9', '2026-04-28', 'Bobby Sorrell',
     'NEW: Manager Slack DM on VTO commit. Manager receives DM with rep name + date/time on successful Assembled commit, for both intraday and week-block offers. New Manager_Aliases tab auto-populated from Roster. Config: MANAGER_VTO_SLACK (default TRUE). Script Property: SLACK_BOT_TOKEN. Failures audit-logged only, never disrupt commit.',
     'Managers are notified in real time when their reps accept VTO, keeping them informed without requiring Offers sheet access or manual follow-up.',
     'Released'],
    ['v1.7.8', '2026-04-28', 'Bobby Sorrell',
     'NEW: Hot rep re-eligibility. When rvtoBuildOfferHistory_() encounters a COMMITTED row, the rep\'s daily and 24h cap counters reset to zero. A rep who accepts VTO is immediately eligible for another offer on the next run. Cap increments again on the next send and normal rules resume.',
     'Reps who accept an offer self-select as willing to take time off. Previously they were blocked for 24 hours after committing. Now the bot can keep offering while the rep is in that mindset, maximising VTO uptake during surplus windows.',
     'Released'],
    ['v1.7.7', '2026-04-28', 'Bobby Sorrell',
     'Offer email subject lines now include date and time for inbox preview. Standard offers show date + time range. Week-block offers show the full date range. EMAIL_SUBJECT_PREFIX still controls the prefix.',
     'Reps can accept or decline from the inbox preview without opening the email, improving response rates.',
     'Released'],
    ['v1.7.6', '2026-04-28', 'Bobby Sorrell',
     'NEW: Per-rep 15% surplus gate (WEEK_VTO_MIN_SURPLUS_PCT, default 15). Rep qualifies only if >= 15% of their scheduled hours overlap surplus intervals. Replaces majority-of-days queue gate. NEW: Midday sort tiebreaker — earlier avg shift end first within PGC tier, protecting evening staffing. rvtoFindWeekBlockSurplusDays_() now returns full interval objects. New helpers: rvtoCalcRepSurplusPct_(), rvtoAvgShiftEndMinutes_().',
     'Previously any rep scheduled on a queue with 1+ surplus interval per day qualified. Now only reps with meaningful surplus overlap (15%+) qualify, and among those, earlier-ending shifts are offered first to minimise evening coverage impact.',
     'Released'],
    ['v1.7.5', '2026-04-28', 'Bobby Sorrell',
     'FIX: rvtoFindWeekBlockSurplusDays_() was passing end_time=23:59 to Assembled /forecasted_vs_actuals. Assembled requires end_time on an exact 30-min boundary (1800s); 23:59 caused 400 errors on every day/queue. Fixed to midnight-of-next-day, matching rvtoFindDeficits_() pattern. Also aligned rvtoPullSchedulesForDateRange_() end to midnight of day after WEEK_VTO_END_DATE.',
     'All surplus checks were returning FAILED (400) causing zero qualifying queues and zero offers sent regardless of actual staffing levels.',
     'Released'],
    ['v1.7.4', '2026-04-28', 'Bobby Sorrell',
     'FIX: WEEK_VTO_START_DATE and WEEK_VTO_END_DATE normalised before parsing. Sheets auto-converts yyyy-MM-dd cells to Date objects, causing rvtoBuildDateTime_() to throw "Invalid argument". New rvtoWkNormDateStr_() helper detects Date objects and normalises to yyyy-MM-dd string before parse.',
     'Week-block run was crashing immediately on menu trigger with "Invalid argument" error due to Sheets date auto-conversion. Now handles both Date objects and string values from the Config tab.',
     'Released'],
    ['v1.7.3', '2026-04-28', 'Bobby Sorrell',
     'FIX: Week-block Assembled commits now post one VTO activity per actual scheduled working block. rvtoGetRepScheduledBlocks_() serialises exact shift windows into offer Notes at send time (Blocks: yyyy-MM-dd HH:mm-HH:mm|...). rvtoCommitWeekBlockToAssembled_() parses these and POSTs one activity per block. Falls back to 08:00-17:00/day for pre-v1.7.3 offers with no Blocks data.',
     'Eliminates the generic 08:00-17:00 VTO block. Each accepted week-block offer now writes precisely-sized VTO activities that match the rep actual scheduled shift windows in Assembled, including split shifts and non-standard hours.',
     'Released'],
    ['v1.7.2', '2026-04-28', 'Bobby Sorrell',
     'NEW: STANDARD_VTO_ENABLED config row (default TRUE). Set FALSE to disable the intraday runReverseVto() trigger while week-block VTO continues to run independently via its own menu item.',
     'Allows operators to suppress normal per-surplus offers during a week-block campaign period without disabling the trigger or touching queue toggles. Missing or blank value defaults to TRUE so existing deployments are unaffected.',
     'Released'],
    ['v1.7.1', '2026-04-28', 'Bobby Sorrell',
     'FIX: Week-block schedule pull replaced rvtoPullSchedules_() with rvtoPullSchedulesForDateRange_(). Normal pull uses SCHEDULE_PULL_HOURS (78h) which cannot reach future week-block dates. New function pulls exactly from WEEK_VTO_START_DATE 00:00 to WEEK_VTO_END_DATE 23:59, independently of SCHEDULE_PULL_HOURS.',
     'Week-block runs targeting dates 34+ days out (e.g. first week of June, run in late April) would find zero scheduled reps and send zero offers. Now correctly pulls schedule data for the target week regardless of how far out it is.',
     'Released'],
    ['v1.7.0', '2026-04-28', 'Bobby Sorrell',
     'Week-Block VTO: single offer email covering a full date range. Rep accepts or declines the entire week at once. Config rows: WEEK_VTO_ENABLED, WEEK_VTO_START_DATE, WEEK_VTO_END_DATE. Surplus gate: majority of targeted days must have net >= MIN_SURPLUS per queue. Eligibility: same pipeline (no-fly, work group, schedule, shadow exclusion). Cap-exempt so normal VTO runs independently. On accept, commits one VTO activity per scheduled day to Assembled. Menu: Run Week-Block VTO.',
     'Enables bulk week-off VTO offers during low-demand periods without disrupting the normal per-surplus offer flow.',
     'Released']
  ];

  if (sheet.getLastRow() <= 1) {
    rvtoSetSheetData_(sheet, headers, history);
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

/*************************************************************
 * DEFICIT DETECTION
 *************************************************************/
function rvtoFindDeficits_(ctx) {
  const apiKey  = rvtoGetApiKey_();
  const headers = rvtoAuthHeaders_(apiKey);
  const config  = ctx.config;
  const rules   = ctx.rules;

  const tz         = ctx.timezone;
  const lookahead  = Number(rules.LOOKAHEAD_DAYS || 3);
  const interval   = Number(config.INTERVAL_SECONDS || 1800);
  const channel    = config.ASSEMBLED_CHANNEL || 'phone';

  const now      = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(dayStart.getTime() + lookahead * 24 * 60 * 60 * 1000);

  const sitesNeeded = {};
  ctx.enabledQueues.forEach(function(qd) { sitesNeeded[qd.site] = true; });

  const siteIds = {};
  Object.keys(sitesNeeded).forEach(function(siteKey) {
    const siteName = rvtoResolveSiteName_(config, siteKey);
    try {
      siteIds[siteKey] = rvtoResolveSiteId_(headers, siteName);
    } catch (err) {
      rvtoAudit_('FIND_DEFICITS', '', 'Site resolve failed for ' + siteKey + ': ' + err, 'FAILED');
      throw err;
    }
  });

  const queuesBySite = {};
  ctx.enabledQueues.forEach(function(qd) {
    if (!queuesBySite[qd.site]) queuesBySite[qd.site] = [];
    queuesBySite[qd.site].push(qd.name);
  });

  const queueMap = {};
  Object.keys(queuesBySite).forEach(function(siteKey) {
    var resolved;
    try {
      resolved = rvtoResolveQueueIds_(headers, queuesBySite[siteKey]);
    } catch (err) {
      rvtoAudit_('FIND_DEFICITS', '', 'Queue resolve failed for site ' + siteKey + ': ' + err, 'FAILED');
      throw err;
    }
    Object.keys(resolved).forEach(function(qName) { queueMap[qName] = resolved[qName]; });
  });

  const rawIntervals    = [];
  const aggregateNetMap = {};

  ctx.enabledQueues.forEach(function(qd) {
    const queueName = qd.name;
    const queueId   = queueMap[queueName];
    const siteId    = siteIds[qd.site];

    for (var d = 0; d < lookahead; d++) {
      const dayBegin = new Date(dayStart.getTime() + d * 24 * 60 * 60 * 1000);
      const dayEnd   = new Date(dayBegin.getTime() + 24 * 60 * 60 * 1000);
      const startSec = Math.floor(dayBegin.getTime() / 1000);
      const endSec   = Math.floor(dayEnd.getTime()   / 1000);

      const ASSEMBLED_PAGE_SIZE = 20;
      const intervals = [];
      let offset     = 0;
      let keepPaging = true;

      while (keepPaging) {
        var pageRes;
        try {
          pageRes = rvtoAssembledGet_(headers, '/forecasted_vs_actuals', {
            start_time: startSec,
            end_time:   endSec,
            interval:   interval,
            channel:    channel,
            site:       siteId,
            queue:      queueId,
            limit:      ASSEMBLED_PAGE_SIZE,
            offset:     offset
          });
          Utilities.sleep(300);
        } catch (err) {
          rvtoAudit_('FIND_DEFICITS', queueName, 'API error (offset ' + offset + '): ' + err, 'FAILED');
          break;
        }
        const pageIntervals = pageRes.forecasts_vs_actuals || [];
        pageIntervals.forEach(function(it) { intervals.push(it); });
        if (pageIntervals.length < ASSEMBLED_PAGE_SIZE) keepPaging = false;
        else offset += ASSEMBLED_PAGE_SIZE;
      }

      const intervalStarts = intervals
        .filter(function(it) { return it.start_time; })
        .map(function(it) { return new Date(it.start_time * 1000); });
      const minStart = intervalStarts.length ? new Date(Math.min.apply(null, intervalStarts)) : null;
      const maxStart = intervalStarts.length ? new Date(Math.max.apply(null, intervalStarts)) : null;
      rvtoAudit_('FIND_DEFICITS_DEBUG', queueName,
        'Day ' + d + ' | Site: ' + qd.site + ' | Raw intervals: ' + intervals.length +
        ' | Range: ' + (minStart ? Utilities.formatDate(minStart, tz, 'MM-dd HH:mm') : 'n/a') +
        ' to ' + (maxStart ? Utilities.formatDate(maxStart, tz, 'MM-dd HH:mm') : 'n/a'),
        'INFO');

      intervals.forEach(function(it) {
        const startTime = it.start_time ? new Date(it.start_time * 1000) : null;
        const endTime   = it.end_time   ? new Date(it.end_time   * 1000) : null;
        if (!startTime || !endTime) return;
        if (startTime < dayStart)  return;
        if (startTime > windowEnd) return;

        const scheduled = rvtoNum_(it.staffing_scheduled);
        const required  = rvtoNum_(it.staffing_required && it.staffing_required.forecasted);
        const netRaw    = rvtoIsNum_(it.staffing_net) ? Number(it.staffing_net) : (scheduled - required);
        const rampBoost = rvtoRampNetBoostPerQueue_(startTime, endTime, ctx, ctx.enabledQueues.length);
        const net         = netRaw + rampBoost;

        rawIntervals.push({
          queue: queueName, site: qd.site,
          startTime: startTime, endTime: endTime,
          scheduled: scheduled, required: required,
          netRaw: netRaw, rampBoost: rampBoost, net: net
        });

        if (queueName !== 'ISC_New') {
          const key = qd.site + '_' + startTime.getTime();
          aggregateNetMap[key] = (aggregateNetMap[key] || 0) + net;
        }
      });
    }
  });

  return rvtoMergeDeficitBlocks_(rawIntervals, tz, now, rules, aggregateNetMap);
}

/** Same-site aggregate interpreted net for this interval timestamp (ISC_New excluded from sum in rvtoFindDeficits_). */
function rvtoAggregateNetForInterval_(it, aggregateNetMap) {
  if (!aggregateNetMap) return null;
  var key = it.site + '_' + it.startTime.getTime();
  if (!(key in aggregateNetMap)) return null;
  return aggregateNetMap[key];
}

function rvtoFiniteMinMaxStr_(values) {
  if (!values || !values.length) return 'n/a';
  var nums = [];
  for (var i = 0; i < values.length; i++) {
    var x = values[i];
    if (x === null || x === undefined) continue;
    var n = Number(x);
    if (isFinite(n)) nums.push(n);
  }
  if (!nums.length) return 'n/a';
  var lo = Math.min.apply(null, nums);
  var hi = Math.max.apply(null, nums);
  return (Math.round(lo * 100) / 100) + '/' + (Math.round(hi * 100) / 100);
}

function rvtoNewSurplusMergeCursor_(it, aggregateNetMap) {
  return {
    queue: it.queue, site: it.site, startTime: it.startTime, endTime: it.endTime,
    netValues:       [it.net],
    netRawValues:    [it.netRaw],
    rampBoostValues: [it.rampBoost],
    scheduledValues: [it.scheduled],
    requiredValues:  [it.required],
    aggNetValues:    [rvtoAggregateNetForInterval_(it, aggregateNetMap)]
  };
}

function rvtoPushSurplusIntervalOntoCursor_(current, it, aggregateNetMap) {
  current.endTime = it.endTime;
  current.netValues.push(it.net);
  current.netRawValues.push(it.netRaw);
  current.rampBoostValues.push(it.rampBoost);
  current.scheduledValues.push(it.scheduled);
  current.requiredValues.push(it.required);
  current.aggNetValues.push(rvtoAggregateNetForInterval_(it, aggregateNetMap));
}

function rvtoAuditSurplusBlock_(b, minSurplusVal, tz) {
  var a = b._surplusAudit;
  if (!a) return;
  var details = [
    'Queue: ' + b.queue + ' [' + b.site + ']',
    'Window: ' + b.date + ' ' + b.start + '-' + b.end + ' (' + tz + ')',
    'interpretedNet min/max: ' + a.netInterpreted + ' | effective MIN_SURPLUS=' + minSurplusVal,
    'assembledNetRaw min/max: ' + a.netRaw,
    'rampBoost min/max: ' + a.rampBoost,
    'scheduled min/max: ' + a.scheduled,
    'requiredForecast min/max: ' + a.requiredForecast,
    'siteAggregateNet min/max (ISC_New excluded from sum): ' + a.aggregateNet,
    'intervalsMerged: ' + a.intervalCount,
    'headsNeeded: ' + b.headsNeeded + ' | netMin: ' + (Math.round(b.netMin * 100) / 100)
  ].join(' | ');
  rvtoAudit_('SURPLUS_BLOCK', b.deficitId, details, 'INFO');
  delete b._surplusAudit;
}

function rvtoMergeDeficitBlocks_(intervals, tz, now, rules, aggregateNetMap) {
  aggregateNetMap = aggregateNetMap || {};

  const gated = intervals.filter(function(it) {
    const key = it.site + '_' + it.startTime.getTime();
    if (!(key in aggregateNetMap)) return true;
    return aggregateNetMap[key] >= 0;
  });

  const sorted = gated.slice().sort(function(a, b) {
    if (a.queue !== b.queue) return a.queue.localeCompare(b.queue);
    return a.startTime - b.startTime;
  });

  const blocks = [];
  var current  = null;
  var dipCount = 0;

  sorted.forEach(function(it) {
    const thr = rvtoEffectiveMinSurplusForQueue_(it.queue, rules);
    const aboveThreshold = it.net >= thr;
    const sameQueue      = current && current.queue === it.queue;
    const contiguous     = current && current.endTime.getTime() === it.startTime.getTime();

    if (!current) {
      if (aboveThreshold) {
        current  = rvtoNewSurplusMergeCursor_(it, aggregateNetMap);
        dipCount = 0;
      }
      return;
    }

    if (!sameQueue || !contiguous) {
      if (current) blocks.push(rvtoFinalizeDeficitBlock_(current, tz));
      current  = aboveThreshold ? rvtoNewSurplusMergeCursor_(it, aggregateNetMap) : null;
      dipCount = 0;
      return;
    }

    if (aboveThreshold) {
      rvtoPushSurplusIntervalOntoCursor_(current, it, aggregateNetMap);
      dipCount = 0;
    } else {
      if (it.net > 0 && dipCount < 1) {
        dipCount++;
        current.endTime = it.endTime;
      } else {
        blocks.push(rvtoFinalizeDeficitBlock_(current, tz));
        current  = null;
        dipCount = 0;
      }
    }
  });

  if (current) blocks.push(rvtoFinalizeDeficitBlock_(current, tz));

  const minBlockMinutes = Number(rules.MIN_BLOCK_MINUTES || 120);

  // v1.8.2: Discard blocks that start within 1 hour of now (CST).
  // Reps need at least 1 hour of lead time to act on an offer meaningfully.
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  var kept = blocks.filter(function(b) {
    const blockEnd   = rvtoBuildDateTime_(b.date, b.end,   tz);
    const blockStart = rvtoBuildDateTime_(b.date, b.start, tz);
    if (!blockEnd || !blockStart) return false;
    if (blockEnd <= now) return false;
    // Block must start at least 1 hour from now
    if (blockStart < oneHourFromNow) return false;
    const durationMinutes = (blockEnd - blockStart) / 60000;
    return durationMinutes >= minBlockMinutes;
  });

  kept.forEach(function(b) {
    rvtoAuditSurplusBlock_(b, rvtoEffectiveMinSurplusForQueue_(b.queue, rules), tz);
  });
  return kept;
}

function rvtoFinalizeDeficitBlock_(block, tz) {
  const netMin      = Math.min.apply(null, block.netValues);
  const headsNeeded = Math.max(1, Math.floor(netMin));
  return {
    deficitId:   rvtoBuildId_('RVTO_DEF'),
    queue:       block.queue,
    site:        block.site,
    date:        Utilities.formatDate(block.startTime, tz, 'yyyy-MM-dd'),
    start:       Utilities.formatDate(block.startTime, tz, 'HH:mm'),
    end:         Utilities.formatDate(block.endTime,   tz, 'HH:mm'),
    netMin:      netMin,
    headsNeeded: headsNeeded,
    startTime:   block.startTime,
    endTime:     block.endTime,
    _surplusAudit: {
      netInterpreted: rvtoFiniteMinMaxStr_(block.netValues),
      netRaw:         rvtoFiniteMinMaxStr_(block.netRawValues),
      rampBoost:      rvtoFiniteMinMaxStr_(block.rampBoostValues),
      scheduled:      rvtoFiniteMinMaxStr_(block.scheduledValues),
      requiredForecast: rvtoFiniteMinMaxStr_(block.requiredValues),
      aggregateNet:   rvtoFiniteMinMaxStr_(block.aggNetValues),
      intervalCount:  block.netValues.length
    }
  };
}

/*************************************************************
 * SCHEDULE INDEX BUILDER
 *************************************************************/
function rvtoBuildSchedIdx_(schedules) {
  const schedIdx = {};
  schedules.forEach(function(row) {
    const email = (row.email || '').trim().toLowerCase();
    if (!email) return;
    if (!schedIdx[email]) schedIdx[email] = [];
    schedIdx[email].push({ start: row.startTime, end: row.endTime, agentId: row.agentId || '' });
  });
  return schedIdx;
}

/**
 * v1.9.6: Phone-only schedule index. Used exclusively for headroom math.
 * Headroom asks "if I take this rep off phones during this interval, would
 * coverage suffer?" — meal/break/lunch blocks must NOT count, because the
 * rep is not contributing to phone net during those windows. Assembled's
 * staffing_net for that interval already reflects the rep being on lunch
 * (i.e. not counted), so subtracting 1 from headroom for an overlap with
 * their lunch block double-deducts. This caused mass false-negative
 * rejections in rvtoRepCanFitInHeadroom_() especially in High School where
 * scattered low-headroom intervals (+1, +1.5) intersected reps' meal/break
 * blocks despite the same reps having strong phone-time headroom.
 *
 * Pull source must tag activities with type. Since rvtoPullSchedulesForDateRange_()
 * does not currently surface activity type, this builder takes a parallel
 * `phoneSchedules` array passed in by the caller. See v1.9.6 changes to
 * rvtoPullSchedulesForDateRange_() for the type-aware split.
 */
function rvtoBuildPhoneSchedIdx_(phoneSchedules) {
  const idx = {};
  phoneSchedules.forEach(function(row) {
    const email = (row.email || '').trim().toLowerCase();
    if (!email) return;
    if (!idx[email]) idx[email] = [];
    idx[email].push({ start: row.startTime, end: row.endTime, agentId: row.agentId || '' });
  });
  return idx;
}

/*************************************************************
 * REP OFFER WINDOW — v1.5.4
 *************************************************************/
function rvtoGetRepOfferWindow_(email, defStart, defEnd, schedIdx, tz, now, minBlockMinutes) {
  const blocks = (schedIdx[email] || []).slice().sort(function(a, b) { return a.start - b.start; });

  const segments = [];
  blocks.forEach(function(block) {
    const oStart = new Date(Math.max(block.start.getTime(), defStart.getTime()));
    const oEnd   = new Date(Math.min(block.end.getTime(),   defEnd.getTime()));
    if (oEnd > oStart) segments.push({ start: oStart, end: oEnd });
  });

  if (!segments.length) {
    return {
      date:  Utilities.formatDate(defStart, tz, 'yyyy-MM-dd'),
      start: Utilities.formatDate(defStart, tz, 'HH:mm'),
      end:   Utilities.formatDate(defEnd,   tz, 'HH:mm')
    };
  }

  segments.sort(function(a, b) { return a.start - b.start; });
  var merged = [{ start: segments[0].start, end: segments[0].end }];
  for (var i = 1; i < segments.length; i++) {
    var last = merged[merged.length - 1];
    if (segments[i].start <= last.end) {
      if (segments[i].end > last.end) last.end = segments[i].end;
    } else {
      merged.push({ start: segments[i].start, end: segments[i].end });
    }
  }

  var winStart = merged[0].start;
  const winEnd = merged[merged.length - 1].end;

  // v1.8.2: Offer window must start at least 1 hour from now.
  // Clip to the later of (winStart) or (now + 1hr rounded to next 30-min boundary).
  const oneHrMs      = 60 * 60 * 1000;
  const intervalMs   = 30 * 60 * 1000;
  const minStart     = new Date(Math.ceil((now.getTime() + oneHrMs) / intervalMs) * intervalMs);

  if (now && winStart < minStart) {
    if (minStart >= winEnd) return null;
    const remainingMinutes = (winEnd.getTime() - minStart.getTime()) / 60000;
    if (remainingMinutes < (minBlockMinutes || 120)) return null;
    winStart = minStart;
  }

  return {
    date:  Utilities.formatDate(winStart, tz, 'yyyy-MM-dd'),
    start: Utilities.formatDate(winStart, tz, 'HH:mm'),
    end:   Utilities.formatDate(winEnd,   tz, 'HH:mm')
  };
}

/*************************************************************
 * ELIGIBILITY
 *************************************************************/
function rvtoFindEligible_(deficit, roster, schedIdx, ctx) {
  const rules           = ctx.rules;
  const maxPerDay       = Number(rules.MAX_OFFERS_PER_PERSON_PER_DAY || 1);
  const maxPer24h       = Number(rules.MAX_EMAILS_PER_24H || 1);
  const minOverlapHours = Number(rules.MIN_SCHEDULE_OVERLAP_HOURS || 2);
  const noFlySet        = ctx.noFlySet;
  const offersByEmail   = ctx.offersByEmail;

  const queueDef         = RVTO_APP.QUEUE_DEFS.filter(function(qd) { return qd.name === deficit.queue; })[0];
  const workGroupPattern = queueDef ? queueDef.workGroupPattern : '';
  const shadowEmails     = ctx.shadowExclusionEmails || new Set();

  const selectedThisRun = ctx.selectedThisRun || (ctx.selectedThisRun = new Set());
  const eligible        = [];
  var debugCounts       = { noEmail: 0, queueMismatch: 0, noFly: 0, shadowExcluded: 0, notScheduled: 0, tooManyOffers: 0, passed: 0 };

  roster.forEach(function(person) {
    const email = (person.email || '').trim().toLowerCase();
    if (!email) { debugCounts.noEmail++; return; }
    if (!rvtoWorkGroupMatches_(person.workGroup, workGroupPattern)) { debugCounts.queueMismatch++; return; }
    if (noFlySet.has(rvtoNormalizeName_(person.name))) { debugCounts.noFly++; return; }
    if (shadowEmails.has(email)) { debugCounts.shadowExcluded++; return; }

    if (!rvtoHasScheduleOverlap_(email, deficit.startTime, deficit.endTime, schedIdx, minOverlapHours)) {
      debugCounts.notScheduled++;
      return;
    }

    if (selectedThisRun.has(email)) { debugCounts.tooManyOffers++; return; }

    const history = offersByEmail[email] || { sentToday: 0, sentLast24h: 0, lastSentAt: null };
    if (history.sentToday >= maxPerDay || history.sentLast24h >= maxPer24h) {
      debugCounts.tooManyOffers++;
      return;
    }

    // v1.8.1: Min-gap check — rolling window regardless of cap count.
    // Prevents back-to-back trigger runs from sending overlapping offers
    // to the same rep even when MAX_EMAILS_PER_24H > 1.
    if (history.lastSentAt) {
      const minGapHours = Number(rules.OFFER_MIN_GAP_HOURS || 1);
      const gapMs       = minGapHours * 60 * 60 * 1000;
      const msSinceLast = new Date().getTime() - new Date(history.lastSentAt).getTime();
      if (msSinceLast < gapMs) {
        debugCounts.tooManyOffers++;
        return;
      }
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

  rvtoAudit_('ELIGIBILITY_DEBUG', deficit.deficitId,
    'Queue: ' + deficit.queue + ' [' + deficit.site + ']' +
    ' | Window: ' + deficit.start + '-' + deficit.end +
    ' | MinOverlap: ' + minOverlapHours + 'h' +
    ' | Roster: ' + roster.length +
    ' | noEmail: ' + debugCounts.noEmail +
    ' | queueMismatch: ' + debugCounts.queueMismatch +
    ' | noFly: ' + debugCounts.noFly +
    ' | shadowExcluded: ' + debugCounts.shadowExcluded +
    ' | notScheduled: ' + debugCounts.notScheduled +
    ' | tooManyOffers: ' + debugCounts.tooManyOffers +
    ' | passed: ' + debugCounts.passed,
    debugCounts.passed > 0 ? 'OK' : 'WARN');

  var usePgc = rvtoConfigBool_(ctx.config && ctx.config.USE_PGC_PRIORITY, true);
  var pgcMap = ctx.pgcByNormalizedName || {};
  if (usePgc) {
    rvtoSortEligibleByPgc_(eligible, pgcMap);
  }
  if (usePgc && eligible.length) {
    rvtoMaybeAuditPgcOrder_(deficit.deficitId, eligible, pgcMap, ctx.config);
  }

  return eligible;
}

function rvtoCountReservedSeats_(deficit, offerObjects) {
  const now = new Date();
  return offerObjects.filter(function(obj) {
    if (String(obj['Queue'] || '').trim() !== deficit.queue) return false;
    if (String(obj['Date']  || '').trim() !== deficit.date)  return false;
    if (String(obj['Start'] || '').trim() !== deficit.start) return false;
    if (String(obj['End']   || '').trim() !== deficit.end)   return false;

    const status = String(obj['Status'] || '').trim().toUpperCase();
    if ([RVTO_APP.OFFER_STATUSES.DECLINED, RVTO_APP.OFFER_STATUSES.EXPIRED, RVTO_APP.OFFER_STATUSES.SEND_FAILED].indexOf(status) !== -1) return false;
    if ([RVTO_APP.OFFER_STATUSES.ACCEPTED, RVTO_APP.OFFER_STATUSES.COMMITTED].indexOf(status) !== -1) return true;

    const sentAt    = obj['Sent At']    ? new Date(obj['Sent At'])    : null;
    const expiresAt = obj['Expires At'] ? new Date(obj['Expires At']) : null;
    const holdHours = Number(obj['Hold Hours'] || 1);
    const effectiveExpiry = (expiresAt && !isNaN(expiresAt.getTime()))
      ? expiresAt : (sentAt ? rvtoAddHours_(sentAt, holdHours) : null);

    return !!(effectiveExpiry && now < effectiveExpiry);
  }).length;
}

function rvtoHasScheduleOverlap_(email, defStart, defEnd, schedIdx, minOverlapHours) {
  const blocks = schedIdx[email] || [];
  if (!blocks.length) return false;
  const minOverlapMs = (minOverlapHours || 0) * 60 * 60 * 1000;
  var totalOverlapMs = 0;
  blocks.forEach(function(block) {
    const oStart = Math.max(block.start.getTime(), defStart.getTime());
    const oEnd   = Math.min(block.end.getTime(),   defEnd.getTime());
    if (oEnd > oStart) totalOverlapMs += (oEnd - oStart);
  });
  return totalOverlapMs >= minOverlapMs;
}

function rvtoWorkGroupMatches_(personWorkGroup, pattern) {
  if (!pattern) return true;
  const left = (personWorkGroup || '').toLowerCase().trim();
  return pattern.split('|').some(function(opt) {
    return left.indexOf(opt.toLowerCase().trim()) !== -1;
  });
}

/*************************************************************
 * SCHEDULE PULL
 *************************************************************/
function rvtoPullSchedules_(ctx) {
  const apiKey = rvtoGetApiKey_();
  const config = ctx.config;
  const hours  = Number(config.SCHEDULE_PULL_HOURS || 78);

  const now        = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const end = new Date(todayStart.getTime() + hours * 60 * 60 * 1000);

  const url = RVTO_APP.BASE_URL + '/activities'
    + '?start_time=' + Math.floor(todayStart.getTime() / 1000)
    + '&end_time='   + Math.floor(end.getTime() / 1000)
    + '&include_agents=true'
    + '&include_activity_types=true';

  const resp = UrlFetchApp.fetch(url, { method: 'get', headers: rvtoAuthHeaders_(apiKey), muteHttpExceptions: true });
  const code = resp.getResponseCode();
  const text = resp.getContentText();

  if (code < 200 || code >= 300) {
    rvtoAudit_('PULL_SCHEDULES', '', 'API error ' + code + ': ' + text, 'FAILED');
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

  rvtoAudit_('PULL_SCHEDULES_DEBUG', '',
    'Total activities: ' + actList.length +
    ' | Total agents: ' + Object.keys(agents).length +
    ' | Total types: ' + Object.keys(typeNameMap).length, 'INFO');

  const WORKING_TYPES = ['phone', 'meal', 'break', 'lunch', 'rest break', 'chat', 'sms'];
  const shadowEmails  = ctx.shadowExclusionEmails || new Set();
  const rows = [];

  actList.forEach(function(act) {
    const typeName = typeNameMap[act.type_id] || '';
    if (WORKING_TYPES.indexOf(typeName) === -1) return;
    const startTime = act.start_time ? new Date(act.start_time * 1000) : null;
    const endTime   = act.end_time   ? new Date(act.end_time   * 1000) : null;
    if (!startTime || !endTime) return;
    const agentId = (act.agent_id || '').trim();
    const agent   = agents[agentId] || {};
    const email   = (agent.email || agent.primary_email || '').trim().toLowerCase();
    if (shadowEmails.has(email)) return;
    rows.push({ email: email, agentId: agentId, startTime: startTime, endTime: endTime });
  });

  return rows;
}

/**
 * v1.7.1: Week-block schedule pull. Fetches Assembled activities spanning
 * rangeStart to rangeEnd exactly, ignoring SCHEDULE_PULL_HOURS entirely.
 * This allows week-block runs for dates far in the future (e.g. 34 days out)
 * without touching SCHEDULE_PULL_HOURS, which is used only by the normal
 * intraday runReverseVto() flow.
 */
function rvtoPullSchedulesForDateRange_(ctx, rangeStart, rangeEnd) {
  const apiKey      = rvtoGetApiKey_();
  const shadowEmails = ctx.shadowExclusionEmails || new Set();

  // Clamp to start-of-day / end-of-day to ensure full day coverage
  const pullStart = new Date(rangeStart);
  pullStart.setHours(0, 0, 0, 0);
  // Use start of next day after rangeEnd so the full last day is covered.
  // setHours(0,0,0,0) on rangeEnd+1day gives a clean midnight boundary.
  const pullEnd = new Date(rangeEnd);
  pullEnd.setHours(0, 0, 0, 0);
  pullEnd.setDate(pullEnd.getDate() + 1);

  const url = RVTO_APP.BASE_URL + '/activities'
    + '?start_time=' + Math.floor(pullStart.getTime() / 1000)
    + '&end_time='   + Math.floor(pullEnd.getTime()   / 1000)
    + '&include_agents=true'
    + '&include_activity_types=true';

  rvtoAudit_('WEEK_BLOCK_PULL_SCHEDULES', '',
    'Pulling schedules for date range: ' +
    Utilities.formatDate(pullStart, ctx.timezone, 'yyyy-MM-dd') + ' to ' +
    Utilities.formatDate(pullEnd,   ctx.timezone, 'yyyy-MM-dd'),
    'INFO');

  const resp = UrlFetchApp.fetch(url, { method: 'get', headers: rvtoAuthHeaders_(apiKey), muteHttpExceptions: true });
  const code = resp.getResponseCode();
  const text = resp.getContentText();

  if (code < 200 || code >= 300) {
    rvtoAudit_('WEEK_BLOCK_PULL_SCHEDULES', '', 'API error ' + code + ': ' + text, 'FAILED');
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

  rvtoAudit_('WEEK_BLOCK_PULL_SCHEDULES', '',
    'Total activities: ' + actList.length +
    ' | Total agents: ' + Object.keys(agents).length,
    'INFO');

  const WORKING_TYPES = ['phone', 'meal', 'break', 'lunch', 'rest break', 'chat', 'sms'];
  // v1.9.6: Phone-coverage types only. These are the activity types where the
  // rep is actively contributing to net staffing for VTO/coverage math.
  // Excludes meal/break/lunch which Assembled already nets out of staffing_net.
  const PHONE_COVERAGE_TYPES = ['phone', 'chat', 'sms'];

  const rows       = [];
  const phoneRows  = [];

  actList.forEach(function(act) {
    const typeName = typeNameMap[act.type_id] || '';
    if (WORKING_TYPES.indexOf(typeName) === -1) return;
    const startTime = act.start_time ? new Date(act.start_time * 1000) : null;
    const endTime   = act.end_time   ? new Date(act.end_time   * 1000) : null;
    if (!startTime || !endTime) return;
    const agentId = (act.agent_id || '').trim();
    const agent   = agents[agentId] || {};
    const email   = (agent.email || agent.primary_email || '').trim().toLowerCase();
    if (shadowEmails.has(email)) return;

    const row = { email: email, agentId: agentId, startTime: startTime, endTime: endTime };
    rows.push(row);
    if (PHONE_COVERAGE_TYPES.indexOf(typeName) !== -1) {
      phoneRows.push(row);
    }
  });

  // v1.9.6: Attach phone-only subset to the array as a non-enumerable property
  // so existing callers that just iterate `rows` are unaffected. Headroom
  // callers read `rows.phoneRows`.
  Object.defineProperty(rows, 'phoneRows', {
    value: phoneRows,
    enumerable: false,
    writable: false
  });

  rvtoAudit_('WEEK_BLOCK_PULL_SCHEDULES', '',
    'Phone-coverage rows: ' + phoneRows.length + ' / Total working rows: ' + rows.length,
    'INFO');

  return rows;
}

/*************************************************************
 * ROSTER READER
 *************************************************************/
function rvtoGetRoster_(ctx) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.ROSTER);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];

  return values.slice(1)
    .filter(function(row) { return row.some(function(c) { return c !== ''; }); })
    .map(function(row) {
      const obj  = rvtoRowToObj_(headers, row);
      const name = String(obj['Name'] || '').trim();
      let email  = String(obj['Email'] || '').trim().toLowerCase();
      if (!email && name) email = rvtoDeriveEmail_(name);
      return {
        name:            name,
        email:           email,
        workGroup:       String(obj['Work Group'] || '').trim(),
        manager:         String(obj['Manager']    || '').trim(),
        subGroup:        String(obj['Sub Group']  || '').trim(),
        functionalGroup: String(obj['Functional Group'] || '').trim()
      };
    })
    .filter(function(p) { return !!p.name && !!p.email; });
}

function rvtoDeriveEmail_(name) {
  const parts = name.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);
  if (parts.length < 2) return '';
  return parts.join('.') + '@varsitytutors.com';
}

/*************************************************************
 * OFFER EMAIL
 *************************************************************/
function rvtoSendOfferEmail_(opts) {
  const config   = opts.config;
  const tz       = config.TIMEZONE || 'America/Chicago';
  const fromName = config.EMAIL_FROM_NAME || 'Scheduling Bot';
  const dateDisplay = rvtoFormatDateDisplay_(opts.date, tz);
  const timeDisplay = rvtoFormatTimeRange_(opts.date, opts.start, opts.end, tz);
  // v1.7.7: include date + time in subject so reps can decide from inbox preview
  const subject  = (config.EMAIL_SUBJECT_PREFIX || 'VTO Opportunity') + ' — ' + dateDisplay + ', ' + timeDisplay;
  const expiresStr  = Utilities.formatDate(opts.expiresAt, tz, "EEE, MMM d 'at' h:mm a") + ' CT';

  const html = [
    "<div style='font-family:Arial,sans-serif;font-size:14px;line-height:1.5;'>",
    "<p>Hi " + rvtoEscHtml_(opts.name || 'there') + ",</p>",
    "<p>You have a voluntary time off opportunity available.Please note that this does not impact holiday pay.</p>",
    "<p><strong>Date:</strong> "  + rvtoEscHtml_(dateDisplay) + "<br>",
    "<strong>Time:</strong> "  + rvtoEscHtml_(timeDisplay) + "<br>",
    "<strong>Queue:</strong> " + rvtoEscHtml_(opts.queue)  + "</p>",
    "<p>Please respond before this offer expires.<br>",
    "<strong>Offer expires:</strong> " + rvtoEscHtml_(expiresStr) + "</p>",
    opts.acceptUrl  ? "<p><a href='" + rvtoEscHtml_(opts.acceptUrl)  + "' style='font-size:16px;font-weight:bold;'>✅ Accept VTO</a></p>" : '',
    opts.declineUrl ? "<p><a href='" + rvtoEscHtml_(opts.declineUrl) + "'>No thanks - Decline</a></p>" : '',
    "<p>Thank you,</p><p>" + rvtoEscHtml_(fromName) + "</p></div>"
  ].join('');

  try {
    GmailApp.sendEmail(opts.email, subject, rvtoHtmlToPlain_(html), { name: fromName, htmlBody: html });
    rvtoAudit_('SEND_EMAIL', opts.offerId, 'Sent to ' + opts.email, 'OK');
    return true;
  } catch (err) {
    rvtoAudit_('SEND_EMAIL', opts.offerId, String(err), 'FAILED');
    return false;
  }
}

/*************************************************************
 * WEB APP — handles Accept / Decline clicks
 *************************************************************/
function doGet(e) {
  const offerId   = String((e.parameter && e.parameter.offer_id)   || '').trim();
  const action    = String((e.parameter && e.parameter.action)     || '').trim().toLowerCase();
  const token     = String((e.parameter && e.parameter.token)      || '').trim();
  const offerType = String((e.parameter && e.parameter.offer_type) || '').trim().toLowerCase();

  if (!offerId || !action || !token) {
    return HtmlService.createHtmlOutput(rvtoResponsePage_('Missing required parameters.', false)).setTitle('Targeted VTO');
  }

  // Route week-block offers to the dedicated handler
  var result;
  if (offerType === 'week_block' || offerId.indexOf(RVTO_APP.WEEK_BLOCK_PREFIX) === 0) {
    result = rvtoProcessWeekBlockResponse_(offerId, action, token);
  } else {
    result = rvtoProcessResponse_(offerId, action, token);
  }

  return HtmlService.createHtmlOutput(rvtoResponsePage_(result.message, result.ok)).setTitle('Targeted VTO');
}

function rvtoProcessResponse_(offerId, action, token) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return { ok: false, message: 'Offer system unavailable.' };

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { ok: false, message: 'No offers found.' };

  const headers = values[0];
  const now     = new Date();
  const config  = rvtoGetConfig_();

  for (var i = 1; i < values.length; i++) {
    const obj = rvtoRowToObj_(headers, values[i]);
    if (String(obj['Offer ID'] || '').trim() !== offerId) continue;
    if (String(obj['Token']    || '').trim() !== token) return { ok: false, message: 'Invalid token.' };

    const status = String(obj['Status'] || '').trim().toUpperCase();

    if ([RVTO_APP.OFFER_STATUSES.DECLINED, RVTO_APP.OFFER_STATUSES.EXPIRED].indexOf(status) !== -1) {
      return { ok: false, message: 'This offer is no longer active.' };
    }

    if (status === RVTO_APP.OFFER_STATUSES.COMMITTED) {
      return { ok: true, message: 'You have already accepted this offer - it has been recorded.' };
    }

    const sentAt       = obj['Sent At']    ? new Date(obj['Sent At'])    : null;
    const expiresAtRaw = obj['Expires At'] ? new Date(obj['Expires At']) : null;
    const holdHours    = Number(obj['Hold Hours'] || 1);
    const effectiveExpiry = (expiresAtRaw && !isNaN(expiresAtRaw.getTime()))
      ? expiresAtRaw : (sentAt ? rvtoAddHours_(sentAt, holdHours) : null);

    if (effectiveExpiry && now >= effectiveExpiry) {
      rvtoUpdateOfferField_(offerId, 'Status',          RVTO_APP.OFFER_STATUSES.EXPIRED);
      rvtoUpdateOfferField_(offerId, 'Response Time',   now);
      rvtoUpdateOfferField_(offerId, 'Response Action', 'expired_before_response');
      return { ok: false, message: 'This offer has expired.' };
    }

    if (action === 'accept') {
      if (status !== RVTO_APP.OFFER_STATUSES.ACCEPTED) {
        rvtoUpdateOfferField_(offerId, 'Status',          RVTO_APP.OFFER_STATUSES.ACCEPTED);
        rvtoUpdateOfferField_(offerId, 'Response Time',   now);
        rvtoUpdateOfferField_(offerId, 'Response Action', 'accept');
        rvtoUpdateOfferField_(offerId, 'Notes',           'Accepted by rep.');
        rvtoAudit_('OFFER_ACCEPTED', offerId, 'Accepted by ' + obj['Email'], 'OK');
      } else {
        rvtoAudit_('OFFER_ACCEPTED', offerId, 'Re-accept attempt by ' + obj['Email'], 'INFO');
      }

      const commitEnabled = rvtoConfigBool_(config.ASSEMBLED_COMMIT, true);
      if (commitEnabled) {
        var commitResult;
        try {
          rvtoAudit_('ASSEMBLED_COMMIT_START', offerId, 'Attempting commit for ' + obj['Email'], 'INFO');
          commitResult = rvtoCommitToAssembled_(offerId, obj, config);
        } catch (commitErr) {
          rvtoAudit_('ASSEMBLED_COMMIT', offerId, 'Unhandled exception: ' + String(commitErr), 'FAILED');
          return { ok: false, message: 'Your acceptance was recorded but could not be written to Assembled.' };
        }
        return commitResult.ok
          ? { ok: true,  message: 'Thanks! Your VTO has been accepted and recorded in the schedule.' }
          : { ok: false, message: 'Your acceptance was recorded but could not be written to Assembled. Scheduling will follow up.' };
      }
      return { ok: true, message: 'Thanks! Your VTO has been recorded.' };
    }

    if (action === 'decline') {
      rvtoUpdateOfferField_(offerId, 'Status',          RVTO_APP.OFFER_STATUSES.DECLINED);
      rvtoUpdateOfferField_(offerId, 'Response Time',   now);
      rvtoUpdateOfferField_(offerId, 'Response Action', 'decline');
      rvtoUpdateOfferField_(offerId, 'Notes',           'Declined by rep.');
      rvtoAudit_('OFFER_DECLINED', offerId, 'Declined by ' + obj['Email'], 'OK');
      return { ok: true, message: 'Got it - you have declined this offer.' };
    }

    return { ok: false, message: 'Invalid action.' };
  }

  return { ok: false, message: 'Offer not found.' };
}

function rvtoResponsePage_(message, isSuccess) {
  const bg     = '#1F4E78';
  const card   = '#2E6DA4';
  const accent = isSuccess ? '#b8ffcf' : '#ffd6ff';
  const sub    = '#cce4f7';
  return [
    "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1.0'>",
    "<title>VTO Response</title></head>",
    "<body style='margin:0;padding:0;background:" + bg + ";font-family:Arial,sans-serif;'>",
    "<div style='min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;'>",
    "<div style='max-width:520px;width:100%;background:" + card + ";border-radius:16px;padding:32px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.25);'>",
    "<div style='font-size:26px;font-weight:bold;color:#fff;margin-bottom:16px;'>VTO Offer Response</div>",
    "<div style='font-size:18px;color:" + accent + ";font-weight:600;margin-bottom:12px;'>" + rvtoEscHtml_(message) + "</div>",
    "<div style='font-size:14px;color:" + sub + ";'>You can close this page.</div>",
    "</div></div></body></html>"
  ].join('');
}

/*************************************************************
 * ASSEMBLED COMMIT
 *************************************************************/
function rvtoCommitToAssembled_(offerId, obj, config) {
  const email = String(obj['Email'] || '').trim().toLowerCase();
  const tz    = config.TIMEZONE || 'America/Chicago';

  const date  = (obj['Date']  instanceof Date) ? Utilities.formatDate(obj['Date'],  tz, 'yyyy-MM-dd') : String(obj['Date']  || '').trim();
  const start = (obj['Start'] instanceof Date) ? Utilities.formatDate(obj['Start'], tz, 'HH:mm')      : String(obj['Start'] || '').trim();
  const end   = (obj['End']   instanceof Date) ? Utilities.formatDate(obj['End'],   tz, 'HH:mm')      : String(obj['End']   || '').trim();

  var agentId = String(obj['Agent ID'] || '').trim();

  if (!agentId) {
    if (!email) {
      rvtoUpdateOfferField_(offerId, 'Status', RVTO_APP.OFFER_STATUSES.COMMIT_FAILED);
      rvtoUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
      rvtoUpdateOfferField_(offerId, 'Notes', 'Missing email — cannot resolve agent ID');
      rvtoAudit_('ASSEMBLED_COMMIT', offerId, 'Missing email for agent ID lookup', 'FAILED');
      return { ok: false };
    }
    rvtoAudit_('ASSEMBLED_COMMIT', offerId, 'agentId blank — falling back to /people lookup for ' + email, 'INFO');
    agentId = rvtoResolveAgentId_(email);
    if (!agentId) {
      rvtoUpdateOfferField_(offerId, 'Status', RVTO_APP.OFFER_STATUSES.COMMIT_FAILED);
      rvtoUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
      rvtoUpdateOfferField_(offerId, 'Notes', 'Agent ID not found in /people for ' + email);
      rvtoAudit_('ASSEMBLED_COMMIT', offerId, 'No agent UUID found for ' + email, 'FAILED');
      return { ok: false };
    }
    rvtoUpdateOfferField_(offerId, 'Agent ID', agentId);
    rvtoAudit_('ASSEMBLED_COMMIT', offerId, 'Resolved agent ID ' + agentId + ' for ' + email, 'INFO');
  }

  const activityTypeId = rvtoResolveVtoTypeId_(config);
  if (!activityTypeId) {
    rvtoUpdateOfferField_(offerId, 'Status', RVTO_APP.OFFER_STATUSES.COMMIT_FAILED);
    rvtoUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
    rvtoUpdateOfferField_(offerId, 'Notes', 'Could not resolve VTO activity type ID.');
    rvtoAudit_('ASSEMBLED_COMMIT', offerId, 'Missing VTO activity type ID', 'FAILED');
    return { ok: false };
  }

  const startTime = rvtoBuildDateTime_(date, start, tz);
  const endTime   = rvtoBuildDateTime_(date, end,   tz);
  if (!startTime || !endTime) {
    rvtoUpdateOfferField_(offerId, 'Status', RVTO_APP.OFFER_STATUSES.COMMIT_FAILED);
    rvtoUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
    rvtoUpdateOfferField_(offerId, 'Notes', 'Invalid start/end time: ' + date + ' ' + start + '-' + end);
    rvtoAudit_('ASSEMBLED_COMMIT', offerId, 'Invalid datetime: ' + date + ' ' + start + '-' + end, 'FAILED');
    return { ok: false };
  }

  const apiKey  = rvtoGetApiKey_();
  const payload = {
    agent_id:   agentId,
    type_id:    activityTypeId,
    start_time: Math.floor(startTime.getTime() / 1000),
    end_time:   Math.floor(endTime.getTime()   / 1000)
  };

  rvtoAudit_('ASSEMBLED_COMMIT', offerId,
    'POSTing to /activities | agent: ' + agentId + ' | type: ' + activityTypeId + ' | ' + date + ' ' + start + '-' + end, 'INFO');

  try {
    const resp      = rvtoAssembledPost_(rvtoAuthHeaders_(apiKey), '/activities', payload);
    const requestId = String(resp.id || (resp.activity && resp.activity.id) || '').trim();
    rvtoUpdateOfferField_(offerId, 'Status',               RVTO_APP.OFFER_STATUSES.COMMITTED);
    rvtoUpdateOfferField_(offerId, 'Assembled Status',     'COMMITTED');
    rvtoUpdateOfferField_(offerId, 'Assembled Request ID', requestId);
    rvtoUpdateOfferField_(offerId, 'Assembled Response',   JSON.stringify(resp).substring(0, 500));
    rvtoUpdateOfferField_(offerId, 'Notes',                'Committed to Assembled. Activity ID: ' + requestId);
    rvtoAudit_('ASSEMBLED_COMMIT', offerId, 'Committed. Activity ID: ' + requestId, 'OK');

    // v1.7.9: Notify manager via Slack DM
    const tz2         = config.TIMEZONE || 'America/Chicago';
    const dateDisp    = rvtoFormatDateDisplay_(date, tz2);
    const timeDisp    = rvtoFormatTimeRange_(date, start, end, tz2);
    const dmMsg       = '\u2705 VTO Committed \u2014 ' + email + ', ' + dateDisp + ', ' + timeDisp;
    rvtoNotifyManagerOnCommit_(email, email, dmMsg, config);

    return { ok: true };
  } catch (err) {
    rvtoUpdateOfferField_(offerId, 'Status',           RVTO_APP.OFFER_STATUSES.COMMIT_FAILED);
    rvtoUpdateOfferField_(offerId, 'Assembled Status', 'FAILED');
    rvtoUpdateOfferField_(offerId, 'Notes',            String(err));
    rvtoAudit_('ASSEMBLED_COMMIT', offerId, 'POST failed: ' + String(err), 'FAILED');
    return { ok: false };
  }
}

/*************************************************************
 * AGENT ID RESOLVER
 *************************************************************/
function rvtoResolveAgentId_(email) {
  if (!email) return '';
  const apiKey  = rvtoGetApiKey_();
  const headers = rvtoAuthHeaders_(apiKey);
  const target  = email.trim().toLowerCase();
  const LIMIT   = 100;
  var offset    = 0;

  while (true) {
    var resp;
    try {
      resp = rvtoAssembledGet_(headers, '/people', { limit: LIMIT, offset: offset });
    } catch (err) {
      rvtoAudit_('RESOLVE_AGENT_ID', '', 'Error fetching /people (offset ' + offset + '): ' + err, 'FAILED');
      return '';
    }
    const people = resp.people || {};
    const total  = resp.total  || 0;
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

/*************************************************************
 * VTO ACTIVITY TYPE ID RESOLVER
 *************************************************************/
function rvtoResolveVtoTypeId_(config) {
  const direct = (PropertiesService.getScriptProperties().getProperty('ASSEMBLED_VTO_ACTIVITY_ID') || '').trim();
  if (direct) return direct;

  const apiKey  = rvtoGetApiKey_();
  const desired = (config.VTO_ACTIVITY_NAME || 'VTO').trim().toUpperCase();

  try {
    const res  = rvtoAssembledGet_(rvtoAuthHeaders_(apiKey), '/activity_types', {});
    const raw  = res.activity_types || {};
    const list = Array.isArray(raw)
      ? raw
      : Object.keys(raw).map(function(k) { const a = raw[k]; if (!a.id) a.id = k; return a; });

    for (var i = 0; i < list.length; i++) {
      if ((list[i].name || '').trim().toUpperCase() === desired) return String(list[i].id || '').trim();
    }
    rvtoAudit_('RESOLVE_VTO_TYPE', '', 'No activity type matched "' + desired + '". Set ASSEMBLED_VTO_ACTIVITY_ID in Script Properties.', 'WARN');
  } catch (err) {
    rvtoAudit_('RESOLVE_VTO_TYPE', '', String(err), 'FAILED');
  }
  return '';
}

/*************************************************************
 * OFFER EXPIRY
 *************************************************************/
function expireRvtoOffers_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return 0;

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return 0;

  const headers = values[0];
  const now     = new Date();
  var count     = 0;

  for (var i = 1; i < values.length; i++) {
    const obj    = rvtoRowToObj_(headers, values[i]);
    const status = String(obj['Status'] || '').trim().toUpperCase();

    if ([RVTO_APP.OFFER_STATUSES.ACCEPTED, RVTO_APP.OFFER_STATUSES.COMMITTED,
         RVTO_APP.OFFER_STATUSES.DECLINED, RVTO_APP.OFFER_STATUSES.EXPIRED,
         RVTO_APP.OFFER_STATUSES.COMMIT_FAILED].indexOf(status) !== -1) continue;

    const sentAt       = obj['Sent At']    ? new Date(obj['Sent At'])    : null;
    const expiresAtRaw = obj['Expires At'] ? new Date(obj['Expires At']) : null;
    const holdHours    = Number(obj['Hold Hours'] || 1);
    if (!sentAt || isNaN(sentAt.getTime())) continue;

    const effectiveExpiry = (expiresAtRaw && !isNaN(expiresAtRaw.getTime()))
      ? expiresAtRaw : rvtoAddHours_(sentAt, holdHours);

    if (now >= effectiveExpiry) {
      const idx_status = headers.indexOf('Status');
      const idx_notes  = headers.indexOf('Notes');
      if (idx_status !== -1) sheet.getRange(i + 1, idx_status + 1).setValue(RVTO_APP.OFFER_STATUSES.EXPIRED);
      if (idx_notes  !== -1) sheet.getRange(i + 1, idx_notes  + 1).setValue('Expired after hold window.');
      rvtoAudit_('EXPIRE_OFFER', String(obj['Offer ID'] || ''), 'Expired', 'OK');
      count++;
    }
  }
  return count;
}

/*************************************************************
 * CONTEXT BUILDER
 *************************************************************/
function rvtoBuildContext_(config, rules) {
  const ctx = {
    config:   config,
    rules:    rules,
    now:      new Date(),
    timezone: config.TIMEZONE || 'America/Chicago'
  };

  const noFlySheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.NO_FLY);
  ctx.noFlySet = new Set();
  if (noFlySheet) {
    const vals = noFlySheet.getDataRange().getValues();
    vals.slice(1).forEach(function(row) {
      const name = String(row[0] || '').trim();
      if (name && name.toLowerCase() !== 'name') ctx.noFlySet.add(rvtoNormalizeName_(name));
    });
  }

  ctx.offersByEmail         = rvtoBuildOfferHistory_(ctx.now, 24);
  ctx.offerObjects          = rvtoGetAllOfferObjects_();
  ctx.shadowExclusionEmails = rvtoGetShadowExclusionEmails_();

  if (ctx.shadowExclusionEmails.size) {
    rvtoAudit_('SHADOW_EXCLUSION', '', ctx.shadowExclusionEmails.size + ' rep(s) shadow-excluded from schedules and eligibility: ' + Array.from(ctx.shadowExclusionEmails).join(', '), 'INFO');
  }

  ctx.rampRows = rvtoGetRampInclusionRows_(ctx.timezone);
  if (ctx.rampRows.length) {
    rvtoAudit_('RAMP_INCLUSION', '', ctx.rampRows.length + ' active ramp row(s) — effective net boosted per enabled queue (intraday + week-block)', 'INFO');
  }

  ctx.pgcByNormalizedName = rvtoLoadPgcMap_(config);

  return ctx;
}

function rvtoGetAllOfferObjects_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(function(row) { return row.some(function(c) { return c !== ''; }); })
    .map(function(row) { return rvtoRowToObj_(headers, row); });
}

function rvtoGetShadowExclusionEmails_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.SHADOW_EXCLUSION);
  const out   = new Set();
  if (!sheet || sheet.getLastRow() <= 1) return out;

  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
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

/**
 * Ramp_Inclusion tab: model new-hire capacity not yet in Assembled. Active rows increase
 * each enabled queue's interpreted net by (overlap head-fraction in the interval / N queues).
 *
 * Columns: Notes | Active | Headcount | Start_Date | End_Date | Shift_Start | Shift_End | Weekdays
 * - Active: TRUE (default) to apply; FALSE skips the row.
 * - Start_Date / End_Date: yyyy-MM-dd or Sheets Date; End blank = open-ended.
 * - Shift_Start / Shift_End: HH:mm (default 09:00–17:00).
 * - Weekdays: blank = Mon–Fri; or 7 chars 1111100 = Mon..Sun (1 = working).
 */
function rvtoGetRampInclusionRows_(tz) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.RAMP_INCLUSION);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const tzone   = tz || 'America/Chicago';
  const out     = [];

  for (var r = 1; r < values.length; r++) {
    const obj = rvtoRowToObj_(headers, values[r]);
    if (!rvtoConfigBool_(obj['Active'], true)) continue;

    var hc = Number(obj['Headcount'] || 1);
    if (!isFinite(hc) || hc <= 0) continue;

    const startStr = rvtoWkNormDateStr_(obj['Start_Date'], tzone);
    if (!startStr) continue;

    var endStr = rvtoWkNormDateStr_(obj['End_Date'], tzone);
    if (!endStr) endStr = '2099-12-31';

    var ss = String(obj['Shift_Start'] || '09:00').trim();
    var ee = String(obj['Shift_End']   || '17:00').trim();
    if (!/^\d{1,2}:\d{2}$/.test(ss)) ss = '09:00';
    if (!/^\d{1,2}:\d{2}$/.test(ee)) ee = '17:00';

    out.push({
      notes:      String(obj['Notes'] || '').trim(),
      headcount:  hc,
      startStr:   startStr,
      endStr:     endStr,
      shiftStart: ss,
      shiftEnd:   ee,
      weekdays:   String(obj['Weekdays'] || '').trim()
    });
  }
  return out;
}

function rvtoRampDowMonday0_(d, tz) {
  var u = parseInt(Utilities.formatDate(d, tz || 'America/Chicago', 'u'), 10);
  if (isNaN(u) || u < 1 || u > 7) {
    var js = d.getDay();
    return js === 0 ? 6 : js - 1;
  }
  return u - 1;
}

function rvtoRampDayMatches_(d, tz, weekdaysSpec) {
  var w = String(weekdaysSpec || '').trim();
  var dow = rvtoRampDowMonday0_(d, tz);
  if (!w) {
    return dow >= 0 && dow <= 4;
  }
  if (w.length === 7 && /^[01]{7}$/.test(w)) {
    return w.charAt(dow) === '1';
  }
  return dow >= 0 && dow <= 4;
}

function rvtoRampDateStrFor_(d, tz) {
  return Utilities.formatDate(d, tz || 'America/Chicago', 'yyyy-MM-dd');
}

function rvtoRampDateInRange_(dateStr, startStr, endStr) {
  return dateStr >= startStr && dateStr <= endStr;
}

function rvtoRampOverlapHeadFraction_(intervalStart, intervalEnd, row, tz) {
  if (!(intervalStart instanceof Date) || !(intervalEnd instanceof Date)) return 0;
  if (intervalEnd <= intervalStart) return 0;

  var tzone   = tz || 'America/Chicago';
  var dateStr = rvtoRampDateStrFor_(intervalStart, tzone);
  if (!rvtoRampDateInRange_(dateStr, row.startStr, row.endStr)) return 0;
  if (!rvtoRampDayMatches_(intervalStart, tzone, row.weekdays)) return 0;

  var shiftStart = rvtoBuildDateTime_(dateStr, row.shiftStart, tzone);
  var shiftEnd   = rvtoBuildDateTime_(dateStr, row.shiftEnd,   tzone);
  if (!shiftStart || !shiftEnd) return 0;
  if (shiftEnd <= shiftStart) {
    shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  var o0 = Math.max(intervalStart.getTime(), shiftStart.getTime());
  var o1 = Math.min(intervalEnd.getTime(),   shiftEnd.getTime());
  if (o1 <= o0) return 0;

  var ivMs = intervalEnd.getTime() - intervalStart.getTime();
  if (ivMs <= 0) return 0;

  return row.headcount * ((o1 - o0) / ivMs);
}

function rvtoRampTotalHeadFractionInInterval_(intervalStart, intervalEnd, rampRows, tz) {
  if (!rampRows || !rampRows.length) return 0;
  var t = 0;
  for (var i = 0; i < rampRows.length; i++) {
    t += rvtoRampOverlapHeadFraction_(intervalStart, intervalEnd, rampRows[i], tz);
  }
  return t;
}

/**
 * Amount to add to Assembled net for this queue in this interval (ramp overlap split evenly across N enabled queues).
 */
function rvtoRampNetBoostPerQueue_(intervalStart, intervalEnd, ctx, numQueues) {
  var n = Number(numQueues) || 0;
  if (n <= 0) return 0;
  var rows = ctx && ctx.rampRows ? ctx.rampRows : [];
  var tz   = (ctx && ctx.timezone) || 'America/Chicago';
  var total = rvtoRampTotalHeadFractionInInterval_(intervalStart, intervalEnd, rows, tz);
  return total / n;
}

function rvtoPgcAuditTokenForPerson_(pgcMap, person) {
  if (!pgcMap) return 'no_row';
  var na = rvtoNormalizeName_(person.name);
  var ha = Object.prototype.hasOwnProperty.call(pgcMap, na) && pgcMap[na] !== null && pgcMap[na] !== undefined;
  if (!ha) return 'no_row';
  var v = Number(pgcMap[na]);
  if (!isFinite(v)) return 'no_row';
  return String(Math.round(v * 100) / 100);
}

function rvtoMaybeAuditPgcOrder_(deficitId, eligible, pgcMap, config) {
  var raw = config && config.PGC_DEBUG_TOP_N;
  var topN = (raw === undefined || raw === null || String(raw).trim() === '')
    ? 8
    : Number(raw);
  if (!isFinite(topN) || topN <= 0) return;

  var keys = pgcMap && Object.keys(pgcMap) || [];
  if (!keys.length) {
    rvtoAudit_('PGC_ORDER', deficitId,
      'Eligible: ' + eligible.length + ' | PGC map empty — sort not applied',
      'WARN');
    return;
  }

  var parts = [];
  var slots = Math.min(topN, eligible.length);
  for (var i = 0; i < slots; i++) {
    var pers = eligible[i];
    parts.push('#' + (i + 1) + ' ' + (pers.email || '') + ' PGC=' + rvtoPgcAuditTokenForPerson_(pgcMap, pers));
  }
  if (eligible.length > slots) {
    parts.push('+' + (eligible.length - slots) + ' more (not shown)');
  }
  rvtoAudit_('PGC_ORDER', deficitId, parts.join(' | '), 'INFO');
}

function rvtoParsePgcValue_(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  if (Object.prototype.toString.call(raw) === '[object Date]') return null;
  var n = Number(raw);
  if (isFinite(n)) {
    if (n > 0 && n <= 1) return n * 100;
    return n;
  }
  var s = String(raw).trim().replace(/%/g, '');
  n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function rvtoLoadPgcMap_(config) {
  var map = {};
  var use = config && rvtoConfigBool_(config.USE_PGC_PRIORITY, true);
  if (!use) return map;

  var props = PropertiesService.getScriptProperties();
  var id = String(props.getProperty('PGC_SPREADSHEET_ID') || '').trim();
  if (!id) return map;

  try {
    var ss = SpreadsheetApp.openById(id);
    var sheetName = String(props.getProperty('PGC_SHEET_NAME') || '').trim();
    var sh = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
    if (!sh) {
      rvtoAudit_('PGC_LOAD', '', 'PGC sheet not found: ' + (sheetName || '(first tab)'), 'WARN');
      return map;
    }

    var values = sh.getDataRange().getValues();
    for (var r = 1; r < values.length; r++) {
      var name = String(values[r][1] || '').trim();
      if (!name || name.toLowerCase() === 'name') continue;
      var pgc = rvtoParsePgcValue_(values[r][6]);
      if (pgc === null) continue;
      map[rvtoNormalizeName_(name)] = pgc;
    }
    rvtoAudit_('PGC_LOAD', '', 'Loaded PGC for ' + Object.keys(map).length + ' name(s)', 'OK');
  } catch (err) {
    rvtoAudit_('PGC_LOAD', '', String(err), 'WARN');
  }
  return map;
}

function rvtoSortEligibleByPgc_(eligible, pgcMap) {
  if (!eligible || !eligible.length) return;
  if (!pgcMap || !Object.keys(pgcMap).length) return;

  eligible.sort(function(a, b) {
    var na = rvtoNormalizeName_(a.name);
    var nb = rvtoNormalizeName_(b.name);
    var ha = Object.prototype.hasOwnProperty.call(pgcMap, na) && pgcMap[na] !== null && pgcMap[na] !== undefined;
    var hb = Object.prototype.hasOwnProperty.call(pgcMap, nb) && pgcMap[nb] !== null && pgcMap[nb] !== undefined;
    if (!ha && hb) return -1;
    if (ha && !hb) return 1;
    if (!ha && !hb) return (a.email || '').localeCompare(b.email || '');
    var pa = Number(pgcMap[na]);
    var pb = Number(pgcMap[nb]);
    if (pa !== pb) return pa - pb;
    return (a.email || '').localeCompare(b.email || '');
  });
}

function rvtoBuildOfferHistory_(now, hoursBack) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return {};
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return {};

  const headers   = values[0];
  const cutoff24h = new Date(now.getTime() - (hoursBack * 60 * 60 * 1000));
  const todayKey  = Utilities.formatDate(now, 'America/Chicago', 'yyyy-MM-dd');
  const out       = {};

  // v1.7.8: Rows are in sheet order (oldest first). A COMMITTED row resets the
  // cap counters for that rep — they become immediately re-eligible after a
  // successful Assembled commit regardless of the 24h/daily cap. The next offer
  // they receive increments the counter again and normal rules resume.
  values.slice(1).forEach(function(row) {
    const obj    = rvtoRowToObj_(headers, row);
    const email  = String(obj['Email'] || '').trim().toLowerCase();
    const status = String(obj['Status'] || '').trim().toUpperCase();
    if (!email) return;

    if (status === RVTO_APP.OFFER_STATUSES.SEND_FAILED || status === '') return;

    // Cap-exempt: week-block offers are skipped so they don't block normal VTO
    const notes = String(obj['Notes'] || '');
    if (notes.indexOf('WEEK_VTO') !== -1) return;

    // v1.7.8: A COMMITTED row resets the cap — rep is hot again after acceptance.
    if (status === RVTO_APP.OFFER_STATUSES.COMMITTED) {
      if (out[email]) {
        out[email].sentToday   = 0;
        out[email].sentLast24h = 0;
        out[email].lastSentAt  = null; // reset min-gap on commit so hot rep can receive again immediately
      }
      return;
    }

    const sentAt = obj['Sent At'] ? new Date(obj['Sent At']) : null;

    const offerDate = (obj['Date'] instanceof Date)
      ? Utilities.formatDate(obj['Date'], 'America/Chicago', 'yyyy-MM-dd')
      : String(obj['Date'] || '').trim();

    if (!out[email]) out[email] = { sentToday: 0, sentLast24h: 0, lastSentAt: null };

    // v1.8.0: A DECLINED row pins the counter at cap maximum so it cannot be
    // overridden by a subsequent COMMITTED reset in the same sheet scan.
    // This guarantees a hard 24h freeze after any decline regardless of
    // what other offer rows exist for that rep.
    if (status === RVTO_APP.OFFER_STATUSES.DECLINED) {
      out[email].sentToday   = 999;
      out[email].sentLast24h = 999;
      out[email].lastSentAt  = sentAt || out[email].lastSentAt;
      return;
    }

    if (offerDate === todayKey) out[email].sentToday++;

    if (sentAt && !isNaN(sentAt.getTime()) && sentAt >= cutoff24h) {
      out[email].sentLast24h++;
      // v1.8.1: track the most recent sentAt for the min-gap check
      if (!out[email].lastSentAt || sentAt > out[email].lastSentAt) {
        out[email].lastSentAt = sentAt;
      }
    } else if (status === RVTO_APP.OFFER_STATUSES.PENDING_SEND && offerDate === todayKey) {
      out[email].sentLast24h++;
    }
  });

  return out;
}

/*************************************************************
 * CONFIG / RULES READER
 *************************************************************/
function rvtoGetConfig_() {
  const sheet  = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.CONFIG);
  const values = sheet ? sheet.getDataRange().getValues() : [];
  const out    = {};
  values.slice(1).forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (key) out[key] = row[1];
  });
  return out;
}

function rvtoGetRules_(config) {
  // v1.9.5: optional per-queue MIN_SURPLUS overrides (surplus DETECTION threshold)
  // v1.9.7: optional per-queue HEADROOM_FLOOR overrides (post-VTO SAFETY floor)
  var minSurplusByQueue    = {};
  var headroomFloorByQueue = {};
  RVTO_APP.QUEUE_DEFS.forEach(function(qd) {
    var msKey = 'MIN_SURPLUS_' + qd.key;
    var msRaw = config[msKey];
    if (msRaw !== undefined && msRaw !== null && String(msRaw).trim() !== '') {
      var ms = Number(msRaw);
      if (isFinite(ms)) minSurplusByQueue[qd.name] = ms;
    }
    var hfKey = 'HEADROOM_FLOOR_' + qd.key;
    var hfRaw = config[hfKey];
    if (hfRaw !== undefined && hfRaw !== null && String(hfRaw).trim() !== '') {
      var hf = Number(hfRaw);
      if (isFinite(hf)) headroomFloorByQueue[qd.name] = hf;
    }
  });

  // HEADROOM_FLOOR: explicit numeric (including 0) takes precedence; missing/blank → default 0
  var headroomFloorRaw = config.HEADROOM_FLOOR;
  var headroomFloor;
  if (headroomFloorRaw === undefined || headroomFloorRaw === null || String(headroomFloorRaw).trim() === '') {
    headroomFloor = 0;
  } else {
    var hfn = Number(headroomFloorRaw);
    headroomFloor = isFinite(hfn) ? hfn : 0;
  }

  return {
    MIN_SURPLUS:                   Number(config.MIN_SURPLUS                   || 1),
    minSurplusByQueue:             minSurplusByQueue,
    HEADROOM_FLOOR:                headroomFloor,
    headroomFloorByQueue:          headroomFloorByQueue,
    MIN_BLOCK_MINUTES:             Number(config.MIN_BLOCK_MINUTES             || 120),
    OFFER_HOLD_HOURS:              Number(config.OFFER_HOLD_HOURS              || 1),
    LOOKAHEAD_DAYS:                Number(config.LOOKAHEAD_DAYS                || 3),
    MAX_OFFERS_PER_PERSON_PER_DAY: Number(config.MAX_OFFERS_PER_PERSON_PER_DAY || 1),
    MAX_EMAILS_PER_24H:            Number(config.MAX_EMAILS_PER_24H            || 1),
    MIN_SCHEDULE_OVERLAP_HOURS:    Number(config.MIN_SCHEDULE_OVERLAP_HOURS    || 2),
    OFFER_MIN_GAP_HOURS:           Number(config.OFFER_MIN_GAP_HOURS           || 1)
  };
}

/** MIN_SURPLUS for this queue: Config MIN_SURPLUS_<QUEUE_KEY> if set, else global MIN_SURPLUS. */
function rvtoEffectiveMinSurplusForQueue_(queueName, rules) {
  var base = rules && Number(rules.MIN_SURPLUS);
  if (!isFinite(base)) base = 1;
  var byQ = rules && rules.minSurplusByQueue;
  if (byQ && Object.prototype.hasOwnProperty.call(byQ, queueName)) {
    var n = Number(byQ[queueName]);
    if (isFinite(n)) return n;
  }
  return base;
}

/**
 * v1.9.7: HEADROOM_FLOOR for this queue: Config HEADROOM_FLOOR_<QUEUE_KEY> if set,
 * else global HEADROOM_FLOOR (default 0). Independent from MIN_SURPLUS so the
 * surplus detection threshold and the post-VTO safety floor can be tuned
 * separately.
 */
function rvtoEffectiveHeadroomFloorForQueue_(queueName, rules) {
  var byQ = rules && rules.headroomFloorByQueue;
  if (byQ && Object.prototype.hasOwnProperty.call(byQ, queueName)) {
    var n = Number(byQ[queueName]);
    if (isFinite(n)) return n;
  }
  var base = rules && Number(rules.HEADROOM_FLOOR);
  return isFinite(base) ? base : 0;
}

function rvtoConfigBool_(value, defaultVal) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultVal;
  }
  return String(value).trim().toUpperCase() === 'TRUE';
}

function rvtoHeadroomMapKey_(start, end) {
  return String(start.getTime()) + '_' + String(end.getTime());
}

/*************************************************************
 * SITE NAME RESOLVER
 *************************************************************/
function rvtoResolveSiteName_(config, siteKey) {
  if (siteKey === RVTO_APP.SITES.CONSUMER_SALES) {
    return String(
      config.ASSEMBLED_SITE ||
      PropertiesService.getScriptProperties().getProperty('ASSEMBLED_SITE') ||
      RVTO_APP.SITE_NAMES.consumer_sales
    ).trim();
  }
  if (siteKey === RVTO_APP.SITES.SUPPORT) {
    return String(
      config.ASSEMBLED_SITE_SUPPORT ||
      PropertiesService.getScriptProperties().getProperty('ASSEMBLED_SITE_SUPPORT') ||
      RVTO_APP.SITE_NAMES.support
    ).trim();
  }
  throw new Error('Unknown site key: ' + siteKey);
}

/*************************************************************
 * ASSEMBLED API HELPERS
 *************************************************************/
function rvtoGetApiKey_() {
  const key = (PropertiesService.getScriptProperties().getProperty('ASSEMBLED_API_KEY') || '').trim();
  if (!key) throw new Error('Script Property "ASSEMBLED_API_KEY" is not set.');
  return key;
}

function rvtoGetWebAppUrl_(config) {
  return (
    PropertiesService.getScriptProperties().getProperty('RVTO_WEB_APP_URL') ||
    (config && config.RVTO_WEB_APP_URL) || ''
  ).trim();
}

function rvtoAuthHeaders_(apiKey) {
  return {
    'Authorization': 'Basic ' + Utilities.base64Encode(apiKey + ':'),
    'Content-Type':  'application/json'
  };
}

function rvtoAssembledGet_(headers, path, params) {
  const url  = rvtoBuildUrl_(RVTO_APP.BASE_URL + path, params);
  const resp = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code < 200 || code >= 300) throw new Error('Assembled GET ' + path + ' failed (' + code + '): ' + text);
  return text ? JSON.parse(text) : {};
}

function rvtoAssembledPost_(headers, path, payload) {
  const url  = RVTO_APP.BASE_URL + path;
  const resp = UrlFetchApp.fetch(url, {
    method: 'post', headers: headers,
    payload: JSON.stringify(payload || {}), muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code < 200 || code >= 300) throw new Error('Assembled POST ' + path + ' failed (' + code + '): ' + text);
  return text ? JSON.parse(text) : {};
}

function rvtoResolveSiteId_(headers, siteName) {
  const res    = rvtoAssembledGet_(headers, '/sites', {});
  const sites  = res.sites || {};
  const target = rvtoNormalizeToken_(siteName);
  for (const id in sites) {
    if (rvtoNormalizeToken_(sites[id].name) === target) return sites[id].id || id;
  }
  throw new Error('Site not found: ' + siteName);
}

function rvtoResolveQueueIds_(headers, queueNames) {
  const res    = rvtoAssembledGet_(headers, '/queues', {});
  const queues = res.queues || {};
  const desired = new Map(queueNames.map(function(n) { return [rvtoNormalizeToken_(n), n]; }));
  const out    = {};
  for (const id in queues) {
    const key = rvtoNormalizeToken_(queues[id].name);
    if (desired.has(key)) out[queues[id].name] = queues[id].id || id;
  }
  const missing = queueNames.filter(function(n) { return !out[n]; });
  if (missing.length) throw new Error('Queues not found: ' + missing.join(', '));
  return out;
}

function rvtoBuildUrl_(base, params) {
  const keys = Object.keys(params || {}).filter(function(k) {
    return params[k] !== undefined && params[k] !== null && params[k] !== '';
  });
  if (!keys.length) return base;
  return base + '?' + keys.map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]));
  }).join('&');
}

/*************************************************************
 * OFFER SHEET HELPERS
 *************************************************************/
function rvtoAppendOfferRow_(o) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return;
  sheet.appendRow([
    o.offerId, o.deficitId,
    String(o.date), String(o.start), String(o.end),
    o.name, o.email, o.agentId, o.queue, o.manager,
    o.sentAt, o.expiresAt, o.holdHours, o.status,
    '', '', o.token, o.acceptUrl, o.declineUrl,
    '', '', '', ''
  ]);
}

function rvtoUpdateOfferField_(offerId, columnName, value) {
  const sheet  = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.OFFERS);
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
 * MANAGER SLACK NOTIFICATIONS (v1.7.9)
 *************************************************************/

/**
 * Reads the Manager_Aliases tab into a name -> slack_alias map.
 * Tab has two columns: Name | Slack Alias.
 * Returns {} if tab is missing or empty.
 */
function rvtoGetManagerAliasMap_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.MANAGER_ALIASES);
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

/**
 * Looks up the manager for a rep email from the Roster tab.
 * Returns the manager name string or '' if not found.
 */
function rvtoGetManagerForRep_(repEmail) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.ROSTER);
  if (!sheet) return '';
  const values  = sheet.getDataRange().getValues();
  if (values.length <= 1) return '';
  const headers  = values[0];
  const emailCol = headers.findIndex(function(h) { return String(h).trim().toLowerCase() === 'email'; });
  const mgrCol   = headers.findIndex(function(h) { return String(h).trim().toLowerCase() === 'manager'; });
  const nameCol  = headers.findIndex(function(h) { return String(h).trim().toLowerCase() === 'name'; });
  if (emailCol === -1 || mgrCol === -1) return '';

  const target = repEmail.trim().toLowerCase();
  for (var i = 1; i < values.length; i++) {
    const rowEmail = String(values[i][emailCol] || '').trim().toLowerCase();
    // Match by email if available, fall back to derived email from name
    var match = (rowEmail === target);
    if (!match && nameCol !== -1) {
      const derived = rvtoDeriveEmail_(String(values[i][nameCol] || '').trim());
      match = (derived === target);
    }
    if (match) return String(values[i][mgrCol] || '').trim();
  }
  return '';
}

/**
 * Resolves a Slack user ID from a varsitytutors.com alias.
 * Mirrors the adherence bot pattern exactly.
 */
function rvtoGetSlackUserId_(alias) {
  const email = alias.indexOf('@') !== -1 ? alias : (alias + '@varsitytutors.com');
  try {
    const token = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
    if (!token) {
      rvtoAudit_('SLACK_DM', '', 'SLACK_BOT_TOKEN not set in Script Properties', 'WARN');
      return null;
    }
    const url  = 'https://slack.com/api/users.lookupByEmail?email=' + encodeURIComponent(email);
    const resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    const data = JSON.parse(resp.getContentText());
    if (data.ok) return data.user.id;
    rvtoAudit_('SLACK_DM', '', 'Slack lookup failed for ' + email + ': ' + data.error, 'WARN');
  } catch (err) {
    rvtoAudit_('SLACK_DM', '', 'Slack lookup exception for ' + email + ': ' + String(err), 'WARN');
  }
  return null;
}

/**
 * Sends a Slack DM to a user by their Slack user ID.
 */
function rvtoSendSlackDm_(userId, message) {
  try {
    const token   = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
    const openRes = UrlFetchApp.fetch('https://slack.com/api/conversations.open', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ users: userId }),
      muteHttpExceptions: true
    });
    const openData = JSON.parse(openRes.getContentText());
    if (!openData.ok) {
      rvtoAudit_('SLACK_DM', '', 'Failed to open DM channel: ' + openData.error, 'WARN');
      return;
    }
    const msgRes = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ channel: openData.channel.id, text: message }),
      muteHttpExceptions: true
    });
    const msgData = JSON.parse(msgRes.getContentText());
    if (!msgData.ok) rvtoAudit_('SLACK_DM', '', 'Failed to send DM: ' + msgData.error, 'WARN');
  } catch (err) {
    rvtoAudit_('SLACK_DM', '', 'DM send exception: ' + String(err), 'WARN');
  }
}

/**
 * v1.7.9: Notifies a rep's manager via Slack DM when their VTO is committed.
 * Looks up manager from Roster, resolves alias from Manager_Aliases tab,
 * resolves Slack user ID, and sends DM. All failures are silent (audit log
 * only) — never disrupts the commit flow.
 *
 * @param {string} repEmail   - rep's email address
 * @param {string} repName    - rep's display name
 * @param {string} message    - pre-formatted DM body
 * @param {object} config     - bot config object
 */
function rvtoNotifyManagerOnCommit_(repEmail, repName, message, config) {
  try {
    const enabled = rvtoConfigBool_(config && config.MANAGER_VTO_SLACK, true);
    if (!enabled) return;

    const managerName = rvtoGetManagerForRep_(repEmail);
    if (!managerName) {
      rvtoAudit_('SLACK_DM', '', 'No manager found for ' + repEmail + ' — skipping Slack notify', 'INFO');
      return;
    }

    const aliasMap = rvtoGetManagerAliasMap_();
    const alias    = aliasMap[managerName];
    if (!alias) {
      rvtoAudit_('SLACK_DM', '', 'No Slack alias for manager "' + managerName + '" — add to Manager_Aliases tab', 'WARN');
      return;
    }

    const userId = rvtoGetSlackUserId_(alias);
    if (!userId) return; // already audited inside rvtoGetSlackUserId_

    rvtoSendSlackDm_(userId, message);
    rvtoAudit_('SLACK_DM', '', 'Manager notify sent to ' + managerName + ' for ' + repName, 'OK');
  } catch (err) {
    rvtoAudit_('SLACK_DM', '', 'Unhandled exception in rvtoNotifyManagerOnCommit_: ' + String(err), 'WARN');
  }
}

/*************************************************************
 * AUDIT
 *************************************************************/
function rvtoAudit_(event, refId, details, result) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.AUDIT);
  if (!sheet) return;
  sheet.appendRow([new Date(), event, refId, details, result]);
}

/*************************************************************
 * SETUP HELPERS
 *************************************************************/
function rvtoGetOrCreate_(name) {
  const ss  = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

/**
 * v1.7.9: Auto-populates the Manager_Aliases tab from the Roster's Manager
 * column using firstname.lastname derivation. Safe to re-run — only adds
 * names not already present, never overwrites existing aliases.
 */
function rvtoPopulateManagerAliasesFromRoster_(aliasSheet) {
  const rosterSheet = SpreadsheetApp.getActive().getSheetByName(RVTO_APP.SHEETS.ROSTER);
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

  // Read existing names from alias sheet
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
    // Derive alias: firstname.lastname (same pattern as adherence bot)
    const parts = name.trim().split(/\s+/);
    const alias = parts.length >= 2
      ? (parts[0] + '.' + parts[parts.length - 1]).toLowerCase()
      : parts[0].toLowerCase();
    aliasSheet.getRange(startRow + idx, 1).setValue(name);
    aliasSheet.getRange(startRow + idx, 2).setValue(alias);
  });

  SpreadsheetApp.flush();
  rvtoAudit_('SETUP', '', 'Manager_Aliases: added ' + newManagers.length + ' manager(s)', 'OK');
}

function rvtoSetSheetData_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.clearFormats();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function rvtoPreserveSheet_(sheet, fallbackHeaders) {
  if (sheet.getLastRow() > 1) return;
  rvtoSetSheetData_(sheet, fallbackHeaders, []);
}

function rvtoClearSheetBody_(sheet) {
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
}

function rvtoFormatSheets_() {
  const ss = SpreadsheetApp.getActive();
  [RVTO_APP.SHEETS.CONFIG, RVTO_APP.SHEETS.ROSTER, RVTO_APP.SHEETS.NO_FLY,
   RVTO_APP.SHEETS.SHADOW_EXCLUSION, RVTO_APP.SHEETS.RAMP_INCLUSION, RVTO_APP.SHEETS.MANAGER_ALIASES,
   RVTO_APP.SHEETS.OFFERS, RVTO_APP.SHEETS.AUDIT, RVTO_APP.SHEETS.CHANGELOG
  ].forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastColumn() === 0) return;
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn())
      .setFontWeight('bold')
      .setBackground('#1F4E78')
      .setFontColor('#ffffff');
    sheet.autoResizeColumns(1, sheet.getLastColumn());
  });
}

/*************************************************************
 * GENERAL UTILITIES
 *************************************************************/
function rvtoRowToObj_(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  return obj;
}

function rvtoBuildId_(prefix) {
  return prefix + '_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100000);
}

function rvtoCreateToken_(offerId, email) {
  const raw    = offerId + '|' + email + '|' + new Date().getTime() + '|' + Math.random();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digest.map(function(b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function rvtoAddHours_(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function rvtoNum_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function rvtoIsNum_(value) {
  return value !== null && value !== undefined && value !== '' && isFinite(Number(value));
}

function rvtoNormalizeName_(name) {
  return String(name || '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
}

function rvtoNormalizeToken_(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

function rvtoBuildDateTime_(dateStr, timeStr, tz) {
  if (!dateStr || !timeStr) return null;
  const iso = dateStr.trim() + 'T' + timeStr.trim() + ':00';
  const d   = Utilities.parseDate(iso, tz, "yyyy-MM-dd'T'HH:mm:ss");
  return (!d || isNaN(d.getTime())) ? null : d;
}

function rvtoFormatDateDisplay_(dateStr, tz) {
  const d = rvtoBuildDateTime_(dateStr, '12:00', tz);
  return d ? Utilities.formatDate(d, tz, 'EEE, MMM d') : dateStr;
}

function rvtoFormatTimeRange_(dateStr, start, end, tz) {
  const s = rvtoBuildDateTime_(dateStr, start, tz);
  const e = rvtoBuildDateTime_(dateStr, end,   tz);
  if (!s || !e) return start + ' - ' + end;
  return Utilities.formatDate(s, tz, 'h:mm a') + ' - ' + Utilities.formatDate(e, tz, 'h:mm a') + ' CT';
}

function rvtoEscHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rvtoHtmlToPlain_(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim();
}
