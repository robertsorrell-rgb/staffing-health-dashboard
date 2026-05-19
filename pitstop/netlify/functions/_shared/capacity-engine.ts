/**
 * Capacity engine — evaluates proposed schedule changes against net staffing.
 * v0.1: mock implementation. Real logic will be ported from Meeting Governor.
 */

export interface TimeSlot {
  start: string; // ISO datetime
  end: string;
  label?: string;
}

export type CapacityDecision = "approve" | "deny" | "review";

export interface CapacityInput {
  changeType: string;
  queueIds: string[];
  windowStart: string;
  windowEnd: string;
  /** Net staffing delta in FTE (negative = removes capacity) */
  staffingDeltaFte?: number;
  payload?: Record<string, unknown>;
}

export interface CapacityResult {
  decision: CapacityDecision;
  reasoning: string;
  alternatives?: TimeSlot[];
  /** Mock metadata for debugging */
  mock?: boolean;
}

export interface CapacityEngine {
  evaluate(input: CapacityInput): Promise<CapacityResult>;
}

/** Mock: always approves shift moves unless delta is very negative */
export class MockCapacityEngine implements CapacityEngine {
  async evaluate(input: CapacityInput): Promise<CapacityResult> {
    const delta = input.staffingDeltaFte ?? 0;

    if (input.changeType === "move_shift_start" || input.changeType === "move_shift_end") {
      if (delta < -2) {
        return {
          decision: "deny",
          reasoning:
            "Moving this block would drop net staffing below the buffer for this queue during peak hours.",
          alternatives: buildAlternatives(input.windowStart, 30),
          mock: true,
        };
      }
      if (delta < -0.5) {
        return {
          decision: "review",
          reasoning:
            "This change is borderline — WFM will review within a few minutes.",
          mock: true,
        };
      }
      return {
        decision: "approve",
        reasoning: "Net staffing remains within buffer after this change.",
        mock: true,
      };
    }

    return {
      decision: "approve",
      reasoning: `Change type "${input.changeType}" auto-approved (mock engine).`,
      mock: true,
    };
  }
}

function buildAlternatives(baseStart: string, offsetMinutes: number): TimeSlot[] {
  const base = new Date(baseStart);
  const slots: TimeSlot[] = [];
  for (const mins of [-offsetMinutes, offsetMinutes, offsetMinutes * 2]) {
    const start = new Date(base.getTime() + mins * 60_000);
    const end = new Date(start.getTime() + 8 * 60 * 60_000);
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
  if (!engine) engine = new MockCapacityEngine();
  return engine;
}
