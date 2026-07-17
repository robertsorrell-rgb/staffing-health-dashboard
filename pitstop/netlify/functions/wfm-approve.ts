import { z } from "zod";
import { apiHandler, jsonResponse, methodNotAllowed, parseJsonBody } from "./_shared/http.js";
import {
  verifyBearerToken,
  getSupabaseAdmin,
  requireRole,
} from "./_shared/supabase-server.js";
import { commitViaSheetLogic, isSheetLogicConfigured } from "./_shared/sheet-logic-bridge.js";
import { commitScheduleChange } from "./_shared/schedule-commit.js";
import { writeAuditLog } from "./_shared/audit.js";

const bodySchema = z.object({
  changeRequestId: z.string().uuid(),
  decision: z.enum(["approve", "deny"]),
  notes: z.string().optional(),
});

/**
 * WFM approves or denies a request that sheet logic routed to review.
 * Commit runs the same Apps Script path as the sheet "Apply" buttons.
 */
export const handler = apiHandler(async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed();

  const { profile, user } = await verifyBearerToken(
    event.headers.authorization ?? event.headers.Authorization,
  );
  requireRole(profile, ["wfm_analyst", "wfm_admin"]);

  const body = bodySchema.parse(parseJsonBody(event.body));
  const admin = getSupabaseAdmin();

  const { data: request, error } = await admin
    .from("change_requests")
    .select("*")
    .eq("id", body.changeRequestId)
    .single();

  if (error || !request) {
    throw new Error("Change request not found");
  }

  if (request.status !== "review" && request.capacity_decision !== "review") {
    throw new Error(`Request is not in review state (current: ${request.status})`);
  }

  const capacityDecision = body.decision === "approve" ? "approve" : "deny";
  const status = body.decision === "approve" ? "approved" : "denied";

  await admin
    .from("change_requests")
    .update({
      status,
      capacity_decision: capacityDecision,
      capacity_reasoning:
        (request.capacity_reasoning ?? "") +
        (body.notes ? ` | WFM: ${body.notes}` : ` | WFM ${body.decision}`),
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.changeRequestId);

  await admin.from("approvals").insert({
    change_request_id: body.changeRequestId,
    reviewer_id: profile.id,
    decision: capacityDecision,
    notes: body.notes ?? null,
  });

  await writeAuditLog({
    actorId: profile.id,
    action: `wfm.${body.decision}`,
    entityType: "change_request",
    entityId: body.changeRequestId,
    metadata: { notes: body.notes },
  });

  let commitResult = null;
  if (body.decision === "approve") {
    const payload = (request.payload ?? {}) as Record<string, unknown>;
    const changeType = String(request.change_type);

    if (isSheetLogicConfigured(changeType)) {
      commitResult = await commitViaSheetLogic({
        action: "commit",
        changeType,
        requestId: body.changeRequestId,
        requesterEmail: user.email ?? profile.email,
        approvedByEmail: user.email ?? profile.email,
        payload,
      });
    } else {
      commitResult = await commitScheduleChange({ changeType, payload });
    }

    await writeAuditLog({
      actorId: profile.id,
      action: "schedule_change.committed",
      entityType: "change_request",
      entityId: body.changeRequestId,
      metadata: { commit: commitResult, via: "wfm-approve" },
    });
  }

  return jsonResponse(200, {
    changeRequestId: body.changeRequestId,
    status,
    commit: commitResult,
  });
});
