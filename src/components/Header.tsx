import { ListTodo, Moon, Sun, LogOut, Settings, Trash2, UserCircle2, CheckCircle2, BarChart3, UploadCloud, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  onOptimize?: () => void;
  onNewTask?: () => void;
  onImportCalendar?: () => void;
  onDeleteCalendar?: () => void | Promise<void>;
  onShowCompletedTasks?: () => void;
  onShowActivityScores?: () => void;
  showActions?: boolean;
}

export const Header = ({ onOptimize, onNewTask, onImportCalendar, onDeleteCalendar, onShowCompletedTasks, onShowActivityScores, showActions = true }: Props) => {
  const { pathname } = useLocation();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { logout, user, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileForm, setProfileForm] = useState({
    email: "",
    username: "",
    full_name: "",
    password: "",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    const syncTime = () => setCurrentTime(formatter.format(new Date()));
    syncTime();

    const interval = window.setInterval(syncTime, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleDeleteCalendar = async () => {
    if (!onDeleteCalendar) return;
    const confirmed = window.confirm("Delete your complete calendar? This removes every task and cannot be undone.");
    if (!confirmed) return;
    await onDeleteCalendar();
  };

  const handleOpenProfile = () => {
    setProfileForm({
      email: user?.email || "",
      username: user?.username || "",
      full_name: user?.full_name || "",
      password: "",
    });
    setProfileOpen(true);
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    try {
      setProfileSaving(true);
      await updateProfile({
        email: profileForm.email.trim(),
        username: profileForm.username.trim(),
        full_name: profileForm.full_name.trim(),
        ...(profileForm.password.trim() ? { password: profileForm.password.trim() } : {}),
      });
      toast.success("Profile updated");
      setProfileOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update profile");
    } finally {
      setProfileSaving(false);
    }
  };

  const currentTheme = theme === "system" ? resolvedTheme : theme;
  const isDark = currentTheme === "dark";

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 glass">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link to="/" className="group flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-sm-soft transition-transform duration-300 ease-spring group-hover:scale-105">
            <ListTodo className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-semibold tracking-tight">Taiskmaster</p>
              {currentTime && (
                <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {currentTime}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">Scheduling, refined</p>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <Link
            to="/"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              pathname === "/"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            Dashboard
          </Link>
          <Link
            to="/smart-routine"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              pathname.startsWith("/smart-routine")
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            Smart Routine
          </Link>
          <Link
            to="/smart-vacation"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              pathname.startsWith("/smart-vacation")
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            Smart Vacation
          </Link>
          <Link
            to="/smart-statistics"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              pathname.startsWith("/smart-statistics")
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            Smart Statistics
          </Link>
        </nav>

        {showActions && (
          <div className="flex items-center gap-2">
            {onOptimize && (
              <Button variant="outline" size="sm" onClick={onOptimize} className="hidden lg:inline-flex">
                <Sparkles className="h-4 w-4" />
                Optimize
              </Button>
            )}
            <Button variant="hero" size="sm" onClick={onNewTask}>
              New task
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Options">
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Options</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleOpenProfile} disabled={!user}>
                  <UserCircle2 className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setTheme(isDark ? "light" : "dark")}
                  disabled={!mounted}
                  aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {mounted && (isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />)}
                  {!mounted ? "Theme" : isDark ? "Light mode" : "Dark mode"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onShowCompletedTasks} disabled={!onShowCompletedTasks}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Done tasks
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onShowActivityScores} disabled={!onShowActivityScores}>
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Activity Scores
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onImportCalendar} disabled={!onImportCalendar}>
                  <UploadCloud className="mr-2 h-4 w-4" />
                  Import calendar
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={handleDeleteCalendar}
                  disabled={!onDeleteCalendar}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete complete calendar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={handleLogout}
                  className="text-destructive focus:text-destructive"
                  disabled={!user}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>View and update your account information.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm((current) => ({ ...current, email: e.target.value }))}
                disabled={profileSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-username">Username</Label>
              <Input
                id="profile-username"
                value={profileForm.username}
                onChange={(e) => setProfileForm((current) => ({ ...current, username: e.target.value }))}
                disabled={profileSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-full-name">Full name</Label>
              <Input
                id="profile-full-name"
                value={profileForm.full_name}
                onChange={(e) => setProfileForm((current) => ({ ...current, full_name: e.target.value }))}
                disabled={profileSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-password">New password</Label>
              <Input
                id="profile-password"
                type="password"
                value={profileForm.password}
                onChange={(e) => setProfileForm((current) => ({ ...current, password: e.target.value }))}
                placeholder="Leave empty to keep current password"
                disabled={profileSaving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setProfileOpen(false)} disabled={profileSaving}>Cancel</Button>
            <Button variant="hero" onClick={handleSaveProfile} disabled={profileSaving}>
              {profileSaving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
};
