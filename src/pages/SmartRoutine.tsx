import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTasks } from "@/lib/taskStore";
import { findProtectedWorkConflicts, moveTasksOutsideProtectedWork } from "@/lib/scheduleGuards";
import type { Task } from "@/types/task";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type RoutineTask = Omit<Task, "id" | "createdAt">;

const dayOptions = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
] as const;

const SmartRoutine = () => {
  const navigate = useNavigate();
  const { addTask, tasks } = useTasks();
  const [loading, setLoading] = useState(false);
  const [workMode, setWorkMode] = useState<"office" | "hybrid" | "remote" | "shift">("hybrid");
  const [energyPeakTime, setEnergyPeakTime] = useState("10:00");
  const todayDate = new Date();
  const todayIso = todayDate.toISOString().split("T")[0];
  const lastDayOfMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0);
  const lastDayOfMonthIso = lastDayOfMonth.toISOString().split("T")[0];
  const [endDate, setEndDate] = useState(lastDayOfMonthIso);
  const [wakeTime, setWakeTime] = useState("07:00");
  const [sleepTime, setSleepTime] = useState("23:00");
  const [workStartTime, setWorkStartTime] = useState("09:00");
  const [workEndTime, setWorkEndTime] = useState("17:00");
  const [breakOneTime, setBreakOneTime] = useState("12:00");
  const [breakOneDuration, setBreakOneDuration] = useState("30");
  const [breakTwoEnabled, setBreakTwoEnabled] = useState(false);
  const [breakTwoTime, setBreakTwoTime] = useState("15:00");
  const [breakTwoDuration, setBreakTwoDuration] = useState("15");
  const [workoutPerWeek, setWorkoutPerWeek] = useState("3");
  const [workoutDuration, setWorkoutDuration] = useState("60");
  const [learningMinutesPerWeek, setLearningMinutesPerWeek] = useState("180");
  const [selfcareMinutesPerWeek, setSelfcareMinutesPerWeek] = useState("120");
  const [workingDays, setWorkingDays] = useState<string[]>(["monday", "tuesday", "wednesday", "thursday", "friday"]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTasks, setPreviewTasks] = useState<RoutineTask[]>([]);

  useEffect(() => {
    const raw = localStorage.getItem("taiskmaster.routine.prefill");
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data.work_mode === "string" && ["office", "hybrid", "remote", "shift"].includes(data.work_mode)) setWorkMode(data.work_mode as typeof workMode);
      if (Array.isArray(data.working_days)) setWorkingDays(data.working_days.filter((d): d is string => typeof d === "string"));
      if (typeof data.wake_time === "string") setWakeTime(data.wake_time);
      if (typeof data.sleep_time === "string") setSleepTime(data.sleep_time);
      if (typeof data.work_start_time === "string") setWorkStartTime(data.work_start_time);
      if (typeof data.work_end_time === "string") setWorkEndTime(data.work_end_time);
      if (typeof data.energy_peak_time === "string") setEnergyPeakTime(data.energy_peak_time);
      if (typeof data.workout_per_week === "number") setWorkoutPerWeek(String(data.workout_per_week));
      if (typeof data.workout_duration === "number") setWorkoutDuration(String(data.workout_duration));
      if (typeof data.learning_minutes_per_week === "number") setLearningMinutesPerWeek(String(data.learning_minutes_per_week));
      if (typeof data.selfcare_minutes_per_week === "number") setSelfcareMinutesPerWeek(String(data.selfcare_minutes_per_week));
      if (Array.isArray(data.work_breaks) && data.work_breaks.length > 0) {
        const first = data.work_breaks[0] as { time?: string; duration?: number };
        if (first?.time) setBreakOneTime(first.time);
        if (typeof first?.duration === "number") setBreakOneDuration(String(first.duration));
        if (data.work_breaks.length > 1) {
          const second = data.work_breaks[1] as { time?: string; duration?: number };
          setBreakTwoEnabled(true);
          if (second?.time) setBreakTwoTime(second.time);
          if (typeof second?.duration === "number") setBreakTwoDuration(String(second.duration));
        }
      }
    } catch {
      // ignore malformed prefill
    } finally {
      localStorage.removeItem("taiskmaster.routine.prefill");
    }
  }, []);

  const canSubmit = useMemo(() => Boolean(endDate) && workingDays.length > 0, [endDate, workingDays.length]);

  const toggleDay = (day: string) => {
    setWorkingDays((current) => current.includes(day) ? current.filter((d) => d !== day) : [...current, day]);
  };

  const warnAboutProtectedWork = (warnings: string[]) => {
    if (!warnings.length) return;
    toast.warning("Adjusted routine around protected work time.", {
      description: warnings.slice(0, 2).join(" "),
    });
  };

  const handleGenerate = async () => {
    if (!canSubmit) {
      toast.error("Please choose an end date and at least one working day.");
      return;
    }
    setLoading(true);
    try {
      if (!API_BASE) throw new Error("Backend is not connected");
      const token = localStorage.getItem("authToken");
      const response = await fetch(`${API_BASE}/api/chat/routine-plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          end_date: endDate,
          questionnaire: {
            work_mode: workMode,
            working_days: workingDays,
            wake_time: wakeTime,
            sleep_time: sleepTime,
            work_start_time: workStartTime,
            work_end_time: workEndTime,
            energy_peak_time: energyPeakTime,
            work_breaks: [
              { time: breakOneTime, duration: Number(breakOneDuration || 30) },
              ...(breakTwoEnabled ? [{ time: breakTwoTime, duration: Number(breakTwoDuration || 15) }] : []),
            ],
            workout_per_week: Number(workoutPerWeek),
            workout_duration: Number(workoutDuration || 60),
            learning_minutes_per_week: Number(learningMinutesPerWeek),
            selfcare_minutes_per_week: Number(selfcareMinutesPerWeek),
          },
          existing_tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            note: task.note,
            date: task.date,
            time: task.time,
            duration: task.duration,
            location: task.location,
            priority: task.priority,
            tags: task.tags,
            completed: task.completed,
          })),
        }),
      });
      if (!response.ok) throw new Error("Routine generation failed");
      const data = await response.json() as { tasks?: RoutineTask[]; message?: string };
      const routineTasks = Array.isArray(data.tasks) ? data.tasks : [];
      if (data.message) {
        toast.message(data.message);
      }
      if (routineTasks.length === 0) {
        toast.error("No routine tasks returned.");
        return;
      }
      const safeRoutine = moveTasksOutsideProtectedWork(routineTasks, [...tasks, ...routineTasks]);
      warnAboutProtectedWork(safeRoutine.warnings);
      setPreviewTasks(safeRoutine.tasks);
      setPreviewOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create routine.");
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewTaskChange = (index: number, patch: Partial<RoutineTask>) => {
    setPreviewTasks((current) => current.map((task, i) => (i === index ? { ...task, ...patch } : task)));
  };

  const handleRemovePreviewTask = (index: number) => {
    setPreviewTasks((current) => current.filter((_, i) => i !== index));
  };

  const handleAcceptPreview = async () => {
    if (previewTasks.length === 0) {
      toast.error("No tasks to save.");
      return;
    }
    setLoading(true);
    try {
      const signature = (task: RoutineTask) =>
        `${task.title.trim().toLowerCase()}|${task.date}|${task.time || "00:00"}`;
      const existingSignatures = new Set(
        tasks.map((task) => `${task.title.trim().toLowerCase()}|${task.date}|${task.time || "00:00"}`),
      );
      const seen = new Set<string>();
      const safePreview = moveTasksOutsideProtectedWork(previewTasks, tasks);
      warnAboutProtectedWork(safePreview.warnings);
      const conflicts = findProtectedWorkConflicts(safePreview.tasks, tasks);
      if (conflicts.length > 0) {
        toast.warning("Some routine tasks still overlap protected work time.", {
          description: `${conflicts.length} task${conflicts.length === 1 ? "" : "s"} could not be moved automatically.`,
        });
      }
      const filtered = safePreview.tasks.filter((task) => {
        const key = signature(task);
        if (existingSignatures.has(key)) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      for (const task of filtered) {
        await addTask(task);
      }
      toast.success(`Routine saved: ${filtered.length} tasks added.`);
      setPreviewOpen(false);
      navigate("/");
    } catch {
      toast.error("Could not save routine tasks.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <Header showActions={false} />

      <main className="container py-10">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Smart Routine</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Build your routine</h1>
          <p className="mt-2 text-sm text-muted-foreground">Answer these questions and we will generate a full working routine into your calendar.</p>

          <div className="mt-6 space-y-5">
            <section className="rounded-xl border border-border bg-background/50 p-4">
              <h2 className="text-sm font-semibold tracking-tight">Work</h2>
              <div className="mt-3 grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Work mode</Label>
                  <Select value={workMode} onValueChange={(v) => setWorkMode(v as typeof workMode)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="office">Office</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                      <SelectItem value="remote">Remote</SelectItem>
                      <SelectItem value="shift">Shift</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Energy peak time</Label>
                  <Input type="time" value={energyPeakTime} onChange={(e) => setEnergyPeakTime(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Work starts</Label>
                  <Input type="time" value={workStartTime} onChange={(e) => setWorkStartTime(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Work ends</Label>
                  <Input type="time" value={workEndTime} onChange={(e) => setWorkEndTime(e.target.value)} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Work days</Label>
                  <div className="flex flex-wrap gap-2">
                    {dayOptions.map((day) => (
                      <Button
                        key={day.key}
                        type="button"
                        variant={workingDays.includes(day.key) ? "hero" : "outline"}
                        size="sm"
                        onClick={() => toggleDay(day.key)}
                      >
                        {day.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Planned breaks at work</Label>
                  <div className="grid gap-2 md:grid-cols-4">
                    <Input type="time" value={breakOneTime} onChange={(e) => setBreakOneTime(e.target.value)} />
                    <Input type="number" min={10} max={120} value={breakOneDuration} onChange={(e) => setBreakOneDuration(e.target.value)} placeholder="Duration min" />
                    <Button type="button" variant={breakTwoEnabled ? "hero" : "outline"} onClick={() => setBreakTwoEnabled((v) => !v)}>
                      {breakTwoEnabled ? "Second break on" : "Add second break"}
                    </Button>
                  </div>
                  {breakTwoEnabled && (
                    <div className="mt-2 grid gap-2 md:grid-cols-4">
                      <Input type="time" value={breakTwoTime} onChange={(e) => setBreakTwoTime(e.target.value)} />
                      <Input type="number" min={10} max={120} value={breakTwoDuration} onChange={(e) => setBreakTwoDuration(e.target.value)} placeholder="Duration min" />
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-background/50 p-4">
              <h2 className="text-sm font-semibold tracking-tight">Personal</h2>
              <div className="mt-3 grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Wake time</Label>
                  <Input type="time" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Sleep time</Label>
                  <Input type="time" value={sleepTime} onChange={(e) => setSleepTime(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Learning minutes per week</Label>
                  <Input type="number" min={0} max={1200} value={learningMinutesPerWeek} onChange={(e) => setLearningMinutesPerWeek(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Workouts per week</Label>
                  <Input type="number" min={0} max={7} value={workoutPerWeek} onChange={(e) => setWorkoutPerWeek(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Workout duration (minutes)</Label>
                  <Input type="number" min={15} max={180} value={workoutDuration} onChange={(e) => setWorkoutDuration(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Selfcare minutes per week</Label>
                  <Input type="number" min={0} max={1200} value={selfcareMinutesPerWeek} onChange={(e) => setSelfcareMinutesPerWeek(e.target.value)} />
                </div>

              </div>
            </section>

            <div className="space-y-2">
              <Label>Plan routine until</Label>
              <Input
                type="date"
                value={endDate}
                min={todayIso}
                max={lastDayOfMonthIso}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-7">
            <Button variant="hero" size="lg" onClick={handleGenerate} disabled={loading || !canSubmit}>
              {loading ? "Generating routine..." : "Generate Routine Plan"}
            </Button>
          </div>
        </section>
      </main>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Routine Preview</DialogTitle>
            <DialogDescription>Review and edit tasks before saving them to your calendar.</DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {previewTasks.map((task, index) => (
              <div key={`${task.title}-${index}`} className="rounded-lg border border-border bg-card p-3">
                <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_120px_100px_100px_130px_90px]">
                  <Input
                    value={task.title}
                    onChange={(e) => handlePreviewTaskChange(index, { title: e.target.value })}
                    placeholder="Title"
                  />
                  <Input
                    type="date"
                    value={task.date}
                    onChange={(e) => handlePreviewTaskChange(index, { date: e.target.value })}
                  />
                  <Input
                    type="time"
                    value={task.time || ""}
                    onChange={(e) => handlePreviewTaskChange(index, { time: e.target.value || undefined })}
                  />
                  <Input
                    type="number"
                    min={15}
                    value={task.duration || 60}
                    onChange={(e) => handlePreviewTaskChange(index, { duration: Number(e.target.value || 60) })}
                  />
                  <Select
                    value={task.priority}
                    onValueChange={(value) => handlePreviewTaskChange(index, { priority: value as RoutineTask["priority"] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="very-low">Very low</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" onClick={() => handleRemovePreviewTask(index)}>Remove</Button>
                </div>
                <Input
                  className="mt-2"
                  value={task.description || ""}
                  onChange={(e) => handlePreviewTaskChange(index, { description: e.target.value })}
                  placeholder="Description"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPreviewOpen(false)} disabled={loading}>Cancel</Button>
            <Button variant="hero" onClick={handleAcceptPreview} disabled={loading}>
              {loading ? "Saving..." : "Accept and Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SmartRoutine;
