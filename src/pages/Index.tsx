import { useEffect, useMemo, useState } from "react";
import { Sparkles, Search, ArrowDownUp, CheckCircle2, Calendar as CalIcon, MapPin, HeartHandshake, Dumbbell, RefreshCcw, BookOpen, Brain, GraduationCap, Smile, X, Activity } from "lucide-react";
import { Header } from "@/components/Header";
import { TaskCard } from "@/components/TaskCard";
import { TaskDialog } from "@/components/TaskDialog";
import { PlanPreviewDialog } from "@/components/PlanPreviewDialog";
import { GoogleCalendarImportDialog } from "@/components/GoogleCalendarImportDialog";
import { MiniCalendar } from "@/components/MiniCalendar";
import { AssistantPanel, type AssistantAction } from "@/components/AssistantPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTasks, sortTasks, optimizeSchedule } from "@/lib/taskStore";
import { useAuth } from "@/hooks/useAuth";
import type { SortMode, Task } from "@/types/task";
import { format, isSameDay, parseISO, isToday } from "date-fns";
import { toast } from "sonner";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type RecommendationCategory =
  | "schedule"
  | "family"
  | "sports"
  | "health"
  | "recovery"
  | "personal"
  | "hobbies"
  | "meditation"
  | "reading"
  | "studying"
  | "fun";

interface Recommendation {
  title: string;
  reason: string;
  category: RecommendationCategory;
  suggested_task?: Omit<Task, "id" | "createdAt">;
}

type TaskDialogInitial = Partial<Pick<Task, "id" | "createdAt">> & Omit<Task, "id" | "createdAt">;
type InsightStatus = "healthy" | "watch" | "needs_changes";
interface ActivityMixPoint {
  label: string;
  minutes: number;
  percent: number;
  color?: string;
}
interface ActivityInsights {
  status: InsightStatus;
  health_score: number;
  summary: string;
  guidance: string[];
  graphs: {
    activity_mix: ActivityMixPoint[];
    load: {
      avg_minutes_per_day: number;
      busy_days: number;
      scheduled_days: number;
    };
  };
}
interface ActivityScoreHistoryItem extends ActivityInsights {
  id: string;
  created_at: string;
}

const Index = () => {
  const { user } = useAuth();
  const { tasks, addTask, updateTask, deleteTask, deleteCalendar, replaceAll, toggleComplete } = useTasks();
  const [sort, setSort] = useState<SortMode>("priority");
  const [query, setQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<TaskDialogInitial | null>(null);
  const [completedDialogOpen, setCompletedDialogOpen] = useState(false);
  const [activityScoresOpen, setActivityScoresOpen] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recommendationsOpen, setRecommendationsOpen] = useState(false);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [recommendationRefreshKey, setRecommendationRefreshKey] = useState(0);
  const [planAction, setPlanAction] = useState<AssistantAction | null>(null);
  const [insights, setInsights] = useState<ActivityInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [scoreHistory, setScoreHistory] = useState<ActivityScoreHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [avgScoreLoading, setAvgScoreLoading] = useState(false);

  const visible = useMemo(() => {
    let list = tasks;
    if (selectedDate) {
      // When a date is selected, filter to that day. Click again to clear.
      list = list.filter((t) => isSameDay(parseISO(t.date), selectedDate));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((t) =>
        t.title.toLowerCase().includes(q)
        || t.description?.toLowerCase().includes(q)
        || t.location?.toLowerCase().includes(q)
        || t.tags?.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return sortTasks(list, sort);
  }, [tasks, sort, query, selectedDate]);

  const stats = useMemo(() => {
    const todayTasks = tasks.filter((t) => isToday(parseISO(t.date)));
    return { today: todayTasks.length };
  }, [tasks]);
  const completedTasks = useMemo(() => sortTasks(tasks.filter((task) => task.completed), "datetime"), [tasks]);
  const liveWindow = useMemo(() => {
    const openTasks = tasks.filter((task) => !task.completed);
    const now = new Date();

    const withTime = openTasks
      .filter((task) => !!task.date)
      .map((task) => {
        const start = new Date(`${task.date}T${task.time || "00:00"}:00`);
        const duration = Math.max(15, task.duration || 60);
        const end = new Date(start.getTime() + duration * 60_000);
        return { task, start, end };
      })
      .filter((item) => !Number.isNaN(item.start.getTime()))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const ongoing = withTime.find((item) => now >= item.start && now < item.end);
    if (ongoing) {
      return { mode: "ongoing" as const, ...ongoing };
    }

    const upcoming = withTime.find((item) => item.start >= now);
    if (upcoming) {
      return { mode: "upcoming" as const, ...upcoming };
    }

    return null;
  }, [tasks]);
  const nextUpcomingPreview = useMemo(() => {
    if (!liveWindow || liveWindow.mode !== "ongoing") return null;
    const openTasks = tasks.filter((task) => !task.completed);
    return openTasks
      .filter((task) => !!task.date)
      .map((task) => {
        const start = new Date(`${task.date}T${task.time || "00:00"}:00`);
        return { task, start };
      })
      .filter((item) => !Number.isNaN(item.start.getTime()) && item.start > liveWindow.start)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;
  }, [liveWindow, tasks]);

  const displayName = user?.full_name?.trim() || user?.username || "Your Day";
  const averageActivityScore = useMemo(() => {
    if (scoreHistory.length === 0) return null;
    const sum = scoreHistory.reduce((total, score) => total + Number(score.health_score || 0), 0);
    return Math.round(sum / scoreHistory.length);
  }, [scoreHistory]);

  const handleSubmit = async (data: Omit<Task, "id" | "createdAt"> & { id?: string }) => {
    try {
      if (data.id) {
        await updateTask(data.id, data);
        toast.success("Task updated");
      } else {
        const created = await addTask(data);
        setSelectedDate(parseISO(created.date));
        toast.success("Task created");
      }
    } catch (error) {
      toast.error(data.id ? "Could not update task." : "Could not create task.");
      throw error;
    }
  };

  const handleEdit = (t: Task) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openDraftTask = (draft: Omit<Task, "id" | "createdAt">) => {
    setEditing({
      title: draft.title,
      description: draft.description,
      date: draft.date || new Date().toISOString().split("T")[0],
      time: draft.time,
      duration: draft.duration,
      location: draft.location,
      priority: draft.priority || "medium",
      tags: Array.isArray(draft.tags) ? draft.tags : [],
      completed: !!draft.completed,
    });
    setDialogOpen(true);
  };

  const handleImport = (items: Omit<Task, "id" | "createdAt">[]) => {
    items.forEach((item) => addTask(item));
    toast.success(`${items.length} event${items.length === 1 ? "" : "s"} imported from Google Calendar.`);
  };

  const handleOptimize = async () => {
    try {
      let baseTasks = tasks;

      if (API_BASE) {
        const token = localStorage.getItem("authToken");
        const response = await fetch(`${API_BASE}/api/chat/optimize-schedule`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            tasks: tasks.map((task) => ({
              id: task.id,
              title: task.title,
              description: task.description,
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

        if (response.ok) {
          const data = await response.json() as { tasks?: Task[] };
          if (Array.isArray(data.tasks) && data.tasks.length === tasks.length) {
            baseTasks = data.tasks;
          }
        }
      }

      await replaceAll(optimizeSchedule(baseTasks));
      toast.success("Schedule optimized", {
        description: "Tasks were improved and prioritized, then grouped by location and time.",
      });
    } catch {
      toast.error("Could not optimize schedule right now.");
    }
  };

  const handleDeleteCalendar = async () => {
    try {
      await deleteCalendar();
      setRecommendations([]);
      setSelectedDate(undefined);
      toast.success("Calendar deleted");
    } catch {
      toast.error("Could not delete the calendar.");
    }
  };

  const handleRecommend = async () => {
    if (!API_BASE) {
      toast.error("Live recommendations need the backend to be connected.");
      return;
    }

    try {
      setRecommendationsOpen(true);
      setLoadingRecommendations(true);
      const nextRefreshKey = recommendationRefreshKey + 1;
      setRecommendationRefreshKey(nextRefreshKey);
      const token = localStorage.getItem("authToken");
      const response = await fetch(`${API_BASE}/api/chat/recommendations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          input: "Generate proactive schedule recommendations.",
          exclude_titles: recommendations.flatMap((recommendation) => {
            const values = [recommendation.title];
            if (recommendation.suggested_task?.title) values.push(recommendation.suggested_task.title);
            return values;
          }),
          refresh_token: `${Date.now()}-${nextRefreshKey}-${Math.random().toString(36).slice(2, 10)}`,
          target_date: format(selectedDate ?? new Date(), "yyyy-MM-dd"),
          tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
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

      if (!response.ok) throw new Error("Could not generate recommendations");
      const data = await response.json() as { recommendations?: Recommendation[] };
      setRecommendations(data.recommendations ?? []);
      toast.success("Recommendations ready");
    } catch {
      toast.error("Recommendations are unavailable right now.");
    } finally {
      setLoadingRecommendations(false);
    }
  };

  const handleAddRecommendation = (recommendation: Recommendation) => {
    if (!recommendation.suggested_task) return;
    openDraftTask(recommendation.suggested_task);
    setRecommendations((current) => current.filter((item) => item !== recommendation));
  };

  const handleDismissRecommendations = () => {
    setRecommendationsOpen(false);
    setRecommendations([]);
    setLoadingRecommendations(false);
  };

  const handleProposedAction = (action: AssistantAction) => {
    if (action.type === "create_task" && action.task) {
      openDraftTask({
        title: action.task.title || "New Task",
        description: action.task.description,
        date: action.task.date || new Date().toISOString().split("T")[0],
        time: action.task.time,
        duration: action.task.duration,
        location: action.task.location,
        priority: action.task.priority || "medium",
        tags: Array.isArray(action.task.tags) ? action.task.tags : [],
        completed: !!action.task.completed,
      });
    } else if (action.type === "update_task" && action.task_id && action.updates) {
      const existingTask = tasks.find((t) => t.id === action.task_id);
      if (existingTask) {
        setEditing({ ...existingTask, ...action.updates });
        setDialogOpen(true);
      }
    } else if (action.type === "create_tasks" && action.tasks) {
      setPlanAction(action);
    }
  };

  const handleConfirmPlan = async () => {
    if (!planAction || !planAction.tasks) return;
    try {
      for (const task of planAction.tasks) {
        await addTask({
          title: task.title || "New Task",
          description: task.description || undefined,
          date: task.date || new Date().toISOString().split("T")[0],
          time: task.time || undefined,
          duration: task.duration || undefined,
          location: task.location || undefined,
          priority: task.priority || "medium",
          tags: Array.isArray(task.tags) ? task.tags : [],
          completed: !!task.completed,
        });
      }
      toast.success(`Successfully saved ${planAction.tasks.length} tasks!`);
      setPlanAction(null);
    } catch (error) {
      toast.error("Failed to save some tasks.");
    }
  };

  const handleGenerateInsights = async () => {
    setInsightsLoading(true);
    try {
      if (!API_BASE) {
        toast.error("AI insights need the backend to be connected.");
        setInsights(null);
        return;
      }
      const token = localStorage.getItem("authToken");
      const response = await fetch(`${API_BASE}/api/chat/activity-insights`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
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
      if (!response.ok) throw new Error("Could not generate insights");
      const data = await response.json() as ActivityInsights;
      setInsights(data);
      void loadActivityScores(false);
      toast.success("Insights generated");
    } catch {
      setInsights(null);
      toast.error("Could not generate insights right now.");
    } finally {
      setInsightsLoading(false);
    }
  };

  const loadActivityScores = async (showErrorToast = true) => {
    setHistoryLoading(true);
    setAvgScoreLoading(true);
    try {
      if (!API_BASE) {
        setScoreHistory([]);
        return;
      }
      const token = localStorage.getItem("authToken");
      const response = await fetch(`${API_BASE}/api/chat/activity-scores`, {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!response.ok) throw new Error("Could not load activity scores");
      const data = await response.json() as { scores?: ActivityScoreHistoryItem[] };
      setScoreHistory(Array.isArray(data.scores) ? data.scores : []);
    } catch {
      setScoreHistory([]);
      if (showErrorToast) toast.error("Could not load activity scores.");
    } finally {
      setHistoryLoading(false);
      setAvgScoreLoading(false);
    }
  };

  useEffect(() => {
    setRecommendations((current) => current.filter((recommendation) => {
      const suggestedTitle = recommendation.suggested_task?.title?.toLowerCase();
      if (!suggestedTitle) return true;
      return !tasks.some((task) => task.title.toLowerCase() === suggestedTitle);
    }));
  }, [tasks]);

  useEffect(() => {
    void loadActivityScores(false);
    const interval = window.setInterval(() => {
      void loadActivityScores(false);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <Header
        onOptimize={handleOptimize}
        onNewTask={handleNew}
        onImportCalendar={() => setImportOpen(true)}
        onDeleteCalendar={handleDeleteCalendar}
        onShowCompletedTasks={() => setCompletedDialogOpen(true)}
        onShowActivityScores={() => {
          setActivityScoresOpen(true);
          loadActivityScores();
        }}
      />

      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 bg-gradient-glow pointer-events-none" />
        <div className="container relative pt-12 pb-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div>
              <div className="max-w-2xl animate-slide-up">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="mb-2 text-sm font-medium text-primary">Good to see you</p>
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                      {displayName}
                    </h1>
                    <p className="mt-2 text-muted-foreground">
                      {stats.today > 0
                        ? `${stats.today} task${stats.today === 1 ? "" : "s"} on for today.`
                        : "No tasks scheduled today. A perfect time to plan ahead."}
                    </p>
                  </div>
                  <div className="h-20 w-20 shrink-0 rounded-lg border border-border bg-card p-2 text-center shadow-xs">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Avg score</p>
                    <p className="mt-1 text-xl font-semibold leading-none">
                      {avgScoreLoading ? "..." : averageActivityScore ?? "--"}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">/100</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 max-w-md space-y-3">
                <LiveWindowCard liveWindow={liveWindow} nextUpcomingPreview={nextUpcomingPreview} compact />
                <ActivityInsightsPanel
                  insights={insights}
                  loading={insightsLoading}
                  onGenerate={handleGenerateInsights}
                  hasTasks={tasks.length > 0}
                />
              </div>
            </div>

            <div className="lg:justify-self-end w-full max-w-[320px]">
              <MiniCalendar tasks={tasks} selected={selectedDate} onSelect={setSelectedDate} />
            </div>
          </div>
        </div>
      </section>

      <main className="container pb-24">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks, tags, locations…"
              className="pl-9 h-10"
            />
          </div>

          <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
            <SelectTrigger className="h-10 w-[170px]">
              <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">By priority</SelectItem>
              <SelectItem value="datetime">By date & time</SelectItem>
              <SelectItem value="location">By location</SelectItem>
            </SelectContent>
          </Select>

          {selectedDate && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedDate(undefined)}>
              Clear date filter
            </Button>
          )}
        </div>

        {visible.length === 0 ? (
          <EmptyState onCreate={handleNew} hasFilters={!!query || !!selectedDate} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 animate-fade-in">
            {visible.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                onEdit={handleEdit}
                onDelete={(id) => { deleteTask(id); toast.success("Task deleted"); }}
                onToggle={toggleComplete}
              />
            ))}
          </div>
        )}
      </main>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        onSubmit={handleSubmit}
      />

      <PlanPreviewDialog 
        open={!!planAction} 
        onOpenChange={(open) => !open && setPlanAction(null)}
        action={planAction}
        onConfirm={handleConfirmPlan}
      />

      <GoogleCalendarImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImport}
      />

      <AssistantPanel onProposedAction={handleProposedAction} />

      <Dialog open={completedDialogOpen} onOpenChange={setCompletedDialogOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Done tasks</DialogTitle>
            <DialogDescription>
              {completedTasks.length === 0
                ? "No completed tasks yet."
                : `${completedTasks.length} completed task${completedTasks.length === 1 ? "" : "s"}.`}
            </DialogDescription>
          </DialogHeader>
          {completedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Complete a task to see it listed here.</p>
          ) : (
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {completedTasks.map((task) => (
                <div key={task.id} className="rounded-lg border border-border bg-card p-3">
                  <p className="font-medium leading-tight">{task.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {task.date}{task.time ? ` · ${task.time}` : ""}{task.location ? ` · ${task.location}` : ""}
                  </p>
                  {task.description && (
                    <p className="mt-2 text-sm text-muted-foreground">{task.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={activityScoresOpen} onOpenChange={setActivityScoresOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Activity Scores</DialogTitle>
            <DialogDescription>All saved activity score snapshots for your account.</DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <p className="text-sm text-muted-foreground">Loading activity scores...</p>
          ) : scoreHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved activity scores yet.</p>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {scoreHistory.map((score) => (
                <div key={score.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Score {score.health_score}/100</p>
                    <p className="text-xs text-muted-foreground">{new Date(score.created_at).toLocaleString()}</p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{score.summary}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={recommendationsOpen} onOpenChange={setRecommendationsOpen}>
        <DialogContent className="sm:max-w-[780px]">
          <DialogHeader>
            <DialogTitle>Recommendations</DialogTitle>
            <DialogDescription>Suggestions based on your current calendar and selected date.</DialogDescription>
          </DialogHeader>
          <RecommendationPanel
            recommendations={recommendations}
            loading={loadingRecommendations}
            onRefresh={handleRecommend}
            onDismiss={handleDismissRecommendations}
            onAdd={handleAddRecommendation}
          />
        </DialogContent>
      </Dialog>

      <Button
        variant="hero"
        size="icon"
        onClick={handleRecommend}
        disabled={loadingRecommendations}
        className="group fixed bottom-6 left-6 z-40 h-14 w-14 overflow-hidden rounded-full transition-all duration-200 hover:w-44 focus-visible:w-44"
        aria-label={loadingRecommendations ? "Finding recommendations" : "Recommendations"}
        title={loadingRecommendations ? "Finding recommendations" : "Recommendations"}
      >
        <HeartHandshake className="h-4 w-4" />
        <span className="ml-0 opacity-0 whitespace-nowrap transition-all duration-200 group-hover:ml-2 group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:opacity-100">
          {loadingRecommendations ? "Finding ideas..." : "Recommendations"}
        </span>
      </Button>
    </div>
  );
};

const LiveWindowCard = ({
  liveWindow,
  nextUpcomingPreview,
  compact = false,
}: {
  liveWindow: {
    mode: "ongoing" | "upcoming";
    task: Task;
    start: Date;
    end: Date;
  } | null;
  nextUpcomingPreview?: { task: Task; start: Date } | null;
  compact?: boolean;
}) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const formatUntil = (target: Date) => {
    const diffMs = Math.max(0, target.getTime() - now);
    const totalMinutes = Math.ceil(diffMs / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  return (
    <div className={`relative rounded-lg border border-border bg-card shadow-xs ${compact ? "p-3 min-h-[120px]" : "p-4 sm:min-h-[122px]"}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <MapPin className="h-4 w-4" />
        <span className="text-xs font-medium">Life window</span>
      </div>
      {liveWindow?.mode === "ongoing" && nextUpcomingPreview && (
        <div className="absolute bottom-3 right-3 max-w-[46%] rounded-md border border-border bg-background/65 backdrop-blur-[1px] px-2 py-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Next up</p>
          <p className="mt-0.5 line-clamp-1 text-[11px] font-medium">{nextUpcomingPreview.task.title}</p>
          <p className="text-[10px] text-muted-foreground">{format(nextUpcomingPreview.start, "HH:mm")}</p>
        </div>
      )}
      {!liveWindow ? (
        <p className="mt-3 text-sm text-muted-foreground">No upcoming plans</p>
      ) : (
        <>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
            {liveWindow.mode === "ongoing" ? "Ongoing" : "Upcoming"}
          </p>
          <p className="mt-1 line-clamp-2 text-lg font-semibold leading-tight">{liveWindow.task.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(liveWindow.start, "MMM d, HH:mm")} - {format(liveWindow.end, "HH:mm")}
            {liveWindow.task.location ? ` · ${liveWindow.task.location}` : ""}
          </p>
          <p className="mt-1 text-xs font-medium text-primary">
            {liveWindow.mode === "ongoing" ? `Ends in ${formatUntil(liveWindow.end)}` : `Starts in ${formatUntil(liveWindow.start)}`}
          </p>
        </>
      )}
    </div>
  );
};

const EmptyState = ({ onCreate, hasFilters }: { onCreate: () => void; hasFilters: boolean }) => (
  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center animate-fade-in">
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
      <CalIcon className="h-5 w-5" />
    </div>
    <h3 className="mt-4 text-base font-semibold">
      {hasFilters ? "No matching tasks" : "Nothing here yet"}
    </h3>
    <p className="mt-1 text-sm text-muted-foreground max-w-xs">
      {hasFilters ? "Try clearing your filters or adjusting the search." : "Create your first task to start organizing your day."}
    </p>
    {!hasFilters && (
      <Button variant="hero" size="sm" className="mt-4" onClick={onCreate}>
        Create a task
      </Button>
    )}
  </div>
);

const ActivityInsightsPanel = ({
  insights,
  loading,
  onGenerate,
  hasTasks,
}: {
  insights: ActivityInsights | null;
  loading: boolean;
  onGenerate: () => void;
  hasTasks: boolean;
}) => {
  if (loading) {
    return (
      <section className="rounded-lg border border-border bg-card p-3">
        <p className="text-sm text-muted-foreground">Analyzing calendar activities...</p>
      </section>
    );
  }

  const statusStyles: Record<InsightStatus, string> = {
    healthy: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    watch: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    needs_changes: "bg-rose-500/15 text-rose-700 border-rose-500/30",
  };

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-center"
        onClick={onGenerate}
        disabled={!hasTasks}
      >
        <Activity className="h-4 w-4" />
        Generate Activity Graphs
      </Button>
      {!hasTasks && (
        <p className="mt-2 text-xs text-muted-foreground">Add at least one task to generate insights.</p>
      )}
      {!insights ? null : (
        <>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">AI Activity Insights</p>
          <p className="mt-1 text-sm text-muted-foreground">{insights.summary}</p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${statusStyles[insights.status]}`}>
          <Activity className="h-3.5 w-3.5" />
          Score {insights.health_score}/100
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          {insights.graphs.activity_mix.slice(0, 4).map((point) => (
            <div key={point.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span>{point.label}</span>
                <span className="text-muted-foreground">{point.percent}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted">
                <div
                  className="h-2.5 rounded-full"
                  style={{ width: `${Math.max(4, Math.min(100, point.percent))}%`, backgroundColor: point.color || "var(--primary)" }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2 text-xs">
          <p className="rounded-md bg-muted/70 px-2 py-1">Avg load/day: {insights.graphs.load.avg_minutes_per_day} min</p>
          <p className="rounded-md bg-muted/70 px-2 py-1">Busy days: {insights.graphs.load.busy_days}</p>
          <p className="rounded-md bg-muted/70 px-2 py-1">Scheduled days: {insights.graphs.load.scheduled_days}</p>
          {insights.guidance.slice(0, 2).map((item, idx) => (
            <p key={`${item}-${idx}`} className="rounded-md border border-border px-2 py-1.5 text-muted-foreground">
              {item}
            </p>
          ))}
        </div>
      </div>
        </>
      )}
    </section>
  );
};

const categoryCopy: Record<RecommendationCategory, { label: string; icon: React.ReactNode; accent: string }> = {
  schedule: {
    label: "Schedule",
    icon: <Sparkles className="h-4 w-4" />,
    accent: "bg-primary/10 text-primary border-primary/20",
  },
  family: {
    label: "Family",
    icon: <HeartHandshake className="h-4 w-4" />,
    accent: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  },
  sports: {
    label: "Sports",
    icon: <Dumbbell className="h-4 w-4" />,
    accent: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  },
  health: {
    label: "Health",
    icon: <CheckCircle2 className="h-4 w-4" />,
    accent: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  },
  recovery: {
    label: "Recovery",
    icon: <CalIcon className="h-4 w-4" />,
    accent: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  },
  personal: {
    label: "Personal",
    icon: <MapPin className="h-4 w-4" />,
    accent: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  },
  hobbies: {
    label: "Hobbies",
    icon: <Sparkles className="h-4 w-4" />,
    accent: "bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-500/20",
  },
  meditation: {
    label: "Meditation",
    icon: <Brain className="h-4 w-4" />,
    accent: "bg-teal-500/10 text-teal-700 border-teal-500/20",
  },
  reading: {
    label: "Reading",
    icon: <BookOpen className="h-4 w-4" />,
    accent: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  },
  studying: {
    label: "Studying",
    icon: <GraduationCap className="h-4 w-4" />,
    accent: "bg-cyan-500/10 text-cyan-700 border-cyan-500/20",
  },
  fun: {
    label: "Fun",
    icon: <Smile className="h-4 w-4" />,
    accent: "bg-orange-500/10 text-orange-700 border-orange-500/20",
  },
};

const RecommendationPanel = ({
  recommendations,
  loading,
  onRefresh,
  onDismiss,
  onAdd,
}: {
  recommendations: Recommendation[];
  loading: boolean;
  onRefresh: () => void;
  onDismiss: () => void;
  onAdd: (recommendation: Recommendation) => void;
}) => {
  return (
    <section className="mb-6 rounded-2xl border border-border bg-card/95 p-5 shadow-xs animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Recommendations</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Suggested next moves</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Generated from your current calendar, with extra attention to missing time for family, hobbies, learning, and balance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Close recommendations" title="Close recommendations">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {loading && recommendations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Generating recommendations from your calendar...
          </div>
        ) : recommendations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            No recommendations yet. Press refresh to generate ideas.
          </div>
        ) : (
          recommendations.map((recommendation, index) => {
            const meta = categoryCopy[recommendation.category];
            return (
              <div key={`${recommendation.title}-${index}`} className="rounded-xl border border-border bg-background/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.accent}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                    </div>
                    <h3 className="mt-3 text-base font-semibold">{recommendation.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{recommendation.reason}</p>
                    {recommendation.suggested_task && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Suggested task: {recommendation.suggested_task.title}
                        {recommendation.suggested_task.date ? ` on ${recommendation.suggested_task.date}` : ""}
                        {recommendation.suggested_task.time ? ` at ${recommendation.suggested_task.time}` : ""}
                      </p>
                    )}
                  </div>
                  {recommendation.suggested_task && (
                    <Button variant="hero" size="sm" onClick={() => onAdd(recommendation)}>
                      Add to tasks
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default Index;
