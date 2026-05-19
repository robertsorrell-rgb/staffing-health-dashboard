import { useState } from "react";
import { Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { minutesToClockLabel } from "@/lib/schedule-time";
import type { ScheduleBlock, TeamRep } from "@/types/schedule";

export interface MoveStartContext {
  rep: TeamRep;
  block: ScheduleBlock;
}

interface MoveStartModalProps {
  open: boolean;
  context: MoveStartContext | null;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (deltaMinutes: number) => void;
}

const PRESETS = [-60, -30, 30, 60];

export function MoveStartModal({
  open,
  context,
  loading,
  onClose,
  onSubmit,
}: MoveStartModalProps) {
  const [delta, setDelta] = useState(30);

  if (!context) return null;

  const { rep, block } = context;
  const newStart = block.startMinutes + delta;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move shift start</DialogTitle>
          <DialogDescription>
            {rep.name} · {block.label} — currently starts at{" "}
            {minutesToClockLabel(block.startMinutes)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 font-mono text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>
              New start:{" "}
              <strong className="text-pitstop-go">
                {minutesToClockLabel(Math.max(0, newStart))}
              </strong>
              <span className="text-muted-foreground">
                {" "}
                ({delta > 0 ? "+" : ""}
                {delta} min)
              </span>
            </span>
          </div>

          <div className="space-y-2">
            <Label>Adjust by</Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={delta === m ? "default" : "outline"}
                  onClick={() => setDelta(m)}
                >
                  {m > 0 ? "+" : ""}
                  {m} min
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSubmit(delta)} disabled={loading}>
            {loading ? "Submitting…" : "Submit change"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
