import { z } from "zod";
import { getSession } from "./auth";
import { mockScheduleChange } from "./dev-preview-api";
import { isDevPreview } from "./dev-preview";

async function authHeaders(): Promise<HeadersInit> {
  const session = await getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  schema?: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(await authHeaders()), ...init?.headers },
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof json === "object" && json && "error" in json
        ? String((json as { error: string }).error)
        : res.statusText;
    throw new Error(msg);
  }
  if (schema) return schema.parse(json);
  return json as T;
}

const userProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  full_name: z.string().nullable(),
  role: z.enum(["manager", "wfm_analyst", "wfm_admin"]),
  team_id: z.string().nullable(),
  assembled_person_id: z.string().nullable(),
});

const meResponseSchema = z.object({
  user: z.object({ id: z.string(), email: z.string().email() }),
  profile: userProfileSchema,
});

export type UserProfile = z.infer<typeof userProfileSchema>;

export async function fetchMe(): Promise<z.infer<typeof meResponseSchema>> {
  return apiFetch("/api/me", { method: "GET" }, meResponseSchema);
}

const scheduleChangeResponseSchema = z.object({
  changeRequestId: z.string(),
  decision: z.enum(["approve", "deny", "review"]),
  status: z.string(),
  reasoning: z.string(),
  alternatives: z
    .array(
      z.object({
        start: z.string(),
        end: z.string(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  assembled: z
    .object({ ok: z.boolean(), mock: z.boolean() })
    .nullable()
    .optional(),
  mockEngine: z.boolean().optional(),
});

export type ScheduleChangeResponse = z.infer<typeof scheduleChangeResponseSchema>;

export interface ScheduleChangePayload {
  repId: string;
  repName: string;
  activityId: string;
  changeType: "move_shift_start" | "move_shift_end" | "change_activity_type" | "delete_activity" | "add_activity";
  newStart?: string;
  newEnd?: string;
  windowStart: string;
  windowEnd: string;
  queueIds?: string[];
  staffingDeltaFte?: number;
}

export async function submitScheduleChange(
  payload: ScheduleChangePayload,
): Promise<ScheduleChangeResponse> {
  if (isDevPreview()) return mockScheduleChange(payload);
  return apiFetch(
    "/api/schedule-change",
    { method: "POST", body: JSON.stringify(payload) },
    scheduleChangeResponseSchema,
  );
}
