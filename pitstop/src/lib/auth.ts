import type { Session } from "@supabase/supabase-js";
import { AUTH_ALLOWED_DOMAIN, supabase } from "./supabase";

export function isAllowedEmail(email: string | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${AUTH_ALLOWED_DOMAIN}`);
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  const redirectTo = `${window.location.origin}/`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: { hd: AUTH_ALLOWED_DOMAIN },
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(
  callback: (session: Session | null) => void,
): () => void {
  const client = supabase;
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.email && !isAllowedEmail(session.user.email)) {
      void client.auth.signOut();
      callback(null);
      return;
    }
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}
