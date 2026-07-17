/**
 * Capacity engine — delegates to Apps Script sheet logic when configured.
 * Fallback mock only when no bridge URL is set (local dev).
 */

import {
  evaluateViaSheetLogic,
  isSheetLogicConfigured,
  type SheetLogicEvaluateResponse,
} from "./sheet-logic-bridge.js";

export interface TimeSlot {
  start: string;
  end: string;
  label?: string;
}

export type CapacityDecision = "approve" | "deny" | "review";

export interface CapacityInput {
  changeType: string;
  queueIds: string[];
  windowStart: string;
  windowEnd: string;
  staffingDeltaFte?: number;
  payload?: Record<string, unknown>;
  requestId?: string;
  requesterEmail?: string;
}

export interface CapacityResult extends SheetLogicEvaluateResponse {
  mock?: boolean;
}

export interface CapacityEngine {
  evaluate(input: CapacityInput): Promise<CapacityResult>;
}

const ONE_OFF_TYPES = new Set([
  "move_block_start",
  "move_block_end",
  "change_activity_type",
  "delete_activity",
  "add_activity",
]);

export class SheetLogicCapacityEngine implements CapacityEngine {
  async evaluate(input: CapacityInput): Promise<CapacityResult> {
    if (!isSheetLogicConfigured(input.changeType)) {
      return new MockCapacityEngine().evaluate(input);
    }

    if (!input.requesterEmail) {
      throw new Error("requesterEmail required for sheet logic evaluation");
    }

    const result = await evaluateViaSheetLogic({
      action: "evaluate",
      changeType: input.changeType,
      requestId: input.requestId,
      requesterEmail: input.requesterEmail,
      payload: {
        ...input.payload,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        queueIds: input.queueIds,
        staffingDeltaFte: input.staffingDeltaFte,
      },
    });

    return result;
  }
}

/** Local dev only — when bridge URLs are unset */
export class MockCapacityEngine implements CapacityEngine {
  async evaluate(input: CapacityInput): Promise<CapacityResult> {
    const delta = input.staffingDeltaFte ?? 0;

    if (input.changeType === "permanent_schedule_change") {
      return {
        decision: "review",
        reasoning:
          "Permanent schedule changes require WFM approval (preview: sheet logic not configured).",
        autoCommit: false,
        mock: true,
        source: "mock",
      };
    }

    if (input.changeType === "add_meeting") {
      return {
        decision: "review",
        reasoning:
          "Meeting requests use live net-staffing checks (preview: deploy PITSTOP_MEETING_LOGIC_URL).",
        autoCommit: false,
        mock: true,
        source: "mock",
      };
    }

    if (ONE_OFF_TYPES.has(input.changeType)) {
      if (delta < -2) {
        return {
          decision: "deny",
          reasoning: "Would drop net staffing below buffer (mock — configure sheet logic for real check).",
          alternatives: buildAlternatives(input.windowStart, 30),
          mock: true,
          source: "mock",
        };
      }
      if (delta < -0.5) {
        return {
          decision: "review",
          reasoning: "Borderline capacity — WFM review (mock).",
          autoCommit: false,
          mock: true,
          source: "mock",
        };
      }
      return {
        decision: "approve",
        reasoning: "Within buffer (mock).",
        autoCommit: true,
        mock: true,
        source: "mock",
      };
    }

    return {
      decision: "review",
      reasoning: `Unknown change type "${input.changeType}" — sent for review.`,
      mock: true,
      source: "mock",
    };
  }
}

function buildAlternatives(baseStart: string, offsetMinutes: number): TimeSlot[] {
  const base = new Date(baseStart);
  const slots: TimeSlot[] = [];
  for (const mins of [-offsetMinutes, offsetMinutes, offsetMinutes * 2]) {
    const start = new Date(base.getTime() + mins * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    slots.push({
      start: start.toISOString(),
      end: end.toISOString(),
      label: mins > 0 ? `+${mins} min` : `${mins} min`,
    });
  }
  return slots;
}

let engine: CapacityEngine | null = null;

export function getCapacityEngine(): CapacityEngine {
  if (!engine) engine = new SheetLogicCapacityEngine();
  return engine;
}
