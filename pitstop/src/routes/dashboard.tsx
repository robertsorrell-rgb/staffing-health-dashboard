import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { AlternativesPanel } from "@/components/approvals/alternatives-panel";
import { ConsultantTimelineRow } from "@/components/schedule/rep-timeline-row";
import { MoveStartModal, type MoveStartContext } from "@/components/schedule/move-start-modal";
import { TimelineAxis } from "@/components/schedule/timeline-axis";
import { SuccessBurst } from "@/components/shared/success-burst";
import { submitScheduleChange, type ScheduleChangeResponse } from "@/lib/api-client";
import { blockToIsoWindow } from "@/lib/schedule-time";
import { useTeamSchedule } from "@/hooks/use-team-schedule";
import { toast } from "@/hooks/use-toast";
import type { ScheduleBlock } from "@/types/schedule";
import { isDevPreview } from "@/lib/dev-preview";

const TZ = "America/Chicago";

export function DashboardPage() {
  const { team, moveBlockStart } = useTeamSchedule();
  const [modalContext, setModalContext] = useState<MoveStartContext | null>(null);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | undefined>();
  const [shakingBlockId, setShakingBlockId] = useState<string | undefined>();
  const [deniedResult, setDeniedResult] = useState<ScheduleChangeResponse | null>(null);
  const [showBurst, setShowBurst] = useState(false);

  const todayLabel = useMemo(() => {
    const zoned = toZonedTime(new Date(), TZ);
    return format(zoned, "EEEE, MMM d");
  }, []);

  const handleBlockClick = useCallback(
    (consultantId: string, blockId: string) => {
      const consultant = team.find((c) => c.id === consultantId);
      const block = consultant?.blocks.find((b) => b.id === blockId);
      if (!consultant || !block) return;
      if (block.type === "phone") {
        setDeniedResult(null);
        setModalContext({ consultant, block });
      } else {
        toast({
          title: "Coming soon",
          description: `One-off edits for "${block.label}" blocks are next.`,
          variant: "review",
        });
      }
    },
    [team],
  );

  const mutation = useMutation({
    mutationFn: async ({
      consultantId,
      consultantName,
      block,
      deltaMinutes,
    }: {
      consultantId: string;
      consultantName: string;
      block: ScheduleBlock;
      deltaMinutes: number;
    }) => {
      const { windowStart, windowEnd } = blockToIsoWindow(
        block.startMinutes,
        block.durationMinutes,
      );
      const newStartMinutes = block.startMinutes + deltaMinutes;
      const { windowStart: newStart } = blockToIsoWindow(newStartMinutes, 0);

      return submitScheduleChange({
        consultantId,
        consultantName,
        activityId: block.id,
        changeType: "move_block_start",
        newStart,
        windowStart,
        windowEnd,
        queueIds: [],
        staffingDeltaFte: deltaMinutes > 0 ? 0.1 : -0.1,
      });
    },
    onMutate: async ({ consultantId, block, deltaMinutes }) => {
      setModalContext(null);
      moveBlockStart(consultantId, block.id, deltaMinutes);
      setHighlightedBlockId(block.id);
    },
    onSuccess: (data, vars) => {
      setHighlightedBlockId(undefined);
      if (data.decision === "approve") {
        setShowBurst(true);
        setTimeout(() => setShowBurst(false), 900);
        toast({ title: "Change approved", description: data.reasoning, variant: "success" });
        setDeniedResult(null);
      } else if (data.decision === "deny") {
        setShakingBlockId(vars.block.id);
        setTimeout(() => setShakingBlockId(undefined), 400);
        setDeniedResult(data);
        toast({ title: "Change denied", description: data.reasoning, variant: "destructive" });
      } else {
        toast({ title: "Sent for WFM review", description: data.reasoning, variant: "review" });
      }
    },
    onError: (err, vars) => {
      moveBlockStart(vars.consultantId, vars.block.id, -vars.deltaMinutes);
      setHighlightedBlockId(undefined);
      toast({
        title: "Request failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <SuccessBurst show={showBurst} />

      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Consultant schedules</h2>
          <p className="text-sm text-muted-foreground">{todayLabel} · America/Chicago</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Click a <span className="text-emerald-400">phone</span> block for a one-off start-time
            change
          </span>
          <Link to="/changes" className="text-pitstop-go hover:underline">
            Other change types →
          </Link>
          {isDevPreview() && (
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">Preview mode</span>
          )}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card/50 p-3 shadow-sm sm:p-5">
        <TimelineAxis />
        <div className="mt-1">
          {team.map((consultant) => (
            <ConsultantTimelineRow
              key={consultant.id}
              consultant={consultant}
              highlightedBlockId={highlightedBlockId}
              shakingBlockId={shakingBlockId}
              onBlockClick={handleBlockClick}
            />
          ))}
        </div>
      </section>

      {deniedResult?.alternatives && deniedResult.alternatives.length > 0 && (
        <AlternativesPanel
          reasoning={deniedResult.reasoning}
          alternatives={deniedResult.alternatives}
        />
      )}

      <MoveStartModal
        open={Boolean(modalContext)}
        context={modalContext}
        loading={mutation.isPending}
        onClose={() => setModalContext(null)}
        onSubmit={(delta) => {
          if (!modalContext) return;
          mutation.mutate({
            consultantId: modalContext.consultant.id,
            consultantName: modalContext.consultant.name,
            block: modalContext.block,
            deltaMinutes: delta,
          });
        }}
      />
    </div>
  );
}
