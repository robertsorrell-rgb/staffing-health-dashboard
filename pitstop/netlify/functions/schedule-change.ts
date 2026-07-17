import { z } from "zod";
import { apiHandler, jsonResponse, methodNotAllowed, parseJsonBody } from "./_shared/http.js";
import { verifyBearerToken, getSupabaseAdmin } from "./_shared/supabase-server.js";
import { getCapacityEngine } from "./_shared/capacity-engine.js";
import { commitScheduleChange } from "./_shared/schedule-commit.js";
import { commitViaSheetLogic, isSheetLogicConfigured } from "./_shared/sheet-logic-bridge.js";
import { writeAuditLog } from "./_shared/audit.js";
import { sendSlackDm } from "./_shared/slack-client.js";
import { env } from "./_shared/env.js";

const changeTypeSchema = z.enum([
  "move_block_start",
  "move_block_end",
  "change_activity_type",
  "delete_activity",
  "add_activity",
  "add_meeting",
  "permanent_schedule_change",
]);

const bodySchema = z.object({
  consultantId: z.string(),
  consultantName: z.string(),
  activityId: z.string().optional().default(""),
  changeType: changeTypeSchema,
  newStart: z.string().datetime().optional(),
  newEnd: z.string().datetime().optional(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  queueIds: z.array(z.string()).default([]),
  staffingDeltaFte: z.number().optional(),
  /** Meeting / permanent payloads — passed through to sheet logic */
  managerEmail: z.string().email().optional(),
  managerName: z.string().optional(),
  title: z.string().optional(),
  teamName: z.string().optional(),
  date: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  attendeeEmails: z.array(z.string()).optional(),
  consultantSlackId: z.string().optional(),
  startDate: z.string().optional(),
  weeks: z.number().optional(),
  pattern: z.record(z.string()).optional(),
});

export const handler = apiHandler(async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed();

  const { profile, user } = await verifyBearerToken(
    event.headers.authorization ?? event.headers.Authorization,
  );

  const body = bodySchema.parse(parseJsonBody(event.body));
  const admin = getSupabaseAdmin();
  const payload = body as unknown as Record<string, unknown>;

  // 1. Always log the submission first (audit trail)
  const { data: changeRequest, error: insertError } = await admin
    .from("change_requests")
    .insert({
      requester_id: profile.id,
      team_id: profile.team_id,
      rep_assembled_id: body.consultantId,
      rep_name: body.consultantName,
      change_type: body.changeType,
      payload: body,
      status: "pending",
      capacity_decision: null,
      capacity_reasoning: "Pending sheet logic evaluation",
      assembled_activity_id: body.activityId || null,
    })
    .select("id")
    .single();

  if (insertError || !changeRequest) {
    throw new Error(`Failed to persist change request: ${insertError?.message}`);
  }

  await writeAuditLog({
    actorId: profile.id,
    action: "schedule_change.submitted",
    entityType: "change_request",
    entityId: changeRequest.id,
    metadata: { changeType: body.changeType, consultantName: body.consultantName },
  });

  // 2. Evaluate via sheet logic (Meeting Governor, permanent publisher rules, etc.)
  const engine = getCapacityEngine();
  const capacity = await engine.evaluate({
    changeType: body.changeType,
    queueIds: body.queueIds,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
    staffingDeltaFte: body.staffingDeltaFte,
    payload,
    requestId: changeRequest.id,
    requesterEmail: user.email ?? profile.email,
  });

  const status =
    capacity.decision === "approve"
      ? "approved"
      : capacity.decision === "deny"
        ? "denied"
        : "review";

  await admin
    .from("change_requests")
    .update({
      status,
      capacity_decision: capacity.decision,
      capacity_reasoning: capacity.reasoning,
      alternatives: capacity.alternatives ?? null,
      updated_at: new Date().toISOString(),
      resolved_at:
        capacity.decision === "approve" && capacity.autoCommit !== false
          ? new Date().toISOString()
          : null,
    })
    .eq("id", changeRequest.id);

  await writeAuditLog({
    actorId: profile.id,
    action: "schedule_change.evaluated",
    entityType: "change_request",
    entityId: changeRequest.id,
    metadata: {
      decision: capacity.decision,
      reasoning: capacity.reasoning,
      source: capacity.source,
      sheetAudit: capacity.sheetAudit,
      details: capacity.details,
      mock: capacity.mock,
    },
  });

  // 3. Commit only when sheet logic says approve AND autoCommit (not WFM-review queue)
  let commitResult: Awaited<ReturnType<typeof commitScheduleChange>> | null = null;
  const shouldAutoCommit =
    capacity.decision === "approve" &&
    capacity.autoCommit !== false;

  if (shouldAutoCommit) {
    if (isSheetLogicConfigured(body.changeType)) {
      const sheetCommit = await commitViaSheetLogic({
        action: "commit",
        changeType: body.changeType,
        requestId: changeRequest.id,
        requesterEmail: user.email ?? profile.email,
        payload,
      });
      commitResult = {
        ok: sheetCommit.ok,
        mock: sheetCommit.mock ?? false,
        detail: sheetCommit as unknown as Record<string, unknown>,
      };
    } else {
      commitResult = await commitScheduleChange({
        changeType: body.changeType,
        payload,
      });
    }

    await writeAuditLog({
      actorId: profile.id,
      action: "schedule_change.committed",
      entityType: "change_request",
      entityId: changeRequest.id,
      metadata: { commit: commitResult },
    });
  }

  if (capacity.decision === "review") {
    const wfmChannel = env("PITSTOP_WFM_SLACK_USER_ID");
    await sendSlackDm(
      wfmChannel || "wfm-channel-stub",
      `Pitstop review: ${profile.email} submitted ${body.changeType} for ${body.consultantName}.\n${capacity.reasoning}\nRequest ID: ${changeRequest.id}`,
    );
  }

  return jsonResponse(200, {
    changeRequestId: changeRequest.id,
    decision: capacity.decision,
    status,
    reasoning: capacity.reasoning,
    alternatives: capacity.alternatives,
    autoCommit: capacity.autoCommit,
    commit: commitResult,
    sheetLogicSource: capacity.source,
    mockEngine: capacity.mock ?? false,
  });
});
