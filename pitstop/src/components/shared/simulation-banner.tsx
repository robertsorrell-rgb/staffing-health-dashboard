import { useEffect, useState } from "react";
import { FlaskConical, RotateCcw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isDevPreview, DEV_PREVIEW_PROFILE } from "@/lib/dev-preview";
import { resetSimSubmissions, seedSimSubmissionsIfEmpty } from "@/lib/dev-simulation-store";

interface SimulationBannerProps {
  role: string;
  onRoleChange: (role: "manager" | "wfm_admin") => void;
}

export function SimulationBanner({ role, onRoleChange }: SimulationBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(isDevPreview());
    seedSimSubmissionsIfEmpty();
  }, []);

  if (!visible) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-950/40 px-4 py-2 text-sm text-amber-100">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 shrink-0" />
          <span>
            <strong>Simulation mode</strong> — sheet logic is faked; submissions saved in this browser only.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={role === "manager" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => onRoleChange("manager")}
          >
            Manager view
          </Button>
          <Button
            size="sm"
            variant={role === "wfm_admin" ? "default" : "outline"}
            className="h-7 text-xs gap-1"
            onClick={() => onRoleChange("wfm_admin")}
          >
            <Shield className="h-3 w-3" />
            WFM view
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-amber-200"
            onClick={() => {
              resetSimSubmissions();
              window.location.reload();
            }}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Reset demo data
          </Button>
        </div>
      </div>
    </div>
  );
}

export { DEV_PREVIEW_PROFILE };
