import { apiHandler, jsonResponse, methodNotAllowed } from "./_shared/http.js";
import { verifyBearerToken, getSupabaseAdmin } from "./_shared/supabase-server.js";

export const handler = apiHandler(async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed();

  const { profile } = await verifyBearerToken(
    event.headers.authorization ?? event.headers.Authorization,
  );

  const admin = getSupabaseAdmin();
  let query = admin
    .from("change_requests")
    .select(
      "id, change_type, status, capacity_decision, capacity_reasoning, alternatives, rep_name, payload, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (profile.role === "manager") {
    query = query.eq("requester_id", profile.id);
  } else {
    // WFM: surface review queue first, then recent history
    query = query.in("status", ["review", "pending", "approved", "denied"]);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return jsonResponse(200, { requests: data ?? [] });
});
