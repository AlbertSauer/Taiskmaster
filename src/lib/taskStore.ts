import { useEffect, useState, useCallback } from "react";
import { formatLocalDate } from "@/lib/dateTime";
import { isProtectedWorkTask, rangesOverlap, timeToMinutes, minutesToTime, taskOverlapsProtectedWork } from "@/lib/scheduleGuards";
import type { Task, SortMode } from "@/types/task";

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const hasBackend = Boolean(API_BASE);
const isAuthenticated = () => hasBackend && !!localStorage.getItem("authToken");
const STORAGE_KEY = "taiskmaster.tasks.v1";
const HISTORY_STORAGE_KEY = "taiskmaster.task_history.v1";

type TaskHistoryAction = "created" | "updated" | "deleted";

type TaskHistoryRecord = {
  id: string;
  task_id: string;
  action: TaskHistoryAction;
  title: string;
  snapshot: Task;
  created_at: string;
};

const getAuthHeaders = () => {
  const token = localStorage.getItem("authToken");
  return token
    ? {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }
    : {
        "Content-Type": "application/json",
      };
};

type PersistableTask = Task & {
  created_at?: string;
};

export const inferTaskTags = (task: Pick<Task, "title" | "description" | "location" | "tags">): string[] => {
  const existing = Array.isArray(task.tags)
    ? task.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
    : [];
  const text = `${task.title || ""} ${task.description || ""} ${task.location || ""}`.toLowerCase();
  const inferred: string[] = [];
  const add = (tag: string) => {
    if (!existing.includes(tag) && !inferred.includes(tag)) inferred.push(tag);
  };

  if (/\b(work|office|meeting|client|project)\b/.test(text)) add("work");
  if (/\b(gym|workout|run|sports|exercise|fitness)\b/.test(text)) add("health");
  if (/\b(study|learn|learning|course|read|reading)\b/.test(text)) add("learning");
  if (/\b(family|partner|kids|friends|social)\b/.test(text)) add("personal");
  if (/\b(travel|flight|train|trip|commute)\b/.test(text)) add("travel");
  if (/\b(doctor|health|dentist|therapy|checkup)\b/.test(text)) add("health");
  if (/\b(plan|planning|review)\b/.test(text)) add("planning");
  if (/\b(break|selfcare|recovery|mindful|meditation)\b/.test(text)) add("selfcare");
  if (/\b(home|house|clean|shopping|errand)\b/.test(text)) add("errand");
  if (task.location && !existing.includes("location")) add("location");
  if (inferred.length === 0 && existing.length === 0) add("general");

  return [...existing, ...inferred].slice(0, 6);
};

const normalizeTask = (task: PersistableTask): Task => ({
  id: task.id,
  title: task.title,
  description: task.description ?? undefined,
  note: task.note ?? undefined,
  date: task.date,
  time: task.time ?? undefined,
  duration: task.duration ?? undefined,
  location: task.location ?? undefined,
  priority: task.priority,
  tags: task.tags ?? [],
  completed: task.completed ?? false,
  createdAt: task.createdAt ?? task.created_at ?? new Date().toISOString(),
});

const seedTasks = (): Task[] => {
  const today = new Date();
  const iso = (d: Date) => formatLocalDate(d);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const inThree = new Date(today);
  inThree.setDate(today.getDate() + 3);

  return [
    {
      id: crypto.randomUUID(),
      title: "Design review with Maya",
      description: "Walk through the new dashboard concepts and gather feedback.",
      date: iso(today),
      time: "10:30",
      location: "HQ — Studio 2",
      priority: "high",
      tags: ["design", "team"],
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: "Pick up dry cleaning",
      date: iso(today),
      time: "17:00",
      location: "Downtown",
      priority: "low",
      tags: ["errand"],
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: "Ship onboarding flow v2",
      description: "Final polish on copy and animations before release.",
      date: iso(tomorrow),
      time: "09:00",
      location: "Remote",
      priority: "high",
      tags: ["product"],
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: "Coffee with Jordan",
      date: iso(tomorrow),
      time: "15:30",
      location: "Blue Bottle, Mission",
      priority: "medium",
      tags: ["personal"],
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: "Q3 planning doc",
      description: "Draft outline for the leadership review.",
      date: iso(inThree),
      time: "11:00",
      location: "Remote",
      priority: "medium",
      tags: ["planning"],
      createdAt: new Date().toISOString(),
    },
  ];
};

const loadLocal = (): Task[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = seedTasks();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw) as Task[];
  } catch {
    return [];
  }
};

const saveLocal = (tasks: Task[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
};

const loadLocalHistory = (): TaskHistoryRecord[] => {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TaskHistoryRecord[]) : [];
  } catch {
    return [];
  }
};

const saveLocalHistory = (history: TaskHistoryRecord[]) => {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
};

const logLocalTaskHistory = (task: Task, action: TaskHistoryAction) => {
  const entry: TaskHistoryRecord = {
    id: crypto.randomUUID(),
    task_id: task.id,
    action,
    title: task.title,
    snapshot: task,
    created_at: new Date().toISOString(),
  };
  saveLocalHistory([entry, ...loadLocalHistory()]);
  return entry;
};

export const fetchTaskHistory = async (): Promise<TaskHistoryRecord[]> => {
  if (!isAuthenticated()) {
    return loadLocalHistory();
  }

  const res = await fetch(`${API_BASE}/api/tasks/history`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Could not load task history");
  const data = await res.json();
  return Array.isArray(data.history) ? data.history : [];
};

const fetchTasks = async (): Promise<Task[]> => {
  if (!isAuthenticated()) {
    return loadLocal();
  }

  const res = await fetch(`${API_BASE}/api/tasks`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Could not load tasks");
  const data = await res.json();
  return Array.isArray(data) ? data.map(normalizeTask) : [];
};

const createTask = async (task: Omit<Task, "id" | "createdAt">): Promise<Task> => {
  const taskWithTags = {
    ...task,
    tags: inferTaskTags(task),
  };
  if (!isAuthenticated()) {
    const next: Task = { ...taskWithTags, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    const all = [...loadLocal(), next];
    saveLocal(all);
    logLocalTaskHistory(next, "created");
    return next;
  }

  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(taskWithTags),
  });
  if (!res.ok) throw new Error("Could not create task");
  const created = await res.json();
  return normalizeTask(created);
};

const patchTask = async (id: string, patch: Partial<Task>): Promise<Task> => {
  if (!isAuthenticated()) {
    const existing = loadLocal();
    const updated = existing.map((t) => (t.id === id ? { ...t, ...patch } : t));
    saveLocal(updated);
    const patched = updated.find((t) => t.id === id);
    if (!patched) throw new Error("Task not found");
    logLocalTaskHistory(patched, "updated");
    return patched;
  }

  const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not update task");
  const updated = await res.json();
  return normalizeTask(updated);
};

const deleteRemoteTask = async (id: string): Promise<void> => {
  if (!isAuthenticated()) {
    const existing = loadLocal();
    const taskToDelete = existing.find((task) => task.id === id);
    if (taskToDelete) logLocalTaskHistory(taskToDelete, "deleted");
    saveLocal(existing.filter((task) => task.id !== id));
    return;
  }

  const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Could not delete task");
};

const deleteAllRemoteTasks = async (tasks: Task[]): Promise<void> => {
  if (!isAuthenticated()) {
    tasks.forEach((task) => logLocalTaskHistory(task, "deleted"));
    saveLocal([]);
    return;
  }

  await Promise.all(tasks.map((task) => deleteRemoteTask(task.id)));
};

// Shared task snapshot so the dashboard, calendar, and assistant stay in sync.
let taskSnapshot: Task[] | null = null;
const listeners = new Set<(tasks: Task[]) => void>();

const publishTasks = (next: Task[]) => {
  taskSnapshot = next;
  listeners.forEach((listener) => listener(next));
};

const refreshTasks = async () => {
  const next = await fetchTasks();
  publishTasks(next);
  return next;
};

export const useTasks = () => {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    let mounted = true;

    const sync = (next: Task[]) => {
      if (mounted) setTasks(next);
    };

    listeners.add(sync);

    if (taskSnapshot) {
      setTasks(taskSnapshot);
    }

    refreshTasks()
      .catch(() => {
        if (mounted) setTasks([]);
      });

    const handleExternalRefresh = () => {
      void refreshTasks();
    };

    window.addEventListener("focus", handleExternalRefresh);
    window.addEventListener("storage", handleExternalRefresh);
    window.addEventListener("taiskmaster:tasks-changed", handleExternalRefresh);
    return () => {
      mounted = false;
      listeners.delete(sync);
      window.removeEventListener("focus", handleExternalRefresh);
      window.removeEventListener("storage", handleExternalRefresh);
      window.removeEventListener("taiskmaster:tasks-changed", handleExternalRefresh);
    };
  }, []);

  const persist = useCallback((next: Task[]) => {
    publishTasks(next);
    window.dispatchEvent(new Event("taiskmaster:tasks-changed"));
  }, []);

  const addTask = useCallback(async (t: Omit<Task, "id" | "createdAt">) => {
    const nextTask = await createTask(t);
    await refreshTasks();
    return nextTask;
  }, []);

  const updateTask = useCallback(async (id: string, patch: Partial<Task>) => {
    await patchTask(id, patch);
    await refreshTasks();
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    await deleteRemoteTask(id);
    await refreshTasks();
  }, []);

  const deleteCalendar = useCallback(async () => {
    await deleteAllRemoteTasks(tasks);
    await refreshTasks();
  }, [tasks]);

  const replaceAll = useCallback(async (next: Task[]) => {
    if (!isAuthenticated()) {
      const existing = loadLocal();
      const existingById = new Map(existing.map((task) => [task.id, task]));
      const nextById = new Set(next.map((task) => task.id));

      next.forEach((task) => {
        const current = existingById.get(task.id);
        if (!current) {
          logLocalTaskHistory(task, "created");
        } else if (JSON.stringify(current) !== JSON.stringify(task)) {
          logLocalTaskHistory(task, "updated");
        }
      });

      existing.forEach((task) => {
        if (!nextById.has(task.id)) {
          logLocalTaskHistory(task, "deleted");
        }
      });

      saveLocal(next);
      persist(next);
      return;
    }

    const existingIds = new Set(tasks.map((t) => t.id));
    await Promise.all(next.map(async (task) => {
      if (!existingIds.has(task.id)) {
        await createTask(task);
      } else {
        await patchTask(task.id, task);
      }
    }));

    const nextIds = new Set(next.map((task) => task.id));
    await Promise.all(tasks.filter((task) => !nextIds.has(task.id)).map((task) => deleteRemoteTask(task.id)));

    await refreshTasks();
  }, [persist, tasks]);

  const toggleComplete = useCallback(async (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    await patchTask(id, { completed: !task.completed });
    await refreshTasks();
  }, [tasks]);

  return { tasks, addTask, updateTask, deleteTask, deleteCalendar, replaceAll, toggleComplete };
};

// ---------- Sorting & optimization ----------

const priorityWeight = { urgent: 0, high: 1, medium: 2, low: 3, "very-low": 4 } as const;
const isLockedWorkTask = isProtectedWorkTask;

export const sortTasks = (tasks: Task[], mode: SortMode): Task[] => {
  const arr = [...tasks];
  if (mode === "priority") {
    arr.sort((a, b) => priorityWeight[a.priority] - priorityWeight[b.priority]
      || (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
  } else if (mode === "datetime") {
    arr.sort((a, b) => (a.date + (a.time ?? "23:59")).localeCompare(b.date + (b.time ?? "23:59")));
  } else if (mode === "location") {
    arr.sort((a, b) => (a.location ?? "zzz").localeCompare(b.location ?? "zzz")
      || priorityWeight[a.priority] - priorityWeight[b.priority]);
  }
  return arr;
};

/**
 * Rule-based schedule optimization.
 * Strategy:
 *  1. Group by date.
 *  2. Within each day, cluster tasks that share a location (cuts travel).
 *  3. Within a cluster, order by priority then time.
 *  4. High-priority items without time get pulled to the morning.
 *  5. Only optimize future/today tasks; past tasks remain unchanged.
 */
export const optimizeSchedule = (tasks: Task[]): Task[] => {
  const today = formatLocalDate(new Date());

  // Separate past tasks from future/today tasks
  const pastTasks = tasks.filter((t) => t.date < today);
  const futureAndTodayTasks = tasks.filter((t) => t.date >= today);

  const dedupeSignature = (task: Task) =>
    `${task.title.trim().toLowerCase()}|${task.date}|${(task.time ?? "").trim()}|${(task.location ?? "").trim().toLowerCase()}`;

  const seen = new Set<string>();
  const uniqueTasks = futureAndTodayTasks.filter((task) => {
    const key = dedupeSignature(task);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const byDate = new Map<string, Task[]>();
  uniqueTasks.forEach((t) => {
    const k = t.date;
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k)!.push(t);
  });

  const result: Task[] = [];
  const dates = [...byDate.keys()].sort();

  for (const date of dates) {
    const dayTasks = byDate.get(date)!;
    const scheduled: Task[] = [];
    const groups = new Map<string, Task[]>();
    dayTasks.forEach((t) => {
      const loc = t.location?.trim() || "—";
      if (!groups.has(loc)) groups.set(loc, []);
      groups.get(loc)!.push(t);
    });

    // Order groups by highest-priority task they contain.
    const orderedGroups = [...groups.entries()].sort(([, a], [, b]) => {
      const pa = Math.min(...a.map((x) => priorityWeight[x.priority]));
      const pb = Math.min(...b.map((x) => priorityWeight[x.priority]));
      return pa - pb;
    });

    const workBlocks = dayTasks
      .filter((task) => isLockedWorkTask(task) && task.time)
      .map((task) => ({
        task,
        start: timeToMinutes(task.time) ?? 9 * 60,
        duration: Math.max(15, task.duration ?? 60),
      }))
      .sort((a, b) => a.start - b.start);

    const findOpenTime = (preferredStart: number, duration: number) => {
      const dayStart = 6 * 60;
      const dayEnd = 23 * 60;
      const blockers = [...workBlocks, ...scheduled.map((task) => ({
        task,
        start: timeToMinutes(task.time) ?? 0,
        duration: Math.max(15, task.duration ?? 60),
      }))].filter((block) => block.task.time);

      const canUse = (start: number) => {
        if (start < dayStart || start + duration > dayEnd) return false;
        return !blockers.some((block) => rangesOverlap(start, duration, block.start, block.duration));
      };

      for (let start = Math.max(dayStart, preferredStart); start <= dayEnd - duration; start += 15) {
        if (canUse(start)) return start;
      }
      for (let start = dayStart; start < Math.max(dayStart, preferredStart); start += 15) {
        if (canUse(start)) return start;
      }
      return preferredStart;
    };

    let cursor = 8 * 60 + 30; // start the day at 08:30 in minutes
    for (const [, group] of orderedGroups) {
      group.sort((a, b) => priorityWeight[a.priority] - priorityWeight[b.priority]
        || (a.time ?? "23:59").localeCompare(b.time ?? "23:59"));
      for (const t of group) {
        if (isLockedWorkTask(t)) {
          const existingTime = t.time ?? "09:00";
          const duration = Math.max(15, t.duration ?? 60);
          const start = timeToMinutes(existingTime);
          if (start !== null && start + duration > cursor) cursor = start + duration;
          const lockedTask = { ...t, time: existingTime, duration };
          scheduled.push(lockedTask);
          result.push(lockedTask);
          continue;
        }
        const duration = Math.max(15, t.duration ?? 60);
        const start = findOpenTime(cursor, duration);
        const time = minutesToTime(start);
        cursor = start + duration;
        const optimizedTask = { ...t, time, duration };
        if (taskOverlapsProtectedWork(optimizedTask, dayTasks)) {
          result.push({ ...t, time: t.time ?? time, duration });
          continue;
        }
        scheduled.push(optimizedTask);
        result.push(optimizedTask);
      }
      cursor += 15; // travel buffer between locations
    }
  }

  // Combine past tasks (unchanged) with optimized future tasks
  return [...pastTasks, ...result];
};
