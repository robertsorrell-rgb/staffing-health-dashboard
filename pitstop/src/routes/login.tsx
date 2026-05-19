import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { isDevPreview } from "@/lib/dev-preview";

export function LoginPage() {
  const { session, bootstrapping, signIn, supabaseConfigured: configured } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (isDevPreview()) {
    return <Navigate to="/" replace />;
  }

  if (!bootstrapping && session) {
    return <Navigate to="/" replace />;
  }

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-pitstop-go text-2xl font-bold text-slate-950">
            P
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Pitstop</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Workforce management for contact center managers
          </p>
        </div>

        {!configured && (
          <p className="rounded-md border border-pitstop-review/40 bg-amber-950/30 p-3 text-left text-xs text-amber-100">
            Copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env</code>{" "}
            and set <code className="font-mono">VITE_SUPABASE_*</code> to enable Google sign-in.
          </p>
        )}

        <Button
          className="w-full"
          size="lg"
          disabled={!configured || loading}
          onClick={() => void handleSignIn()}
        >
          {loading ? "Redirecting…" : "Sign in with Google"}
        </Button>
        <p className="text-xs text-muted-foreground">@varsitytutors.com accounts only</p>
        {error && <p className="text-sm text-pitstop-deny">{error}</p>}
      </div>
    </div>
  );
}
