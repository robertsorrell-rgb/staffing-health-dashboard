/**
 * Permanent schedule change — port of "Assembled Permanent Schedule Publisher".
 *
 * Reference: Apps Script Schedule Changes tab + menuApply_ / menuPushWorkingHours_
 * Same REST surface: people, activities delete/bulk, working_hours rules, shift_patterns.
 */

import { getAssembledClient } from "./assembled-client.js";

/** Matches Schedule Changes spreadsheet row */
export interface PermanentScheduleInput {
  consultantSlackId: string; // @first.last
  startDate: string; // ISO date yyyy-MM-dd
  weeks?: number;
  pattern: {
    Mon: string;
    Tue: string;
    Wed: string;
    Thu: string;
    Fri: string;
    Sat: string;
    Sun: string;
  };
  /** Also sync working hours rules (menuPushWorkingHours_) */
  syncWorkingHours?: boolean;
  /** Also apply work plans (peopleWorkPlans_applyFromScheduleChanges_) */
  syncWorkPlans?: boolean;
}

export interface PermanentScheduleResult {
  ok: boolean;
  mock: boolean;
  deletedCount?: number;
  createdCount?: number;
  workingHoursRuleId?: string;
  shiftPatternId?: string;
  message: string;
}

/**
 * Full apply: delete window + bulk create + optional WH / work plans.
 * TODO: Port buildSegmentsFromPattern_, apiDeleteActivitiesWindowServerSideChunked_,
 *       apiBulkCreateActivities_, wh_findOrCreateRule_, peopleWorkPlans_* from GAS.
 */
export async function applyPermanentSchedule(
  input: PermanentScheduleInput,
): Promise<PermanentScheduleResult> {
  const assembled = getAssembledClient();
  if (!assembled.isConfigured) {
    return {
      ok: true,
      mock: true,
      message: `Preview: would apply ${input.weeks ?? 8} weeks from ${input.startDate} for ${input.consultantSlackId}`,
    };
  }

  // Phase 2: resolve agent, build segments, delete, bulk create
  return {
    ok: false,
    mock: false,
    message: "Permanent schedule commit not ported yet — use Schedule Changes sheet or bridge URL.",
  };
}
