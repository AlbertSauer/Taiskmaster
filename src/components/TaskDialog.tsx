import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatLocalDate, formatLocalTime } from "@/lib/dateTime";
import type { Task, Priority } from "@/types/task";

type TaskDraft = Partial<Pick<Task, "id" | "createdAt">> & Omit<Task, "id" | "createdAt">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: TaskDraft | null;
  onSubmit: (data: Omit<Task, "id" | "createdAt"> & { id?: string }) => void | Promise<void>;
}

const emptyForm = () => {
  const now = new Date();

  return {
    title: "",
    description: "",
    note: "",
    date: formatLocalDate(now),
    time: formatLocalTime(now),
    duration: "",
    location: "",
    priority: "medium" as Priority,
    tags: "",
  };
};

export const TaskDialog = ({ open, onOpenChange, initial, onSubmit }: Props) => {
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const isExistingTask = Boolean(initial?.id);

  useEffect(() => {
    if (open) {
      if (initial) {
        setForm({
          title: initial.title ?? "",
          description: initial.description ?? "",
          note: initial.note ?? "",
          date: initial.date || formatLocalDate(new Date()),
          time: initial.time ?? "",
          duration: initial.duration?.toString() ?? "",
          location: initial.location ?? "",
          priority: initial.priority ?? "medium",
          tags: (initial.tags ?? []).join(", "),
        });
      } else {
        setForm(emptyForm());
      }
    }
  }, [open, initial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || isSaving) return;

    try {
      setIsSaving(true);
      await onSubmit({
        id: isExistingTask ? initial?.id : undefined,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        note: form.note.trim() || undefined,
        date: form.date,
        time: form.time || undefined,
        duration: form.duration ? Number(form.duration) : undefined,
        location: form.location.trim() || undefined,
        priority: form.priority,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        completed: initial?.completed ?? false,
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-xl">{isExistingTask ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {isExistingTask ? "Update the details below." : "Capture what needs to happen."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="What needs to happen?"
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Add more context (optional)"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note</Label>
            <Textarea
              id="note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Private note or extra task details (optional)"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Time</Label>
              <Input
                id="time"
                type="time"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Office"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Duration</Label>
              <Input
                id="duration"
                type="number"
                min={0}
                step={15}
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
                placeholder="Minutes"
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as Priority })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="very-low">Very low</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="comma, separated, tags"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="hero" disabled={isSaving}>
              {isSaving ? "Saving..." : isExistingTask ? "Save changes" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
