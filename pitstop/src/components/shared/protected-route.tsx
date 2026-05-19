import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { isDevPreview } from "@/lib/dev-preview";

export function ProtectedRoute() {
  const { session, bootstrapping } = useAuth();

  if (isDevPreview()) {
    return <Outlet />;
  }

  if (bootstrapping) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
