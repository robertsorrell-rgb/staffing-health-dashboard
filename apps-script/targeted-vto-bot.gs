/*************************************************************
 * TARGETED VTO BOT v1.11.3
 * Mirrors the VTO engine pattern exactly:
 *   1. Poll Assembled net staffing
 *   2. Find surplus windows (net >= threshold) — VTO opportunity
 *   3. Match eligible reps (right queue + scheduled + not on no-fly)
 *   4. Send offer via email and/or Slack DM (Accept / Decline links)
 *   5. doGet handles response -> writes VTO activity to Assembled
 *
 * CHANGELOG v1.11.3
 *   - FIX: Week/bundle headroom pre-deducted active WEEK_VTO offers on every surplus
 *     interval in the map, even when the offer was for a different calendar day (e.g.
 *     SENT bundle rows for 6/16–6/18 drained 6/19 headroom for reps still scheduled
 *     that day). rvtoBuildHeadroomMap_ now uses rvtoWeekBlockOfferDayKeys_() so each
 *     outstanding offer only reduces net on the day(s) it actually covers. Symptom:
 *     large queues (College) showed Assembled surplus but zero bundle sends after a
 *     multi-day PICK_DATES campaign.
 *   - College queue workGroupPattern adds Col-STEM and College and Grad aliases.
 *   - Bundle runs log WEEK_BLOCK_BUNDLE_QUEUE_SUMMARY when a queue has eligible reps
 *     but sends zero bundles (points to Audit headroom/eligibility rows).
 *
 * CHANGELOG v1.11.2
 *   - FIX: Accept/Decline web app ("Offer not found") — all sheet reads/writes now use
 *     rvtoGetSpreadsheet_() (SpreadsheetApp.openById via Script Property RVTO_SPREADSHEET_ID)
 *     instead of SpreadsheetApp.getActive(), which is unreliable in headless doGet runs.
 *     setupRvtoWorkbook() auto-sets RVTO_SPREADSHEET_ID when run from the bound workbook.
 *
 * CHANGELOG v1.11.0
 *   - NEW: Rep-facing Slack VTO offers. Config VTO_OFFER_CHANNEL: EMAIL (default),
 *     SLACK, or BOTH. Slack DMs use the same web-app Accept/Decline URLs as email,
 *     with mrkdwn links ("I'll take it!" / "No thanks"). Requires SLACK_BOT_TOKEN.
 *     VTO_SLACK_FALLBACK_EMAIL (default TRUE): when channel is SLACK and lookup/DM
 *     fails, fall back to Gmail. COPY_ONLY preview sends Slack preview to the operator
 *     address (users.lookupByEmail) without DMing the rep. Applies to intraday,
 *     week-block, and bundle sends via rvtoDeliver*Offer_ helpers.
 *
 * CHANGELOG v1.10.10
 *   - NEW: Config INDIVIDUAL_DAY_VTO_ENABLED + INDIVIDUAL_DAY_VTO_TARGET_DATE (yyyy-MM-dd).
 *     When TRUE, the manual menu run targets that single calendar day: Assembled schedule
 *     and surplus pull span only that day (same engine as legacy WEEK_BLOCK). You can leave
 *     WEEK_VTO_ENABLED FALSE and use only these two rows for a one-day campaign; if both
 *     are on, individual-day settings take precedence over WEEK_VTO_CAMPAIGN_MODE / dates.
 *
 * CHANGELOG v1.10.9
 *   - PGC: when PGC_SPREADSHEET_ID points at a different file and that load yields 0 usable
 *     rows, rvtoLoadPgcMap_ merges from the bound workbook's "PGC" tab (same as operators
 *     who keep IMPORTRANGE there). Audit src tag active_workbook_merged. Clear external ID
 *     if you want only the bound sheet.
 *
 * CHANGELOG v1.10.8
 *   - PGC: rvtoLoadPgcMap_ retries the "PGC" tab when the first chosen sheet yields 0
 *     usable name/value rows (e.g. PGC_SHEET_NAME=Data empty but PGC has IMPORTRANGE).
 *     If the map is still empty while USE_PGC_PRIORITY or PGC_OFFER_CEILING expects data,
 *     PGC_LOAD is WARN with guidance (ceiling/sort have no effect until rows load).
 *
 * CHANGELOG v1.10.7
 *   - NEW: Config WEEK_VTO_MAX_SENDS_PER_QUEUE (0/blank = unlimited). Caps how many
 *     week-block or bundle emails a single queue may send in one menu run, after
 *     eligibility/headroom/caps — stops “everyone in ELD” when many reps qualify.
 *
 * CHANGELOG v1.10.6
 *   - PGC: when Script Property PGC_SPREADSHEET_ID is blank, rvtoLoadPgcMap_ now uses
 *     the active (bound) spreadsheet. When PGC_SHEET_NAME is also blank and the file
 *     is that active workbook, the "PGC" tab is used if present (else first tab).
 *     External Looker exports still set PGC_SPREADSHEET_ID explicitly; optional PGC_SHEET_NAME.
 *
 * CHANGELOG v1.10.5
 *   - NEW: Config RAMP_NET_BOOST_ENABLED (default TRUE). When FALSE, Ramp_Inclusion
 *     does not add FTE to Assembled net for surplus detection (intraday + week/bundle),
 *     so surplus windows align with raw forecasted_vs_actuals / Staffing timeline.
 *     When TRUE, behavior unchanged: net = API net + per-queue ramp share.
 *
 * CHANGELOG v1.10.4
 *   - PGC sheet layout: default columns are A = rep name, B = pGC (Google % format).
 *     Legacy Looker export (name col B, PGC col G): set Script Properties
 *     PGC_NAME_COLUMN=2 and PGC_VALUE_COLUMN=7.
 *
 * CHANGELOG v1.10.3
 *   - NEW: PGC_OFFER_CEILING — optional max PGC (same scale as Looker PGC sheet)
 *     for VTO eligibility. Reps with a numeric PGC row strictly above the ceiling
 *     are excluded from intraday and week/bundle eligibility; reps with no PGC row
 *     still qualify. rvtoLoadPgcMap_ runs when ceiling is set even if
 *     USE_PGC_PRIORITY is FALSE so the filter has data.
 *
 * CHANGELOG v1.10.2
 *   - Config tab trimmed: QUEUE_DEFS now Consumer Sales queues only (Support
 *     site queues removed for this deployment). Dropped unused PAGE_LIMIT row
 *     and ASSEMBLED_SITE_SUPPORT (no Support queues in code). Setup Workbook
 *     Notes column rewritten in plain language for operators.
 *
 * CHANGELOG v1.10.1
 *   - NEW: Offer preview for operators — Config VTO_OFFER_PREVIEW_EMAIL plus
 *     VTO_OFFER_PREVIEW_MODE (BCC or COPY_ONLY). Every outbound offer email
 *     (intraday day-of, week-block full range, bundle multi-day) uses the same
 *     helper: BCC sends the real rep email with you on BCC; COPY_ONLY sends
 *     only to the preview address with a yellow banner and subject tag so you
 *     see the exact HTML/links without emailing the rep (Accept/Decline still
 *     bind to the rep&rsquo;s row). Blank preview email disables the feature.
 *
 * CHANGELOG v1.10.0
 *   - NEW: Week VTO "bundle" campaign mode — one email listing multiple
 *     optional VTO days, each with its own Accept / Decline links (separate
 *     Offer rows + tokens). Config WEEK_VTO_CAMPAIGN_MODE: WEEK_BLOCK
 *     (legacy single full-range offer), PICK_DATES (comma list in
 *     WEEK_VTO_PICK_DATES), or DOW_IN_RANGE (WEEK_VTO_START_DATE /
 *     WEEK_VTO_END_DATE + WEEK_VTO_TARGET_DOW 1=Mon..7=Sun). Reuses surplus
 *     polling, eligibility, headroom, per-day dedup, and week-block commit.
 *     Bundle sends count once toward MAX_OFFERS_PER_PERSON_PER_DAY,
 *     MAX_EMAILS_PER_24H, and OFFER_MIN_GAP_HOURS (by Sent At day in
 *     America/Chicago). Per-day DECLINED does not trigger the hard 24h
 *     decline freeze (v1.8.0) so other days in the same bundle remain usable.
 *
 * CHANGELOG v1.9.9
 *   - FIX: v1.9.8's cross-run week-block dedup missed all EXPIRED prior
 *     offers because rvtoHasPriorWeekBlockOffer_() identified week-block
 *     rows by looking for "WEEK_VTO" in the Notes column — but
 *     expireRvtoOffers_() overwrites Notes with "Expired after hold window."
 *     when an offer expires, erasing the tag. Result: a fresh campaign for
 *     2026-05-24 to 2026-05-30 re-offered the same week to Matthew McCarthy,
 *     Tonia Turner, and David Iradji whose prior 5/7 offers had all
 *     EXPIRED and lost their WEEK_VTO tag in Notes.
 *
 *     Two changes:
 *
 *     1. rvtoHasPriorWeekBlockOffer_() now identifies week-block rows by
 *        Offer ID prefix (RVTO_APP.WEEK_BLOCK_PREFIX, "RVTO_WK") in addition
 *        to the Notes tag. The Offer ID is immutable and matches what
 *        doGet() already uses to route week-block responses, so dedup is
 *        now robust against Notes clobbering.
 *
 *     2. expireRvtoOffers_() now APPENDS " | Expired after hold window."
 *        to the existing Notes value instead of overwriting it. The
 *        WEEK_VTO tag, Days: list, and Blocks: schedule survive expiry,
 *        so any downstream tooling that reads expired rows (weekly
 *        summary, audits, future operator reviews) keeps working.
 *
 * CHANGELOG v1.9.8
 *   - FIX: Week-block VTO had no cross-run de-dup for prior offers. A rep
 *     who received a week-block offer that subsequently EXPIRED (or SENT
 *     with no response, DECLINED, ACCEPTED, COMMITTED) would still be
 *     re-offered the same week on a later run because rvtoBuildOfferHistory_
 *     explicitly skips WEEK_VTO rows from the cap tracker, and
 *     weekBlockSentThisRun only de-dups within a single execution.
 *     Running back-to-back campaigns for overlapping weeks therefore
 *     duplicated offers to the same reps.
 *
 *     New helper rvtoHasPriorWeekBlockOffer_() scans ctx.offerObjects for
 *     any prior WEEK_VTO row for the rep whose date range overlaps the
 *     new target range. Skips the rep when found, with a
 *     WEEK_BLOCK_DUPLICATE_SKIP audit row that logs the prior offer ID,
 *     prior date range, and prior status so operators can see why the rep
 *     was filtered. SEND_FAILED and blank-status rows are ignored (those
 *     represent failed deliveries — the rep never actually got the offer).
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
 *     (Script Properties only: PGC_SPREADSHEET_ID; optional PGC_SHEET_NAME;
 *     optional PGC_NAME_COLUMN / PGC_VALUE_COLUMN as 1-based column numbers,
 *     default 1 and 2 = columns A and B). Among eligible reps, those
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
 *        RVTO_SPREADSHEET_ID (auto-set when you run Setup Workbook from this file; required for web app)
 *        ASSEMBLED_VTO_ACTIVITY_ID
 *        PGC_SPREADSHEET_ID (optional if PGC tab is in this workbook — then omit;
 *          otherwise external Looker sheet id). PGC_SHEET_NAME (optional; default
 *          for this workbook is tab "PGC"). PGC_NAME_COLUMN / PGC_VALUE_COLUMN (optional 1-based; default 1 and 2;
 *          use 2 and 7 for legacy Looker B+G layout)
 *   3. Populate the Roster sheet
 *   4. Deploy as web app (execute as: me, anyone can access)
 *   5. Set a time-based trigger on runReverseVto() (e.g. every 10 min)
 *************************************************************/

/*************************************************************
 * CONSTANTS
 *************************************************************/
const RVTO_APP = {
  VERSION: 'V1.11.3',
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
    // Consumer Sales only for this deployment — add Support entries here if needed.
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
      workGroupPattern: 'STEM College Test Group|Graduate Test Prep|Col-STEM|College and Grad',
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

  WEEK_BLOCK_PREFIX: 'RVTO_WK',

  /** Shared prefix for multi-day bundle campaign rows (Notes carry BUNDLE_ID=). */
  BUNDLE_ID_PREFIX: 'RVTO_BND'
};

/*************************************************************
 * MENU
 *************************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Reverse VTO')
    .addItem('Run Now', 'runReverseVto')
    .addItem('Run Week / Single-Day VTO', 'runWeekBlockVto')
    .addSeparator()
    .addItem('Expire Open Offers', 'expireRvtoOffersMenu')
    .addItem('Clear All Offers', 'clearRvtoOffers')
    .addSeparator()
    .addItem('Setup Workbook', 'setupRvtoWorkbook')
    .addItem('Install offer alert trigger', 'rvtoInstallOfferAlertTrigger_')
    .addItem('Sync Changelog', 'syncRvtoChangelogMenu')
    .addItem('Cleanup Legacy Tabs', 'cleanupLegacyTabs')
    .addToUi();
}

/** Menu: append any script changelog versions missing from the Changelog tab. */
function syncRvtoChangelogMenu() {
  var sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.CHANGELOG);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Changelog sheet not found. Run Setup Workbook first.');
    return;
  }
  var result = rvtoSetupChangelog_(sheet);
  SpreadsheetApp.getUi().alert(
    'Changelog sync complete.\n' +
    'Added ' + result.added + ' new version row(s).\n' +
    'Total entries on tab: ' + result.total + '.'
  );
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
        sent = rvtoDeliverIntradayOffer_({
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
        rvtoAudit_('SEND_OFFER', offerId, 'Unhandled exception: ' + String(sendErr), 'FAILED');
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return;
  rvtoClearSheetBody_(sheet);
  SpreadsheetApp.getUi().alert('All offers cleared.');
}

/*************************************************************
 * WEEK-BLOCK VTO — ENTRY POINT (v1.7.0)
 *************************************************************/

/**
 * Manual entry point: Reverse VTO menu -> Run Week / Single-Day VTO.
 * Reads WEEK_VTO_ENABLED and/or INDIVIDUAL_DAY_VTO_ENABLED and dates from Config.
 * INDIVIDUAL_DAY_VTO_ENABLED TRUE + INDIVIDUAL_DAY_VTO_TARGET_DATE: one-day campaign
 * (pulls Assembled for that day only; same offer/commit path as legacy week-block).
 * Otherwise WEEK_VTO_CAMPAIGN_MODE WEEK_BLOCK (default): one offer for full date range.
 * PICK_DATES / DOW_IN_RANGE: bundle mode — one email, per-day links (v1.10.0).
 */
function runWeekBlockVto() {
  const config = rvtoGetConfig_();
  const rules  = rvtoGetRules_(config);
  const ctx    = rvtoBuildContext_(config, rules);

  ctx.enabledQueues = rvtoGetEnabledQueues_(config);

  const weekMenuEnabled = rvtoConfigBool_(config.WEEK_VTO_ENABLED, false);
  const individualEnabled = rvtoConfigBool_(config.INDIVIDUAL_DAY_VTO_ENABLED, false);
  if (!weekMenuEnabled && !individualEnabled) {
    SpreadsheetApp.getUi().alert(
      'Manual campaign is disabled.\n' +
      'Set WEEK_VTO_ENABLED = TRUE for a week or bundle campaign, or\n' +
      'set INDIVIDUAL_DAY_VTO_ENABLED = TRUE with INDIVIDUAL_DAY_VTO_TARGET_DATE (yyyy-MM-dd) for a single day.'
    );
    rvtoAudit_('WEEK_BLOCK_RUN', '', 'Aborted — WEEK_VTO_ENABLED and INDIVIDUAL_DAY_VTO_ENABLED are both FALSE', 'WARN');
    return;
  }

  const dates = rvtoResolveWeekBlockCampaignDates_(config, ctx.timezone);
  if (!dates) {
    var msg = individualEnabled
      ? 'Single-day VTO: set INDIVIDUAL_DAY_VTO_TARGET_DATE to a valid yyyy-MM-dd in the Config tab.'
      : (
        'Invalid or missing week VTO campaign dates.\n' +
        'WEEK_BLOCK: set WEEK_VTO_START_DATE and WEEK_VTO_END_DATE.\n' +
        'PICK_DATES: set WEEK_VTO_CAMPAIGN_MODE=PICK_DATES and WEEK_VTO_PICK_DATES (comma-separated yyyy-MM-dd).\n' +
        'DOW_IN_RANGE: set WEEK_VTO_CAMPAIGN_MODE=DOW_IN_RANGE, WEEK_VTO_START_DATE, WEEK_VTO_END_DATE, and WEEK_VTO_TARGET_DOW (1=Mon .. 7=Sun).'
      );
    SpreadsheetApp.getUi().alert(msg);
    rvtoAudit_('WEEK_BLOCK_RUN', '', 'Aborted — could not resolve campaign dates from Config', 'WARN');
    return;
  }

  if (!ctx.enabledQueues.length) {
    rvtoAudit_('WEEK_BLOCK_RUN', '', 'No queues enabled — check QUEUE_ENABLED_* config rows', 'WARN');
    SpreadsheetApp.getUi().alert('No queues are enabled. Check QUEUE_ENABLED_* rows in Config.');
    return;
  }

  const modeLabel = dates.individualDay
    ? 'SINGLE_DAY'
    : (dates.campaignMode === 'WEEK_BLOCK' ? 'WEEK_BLOCK' : ('BUNDLE ' + dates.campaignMode));
  rvtoAudit_('WEEK_BLOCK_RUN', '',
    'Starting week VTO run [' + modeLabel + ']: ' + dates.startDateStr + ' to ' + dates.endDateStr +
    ' | Days: ' + dates.dateList.length +
    ' | Queues: ' + ctx.enabledQueues.length,
    'INFO');

  const result = dates.campaignMode === 'WEEK_BLOCK'
    ? rvtoRunWeekBlock_(ctx, dates)
    : rvtoRunWeekBlockBundle_(ctx, dates);

  SpreadsheetApp.getUi().alert([
    (dates.individualDay ? 'Single-day VTO run complete' : 'Week VTO run complete') + ' (' + modeLabel + ').',
    'Date span: ' + dates.startDateStr + ' to ' + dates.endDateStr + ' (' + dates.dateList.length + ' calendar day(s))',
    'Queues checked: ' + ctx.enabledQueues.length,
    (dates.campaignMode === 'WEEK_BLOCK' ? 'Offers sent: ' : 'Bundle emails sent: ') + result.sent,
    'Send failures: ' + result.failed,
    'Reps skipped: ' + result.skipped
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
      phoneSchedIdx,
      ctx.timezone
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

    var maxSendsThisQueue = rvtoWeekVtoMaxSendsPerQueue_(config);
    var queueSendCount = 0;
    var stopQueueSends = false;

    eligible.forEach(function(person) {
      if (stopQueueSends) return;
      const email = person.email.trim().toLowerCase();
      if (weekBlockSentThisRun.has(email)) {
        skipped++;
        return;
      }

      // v1.9.8: Cross-run duplicate guard. Skip reps who already received a
      // week-block offer (any status except SEND_FAILED / blank) whose date
      // range overlaps the new target range. Prevents a follow-up campaign
      // from re-offering the same week to a rep whose prior offer expired,
      // was declined, accepted, or committed.
      var priorOffer = rvtoHasPriorWeekBlockOffer_(
        email, dates.startDate, dates.endDate, ctx.offerObjects || [], ctx.timezone
      );
      if (priorOffer) {
        rvtoAudit_('WEEK_BLOCK_DUPLICATE_SKIP', qd.name,
          'Skipped ' + email + ' — prior week-block offer ' + priorOffer.offerId +
          ' (' + priorOffer.priorStart + ' to ' + priorOffer.priorEnd +
          ', status=' + priorOffer.priorStatus + ') overlaps target range',
          'INFO');
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
        queueSendCount++;
        if (maxSendsThisQueue > 0 && queueSendCount >= maxSendsThisQueue) {
          rvtoAudit_('WEEK_BLOCK_RUN', qd.name, 'Per-queue cap: ' + maxSendsThisQueue + ' send(s) — WEEK_VTO_MAX_SENDS_PER_QUEUE', 'INFO');
          stopQueueSends = true;
        }
        return;
      }

      try {
        didSend = rvtoDeliverWeekBlockOffer_({
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
        queueSendCount++;
        if (maxSendsThisQueue > 0 && queueSendCount >= maxSendsThisQueue) {
          rvtoAudit_('WEEK_BLOCK_RUN', qd.name, 'Per-queue cap: ' + maxSendsThisQueue + ' send(s) — WEEK_VTO_MAX_SENDS_PER_QUEUE', 'INFO');
          stopQueueSends = true;
        }
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
 * v1.10.0: Config-driven campaign mode for manual week VTO menu.
 * WEEK_BLOCK / RANGE / blank = legacy single full-date-range offer (unchanged).
 * PICK_DATES / BUNDLE_DATES = WEEK_VTO_PICK_DATES comma list.
 * DOW_IN_RANGE / BUNDLE_DOW = WEEK_VTO_START_DATE..END + WEEK_VTO_TARGET_DOW (1=Mon..7=Sun).
 */
function rvtoGetWeekVtoCampaignMode_(config) {
  var m = String(config.WEEK_VTO_CAMPAIGN_MODE || '').trim().toUpperCase();
  if (!m || m === 'WEEK_BLOCK' || m === 'RANGE' || m === 'LEGACY') return 'WEEK_BLOCK';
  if (m === 'PICK_DATES' || m === 'PICK_DAYS' || m === 'BUNDLE_DATES') return 'PICK_DATES';
  if (m === 'DOW_IN_RANGE' || m === 'DOW' || m === 'BUNDLE_DOW') return 'DOW_IN_RANGE';
  return 'WEEK_BLOCK';
}

/**
 * Resolves campaign dates for the week VTO menu. Adds campaignMode on the object.
 * v1.10.10: When INDIVIDUAL_DAY_VTO_ENABLED is TRUE, uses INDIVIDUAL_DAY_VTO_TARGET_DATE only
 * (one calendar day, WEEK_BLOCK engine) and ignores WEEK_VTO_CAMPAIGN_MODE / week date rows.
 */
function rvtoResolveWeekBlockCampaignDates_(config, tz) {
  var tzone = tz || 'America/Chicago';

  if (rvtoConfigBool_(config.INDIVIDUAL_DAY_VTO_ENABLED, false)) {
    var oneStr = rvtoWkNormDateStr_(config.INDIVIDUAL_DAY_VTO_TARGET_DATE, tzone);
    if (!oneStr) return null;
    var s0 = rvtoBuildDateTime_(oneStr, '00:00', tzone);
    var e0 = rvtoBuildDateTime_(oneStr, '23:59', tzone);
    if (!s0 || !e0) return null;
    return {
      startDate:      s0,
      endDate:        e0,
      startDateStr:   oneStr,
      endDateStr:     oneStr,
      dateList:       [oneStr],
      campaignMode:   'WEEK_BLOCK',
      individualDay:  true
    };
  }

  var mode = rvtoGetWeekVtoCampaignMode_(config);

  if (mode === 'WEEK_BLOCK') {
    var d = rvtoGetWeekBlockDates_(config, tzone);
    if (d) d.campaignMode = 'WEEK_BLOCK';
    return d;
  }

  var list = [];
  if (mode === 'PICK_DATES') {
    var raw = String(config.WEEK_VTO_PICK_DATES || '').trim();
    if (!raw) return null;
    raw.split(',').forEach(function(part) {
      var tok = String(part || '').trim();
      if (!tok) return;
      var norm = rvtoWkNormDateStr_(tok, tzone);
      if (norm) list.push(norm);
    });
    list = list.filter(function(v, i, a) { return a.indexOf(v) === i; }).sort();
  } else if (mode === 'DOW_IN_RANGE') {
    var startStr = rvtoWkNormDateStr_(config.WEEK_VTO_START_DATE, tzone);
    var endStr   = rvtoWkNormDateStr_(config.WEEK_VTO_END_DATE,   tzone);
    var dowTarget = Number(config.WEEK_VTO_TARGET_DOW);
    if (!startStr || !endStr || !isFinite(dowTarget) || dowTarget < 1 || dowTarget > 7) return null;
    var cursor = rvtoBuildDateTime_(startStr, '00:00', tzone);
    var endD   = rvtoBuildDateTime_(endStr,   '23:59', tzone);
    if (!cursor || !endD || endD < cursor) return null;
    var walk = new Date(cursor.getTime());
    while (walk <= endD) {
      var u = parseInt(Utilities.formatDate(walk, tzone, 'u'), 10);
      if (u === dowTarget) {
        list.push(Utilities.formatDate(walk, tzone, 'yyyy-MM-dd'));
      }
      walk.setDate(walk.getDate() + 1);
    }
    list = list.filter(function(v, i, a) { return a.indexOf(v) === i; }).sort();
  }

  if (!list.length) return null;

  var startDateStr = list[0];
  var endDateStr   = list[list.length - 1];
  var startDate    = rvtoBuildDateTime_(startDateStr, '00:00', tzone);
  var endDate      = rvtoBuildDateTime_(endDateStr,   '23:59', tzone);
  if (!startDate || !endDate) return null;

  return {
    startDate:      startDate,
    endDate:        endDate,
    startDateStr:   startDateStr,
    endDateStr:     endDateStr,
    dateList:       list,
    campaignMode:   mode
  };
}

/** Restrict surplus interval map to listed calendar days. */
function rvtoSliceSurplusIntervalsByDays_(queueSurplusIntervals, dayStrList) {
  var out = {};
  (dayStrList || []).forEach(function(d) {
    if (queueSurplusIntervals && queueSurplusIntervals[d]) {
      out[d] = queueSurplusIntervals[d];
    }
  });
  return out;
}

/** Same thresholds as rvtoFindEligible_ — used by bundle campaign sends. */
function rvtoOfferCapsAllowSend_(email, snapshot, rules) {
  var maxPerDay = Number(rules.MAX_OFFERS_PER_PERSON_PER_DAY || 1);
  var maxPer24h = Number(rules.MAX_EMAILS_PER_24H || 1);
  var h = snapshot || { sentToday: 0, sentLast24h: 0, lastSentAt: null };
  if (h.sentToday >= maxPerDay || h.sentLast24h >= maxPer24h) return false;
  if (h.lastSentAt) {
    var minGapHours = Number(rules.OFFER_MIN_GAP_HOURS || 1);
    var gapMs       = minGapHours * 60 * 60 * 1000;
    var msSinceLast = new Date().getTime() - new Date(h.lastSentAt).getTime();
    if (msSinceLast < gapMs) return false;
  }
  return true;
}

function rvtoBumpOffersByEmailAfterBundle_(ctx, email) {
  var k = String(email || '').trim().toLowerCase();
  if (!k) return;
  if (!ctx.offersByEmail) ctx.offersByEmail = {};
  if (!ctx.offersByEmail[k]) ctx.offersByEmail[k] = { sentToday: 0, sentLast24h: 0, lastSentAt: null };
  ctx.offersByEmail[k].sentToday++;
  ctx.offersByEmail[k].sentLast24h++;
  ctx.offersByEmail[k].lastSentAt = new Date();
}

/**
 * One HTML email: multiple optional VTO days, each with Accept / Decline links.
 */
function rvtoSendWeekVtoBundleEmail_(opts) {
  const config   = opts.config;
  const tz       = opts.timezone || config.TIMEZONE || 'America/Chicago';
  const fromName = config.EMAIL_FROM_NAME || 'Scheduling Bot';
  const dayLines = (opts.dayOffers || []).map(function(d) {
    var disp = rvtoFormatDateDisplay_(d.dayStr, tz);
    var acc  = d.acceptUrl ? "<a href='" + rvtoEscHtml_(d.acceptUrl) + "' style='font-size:15px;font-weight:bold;'>Accept " + rvtoEscHtml_(disp) + '</a>' : '';
    var dec  = d.declineUrl ? " &nbsp;|&nbsp; <a href='" + rvtoEscHtml_(d.declineUrl) + "'>Decline " + rvtoEscHtml_(disp) + '</a>' : '';
    return '<li style="margin:10px 0;">' + acc + dec + '</li>';
  }).join('');

  var daySummary = (opts.dayOffers || []).map(function(d) {
    return rvtoFormatDateDisplay_(d.dayStr, tz);
  }).join(', ');

  const subject = (config.EMAIL_SUBJECT_PREFIX || 'VTO Opportunity') +
    ' — Optional days: ' + daySummary;
  const expiresStr = Utilities.formatDate(opts.expiresAt, tz, "EEE, MMM d 'at' h:mm a") + ' CT';

  const html = [
    "<div style='font-family:Arial,sans-serif;font-size:14px;line-height:1.5;'>",
    "<p>Hi " + rvtoEscHtml_(opts.name || 'there') + ",</p>",
    "<p>You have <strong>voluntary time off</strong> available on the following dates. ",
    'Each date is independent — accept or decline <em>per day</em> (unpaid if accepted).</p>',
    "<p><strong>Queue:</strong> " + rvtoEscHtml_(opts.queue) + '</p>',
    '<ul style="padding-left:20px;">' + dayLines + '</ul>',
    "<p>Please respond before this offer expires.<br>",
    "<strong>Offer expires:</strong> " + rvtoEscHtml_(expiresStr) + '</p>',
    "<p>Thank you,</p><p>" + rvtoEscHtml_(fromName) + '</p></div>'
  ].join('');

  try {
    rvtoSendOfferGmailWithPreview_({
      config:     config,
      repEmail:   opts.email,
      offerKind:  'WEEK_BLOCK_BUNDLE',
      primaryTo:  opts.email,
      subject:    subject,
      plain:      rvtoHtmlToPlain_(html),
      html:       html,
      fromName:   fromName
    });
    rvtoAudit_('WEEK_BLOCK_BUNDLE_SEND', opts.bundleId || '', 'Sent bundle to ' + opts.email +
      ' | days=' + (opts.dayOffers || []).length + rvtoOfferPreviewAuditSuffix_(config), 'OK');
    return true;
  } catch (err) {
    rvtoAudit_('WEEK_BLOCK_BUNDLE_SEND', opts.bundleId || '', String(err), 'FAILED');
    return false;
  }
}

/** Max week-block or bundle sends per queue in one menu run; 0 = unlimited. */
function rvtoWeekVtoMaxSendsPerQueue_(config) {
  var raw = config && config.WEEK_VTO_MAX_SENDS_PER_QUEUE;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  var n = Number(raw);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * v1.10.0: Multi-day bundle campaign — N Offer rows, one email, per-day Accept/Decline.
 * Honors MAX_OFFERS_PER_PERSON_PER_DAY, MAX_EMAILS_PER_24H, OFFER_MIN_GAP_HOURS via ctx.offersByEmail.
 */
function rvtoRunWeekBlockBundle_(ctx, dates) {
  const config     = ctx.config;
  const sendEmails = rvtoConfigBool_(config.SEND_EMAILS, true);
  const webAppUrl  = rvtoGetWebAppUrl_(config);
  const holdHours  = Number(ctx.rules.OFFER_HOLD_HOURS || 1);
  const tz         = ctx.timezone;

  const schedules     = rvtoPullSchedulesForDateRange_(ctx, dates.startDate, dates.endDate);
  const schedIdx      = rvtoBuildSchedIdx_(schedules);
  const phoneSchedIdx = rvtoBuildPhoneSchedIdx_(schedules.phoneRows || []);
  const roster        = rvtoGetRoster_(ctx);

  const surplusIntervalsByQueue = rvtoFindWeekBlockSurplusDays_(ctx, dates);

  rvtoAudit_('WEEK_BLOCK_SURPLUS', '',
    '[BUNDLE] Surplus day counts by queue: ' +
    Object.keys(surplusIntervalsByQueue).map(function(q) {
      return q + '=' + Object.keys(surplusIntervalsByQueue[q] || {}).length + '/' + dates.dateList.length;
    }).join(', '),
    'INFO');

  const qualifyingQueues = ctx.enabledQueues.filter(function(qd) {
    return Object.keys(surplusIntervalsByQueue[qd.name] || {}).length > 0;
  });

  if (!qualifyingQueues.length) {
    rvtoAudit_('WEEK_BLOCK_RUN', '', '[BUNDLE] No queues had surplus on any target day — no offers sent', 'OK');
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const weekBlockSentThisRun = new Set();
  let sent    = 0;
  let failed  = 0;
  let skipped = 0;

  qualifyingQueues.forEach(function(qd) {
    const qMinSurplus    = rvtoEffectiveMinSurplusForQueue_(qd.name, ctx.rules);
    const qHeadroomFloor = rvtoEffectiveHeadroomFloorForQueue_(qd.name, ctx.rules);
    const surplusDays           = Object.keys(surplusIntervalsByQueue[qd.name] || {});
    const queueSurplusIntervals = surplusIntervalsByQueue[qd.name] || {};
    const headroomMapFull       = rvtoBuildHeadroomMap_(
      queueSurplusIntervals,
      ctx.offerObjects || [],
      qd.name,
      phoneSchedIdx,
      tz
    );

    rvtoAudit_('WEEK_BLOCK_HEADROOM', qd.name,
      '[BUNDLE] Initial headroom intervals: ' + Object.keys(headroomMapFull).length,
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
      rvtoAudit_('WEEK_BLOCK_ELIGIBILITY', qd.name, '[BUNDLE] No eligible reps for this queue', 'WARN');
      skipped++;
      return;
    }

    var maxSendsThisQueue = rvtoWeekVtoMaxSendsPerQueue_(config);
    var queueSendCount = 0;
    var stopQueueSends = false;
    var queueSkip = { duplicateRun: 0, cap: 0, noSchedule: 0, noBundleDays: 0 };

    eligible.forEach(function(person) {
      if (stopQueueSends) return;
      const email = person.email.trim().toLowerCase();
      if (weekBlockSentThisRun.has(email)) {
        queueSkip.duplicateRun++;
        skipped++;
        return;
      }

      var histSnap = ctx.offersByEmail && ctx.offersByEmail[email]
        ? ctx.offersByEmail[email]
        : { sentToday: 0, sentLast24h: 0, lastSentAt: null };
      if (!rvtoOfferCapsAllowSend_(email, histSnap, ctx.rules)) {
        rvtoAudit_('WEEK_BLOCK_BUNDLE_CAP', qd.name, 'Skipped ' + email + ' — MAX_OFFERS_PER_PERSON_PER_DAY / MAX_EMAILS_PER_24H / OFFER_MIN_GAP_HOURS', 'INFO');
        queueSkip.cap++;
        skipped++;
        return;
      }

      const repScheduledDays = rvtoGetRepScheduledDays_(email, surplusDays, schedIdx, tz);
      if (!repScheduledDays.length) {
        queueSkip.noSchedule++;
        skipped++;
        return;
      }

      var bundleDays = [];
      for (var di = 0; di < repScheduledDays.length; di++) {
        var dStr = repScheduledDays[di];
        var dayStart = rvtoBuildDateTime_(dStr, '00:00', tz);
        var dayEnd   = rvtoBuildDateTime_(dStr, '23:59', tz);
        if (!dayStart || !dayEnd) continue;

        if (rvtoHasPriorWeekBlockOffer_(email, dayStart, dayEnd, ctx.offerObjects || [], tz)) {
          continue;
        }

        var daySlice = {};
        if (queueSurplusIntervals[dStr]) daySlice[dStr] = queueSurplusIntervals[dStr];
        var dayHeadMap = rvtoBuildHeadroomMap_(
          daySlice,
          ctx.offerObjects || [],
          qd.name,
          phoneSchedIdx,
          tz
        );
        if (!rvtoRepCanFitInHeadroom_(email, phoneSchedIdx, dayHeadMap, qMinSurplus, qd.name, qHeadroomFloor)) {
          continue;
        }
        bundleDays.push(dStr);
      }

      if (!bundleDays.length) {
        rvtoAudit_('WEEK_BLOCK_BUNDLE', qd.name, 'Skipped ' + email + ' — no qualifying days after dedup/headroom', 'OK');
        queueSkip.noBundleDays++;
        skipped++;
        return;
      }

      bundleDays.sort();

      var bundleId = rvtoBuildId_(RVTO_APP.BUNDLE_ID_PREFIX);
      var sentAt   = new Date();
      var expiresAt = rvtoAddHours_(sentAt, holdHours);

      var dayOffers = [];
      for (var j = 0; j < bundleDays.length; j++) {
        var dayStr = bundleDays[j];
        var blocksForDay = rvtoGetRepScheduledBlocks_(email, [dayStr], schedIdx, tz);
        var offerId = rvtoBuildId_(RVTO_APP.WEEK_BLOCK_PREFIX);
        var token   = rvtoCreateToken_(offerId, email);
        var acceptUrl = webAppUrl
          ? (webAppUrl + '?offer_id=' + encodeURIComponent(offerId) + '&action=accept&token='  + encodeURIComponent(token) + '&offer_type=week_block')
          : '';
        var declineUrl = webAppUrl
          ? (webAppUrl + '?offer_id=' + encodeURIComponent(offerId) + '&action=decline&token=' + encodeURIComponent(token) + '&offer_type=week_block')
          : '';
        dayOffers.push({
          dayStr:      dayStr,
          offerId:     offerId,
          token:       token,
          acceptUrl:   acceptUrl,
          declineUrl:  declineUrl,
          blocksStr:   blocksForDay.join('|')
        });
      }

      var combinedSlice = rvtoSliceSurplusIntervalsByDays_(queueSurplusIntervals, bundleDays);
      var combinedHeadMap = rvtoBuildHeadroomMap_(
        combinedSlice,
        ctx.offerObjects || [],
        qd.name,
        phoneSchedIdx,
        tz
      );

      var didSend = false;

      if (!sendEmails) {
        for (var pi = 0; pi < dayOffers.length; pi++) {
          var p = dayOffers[pi];
          rvtoAppendWeekBlockOfferRow_({
            offerId:         p.offerId,
            deficitId:       bundleId,
            bundleId:        bundleId,
            date:            p.dayStr,
            name:            person.name,
            email:           email,
            agentId:         person.agentId || '',
            queue:           qd.name,
            manager:         person.manager || '',
            sentAt:          sentAt,
            expiresAt:       expiresAt,
            holdHours:       holdHours,
            status:          RVTO_APP.OFFER_STATUSES.PENDING_SEND,
            token:           p.token,
            acceptUrl:       p.acceptUrl,
            declineUrl:      p.declineUrl,
            scheduledDays:   p.dayStr,
            scheduledBlocks: p.blocksStr
          });
        }
        SpreadsheetApp.flush();
        rvtoConsumeHeadroom_(email, phoneSchedIdx, combinedHeadMap);
        rvtoBumpOffersByEmailAfterBundle_(ctx, email);
        weekBlockSentThisRun.add(email);
        sent++;
        queueSendCount++;
        if (maxSendsThisQueue > 0 && queueSendCount >= maxSendsThisQueue) {
          rvtoAudit_('WEEK_BLOCK_BUNDLE', qd.name, 'Per-queue cap: ' + maxSendsThisQueue + ' bundle send(s) — WEEK_VTO_MAX_SENDS_PER_QUEUE', 'INFO');
          stopQueueSends = true;
        }
        return;
      }

      try {
        didSend = rvtoDeliverWeekVtoBundleOffer_({
          config:    config,
          email:     email,
          name:      person.name,
          queue:     qd.name,
          timezone:  tz,
          expiresAt: expiresAt,
          bundleId:  bundleId,
          dayOffers: dayOffers
        });
      } catch (err2) {
        rvtoAudit_('WEEK_BLOCK_BUNDLE_SEND', bundleId, 'Unhandled exception: ' + String(err2), 'FAILED');
        didSend = false;
      }

      var finalStatus = didSend
        ? RVTO_APP.OFFER_STATUSES.SENT
        : RVTO_APP.OFFER_STATUSES.SEND_FAILED;

      for (var qi = 0; qi < dayOffers.length; qi++) {
        var q = dayOffers[qi];
        rvtoAppendWeekBlockOfferRow_({
          offerId:         q.offerId,
          deficitId:       bundleId,
          bundleId:        bundleId,
          date:            q.dayStr,
          name:            person.name,
          email:           email,
          agentId:         person.agentId || '',
          queue:           qd.name,
          manager:         person.manager || '',
          sentAt:          sentAt,
          expiresAt:       expiresAt,
          holdHours:       holdHours,
          status:          finalStatus,
          token:           q.token,
          acceptUrl:       q.acceptUrl,
          declineUrl:      q.declineUrl,
          scheduledDays:   q.dayStr,
          scheduledBlocks: q.blocksStr
        });
      }
      SpreadsheetApp.flush();

      if (didSend) {
        rvtoConsumeHeadroom_(email, phoneSchedIdx, combinedHeadMap);
        rvtoBumpOffersByEmailAfterBundle_(ctx, email);
        weekBlockSentThisRun.add(email);
        sent++;
        queueSendCount++;
        if (maxSendsThisQueue > 0 && queueSendCount >= maxSendsThisQueue) {
          rvtoAudit_('WEEK_BLOCK_BUNDLE', qd.name, 'Per-queue cap: ' + maxSendsThisQueue + ' bundle send(s) — WEEK_VTO_MAX_SENDS_PER_QUEUE', 'INFO');
          stopQueueSends = true;
        }
      } else {
        failed++;
      }
    });

    if (queueSendCount === 0 && eligible.length) {
      rvtoAudit_('WEEK_BLOCK_BUNDLE_QUEUE_SUMMARY', qd.name,
        'Zero bundle sends | eligible=' + eligible.length +
        ' | skip cap=' + queueSkip.cap +
        ' | noSchedule=' + queueSkip.noSchedule +
        ' | noBundleDays/headroom/dedup=' + queueSkip.noBundleDays +
        ' | duplicateRun=' + queueSkip.duplicateRun +
        ' — see WEEK_BLOCK_ELIGIBILITY and WEEK_BLOCK_HEADROOM rows above',
        'WARN');
    }
  });

  rvtoAudit_('WEEK_BLOCK_RUN', '',
    '[BUNDLE] Complete | Sent: ' + sent + ' | Failed: ' + failed + ' | Skipped: ' + skipped,
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
          const rampBoost = rvtoEffectiveRampBoostForInterval_(iStart, iEnd, ctx);
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
 * v1.7.6: Eligibility for week-block / bundle week VTO offers. Same pipeline as rvtoFindEligible_ but:
 *  - Cap-exempt for legacy WEEK_BLOCK single-range sends (rvtoRunWeekBlock_); bundle mode applies
 *    MAX_OFFERS_PER_PERSON_PER_DAY / MAX_EMAILS_PER_24H / OFFER_MIN_GAP in rvtoRunWeekBlockBundle_.
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

/**
 * Calendar days a WEEK_VTO / bundle offer row covers (yyyy-MM-dd strings).
 * Parses Date ("yyyy-MM-dd", "start to end") or Notes "Days:" list.
 */
function rvtoWeekBlockOfferDayKeys_(obj, tz) {
  var tzone = tz || 'America/Chicago';
  var notes = String(obj['Notes'] || '');
  var dateRaw = obj['Date'];
  var dateStr = (dateRaw instanceof Date)
    ? Utilities.formatDate(dateRaw, tzone, 'yyyy-MM-dd')
    : String(dateRaw || '').trim();

  var mRange = dateStr.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
  if (mRange) {
    var cursor = rvtoBuildDateTime_(mRange[1], '00:00', tzone);
    var endD   = rvtoBuildDateTime_(mRange[2], '23:59', tzone);
    if (!cursor || !endD) return [];
    var out = [];
    var walk = new Date(cursor.getTime());
    while (walk <= endD) {
      out.push(Utilities.formatDate(walk, tzone, 'yyyy-MM-dd'));
      walk.setDate(walk.getDate() + 1);
    }
    return out;
  }

  var mSingle = dateStr.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (mSingle) return [mSingle[1]];

  var daysMatch = notes.match(/Days:\s*([^\s|]+)/);
  if (daysMatch) {
    return daysMatch[1].split(',')
      .map(function(d) { return d.trim(); })
      .filter(function(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); });
  }

  return [];
}

/**
 * v1.9.8: Returns the most recent prior WEEK_VTO offer row for this email
 * whose date range overlaps [targetStart, targetEnd], or null if none.
 *
 * v1.9.9: Identify week-block rows by Offer ID prefix RVTO_APP.WEEK_BLOCK_PREFIX
 * ("RVTO_WK") FIRST, with the Notes "WEEK_VTO" tag as a secondary signal. The
 * Notes-only check in v1.9.8 missed EXPIRED week-block offers because
 * expireRvtoOffers_() used to overwrite Notes with "Expired after hold window."
 * on expiry, erasing the tag. The Offer ID prefix is immutable and matches
 * what doGet() already uses to route week-block responses, so dedup is robust
 * against any downstream Notes mutation.
 *
 * Status filter:
 *   - Skipped: SEND_FAILED, blank   (the rep never actually received the offer)
 *   - Counted: SENT, PENDING_SEND, ACCEPTED, COMMITTED, DECLINED, EXPIRED,
 *              COMMIT_FAILED                (rep was meaningfully offered the
 *                                            window; do not duplicate)
 *
 * Date parsing: week-block rows store the Date column as "yyyy-MM-dd to yyyy-MM-dd".
 * Sheets may auto-coerce the start of that string to a Date object on read, so we
 * fall back to scanning Notes ("Days: yyyy-MM-dd,yyyy-MM-dd,...") when the Date
 * column does not match the expected pattern.
 *
 * Returns:
 *   null                       - no overlap
 *   { offerId, priorStart, priorEnd, priorStatus }  - overlapping prior offer
 */
function rvtoHasPriorWeekBlockOffer_(email, targetStart, targetEnd, offerObjects, tz) {
  if (!email || !offerObjects || !offerObjects.length) return null;
  if (!targetStart || !targetEnd) return null;

  var emailLc = String(email).trim().toLowerCase();
  var tzone   = tz || 'America/Chicago';
  var targetStartMs = targetStart.getTime();
  var targetEndMs   = targetEnd.getTime();
  var match = null;

  for (var i = 0; i < offerObjects.length; i++) {
    var obj     = offerObjects[i];
    var offerId = String(obj['Offer ID'] || '').trim();
    var notes   = String(obj['Notes']    || '');

    // v1.9.9: Identify by Offer ID prefix (robust against Notes clobbering on
    // expiry) with Notes tag as secondary signal for any legacy edge case.
    var isWeekBlock = (offerId.indexOf(RVTO_APP.WEEK_BLOCK_PREFIX) === 0)
                   || (notes.indexOf('WEEK_VTO') !== -1);
    if (!isWeekBlock) continue;

    var rowEmail = String(obj['Email'] || '').trim().toLowerCase();
    if (rowEmail !== emailLc) continue;

    var status = String(obj['Status'] || '').trim().toUpperCase();
    if (!status || status === RVTO_APP.OFFER_STATUSES.SEND_FAILED) continue;

    // Parse "yyyy-MM-dd to yyyy-MM-dd" from the Date column.
    var dateRaw = obj['Date'];
    var dateStr = (dateRaw instanceof Date)
      ? Utilities.formatDate(dateRaw, tzone, 'yyyy-MM-dd')
      : String(dateRaw || '').trim();

    var priorStartStr = '';
    var priorEndStr   = '';

    var m = dateStr.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
    if (m) {
      priorStartStr = m[1];
      priorEndStr   = m[2];
    } else {
      // v1.10.0: Single-day week-block / bundle rows store Date as yyyy-MM-dd only.
      var mSingle = dateStr.match(/^(\d{4}-\d{2}-\d{2})$/);
      if (mSingle) {
        priorStartStr = mSingle[1];
        priorEndStr   = mSingle[1];
      }
    }
    if (!priorStartStr) {
      // Fallback: scan Notes for "Days: yyyy-MM-dd,yyyy-MM-dd,..."
      var daysMatch = notes.match(/Days:\s*([^\s|]+)/);
      if (daysMatch) {
        var days = daysMatch[1].split(',')
          .map(function(d) { return d.trim(); })
          .filter(function(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); });
        if (days.length) {
          days.sort();
          priorStartStr = days[0];
          priorEndStr   = days[days.length - 1];
        }
      }
    }

    if (!priorStartStr || !priorEndStr) continue;

    var priorStart = rvtoBuildDateTime_(priorStartStr, '00:00', tzone);
    var priorEnd   = rvtoBuildDateTime_(priorEndStr,   '23:59', tzone);
    if (!priorStart || !priorEnd) continue;

    if (priorStart.getTime() <= targetEndMs && priorEnd.getTime() >= targetStartMs) {
      // Prefer the most recently sent overlapping offer for the audit message.
      var sentAt = obj['Sent At'] ? new Date(obj['Sent At']) : null;
      var candidate = {
        offerId:     String(obj['Offer ID'] || '').trim(),
        priorStart:  priorStartStr,
        priorEnd:    priorEndStr,
        priorStatus: status,
        sentAt:      (sentAt && !isNaN(sentAt.getTime())) ? sentAt : null
      };
      if (!match) {
        match = candidate;
      } else if (candidate.sentAt && (!match.sentAt || candidate.sentAt > match.sentAt)) {
        match = candidate;
      }
    }
  }

  return match;
}

function rvtoBuildHeadroomMap_(surplusIntervalsByQueue, offerObjects, queueName, schedIdx, tz) {
  const map = {};
  var tzone = tz || 'America/Chicago';

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

    var offerDays = rvtoWeekBlockOfferDayKeys_(obj, tzone);
    if (!offerDays.length) return;
    var offerDaySet = {};
    offerDays.forEach(function(d) { offerDaySet[d] = true; });

    var repBlocks = schedIdx[email] || [];
    Object.keys(map).forEach(function(key) {
      var entry = map[key];
      var intervalDay = Utilities.formatDate(entry.start, tzone, 'yyyy-MM-dd');
      if (!offerDaySet[intervalDay]) return;
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
  const pgcCeiling       = rvtoPgcOfferCeilingFromConfig_(ctx.config);
  const pgcMapForCeiling = ctx.pgcByNormalizedName || {};

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
    noEmail: 0, queueMismatch: 0, noFly: 0, shadowExcluded: 0, pgcAboveCeiling: 0,
    notScheduled: 0, belowSurplusPct: 0, passed: 0
  };

  roster.forEach(function(person) {
    const email = (person.email || '').trim().toLowerCase();
    if (!email) { debugCounts.noEmail++; return; }
    if (!rvtoWorkGroupMatches_(person.workGroup, workGroupPattern)) { debugCounts.queueMismatch++; return; }
    if (noFlySet.has(rvtoNormalizeName_(person.name))) { debugCounts.noFly++; return; }
    if (shadowEmails.has(email)) { debugCounts.shadowExcluded++; return; }
    if (pgcCeiling !== null && !rvtoRepPassesPgcOfferCeiling_(person.name, pgcMapForCeiling, pgcCeiling)) {
      debugCounts.pgcAboveCeiling++;
      return;
    }

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
    ' | pgcAboveCeiling: ' + debugCounts.pgcAboveCeiling +
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
    rvtoSendOfferGmailWithPreview_({
      config:     config,
      repEmail:   opts.email,
      offerKind:  'WEEK_BLOCK_WEEK',
      primaryTo:  opts.email,
      subject:    subject,
      plain:      rvtoHtmlToPlain_(html),
      html:       html,
      fromName:   fromName
    });
    rvtoAudit_('WEEK_BLOCK_SEND', opts.offerId, 'Sent to ' + opts.email + rvtoOfferPreviewAuditSuffix_(config), 'OK');
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return;
  // v1.7.3: Notes stores both the day list (for summary script) and the
  // per-block schedule (for precise Assembled commits).
  // v1.10.0: Optional BUNDLE_ID= groups multi-day single-email campaigns.
  // Format: WEEK_VTO | BUNDLE_ID=... | Days: yyyy-MM-dd,... | Blocks: ...
  var notes = 'WEEK_VTO';
  if (o.bundleId) notes += ' | BUNDLE_ID=' + o.bundleId;
  notes += ' | Days: ' + (o.scheduledDays || '');
  if (o.scheduledBlocks) notes += ' | Blocks: ' + o.scheduledBlocks;
  sheet.appendRow([
    o.offerId, o.deficitId || '',
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.OFFERS);
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
  const ss = rvtoGetSpreadsheet_();
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
  var boundSpreadsheetId = rvtoEnsureSpreadsheetIdProperty_();

  const configSheet          = rvtoGetOrCreate_(RVTO_APP.SHEETS.CONFIG);
  const rosterSheet          = rvtoGetOrCreate_(RVTO_APP.SHEETS.ROSTER);
  const noFlySheet           = rvtoGetOrCreate_(RVTO_APP.SHEETS.NO_FLY);
  const shadowExclusionSheet = rvtoGetOrCreate_(RVTO_APP.SHEETS.SHADOW_EXCLUSION);
  const rampInclusionSheet   = rvtoGetOrCreate_(RVTO_APP.SHEETS.RAMP_INCLUSION);
  const offersSheet          = rvtoGetOrCreate_(RVTO_APP.SHEETS.OFFERS);
  const auditSheet           = rvtoGetOrCreate_(RVTO_APP.SHEETS.AUDIT);
  const changelogSheet       = rvtoGetOrCreate_(RVTO_APP.SHEETS.CHANGELOG);

  const queueToggleRows = RVTO_APP.QUEUE_DEFS.map(function(qd) {
    return ['QUEUE_ENABLED_' + qd.key, 'TRUE',
      'Off = this queue is ignored. On = bot can offer VTO here. (' + qd.name + ')'];
  });

  const queueMinSurplusRows = RVTO_APP.QUEUE_DEFS.map(function(qd) {
    return ['MIN_SURPLUS_' + qd.key, '',
      'Optional: stricter “how much extra staff counts as surplus” for this queue only. Empty = use MIN_SURPLUS.'];
  });

  const queueHeadroomFloorRows = RVTO_APP.QUEUE_DEFS.map(function(qd) {
    return ['HEADROOM_FLOOR_' + qd.key, '',
      'Optional: lowest staffing allowed after VTO on this queue. Empty = use HEADROOM_FLOOR.'];
  });

  rvtoSetSheetData_(configSheet,
    ['Key', 'Value', 'Notes'],
    [
      ['TIMEZONE',                      'America/Chicago', 'Dates and times in emails and the sheet use this zone.'],
      ['INTERVAL_SECONDS',              1800,              'Assembled staffing is read in this chunk size (1800 = 30 minutes).'],
      ['LOOKAHEAD_DAYS',                3,                 'How far ahead the normal (intraday) run looks for surpluses.'],
      ['SCHEDULE_PULL_HOURS',           78,                'How many hours of schedules we pull for the normal run.'],
      ['VTO_ACTIVITY_NAME',             'VTO',             'Name of the VTO activity in Assembled (if you do not set the activity UUID in Script Properties).'],
      ['EMAIL_SUBJECT_PREFIX',          'VTO Opportunity', 'Starts every offer subject line.'],
      ['EMAIL_FROM_NAME',               'Scheduling Bot',  'The “from” name reps see in Gmail.'],
      ['SEND_EMAILS',                   'TRUE',            'False = still writes offer rows but does not send mail or Slack (dry run).'],
      ['VTO_OFFER_CHANNEL',             'EMAIL',           'EMAIL = Gmail only. SLACK = DM rep in Slack with Accept/Decline links. BOTH = Slack + email. Needs SLACK_BOT_TOKEN in Script Properties.'],
      ['VTO_SLACK_FALLBACK_EMAIL',      'TRUE',            'When channel is SLACK and Slack DM fails, try Gmail to the roster email. Ignored for EMAIL-only.'],
      ['VTO_OFFER_PREVIEW_EMAIL',       '',                'Your address: get a copy of each offer email to proofread. Leave empty to turn off.'],
      ['VTO_OFFER_PREVIEW_MODE',        'BCC',             'BCC = rep gets the email, you are blind-copied. COPY_ONLY = only you get it (rep does not). OFF = off even if preview email is filled in.'],
      ['ASSEMBLED_COMMIT',              'TRUE',            'False = Accept still updates the sheet but does not post VTO to Assembled.'],
      ['MIN_SURPLUS',                   1,                 'Default: how many extra people above forecast count as “surplus” for this bot. Per-queue overrides are below.'],
      ['RAMP_NET_BOOST_ENABLED',        'TRUE',            'TRUE = Ramp_Inclusion adds effective FTE to Assembled net for surplus (intraday + week/bundle). FALSE = raw API net only (closer to Staffing timeline “Not staffing” without synthetic ramp surplus).'],
      ['HEADROOM_FLOOR',                0,                 'After VTO, staffing can drop to this level (per queue over the day). Usually 0. Lower = more offers. Per-queue overrides below.'],
      ['MIN_BLOCK_MINUTES',             120,               'Ignore surplus windows shorter than this (minutes).'],
      ['OFFER_HOLD_HOURS',              1,                 'How long the rep has to tap Accept before the offer times out.'],
      ['MAX_OFFERS_PER_PERSON_PER_DAY', 1,                 'Soft cap: max offer “events” per rep per calendar day (bundle email counts as one).'],
      ['MAX_EMAILS_PER_24H',            1,                 'Soft cap: max offer emails per rep in the last 24 hours.'],
      ['OFFER_MIN_GAP_HOURS',           1,                 'Wait at least this many hours between sends to the same rep (stops back-to-back spam).'],
      ['MIN_SCHEDULE_OVERLAP_HOURS',    2,                 'Rep must be on the schedule at least this many hours inside the surplus window.'],
      ['ASSEMBLED_SITE',                'Consumer Sales',  'Site name in Assembled for the queues in this bot (Consumer Sales).'],
      ['ASSEMBLED_CHANNEL',             'phone',           'Which channel we read from Assembled (usually phone).'],
      ['USE_PGC_PRIORITY',              'TRUE',            'True = sort offers using the PGC sheet (Script Property PGC_SPREADSHEET_ID). False = ignore PGC for ordering only. Default columns: A = name, B = pGC; override with Script Properties PGC_NAME_COLUMN / PGC_VALUE_COLUMN (1-based).'],
      ['PGC_OFFER_CEILING',             '',                'Optional: max PGC from your PGC sheet that can still get an offer (same number scale as the sheet; 85 means 85% and below). Blank = no cap. Reps with no PGC row still qualify. If Audit PGC_LOAD shows 0 names, the cap does nothing until the map loads (fix tab/columns or IMPORTRANGE).'],
      ['PGC_DEBUG_TOP_N',               8,                 'How many names we log in Audit for “who was first in line” (0 = turn off logging).'],
      ['WEEK_VTO_MIN_SURPLUS_PCT',      15,                'Week / bundle campaigns: rep must have at least this % of their shift touching surplus.'],
      ['WEEK_VTO_MAX_SENDS_PER_QUEUE',  '',                'Week / bundle menu: max emails per queue in one run (blank or 0 = unlimited). Stops after N successful sends per queue so one surplus day does not offer every eligible rep in that queue.'],
      ['MANAGER_VTO_SLACK',             'TRUE',            'True = Slack the manager when someone accepts (needs SLACK_BOT_TOKEN in Script Properties).'],
      ['STANDARD_VTO_ENABLED',          'TRUE',            'False = turn off the timed intraday run only. Manual week / bundle / single-day menu still works.'],
      ['INDIVIDUAL_DAY_VTO_ENABLED',    'FALSE',           'True = menu run targets one day only (INDIVIDUAL_DAY_VTO_TARGET_DATE). Pulls Assembled for that day; same offer flow as week-block. Takes precedence over WEEK_VTO_* dates/mode when TRUE.'],
      ['INDIVIDUAL_DAY_VTO_TARGET_DATE', '',               'Single day to target (yyyy-MM-dd). Required when INDIVIDUAL_DAY_VTO_ENABLED is TRUE.'],
      ['WEEK_VTO_ENABLED',              'FALSE',           'True = you can run the week / bundle campaign from the menu (unless you use individual-day only).'],
      ['WEEK_VTO_CAMPAIGN_MODE',        'WEEK_BLOCK',      'WEEK_BLOCK = one email for the whole date range. PICK_DATES = list dates in WEEK_VTO_PICK_DATES. DOW_IN_RANGE = every Mon/Tue/… between start and end.'],
      ['WEEK_VTO_PICK_DATES',           '',                'Used when mode is PICK_DATES. Comma-separated dates, e.g. 2026-06-05, 2026-06-12'],
      ['WEEK_VTO_TARGET_DOW',           '',                'Used when mode is DOW_IN_RANGE. 1 = Monday … 7 = Sunday.'],
      ['WEEK_VTO_START_DATE',           '',                'First day of the week campaign (yyyy-MM-dd).'],
      ['WEEK_VTO_END_DATE',             '',                'Last day of the week campaign (yyyy-MM-dd).'],
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

  var changelogResult = rvtoSetupChangelog_(changelogSheet);
  rvtoFormatSheets_();
  try { rvtoInstallOfferAlertTrigger_(); } catch (triggerErr) { /* non-fatal */ }
  rvtoAudit_('SETUP', '', 'Workbook setup complete (v1.11.3)', 'OK');

  SpreadsheetApp.getUi().alert([
    'Targeted VTO Bot v1.11.3 workbook setup complete.',
    changelogResult.added > 0
      ? ('Changelog: added ' + changelogResult.added + ' missing version row(s) (' + changelogResult.total + ' total).')
      : ('Changelog: up to date (' + changelogResult.total + ' entries).'),
    '',
    'Next steps:',
    '1. Set Script Properties: ASSEMBLED_API_KEY, RVTO_WEB_APP_URL, RVTO_SPREADSHEET_ID, ASSEMBLED_VTO_ACTIVITY_ID, SLACK_BOT_TOKEN (for Slack offers / manager notify)',
    boundSpreadsheetId
      ? ('   RVTO_SPREADSHEET_ID saved: ' + boundSpreadsheetId + ' (web app Accept/Decline will use this workbook).')
      : '   WARNING: RVTO_SPREADSHEET_ID was not saved — open this file and run Setup again.',
    '   Optional: PGC_SPREADSHEET_ID only if PGC lives in another file; else bot uses this workbook’s "PGC" tab.',
    '   PGC columns default to A=name, B=pGC. Legacy Looker B+G: PGC_NAME_COLUMN=2, PGC_VALUE_COLUMN=7.',
    '2. Populate the Roster sheet',
    '3. Deploy as web app (execute as: me, anyone can access)',
    '4. Set a time-based trigger on runReverseVto()',
    '',
    'v1.11.3: Week/bundle headroom only deducts outstanding offers on the day(s) they cover — fixes zero sends after prior PICK_DATES days.',
    '',
    'v1.11.2: Web app uses RVTO_SPREADSHEET_ID (openById) — run Setup once if Accept links said Offer not found.',
    '',
    'v1.11.0: VTO_OFFER_CHANNEL (EMAIL / SLACK / BOTH) + VTO_SLACK_FALLBACK_EMAIL — Slack DMs with I\'ll take it! / No thanks links (same web app as email).',
    '',
    'v1.10.10: INDIVIDUAL_DAY_VTO_ENABLED + INDIVIDUAL_DAY_VTO_TARGET_DATE — one-day menu campaign (Assembled pull for that day only).',
    '',
    'v1.10.9: PGC_LOAD merges from this workbook\'s "PGC" tab when the external PGC file has 0 usable rows (IMPORTRANGE on bound tab).',
    '',
    'v1.10.8: PGC_LOAD retries tab "PGC" when the configured/first tab has 0 usable rows; WARN if map still empty while ceiling/priority needs data.',
    '',
    'v1.10.7: WEEK_VTO_MAX_SENDS_PER_QUEUE — cap bundle/week emails per queue per menu run (0 = unlimited).',
    '',
    'v1.10.6: PGC loads from this workbook’s "PGC" tab when PGC_SPREADSHEET_ID is blank (IMPORTRANGE-backed tab works).',
    '',
    'v1.10.5: RAMP_NET_BOOST_ENABLED — set FALSE to use raw Assembled net for surplus (no Ramp_Inclusion boost; closer to Staffing timeline).',
    '',
    'v1.10.4: PGC sheet defaults to columns A (name) and B (pGC %). Looker B+G: set PGC_NAME_COLUMN=2, PGC_VALUE_COLUMN=7.',
    '',
    'v1.10.3: PGC_OFFER_CEILING — optional cap so only reps at or below that PGC get offers (unknown PGC still qualifies).',
    '',
    'v1.10.2: Config is shorter (Consumer Sales queues only; friendlier Notes).',
    '  Re-run Setup to refresh the Config tab text. Add Support queues back in code if needed.',
    '',
    'v1.10.1: VTO_OFFER_PREVIEW_EMAIL + VTO_OFFER_PREVIEW_MODE (BCC or COPY_ONLY)',
    '  to see exact offer emails for intraday, full-week, and bundle campaigns.',
  ].join('\n'));
}

/*************************************************************
 * CHANGELOG SETUP
 *************************************************************/

function rvtoNormalizeChangelogVersion_(v) {
  return String(v || '').trim().toLowerCase();
}

/**
 * Inserts script changelog rows that are not already on the sheet (by Version).
 * New rows go directly under the header, newest first (matches rvtoGetChangelogHistory_ order).
 * Returns { added, total }.
 */
function rvtoSyncChangelogMissingRows_(sheet, headers, history) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  var existing = {};
  var lastRow  = sheet.getLastRow();
  if (lastRow > 1) {
    var versionCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < versionCol.length; i++) {
      var key = rvtoNormalizeChangelogVersion_(versionCol[i][0]);
      if (key) existing[key] = true;
    }
  }

  var toAdd = [];
  for (var h = 0; h < history.length; h++) {
    var verKey = rvtoNormalizeChangelogVersion_(history[h][0]);
    if (verKey && !existing[verKey]) toAdd.push(history[h]);
  }

  if (!toAdd.length) {
    return { added: 0, total: Math.max(0, lastRow - 1) };
  }

  sheet.insertRowsAfter(1, toAdd.length);
  sheet.getRange(2, 1, toAdd.length, headers.length).setValues(toAdd);
  SpreadsheetApp.flush();

  return { added: toAdd.length, total: sheet.getLastRow() - 1 };
}

/** Canonical changelog rows (newest first). Single source for the Changelog tab. */
function rvtoGetChangelogHistory_() {
  return [
    ['v1.11.3', '2026-06-16', 'Bobby Sorrell',
     'FIX: rvtoBuildHeadroomMap_ pre-deducted active WEEK_VTO sheet rows against every surplus interval in the map, even when the offer was for a different calendar day. After a multi-day PICK_DATES campaign, SENT rows for 6/16–6/18 wrongly drained 6/19 headroom for reps still scheduled that day (large College queue → zero bundle sends despite Assembled surplus). New rvtoWeekBlockOfferDayKeys_(); deductions are scoped to the offer\'s Date / Notes Days. College workGroupPattern adds Col-STEM and College and Grad. Bundle runs emit WEEK_BLOCK_BUNDLE_QUEUE_SUMMARY when eligible>0 but sends=0.',
     'Re-run 6/19 (or any pick date) after prior-day bundle offers without false headroom starvation. Audit tab shows per-queue skip tallies when a queue sends nothing.',
     'Released'],
    ['v1.11.2', '2026-05-26', 'Bobby Sorrell',
     'FIX: Accept/Decline web app returned "Offer not found" when offers existed on the Offers tab. Replaced SpreadsheetApp.getActive() with rvtoGetSpreadsheet_() (openById via Script Property RVTO_SPREADSHEET_ID) for all sheet I/O including doGet. setupRvtoWorkbook() calls rvtoEnsureSpreadsheetIdProperty_() to persist this file\'s ID when run from the bound workbook.',
     'Redeploying the web app alone does not fix lookup — set RVTO_SPREADSHEET_ID (auto on Setup) so headless runs read the same workbook where offers are written.',
     'Released'],
    ['v1.11.1', '2026-05-20', 'Bobby Sorrell',
     'FIX: Changelog tab sync — rvtoSetupChangelog_ and menu Sync Changelog append versions from script that are missing on the sheet (previously only populated an empty tab; existing tabs stopped at first setup). New rows insert below header, newest first.',
     'Operators see v1.10+ and Slack release notes on the Changelog tab without hand-copying from the .gs file.',
     'Released'],
    ['v1.11.0', '2026-05-20', 'Bobby Sorrell',
     'NEW: Rep-facing Slack VTO offers. Config VTO_OFFER_CHANNEL (EMAIL default, SLACK, BOTH) and VTO_SLACK_FALLBACK_EMAIL (default TRUE). rvtoDeliverIntradayOffer_, rvtoDeliverWeekBlockOffer_, rvtoDeliverWeekVtoBundleOffer_ route to rvtoSendOfferSlack* plus existing Gmail templates. Slack uses mrkdwn links to the same RVTO_WEB_APP_URL Accept/Decline URLs. COPY_ONLY preview DMs the operator (lookup on VTO_OFFER_PREVIEW_EMAIL). Audit: SEND_SLACK, SEND_OFFER (when Slack channel active).',
     'Reps can accept VTO from Slack without opening email; operators can pilot SLACK or BOTH before cutting over from Gmail.',
     'Released'],
    ['v1.10.10', '2026-05-14', 'Bobby Sorrell',
     'NEW: Config INDIVIDUAL_DAY_VTO_ENABLED (default FALSE) and INDIVIDUAL_DAY_VTO_TARGET_DATE (yyyy-MM-dd). When enabled, rvtoResolveWeekBlockCampaignDates_ returns a one-day WEEK_BLOCK span for that date; runWeekBlockVto allows the menu when WEEK_VTO_ENABLED or INDIVIDUAL_DAY_VTO_ENABLED is TRUE. Individual mode takes precedence over WEEK_VTO_CAMPAIGN_MODE and week/bundle date fields. Menu label: Run Week / Single-Day VTO.',
     'Operators can run a targeted single-day surplus campaign without configuring WEEK_VTO_START_DATE, END_DATE, or campaign mode.',
     'Released'],
    ['v1.10.9', '2026-05-13', 'Bobby Sorrell',
     'PGC: if Script Property PGC_SPREADSHEET_ID opens a file that yields 0 usable name/PGC rows after the same-file PGC-tab retry, rvtoLoadPgcMap_ reads the bound (active) workbook tab "PGC" and merges into the map when that spreadsheet differs from the external id. PGC_LOAD audit uses src active_workbook_merged and tab text notes bound merge.',
     'Supports Looker export ID + live IMPORTRANGE PGC on the bot workbook without clearing properties.',
     'Released'],
    ['v1.10.8', '2026-05-13', 'Bobby Sorrell',
     'PGC: rvtoMergePgcRowsIntoMap_ helper; rvtoLoadPgcMap_ after reading the primary sheet, if the map is still empty, re-read tab "PGC" when it exists and is a different sheet. Audit tab field notes fallback. If map is still empty and USE_PGC_PRIORITY or PGC_OFFER_CEILING expects data, PGC_LOAD is WARN explaining ceiling/sort are inactive until rows load.',
     'Fixes empty "Data" tab + populated "PGC" tab; makes misconfiguration visible in Audit.',
     'Released'],
    ['v1.10.7', '2026-05-13', 'Bobby Sorrell',
     'NEW: Config WEEK_VTO_MAX_SENDS_PER_QUEUE (0/blank = unlimited). In rvtoRunWeekBlockBundle_ and rvtoRunWeekBlock_, after each successful send (or dry-run row write) for a queue, increment a counter; when it reaches N, stop processing further eligible reps for that queue only. Audit lines WEEK_BLOCK_BUNDLE or WEEK_BLOCK_RUN note the cap.',
     'Prevents one campaign run from emailing every qualifying rep in a large queue (e.g. ELD) when surplus is thin.',
     'Released'],
    ['v1.10.6', '2026-05-13', 'Bobby Sorrell',
     'PGC load: if Script Property PGC_SPREADSHEET_ID is omitted, rvtoLoadPgcMap_ uses the active bound spreadsheet. If PGC_SHEET_NAME is also omitted and the opened file is that workbook, the tab named "PGC" is preferred (else first tab). External Looker exports still set PGC_SPREADSHEET_ID. PGC_LOAD audit includes tab name and active_workbook vs external_id.',
     'PGC tab with IMPORTRANGE (same workbook) works without copying IDs into Script Properties.',
     'Released'],
    ['v1.10.5', '2026-05-13', 'Bobby Sorrell',
     'NEW: Config RAMP_NET_BOOST_ENABLED (default TRUE). Surplus/deficit math in rvtoFindDeficits_ and rvtoFindWeekBlockSurplusDays_ uses net = Assembled API net + ramp share only when TRUE. FALSE ignores Ramp_Inclusion for net staffing (raw API net), aligning bundle/intraday detection with Assembled Staffing timeline when ramp cohorts should not create synthetic surplus. RAMP_INCLUSION audit line states whether boost is applied.',
     'Operators can reconcile VTO offers against timeline “Not staffing” without deactivating ramp rows.',
     'Released'],
    ['v1.10.4', '2026-05-13', 'Bobby Sorrell',
     'PGC import: rvtoLoadPgcMap_ now defaults to column A for rep name and column B for pGC (matches in-workbook "PGC" tab with percentage-formatted cells). Optional Script Properties PGC_NAME_COLUMN and PGC_VALUE_COLUMN (1-based integers) override layout; use 2 and 7 for the previous hardcoded Looker export (name B, PGC G). Header-like name cells (e.g. "Sales Rep") are skipped.',
     'Works with the operator PGC sheet layout without manual column copies.',
     'Released'],
    ['v1.10.3', '2026-05-13', 'Bobby Sorrell',
     'NEW: Config PGC_OFFER_CEILING — optional maximum PGC (same scale as Looker PGC sheet) for intraday and week/bundle eligibility. Reps with numeric PGC strictly above the ceiling are excluded; reps with no PGC row still qualify. rvtoLoadPgcMap_ loads when ceiling is set even if USE_PGC_PRIORITY is FALSE. ELIGIBILITY_DEBUG and WEEK_BLOCK_ELIGIBILITY audit lines include pgcAboveCeiling count.',
     'Operators can cap who receives VTO without changing the source sheet.',
     'Released'],
    ['v1.10.2', '2026-05-13', 'Bobby Sorrell',
     'CONFIG: QUEUE_DEFS trimmed to six Consumer Sales queues only (Support chat/phone queues removed from this deployment). Removed unused PAGE_LIMIT config row and ASSEMBLED_SITE_SUPPORT (no Support-site queues). Rewrote all Setup Workbook Config Notes in plain language; per-queue rows say the same thing in fewer words.',
     'Smaller Config tab; easier for operators to scan. Re-run Setup Workbook to refresh rows (existing workbooks keep old keys until setup is re-run).',
     'Released'],
    ['v1.10.1', '2026-05-13', 'Bobby Sorrell',
     'NEW: Operator offer preview — Config VTO_OFFER_PREVIEW_EMAIL and VTO_OFFER_PREVIEW_MODE. All three outbound templates (intraday rvtoSendOfferEmail_, legacy week-block rvtoSendWeekBlockOfferEmail_, bundle rvtoSendWeekVtoBundleEmail_) call rvtoSendOfferGmailWithPreview_. BCC mode: rep receives normal To email, preview address on BCC. COPY_ONLY: single email to preview only with yellow banner and subject prefix [VTO preview INTRADAY|WEEK_BLOCK_WEEK|WEEK_BLOCK_BUNDLE]; rep is not emailed (links still commit for rep). OFF or blank email disables. Audit lines append preview suffix.',
     'Operators can verify exact HTML and links per offer type without relying on reps to forward.',
     'Released'],
    ['v1.10.0', '2026-05-13', 'Bobby Sorrell',
     'NEW: Week VTO bundle campaign mode (WEEK_VTO_CAMPAIGN_MODE). PICK_DATES uses WEEK_VTO_PICK_DATES (comma yyyy-MM-dd). DOW_IN_RANGE uses WEEK_VTO_START_DATE, WEEK_VTO_END_DATE, WEEK_VTO_TARGET_DOW (1=Mon..7=Sun). One Gmail lists each qualifying surplus day with separate Accept/Decline links; each day is its own Offers row (RVTO_WK + Notes BUNDLE_ID=). Reuses surplus, eligibility, headroom, and week-block commit. rvtoBuildOfferHistory_ counts each bundle once toward MAX_OFFERS_PER_PERSON_PER_DAY and MAX_EMAILS_PER_24H by Sent At day; OFFER_MIN_GAP_HOURS enforced in rvtoRunWeekBlockBundle_. Per-day DECLINED does not trigger the global 24h decline freeze. rvtoHasPriorWeekBlockOffer_ parses single-date Date column. rvtoAppendWeekBlockOfferRow_ writes BUNDLE_ID and optional Deficit ID column.',
     'Operators can target specific dates or recurring weekdays without forcing a full unpaid week; caps align with intraday offer throttles.',
     'Released'],
    ['v1.9.9', '2026-05-12', 'Bobby Sorrell',
     'FIX: v1.9.8\'s cross-run week-block dedup missed all EXPIRED prior offers. rvtoHasPriorWeekBlockOffer_() identified week-block rows by looking for "WEEK_VTO" in the Notes column, but expireRvtoOffers_() overwrites Notes with "Expired after hold window." on expiry, erasing the tag. First v1.9.8 production campaign (5/12) re-offered the same week (2026-05-24 to 2026-05-30) to Matthew McCarthy, Tonia Turner, and David Iradji — all three had prior 5/7 offers that had EXPIRED with clobbered Notes. Two changes: (1) rvtoHasPriorWeekBlockOffer_() now identifies week-block rows by Offer ID prefix RVTO_APP.WEEK_BLOCK_PREFIX ("RVTO_WK") with Notes tag as secondary signal — Offer ID is immutable and matches doGet() routing; (2) expireRvtoOffers_() now APPENDS " | Expired after hold window." to existing Notes instead of overwriting, so the WEEK_VTO tag, Days: list, and Blocks: schedule survive expiry.',
     'Cross-run week-block dedup now actually works. Reps whose prior offer expired without response are correctly skipped on follow-up campaigns. Notes preservation also makes the Offers sheet useful for post-mortem review of expired offers — the original day list and schedule blocks remain visible.',
     'Released'],
    ['v1.9.8', '2026-05-12', 'Bobby Sorrell',
     'FIX: Week-block VTO had no cross-run de-dup for prior offers. A rep who received a week-block offer that subsequently EXPIRED (or SENT with no response, DECLINED, ACCEPTED, COMMITTED, COMMIT_FAILED) would still be re-offered the same week on a later campaign because rvtoBuildOfferHistory_() explicitly skips WEEK_VTO rows from the cap tracker, and weekBlockSentThisRun only de-dups within a single execution. Running back-to-back campaigns for overlapping weeks therefore duplicated offers to the same reps. New helper rvtoHasPriorWeekBlockOffer_() scans ctx.offerObjects for any WEEK_VTO row for the rep whose date range (parsed from the Date column "yyyy-MM-dd to yyyy-MM-dd", with a Days: fallback in Notes) overlaps the new target range. Match is skipped with a WEEK_BLOCK_DUPLICATE_SKIP audit row logging the prior offer ID, prior date range, and prior status. SEND_FAILED and blank-status rows are ignored — those represent failed deliveries, the rep never actually received the offer.',
     'Prevents duplicate week-block offers across consecutive campaigns. Reps who got a prior week-block offer for an overlapping week are now filtered out before headroom and eligibility checks, regardless of whether they responded.',
     'Released'],
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
}

function rvtoSetupChangelog_(sheet) {
  const headers = ['Version', 'Date', 'Author', 'Change Summary', 'Impact', 'Status'];
  const history = rvtoGetChangelogHistory_();

  if (sheet.getLastRow() <= 1) {
    rvtoSetSheetData_(sheet, headers, history);
    return { added: history.length, total: history.length };
  }
  return rvtoSyncChangelogMissingRows_(sheet, headers, history);
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
        const rampBoost = rvtoEffectiveRampBoostForInterval_(startTime, endTime, ctx);
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
  const pgcCeiling       = rvtoPgcOfferCeilingFromConfig_(ctx.config);
  const pgcMapForCeiling = ctx.pgcByNormalizedName || {};

  const selectedThisRun = ctx.selectedThisRun || (ctx.selectedThisRun = new Set());
  const eligible        = [];
  var debugCounts       = { noEmail: 0, queueMismatch: 0, noFly: 0, shadowExcluded: 0, pgcAboveCeiling: 0, notScheduled: 0, tooManyOffers: 0, passed: 0 };

  roster.forEach(function(person) {
    const email = (person.email || '').trim().toLowerCase();
    if (!email) { debugCounts.noEmail++; return; }
    if (!rvtoWorkGroupMatches_(person.workGroup, workGroupPattern)) { debugCounts.queueMismatch++; return; }
    if (noFlySet.has(rvtoNormalizeName_(person.name))) { debugCounts.noFly++; return; }
    if (shadowEmails.has(email)) { debugCounts.shadowExcluded++; return; }
    if (pgcCeiling !== null && !rvtoRepPassesPgcOfferCeiling_(person.name, pgcMapForCeiling, pgcCeiling)) {
      debugCounts.pgcAboveCeiling++;
      return;
    }

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
    ' | pgcAboveCeiling: ' + debugCounts.pgcAboveCeiling +
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.ROSTER);
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
 * OFFER DELIVERY — Slack + channel router (v1.11.0)
 *************************************************************/

/**
 * EMAIL (default) | SLACK | BOTH. Unknown values default to EMAIL.
 */
function rvtoGetOfferChannelSettings_(config) {
  var raw = String((config && config.VTO_OFFER_CHANNEL) || 'EMAIL').trim().toUpperCase();
  var slack = (raw === 'SLACK' || raw === 'BOTH');
  var email = (raw === 'EMAIL' || raw === 'BOTH' || raw === '' || raw === 'GMAIL');
  if (!slack && !email) email = true;
  return {
    email:              email,
    slack:              slack,
    slackFallbackEmail: rvtoConfigBool_(config && config.VTO_SLACK_FALLBACK_EMAIL, true)
  };
}

/** First token of roster/display name for Slack greetings. */
function rvtoFirstName_(fullName) {
  var parts = String(fullName || '').trim().split(/\s+/);
  return parts.length ? parts[0] : 'there';
}

/** Slack mrkdwn hyperlink: <url|label> */
function rvtoSlackMrkdwnLink_(url, label) {
  var u = String(url || '').trim();
  if (!u) return String(label || '').trim();
  var lbl = String(label || 'link').replace(/\|/g, '/').replace(/</g, '').replace(/>/g, '');
  return '<' + u + '|' + lbl + '>';
}

/**
 * Rep DM, or operator DM when VTO_OFFER_PREVIEW_MODE is COPY_ONLY.
 * Returns { userId, preview, targetEmail } or null.
 */
function rvtoResolveSlackRecipientForOffer_(repEmail, config) {
  var rep = String(repEmail || '').trim().toLowerCase();
  if (!rep) return null;
  var pv = rvtoGetOfferPreviewSettings_(config || {});
  if (pv.active && pv.mode === 'COPY_ONLY') {
    var previewId = rvtoGetSlackUserId_(pv.email);
    if (!previewId) return null;
    return { userId: previewId, preview: true, targetEmail: pv.email };
  }
  var userId = rvtoGetSlackUserId_(rep);
  if (!userId) return null;
  return { userId: userId, preview: false, targetEmail: rep };
}

function rvtoOfferDeliverySucceeded_(slackOk, emailOk, ch) {
  if (ch.slack && ch.email) return !!(slackOk || emailOk);
  if (ch.slack) return !!(slackOk || (ch.slackFallbackEmail && emailOk));
  return !!emailOk;
}

function rvtoOfferDeliveryDetail_(ch, slackOk, emailOk, extra) {
  var parts = [];
  if (ch.slack) parts.push('slack=' + (slackOk ? 'OK' : 'fail'));
  if (ch.email) parts.push('email=' + (emailOk ? 'OK' : 'fail'));
  if (extra) parts.push(extra);
  return parts.join(' | ');
}

/**
 * Sends intraday / week / bundle offer to rep (or preview recipient).
 * Returns true if chat.postMessage succeeded.
 */
function rvtoSendOfferSlackDm_(opts) {
  var config   = opts.config || {};
  var repEmail = String(opts.repEmail || opts.email || '').trim().toLowerCase();
  var message  = String(opts.message || '').trim();
  var refId    = String(opts.refId || opts.offerId || opts.bundleId || '').trim();
  var kind     = String(opts.offerKind || 'VTO');
  if (!message) return false;

  var recipient = rvtoResolveSlackRecipientForOffer_(repEmail, config);
  if (!recipient || !recipient.userId) {
    rvtoAudit_('SEND_SLACK', refId,
      'No Slack user for ' + (recipient && recipient.preview ? 'preview ' : '') + repEmail +
      ' (users.lookupByEmail — check SLACK_BOT_TOKEN and roster email)',
      'FAILED');
    return false;
  }

  if (recipient.preview) {
    message = '*[VTO offer preview — ' + kind + ']*\n' +
      'Preview only — consultant *' + repEmail + '* was *not* DM’d. Links bind to their offer row.\n\n' +
      message;
  }

  var ok = rvtoSendSlackDmReturningOk_(recipient.userId, message);
  var dest = recipient.preview ? ('preview ' + recipient.targetEmail) : repEmail;
  rvtoAudit_('SEND_SLACK', refId,
    (ok ? 'Slack DM to ' : 'Slack DM failed for ') + dest + ' [' + kind + ']' +
      (recipient.preview ? ' (COPY_ONLY)' : ''),
    ok ? 'OK' : 'FAILED');
  return ok;
}

function rvtoSendOfferSlackIntraday_(opts) {
  var config      = opts.config;
  var tz          = config.TIMEZONE || 'America/Chicago';
  var prefix      = config.EMAIL_SUBJECT_PREFIX || 'VTO Opportunity';
  var first       = rvtoFirstName_(opts.name);
  var dateDisplay = rvtoFormatDateDisplay_(opts.date, tz);
  var timeDisplay = rvtoFormatTimeRange_(opts.date, opts.start, opts.end, tz);
  var expiresStr  = Utilities.formatDate(opts.expiresAt, tz, "EEE, MMM d 'at' h:mm a") + ' CT';
  var acceptLink  = opts.acceptUrl  ? rvtoSlackMrkdwnLink_(opts.acceptUrl,  "I'll take it!") : '';
  var declineLink = opts.declineUrl ? rvtoSlackMrkdwnLink_(opts.declineUrl, 'No thanks') : '';
  var actionLine  = [acceptLink, declineLink].filter(Boolean).join('  |  ');

  var message = [
    '*' + prefix + '* — ' + dateDisplay + ', ' + timeDisplay,
    'Hi ' + first + ', voluntary time off is available. Respond before *' + expiresStr + '*.',
    actionLine
  ].filter(Boolean).join('\n');

  return rvtoSendOfferSlackDm_({
    config:    config,
    repEmail:  opts.email,
    refId:     opts.offerId,
    offerKind: 'INTRADAY',
    message:   message
  });
}

function rvtoSendOfferSlackWeekBlock_(opts) {
  var config       = opts.config;
  var tz           = opts.timezone || config.TIMEZONE || 'America/Chicago';
  var prefix       = config.EMAIL_SUBJECT_PREFIX || 'VTO Opportunity';
  var first        = rvtoFirstName_(opts.name);
  var startDisplay = rvtoFormatDateDisplay_(opts.startDateStr, tz);
  var endDisplay   = rvtoFormatDateDisplay_(opts.endDateStr,   tz);
  var expiresStr   = Utilities.formatDate(opts.expiresAt, tz, "EEE, MMM d 'at' h:mm a") + ' CT';
  var dayLines     = (opts.scheduledDays || []).map(function(d) {
    return '• ' + rvtoFormatDateDisplay_(d, tz);
  }).join('\n');
  var acceptLink   = opts.acceptUrl  ? rvtoSlackMrkdwnLink_(opts.acceptUrl,  "I'll take it!") : '';
  var declineLink  = opts.declineUrl ? rvtoSlackMrkdwnLink_(opts.declineUrl, 'No thanks') : '';
  var actionLine   = [acceptLink, declineLink].filter(Boolean).join('  |  ');

  var message = [
    '*' + prefix + '* — ' + startDisplay + ' – ' + endDisplay,
    'Hi ' + first + ', full-week VTO is available:',
    dayLines,
    'Respond before *' + expiresStr + '*.',
    actionLine
  ].filter(Boolean).join('\n');

  return rvtoSendOfferSlackDm_({
    config:    config,
    repEmail:  opts.email,
    refId:     opts.offerId,
    offerKind: 'WEEK_BLOCK_WEEK',
    message:   message
  });
}

function rvtoSendOfferSlackBundle_(opts) {
  var config     = opts.config;
  var tz         = opts.timezone || config.TIMEZONE || 'America/Chicago';
  var prefix     = config.EMAIL_SUBJECT_PREFIX || 'VTO Opportunity';
  var first      = rvtoFirstName_(opts.name);
  var expiresStr = Utilities.formatDate(opts.expiresAt, tz, "EEE, MMM d 'at' h:mm a") + ' CT';
  var dayLines   = (opts.dayOffers || []).map(function(d) {
    var disp = rvtoFormatDateDisplay_(d.dayStr, tz);
    var acc  = d.acceptUrl ? rvtoSlackMrkdwnLink_(d.acceptUrl, "I'll take it!") : '';
    return '• ' + disp + (acc ? '  ' + acc : '');
  }).join('\n');

  var message = [
    '*' + prefix + '*',
    'Hi ' + first + ', voluntary time off is available:',
    dayLines,
    'Respond before *' + expiresStr + '*.'
  ].join('\n');

  return rvtoSendOfferSlackDm_({
    config:    config,
    repEmail:  opts.email,
    refId:     opts.bundleId || '',
    offerKind: 'WEEK_BLOCK_BUNDLE',
    message:   message
  });
}

/** Intraday: routes to Slack and/or email per VTO_OFFER_CHANNEL. */
function rvtoDeliverIntradayOffer_(opts) {
  var config     = opts.config;
  var ch         = rvtoGetOfferChannelSettings_(config);
  var slackOk    = false;
  var emailOk    = false;
  var triedEmail = false;

  if (ch.slack) slackOk = rvtoSendOfferSlackIntraday_(opts);
  if (ch.email) {
    triedEmail = true;
    emailOk = rvtoSendOfferEmail_(opts);
  }
  if (ch.slack && !slackOk && ch.slackFallbackEmail && !emailOk && !triedEmail) {
    emailOk = rvtoSendOfferEmail_(opts);
    triedEmail = true;
  }

  var sent = rvtoOfferDeliverySucceeded_(slackOk, emailOk, ch);
  if (ch.slack) {
    rvtoAudit_('SEND_OFFER', opts.offerId,
      rvtoOfferDeliveryDetail_(ch, slackOk, emailOk, 'intraday') + rvtoOfferPreviewAuditSuffix_(config),
      sent ? 'OK' : 'FAILED');
  }
  return sent;
}

/** Week-block full range. */
function rvtoDeliverWeekBlockOffer_(opts) {
  var config     = opts.config;
  var ch         = rvtoGetOfferChannelSettings_(config);
  var slackOk    = false;
  var emailOk    = false;
  var triedEmail = false;

  if (ch.slack) slackOk = rvtoSendOfferSlackWeekBlock_(opts);
  if (ch.email) {
    triedEmail = true;
    emailOk = rvtoSendWeekBlockOfferEmail_(opts);
  }
  if (ch.slack && !slackOk && ch.slackFallbackEmail && !emailOk && !triedEmail) {
    emailOk = rvtoSendWeekBlockOfferEmail_(opts);
  }

  return rvtoOfferDeliverySucceeded_(slackOk, emailOk, ch);
}

/** Multi-day bundle. */
function rvtoDeliverWeekVtoBundleOffer_(opts) {
  var config     = opts.config;
  var ch         = rvtoGetOfferChannelSettings_(config);
  var slackOk    = false;
  var emailOk    = false;
  var triedEmail = false;

  if (ch.slack) slackOk = rvtoSendOfferSlackBundle_(opts);
  if (ch.email) {
    triedEmail = true;
    emailOk = rvtoSendWeekVtoBundleEmail_(opts);
  }
  if (ch.slack && !slackOk && ch.slackFallbackEmail && !emailOk && !triedEmail) {
    emailOk = rvtoSendWeekVtoBundleEmail_(opts);
  }

  return rvtoOfferDeliverySucceeded_(slackOk, emailOk, ch);
}

/*************************************************************
 * OFFER EMAIL — preview (v1.10.1)
 *************************************************************/

/**
 * Reads VTO_OFFER_PREVIEW_EMAIL / VTO_OFFER_PREVIEW_MODE from Config.
 * mode: OFF | BCC | COPY_ONLY (REDIRECT/PREVIEW_ONLY aliases map to COPY_ONLY).
 */
function rvtoGetOfferPreviewSettings_(config) {
  var preview = String((config && config.VTO_OFFER_PREVIEW_EMAIL) || '').trim();
  if (!preview) return { active: false, email: '', mode: 'OFF' };
  var raw = String((config && config.VTO_OFFER_PREVIEW_MODE) || 'BCC').trim().toUpperCase();
  var mode = 'BCC';
  if (raw === 'OFF' || raw === 'FALSE' || raw === 'NONE') mode = 'OFF';
  else if (raw === 'COPY_ONLY' || raw === 'REDIRECT' || raw === 'PREVIEW_ONLY' || raw === 'OPERATOR_ONLY') {
    mode = 'COPY_ONLY';
  }
  if (mode === 'OFF') return { active: false, email: '', mode: 'OFF' };
  return { active: true, email: preview, mode: mode };
}

/**
 * Sends one Gmail: optional operator preview (BCC or COPY_ONLY).
 * offerKind: INTRADAY | WEEK_BLOCK_WEEK | WEEK_BLOCK_BUNDLE (for banner/subject).
 */
function rvtoSendOfferGmailWithPreview_(opts) {
  var cfg      = opts.config || {};
  var pv       = rvtoGetOfferPreviewSettings_(cfg);
  var fromName = opts.fromName || 'Scheduling Bot';
  var repLc    = String(opts.repEmail || opts.primaryTo || '').trim().toLowerCase();
  var to       = String(opts.primaryTo || '').trim();
  var subject  = String(opts.subject || '');
  var plain    = String(opts.plain != null ? opts.plain : '');
  var html     = String(opts.html || '');
  var kind     = String(opts.offerKind || 'VTO');

  if (!pv.active) {
    GmailApp.sendEmail(to, subject, plain, { name: fromName, htmlBody: html });
    return;
  }

  var pvLc = String(pv.email).trim().toLowerCase();
  if (pvLc === repLc) {
    GmailApp.sendEmail(to, subject, plain, { name: fromName, htmlBody: html });
    return;
  }

  if (pv.mode === 'COPY_ONLY') {
    var banner = "<div style='background:#fff3cd;border:1px solid #e6b800;padding:12px 14px;margin:0 0 18px 0;font-size:13px;line-height:1.45;color:#333;'>" +
      "<strong>[VTO offer preview — " + rvtoEscHtml_(kind) + "]</strong><br>" +
      'This message was sent <em>only</em> to you (operator preview). The real consultant is <strong>' +
      rvtoEscHtml_(opts.repEmail || to) + '</strong> and was <strong>not</strong> emailed in COPY_ONLY mode.<br>' +
      'Accept / Decline links below still apply to <em>that person&rsquo;s</em> offer row in the spreadsheet.</div>';
    var subj = '[VTO preview ' + kind + '] ' + subject + ' | rep: ' + (opts.repEmail || to);
    GmailApp.sendEmail(pv.email, subj, rvtoHtmlToPlain_(html), {
      name: fromName,
      htmlBody: banner + html
    });
    return;
  }

  GmailApp.sendEmail(to, subject, plain, {
    name: fromName,
    htmlBody: html,
    bcc: pv.email
  });
}

/** Short audit fragment describing active preview mode. */
function rvtoOfferPreviewAuditSuffix_(config) {
  var pv = rvtoGetOfferPreviewSettings_(config);
  if (!pv.active) return '';
  if (pv.mode === 'COPY_ONLY') return ' | preview COPY_ONLY to ' + pv.email;
  return ' | preview BCC ' + pv.email;
}


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
    "<p>You have a voluntary time off opportunity available.</p>",
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
    rvtoSendOfferGmailWithPreview_({
      config:     config,
      repEmail:   opts.email,
      offerKind:  'INTRADAY',
      primaryTo:  opts.email,
      subject:    subject,
      plain:      rvtoHtmlToPlain_(html),
      html:       html,
      fromName:   fromName
    });
    rvtoAudit_('SEND_EMAIL', opts.offerId, 'Sent to ' + opts.email + rvtoOfferPreviewAuditSuffix_(config), 'OK');
    return true;
  } catch (err) {
    rvtoAudit_('SEND_EMAIL', opts.offerId, String(err), 'FAILED');
    return false;
  }
}

/*************************************************************
 * DESKTOP ALERTS — Shift Optimizer Web Push hub
 *************************************************************/
var RVTO_BID_ALERT_NOTIFY_URL = 'https://shift-optimizer-varsity-wfm.netlify.app/api/bid-alerts/notify';

function rvtoOfferAlertDetail_(obj, action) {
  var name = String(obj['Name'] || obj['Email'] || 'Rep').trim();
  var tz = (rvtoGetConfig_().TIMEZONE || 'America/Chicago');
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
  var verb = action === 'decline' ? 'declined' : (action === 'committed' ? 'committed' : 'accepted');
  var detail = name + ' ' + verb;
  if (date) detail += ': ' + date;
  if (start && end) detail += ' ' + start + '-' + end;
  if (queue) detail += ' (' + queue + ')';
  return detail;
}

function rvtoOfferAlertNotify_(action, obj, offerId) {
  try {
    var props = PropertiesService.getScriptProperties();
    var config = rvtoGetConfig_();
    var secret = (props.getProperty('BID_ALERT_NOTIFY_SECRET') || String(config.BID_ALERT_NOTIFY_SECRET || '')).trim();
    if (!secret) {
      rvtoAudit_('BID_ALERT_SKIP', offerId || '', 'BID_ALERT_NOTIFY_SECRET not set', 'WARN');
      return;
    }
    var url = (props.getProperty('BID_ALERT_NOTIFY_URL') || RVTO_BID_ALERT_NOTIFY_URL).trim();
    var kind = action === 'decline' ? 'declined' : 'accepted';
    var offerDate = '';
    if (obj['Date'] instanceof Date) {
      offerDate = Utilities.formatDate(obj['Date'], Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd');
    } else {
      offerDate = String(obj['Date'] || '').trim().substring(0, 10);
    }
    var payload = {
      source: 'vto',
      kind: kind,
      consultantName: String(obj['Name'] || obj['Email'] || 'Rep').trim(),
      consultantEmail: String(obj['Email'] || '').trim() || null,
      detail: rvtoOfferAlertDetail_(obj, action),
      offerId: offerId,
      offerDate: offerDate,
      id: action === 'decline' ? ('vto_declined:' + offerId) : ('vto_committed:' + offerId),
      secret: secret
    };
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Bid-Alert-Secret': secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      rvtoAudit_('BID_ALERT_FAIL', offerId || '', 'HTTP ' + code + ': ' + resp.getContentText().slice(0, 200), 'ERROR');
    }
  } catch (err) {
    try {
      rvtoAudit_('BID_ALERT_FAIL', offerId || '', String(err.message || err).slice(0, 200), 'ERROR');
    } catch (auditErr) { /* ignore */ }
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.OFFERS);
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.OFFERS);
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
      // v1.9.9: Append rather than overwrite so the WEEK_VTO tag, Days: list,
      // and Blocks: schedule survive expiry. Cross-run dedup and any
      // downstream tooling that reads expired rows keep working.
      if (idx_notes !== -1) {
        var existingNotes = String(obj['Notes'] || '').trim();
        var expiryMsg     = 'Expired after hold window.';
        var newNotes      = existingNotes
          ? (existingNotes.indexOf(expiryMsg) !== -1 ? existingNotes : existingNotes + ' | ' + expiryMsg)
          : expiryMsg;
        sheet.getRange(i + 1, idx_notes + 1).setValue(newNotes);
      }
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

  const noFlySheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.NO_FLY);
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
    var rampBoostOn = rvtoConfigBool_(config.RAMP_NET_BOOST_ENABLED, true);
    rvtoAudit_('RAMP_INCLUSION', '', ctx.rampRows.length + ' active ramp row(s) — ' +
      (rampBoostOn
        ? 'effective net boosted per enabled queue (intraday + week-block)'
        : 'RAMP_NET_BOOST_ENABLED=FALSE — ramp rows ignored for net staffing (raw Assembled net only)'),
      'INFO');
  }

  ctx.pgcByNormalizedName = rvtoLoadPgcMap_(config);

  return ctx;
}

function rvtoGetAllOfferObjects_() {
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(function(row) { return row.some(function(c) { return c !== ''; }); })
    .map(function(row) { return rvtoRowToObj_(headers, row); });
}

function rvtoGetShadowExclusionEmails_() {
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.SHADOW_EXCLUSION);
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.RAMP_INCLUSION);
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

/**
 * Ramp share applied to interpreted net for surplus/deficit math. Zero when Config
 * RAMP_NET_BOOST_ENABLED is FALSE (matches Staffing timeline without ramp adjustment).
 */
function rvtoEffectiveRampBoostForInterval_(intervalStart, intervalEnd, ctx) {
  if (!rvtoConfigBool_(ctx && ctx.config && ctx.config.RAMP_NET_BOOST_ENABLED, true)) return 0;
  var n = ctx && ctx.enabledQueues ? ctx.enabledQueues.length : 0;
  return rvtoRampNetBoostPerQueue_(intervalStart, intervalEnd, ctx, n);
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

/**
 * Config PGC_OFFER_CEILING: highest PGC that may still receive a VTO offer (inclusive).
 * Same scale as the PGC sheet (e.g. 85 means only people at 85% or below). Null = off.
 */
function rvtoPgcOfferCeilingFromConfig_(config) {
  if (!config) return null;
  var raw = config.PGC_OFFER_CEILING;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  var n = Number(String(raw).trim().replace(/%/g, ''));
  if (!isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Ceiling filter: no PGC row in map → pass. Numeric PGC above ceiling → fail.
 */
function rvtoRepPassesPgcOfferCeiling_(personName, pgcMap, ceiling) {
  if (ceiling === null || ceiling === undefined) return true;
  var map = pgcMap || {};
  var na = rvtoNormalizeName_(personName);
  if (!Object.prototype.hasOwnProperty.call(map, na)) return true;
  var v = map[na];
  if (v === null || v === undefined) return true;
  var p = Number(v);
  if (!isFinite(p)) return true;
  return p <= ceiling;
}

/**
 * 1-based column indexes for the PGC sheet (Script Properties).
 * Defaults: 1 = column A (name), 2 = column B (pGC). Legacy Looker export: 2 and 7.
 */
function rvtoPgcSheetColumnIndexes_() {
  var props = PropertiesService.getScriptProperties();
  var nameCol = parseInt(String(props.getProperty('PGC_NAME_COLUMN') || '1').trim(), 10);
  var valCol = parseInt(String(props.getProperty('PGC_VALUE_COLUMN') || '2').trim(), 10);
  if (!isFinite(nameCol) || nameCol < 1) nameCol = 1;
  if (!isFinite(valCol) || valCol < 1) valCol = 2;
  return {
    name1:   nameCol,
    value1:  valCol,
    nameIdx: nameCol - 1,
    valueIdx: valCol - 1
  };
}

/** Skip header / label rows when scanning the name column. */
function rvtoRowLooksLikePgcHeaderName_(raw) {
  var t = String(raw || '').trim().toLowerCase();
  if (!t) return true;
  if (t === 'name') return true;
  if (t === 'sales rep') return true;
  return false;
}

/** Append PGC rows from a 2-D range (row 0 = header) into map using script column props. */
function rvtoMergePgcRowsIntoMap_(values, cols, map) {
  if (!map) return;
  cols = cols || rvtoPgcSheetColumnIndexes_();
  var ni = cols.nameIdx;
  var vi = cols.valueIdx;
  var needLen = Math.max(ni, vi) + 1;
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row || row.length < needLen) continue;
    var name = String(row[ni] || '').trim();
    if (rvtoRowLooksLikePgcHeaderName_(name)) continue;
    var pgc = rvtoParsePgcValue_(row[vi]);
    if (pgc === null) continue;
    map[rvtoNormalizeName_(name)] = pgc;
  }
}

function rvtoLoadPgcMap_(config) {
  var map = {};
  var usePriority = config && rvtoConfigBool_(config.USE_PGC_PRIORITY, true);
  var ceiling     = rvtoPgcOfferCeilingFromConfig_(config);
  if (!usePriority && ceiling === null) return map;

  var props = PropertiesService.getScriptProperties();
  var idProp = String(props.getProperty('PGC_SPREADSHEET_ID') || '').trim();
  var useActiveFallback = !idProp;
  var id = idProp;
  if (!id) {
    try {
      id = rvtoGetSpreadsheetId_();
    } catch (e0) {
      if (ceiling !== null) {
        rvtoAudit_('PGC_LOAD', '', 'PGC_OFFER_CEILING set but PGC cannot load — set Script Property PGC_SPREADSHEET_ID or run from the bound spreadsheet.', 'WARN');
      }
      return map;
    }
  }

  try {
    var ss = SpreadsheetApp.openById(id);
    var activeId = '';
    try { activeId = rvtoGetSpreadsheetId_(); } catch (eAct) { /* headless */ }

    var sheetNameProp = String(props.getProperty('PGC_SHEET_NAME') || '').trim();
    var sh = null;
    if (sheetNameProp) {
      sh = ss.getSheetByName(sheetNameProp);
    } else if (id === activeId) {
      sh = ss.getSheetByName('PGC');
    }
    if (!sh && ss.getSheets().length) {
      sh = ss.getSheets()[0];
    }
    if (!sh) {
      rvtoAudit_('PGC_LOAD', '', 'PGC sheet not found: ' + (sheetNameProp || (id === activeId ? 'PGC (default) or first tab' : '(first tab)')), 'WARN');
      return map;
    }

    var origSh = sh;
    var values = sh.getDataRange().getValues();
    var cols = rvtoPgcSheetColumnIndexes_();
    rvtoMergePgcRowsIntoMap_(values, cols, map);

    var shPgcAlt = ss.getSheetByName('PGC');
    if (Object.keys(map).length === 0 && shPgcAlt && shPgcAlt.getSheetId() !== sh.getSheetId()) {
      sh = shPgcAlt;
      values = sh.getDataRange().getValues();
      rvtoMergePgcRowsIntoMap_(values, cols, map);
    }

    var mergedFromActiveBound = false;
    if (Object.keys(map).length === 0 && activeId && id !== activeId) {
      try {
        var ssBound = rvtoGetSpreadsheet_();
        if (ssBound && ssBound.getId() === activeId) {
          var shBoundPgc = ssBound.getSheetByName('PGC');
          if (shBoundPgc) {
            rvtoMergePgcRowsIntoMap_(shBoundPgc.getDataRange().getValues(), cols, map);
            if (Object.keys(map).length > 0) mergedFromActiveBound = true;
          }
        }
      } catch (eBound) { /* headless or no access */ }
    }

    var n = Object.keys(map).length;
    var srcTag = mergedFromActiveBound ? 'active_workbook_merged' : (useActiveFallback ? 'active_workbook' : 'external_id');
    var tabDesc = sh.getName();
    if (mergedFromActiveBound) {
      tabDesc = 'PGC (bound workbook; external had 0 usable rows)';
    } else if (n > 0 && origSh.getSheetId() !== sh.getSheetId()) {
      tabDesc = sh.getName() + ' (fallback; "' + origSh.getName() + '" had 0 usable rows)';
    }
    var baseMsg = 'Loaded PGC for ' + n + ' name(s) | nameCol=' + cols.name1 + ' valueCol=' + cols.value1 +
      ' | tab=' + tabDesc + ' | ' + srcTag;
    if (n === 0 && (ceiling !== null || usePriority)) {
      rvtoAudit_('PGC_LOAD', '', baseMsg + ' — CEILING/SORT INACTIVE until rows load: fix PGC_SHEET_NAME / PGC_SPREADSHEET_ID, add a "PGC" tab on the external file, PGC_NAME_COLUMN/PGC_VALUE_COLUMN, or ensure bound workbook "PGC" has values (IMPORTRANGE may be empty for the server until authorized).', 'WARN');
    } else {
      rvtoAudit_('PGC_LOAD', '', baseMsg, 'OK');
    }
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  if (!sheet) return {};
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return {};

  const headers   = values[0];
  const cutoff24h = new Date(now.getTime() - (hoursBack * 60 * 60 * 1000));
  const todayKey  = Utilities.formatDate(now, 'America/Chicago', 'yyyy-MM-dd');
  const out       = {};

  // v1.10.0: One bundle email creates N sheet rows sharing BUNDLE_ID= in Notes.
  // Count each bundle only once toward daily / 24h caps (by Sent At calendar day).
  var bundleCountedToday = {};
  var bundleCounted24h   = {};

  function bundleMarkCounted(store, email, bid) {
    if (!store[email]) store[email] = {};
    if (store[email][bid]) return false;
    store[email][bid] = true;
    return true;
  }

  function extractBundleId_(notesStr) {
    var m = String(notesStr || '').match(/BUNDLE_ID=([^\\s|]+)/);
    return m ? m[1].trim() : '';
  }

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

    const notes = String(obj['Notes'] || '');
    const bundleId = extractBundleId_(notes);

    // Cap-exempt: legacy whole-range week-block rows (no bundle id)
    if (notes.indexOf('WEEK_VTO') !== -1 && !bundleId) return;

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

    // v1.8.0: A DECLINED row pins the counter at cap maximum — except v1.10.0
    // bundle per-day declines should not freeze all other channels for 24h.
    if (status === RVTO_APP.OFFER_STATUSES.DECLINED) {
      if (bundleId) {
        return;
      }
      out[email].sentToday   = 999;
      out[email].sentLast24h = 999;
      out[email].lastSentAt  = sentAt || out[email].lastSentAt;
      return;
    }

    // v1.10.0: Bundle campaign rows — one email = one cap unit (by send date).
    if (bundleId) {
      var sendDayKey = (sentAt && !isNaN(sentAt.getTime()))
        ? Utilities.formatDate(sentAt, 'America/Chicago', 'yyyy-MM-dd')
        : todayKey;
      if (sendDayKey === todayKey) {
        if (bundleMarkCounted(bundleCountedToday, email, bundleId)) {
          out[email].sentToday++;
        }
      }
      if (sentAt && !isNaN(sentAt.getTime()) && sentAt >= cutoff24h) {
        if (bundleMarkCounted(bundleCounted24h, email, bundleId)) {
          out[email].sentLast24h++;
          if (!out[email].lastSentAt || sentAt > out[email].lastSentAt) {
            out[email].lastSentAt = sentAt;
          }
        }
      } else if (status === RVTO_APP.OFFER_STATUSES.PENDING_SEND && sendDayKey === todayKey) {
        if (bundleMarkCounted(bundleCounted24h, email, bundleId)) {
          out[email].sentLast24h++;
        }
      }
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
  const sheet  = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.CONFIG);
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
 * WORKBOOK ACCESS (v1.11.2 — reliable in web app / doGet)
 *************************************************************/

/** Script Property RVTO_SPREADSHEET_ID, else bound workbook when run from the sheet. */
function rvtoGetSpreadsheetId_() {
  var id = (PropertiesService.getScriptProperties().getProperty('RVTO_SPREADSHEET_ID') || '').trim();
  if (id) return id;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss.getId();
  } catch (e) { /* headless */ }
  try {
    var active = SpreadsheetApp.getActive();
    if (active) return active.getId();
  } catch (e2) { /* headless */ }
  return '';
}

/**
 * Opens the Targeted VTO Bot workbook. Web apps must use openById — getActive() often
 * returns null or the wrong file in doGet, which caused "Offer not found" despite valid rows.
 */
function rvtoGetSpreadsheet_() {
  var id = rvtoGetSpreadsheetId_();
  if (!id) {
    throw new Error(
      'Targeted VTO Bot: workbook not configured. Set Script Property RVTO_SPREADSHEET_ID ' +
      'to this spreadsheet\'s ID, or run Setup Workbook once from Extensions > Apps Script ' +
      'while this Targeted VTO Bot file is open.'
    );
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error('Targeted VTO Bot: cannot open spreadsheet RVTO_SPREADSHEET_ID=' + id + ': ' + err);
  }
}

/** Run from Setup Workbook: persists this file's ID for headless web-app / trigger runs. */
function rvtoEnsureSpreadsheetIdProperty_() {
  var props = PropertiesService.getScriptProperties();
  var existing = (props.getProperty('RVTO_SPREADSHEET_ID') || '').trim();
  if (existing) return existing;
  var id = '';
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) id = ss.getId();
  } catch (e) { /* headless */ }
  if (!id) {
    try {
      var active = SpreadsheetApp.getActive();
      if (active) id = active.getId();
    } catch (e2) { /* headless */ }
  }
  if (id) props.setProperty('RVTO_SPREADSHEET_ID', id);
  return id;
}

/*************************************************************
 * OFFER SHEET HELPERS
 *************************************************************/
function rvtoAppendOfferRow_(o) {
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.OFFERS);
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
  const sheet  = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.OFFERS);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  const headers = values[0];
  const col     = headers.indexOf(columnName);
  if (col === -1) return;
  const statusCol = headers.indexOf('Status');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][headers.indexOf('Offer ID')] || '').trim() === offerId) {
      var prevStatus = statusCol >= 0
        ? String(values[i][statusCol] || '').trim().toUpperCase()
        : '';
      sheet.getRange(i + 1, col + 1).setValue(value);
      if (
        columnName === 'Status' &&
        String(value || '').trim().toUpperCase() === RVTO_APP.OFFER_STATUSES.COMMITTED &&
        prevStatus !== RVTO_APP.OFFER_STATUSES.COMMITTED
      ) {
        var obj = rvtoRowToObj_(headers, values[i]);
        obj['Status'] = value;
        rvtoOfferAlertNotify_('committed', obj, offerId);
      } else if (
        columnName === 'Status' &&
        String(value || '').trim().toUpperCase() === RVTO_APP.OFFER_STATUSES.DECLINED &&
        prevStatus !== RVTO_APP.OFFER_STATUSES.DECLINED
      ) {
        var objDecl = rvtoRowToObj_(headers, values[i]);
        objDecl['Status'] = value;
        rvtoOfferAlertNotify_('decline', objDecl, offerId);
      }
      return;
    }
  }
}

/** Install onEdit trigger for Offers Status → COMMITTED / DECLINED desktop alerts. */
function rvtoInstallOfferAlertTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'rvtoOnOffersEdit_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rvtoOnOffersEdit_')
    .forSpreadsheet(rvtoGetSpreadsheet_())
    .onEdit()
    .create();
}

/** Fires desktop alert when Offers Status column is set to COMMITTED or DECLINED. */
function rvtoOnOffersEdit_(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== RVTO_APP.SHEETS.OFFERS) return;
    if (e.range.getColumn() !== 14) return;
    var next = String(e.value || '').trim().toUpperCase();
    var prev = String(e.oldValue || '').trim().toUpperCase();
    if (next === prev) return;
    var action = null;
    if (next === RVTO_APP.OFFER_STATUSES.COMMITTED && prev !== RVTO_APP.OFFER_STATUSES.COMMITTED) {
      action = 'committed';
    } else if (next === RVTO_APP.OFFER_STATUSES.DECLINED && prev !== RVTO_APP.OFFER_STATUSES.DECLINED) {
      action = 'decline';
    }
    if (!action) return;
    var row = e.range.getRow();
    if (row <= 1) return;
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowValues = sheet.getRange(row, 1, row, lastCol).getValues()[0];
    var obj = rvtoRowToObj_(headers, rowValues);
    var offerId = String(obj['Offer ID'] || '').trim();
    if (!offerId) return;
    rvtoOfferAlertNotify_(action, obj, offerId);
  } catch (err) {
    /* never disrupt sheet edits */
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.MANAGER_ALIASES);
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.ROSTER);
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
 * Sends a Slack DM to a user by their Slack user ID. Returns true on success.
 */
function rvtoSendSlackDmReturningOk_(userId, message) {
  try {
    const token   = (PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '').trim();
    if (!token) {
      rvtoAudit_('SLACK_DM', '', 'SLACK_BOT_TOKEN not set in Script Properties', 'WARN');
      return false;
    }
    const openRes = UrlFetchApp.fetch('https://slack.com/api/conversations.open', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ users: userId }),
      muteHttpExceptions: true
    });
    const openData = JSON.parse(openRes.getContentText());
    if (!openData.ok) {
      rvtoAudit_('SLACK_DM', '', 'Failed to open DM channel: ' + openData.error, 'WARN');
      return false;
    }
    const msgRes = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ channel: openData.channel.id, text: message }),
      muteHttpExceptions: true
    });
    const msgData = JSON.parse(msgRes.getContentText());
    if (!msgData.ok) {
      rvtoAudit_('SLACK_DM', '', 'Failed to send DM: ' + msgData.error, 'WARN');
      return false;
    }
    return true;
  } catch (err) {
    rvtoAudit_('SLACK_DM', '', 'DM send exception: ' + String(err), 'WARN');
    return false;
  }
}

/** Manager commit notify — void wrapper. */
function rvtoSendSlackDm_(userId, message) {
  rvtoSendSlackDmReturningOk_(userId, message);
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
  const sheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.AUDIT);
  if (!sheet) return;
  sheet.appendRow([new Date(), event, refId, details, result]);
}

/*************************************************************
 * SETUP HELPERS
 *************************************************************/
function rvtoGetOrCreate_(name) {
  const ss  = rvtoGetSpreadsheet_();
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
  const rosterSheet = rvtoGetSpreadsheet_().getSheetByName(RVTO_APP.SHEETS.ROSTER);
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
  const ss = rvtoGetSpreadsheet_();
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
