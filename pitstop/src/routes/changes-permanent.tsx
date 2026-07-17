import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitScheduleChange } from "@/lib/api-client";
import { blockToIsoWindow } from "@/lib/schedule-time";
import { toast } from "@/hooks/use-toast";
import { MOCK_TEAM } from "@/data/mock-team";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function PermanentChangePage() {
  const navigate = useNavigate();
  const consultant = MOCK_TEAM[2];
  const [slackId, setSlackId] = useState("@sam.patel");
  const [startDate, setStartDate] = useState("2026-05-26");
  const [weeks, setWeeks] = useState(8);
  const [pattern, setPattern] = useState<Record<string, string>>({
    Mon: "9a-5p",
    Tue: "9a-5p",
    Wed: "9a-5p",
    Thu: "9a-5p",
    Fri: "9a-5p",
    Sat: "",
    Sun: "",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const { windowStart, windowEnd } = blockToIsoWindow(0, 480);
      return submitScheduleChange({
        consultantId: consultant.id,
        consultantName: consultant.name,
        activityId: "",
        changeType: "permanent_schedule_change",
        windowStart,
        windowEnd,
        consultantSlackId: slackId,
        startDate,
        weeks,
        pattern,
      } as Parameters<typeof submitScheduleChange>[0]);
    },
    onSuccess: (data) => {
      toast({
        title: "Submitted for WFM review",
        description: data.reasoning,
        variant: "review",
      });
      void navigate("/submissions");
    },
    onError: (e) => {
      toast({
        title: "Failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="mx-auto max-w-lg space-y-6 pb-20">
      <Link to="/changes" className="text-sm text-muted-foreground hover:text-foreground">
        ← All change types
      </Link>
      <div>
        <h2 className="text-xl font-semibold">Permanent schedule change</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Simulates Schedule Changes tab — always queues for WFM before Apply runs.
        </p>
      </div>
      <form
        className="space-y-4 rounded-xl border border-border bg-card/50 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label>Consultant Slack ID</Label>
          <Input value={slackId} onChange={(e) => setSlackId(e.target.value)} placeholder="@first.last" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Weeks</Label>
            <Input
              type="number"
              min={1}
              max={52}
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DAYS.map((d) => (
            <div key={d} className="space-y-1">
              <Label className="text-xs">{d}</Label>
              <Input
                className="h-8 text-xs"
                placeholder="off"
                value={pattern[d] ?? ""}
                onChange={(e) => setPattern((p) => ({ ...p, [d]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? "Validating pattern…" : "Submit for WFM review"}
        </Button>
      </form>
    </div>
  );
}
