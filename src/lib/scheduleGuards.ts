import type { Task } from "@/types/task";

type SchedulableTask = Pick<Task, "title" | "date" | "time" | "duration" | "tags"> & { id?: string };

export const timeToMinutes = (time?: string) => {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
};

export const minutesToTime = (minutes: number) => {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hour = Math.floor(normalized / 60).toString().padStart(2, "0");
  const minute = (normalized % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
};

export const rangesOverlap = (startA: number, durationA: number, startB: number, durationB: number) => {
  const endA = startA + Math.max(15, durationA || 60);
  const endB = startB + Math.max(15, durationB || 60);
  return !(endA <= startB || endB <= startA);
};

export const isProtectedWorkTask = (task: Pick<Task, "title" | "tags">) => {
  const title = (task.title || "").trim().toLowerCase();
  const tags = Array.isArray(task.tags) ? task.tags.map((tag) => String(tag).toLowerCase()) : [];
  return title === "work hours" || title.startsWith("work break") || tags.includes("work") || tags.includes("work-break");
};

export const getWorkBlocksForDate = (tasks: SchedulableTask[], date: string) =>
  tasks
    .filter((task) => task.date === date && task.time && isProtectedWorkTask(task))
    .map((task) => ({
      start: timeToMinutes(task.time),
      duration: Math.max(15, task.duration ?? 60),
      task,
    }))
    .filter((block): block is { start: number; duration: number; task: SchedulableTask } => block.start !== null)
    .sort((a, b) => a.start - b.start);

export const taskOverlapsProtectedWork = (task: SchedulableTask, tasks: SchedulableTask[]) => {
  const start = timeToMinutes(task.time);
  if (!task.date || start === null || isProtectedWorkTask(task)) return false;
  const duration = Math.max(15, task.duration ?? 60);
  return getWorkBlocksForDate(tasks, task.date).some((block) => rangesOverlap(start, duration, block.start, block.duration));
};

export const findProtectedWorkConflicts = (tasks: SchedulableTask[], blockers: SchedulableTask[] = tasks) =>
  tasks.filter((task) => taskOverlapsProtectedWork(task, blockers));

export const findTimeOutsideProtectedWork = (
  task: SchedulableTask,
  blockers: SchedulableTask[],
  accepted: SchedulableTask[] = [],
) => {
  if (!task.date || !task.time || isProtectedWorkTask(task)) return task.time;
  const duration = Math.max(15, task.duration ?? 60);
  const preferred = timeToMinutes(task.time);
  const dayStart = 6 * 60;
  const dayEnd = 23 * 60;
  const sameDayTasks = [...blockers, ...accepted].filter((item) => item.date === task.date && item.time);

  const canUse = (start: number) => {
    if (start < dayStart || start + duration > dayEnd) return false;
    const proposal = { ...task, time: minutesToTime(start), duration };
    return !sameDayTasks.some((item) => {
      if (item === task || !item.time) return false;
      if (item.id && task.id && item.id === task.id) return false;
      const itemStart = timeToMinutes(item.time);
      if (itemStart === null) return false;
      return rangesOverlap(start, duration, itemStart, item.duration ?? 60);
    }) && !taskOverlapsProtectedWork(proposal, blockers);
  };

  if (preferred !== null && canUse(preferred)) return minutesToTime(preferred);

  const workBlocks = getWorkBlocksForDate(blockers, task.date);
  const afterWork = workBlocks.length
    ? Math.max(...workBlocks.map((block) => block.start + block.duration))
    : preferred ?? 9 * 60;
  for (let start = Math.max(dayStart, afterWork); start <= dayEnd - duration; start += 15) {
    if (canUse(start)) return minutesToTime(start);
  }

  for (let start = dayStart; start <= dayEnd - duration; start += 15) {
    if (canUse(start)) return minutesToTime(start);
  }

  return null;
};

export const moveTasksOutsideProtectedWork = <T extends SchedulableTask>(
  tasksToSchedule: T[],
  blockers: SchedulableTask[],
) => {
  const accepted: T[] = [];
  const warnings: string[] = [];

  for (const task of tasksToSchedule) {
    if (!taskOverlapsProtectedWork(task, blockers)) {
      accepted.push(task);
      continue;
    }

    const nextTime = findTimeOutsideProtectedWork(task, blockers, accepted);
    if (nextTime) {
      accepted.push({ ...task, time: nextTime });
      warnings.push(`Moved "${task.title}" outside protected work time.`);
    } else {
      accepted.push(task);
      warnings.push(`"${task.title}" still overlaps protected work time.`);
    }
  }

  return { tasks: accepted, warnings };
};
