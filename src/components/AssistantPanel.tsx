import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Send, Sparkles, X, Minus, Mic, Square, Volume2, VolumeX, Languages } from "lucide-react";
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
import { useTasks, optimizeSchedule } from "@/lib/taskStore";
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
  date: string;
  time?: string;
  duration?: number;
  location?: string;
  priority?: Task["priority"];
  tags?: string[];
  completed?: boolean;
}

interface AssistantAction {
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
    "Hi, I'm your scheduling coach. I’ll help you plan clearly, stay motivated, and keep your day feeling manageable.\n• \"What's on for today?\"\n• \"Add: Call dentist tomorrow at 3pm\"\n• \"Optimize my schedule\"",
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

const extractTaskTitle = (text: string) => {
  const cleaned = text
    .replace(/\b(today|tomorrow)\b/gi, "")
    .replace(/\bin\s+\d+\s+days?\b/gi, "")
    .replace(/\b\d+\s+days?\s+from\s+(?:now|today)\b/gi, "")
    .replace(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)?/i, "")
    .replace(/\bfor\b/gi, "")
    .replace(/\bthat\b/gi, "")
    .replace(/\s+at\s+$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "New task";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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

const runLocalFallbackAssistant = async (
  input: string,
  ctx: ReturnType<typeof useTasks>,
): Promise<AssistantResult> => {
  const text = input.trim().toLowerCase();
  const { tasks, addTask, replaceAll } = ctx;

  if (!text) return { reply: "Tell me what you'd like to do." };

  if (text.includes("optimize") || text.includes("reorganize")) {
    await replaceAll(optimizeSchedule(tasks));
    return { reply: "Nice work. I reorganized your schedule by priority and location so the day should feel smoother and easier to follow." };
  }

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
    await addTask({
      title,
      date,
      time,
      priority: /urgent|asap|high/i.test(cleaned) ? "high" : "medium",
    });
    return { reply: `Done. I added "${title}" for ${date}${time ? ` at ${time}` : ""}. You’re building a solid plan.` };
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
    const high = tasks.filter((t) => t.priority === "high" && !t.completed);
    if (high.length === 0) return { reply: "You don’t have any high-priority items right now, which is a great place to be." };
    return { reply: "Here are your high-priority items:\n" + high.map((t) => `• ${t.title} — ${t.date}`).join("\n") };
  }

  if (text.includes("help") || text.includes("?")) {
    return { reply: "I can help you stay organized and keep momentum:\n• Review what's on (\"What's on today?\")\n• Add tasks (\"Add: Coffee with Alex tomorrow at 9am\")\n• Optimize your schedule (\"Optimize my day\")" };
  }

  return { reply: "I’m not fully sure what you want to change yet. Tell me the task or plan, plus the day, time, or place if you know them, and I’ll sort it out with you." };
};

const runAssistant = async (
  input: string,
  ctx: ReturnType<typeof useTasks>,
  authToken: string | null,
  messages: Message[],
): Promise<AssistantResult> => {
  const { tasks } = ctx;

  if (!input.trim()) return { reply: "Tell me what you'd like to do." };

  if (useLiveAssistant && authToken) {
    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          input,
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
) => {
  const { addTask, replaceAll } = ctx;

  for (const action of actions) {
    if (action.type === "create_task" && action.task) {
      await addTask({
        title: action.task.title,
        description: action.task.description,
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
      await replaceAll(optimizeSchedule(ctx.tasks));
    }
  }
};

export const AssistantPanel = () => {
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
        await applyAssistantActions(pendingProposal.actions, taskCtx);
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
      const { reply: assistantText, actions } = await runAssistant(effectiveInput, taskCtx, token, currentMessages);

      if (actions?.length) {
        const summary = summarizeActions(actions, taskCtx.tasks);
        const reply: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: summary,
        };
        setPendingProposal({ actions, summary });
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
        className="fixed bottom-6 left-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow transition-all duration-300 ease-spring hover:scale-110 hover:shadow-lg-soft animate-scale-in"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed bottom-6 left-6 z-50 flex w-[min(380px,calc(100vw-3rem))] flex-col rounded-2xl border border-border bg-card shadow-lg-soft animate-scale-in overflow-hidden",
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
