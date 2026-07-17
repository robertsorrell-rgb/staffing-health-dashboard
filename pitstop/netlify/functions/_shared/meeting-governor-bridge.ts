/**
 * Meeting adds — port of Meeting Governor (apps-script/meeting-governor.gs).
 *
 * Capacity: net staffing before/after, L7 override, duration/attendee thresholds.
 * Commit: Meeting blocks in Assembled, Meet link, Calendar invite, Slack DM.
 */

export interface MeetingRequestInput {
  managerEmail: string;
  teamName: string;
  title: string;
  date: string; // yyyy-MM-dd CT
  startTime: string; // HH:mm CT
  endTime: string;
  attendeeEmails?: string[];
  meetLink?: string;
}

export interface MeetingCapacityResult {
  decision: "approve" | "deny" | "review";
  reasoning: string;
  netBefore?: number;
  netAfter?: number;
  alternatives?: Array<{ start: string; end: string; label?: string }>;
}

export interface MeetingCommitResult {
  ok: boolean;
  mock: boolean;
  message: string;
  assembledActivityIds?: string[];
}

/** TODO: Port mg net-staffing + threshold checks from meeting-governor.gs */
export async function evaluateMeetingRequest(
  input: MeetingRequestInput,
): Promise<MeetingCapacityResult> {
  void input;
  return {
    decision: "review",
    reasoning: "Meeting capacity check not wired yet (mock).",
  };
}

/** TODO: Port mg commit path (Assembled activities + calendar + Slack) */
export async function commitMeetingRequest(
  input: MeetingRequestInput,
): Promise<MeetingCommitResult> {
  return {
    ok: true,
    mock: true,
    message: `Preview: would book "${input.title}" for ${input.teamName} on ${input.date}`,
  };
}
