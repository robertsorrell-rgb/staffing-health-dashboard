import type { Handler } from "@netlify/functions";

export type JsonBody = Record<string, unknown> | unknown[];

export function jsonResponse(
  statusCode: number,
  body: JsonBody,
  headers: Record<string, string> = {},
) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && origin.includes("localhost") ? origin : origin ?? "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

export function methodNotAllowed(): ReturnType<typeof jsonResponse> {
  return jsonResponse(405, { error: "Method not allowed" });
}

export function parseJsonBody<T>(raw: string | null): T {
  if (!raw) throw new Error("Empty request body");
  return JSON.parse(raw) as T;
}

/** Wrap a handler with OPTIONS + JSON error handling */
export function apiHandler(
  fn: (event: Parameters<Handler>[0], context: Parameters<Handler>[1]) => Promise<ReturnType<typeof jsonResponse>>,
): Handler {
  return async (event, context) => {
    const origin = event.headers.origin ?? event.headers.Origin ?? null;
    const cors = corsHeaders(origin);

    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors, body: "" };
    }

    try {
      const res = await fn(event, context);
      return { ...res, headers: { ...cors, ...res.headers } };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      const status = message.includes("Unauthorized") ? 401 : message.includes("Forbidden") ? 403 : 500;
      console.error("[api]", message, err);
      return jsonResponse(status, { error: message }, cors);
    }
  };
}
