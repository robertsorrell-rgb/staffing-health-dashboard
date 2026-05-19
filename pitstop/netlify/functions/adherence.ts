import { apiHandler, jsonResponse, methodNotAllowed } from "./_shared/http.js";
import { verifyBearerToken } from "./_shared/supabase-server.js";

export const handler = apiHandler(async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed();
  await verifyBearerToken(event.headers.authorization ?? event.headers.Authorization);
  return jsonResponse(200, {
    reps: [],
    message: "Live adherence stub — will connect to Assembled + floor bot.",
  });
});
