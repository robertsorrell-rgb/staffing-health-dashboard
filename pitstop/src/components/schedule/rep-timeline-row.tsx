import { cn } from "@/lib/utils";
import type { TeamRep } from "@/types/schedule";
import { ScheduleBlock } from "./schedule-block";

interface RepTimelineRowProps {
  rep: TeamRep;
  highlightedBlockId?: string;
  shakingBlockId?: string;
  onBlockClick?: (repId: string, blockId: string) => void;
}

function AdherenceDot({ status }: { status: TeamRep["adherence"] }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        status === "in" && "bg-pitstop-go",
        status === "out" && "bg-pitstop-deny",
        status === "unknown" && "bg-muted-foreground",
      )}
      title={status === "in" ? "In adherence" : status === "out" ? "Out of adherence" : "Unknown"}
    />
  );
}

export function RepTimelineRow({
  rep,
  highlightedBlockId,
  shakingBlockId,
  onBlockClick,
}: RepTimelineRowProps) {
  return (
    <div className="group flex items-stretch gap-3 border-b border-border/40 py-2.5 transition-colors hover:bg-muted/20">
      <div className="flex w-[10.5rem] shrink-0 flex-col justify-center gap-0.5 sm:w-[12.5rem]">
        <div className="flex items-center gap-2">
          <AdherenceDot status={rep.adherence} />
          <span className="truncate text-sm font-medium">{rep.name}</span>
        </div>
        <span className="pl-4 text-xs text-muted-foreground">{rep.role}</span>
      </div>
      <div className="relative min-h-[2.25rem] flex-1 rounded-md bg-muted/30">
        {rep.blocks.map((block) => (
          <ScheduleBlock
            key={block.id}
            block={block}
            highlight={highlightedBlockId === block.id}
            shake={shakingBlockId === block.id}
            onClick={() => onBlockClick?.(rep.id, block.id)}
          />
        ))}
      </div>
    </div>
  );
}
