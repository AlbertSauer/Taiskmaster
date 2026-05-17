import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  DollarSign,
  Flame,
  History,
  ListTodo,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { differenceInCalendarDays, format, isAfter, isBefore, parseISO, startOfDay, subDays } from "date-fns";
import { Header } from "@/components/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useTasks, fetchTaskHistory } from "@/lib/taskStore";
import type { Task } from "@/types/task";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

interface ActivityScoreHistoryItem {
  id: string;
  health_score: number;
  status: "healthy" | "watch" | "needs_changes";
  summary: string;
  created_at: string;
}

interface TaskHistoryItem {
  id: string;
  action: "created" | "updated" | "deleted";
  title: string;
  created_at: string;
}

interface AIUsageFeature {
  feature: string;
  calls: number;
  tokens: number;
  cost_usd: number;
}

interface AIUsageDay {
  date: string;
  calls: number;
  tokens: number;
  cost_usd: number;
}

interface AIUsageSummary {
  totals: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  };
  by_feature: AIUsageFeature[];
  by_day: AIUsageDay[];
}

const PLANNING_DAY_MINUTES = 14 * 60;
type StatisticsRange = "1d" | "1w" | "1m" | "1y";
const RANGE_OPTIONS: Record<StatisticsRange, { label: string; days: number; chartPoints: number }> = {
  "1d": { label: "1 day", days: 1, chartPoints: 1 },
  "1w": { label: "1 week", days: 7, chartPoints: 7 },
  "1m": { label: "1 month", days: 30, chartPoints: 30 },
  "1y": { label: "1 year", days: 365, chartPoints: 52 },
};
const CATEGORY_COLORS: Record<string, string> = {
  Work: "hsl(0 0% 0%)",
  Sleep: "hsl(231 62% 54%)",
  Health: "hsl(174 62% 40%)",
  Learning: "hsl(var(--primary))",
  Travel: "hsl(var(--warning))",
  Personal: "hsl(var(--priority-high))",
  Errands: "hsl(var(--priority-low))",
  General: "hsl(var(--muted-foreground))",
  "Free time": "hsl(var(--success))",
};

const formatPercent = (value: number) => `${Math.round(value)}%`;
const formatMoney = (value: number) => `$${value.toFixed(value > 1 ? 2 : 4)}`;
const formatNumber = (value: number) => new Intl.NumberFormat().format(Math.round(value));

const minutesForTask = (task: Task) => Math.max(15, task.duration ?? 60);
const parseTaskDate = (task: Task) => {
  const parsed = parseISO(task.date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTaskCategory = (task: Task) => {
  const tags = (task.tags ?? []).map((tag) => tag.toLowerCase());
  const text = `${task.title} ${task.description ?? ""} ${task.note ?? ""} ${task.location ?? ""}`.toLowerCase();
  if (tags.includes("work") || /\b(work|meeting|project|client|office)\b/.test(text)) return "Work";
  if (tags.includes("sleep") || /\b(sleep|nap|rest)\b/.test(text)) return "Sleep";
  if (tags.includes("health") || /\b(gym|run|doctor|workout|health|therapy)\b/.test(text)) return "Health";
  if (tags.includes("learning") || /\b(study|course|read|learn|exam)\b/.test(text)) return "Learning";
  if (tags.includes("travel") || /\b(flight|train|travel|trip|commute)\b/.test(text)) return "Travel";
  if (tags.includes("personal") || /\b(family|friends|partner|social)\b/.test(text)) return "Personal";
  if (tags.includes("errand") || /\b(clean|shopping|errand|pickup|home)\b/.test(text)) return "Errands";
  return "General";
};

const StatTile = ({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  helper: string;
}) => (
  <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="h-4 w-4" />
      </div>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">{helper}</p>
  </div>
);

const ChartPanel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-border bg-card p-4 shadow-xs">
    <h2 className="text-sm font-semibold">{title}</h2>
    <div className="mt-4 h-64">{children}</div>
  </section>
);

const SmartStatistics = () => {
  const { tasks } = useTasks();
  const { token } = useAuth();
  const [activityScores, setActivityScores] = useState<ActivityScoreHistoryItem[]>([]);
  const [taskHistory, setTaskHistory] = useState<TaskHistoryItem[]>([]);
  const [aiUsage, setAiUsage] = useState<AIUsageSummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedRange, setSelectedRange] = useState<StatisticsRange>("1m");
  const rangeConfig = RANGE_OPTIONS[selectedRange];

  const fetchRemoteStats = useCallback(async () => {
    if (!API_BASE || !token) return;
    setIsRefreshing(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [scoresResponse, historyResponse, usageResponse] = await Promise.all([
        fetch(`${API_BASE}/api/chat/activity-scores`, { headers }),
        fetch(`${API_BASE}/api/tasks/history`, { headers }),
        fetch(`${API_BASE}/api/chat/ai-usage?days=${rangeConfig.days}`, { headers }),
      ]);

      if (scoresResponse.ok) {
        const data = await scoresResponse.json() as { scores?: ActivityScoreHistoryItem[] };
        setActivityScores(Array.isArray(data.scores) ? data.scores : []);
      }
      if (historyResponse.ok) {
        const data = await historyResponse.json() as { history?: TaskHistoryItem[] };
        setTaskHistory(Array.isArray(data.history) ? data.history : []);
      }
      if (usageResponse.ok) {
        setAiUsage(await usageResponse.json() as AIUsageSummary);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [rangeConfig.days, token]);

  const loadTaskHistory = useCallback(async () => {
    try {
      const history = await fetchTaskHistory();
      setTaskHistory(Array.isArray(history) ? history : []);
    } catch {
      setTaskHistory([]);
    }
  }, []);

  useEffect(() => {
    void fetchRemoteStats();
  }, [fetchRemoteStats]);

  const rangeStart = useMemo(() => startOfDay(subDays(new Date(), rangeConfig.days - 1)), [rangeConfig.days]);
  const rangeEnd = useMemo(() => startOfDay(new Date()), []);
  const rangeTasks = useMemo(() => tasks.filter((task) => {
    const date = parseTaskDate(task);
    return date && !isBefore(startOfDay(date), rangeStart) && !isAfter(startOfDay(date), rangeEnd);
  }), [rangeEnd, rangeStart, tasks]);

  const stats = useMemo(() => {
    const today = startOfDay(new Date());
    const nextWeek = subDays(today, -7);
    const completed = rangeTasks.filter((task) => task.completed);
    const overdue = rangeTasks.filter((task) => {
      const date = parseTaskDate(task);
      return date && isBefore(date, today) && !task.completed;
    });
    const upcoming = rangeTasks.filter((task) => {
      const date = parseTaskDate(task);
      return date && !isBefore(date, today) && !isAfter(date, nextWeek);
    });
    const recentCreated = rangeTasks.filter((task) => {
      const created = parseISO(task.createdAt);
      return !Number.isNaN(created.getTime()) && !isBefore(created, rangeStart);
    });
    const totalMinutes = rangeTasks.reduce((total, task) => total + minutesForTask(task), 0);
    const scheduledDates = new Set(rangeTasks.map((task) => task.date));
    const completionRate = rangeTasks.length ? (completed.length / rangeTasks.length) * 100 : 0;

    return {
      completionRate,
      overdue: overdue.length,
      upcoming: upcoming.length,
      recentCreated: recentCreated.length,
      totalHours: totalMinutes / 60,
      scheduledDays: scheduledDates.size,
      avgTasksPerDay: scheduledDates.size ? rangeTasks.length / scheduledDates.size : 0,
    };
  }, [rangeStart, rangeTasks]);

  const dailyLoad = useMemo(() => {
    const today = startOfDay(new Date());
    const bucketDays = Math.max(1, Math.ceil(rangeConfig.days / rangeConfig.chartPoints));
    const bucketCount = Math.ceil(rangeConfig.days / bucketDays);
    return Array.from({ length: bucketCount }, (_, index) => {
      const remainingBuckets = bucketCount - 1 - index;
      const bucketEnd = subDays(today, remainingBuckets * bucketDays);
      const bucketStart = subDays(bucketEnd, bucketDays - 1);
      const dayTasks = rangeTasks.filter((task) => {
        const date = parseTaskDate(task);
        return date && !isBefore(startOfDay(date), bucketStart) && !isAfter(startOfDay(date), bucketEnd);
      });
      return {
        date: bucketDays === 1 ? format(bucketEnd, "MMM d") : `${format(bucketStart, "MMM d")} - ${format(bucketEnd, "MMM d")}`,
        tasks: dayTasks.length,
        hours: Number((dayTasks.reduce((total, task) => total + minutesForTask(task), 0) / 60).toFixed(1)),
      };
    });
  }, [rangeConfig.chartPoints, rangeConfig.days, rangeTasks]);

  const categoryMix = useMemo(() => {
    const byCategory = new Map<string, number>();
    rangeTasks.forEach((task) => {
      const category = getTaskCategory(task);
      byCategory.set(category, (byCategory.get(category) ?? 0) + minutesForTask(task));
    });
    const scheduledMinutes = rangeTasks.reduce((total, task) => total + minutesForTask(task), 0);
    const freeMinutes = Math.max(0, (rangeConfig.days * PLANNING_DAY_MINUTES) - scheduledMinutes);
    if (freeMinutes > 0) {
      byCategory.set("Free time", freeMinutes);
    }

    return [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, minutes], index) => ({
        name,
        hours: Number((minutes / 60).toFixed(1)),
        color: CATEGORY_COLORS[name] ?? `hsl(${(index * 47) % 360} 62% 48%)`,
      }));
  }, [rangeConfig.days, rangeTasks]);

  const aiCostTrend = useMemo(() => {
    const today = startOfDay(new Date());
    const costByDate = new Map((aiUsage?.by_day ?? []).map((day) => [day.date, day.cost_usd]));
    const bucketDays = Math.max(1, Math.ceil(rangeConfig.days / rangeConfig.chartPoints));
    const bucketCount = Math.ceil(rangeConfig.days / bucketDays);
    return Array.from({ length: bucketCount }, (_, index) => {
      const remainingBuckets = bucketCount - 1 - index;
      const bucketEnd = subDays(today, remainingBuckets * bucketDays);
      const bucketStart = subDays(bucketEnd, bucketDays - 1);
      let cost = 0;
      for (let offset = 0; offset < bucketDays; offset += 1) {
        const date = subDays(bucketEnd, offset);
        if (isBefore(date, bucketStart)) continue;
        cost += costByDate.get(format(date, "yyyy-MM-dd")) ?? 0;
      }
      return {
        date: bucketDays === 1 ? format(bucketEnd, "MMM d") : `${format(bucketStart, "MMM d")} - ${format(bucketEnd, "MMM d")}`,
        cost: Number(cost.toFixed(5)),
      };
    });
  }, [aiUsage, rangeConfig.chartPoints, rangeConfig.days]);

  const activityTrend = useMemo(() => {
    const scoresInRange = activityScores.filter((score) => {
      const created = parseISO(score.created_at);
      return !Number.isNaN(created.getTime()) && !isBefore(created, rangeStart);
    });
    if (scoresInRange.length === 0) {
      return [{ date: "No scores", score: 0 }];
    }
    return [...scoresInRange]
      .reverse()
      .slice(-rangeConfig.chartPoints)
      .map((score) => ({
        date: format(parseISO(score.created_at), "MMM d"),
        score: score.health_score,
      }));
  }, [activityScores, rangeConfig.chartPoints, rangeStart]);

  const taskHistorySummary = useMemo(() => {
    const recent = taskHistory.filter((item) => !isBefore(parseISO(item.created_at), rangeStart));
    return {
      created: recent.filter((item) => item.action === "created").length,
      updated: recent.filter((item) => item.action === "updated").length,
      deleted: recent.filter((item) => item.action === "deleted").length,
    };
  }, [rangeStart, taskHistory]);

  const recentAddedTasks = useMemo(() => {
    const grouped = new Map<string, { title: string; count: number; latest: Date }>();

    taskHistory
      .filter((item) => item.action === "created")
      .forEach((item) => {
        const createdAt = parseISO(item.created_at);
        if (Number.isNaN(createdAt.getTime()) || isBefore(createdAt, rangeStart)) return;

        const title = item.title.trim() || "Untitled task";
        const key = title.toLowerCase().replace(/\s+/g, " ");
        const existing = grouped.get(key);
        if (!existing) {
          grouped.set(key, { title, count: 1, latest: createdAt });
          return;
        }

        existing.count += 1;
        if (createdAt > existing.latest) {
          existing.latest = createdAt;
          existing.title = title;
        }
      });

    return [...grouped.values()]
      .sort((a, b) => b.latest.getTime() - a.latest.getTime())
      .slice(0, 6);
  }, [rangeStart, taskHistory]);

  const busiestDay = useMemo(() => {
    const busiest = dailyLoad.reduce((best, day) => (day.hours > best.hours ? day : best), dailyLoad[0]);
    return busiest?.hours ? `${busiest.date}, ${busiest.hours}h` : "No load yet";
  }, [dailyLoad]);

  const scoresForRange = activityScores.filter((score) => {
    const created = parseISO(score.created_at);
    return !Number.isNaN(created.getTime()) && !isBefore(created, rangeStart);
  });
  const avgScore = scoresForRange.length
    ? Math.round(scoresForRange.reduce((total, score) => total + score.health_score, 0) / scoresForRange.length)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <Header showActions={false} />

      <main className="container py-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Smart Statistics
              </Badge>
              <Badge variant="outline">Last {rangeConfig.label}</Badge>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Your calendar, task, and AI activity overview</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              A compact read on workload, completion, scheduling habits, and estimated OpenAI API spend.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedRange} onValueChange={(value) => setSelectedRange(value as StatisticsRange)}>
              <SelectTrigger className="h-10 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">1 day</SelectItem>
                <SelectItem value="1w">1 week</SelectItem>
                <SelectItem value="1m">1 month</SelectItem>
                <SelectItem value="1y">1 year</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void fetchRemoteStats()} disabled={!token || isRefreshing}>
              <TrendingUp className="h-4 w-4" />
              {isRefreshing ? "Refreshing" : "Refresh"}
            </Button>
          </div>
        </div>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={CheckCircle2} label="Completion rate" value={formatPercent(stats.completionRate)} helper={`${rangeTasks.filter((task) => task.completed).length} of ${rangeTasks.length} tasks done`} />
          <StatTile icon={CalendarDays} label="Upcoming week" value={String(stats.upcoming)} helper={`${stats.overdue} overdue tasks need attention`} />
          <StatTile icon={Clock3} label="Scheduled workload" value={`${stats.totalHours.toFixed(1)}h`} helper={`${stats.avgTasksPerDay.toFixed(1)} tasks per active day`} />
          <StatTile icon={DollarSign} label="AI API cost" value={formatMoney(aiUsage?.totals.estimated_cost_usd ?? 0)} helper={`${formatNumber(aiUsage?.totals.total_tokens ?? 0)} tokens across ${aiUsage?.totals.calls ?? 0} calls`} />
        </section>

        <section className="mt-6 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <ChartPanel title="Calendar Load">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyLoad}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip />
                <Area type="monotone" dataKey="hours" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.18)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Task Categories">
            {categoryMix.length ? (
              <div className="grid h-full gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryMix} dataKey="hours" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2}>
                      {categoryMix.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex min-h-0 flex-col justify-center gap-2 overflow-y-auto pr-1">
                  {categoryMix.map((entry) => (
                    <div key={entry.name} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="truncate">{entry.name}</span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">{entry.hours}h</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No task categories yet.</div>
            )}
          </ChartPanel>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-3">
          <ChartPanel title="AI API Cost">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aiCostTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(value) => formatMoney(Number(value))} />
                <Tooltip formatter={(value) => [formatMoney(Number(value)), "Cost"]} />
                <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Activity Score">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip />
                <Area type="monotone" dataKey="score" stroke="hsl(var(--success))" fill="hsl(var(--success) / 0.16)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartPanel>

          <section className="rounded-lg border border-border bg-card p-4 shadow-xs">
            <h2 className="text-sm font-semibold">Activity Snapshot</h2>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><Activity className="h-4 w-4" /> Average score</span>
                <span className="font-semibold">{avgScore ? `${avgScore}/100` : "No score"}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><Flame className="h-4 w-4" /> Busiest day</span>
                <span className="font-semibold">{busiestDay}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><ListTodo className="h-4 w-4" /> New tasks</span>
                <span className="font-semibold">{stats.recentCreated}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><History className="h-4 w-4" /> Task edits</span>
                <span className="font-semibold">{taskHistorySummary.created}/{taskHistorySummary.updated}/{taskHistorySummary.deleted}</span>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Task edits are shown as created, updated, and deleted events from the selected range.</p>
          </section>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
          <section className="rounded-lg border border-border bg-card p-4 shadow-xs">
            <h2 className="text-sm font-semibold">AI Cost By Feature</h2>
            <div className="mt-4 space-y-3">
              {(aiUsage?.by_feature ?? []).length ? aiUsage!.by_feature.map((feature) => (
                <div key={feature.feature}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium capitalize">{feature.feature.replaceAll("-", " ")}</span>
                    <span className="text-muted-foreground">{formatMoney(feature.cost_usd)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, (feature.cost_usd / Math.max(aiUsage?.totals.estimated_cost_usd ?? 0.0001, 0.0001)) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{feature.calls} calls, {formatNumber(feature.tokens)} tokens</p>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">No tracked AI usage yet. Usage appears here after authenticated AI calls.</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-xs">
            <h2 className="text-sm font-semibold">Recent Calendar Movement</h2>
            <div className="mt-4 space-y-2">
              {recentAddedTasks.map((item) => {
                const age = differenceInCalendarDays(new Date(), item.latest);
                return (
                  <div key={item.title.toLowerCase()} className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Added {item.count} {item.count === 1 ? "time" : "times"} to the calendar
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{age === 0 ? "Today" : `${age}d ago`}</span>
                  </div>
                );
              })}
              {recentAddedTasks.length === 0 && (
                <p className="text-sm text-muted-foreground">No added tasks are available yet.</p>
              )}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
};

export default SmartStatistics;
