/**
 * Schedule changes managers submit on behalf of consultants.
 * Not in scope: VTO/OT offers, adherence, or other WFM-entered rep actions.
 */

export type ScheduleChangeType =
  /** One-off: move, retime, change type, delete, or add a single block */
  | "move_block_start"
  | "move_block_end"
  | "change_activity_type"
  | "delete_activity"
  | "add_activity"
  /** Add a team meeting block (capacity-checked meeting request) */
  | "add_meeting"
  /** Ongoing / template change to a consultant's schedule pattern */
  | "permanent_schedule_change";

export type ChangeCategory = "one_off" | "meeting" | "permanent";

export interface ChangeCategoryMeta {
  id: ChangeCategory;
  title: string;
  description: string;
  types: ScheduleChangeType[];
}

export const CHANGE_CATEGORIES: ChangeCategoryMeta[] = [
  {
    id: "one_off",
    title: "One-off edit",
    description:
      "Move a block, change activity type, delete, or add a single segment on a specific day.",
    types: [
      "move_block_start",
      "move_block_end",
      "change_activity_type",
      "delete_activity",
      "add_activity",
    ],
  },
  {
    id: "meeting",
    title: "Add meeting",
    description:
      "Request a team meeting at a specific time — capacity-checked against live staffing.",
    types: ["add_meeting"],
  },
  {
    id: "permanent",
    title: "Permanent change",
    description:
      "Update an ongoing schedule pattern (e.g. standing lunch, recurring block).",
    types: ["permanent_schedule_change"],
  },
];
