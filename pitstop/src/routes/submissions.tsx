import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SubmissionCard, type SubmissionRow } from "@/components/approvals/submission-card";
import { fetchApprovals, wfmDecide } from "@/lib/api-client";
import { isDevPreview } from "@/lib/dev-preview";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

export function SubmissionsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const wfmMode =
    profile?.role === "wfm_admin" || profile?.role === "wfm_analyst";

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["approvals", profile?.role],
    queryFn: fetchApprovals,
  });

  const requests = (data?.requests ?? []) as SubmissionRow[];

  async function handleWfm(id: string, decision: "approve" | "deny") {
    setLoadingId(id);
    try {
      await wfmDecide(id, decision);
      toast({
        title: decision === "approve" ? "Approved & applied" : "Denied",
        description: isDevPreview()
          ? "Simulated sheet commit (schedule changes / meeting booking)."
          : undefined,
        variant: decision === "approve" ? "success" : "destructive",
      });
      await queryClient.invalidateQueries({ queryKey: ["approvals"] });
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {wfmMode ? "Review queue" : "My submissions"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {wfmMode
            ? "Approve or deny requests — same as signing off in the sheet before Apply."
            : "Track pending, approved, and denied schedule change requests."}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <p className="text-sm">No submissions yet. Try a change from Team or Request.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {requests.map((row) => (
            <SubmissionCard
              key={row.id}
              row={row}
              wfmMode={wfmMode}
              loadingId={loadingId}
              onWfmApprove={(id) => void handleWfm(id, "approve")}
              onWfmDeny={(id) => void handleWfm(id, "deny")}
            />
          ))}
        </ul>
      )}

      {isDevPreview() && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => void refetch()}
        >
          Refresh list
        </button>
      )}
    </div>
  );
}
