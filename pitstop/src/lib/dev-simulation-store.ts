/**
 * In-browser simulation: fake submissions + sheet logic audit trail (localStorage).
 */

import type { ScheduleChangeType } from "@/types/change-request";

export type SimDecision = "approve" | "deny" | "review";
export type SimStatus = "pending" | "approved" | "denied" | "review";

export interface SimSubmission {
  id: string;
  createdAt: string;
  updatedAt: string;
  changeType: ScheduleChangeType;
  consultantName: string;
  consultantId: string;
  status: SimStatus;
  capacityDecision: SimDecision | null;
  reasoning: string;
  alternatives?: Array<{ start: string; end: string; label?: string }>;
  payload: Record<string, unknown>;
  sheetAudit: string[];
  committed: boolean;
}

const STORAGE_KEY = "pitstop-sim-submissions";

function load(): SimSubmission[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SimSubmission[];
  } catch {
    return [];
  }
}

function save(items: SimSubmission[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function listSimSubmissions(): SimSubmission[] {
  return load().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSimSubmission(id: string): SimSubmission | undefined {
  return load().find((s) => s.id === id);
}

export function addSimSubmission(
  partial: Omit<SimSubmission, "id" | "createdAt" | "updatedAt">,
): SimSubmission {
  const now = new Date().toISOString();
  const item: SimSubmission = {
    ...partial,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const items = load();
  items.unshift(item);
  save(items);
  return item;
}

export function updateSimSubmission(
  id: string,
  patch: Partial<SimSubmission>,
): SimSubmission | undefined {
  const items = load();
  const idx = items.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  items[idx] = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
  save(items);
  return items[idx];
}

export function seedSimSubmissionsIfEmpty() {
  if (load().length > 0) return;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  addSimSubmission({
    changeType: "move_block_start",
    consultantName: "Alex Rivera",
    consultantId: "consultant-002",
    status: "approved",
    capacityDecision: "approve",
    reasoning: "Post-meeting net staffing (2.4) meets buffer (≥1). [Simulated capacity check]",
    sheetAudit: ["Net=3.2 attendees=4 post=2.4", "Auto-approved"],
    payload: { deltaMinutes: 30 },
    committed: true,
  });

  addSimSubmission({
    changeType: "add_meeting",
    consultantName: "Team — High School SC",
    consultantId: "team",
    status: "denied",
    capacityDecision: "deny",
    reasoning: "Would drop below net staffing buffer (post-meeting net 0.2).",
    alternatives: [
      {
        start: new Date().toISOString(),
        end: new Date(Date.now() + 3600000).toISOString(),
        label: "Wed 10:00a–11:00a CT",
      },
      {
        start: new Date(Date.now() + 86400000).toISOString(),
        end: new Date(Date.now() + 90000000).toISOString(),
        label: "Thu 2:00p–3:00p CT",
      },
    ],
    sheetAudit: ["Net=4.1 attendees=6 post=0.2", "Denied — alternatives generated"],
    payload: { title: "Pipeline review", date: "2026-05-20" },
    committed: false,
  });

  addSimSubmission({
    changeType: "permanent_schedule_change",
    consultantName: "Sam Patel",
    consultantId: "consultant-003",
    status: "review",
    capacityDecision: "review",
    reasoning:
      "Permanent schedule change logged for WFM approval — same rules as Schedule Changes tab before Apply.",
    sheetAudit: ["Pattern parses OK; 8 weeks from 2026-05-26", "Queued for WFM"],
    payload: { consultantSlackId: "@sam.patel", weeks: 8 },
    committed: false,
  });
}

export function resetSimSubmissions() {
  localStorage.removeItem(STORAGE_KEY);
  seedSimSubmissionsIfEmpty();
}
