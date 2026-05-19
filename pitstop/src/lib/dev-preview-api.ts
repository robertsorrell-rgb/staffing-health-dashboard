import type { ScheduleChangePayload, ScheduleChangeResponse } from "./api-client";

/** Mock approve so the vertical slice works with Vite-only (no Netlify/Supabase) */
export async function mockScheduleChange(
  payload: ScheduleChangePayload,
): Promise<ScheduleChangeResponse> {
  await new Promise((r) => setTimeout(r, 400));
  return {
    changeRequestId: "dev-mock-request",
    decision: "approve",
    status: "approved",
    reasoning: "Preview mode — change auto-approved (no server).",
    assembled: { ok: true, mock: true },
    mockEngine: true,
  };
}
