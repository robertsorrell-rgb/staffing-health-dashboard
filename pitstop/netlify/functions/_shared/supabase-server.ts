import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { AUTH_ALLOWED_DOMAIN, requiredEnv } from "./env.js";

export type UserRole = "manager" | "wfm_analyst" | "wfm_admin";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  team_id: string | null;
  assembled_person_id: string | null;
}

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return adminClient;
}

export function getSupabaseUserClient(accessToken: string): SupabaseClient {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function assertAllowedDomain(email: string): void {
  const domain = email.split("@")[1]?.toLowerCase();
  if (domain !== AUTH_ALLOWED_DOMAIN.toLowerCase()) {
    throw new Error(`Forbidden: email must be @${AUTH_ALLOWED_DOMAIN}`);
  }
}

export async function verifyBearerToken(
  authHeader: string | undefined,
): Promise<{ user: User; profile: UserProfile }> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized: missing Bearer token");
  }
  const token = authHeader.slice(7);
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    throw new Error("Unauthorized: invalid session");
  }

  assertAllowedDomain(data.user.email ?? "");

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id, email, full_name, role, team_id, assembled_person_id")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Unauthorized: user profile not found");
  }

  return { user: data.user, profile: profile as UserProfile };
}

export function requireRole(
  profile: UserProfile,
  allowed: UserRole[],
): void {
  if (!allowed.includes(profile.role)) {
    throw new Error("Forbidden: insufficient role");
  }
}
