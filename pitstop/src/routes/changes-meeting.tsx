import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitScheduleChange } from "@/lib/api-client";
import { blockToIsoWindow } from "@/lib/schedule-time";
import { toast } from "@/hooks/use-toast";
import { isDevPreview } from "@/lib/dev-preview";

export function MeetingRequestPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("Weekly pipeline sync");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("15:00");

  const mutation = useMutation({
    mutationFn: async () => {
      const { windowStart, windowEnd } = blockToIsoWindow(0, 60);
      return submitScheduleChange({
        consultantId: "team",
        consultantName: "Team meeting",
        activityId: "",
        changeType: "add_meeting",
        windowStart,
        windowEnd,
        title,
        date,
        startTime,
        endTime,
        managerName: "Preview Manager",
        teamName: "High School SC",
      } as Parameters<typeof submitScheduleChange>[0]);
    },
    onSuccess: (data) => {
      if (data.decision === "approve") {
        toast({ title: "Meeting approved", description: data.reasoning, variant: "success" });
      } else if (data.decision === "deny") {
        toast({ title: "Meeting denied", description: data.reasoning, variant: "destructive" });
      } else {
        toast({ title: "Sent for WFM review", description: data.reasoning, variant: "review" });
      }
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
        <h2 className="text-xl font-semibold">Add meeting</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Simulates meeting capacity checks — try <strong>2:00 PM</strong> start for a deny with alternatives.
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
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Start</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>End</Label>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        {isDevPreview() && (
          <p className="text-xs text-amber-400/90">
            Tip: 1:00–3:00 PM → simulated deny. 10:00 AM → approve.
          </p>
        )}
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? "Checking capacity…" : "Submit for review"}
        </Button>
      </form>
    </div>
  );
}

