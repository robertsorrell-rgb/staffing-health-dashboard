import type { TeamConsultant } from "@/types/schedule";
import { ScheduleBlock } from "./schedule-block";

interface ConsultantTimelineRowProps {
  consultant: TeamConsultant;
  highlightedBlockId?: string;
  shakingBlockId?: string;
  onBlockClick?: (consultantId: string, blockId: string) => void;
}

export function ConsultantTimelineRow({
  consultant,
  highlightedBlockId,
  shakingBlockId,
  onBlockClick,
}: ConsultantTimelineRowProps) {
  return (
    <div className="group flex items-stretch gap-3 border-b border-border/40 py-2.5 transition-colors hover:bg-muted/20">
      <div className="flex w-[10.5rem] shrink-0 flex-col justify-center gap-0.5 sm:w-[12.5rem]">
        <span className="truncate text-sm font-medium">{consultant.name}</span>
        <span className="text-xs text-muted-foreground">{consultant.role}</span>
      </div>
      <div className="relative min-h-[2.25rem] flex-1 rounded-md bg-muted/30">
        {consultant.blocks.map((block) => (
          <ScheduleBlock
            key={block.id}
            block={block}
            highlight={highlightedBlockId === block.id}
            shake={shakingBlockId === block.id}
            onClick={() => onBlockClick?.(consultant.id, block.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** @deprecated use ConsultantTimelineRow */
export const RepTimelineRow = ConsultantTimelineRow;
