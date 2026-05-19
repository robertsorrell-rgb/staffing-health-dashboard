import { NavLink, Outlet } from "react-router-dom";
import {
  Calendar,
  Gauge,
  LayoutDashboard,
  LogOut,
  Radio,
  Sun,
  Moon,
  Users,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/lib/api-client";

const nav = [
  { to: "/", label: "Team", icon: LayoutDashboard, end: true },
  { to: "/schedule", label: "Schedule", icon: Calendar },
  { to: "/meetings", label: "Meetings", icon: Users },
  { to: "/vto-ot", label: "VTO / OT", icon: Radio },
  { to: "/adherence", label: "Adherence", icon: Gauge },
  { to: "/queue", label: "Queue", icon: ClipboardList },
];

interface AppShellProps {
  profile?: UserProfile;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onSignOut: () => void;
}

export function AppShell({ profile, theme, onToggleTheme, onSignOut }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-row items-center justify-between border-b border-border bg-card/80 px-4 py-3 md:w-56 md:flex-col md:items-stretch md:justify-start md:border-b-0 md:border-r md:py-6">
        <div className="flex items-center gap-2 md:px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pitstop-go font-bold text-slate-950">
            P
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Pitstop</p>
            <p className="hidden text-xs text-muted-foreground md:block">WFM cockpit</p>
          </div>
        </div>

        <nav className="hidden gap-1 md:mt-8 md:flex md:flex-col md:px-2">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2 md:mt-auto md:flex-col md:items-stretch md:px-2">
          <Button variant="ghost" size="icon" onClick={onToggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="gap-2">
            <LogOut className="h-4 w-4" />
            <span className="hidden md:inline">Sign out</span>
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:px-8">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Today · CT</p>
            <h1 className="text-lg font-semibold">
              {profile?.full_name ?? profile?.email ?? "Manager"}
            </h1>
          </div>
          <span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-mono capitalize text-muted-foreground">
            {profile?.role ?? "manager"}
          </span>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex justify-around border-t border-border bg-card/95 py-2 backdrop-blur md:hidden">
        {nav.slice(0, 5).map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-0.5 text-[10px]",
                isActive ? "text-pitstop-go" : "text-muted-foreground",
              )
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
