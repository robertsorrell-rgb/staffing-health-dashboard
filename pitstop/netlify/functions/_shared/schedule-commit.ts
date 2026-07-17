/**
 * Routes an approved change_request to the correct commit adapter.
 */

import { getAssembledClient } from "./assembled-client.js";
import {
  applyPermanentSchedule,
  type PermanentScheduleInput,
} from "./permanent-schedule.js";
import {
  commitMeetingRequest,
  type MeetingRequestInput,
} from "./meeting-governor-bridge.js";

export interface CommitInput {
  changeType: string;
  payload: Record<string, unknown>;
}

export interface CommitResult {
  ok: boolean;
  mock: boolean;
  detail?: Record<string, unknown>;
}

const ONE_OFF_TYPES = new Set([
  "move_block_start",
  "move_block_end",
  "change_activity_type",
  "delete_activity",
  "add_activity",
]);

export async function commitScheduleChange(input: CommitInput): Promise<CommitResult> {
  const { changeType, payload } = input;

  if (changeType === "permanent_schedule_change") {
    const result = await applyPermanentSchedule(payload as unknown as PermanentScheduleInput);
    return { ok: result.ok, mock: result.mock, detail: result as unknown as Record<string, unknown> };
  }

  if (changeType === "add_meeting") {
    const result = await commitMeetingRequest(payload as unknown as MeetingRequestInput);
    return { ok: result.ok, mock: result.mock, detail: result as unknown as Record<string, unknown> };
  }

  if (ONE_OFF_TYPES.has(changeType) && changeType === "move_block_start") {
    const assembled = getAssembledClient();
    const activityId = String(payload.activityId ?? "");
    const newStart = String(payload.newStart ?? "");
    if (!activityId || !newStart) {
      return { ok: false, mock: false, detail: { error: "Missing activityId or newStart" } };
    }
    const res = await assembled.updateActivityStart(activityId, newStart);
    return { ok: res.ok, mock: res.mock, detail: res as unknown as Record<string, unknown> };
  }

  if (ONE_OFF_TYPES.has(changeType)) {
    return {
      ok: false,
      mock: true,
      detail: { message: `One-off commit for ${changeType} not implemented yet` },
    };
  }

  return { ok: false, mock: false, detail: { error: `Unknown changeType: ${changeType}` } };
}
