import { format } from "date-fns";
import { Check, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SubmissionRow {
  id: string;
  change_type: string;
  status: string;
  capacity_decision: string | null;
  capacity_reasoning: string | null;
  rep_name: string | null;
  created_at: string;
  alternatives?: Array<{ start: string; end: string; label?: string }>;
}

const STATUS_STYLE: Record<string, string> = {
  approved: "text-pitstop-go border-pitstop-go/40 bg-emerald-950/30",
  denied: "text-red-400 border-red-500/40 bg-red-950/30",
  review: "text-amber-400 border-amber-500/40 bg-amber-950/30",
  pending: "text-muted-foreground border-border bg-muted/30",
};

interface SubmissionCardProps {
  row: SubmissionRow;
  wfmMode?: boolean;
  onWfmApprove?: (id: string) => void;
  onWfmDeny?: (id: string) => void;
  loadingId?: string | null;
}

export function SubmissionCard({
  row,
  wfmMode,
  onWfmApprove,
  onWfmDeny,
  loadingId,
}: SubmissionCardProps) {
  const status = row.status || "pending";
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.pending;

  return (
    <li className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{row.rep_name ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            {formatChangeType(row.change_type)} ·{" "}
            {format(new Date(row.created_at), "MMM d, h:mm a")}
          </p>
        </div>
        <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", style)}>
          {status}
        </span>
      </div>
      {row.capacity_reasoning && (
        <p className="mt-2 text-sm text-muted-foreground">{row.capacity_reasoning}</p>
      )}
      {row.alternatives && row.alternatives.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li className="font-medium text-foreground/80">Suggested alternatives</li>
          {row.alternatives.map((alt, i) => (
            <li key={i} className="rounded-md border border-border/60 bg-muted/20 px-2 py-1">
              {alt.label ?? `${format(new Date(alt.start), "h:mm a")} – ${format(new Date(alt.end), "h:mm a")}`}
            </li>
          ))}
        </ul>
      )}
      {wfmMode && status === "review" && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            disabled={loadingId === row.id}
            onClick={() => onWfmApprove?.(row.id)}
            className="gap-1"
          >
            <Check className="h-3 w-3" />
            Approve & apply
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loadingId === row.id}
            onClick={() => onWfmDeny?.(row.id)}
            className="gap-1"
          >
            <X className="h-3 w-3" />
            Deny
          </Button>
        </div>
      )}
      {status === "review" && !wfmMode && (
        <p className="mt-2 flex items-center gap-1 text-xs text-amber-400/90">
          <Clock className="h-3 w-3" />
          Waiting for WFM review
        </p>
      )}
    </li>
  );
}

function formatChangeType(t: string) {
  return t.replace(/_/g, " ");
}
