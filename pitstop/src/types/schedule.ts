export type ActivityType =
  | "phone"
  | "meeting"
  | "break"
  | "lunch"
  | "training"
  | "offline";

export interface ScheduleBlock {
  id: string;
  type: ActivityType;
  label: string;
  /** Minutes from timeline day start (e.g. 8:00 AM = 0 if day starts at 8) */
  startMinutes: number;
  durationMinutes: number;
}

export interface TeamRep {
  id: string;
  name: string;
  role: string;
  adherence: "in" | "out" | "unknown";
  blocks: ScheduleBlock[];
}

/** Operating window for timeline (America/Chicago) */
export const TIMELINE_DAY_START_HOUR = 8;
export const TIMELINE_DAY_END_HOUR = 20;
export const TIMELINE_TOTAL_MINUTES =
  (TIMELINE_DAY_END_HOUR - TIMELINE_DAY_START_HOUR) * 60;

export const ACTIVITY_COLORS: Record<ActivityType, string> = {
  phone: "bg-emerald-500/90",
  meeting: "bg-violet-500/90",
  break: "bg-sky-500/80",
  lunch: "bg-amber-500/90",
  training: "bg-indigo-500/80",
  offline: "bg-slate-500/70",
};
