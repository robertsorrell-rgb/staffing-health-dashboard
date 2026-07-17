/**
 * Calls deployed Apps Script web apps that run Meeting Governor / Permanent Publisher logic.
 * This is the source of truth for approve / deny / review — not the mock engine.
 */

import { env } from "./env.js";
import type { CapacityDecision, CapacityResult, TimeSlot } from "./capacity-engine.js";

export interface SheetLogicEvaluateRequest {
  action: "evaluate";
  changeType: string;
  requestId?: string;
  requesterEmail: string;
  payload: Record<string, unknown>;
}

export interface SheetLogicCommitRequest {
  action: "commit";
  changeType: string;
  requestId: string;
  requesterEmail: string;
  approvedByEmail?: string;
  payload: Record<string, unknown>;
}

export interface SheetLogicEvaluateResponse {
  decision: CapacityDecision;
  reasoning: string;
  alternatives?: TimeSlot[];
  /** When true, Pitstop may commit immediately after evaluate (MG auto-approve paths) */
  autoCommit?: boolean;
  /** Sheet-side audit lines (also mirrored in Supabase) */
  sheetAudit?: string[];
  details?: Record<string, unknown>;
  mock?: boolean;
  source?: string;
}

export interface SheetLogicCommitResponse {
  ok: boolean;
  message: string;
  mock?: boolean;
  details?: Record<string, unknown>;
}

function bridgeSecret(): string {
  return env("PITSTOP_BRIDGE_SECRET");
}

function meetingLogicUrl(): string {
  return env("PITSTOP_MEETING_LOGIC_URL");
}

function permanentLogicUrl(): string {
  return env("PITSTOP_PERMANENT_LOGIC_URL");
}

function scheduleLogicUrl(): string {
  return env("PITSTOP_SHEET_LOGIC_URL");
}

function urlForChangeType(changeType: string): string {
  if (changeType === "add_meeting") return meetingLogicUrl() || scheduleLogicUrl();
  if (changeType === "permanent_schedule_change") {
    return permanentLogicUrl() || scheduleLogicUrl();
  }
  return scheduleLogicUrl() || meetingLogicUrl();
}

async function postToSheetLogic<T>(url: string, body: unknown): Promise<T> {
  const secret = bridgeSecret();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "X-Pitstop-Secret": secret } : {}),
    },
    body: JSON.stringify(body),
    redirect: "follow",
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Sheet logic returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg =
      typeof json === "object" && json && "error" in json
        ? String((json as { error: string }).error)
        : text.slice(0, 300);
    throw new Error(`Sheet logic HTTP ${res.status}: ${msg}`);
  }

  return json as T;
}

export function isSheetLogicConfigured(changeType: string): boolean {
  return Boolean(urlForChangeType(changeType));
}

export async function evaluateViaSheetLogic(
  input: SheetLogicEvaluateRequest,
): Promise<SheetLogicEvaluateResponse> {
  const url = urlForChangeType(input.changeType);
  if (!url) {
    return {
      decision: "review",
      reasoning: "Sheet logic URL not configured — set PITSTOP_MEETING_LOGIC_URL or PITSTOP_SHEET_LOGIC_URL.",
      mock: true,
      source: "unconfigured",
    };
  }

  const result = await postToSheetLogic<SheetLogicEvaluateResponse>(url, input);
  return { ...result, source: result.source ?? "apps-script" };
}

export async function commitViaSheetLogic(
  input: SheetLogicCommitRequest,
): Promise<SheetLogicCommitResponse> {
  const url = urlForChangeType(input.changeType);
  if (!url) {
    return {
      ok: false,
      message: "Sheet logic URL not configured for commit.",
      mock: true,
    };
  }

  return postToSheetLogic<SheetLogicCommitResponse>(url, input);
}
