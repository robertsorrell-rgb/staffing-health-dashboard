import { useCallback, useState } from "react";
import { MOCK_TEAM } from "@/data/mock-team";
import type { ScheduleBlock, TeamRep } from "@/types/schedule";

export function useTeamSchedule() {
  const [team, setTeam] = useState<TeamRep[]>(() =>
    structuredClone(MOCK_TEAM),
  );

  const updateBlock = useCallback(
    (repId: string, blockId: string, updater: (block: ScheduleBlock) => ScheduleBlock) => {
      setTeam((prev) =>
        prev.map((rep) => {
          if (rep.id !== repId) return rep;
          return {
            ...rep,
            blocks: rep.blocks.map((b) => (b.id === blockId ? updater(b) : b)),
          };
        }),
      );
    },
    [],
  );

  const moveBlockStart = useCallback(
    (repId: string, blockId: string, deltaMinutes: number) => {
      updateBlock(repId, blockId, (b) => ({
        ...b,
        startMinutes: Math.max(0, b.startMinutes + deltaMinutes),
      }));
    },
    [updateBlock],
  );

  return { team, setTeam, updateBlock, moveBlockStart };
}
