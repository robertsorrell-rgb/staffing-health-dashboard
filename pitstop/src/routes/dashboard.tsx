import { useCallback, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { AlternativesPanel } from "@/components/approvals/alternatives-panel";
import { MoveStartModal, type MoveStartContext } from "@/components/schedule/move-start-modal";
import { RepTimelineRow } from "@/components/schedule/rep-timeline-row";
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
    (repId: string, blockId: string) => {
      const rep = team.find((r) => r.id === repId);
      const block = rep?.blocks.find((b) => b.id === blockId);
      if (!rep || !block) return;
      // Vertical slice: first phone block → move start
      if (block.type === "phone") {
        setDeniedResult(null);
        setModalContext({ rep, block });
      } else {
        toast({
          title: "Coming soon",
          description: `Editing "${block.label}" blocks is next on the roadmap.`,
          variant: "review",
        });
      }
    },
    [team],
  );

  const mutation = useMutation({
    mutationFn: async ({
      repId,
      repName,
      block,
      deltaMinutes,
    }: {
      repId: string;
      repName: string;
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
        repId,
        repName,
        activityId: block.id,
        changeType: "move_shift_start",
        newStart,
        windowStart,
        windowEnd,
        queueIds: [],
        staffingDeltaFte: deltaMinutes > 0 ? 0.1 : -0.1,
      });
    },
    onMutate: async ({ repId, block, deltaMinutes }) => {
      setModalContext(null);
      moveBlockStart(repId, block.id, deltaMinutes);
      setHighlightedBlockId(block.id);
      return { repId, blockId: block.id };
    },
    onSuccess: (data, _vars, _ctx) => {
      setHighlightedBlockId(undefined);
      if (data.decision === "approve") {
        setShowBurst(true);
        setTimeout(() => setShowBurst(false), 900);
        toast({
          title: "Change approved",
          description: data.reasoning,
          variant: "success",
        });
        setDeniedResult(null);
      } else if (data.decision === "deny") {
        setShakingBlockId(_vars.block.id);
        setTimeout(() => setShakingBlockId(undefined), 400);
        setDeniedResult(data);
        toast({
          title: "Change denied",
          description: data.reasoning,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Sent for WFM review",
          description: data.reasoning,
          variant: "review",
        });
      }
    },
    onError: (err, vars) => {
      moveBlockStart(vars.repId, vars.block.id, -vars.deltaMinutes);
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
          <h2 className="text-xl font-semibold tracking-tight">Team dashboard</h2>
          <p className="text-sm text-muted-foreground">{todayLabel} · America/Chicago</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Click a <span className="text-emerald-400">phone</span> block to move shift start (demo flow)
          {isDevPreview() && (
            <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">
              Preview mode — no Supabase
            </span>
          )}
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card/50 p-3 shadow-sm sm:p-5">
        <TimelineAxis />
        <div className="mt-1">
          {team.map((rep) => (
            <RepTimelineRow
              key={rep.id}
              rep={rep}
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
            repId: modalContext.rep.id,
            repName: modalContext.rep.name,
            block: modalContext.block,
            deltaMinutes: delta,
          });
        }}
      />
    </div>
  );
}
