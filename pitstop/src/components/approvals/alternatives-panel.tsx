import { Button } from "@/components/ui/button";
import type { ScheduleChangeResponse } from "@/lib/api-client";

interface AlternativesPanelProps {
  reasoning: string;
  alternatives: NonNullable<ScheduleChangeResponse["alternatives"]>;
  onPick?: (start: string) => void;
}

export function AlternativesPanel({ reasoning, alternatives, onPick }: AlternativesPanelProps) {
  return (
    <div className="mt-4 rounded-lg border border-pitstop-deny/30 bg-red-950/20 p-4 animate-in slide-in-from-top-2">
      <p className="text-sm text-red-200/90">{reasoning}</p>
      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Suggested alternatives
      </p>
      <ul className="mt-2 space-y-2">
        {alternatives.map((slot) => (
          <li key={slot.start} className="flex items-center justify-between gap-2 text-sm">
            <span className="font-mono text-xs">
              {slot.label ?? new Date(slot.start).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: "America/Chicago",
              })}
            </span>
            {onPick && (
              <Button size="sm" variant="outline" onClick={() => onPick(slot.start)}>
                Use this
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
