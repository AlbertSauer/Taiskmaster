import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseGoogleCalendarICS, ImportedTask } from "@/lib/googleCalendar";
import { toast } from "sonner";
import { Search } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (tasks: ImportedTask[]) => void;
}

export const GoogleCalendarImportDialog = ({ open, onOpenChange, onImport }: Props) => {
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [eventQuery, setEventQuery] = useState("");

  const parsedEvents = useMemo(() => {
    if (!source.trim()) return [];
    try {
      return parseGoogleCalendarICS(source);
    } catch {
      return [];
    }
  }, [source]);

  const filteredEvents = useMemo(() => {
    const query = eventQuery.trim().toLowerCase();
    if (!query) return parsedEvents;
    return parsedEvents.filter((event) => {
      const haystack = [
        event.title,
        event.description,
        event.date,
        event.time,
        event.duration,
        event.location,
        event.priority,
        ...(event.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return query.split(/\s+/).filter(Boolean).every((part) => haystack.includes(part));
    });
  }, [eventQuery, parsedEvents]);

  const handleImport = () => {
    try {
      const imported = parseGoogleCalendarICS(source);
      if (!imported.length) {
        toast.error("No events found in the calendar file.");
        return;
      }
      onImport(imported);
      setSource("");
      setFileName("");
      setEventQuery("");
      onOpenChange(false);
    } catch {
      toast.error("Could not parse the calendar file. Try exporting a fresh .ics file.");
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setEventQuery("");
    const text = await file.text();
    setSource(text);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Import Google Calendar</DialogTitle>
          <DialogDescription>
            Paste a Google Calendar .ics export or upload the file to turn events into tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="calendar-file">Calendar file</Label>
            <Input id="calendar-file" type="file" accept=".ics" onChange={handleFileChange} />
            {fileName && <p className="text-sm text-muted-foreground">Loaded: {fileName}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="calendar-source">Or paste ICS content</Label>
            <Textarea
              id="calendar-source"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setEventQuery("");
              }}
              placeholder="BEGIN:VCALENDAR\n..."
              rows={8}
            />
          </div>

          {source.trim() && (
            <div className="space-y-3 rounded-lg border border-border bg-background/60 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={eventQuery}
                  onChange={(event) => setEventQuery(event.target.value)}
                  placeholder="Search uploaded events by title, date, time, location..."
                  className="pl-9"
                />
              </div>
              {parsedEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events found in this calendar yet.</p>
              ) : filteredEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No uploaded events match your search.</p>
              ) : (
                <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                  {filteredEvents.slice(0, 30).map((event, index) => (
                    <div key={`${event.title}-${event.date}-${event.time}-${index}`} className="rounded-md border border-border bg-card px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">{event.title}</p>
                        <p className="shrink-0 text-xs text-muted-foreground">{event.date}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event.time ? `${event.time} · ` : ""}
                        {event.duration ? `${event.duration} min` : "All day"}
                        {event.location ? ` · ${event.location}` : ""}
                      </p>
                    </div>
                  ))}
                  {filteredEvents.length > 30 && (
                    <p className="text-xs text-muted-foreground">Showing 30 of {filteredEvents.length} matching events.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
            Pro tip: in Google Calendar, go to Settings &gt; Import &amp; export, export a calendar, then upload the .ics file here.
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="hero" onClick={handleImport} disabled={!source.trim()}>
            Import events
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
