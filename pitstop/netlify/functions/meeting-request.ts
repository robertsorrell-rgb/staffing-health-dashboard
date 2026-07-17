import { apiHandler, jsonResponse, methodNotAllowed } from "./_shared/http.js";
import { verifyBearerToken } from "./_shared/supabase-server.js";

/**
 * Meeting adds for consultants — will share capacity engine with schedule-change.
 * Prefer POST /api/schedule-change with changeType: add_meeting long term.
 */
export const handler = apiHandler(async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed();
  await verifyBearerToken(event.headers.authorization ?? event.headers.Authorization);
  return jsonResponse(501, {
    error: "Not implemented",
    message: "Use schedule-change with changeType add_meeting once Meeting Governor is ported.",
  });
});
