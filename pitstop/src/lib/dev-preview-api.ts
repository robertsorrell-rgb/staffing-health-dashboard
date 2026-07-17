import type { ScheduleChangePayload, ScheduleChangeResponse } from "./api-client";
import {
  addSimSubmission,
  getSimSubmission,
  updateSimSubmission,
  type SimDecision,
} from "./dev-simulation-store";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simulates Apps Script sheet logic → decision → optional commit */
export async function mockScheduleChange(
  payload: ScheduleChangePayload & Record<string, unknown>,
): Promise<ScheduleChangeResponse> {
  await delay(650);

  const evaluation = simulateSheetLogic(payload);
  const status =
    evaluation.decision === "approve"
      ? "approved"
      : evaluation.decision === "deny"
        ? "denied"
        : "review";

  const submission = addSimSubmission({
    changeType: payload.changeType,
    consultantName: payload.consultantName,
    consultantId: payload.consultantId,
    status: status as "approved" | "denied" | "review",
    capacityDecision: evaluation.decision,
    reasoning: evaluation.reasoning,
    alternatives: evaluation.alternatives,
    sheetAudit: evaluation.sheetAudit,
    payload: payload as Record<string, unknown>,
    committed: false,
  });

  let commit: ScheduleChangeResponse["commit"] = null;

  if (evaluation.decision === "approve" && evaluation.autoCommit) {
    await delay(400);
    updateSimSubmission(submission.id, { committed: true });
    commit = {
      ok: true,
      mock: true,
      detail: {
        message: simulateCommitMessage(payload.changeType),
        simulatedSheetWrite: true,
      },
    };
  }

  return {
    changeRequestId: submission.id,
    decision: evaluation.decision,
    status,
    reasoning: evaluation.reasoning,
    alternatives: evaluation.alternatives,
    autoCommit: evaluation.autoCommit,
    commit,
    sheetLogicSource: "simulation",
    mockEngine: true,
  };
}

interface SimEvaluation {
  decision: SimDecision;
  reasoning: string;
  alternatives?: Array<{ start: string; end: string; label?: string }>;
  autoCommit: boolean;
  sheetAudit: string[];
}

function simulateSheetLogic(
  payload: ScheduleChangePayload & Record<string, unknown>,
): SimEvaluation {
  switch (payload.changeType) {
    case "add_meeting":
      return simulateMeeting(payload);
    case "permanent_schedule_change":
      return simulatePermanent(payload);
    default:
      return simulateOneOff(payload);
  }
}

function simulateOneOff(
  payload: ScheduleChangePayload & Record<string, unknown>,
): SimEvaluation {
  const delta = Number(payload.staffingDeltaFte ?? 0);
  const minutes =
    payload.newStart && payload.windowStart
      ? (new Date(payload.newStart).getTime() - new Date(payload.windowStart).getTime()) / 60000
      : 0;

  if (minutes >= 60 || delta > 0.5) {
    return {
      decision: "deny",
      reasoning:
        "Would drop below net staffing buffer (post-change net 0.3). [Simulated — large move backward]",
      autoCommit: false,
      sheetAudit: [`Net=2.1 delta=${minutes}min`, "Denied — alternatives generated"],
      alternatives: buildFakeAlternatives(payload.windowStart, 60),
    };
  }

  if (minutes <= -45 || delta < -0.4) {
    return {
      decision: "review",
      reasoning: "Borderline capacity impact — WFM will review shortly. [Simulated]",
      autoCommit: false,
      sheetAudit: ["Net=1.4 — below comfort", "Routed to WFM queue"],
    };
  }

  return {
    decision: "approve",
    reasoning: "Net staffing remains within buffer after this change. [Simulated auto-approve]",
    autoCommit: true,
    sheetAudit: [`Net=3.0 shift=${minutes > 0 ? "+" : ""}${Math.round(minutes)}min`, "Approved"],
  };
}

function simulateMeeting(
  payload: ScheduleChangePayload & Record<string, unknown>,
): SimEvaluation {
  const startTime = String(payload.startTime || "14:00");
  const hour = parseInt(startTime.split(":")[0], 10);

  // Peak hour → deny with alternatives (like production meeting checks)
  if (hour >= 13 && hour <= 15) {
    return {
      decision: "deny",
      reasoning:
        "Would drop below net staffing buffer (post-meeting net 0.2). [Simulated capacity check]",
      autoCommit: false,
      sheetAudit: ["Net=4.1 attendees=6 post=0.2", "Denied — 3 alternatives"],
      alternatives: [
        { start: isoToday(10, 0), end: isoToday(11, 0), label: "Today 10:00a–11:00a CT" },
        { start: isoToday(16, 0), end: isoToday(17, 0), label: "Today 4:00p–5:00p CT" },
        { start: isoTomorrow(9, 30), end: isoTomorrow(10, 30), label: "Tomorrow 9:30a–10:30a CT" },
      ],
    };
  }

  if (hour < 9) {
    return {
      decision: "approve",
      reasoning: "Meetings under 30 minutes auto-approve (simulated duration rule).",
      autoCommit: true,
      sheetAudit: ["Under duration threshold", "Auto-approved"],
    };
  }

  return {
    decision: "approve",
    reasoning: `Post-meeting net staffing (2.1) meets buffer (≥1). [Simulated MG approve]`,
    autoCommit: true,
    sheetAudit: [`Net=3.4 attendees=5 post=2.1`, "Approved — would write Requests row + Assembled"],
  };
}

function simulatePermanent(
  payload: ScheduleChangePayload & Record<string, unknown>,
): SimEvaluation {
  const slack = String(payload.consultantSlackId || "");
  if (!slack.startsWith("@")) {
    return {
      decision: "deny",
      reasoning: "Invalid consultant Slack ID — must be @first.last format. [Simulated]",
      autoCommit: false,
      sheetAudit: ["Pattern validation failed"],
    };
  }

  return {
    decision: "review",
    reasoning:
      "Permanent schedule change logged for WFM approval — same rules as Schedule Changes tab before Apply. [Simulated]",
    autoCommit: false,
    sheetAudit: [
      `Pattern parses OK; ${payload.weeks ?? 8} weeks`,
      "Queued for WFM — no Schedule Changes row written yet",
    ],
  };
}

function simulateCommitMessage(changeType: string): string {
  switch (changeType) {
    case "add_meeting":
      return "Simulated: appended Requests row → mgProcessRow_ → Meeting blocks in Assembled";
    case "permanent_schedule_change":
      return "Simulated: appended Schedule Changes row → menuApply_";
    default:
      return "Simulated: PATCH activity in Assembled";
  }
}

function buildFakeAlternatives(windowStart: string, offsetMin: number) {
  const base = new Date(windowStart);
  return [-offsetMin, offsetMin, offsetMin * 2].map((mins) => {
    const start = new Date(base.getTime() + mins * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      label: mins > 0 ? `+${mins} min` : `${mins} min`,
    };
  });
}

function isoToday(h: number, m: number) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function isoTomorrow(h: number, m: number) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

/** WFM approve/deny in simulation */
export async function mockWfmApprove(
  changeRequestId: string,
  decision: "approve" | "deny",
  notes?: string,
): Promise<{ status: string; commit?: ScheduleChangeResponse["commit"] }> {
  await delay(500);
  const existing = getSimSubmission(changeRequestId);
  if (!existing) throw new Error("Submission not found");

  const sub = updateSimSubmission(changeRequestId, {
    status: decision === "approve" ? "approved" : "denied",
    capacityDecision: decision,
    reasoning:
      existing.reasoning + (notes ? ` | WFM: ${notes}` : ` | WFM ${decision}`),
    committed: decision === "approve",
  })!;

  return {
    status: sub.status,
    commit:
      decision === "approve"
        ? {
            ok: true,
            mock: true,
            detail: { message: simulateCommitMessage(sub.changeType) },
          }
        : undefined,
  };
}

export async function mockFetchApprovals() {
  const { listSimSubmissions } = await import("./dev-simulation-store");
  return {
    requests: listSimSubmissions().map((s) => ({
      id: s.id,
      change_type: s.changeType,
      status: s.status,
      capacity_decision: s.capacityDecision,
      capacity_reasoning: s.reasoning,
      alternatives: s.alternatives,
      rep_name: s.consultantName,
      payload: s.payload,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    })),
  };
}
