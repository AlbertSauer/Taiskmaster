import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar as CalIcon, Clock } from "lucide-react";
import type { AssistantAction } from "./AssistantPanel";

interface PlanPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: AssistantAction | null;
  onConfirm: () => void;
}

export function PlanPreviewDialog({ open, onOpenChange, action, onConfirm }: PlanPreviewDialogProps) {
  if (!action || action.type !== "create_tasks" || !action.tasks) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Proposed Plan</DialogTitle>
          <DialogDescription>
            The assistant has prepared {action.tasks.length} tasks. Review them below before saving.
          </DialogDescription>
        </DialogHeader>
        
        <div className="max-h-[60vh] mt-4 pr-2 overflow-y-auto">
          <div className="space-y-3">
            {action.tasks.map((task, idx) => (
              <div key={idx} className="flex flex-col gap-1 rounded-lg border border-border bg-card/50 p-3 text-sm">
                <div className="font-semibold text-foreground">{task.title}</div>
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
          <Button variant="hero" onClick={() => { onConfirm(); onOpenChange(false); }}>
            Save Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
