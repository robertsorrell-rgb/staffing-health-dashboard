import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { minutesToClockLabel, percentOfTimeline } from "@/lib/schedule-time";
import { ACTIVITY_COLORS, type ScheduleBlock as Block } from "@/types/schedule";

interface ScheduleBlockProps {
  block: Block;
  highlight?: boolean;
  shake?: boolean;
  onClick?: () => void;
}

export function ScheduleBlock({ block, highlight, shake, onClick }: ScheduleBlockProps) {
  const left = percentOfTimeline(block.startMinutes);
  const width = percentOfTimeline(block.durationMinutes);

  return (
    <motion.button
      type="button"
      layout
      onClick={onClick}
      title={`${block.label} · ${minutesToClockLabel(block.startMinutes)} – ${minutesToClockLabel(block.startMinutes + block.durationMinutes)}`}
      className={cn(
        "absolute top-1 bottom-1 min-w-[2px] cursor-pointer rounded-sm px-1 text-left text-[10px] font-medium text-white/95 shadow-sm transition-shadow hover:ring-2 hover:ring-white/30 focus:outline-none focus:ring-2 focus:ring-ring",
        ACTIVITY_COLORS[block.type],
        highlight && "animate-pulse-soft ring-2 ring-pitstop-go",
        shake && "animate-shake",
      )}
      style={{ left: `${left}%`, width: `${width}%` }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <span className="hidden truncate sm:inline">{block.label}</span>
    </motion.button>
  );
}
