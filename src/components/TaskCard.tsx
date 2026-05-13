import { Calendar, Clock, MapPin, Trash2, Check } from "lucide-react";
import type { Task } from "@/types/task";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, parseISO, isToday, isTomorrow, isPast } from "date-fns";

interface Props {
  task: Task;
  onEdit: (t: Task) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}

const priorityStyles: Record<Task["priority"], string> = {
  "very-low": "bg-priority-very-low/10 text-priority-very-low border-priority-very-low/20",
  low: "bg-priority-low/10 text-priority-low border-priority-low/20",
  medium: "bg-priority-medium/10 text-priority-medium border-priority-medium/20",
  high: "bg-priority-high/10 text-priority-high border-priority-high/20",
  urgent: "bg-priority-urgent/10 text-priority-urgent border-priority-urgent/20",
};

const priorityDot: Record<Task["priority"], string> = {
  "very-low": "bg-priority-very-low",
  low: "bg-priority-low",
  medium: "bg-priority-medium",
  high: "bg-priority-high",
  urgent: "bg-priority-urgent",
};

const priorityLabel: Record<Task["priority"], string> = {
  "very-low": "Very low",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const formatDate = (iso: string) => {
  const d = parseISO(iso);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEE, MMM d");
};

const formatTimeRange = (time?: string, duration?: number) => {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const length = typeof duration === "number" ? Math.max(15, duration) : 60;
  const endTotal = (h * 60 + m + length) % (24 * 60);
  const eh = Math.floor(endTotal / 60).toString().padStart(2, "0");
  const em = (endTotal % 60).toString().padStart(2, "0");
  return `${time} - ${eh}:${em}`;
};

export const TaskCard = ({ task, onEdit, onDelete, onToggle }: Props) => {
  const overdue = !task.completed && isPast(parseISO(task.date + "T23:59")) && !isToday(parseISO(task.date));
  const timeRange = formatTimeRange(task.time, task.duration);

  return (
    <div
      onClick={() => onEdit(task)}
      className={cn(
        "group relative cursor-pointer rounded-lg border border-border bg-card p-5 shadow-xs",
        "transition-all duration-300 ease-smooth hover:shadow-md-soft hover:-translate-y-0.5 hover:border-primary/20",
        task.completed && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(task.id);
          }}
          aria-label={task.completed ? "Mark as not done" : "Mark as done"}
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200",
            task.completed
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border hover:border-primary",
          )}
        >
          {task.completed && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn(
              "text-[15px] font-semibold leading-tight text-foreground",
              task.completed && "line-through",
            )}>
              {task.title}
            </h3>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(task.id);
                }}
                className="text-destructive hover:text-destructive"
                aria-label="Delete task"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {task.description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {task.description}
            </p>
          )}

          {task.note && (
            <p className="mt-2 line-clamp-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              Note: {task.note}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className={cn("inline-flex items-center gap-1.5", overdue && "text-destructive font-medium")}>
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(task.date)}
            </span>
            {timeRange && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {timeRange}
              </span>
            )}
            {typeof task.duration === "number" && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {task.duration} min
              </span>
            )}
            {task.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {task.location}
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={cn("gap-1.5 font-medium", priorityStyles[task.priority])}>
              <span className={cn("h-1.5 w-1.5 rounded-full", priorityDot[task.priority])} />
              {priorityLabel[task.priority]}
            </Badge>
            {task.tags?.map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal text-muted-foreground">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
