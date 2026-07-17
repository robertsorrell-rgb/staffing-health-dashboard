import { useCallback, useState } from "react";
import { MOCK_TEAM } from "@/data/mock-team";
import type { ScheduleBlock, TeamConsultant } from "@/types/schedule";

export function useTeamSchedule() {
  const [team, setTeam] = useState<TeamConsultant[]>(() =>
    structuredClone(MOCK_TEAM),
  );

  const updateBlock = useCallback(
    (consultantId: string, blockId: string, updater: (block: ScheduleBlock) => ScheduleBlock) => {
      setTeam((prev) =>
        prev.map((c) => {
          if (c.id !== consultantId) return c;
          return {
            ...c,
            blocks: c.blocks.map((b) => (b.id === blockId ? updater(b) : b)),
          };
        }),
      );
    },
    [],
  );

  const moveBlockStart = useCallback(
    (consultantId: string, blockId: string, deltaMinutes: number) => {
      updateBlock(consultantId, blockId, (b) => ({
        ...b,
        startMinutes: Math.max(0, b.startMinutes + deltaMinutes),
      }));
    },
    [updateBlock],
  );

  return { team, setTeam, updateBlock, moveBlockStart };
}
