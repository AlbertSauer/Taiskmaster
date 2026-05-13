import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Send, Sparkles, X, Minus, Mic, Square, Volume2, VolumeX, Languages, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatLocalDate } from "@/lib/dateTime";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useTasks } from "@/lib/taskStore";
import type { Task } from "@/types/task";
import { toast } from "sonner";

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const useLiveAssistant = Boolean(API_BASE);

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface AssistantTaskPayload {
  id?: string;
  title: string;
  description?: string;
  note?: string;
  date: string;
  time?: string;
  duration?: number;
  location?: string;
  priority?: Task["priority"];
  tags?: string[];
  completed?: boolean;
}

export interface AssistantAction {
  type: "create_task" | "create_tasks" | "update_task" | "delete_task" | "optimize_schedule";
  task?: AssistantTaskPayload;
  tasks?: AssistantTaskPayload[];
  task_id?: string;
  updates?: Partial<Task>;
}

interface AssistantResult {
  reply: string;
  actions?: AssistantAction[];
}

interface AssistantManagerControls {
  onOpenActivityScores?: () => void;
  onOpenTaskHistory?: () => void;
  onOpenRoutineProfiles?: () => void;
  onOpenImportCalendar?: () => void;
  onOpenStatistics?: () => void;
  onOpenSmartRoutine?: () => void;
  onOpenSmartVacation?: () => void;
  onOpenOptimizeScope?: () => void;
  onOptimizeDate?: (date: string) => void;
}

interface PendingProposal {
  actions: AssistantAction[];
  summary: string;
}


interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  0: {
    transcript: string;
  };
}

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

interface VoiceLanguageOption {
  code: string;
  label: string;
}

const greeting: Message = {
  id: "intro",
  role: "assistant",
  content:
    "Hi, I'm your scheduling coach and app manager. I can plan tasks, explain your calendar, open app areas, and check forecasts.\n• \"What's on for today?\"\n• \"Open task history\"\n• \"How is the weather in Berlin tomorrow?\"",
};

const chatStorageKey = (userId?: string) =>
  userId ? `taiskmaster.assistant.messages.${userId}` : "taiskmaster.assistant.messages";
const pendingProposalStorageKey = (userId?: string) =>
  userId ? `taiskmaster.assistant.pending.${userId}` : "taiskmaster.assistant.pending";

const defaultVoiceLanguages = [
  "en-US",
  "de-DE",
  "fr-FR",
  "es-ES",
  "it-IT",
  "pt-BR",
  "nl-NL",
  "pl-PL",
  "tr-TR",
  "ru-RU",
  "uk-UA",
  "ar-SA",
  "hi-IN",
  "ja-JP",
  "ko-KR",
  "zh-CN",
];

const languageLabel = (code: string) => {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code.split("-")[0]) ?? code;
  } catch {
    return code;
  }
};

const uniqueVoiceLanguages = (codes: string[]) => {
  const seen = new Set<string>();
  return codes.filter((code) => {
    const normalized = code.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const parseRelativeDate = (text: string) => {
  const date = new Date();
  const lowered = text.toLowerCase();
  const inDaysMatch = lowered.match(/\bin\s+(\d+)\s+days?\b/);
  const fromNowMatch = lowered.match(/\b(\d+)\s+days?\s+from\s+(?:now|today)\b/);

  if (inDaysMatch) {
    date.setDate(date.getDate() + Number(inDaysMatch[1]));
  } else if (fromNowMatch) {
    date.setDate(date.getDate() + Number(fromNowMatch[1]));
  } else if (/tomorrow/.test(lowered)) {
    date.setDate(date.getDate() + 1);
  }

  return formatLocalDate(date);
};

const parseDateReference = (text: string) => {
  const lowered = text.toLowerCase();
  const isoMatch = lowered.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch) return isoMatch[0];

  const date = new Date();
  const inDaysMatch = lowered.match(/\bin\s+(\d+)\s+days?\b/);
  if (inDaysMatch) {
    date.setDate(date.getDate() + Number(inDaysMatch[1]));
    return formatLocalDate(date);
  }
  if (/\btomorrow\b/.test(lowered)) {
    date.setDate(date.getDate() + 1);
    return formatLocalDate(date);
  }
  if (/\btoday\b/.test(lowered)) return formatLocalDate(date);

  const weekdayMatch = lowered.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekdayMatch) {
    const target = weekdayLookup[weekdayMatch[2]];
    let delta = (target - date.getDay() + 7) % 7;
    if (delta === 0 || weekdayMatch[1]) delta += 7;
    date.setDate(date.getDate() + delta);
    return formatLocalDate(date);
  }

  return formatLocalDate(date);
};

const formatCalendarTask = (task: Task) =>
  `• ${task.time ? `${task.time} — ` : ""}${task.title}${task.location ? ` (${task.location})` : ""}`;

const dateLabel = (date: string) => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

const assistantTimeToMinutes = (time?: string) => {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
};

const minutesToAssistantTime = (minutes: number) => {
  const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
  const minute = (minutes % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
};

const normalizedTaskTitle = (title?: string) =>
  (title || "").trim().toLowerCase().replace(/\s+/g, " ");

const extractTaskNoteRequest = (input: string) => {
  const trimmed = input.trim();
  const patterns = [
    /\b(?:take|add|save|write|put|attach)\s+(?:a\s+)?note\s+(?:for|to|on)\s+(.+?)\s*(?:[:;-]|\bthat\b)\s*(.+)$/i,
    /\bnote\s+(?:for|to|on)\s+(.+?)\s*(?:[:;-]|\bthat\b)\s*(.+)$/i,
    /\b(?:take|add|save|write|put|attach)\s+(?:this\s+)?(?:as\s+)?(?:a\s+)?note\s*(?:[:;-]|\bthat\b)\s*(.+?)\s+(?:for|to|on)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    if (pattern === patterns[2]) {
      return { note: match[1].trim(), taskHint: match[2].trim() };
    }
    return { taskHint: match[1].trim(), note: match[2].trim() };
  }

  return null;
};

const findTaskForNote = (taskHint: string, tasks: Task[]) => {
  const hint = normalizedTaskTitle(taskHint)
    .replace(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g, "")
    .trim();
  if (hint.length < 2) return null;
  const targetDate = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|in\s+\d+\s+days?)\b/i.test(taskHint)
    ? parseDateReference(taskHint)
    : null;
  const openTasks = tasks.filter((task) => !task.completed);
  const candidates = (targetDate ? openTasks.filter((task) => task.date === targetDate) : openTasks).filter((task) => {
    const title = normalizedTaskTitle(task.title);
    const description = normalizedTaskTitle(task.description);
    const location = normalizedTaskTitle(task.location);
    return title.includes(hint) || hint.includes(title) || description.includes(hint) || location.includes(hint);
  });

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    return candidates.sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`))[0];
  }

  const words = hint.split(/\s+/).filter((word) => word.length > 2);
  if (!words.length) return null;
  const fuzzy = (targetDate ? openTasks.filter((task) => task.date === targetDate) : openTasks)
    .map((task) => {
      const haystack = normalizedTaskTitle(`${task.title} ${task.description ?? ""} ${task.location ?? ""}`);
      const score = words.filter((word) => haystack.includes(word)).length;
      return { task, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || `${a.task.date}${a.task.time ?? ""}`.localeCompare(`${b.task.date}${b.task.time ?? ""}`));

  return fuzzy[0]?.task ?? null;
};

const buildTaskNoteAction = (input: string, tasks: Task[]): AssistantResult | null => {
  const request = extractTaskNoteRequest(input);
  if (!request || !request.note) return null;

  const task = findTaskForNote(request.taskHint, tasks);
  if (!task) {
    return {
      reply: `I could not confidently find a task matching "${request.taskHint}". Tell me the task title and note again, and I will open a preview before saving.`,
      actions: [],
    };
  }

  const existingNote = task.note?.trim();
  const nextNote = existingNote ? `${existingNote}\n${request.note}` : request.note;
  return {
    reply: `I found "${task.title}" and prepared the note for review.`,
    actions: [{ type: "update_task", task_id: task.id, updates: { note: nextNote } }],
  };
};

const isRoutineCandidate = (task: Task) => {
  const title = normalizedTaskTitle(task.title);
  const tags = (task.tags ?? []).map((tag) => tag.toLowerCase());
  if (!task.time) return false;
  if (tags.includes("vacation") || tags.includes("time-off") || title === "vacation") return false;
  return true;
};

const mostCommonValue = <T,>(values: T[], fallback: T): T => {
  const counts = new Map<T, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
};

const taskOverlaps = (candidate: AssistantTaskPayload, task: Pick<Task, "date" | "time" | "duration"> | AssistantTaskPayload) => {
  if (!candidate.time || !task.time || candidate.date !== task.date) return false;
  const candidateStart = assistantTimeToMinutes(candidate.time);
  const taskStart = assistantTimeToMinutes(task.time);
  if (candidateStart === null || taskStart === null) return false;
  const candidateEnd = candidateStart + Math.max(15, candidate.duration ?? 60);
  const taskEnd = taskStart + Math.max(15, task.duration ?? 60);
  return !(candidateEnd <= taskStart || taskEnd <= candidateStart);
};

const findOpenTimeForNormalDay = (
  candidate: AssistantTaskPayload,
  existing: Task[],
  accepted: AssistantTaskPayload[],
) => {
  const duration = Math.max(15, candidate.duration ?? 60);
  const preferredStart = assistantTimeToMinutes(candidate.time);
  const dayStart = 7 * 60;
  const dayEnd = 22 * 60;
  const blockers = [
    ...existing.filter((task) => task.date === candidate.date),
    ...accepted.filter((task) => task.date === candidate.date),
  ];

  const canUse = (start: number) => {
    if (start < dayStart || start + duration > dayEnd) return false;
    const proposal = { ...candidate, time: minutesToAssistantTime(start), duration };
    return !blockers.some((task) => taskOverlaps(proposal, task));
  };

  if (preferredStart !== null && canUse(preferredStart)) {
    return minutesToAssistantTime(preferredStart);
  }

  for (let start = dayStart; start <= dayEnd - duration; start += 30) {
    if (canUse(start)) return minutesToAssistantTime(start);
  }

  return null;
};

const buildNormalDayPlan = (input: string, tasks: Task[]): AssistantResult | null => {
  const lowered = input.toLowerCase();
  if (!/\b(plan|create|build|make|schedule)\b/.test(lowered)) return null;
  if (!/\b(normal|typical|usual|regular|average)\s+day\b/.test(lowered)) return null;

  const targetDate = parseDateReference(input);
  const target = new Date(`${targetDate}T00:00:00`);
  const targetWeekday = target.getDay();
  const existingTargetTasks = tasks.filter((task) => task.date === targetDate);
  const existingTargetTitles = new Set(existingTargetTasks.map((task) => normalizedTaskTitle(task.title)));

  const sourceTasks = tasks
    .filter((task) => task.date !== targetDate && isRoutineCandidate(task))
    .filter((task) => {
      const date = new Date(`${task.date}T00:00:00`);
      return !Number.isNaN(date.getTime());
    });

  const sameWeekdayTasks = sourceTasks.filter((task) => new Date(`${task.date}T00:00:00`).getDay() === targetWeekday);
  const primarySource = sameWeekdayTasks.length > 0 ? sameWeekdayTasks : sourceTasks;
  if (primarySource.length === 0) {
    return {
      reply: "I need a little more calendar history before I can infer your normal day. Add a few recurring day-to-day tasks first, then ask me again.",
      actions: [],
    };
  }

  const byTitle = new Map<string, Task[]>();
  primarySource.forEach((task) => {
    const key = normalizedTaskTitle(task.title);
    if (!key || existingTargetTitles.has(key)) return;
    byTitle.set(key, [...(byTitle.get(key) ?? []), task]);
  });

  const groups = [...byTitle.values()]
    .filter((group) => sameWeekdayTasks.length > 0 || group.length >= 2)
    .sort((a, b) => {
      const aTime = assistantTimeToMinutes(mostCommonValue(a.map((task) => task.time).filter(Boolean) as string[], "23:59")) ?? 1439;
      const bTime = assistantTimeToMinutes(mostCommonValue(b.map((task) => task.time).filter(Boolean) as string[], "23:59")) ?? 1439;
      return aTime - bTime || b.length - a.length;
    });

  const accepted: AssistantTaskPayload[] = [];
  for (const group of groups.slice(0, 10)) {
    const sample = group[0];
    const commonTime = mostCommonValue(group.map((task) => task.time).filter(Boolean) as string[], sample.time ?? "09:00");
    const commonDuration = mostCommonValue(group.map((task) => task.duration ?? 60), sample.duration ?? 60);
    const candidate: AssistantTaskPayload = {
      title: sample.title,
      description: sample.description || `Part of your normal day pattern, based on similar calendar entries.`,
      date: targetDate,
      time: commonTime,
      duration: commonDuration,
      location: mostCommonValue(group.map((task) => task.location).filter(Boolean) as string[], sample.location ?? ""),
      priority: mostCommonValue(group.map((task) => task.priority), sample.priority),
      tags: Array.from(new Set(group.flatMap((task) => task.tags ?? []))).slice(0, 6),
      completed: false,
    };

    const openTime = findOpenTimeForNormalDay(candidate, existingTargetTasks, accepted);
    if (!openTime) continue;
    accepted.push({ ...candidate, time: openTime });
  }

  if (accepted.length === 0) {
    return {
      reply: `${dateLabel(targetDate)} already has tasks that block the normal-day activities I inferred. I did not create an overlapping plan.`,
      actions: [],
    };
  }

  return {
    reply: `I built a normal-day plan for ${dateLabel(targetDate)} based on your calendar patterns. Review it before saving.`,
    actions: [{ type: "create_tasks", tasks: accepted }],
  };
};

const weekdayLookup: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

const extractRecurringWeekdays = (text: string) => {
  if (!/\bevery\b/i.test(text)) return [];
  const seen = new Set<string>();
  const weekdays: string[] = [];
  for (const match of text.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi)) {
    const weekday = match[1].toLowerCase();
    if (!seen.has(weekday)) {
      seen.add(weekday);
      weekdays.push(weekday);
    }
  }
  return weekdays;
};

const parseAssistantTime = (text: string) => {
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)?/i);
  if (!match) return undefined;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;

  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
};

const parseAssistantTimeRange = (text: string) => {
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s?(am|pm)?/i);
  if (!match) return { time: undefined, duration: undefined };

  const time = parseAssistantTime(`${match[1]}:${match[2] ?? "00"} ${match[3] ?? ""}`.trim());
  const endTime = parseAssistantTime(`${match[4]}:${match[5] ?? "00"} ${match[6] ?? ""}`.trim());
  if (!time || !endTime) return { time: undefined, duration: undefined };

  const [startHour, startMinute] = time.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const duration = ((endHour * 60 + endMinute) - (startHour * 60 + startMinute) + 24 * 60) % (24 * 60);
  return { time, duration: duration || undefined };
};

const inferPriority = (text: string): Task["priority"] => {
  const lowered = text.toLowerCase();
  if (/\b(urgent|asap|immediately|critical|emergency|deadline|due today|must)\b/.test(lowered)) return "urgent";
  if (/\b(high|important|priority|doctor|dentist|appointment|exam|interview|flight|train|meeting)\b/.test(lowered)) return "high";
  if (/\b(very low|lowest|maybe|if time|if i have time)\b/.test(lowered)) return "very-low";
  if (/\b(low|optional|sometime|when possible|whenever|nice to have)\b/.test(lowered)) return "low";
  return "medium";
};

const compactDescription = (title: string, text: string) => {
  const cleaned = text
    .replace(/^(please\s+)?(add|new task|create|schedule|plan)[:\s]+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.toLowerCase() === title.toLowerCase()) return `Planned from: ${title}.`;
  return cleaned.length > 140 ? `${cleaned.slice(0, 137).trim()}...` : cleaned;
};

const parseRecurringPeriod = (text: string) => {
  const today = new Date();
  if (/\bthis\s+month\b/i.test(text)) {
    return {
      start: today,
      end: new Date(today.getFullYear(), today.getMonth() + 1, 0),
    };
  }

  const match = text.match(/\bfor\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i);
  if (!match) return { start: today, end: undefined };

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const end = new Date(today);
  if (unit.startsWith("day")) {
    end.setDate(today.getDate() + amount - 1);
  } else if (unit.startsWith("week")) {
    end.setDate(today.getDate() + amount * 7 - 1);
  } else {
    end.setDate(today.getDate() + amount * 30 - 1);
  }
  return { start: today, end };
};

const extractTaskTitle = (text: string) => {
  const cleaned = text
    .replace(/^please\s+/i, "")
    .replace(/^(add|new task|create|schedule|plan)[:\s]+/i, "")
    .replace(/\bevery\s+.*$/i, "")
    .replace(/\b(today|tomorrow)\b/gi, "")
    .replace(/\bin\s+\d+\s+days?\b/gi, "")
    .replace(/\b\d+\s+days?\s+from\s+(?:now|today)\b/gi, "")
    .replace(/\bthis\s+month\b/gi, "")
    .replace(/\bfor\s+\d+\s+(day|days|week|weeks|month|months)\b/gi, "")
    .replace(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s?(am|pm)?/gi, "")
    .replace(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)?/gi, "")
    .replace(/\b(urgent|asap|immediately|critical|emergency|high|medium|low|very low|very-low|lowest|optional|maybe|if time|if i have time)\b/gi, "")
    .replace(/\bfor\b/gi, "")
    .replace(/\bthat\b/gi, "")
    .replace(/\bat\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "New task";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

const parseRecurringTasks = (input: string): AssistantResult | null => {
  const weekdays = extractRecurringWeekdays(input);
  const daily = /\b(everyday|every day|daily|each day)\b/i.test(input);
  if (!weekdays.length && !daily) return null;

  const range = parseAssistantTimeRange(input);
  const time = range.time ?? parseAssistantTime(input);
  if (!time) {
    const recurrence = daily ? "every day" : `every ${weekdays.map((day) => day[0].toUpperCase() + day.slice(1)).join(" and ")}`;
    return {
      reply: `I can schedule "${extractTaskTitle(input)}" ${recurrence}, but what time should I put it on your calendar?`,
      actions: [],
    };
  }

  const title = extractTaskTitle(input);
  const { start, end } = parseRecurringPeriod(input);
  const description = compactDescription(title, input);
  const priority = inferPriority(input);
  const tasks: AssistantTaskPayload[] = [];

  if (daily) {
    const current = new Date(start);
    const last = end ?? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 13);
    while (current <= last && tasks.length < 60) {
      tasks.push({
        title,
        description,
        date: formatLocalDate(current),
        time,
        duration: range.duration,
        priority,
        tags: ["daily", "routine"],
        completed: false,
      });
      current.setDate(current.getDate() + 1);
    }
  } else {
    for (const weekday of weekdays) {
      const current = new Date(start);
      while (current.getDay() !== weekdayLookup[weekday]) {
        current.setDate(current.getDate() + 1);
      }

      let occurrenceCount = 0;
      while (occurrenceCount < 8 && (!end || current <= end)) {
        tasks.push({
          title,
          description,
          date: formatLocalDate(current),
          time,
          duration: range.duration,
          priority,
          tags: [weekday, "routine"],
          completed: false,
        });
        occurrenceCount += 1;
        current.setDate(current.getDate() + 7);
      }
    }
  }

  tasks.sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));

  if (!tasks.length) {
    return {
      reply: `I couldn't find any dates in that period for "${title}". Try adjusting the range or recurrence.`,
      actions: [],
    };
  }

  const recurrence = daily ? "every day" : `every ${weekdays.map((day) => day[0].toUpperCase() + day.slice(1)).join(" and ")}`;
  return {
    reply: `Scheduled "${title}" ${recurrence} from ${tasks[0].date} to ${tasks[tasks.length - 1].date}.`,
    actions: [{ type: "create_tasks", tasks }],
  };
};

const parseVacationTasks = (input: string): AssistantResult | null => {
  if (!/\b(vacation|holiday|time off|days off|out of office|ooo)\b/i.test(input)) return null;
  const explicitDates = input.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  if (explicitDates.length < 2) {
    return {
      reply: "I can add your vacation, but I need start and end date (example: 2026-07-10 to 2026-07-18).",
      actions: [],
    };
  }
  let start = new Date(`${explicitDates[0]}T00:00:00`);
  let end = new Date(`${explicitDates[1]}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { reply: "Those dates look invalid. Please use YYYY-MM-DD.", actions: [] };
  }
  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  const tasks: AssistantTaskPayload[] = [];
  const cursor = new Date(start);
  while (cursor <= end && tasks.length < 366) {
    tasks.push({
      title: "Vacation",
      description: "Time off period saved from Smart Vacation.",
      date: formatLocalDate(cursor),
      priority: "low",
      tags: ["vacation", "time-off", "locked"],
      completed: false,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    reply: `Added vacation from ${formatLocalDate(start)} to ${formatLocalDate(end)} and marked it in your calendar.`,
    actions: [{ type: "create_tasks", tasks }],
  };
};

const isConfirmationMessage = (text: string) =>
  /^(yes|yep|yeah|confirm(?:ed)?(?:\s+it|\s+that|\s+the\s+change|\s+the\s+changes)?|do it|apply(?:\s+it|\s+that|\s+the\s+change|\s+the\s+changes)?|go ahead|sounds good|looks good|ok|okay|please do|please apply)$/i.test(text.trim());

const isCancelMessage = (text: string) =>
  /^(no|nope|cancel|stop|don't|do not|not yet|never mind|nevermind|change it|revise it|adjust it)$/i.test(text.trim());

const formatTaskLabel = (task: AssistantTaskPayload) =>
  `"${task.title}" on ${task.date}${task.time ? ` at ${task.time}` : ""}${task.location ? ` in ${task.location}` : ""}`;

const summarizeActions = (actions: AssistantAction[], tasks: Task[]) => {
  const lines: string[] = ["I’m ready to make these changes:"];

  for (const action of actions) {
    if (action.type === "create_task" && action.task) {
      lines.push(`• Add ${formatTaskLabel(action.task)}`);
    } else if (action.type === "create_tasks" && action.tasks?.length) {
      const firstTask = action.tasks[0];
      lines.push(`• Add ${action.tasks.length} tasks starting with ${formatTaskLabel(firstTask)}`);
    } else if (action.type === "update_task" && action.task_id && action.updates) {
      const existingTask = tasks.find((task) => task.id === action.task_id);
      const taskName = existingTask?.title ?? "this task";
      const changes = Object.entries(action.updates)
        .map(([key, value]) => `${key} → ${Array.isArray(value) ? value.join(", ") : String(value)}`)
        .join(", ");
      lines.push(`• Update "${taskName}" (${changes})`);
    } else if (action.type === "delete_task" && action.task_id) {
      const existingTask = tasks.find((task) => task.id === action.task_id);
      lines.push(`• Delete "${existingTask?.title ?? "this task"}"`);
    } else if (action.type === "optimize_schedule") {
      lines.push("• Reorganize your schedule by priority and location");
    }
  }

  lines.push("Reply with \"yes\" to confirm, or tell me what you want changed.");
  return lines.join("\n");
};

const normalizeAssistantActions = (actions: AssistantAction[] | undefined): AssistantAction[] => {
  if (!Array.isArray(actions)) return [];

  return actions
    .map((raw) => {
      const normalized = { ...(raw as AssistantAction & { action?: string }) };
      if (!normalized.type && normalized.action) {
        normalized.type = normalized.action as AssistantAction["type"];
      }
      return normalized as AssistantAction;
    })
    .filter((action) => typeof action.type === "string");
};

const runLocalFallbackAssistant = async (
  input: string,
  ctx: ReturnType<typeof useTasks>,
): Promise<AssistantResult> => {
  const text = input.trim().toLowerCase();
  const { tasks } = ctx;

  if (!text) return { reply: "Tell me what you'd like to do." };

  const recurringTasks = parseRecurringTasks(input);
  if (recurringTasks) return recurringTasks;

  const vacationTasks = parseVacationTasks(input);
  if (vacationTasks) return vacationTasks;

  if (/^(add|new task|create|schedule|plan)\b/i.test(input.trim())) {
    const cleaned = input.replace(/^(add|new task|create|schedule|plan)[:\s]+/i, "").trim();
    if (!cleaned) return { reply: "What should I add? For example: \"Add: Email Sam tomorrow at 10am\"." };
    const timeMatch = cleaned.match(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)?/i);
    let time: string | undefined;
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const mer = timeMatch[3]?.toLowerCase();
      if (mer === "pm" && h < 12) h += 12;
      if (mer === "am" && h === 12) h = 0;
      if (h <= 23) time = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
    const title = extractTaskTitle(cleaned);
    const date = parseRelativeDate(cleaned);
    return {
      reply: "I will add this task.",
      actions: [{
        type: "create_task",
        task: {
          title,
          description: compactDescription(title, cleaned),
          date,
          time,
          priority: inferPriority(cleaned),
        }
      }]
    };
  }

  if (text.includes("today")) {
    const iso = formatLocalDate(new Date());
    const today = tasks.filter((t) => t.date === iso && !t.completed);
    if (today.length === 0) return { reply: "Nothing is scheduled for today yet, which gives us a nice clean slate to work with." };
    return {
      reply: `You have ${today.length} task${today.length === 1 ? "" : "s"} today. Here’s the plan:\n` +
        today.map((t) => `• ${t.time ? t.time + " — " : ""}${t.title}`).join("\n"),
    };
  }

  if (text.includes("priority") || text.includes("important")) {
    const high = tasks.filter((t) => (t.priority === "urgent" || t.priority === "high") && !t.completed);
    if (high.length === 0) return { reply: "You don’t have any high-priority items right now, which is a great place to be." };
    return { reply: "Here are your high-priority items:\n" + high.map((t) => `• ${t.title} — ${t.date}`).join("\n") };
  }

  if (text.includes("help") || text.includes("?")) {
    return { reply: "I can help you stay organized and keep momentum:\n• Review what's on (\"What's on today?\")\n• Add tasks (\"Add: Coffee with Alex tomorrow at 9am\")\n• Optimize your schedule (\"Optimize my day\")" };
  }

  return { reply: "I’m not fully sure what you want to change yet. Tell me the task or plan, plus the day, time, or place if you know them, and I’ll sort it out with you." };
};

const weatherCodeLabel = (code: number) => {
  if (code === 0) return "clear sky";
  if ([1, 2, 3].includes(code)) return "partly cloudy";
  if ([45, 48].includes(code)) return "foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "rainy";
  if ([71, 73, 75, 77].includes(code)) return "snowy";
  if ([80, 81, 82].includes(code)) return "rain showers";
  if ([85, 86].includes(code)) return "snow showers";
  if ([95, 96, 99].includes(code)) return "thunderstorms";
  return "mixed conditions";
};

const extractWeatherLocation = (input: string) => {
  const match = input.match(/\b(?:in|for|at)\s+([a-zA-ZäöüÄÖÜß\s.-]+?)(?:\s+(?:today|tomorrow|on|next|in\s+\d+\s+days?)|[?.!,]|$)/i);
  return match?.[1]?.trim();
};

const getBrowserPosition = () =>
  new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
  });

const fetchWeatherSummary = async (input: string) => {
  const targetDate = parseDateReference(input);
  const today = new Date();
  const target = new Date(`${targetDate}T00:00:00`);
  const daysAhead = Math.ceil((target.getTime() - new Date(formatLocalDate(today)).getTime()) / 86_400_000);
  if (daysAhead < 0 || daysAhead > 15) {
    return "I can check forecasts up to 16 days ahead. For older or farther dates, weather data is outside the forecast window.";
  }

  let latitude: number;
  let longitude: number;
  let placeLabel = "your location";
  const location = extractWeatherLocation(input);

  if (location) {
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.searchParams.set("name", location);
    geocodeUrl.searchParams.set("count", "1");
    geocodeUrl.searchParams.set("language", "en");
    geocodeUrl.searchParams.set("format", "json");
    const geocodeResponse = await fetch(geocodeUrl.toString());
    if (!geocodeResponse.ok) throw new Error("Could not find that location.");
    const geocode = await geocodeResponse.json() as { results?: Array<{ name: string; country?: string; latitude: number; longitude: number }> };
    const result = geocode.results?.[0];
    if (!result) return `I couldn't find weather coordinates for "${location}". Try a city name like "Berlin" or "New York".`;
    latitude = result.latitude;
    longitude = result.longitude;
    placeLabel = `${result.name}${result.country ? `, ${result.country}` : ""}`;
  } else {
    try {
      const position = await getBrowserPosition();
      latitude = position.coords.latitude;
      longitude = position.coords.longitude;
    } catch {
      return "Tell me a city for the forecast, for example: \"How is the weather in Berlin tomorrow?\"";
    }
  }

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(latitude));
  forecastUrl.searchParams.set("longitude", String(longitude));
  forecastUrl.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max");
  forecastUrl.searchParams.set("timezone", "auto");
  forecastUrl.searchParams.set("forecast_days", "16");
  const response = await fetch(forecastUrl.toString());
  if (!response.ok) throw new Error("Weather service unavailable.");
  const data = await response.json() as {
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
      precipitation_sum?: number[];
      wind_speed_10m_max?: number[];
    };
  };
  const index = data.daily?.time?.indexOf(targetDate) ?? -1;
  if (index < 0) return `I could not find a forecast for ${targetDate}.`;

  const code = data.daily?.weather_code?.[index] ?? -1;
  const high = data.daily?.temperature_2m_max?.[index];
  const low = data.daily?.temperature_2m_min?.[index];
  const rainChance = data.daily?.precipitation_probability_max?.[index];
  const rain = data.daily?.precipitation_sum?.[index];
  const wind = data.daily?.wind_speed_10m_max?.[index];

  return `Forecast for ${placeLabel} on ${dateLabel(targetDate)}: ${weatherCodeLabel(code)}, ${Math.round(low ?? 0)}-${Math.round(high ?? 0)}°C, ${rainChance ?? 0}% precipitation chance, ${rain ?? 0} mm precipitation, wind up to ${Math.round(wind ?? 0)} km/h.`;
};

const buildCalendarManagerReply = (input: string, tasks: Task[]) => {
  const lowered = input.toLowerCase();
  const targetDate = parseDateReference(input);
  const openTasks = tasks.filter((task) => !task.completed);
  const completedTasks = tasks.filter((task) => task.completed);
  const overdueTasks = openTasks.filter((task) => task.date < formatLocalDate(new Date()));

  if (/\b(summary|overview|status|stats|statistics)\b/.test(lowered) && /\b(calendar|schedule|tasks?)\b/.test(lowered)) {
    const activeDays = new Set(tasks.map((task) => task.date)).size;
    const next = openTasks
      .filter((task) => task.date >= formatLocalDate(new Date()))
      .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`))[0];
    return [
      `Calendar overview: ${tasks.length} total tasks, ${openTasks.length} open, ${completedTasks.length} completed, ${overdueTasks.length} overdue.`,
      `You have tasks on ${activeDays} calendar day${activeDays === 1 ? "" : "s"}.`,
      next ? `Next up: ${formatCalendarTask(next)} on ${dateLabel(next.date)}.` : "No upcoming open tasks found.",
    ].join("\n");
  }

  if (/\b(free|available|availability|open slot|gap)\b/.test(lowered)) {
    const dayTasks = openTasks
      .filter((task) => task.date === targetDate)
      .sort((a, b) => (a.time ?? "23:59").localeCompare(b.time ?? "23:59"));
    if (!dayTasks.length) return `${dateLabel(targetDate)} looks open. Nothing is scheduled.`;
    const timed = dayTasks.filter((task) => task.time);
    const busyMinutes = dayTasks.reduce((sum, task) => sum + Math.max(15, task.duration ?? 60), 0);
    return [
      `${dateLabel(targetDate)} has ${dayTasks.length} task${dayTasks.length === 1 ? "" : "s"} and about ${(busyMinutes / 60).toFixed(1)}h planned.`,
      timed.length ? `Timed tasks:\n${timed.map(formatCalendarTask).join("\n")}` : "No exact task times are set, so the day still has flexible space.",
    ].join("\n");
  }

  const dayTasks = openTasks
    .filter((task) => task.date === targetDate)
    .sort((a, b) => (a.time ?? "23:59").localeCompare(b.time ?? "23:59"));
  if (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|calendar|schedule|planned|agenda|what.*on)\b/.test(lowered)) {
    if (!dayTasks.length) return `Nothing is scheduled for ${dateLabel(targetDate)}.`;
    return `You have ${dayTasks.length} open task${dayTasks.length === 1 ? "" : "s"} on ${dateLabel(targetDate)}:\n${dayTasks.map(formatCalendarTask).join("\n")}`;
  }

  return null;
};

const buildBulkDeleteByDate = (input: string, tasks: Task[]): AssistantResult | null => {
  const lowered = input.toLowerCase();
  if (!/\b(delete|remove|cancel|clear)\b/.test(lowered)) return null;
  if (!/\b(all|everything|every|tasks?|calendar)\b/.test(lowered)) return null;
  if (!/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|in\s+\d+\s+days?)\b/.test(lowered)) return null;

  const targetDate = parseDateReference(input);
  const matchingTasks = tasks.filter((task) => task.date === targetDate);
  if (!matchingTasks.length) {
    return { reply: `There are no tasks planned for ${dateLabel(targetDate)} to delete.`, actions: [] };
  }

  return {
    reply: `I can delete all ${matchingTasks.length} task${matchingTasks.length === 1 ? "" : "s"} on ${dateLabel(targetDate)}.`,
    actions: matchingTasks.map((task) => ({ type: "delete_task", task_id: task.id })),
  };
};

const runManagerIntent = async (
  input: string,
  ctx: ReturnType<typeof useTasks>,
  controls: AssistantManagerControls,
): Promise<AssistantResult | null> => {
  const text = input.trim().toLowerCase();

  const noteAction = buildTaskNoteAction(input, ctx.tasks);
  if (noteAction) return noteAction;

  if (/\b(optimize|optimise|reorganize|reorganise)\b/.test(text)) {
    const hasDateScope = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|in\s+\d+\s+days?)\b/.test(text);
    if (hasDateScope) {
      const date = parseDateReference(input);
      controls.onOptimizeDate?.(date);
      return { reply: `Opened an optimize preview for ${dateLabel(date)}.` };
    }
    controls.onOpenOptimizeScope?.();
    return {
      reply: "Which day or timeframe should I optimize? I opened the optimizer options.",
      actions: [],
    };
  }

  const normalDayPlan = buildNormalDayPlan(input, ctx.tasks);
  if (normalDayPlan) return normalDayPlan;

  const bulkDelete = buildBulkDeleteByDate(input, ctx.tasks);
  if (bulkDelete) return bulkDelete;

  if (/\b(open|show|go to|take me to)\b/.test(text)) {
    if (/\b(options|settings|profile)\b/.test(text)) {
      window.dispatchEvent(new Event("taiskmaster:open-profile"));
      return { reply: "Opened your profile and options." };
    }
    if (/\b(activity scores?|act scores?)\b/.test(text)) {
      controls.onOpenActivityScores?.();
      return { reply: "Opened your activity score history." };
    }
    if (/\b(task history|history)\b/.test(text)) {
      controls.onOpenTaskHistory?.();
      return { reply: "Opened your task history." };
    }
    if (/\b(routines?|routine profiles?)\b/.test(text)) {
      controls.onOpenRoutineProfiles?.();
      return { reply: "Opened your saved routines." };
    }
    if (/\b(import|calendar import)\b/.test(text)) {
      controls.onOpenImportCalendar?.();
      return { reply: "Opened calendar import." };
    }
    if (/\b(statistics|stats|analytics)\b/.test(text)) {
      controls.onOpenStatistics?.();
      return { reply: "Opening Smart Statistics." };
    }
    if (/\b(smart routine|routine builder)\b/.test(text)) {
      controls.onOpenSmartRoutine?.();
      return { reply: "Opening Smart Routine." };
    }
    if (/\b(vacation|holiday|time off)\b/.test(text)) {
      controls.onOpenSmartVacation?.();
      return { reply: "Opening Smart Vacation." };
    }
  }

  if (/\b(weather|forecast|rain|temperature|snow|sunny|wind)\b/.test(text)) {
    return { reply: await fetchWeatherSummary(input) };
  }

  const calendarReply = buildCalendarManagerReply(input, ctx.tasks);
  if (calendarReply) return { reply: calendarReply };

  return null;
};

const runAssistant = async (
  input: string,
  ctx: ReturnType<typeof useTasks>,
  authToken: string | null,
  messages: Message[],
  controls: AssistantManagerControls,
): Promise<AssistantResult> => {
  const { tasks } = ctx;

  if (!input.trim()) return { reply: "Tell me what you'd like to do." };

  const managerResult = await runManagerIntent(input, ctx, controls);
  if (managerResult) return managerResult;

  if (useLiveAssistant) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          input,
          tasks: tasks.map((task) => ({
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
          messages: messages.slice(-30).map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok) throw new Error("Assistant service unavailable");
      const data = await response.json() as AssistantResult;

      return { reply: data.reply || "I couldn't get an answer right now.", actions: data.actions };
    } catch {
      return runLocalFallbackAssistant(input, ctx);
    }
  }

  return runLocalFallbackAssistant(input, ctx);
};

const applyAssistantActions = async (
  actions: AssistantAction[],
  ctx: ReturnType<typeof useTasks>,
  controls: AssistantManagerControls,
) => {
  const { addTask } = ctx;

  for (const action of actions) {
    if (action.type === "create_task" && action.task) {
      await addTask({
        title: action.task.title,
        description: action.task.description,
        note: action.task.note,
        date: action.task.date,
        time: action.task.time,
        duration: action.task.duration,
        location: action.task.location,
        priority: action.task.priority ?? "medium",
        tags: action.task.tags,
        completed: action.task.completed,
      });
    } else if (action.type === "create_tasks" && action.tasks?.length) {
      for (const task of action.tasks) {
        await addTask({
          title: task.title,
          description: task.description,
          note: task.note,
          date: task.date,
          time: task.time,
          duration: task.duration,
          location: task.location,
          priority: task.priority ?? "medium",
          tags: task.tags,
          completed: task.completed,
        });
      }
    } else if (action.type === "update_task" && action.task_id && action.updates) {
      await ctx.updateTask(action.task_id, action.updates);
    } else if (action.type === "delete_task" && action.task_id) {
      await ctx.deleteTask(action.task_id);
    } else if (action.type === "optimize_schedule") {
      controls.onOpenOptimizeScope?.();
    }
  }
};

export const AssistantPanel = ({
  onProposedAction,
  ...managerControls
}: {
  onProposedAction?: (action: AssistantAction) => void;
} & AssistantManagerControls) => {
  const { token, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceOutputSupported, setVoiceOutputSupported] = useState(false);
  const [voiceRepliesEnabled, setVoiceRepliesEnabled] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);
  const [voiceLanguage, setVoiceLanguage] = useState(() => navigator.language || "en-US");
  const [voiceLanguages, setVoiceLanguages] = useState<VoiceLanguageOption[]>([]);
  const taskCtx = useTasks();
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sendMessageRef = useRef<(content: string) => Promise<void>>(async () => {});
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const silenceTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const storageKey = chatStorageKey(user?.id);
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        setMessages([greeting]);
        return;
      }

      const parsed = JSON.parse(stored) as Message[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setMessages(parsed);
      } else {
        setMessages([greeting]);
      }
    } catch {
      setMessages([greeting]);
    }
  }, [user?.id]);

  useEffect(() => {
    const storageKey = chatStorageKey(user?.id);
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // Ignore storage failures and continue without persistence.
    }
  }, [messages, user?.id]);

  useEffect(() => {
    const storageKey = pendingProposalStorageKey(user?.id);
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        setPendingProposal(null);
        return;
      }

      const parsed = JSON.parse(stored) as PendingProposal;
      if (parsed && Array.isArray(parsed.actions) && typeof parsed.summary === "string") {
        setPendingProposal(parsed);
      } else {
        setPendingProposal(null);
      }
    } catch {
      setPendingProposal(null);
    }
  }, [user?.id]);

  useEffect(() => {
    const storageKey = pendingProposalStorageKey(user?.id);
    try {
      if (pendingProposal) {
        localStorage.setItem(storageKey, JSON.stringify(pendingProposal));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // Ignore storage failures and continue without persistence.
    }
  }, [pendingProposal, user?.id]);

  const clearSilenceTimeout = useCallback(() => {
    if (silenceTimeoutRef.current !== null) {
      window.clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }, []);

  const scheduleVoiceStop = useCallback(() => {
    clearSilenceTimeout();
    silenceTimeoutRef.current = window.setTimeout(() => {
      recognitionRef.current?.stop();
    }, 1800);
  }, [clearSilenceTimeout]);

  const speakAssistantReply = (content: string) => {
    if (!voiceRepliesEnabled || !("speechSynthesis" in window)) return;

    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = voiceLanguage;

    const voices = voicesRef.current;
    const exactMatch = voices.find((voice) => voice.lang === voiceLanguage);
    const partialMatch = voices.find((voice) => voice.lang.toLowerCase().startsWith(voiceLanguage.split("-")[0].toLowerCase()));
    if (exactMatch || partialMatch) utterance.voice = exactMatch ?? partialMatch ?? null;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setInput("");
    setLiveTranscript("");
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: trimmed };
    setMessages((m) => [...m, userMsg]);

    try {
      if (pendingProposal && isConfirmationMessage(trimmed)) {
        await applyAssistantActions(pendingProposal.actions, taskCtx, managerControls);
        const replyText = "Done. I’ve applied those changes.";
        const reply: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: replyText,
        };
        setPendingProposal(null);
        setMessages((m) => [...m, reply]);
        speakAssistantReply(replyText);
        toast.success("Tasks updated");
        return;
      }

      if (pendingProposal && isCancelMessage(trimmed)) {
        const replyText = "Okay, I won’t make those changes. Tell me what you’d like adjusted.";
        const reply: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: replyText,
        };
        setPendingProposal(null);
        setMessages((m) => [...m, reply]);
        speakAssistantReply(replyText);
        return;
      }

      const effectiveInput = pendingProposal
        ? `Revise this proposed plan based on the user's feedback.\nPrevious proposal:\n${pendingProposal.summary}\nUser feedback: ${trimmed}`
        : trimmed;
      const currentMessages = [...messages, userMsg];
      const { reply: assistantText, actions } = await runAssistant(effectiveInput, taskCtx, token, currentMessages, managerControls);
      const normalizedActions = normalizeAssistantActions(actions);

      if (normalizedActions.length) {
        const act = normalizedActions.length === 1 ? normalizedActions[0] : null;
        const isValidCreate = act?.type === "create_task" && act.task;
        const isValidUpdate = act?.type === "update_task" && act.task_id && act.updates;
        const isValidCreateTasks = act?.type === "create_tasks" && act.tasks?.length;

        if ((isValidCreate || isValidUpdate || isValidCreateTasks) && onProposedAction) {
          onProposedAction(act!);
          const replyText = isValidCreateTasks 
            ? "I've prepared the plan for you to review and save." 
            : "I've opened the task for you to review and save.";
          const reply: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: replyText,
          };
          setPendingProposal(null);
          setMessages((m) => [...m, reply]);
          speakAssistantReply(replyText);
          return;
        }

        const summary = summarizeActions(normalizedActions, taskCtx.tasks);
        const reply: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: summary,
        };
        setPendingProposal({ actions: normalizedActions, summary });
        setMessages((m) => [...m, reply]);
        speakAssistantReply("I have a plan ready. Please confirm if you want me to apply it.");
        return;
      }

      const reply: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantText,
      };

      setPendingProposal(null);
      setMessages((m) => [...m, reply]);
      speakAssistantReply(assistantText);
      if (assistantText.startsWith("Done")) toast.success("Schedule updated");
    } catch (error) {
      const reply: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "I hit a connection issue while trying to help with that. Please try again now that the backend routes are updated.",
      };
      setMessages((m) => [...m, reply]);
      toast.error(error instanceof Error ? error.message : "Assistant request failed");
    } finally {
      setIsSending(false);
    }
  };
  sendMessageRef.current = sendMessage;

  const shouldShowVoiceControls = useMemo(
    () => voiceSupported || voiceOutputSupported,
    [voiceOutputSupported, voiceSupported],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;

    const syncVoices = () => {
      const speechVoices = window.speechSynthesis.getVoices();
      voicesRef.current = speechVoices;
      setVoiceOutputSupported(true);

      const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
      const allCodes = uniqueVoiceLanguages([
        ...browserLanguages,
        ...speechVoices.map((voice) => voice.lang),
        ...defaultVoiceLanguages,
      ]);

      setVoiceLanguages(
        allCodes.map((code) => ({
          code,
          label: `${languageLabel(code)} (${code})`,
        })),
      );
    };

    syncVoices();
    window.speechSynthesis.onvoiceschanged = syncVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    const SpeechRecognitionCtor = (
      window as Window & {
        SpeechRecognition?: SpeechRecognitionConstructorLike;
        webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
      }
    ).SpeechRecognition
      ?? (
        window as Window & {
          SpeechRecognition?: SpeechRecognitionConstructorLike;
          webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
        }
      ).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = voiceLanguage;

    recognition.onresult = (event) => {
      let transcript = "";
      let finalTranscript = "";

      for (let i = 0; i < event.results.length; i += 1) {
        const chunk = event.results[i][0]?.transcript ?? "";
        transcript += chunk;
        if (event.results[i].isFinal) finalTranscript += chunk;
      }

      const nextText = (finalTranscript || transcript).trim();
      setInput(nextText);
      setLiveTranscript(nextText);
      scheduleVoiceStop();
    };

    recognition.onerror = () => {
      clearSilenceTimeout();
      setIsListening(false);
      toast.error("Voice input failed. Please try again.");
    };

    recognition.onend = () => {
      clearSilenceTimeout();
      setIsListening(false);
      const spoken = liveTranscriptRef.current.trim();
      if (spoken && !isSending) {
        void sendMessageRef.current(spoken);
      }
    };

    recognitionRef.current = recognition;
    setVoiceSupported(true);

    return () => {
      clearSilenceTimeout();
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [clearSilenceTimeout, isSending, scheduleVoiceStop, voiceLanguage]);

  const liveTranscriptRef = useRef("");

  useEffect(() => {
    liveTranscriptRef.current = liveTranscript;
  }, [liveTranscript]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await sendMessage(input);
  };

  const toggleVoiceInput = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      toast.error("Voice input is not supported in this browser.");
      return;
    }

    if (isListening) {
      clearSilenceTimeout();
      recognition.stop();
      return;
    }

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setInput("");
    setLiveTranscript("");
    setIsListening(true);

    try {
      recognition.start();
      scheduleVoiceStop();
      toast.success("Listening… speak your instruction.");
    } catch {
      setIsListening(false);
      clearSilenceTimeout();
      toast.error("Could not start voice input.");
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setMinimized(false); }}
        aria-label="Open assistant"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow transition-all duration-300 ease-spring hover:scale-110 hover:shadow-lg-soft animate-scale-in"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 flex w-[min(380px,calc(100vw-3rem))] flex-col rounded-2xl border border-border bg-card shadow-lg-soft animate-scale-in overflow-hidden",
        minimized ? "h-14" : "h-[min(560px,calc(100vh-3rem))]",
        "transition-[height] duration-300 ease-smooth",
      )}
    >
      <header className="flex items-center justify-between border-b border-border bg-gradient-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Assistant</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {useLiveAssistant ? "Live mode" : "Offline mode"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button 
            variant="ghost" 
            size="icon-sm" 
            onClick={() => {
              setMessages([greeting]);
              setPendingProposal(null);
              toast.success("Chat cleared");
            }} 
            aria-label="Clear chat"
            title="Clear chat"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setMinimized((m) => !m)} aria-label="Minimize">
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {!minimized && (
        <>
          {shouldShowVoiceControls && (
            <div className="border-b border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Languages className="h-3.5 w-3.5" />
                  <span>Voice language</span>
                </div>
                <Select value={voiceLanguage} onValueChange={setVoiceLanguage}>
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {voiceLanguages.map((option) => (
                      <SelectItem key={option.code} value={option.code}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setVoiceRepliesEnabled((enabled) => !enabled)}
                  aria-label={voiceRepliesEnabled ? "Mute spoken replies" : "Enable spoken replies"}
                  title={voiceRepliesEnabled ? "Mute spoken replies" : "Enable spoken replies"}
                >
                  {voiceRepliesEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 scrollbar-thin">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex animate-fade-in",
                  m.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-secondary text-secondary-foreground rounded-bl-md",
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}
          </div>

          {(isListening || liveTranscript) && (
            <div className="border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              {isListening ? `Listening… ${liveTranscript || "Speak now."}` : `Voice draft: ${liveTranscript}`}
            </div>
          )}

          <form onSubmit={send} className="flex items-center gap-2 border-t border-border p-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={voiceSupported ? "Ask anything or use the mic…" : "Ask anything…"}
              className="h-10"
              disabled={isSending}
            />
            <Button
              type="button"
              size="icon"
              variant={isListening ? "destructive" : "outline"}
              onClick={toggleVoiceInput}
              aria-label={isListening ? "Stop voice input" : "Start voice input"}
              disabled={isSending || (!voiceSupported && !isListening)}
              title={voiceSupported ? `Voice input (${voiceLanguage})` : "Voice input is not supported in this browser"}
            >
              {isListening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button type="submit" size="icon" variant="hero" disabled={isSending || !input.trim()} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </>
      )}
    </div>
  );
};
