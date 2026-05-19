import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { fetchMe, type UserProfile } from "@/lib/api-client";
import { getSession, onAuthStateChange, signInWithGoogle, signOut } from "@/lib/auth";
import { DEV_PREVIEW_PROFILE, isDevPreview } from "@/lib/dev-preview";
import { supabaseConfigured } from "@/lib/supabase";

export function useAuth() {
  const preview = isDevPreview();
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrapping, setBootstrapping] = useState(!preview);

  useEffect(() => {
    if (preview) return;
    void getSession().then((s) => {
      setSession(s);
      setBootstrapping(false);
    });
    return onAuthStateChange(setSession);
  }, []);

  const profileQuery = useQuery({
    queryKey: ["me", session?.access_token],
    queryFn: fetchMe,
    enabled: !preview && Boolean(session?.access_token),
    staleTime: 60_000,
  });

  return {
    session,
    bootstrapping,
    supabaseConfigured,
    devPreview: preview,
    profile: preview
      ? (DEV_PREVIEW_PROFILE as UserProfile)
      : (profileQuery.data?.profile as UserProfile | undefined),
    isLoadingProfile: profileQuery.isLoading,
    profileError: profileQuery.error,
    signIn: signInWithGoogle,
    signOut,
    refetchProfile: profileQuery.refetch,
  };
}
