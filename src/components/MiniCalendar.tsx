import { useMemo, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import type { Task } from "@/types/task";
import { format, parseISO, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";

interface Props {
  tasks: Task[];
  selected?: Date;
  onSelect: (d: Date | undefined) => void;
}

export const MiniCalendar = ({ tasks, selected, onSelect }: Props) => {
  const [month, setMonth] = useState<Date>(selected ?? new Date());

  const taskDates = useMemo(
    () => tasks.map((t) => parseISO(t.date)),
    [tasks],
  );

  const dayTasks = selected
    ? tasks.filter((t) => isSameDay(parseISO(t.date), selected))
    : [];

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold">Calendar</h3>
        <span className="text-xs text-muted-foreground">{format(month, "MMM yyyy")}</span>
      </div>
      <Calendar
        mode="single"
        selected={selected}
        onSelect={onSelect}
        month={month}
        onMonthChange={setMonth}
        className={cn("p-0 pointer-events-auto")}
        modifiers={{ hasTask: taskDates }}
        modifiersClassNames={{
          hasTask: "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-1 after:w-1 after:rounded-full after:bg-primary",
        }}
      />

      {selected && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {format(selected, "EEEE, MMM d")} · {dayTasks.length} task{dayTasks.length === 1 ? "" : "s"}
          </p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto scrollbar-thin">
            {dayTasks.length === 0 && (
              <p className="text-xs text-muted-foreground">Nothing scheduled.</p>
            )}
            {dayTasks.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs">
                <span className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  t.priority === "urgent" && "bg-priority-urgent",
                  t.priority === "high" && "bg-priority-high",
                  t.priority === "medium" && "bg-priority-medium",
                  t.priority === "low" && "bg-priority-low",
                  t.priority === "very-low" && "bg-priority-very-low",
                )} />
                <span className="truncate text-foreground/80">{t.title}</span>
                {t.time && <span className="ml-auto text-muted-foreground">{t.time}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
