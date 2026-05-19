import { apiHandler, jsonResponse, methodNotAllowed } from "./_shared/http.js";
import { verifyBearerToken } from "./_shared/supabase-server.js";

/** GET /api/me — current user profile (validates auth + domain) */
export const handler = apiHandler(async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed();

  const { user, profile } = await verifyBearerToken(
    event.headers.authorization ?? event.headers.Authorization,
  );

  return jsonResponse(200, {
    user: {
      id: user.id,
      email: user.email,
    },
    profile,
  });
});
