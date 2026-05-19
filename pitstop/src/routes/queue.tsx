export function QueuePage() {
  return (
    <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
      <p className="text-lg font-medium text-foreground">Approval queue</p>
      <p className="mt-2 text-sm">Pending requests — wire to GET /api/approvals next.</p>
    </div>
  );
}
