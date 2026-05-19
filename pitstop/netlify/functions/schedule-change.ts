import { z } from "zod";
import { apiHandler, jsonResponse, methodNotAllowed, parseJsonBody } from "./_shared/http.js";
import { verifyBearerToken } from "./_shared/supabase-server.js";
import { getCapacityEngine } from "./_shared/capacity-engine.js";
import { getAssembledClient } from "./_shared/assembled-client.js";
import { writeAuditLog } from "./_shared/audit.js";
import { getSupabaseAdmin } from "./_shared/supabase-server.js";
import { sendSlackDm } from "./_shared/slack-client.js";

const bodySchema = z.object({
  repId: z.string(),
  repName: z.string(),
  activityId: z.string(),
  changeType: z.enum([
    "move_shift_start",
    "move_shift_end",
    "change_activity_type",
    "delete_activity",
    "add_activity",
  ]),
  /** ISO datetime for the new start (used by move_shift_start vertical slice) */
  newStart: z.string().datetime().optional(),
  newEnd: z.string().datetime().optional(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  queueIds: z.array(z.string()).default([]),
  staffingDeltaFte: z.number().optional(),
});

export const handler = apiHandler(async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed();

  const { profile } = await verifyBearerToken(
    event.headers.authorization ?? event.headers.Authorization,
  );

  const body = bodySchema.parse(parseJsonBody(event.body));
  const engine = getCapacityEngine();
  const capacity = await engine.evaluate({
    changeType: body.changeType,
    queueIds: body.queueIds,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
    staffingDeltaFte: body.staffingDeltaFte,
    payload: body,
  });

  const admin = getSupabaseAdmin();
  const status =
    capacity.decision === "approve"
      ? "approved"
      : capacity.decision === "deny"
        ? "denied"
        : "review";

  const { data: changeRequest, error: insertError } = await admin
    .from("change_requests")
    .insert({
      requester_id: profile.id,
      team_id: profile.team_id,
      rep_assembled_id: body.repId,
      rep_name: body.repName,
      change_type: body.changeType,
      payload: body,
      status,
      capacity_decision: capacity.decision,
      capacity_reasoning: capacity.reasoning,
      alternatives: capacity.alternatives ?? null,
      assembled_activity_id: body.activityId,
      resolved_at: capacity.decision === "approve" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (insertError || !changeRequest) {
    throw new Error(`Failed to persist change request: ${insertError?.message}`);
  }

  await writeAuditLog({
    actorId: profile.id,
    action: "schedule_change.proposed",
    entityType: "change_request",
    entityId: changeRequest.id,
    metadata: { changeType: body.changeType, decision: capacity.decision },
  });

  let assembledResult: { ok: boolean; mock: boolean } | null = null;

  if (capacity.decision === "approve" && body.changeType === "move_shift_start" && body.newStart) {
    const assembled = getAssembledClient();
    assembledResult = await assembled.updateActivityStart(body.activityId, body.newStart);

    await writeAuditLog({
      actorId: profile.id,
      action: "schedule_change.committed",
      entityType: "change_request",
      entityId: changeRequest.id,
      metadata: { assembled: assembledResult },
    });
  }

  if (capacity.decision === "review") {
    await sendSlackDm(
      "wfm-channel-stub",
      `Pitstop: ${profile.email} submitted "${body.changeType}" for ${body.repName} — needs WFM review.`,
    );
  }

  return jsonResponse(200, {
    changeRequestId: changeRequest.id,
    decision: capacity.decision,
    status,
    reasoning: capacity.reasoning,
    alternatives: capacity.alternatives,
    assembled: assembledResult,
    mockEngine: capacity.mock ?? false,
  });
});
