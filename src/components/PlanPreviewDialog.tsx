import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar as CalIcon, Clock, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { AssistantAction } from "./AssistantPanel";
import type { Task } from "@/types/task";

interface PlanPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: AssistantAction | null;
  onConfirm: (tasks: Omit<Task, "id" | "createdAt">[]) => void;
}

export function PlanPreviewDialog({ open, onOpenChange, action, onConfirm }: PlanPreviewDialogProps) {
  const sourceTasks = useMemo(
    () => (action && action.type === "create_tasks" && action.tasks ? action.tasks : []),
    [action],
  );
  const [draftTasks, setDraftTasks] = useState(sourceTasks.map((task) => ({
    title: task.title || "New Task",
    description: task.description || undefined,
    note: task.note || undefined,
    date: task.date || new Date().toISOString().split("T")[0],
    time: task.time || undefined,
    duration: task.duration || undefined,
    location: task.location || undefined,
    priority: task.priority || "medium",
    tags: Array.isArray(task.tags) ? task.tags : [],
    completed: !!task.completed,
  })));

  useEffect(() => {
    if (!open) return;
    setDraftTasks(sourceTasks.map((task) => ({
      title: task.title || "New Task",
      description: task.description || undefined,
      note: task.note || undefined,
      date: task.date || new Date().toISOString().split("T")[0],
      time: task.time || undefined,
      duration: task.duration || undefined,
      location: task.location || undefined,
      priority: task.priority || "medium",
      tags: Array.isArray(task.tags) ? task.tags : [],
      completed: !!task.completed,
    })));
  }, [open, sourceTasks]);

  if (!action || action.type !== "create_tasks" || !action.tasks) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Proposed Plan</DialogTitle>
          <DialogDescription>
            The assistant has prepared {draftTasks.length} tasks. Review and edit them before saving.
          </DialogDescription>
        </DialogHeader>
        
        <div className="max-h-[60vh] mt-4 pr-2 overflow-y-auto">
          <div className="space-y-3">
            {draftTasks.map((task, idx) => (
              <div key={idx} className="flex flex-col gap-1 rounded-lg border border-border bg-card/50 p-3 text-sm">
                <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_130px_110px_90px_40px]">
                  <Input
                    value={task.title}
                    onChange={(e) => setDraftTasks((current) => current.map((item, i) => i === idx ? { ...item, title: e.target.value } : item))}
                  />
                  <Input
                    type="date"
                    value={task.date}
                    onChange={(e) => setDraftTasks((current) => current.map((item, i) => i === idx ? { ...item, date: e.target.value } : item))}
                  />
                  <Input
                    type="time"
                    value={task.time || ""}
                    onChange={(e) => setDraftTasks((current) => current.map((item, i) => i === idx ? { ...item, time: e.target.value || undefined } : item))}
                  />
                  <Input
                    type="number"
                    min={15}
                    value={task.duration || 60}
                    onChange={(e) => setDraftTasks((current) => current.map((item, i) => i === idx ? { ...item, duration: Number(e.target.value || 60) } : item))}
                  />
                  <Button variant="ghost" size="icon-sm" onClick={() => setDraftTasks((current) => current.filter((_, i) => i !== idx))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-4 text-muted-foreground mt-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <CalIcon className="h-3.5 w-3.5" />
                    {task.date}
                  </div>
                  {task.time && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {task.time} {task.duration ? `(${task.duration}m)` : ""}
                    </div>
                  )}
                </div>
                {task.location && <div className="text-muted-foreground text-xs mt-2 font-medium">📍 {task.location}</div>}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="hero" onClick={() => { onConfirm(draftTasks); onOpenChange(false); }}>
            Save Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
