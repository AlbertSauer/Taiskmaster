import { useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTasks } from "@/lib/taskStore";
import { formatLocalDate } from "@/lib/dateTime";

const SmartVacation = () => {
  const { tasks, addTask } = useTasks();
  const today = new Date();
  const todayIso = formatLocalDate(today);
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [label, setLabel] = useState("Vacation");
  const [saving, setSaving] = useState(false);

  const vacationDays = useMemo(() => {
    const days = tasks
      .filter((task) => {
        const tags = Array.isArray(task.tags) ? task.tags.map((tag) => String(tag).toLowerCase()) : [];
        return tags.includes("vacation") || tags.includes("time-off") || task.title.toLowerCase() === "vacation";
      })
      .map((task) => task.date)
      .sort();
    return Array.from(new Set(days));
  }, [tasks]);

  const handleSaveVacation = async () => {
    let start = new Date(`${startDate}T00:00:00`);
    let end = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      toast.error("Please select valid start and end dates.");
      return;
    }
    if (end < start) {
      const tmp = start;
      start = end;
      end = tmp;
    }

    setSaving(true);
    try {
      const existingVacationDates = new Set(vacationDays);
      const toCreate: string[] = [];
      const cursor = new Date(start);
      while (cursor <= end && toCreate.length < 366) {
        const dateStr = formatLocalDate(cursor);
        if (!existingVacationDates.has(dateStr)) toCreate.push(dateStr);
        cursor.setDate(cursor.getDate() + 1);
      }

      for (const date of toCreate) {
        await addTask({
          title: label.trim() || "Vacation",
          description: "Time off period created from Smart Vacation.",
          date,
          time: undefined,
          duration: undefined,
          location: undefined,
          priority: "low",
          tags: ["vacation", "time-off", "locked"],
          completed: false,
        });
      }

      toast.success(
        toCreate.length === 0
          ? "Vacation period already existed."
          : `Saved vacation period: ${toCreate.length} day${toCreate.length === 1 ? "" : "s"} marked.`,
      );
    } catch {
      toast.error("Could not save vacation period.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <Header showActions={false} />

      <main className="container py-12">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Smart Vacation</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Plan your vacation period</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Add your time-off range and we will mark it across calendar and dashboard.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Vacation" />
            </div>
          </div>

          <div className="mt-6">
            <Button variant="hero" onClick={handleSaveVacation} disabled={saving}>
              {saving ? "Saving vacation..." : "Save Vacation Period"}
            </Button>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold tracking-tight">Marked vacation days</h2>
          {vacationDays.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No vacation days saved yet.</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {vacationDays[0]} to {vacationDays[vacationDays.length - 1]} ({vacationDays.length} day{vacationDays.length === 1 ? "" : "s"})
            </p>
          )}
        </section>
      </main>
    </div>
  );
};

export default SmartVacation;
