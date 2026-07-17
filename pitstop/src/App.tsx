import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { ProtectedRoute } from "@/components/shared/protected-route";
import { SimulationBanner } from "@/components/shared/simulation-banner";
import { Toaster } from "@/components/shared/toaster";
import { useAuth } from "@/hooks/use-auth";
import { isDevPreview, DEV_PREVIEW_PROFILE } from "@/lib/dev-preview";
import type { UserProfile } from "@/lib/api-client";
import { AdminPage } from "@/routes/admin";
import { ChangesPage } from "@/routes/changes";
import { DashboardPage } from "@/routes/dashboard";
import { LoginPage } from "@/routes/login";
import { SubmissionsPage } from "@/routes/submissions";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function AuthenticatedLayout({ simRole }: { simRole: "manager" | "wfm_admin" }) {
  const { profile, signOut } = useAuth();
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const displayProfile: UserProfile | undefined = useMemo(() => {
    if (!isDevPreview()) return profile;
    return { ...DEV_PREVIEW_PROFILE, role: simRole };
  }, [profile, simRole]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <AppShell
      profile={displayProfile}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      onSignOut={() => void signOut()}
    />
  );
}

export default function App() {
  const [simRole, setSimRole] = useState<"manager" | "wfm_admin">(() => {
    if (typeof sessionStorage === "undefined") return "manager";
    return (sessionStorage.getItem("pitstop-sim-role") as "manager" | "wfm_admin") || "manager";
  });

  function handleSimRole(role: "manager" | "wfm_admin") {
    sessionStorage.setItem("pitstop-sim-role", role);
    setSimRole(role);
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {isDevPreview() && (
          <div className="fixed top-0 left-0 right-0 z-50">
            <SimulationBanner role={simRole} onRoleChange={handleSimRole} />
          </div>
        )}
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route
              element={
                <div className={isDevPreview() ? "pt-12" : ""}>
                  <AuthenticatedLayout simRole={simRole} />
                </div>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="changes/*" element={<ChangesPage />} />
              <Route path="submissions" element={<SubmissionsPage />} />
              <Route path="admin" element={<AdminPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
