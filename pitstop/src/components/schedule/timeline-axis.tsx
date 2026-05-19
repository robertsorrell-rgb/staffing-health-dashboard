import { TIMELINE_DAY_END_HOUR, TIMELINE_DAY_START_HOUR } from "@/types/schedule";

const HOURS = Array.from(
  { length: TIMELINE_DAY_END_HOUR - TIMELINE_DAY_START_HOUR + 1 },
  (_, i) => TIMELINE_DAY_START_HOUR + i,
);

function formatHour(h: number): string {
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const suffix = h < 12 ? "a" : "p";
  return `${hour12}${suffix}`;
}

export function TimelineAxis() {
  return (
    <div className="flex border-b border-border/60 pb-2 pl-[11rem] pr-2 text-[10px] font-mono text-muted-foreground sm:pl-[13rem]">
      <div className="relative flex-1">
        <div className="flex justify-between">
          {HOURS.map((h) => (
            <span key={h} className="tabular-nums">
              {formatHour(h)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
