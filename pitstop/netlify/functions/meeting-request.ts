import { apiHandler, jsonResponse, methodNotAllowed } from "./_shared/http.js";
import { verifyBearerToken } from "./_shared/supabase-server.js";

/** Stub — Meeting Governor logic will be ported here */
export const handler = apiHandler(async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed();
  await verifyBearerToken(event.headers.authorization ?? event.headers.Authorization);
  return jsonResponse(501, {
    error: "Not implemented",
    message: "Meeting request flow will integrate Meeting Governor in a future session.",
  });
});
