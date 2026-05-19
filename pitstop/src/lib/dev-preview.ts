import { supabaseConfigured } from "./supabase";

/** Local UI preview without Supabase or Netlify — dashboard only */
export function isDevPreview(): boolean {
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.VITE_DEV_PREVIEW === "true") return true;
  return !supabaseConfigured;
}

export const DEV_PREVIEW_PROFILE = {
  id: "dev-preview",
  email: "preview@varsitytutors.com",
  full_name: "Preview Manager",
  role: "manager" as const,
  team_id: null,
  assembled_person_id: null,
};
