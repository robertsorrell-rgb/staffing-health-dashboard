import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { ProtectedRoute } from "@/components/shared/protected-route";
import { Toaster } from "@/components/shared/toaster";
import { useAuth } from "@/hooks/use-auth";
import { AdminPage } from "@/routes/admin";
import { AdherencePage } from "@/routes/adherence";
import { DashboardPage } from "@/routes/dashboard";
import { LoginPage } from "@/routes/login";
import { MeetingsPage } from "@/routes/meetings";
import { QueuePage } from "@/routes/queue";
import { SchedulePage } from "@/routes/schedule";
import { VtoOtPage } from "@/routes/vto-ot";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function AuthenticatedLayout() {
  const { profile, signOut } = useAuth();
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <AppShell
      profile={profile}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      onSignOut={() => void signOut()}
    />
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AuthenticatedLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="meetings" element={<MeetingsPage />} />
              <Route path="vto-ot" element={<VtoOtPage />} />
              <Route path="adherence" element={<AdherencePage />} />
              <Route path="queue" element={<QueuePage />} />
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
