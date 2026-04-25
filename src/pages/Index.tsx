import { useMemo, useState } from "react";
import { Sparkles, Search, ArrowDownUp, CheckCircle2, Calendar as CalIcon, MapPin, Flag, UploadCloud, HeartHandshake, Dumbbell, RefreshCcw, BookOpen, Brain, GraduationCap, Smile } from "lucide-react";
import { Header } from "@/components/Header";
import { TaskCard } from "@/components/TaskCard";
import { TaskDialog } from "@/components/TaskDialog";
import { GoogleCalendarImportDialog } from "@/components/GoogleCalendarImportDialog";
import { MiniCalendar } from "@/components/MiniCalendar";
import { AssistantPanel } from "@/components/AssistantPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTasks, sortTasks, optimizeSchedule } from "@/lib/taskStore";
import type { SortMode, Task } from "@/types/task";
import { isSameDay, parseISO, isToday } from "date-fns";
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

const Index = () => {
  const { tasks, addTask, updateTask, deleteTask, replaceAll, toggleComplete } = useTasks();
  const [sort, setSort] = useState<SortMode>("priority");
  const [query, setQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

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
    return {
      total: tasks.length,
      today: todayTasks.length,
      high: tasks.filter((t) => t.priority === "high" && !t.completed).length,
      done: tasks.filter((t) => t.completed).length,
    };
  }, [tasks]);

  const handleSubmit = (data: Omit<Task, "id" | "createdAt"> & { id?: string }) => {
    if (data.id) {
      updateTask(data.id, data);
      toast.success("Task updated");
    } else {
      addTask(data);
      toast.success("Task created");
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

  const handleImport = (items: Omit<Task, "id" | "createdAt">[]) => {
    items.forEach((item) => addTask(item));
    toast.success(`${items.length} event${items.length === 1 ? "" : "s"} imported from Google Calendar.`);
  };

  const handleOptimize = () => {
    replaceAll(optimizeSchedule(tasks));
    toast.success("Schedule optimized", {
      description: "Tasks grouped by location and ordered by priority.",
    });
  };

  const handleRecommend = async () => {
    if (!API_BASE) {
      toast.error("Live recommendations need the backend to be connected.");
      return;
    }

    try {
      setLoadingRecommendations(true);
      const response = await fetch(`${API_BASE}/api/chat/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: "Generate proactive schedule recommendations.",
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

  const handleAddRecommendation = async (recommendation: Recommendation) => {
    if (!recommendation.suggested_task) return;
    await addTask(recommendation.suggested_task);
    toast.success(`Added "${recommendation.suggested_task.title}"`);
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <Header onOptimize={handleOptimize} onNewTask={handleNew} onRecommend={handleRecommend} />

      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 bg-gradient-glow pointer-events-none" />
        <div className="container relative pt-12 pb-8">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div>
              <div className="max-w-2xl animate-slide-up">
                <p className="mb-2 text-sm font-medium text-primary">Good to see you</p>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                  Your day, organized.
                </h1>
                <p className="mt-2 text-muted-foreground">
                  {stats.today > 0
                    ? `${stats.today} task${stats.today === 1 ? "" : "s"} on for today${stats.high > 0 ? ` · ${stats.high} high priority` : ""}.`
                    : "No tasks scheduled today. A perfect time to plan ahead."}
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="hero" size="lg" onClick={handleOptimize}>
                    <Sparkles className="h-4 w-4" />
                    Optimize schedule
                  </Button>
                  <Button variant="secondary" size="lg" onClick={handleRecommend} disabled={loadingRecommendations}>
                    <HeartHandshake className="h-4 w-4" />
                    {loadingRecommendations ? "Finding ideas..." : "Get recommendations"}
                  </Button>
                  <Button variant="secondary" size="lg" onClick={() => setImportOpen(true)}>
                    <UploadCloud className="h-4 w-4" />
                    Import calendar
                  </Button>
                  <Button variant="outline" size="lg" onClick={handleNew}>
                    Add task
                  </Button>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard icon={<CalIcon className="h-4 w-4" />} label="Today" value={stats.today} />
                <StatCard icon={<Flag className="h-4 w-4" />} label="High priority" value={stats.high} />
                <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Completed" value={stats.done} />
                <StatCard icon={<MapPin className="h-4 w-4" />} label="All tasks" value={stats.total} />
              </div>
            </div>

            <div className="lg:justify-self-end">
              <MiniCalendar tasks={tasks} selected={selectedDate} onSelect={setSelectedDate} />
            </div>
          </div>
        </div>
      </section>

      <main className="container pb-24">
        <RecommendationPanel
          recommendations={recommendations}
          loading={loadingRecommendations}
          onRefresh={handleRecommend}
          onAdd={handleAddRecommendation}
        />

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

      <GoogleCalendarImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImport}
      />

      <AssistantPanel />
    </div>
  );
};

const StatCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) => (
  <div className="rounded-lg border border-border bg-card p-4 shadow-xs transition-all duration-300 hover:shadow-sm-soft hover:-translate-y-0.5">
    <div className="flex items-center gap-2 text-muted-foreground">
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </div>
    <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
  </div>
);

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
  onAdd,
}: {
  recommendations: Recommendation[];
  loading: boolean;
  onRefresh: () => void;
  onAdd: (recommendation: Recommendation) => void;
}) => {
  if (!loading && recommendations.length === 0) return null;

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
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCcw className="h-4 w-4" />
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="mt-4 grid gap-3">
        {loading && recommendations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Generating recommendations from your calendar...
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
