import type { TeamRep } from "@/types/schedule";

/** Hardcoded team for dashboard v0.1 visual */
export const MOCK_TEAM: TeamRep[] = [
  {
    id: "rep-001",
    name: "Jordan Kim",
    role: "Senior Rep",
    adherence: "in",
    blocks: [
      { id: "act-j1", type: "phone", label: "Phone", startMinutes: 0, durationMinutes: 150 },
      { id: "act-j2", type: "lunch", label: "Lunch", startMinutes: 150, durationMinutes: 60 },
      { id: "act-j3", type: "phone", label: "Phone", startMinutes: 210, durationMinutes: 270 },
    ],
  },
  {
    id: "rep-002",
    name: "Alex Rivera",
    role: "Rep",
    adherence: "in",
    blocks: [
      { id: "act-a1", type: "phone", label: "Phone", startMinutes: 30, durationMinutes: 120 },
      { id: "act-a2", type: "break", label: "Break", startMinutes: 150, durationMinutes: 15 },
      { id: "act-a3", type: "phone", label: "Phone", startMinutes: 165, durationMinutes: 315 },
    ],
  },
  {
    id: "rep-003",
    name: "Sam Patel",
    role: "Rep",
    adherence: "out",
    blocks: [
      { id: "act-s1", type: "training", label: "Training", startMinutes: 0, durationMinutes: 120 },
      { id: "act-s2", type: "phone", label: "Phone", startMinutes: 120, durationMinutes: 360 },
    ],
  },
  {
    id: "rep-004",
    name: "Taylor Brooks",
    role: "Rep",
    adherence: "in",
    blocks: [
      { id: "act-t1", type: "phone", label: "Phone", startMinutes: 0, durationMinutes: 90 },
      { id: "act-t2", type: "meeting", label: "Team sync", startMinutes: 90, durationMinutes: 30 },
      { id: "act-t3", type: "phone", label: "Phone", startMinutes: 120, durationMinutes: 360 },
    ],
  },
  {
    id: "rep-005",
    name: "Morgan Lee",
    role: "Rep",
    adherence: "unknown",
    blocks: [
      { id: "act-m1", type: "phone", label: "Phone", startMinutes: 60, durationMinutes: 180 },
      { id: "act-m2", type: "lunch", label: "Lunch", startMinutes: 240, durationMinutes: 45 },
      { id: "act-m3", type: "phone", label: "Phone", startMinutes: 285, durationMinutes: 195 },
    ],
  },
];
