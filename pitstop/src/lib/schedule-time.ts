import { addMinutes, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  TIMELINE_DAY_START_HOUR,
  TIMELINE_TOTAL_MINUTES,
} from "@/types/schedule";

const TZ = "America/Chicago";

export function todayInChicago(): Date {
  return toZonedTime(new Date(), TZ);
}

export function minutesToClockLabel(minutesFromDayStart: number): string {
  const base = new Date();
  base.setHours(TIMELINE_DAY_START_HOUR, 0, 0, 0);
  return format(addMinutes(base, minutesFromDayStart), "h:mm a");
}

export function blockToIsoWindow(
  startMinutes: number,
  durationMinutes: number,
): { windowStart: string; windowEnd: string } {
  const now = todayInChicago();
  const dayStart = new Date(now);
  dayStart.setHours(TIMELINE_DAY_START_HOUR, 0, 0, 0);

  const start = addMinutes(dayStart, startMinutes);
  const end = addMinutes(start, durationMinutes);
  return { windowStart: start.toISOString(), windowEnd: end.toISOString() };
}

export function percentOfTimeline(minutes: number): number {
  return (minutes / TIMELINE_TOTAL_MINUTES) * 100;
}
