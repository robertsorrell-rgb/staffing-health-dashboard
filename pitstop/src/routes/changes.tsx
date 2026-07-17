import { Link, Route, Routes } from "react-router-dom";
import { CalendarClock, Repeat, Users } from "lucide-react";
import { CHANGE_CATEGORIES } from "@/types/change-request";
import { MeetingRequestPage } from "@/routes/changes-meeting";
import { PermanentChangePage } from "@/routes/changes-permanent";
import { isDevPreview } from "@/lib/dev-preview";

const ICONS = {
  one_off: CalendarClock,
  meeting: Users,
  permanent: Repeat,
} as const;

function ChangesHub() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Request a schedule change</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Submit changes on behalf of consultants on your team. Each request is capacity-checked
          before it writes to Assembled.
        </p>
      </div>

      <ul className="space-y-3">
        {CHANGE_CATEGORIES.map((cat) => {
          const Icon = ICONS[cat.id];
          const href =
            cat.id === "one_off" ? "/" : cat.id === "meeting" ? "/changes/meeting" : "/changes/permanent";
          return (
            <li key={cat.id}>
              <Link
                to={href}
                className="flex gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:border-pitstop-go/40 hover:bg-card"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-5 w-5 text-pitstop-go" />
                </div>
                <div>
                  <p className="font-medium">{cat.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{cat.description}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {isDevPreview() && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90">
          Demo: seeded submissions on Submissions tab. Switch to <strong>WFM view</strong> in the banner
          to approve Sam&apos;s permanent change.
        </p>
      )}
    </div>
  );
}

export function ChangesPage() {
  return (
    <Routes>
      <Route index element={<ChangesHub />} />
      <Route path="meeting" element={<MeetingRequestPage />} />
      <Route path="permanent" element={<PermanentChangePage />} />
    </Routes>
  );
}
