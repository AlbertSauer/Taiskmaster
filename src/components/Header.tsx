import { ListTodo, LogOut, Settings, Trash2, UserCircle2, BarChart3, UploadCloud, Sparkles, Palette, Sun, Moon, History, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  onOptimize?: () => void;
  onNewTask?: () => void;
  onImportCalendar?: () => void;
  onDeleteCalendar?: () => void | Promise<void>;
  onShowActivityScores?: () => void;
  onShowTaskHistory?: () => void;
  onShowRoutineProfiles?: () => void;
  showActions?: boolean;
}

export const Header = ({ onOptimize, onNewTask, onImportCalendar, onDeleteCalendar, onShowActivityScores, onShowTaskHistory, onShowRoutineProfiles, showActions = true }: Props) => {
  const { pathname } = useLocation();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { logout, user, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [styleMode, setStyleMode] = useState<"blue" | "green" | "pink" | "red" | "grey">("blue");
  const [mounted, setMounted] = useState(false);
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
    const stored = localStorage.getItem("taiskmaster.style");
    const next = stored === "green" || stored === "pink" || stored === "red" || stored === "grey" ? stored : "blue";
    setStyleMode(next);

    const root = document.documentElement;
    root.classList.remove("style-blue", "style-green", "style-pink", "style-red", "style-grey");
    root.classList.add(`style-${next}`);
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

  const applyStyle = (style: "blue" | "green" | "pink" | "red" | "grey") => {
    setStyleMode(style);
    localStorage.setItem("taiskmaster.style", style);
    const root = document.documentElement;
    root.classList.remove("style-blue", "style-green", "style-pink", "style-red", "style-grey");
    root.classList.add(`style-${style}`);
  };
  const runProfileAction = (action?: () => void) => {
    if (!action) return;
    setProfileOpen(false);
    action();
  };

  const currentTheme = theme === "system" ? resolvedTheme : theme;
  const isDark = currentTheme === "dark";

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 glass">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="group flex items-center gap-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Switch section"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-sm-soft transition-transform duration-300 ease-spring group-hover:scale-105"
              >
                <ListTodo className="h-5 w-5 text-primary-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel>Switch to</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate("/")}>
                Dashboard {pathname === "/" ? "✓" : ""}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/smart-routine")}>
                Smart Routine {pathname.startsWith("/smart-routine") ? "✓" : ""}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/smart-vacation")}>
                Smart Vacation {pathname.startsWith("/smart-vacation") ? "✓" : ""}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/smart-statistics")}>
                Smart Statistics {pathname.startsWith("/smart-statistics") ? "✓" : ""}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link to="/" className="leading-tight">
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-semibold tracking-tight">Taiskmaster</p>
            </div>
            <p className="text-[11px] text-muted-foreground">Scheduling, refined</p>
          </div>
          </Link>
        </div>

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
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Interface</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => setTheme(isDark ? "light" : "dark")}
                  disabled={!mounted}
                  aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {mounted && (isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />)}
                  {!mounted ? "Theme mode" : isDark ? "Light mode" : "Dark mode"}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Palette className="mr-2 h-4 w-4" />
                    Colors
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent sideOffset={6} alignOffset={-4} className="w-44">
                    <DropdownMenuItem onSelect={() => applyStyle("blue")} aria-label="Blue style">
                      <Palette className="mr-2 h-4 w-4" />
                      Blue {styleMode === "blue" ? "✓" : ""}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => applyStyle("green")} aria-label="Green style">
                      <Palette className="mr-2 h-4 w-4" />
                      Green {styleMode === "green" ? "✓" : ""}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => applyStyle("pink")} aria-label="Pink style">
                      <Palette className="mr-2 h-4 w-4" />
                      Pink {styleMode === "pink" ? "✓" : ""}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => applyStyle("red")} aria-label="Red style">
                      <Palette className="mr-2 h-4 w-4" />
                      Red {styleMode === "red" ? "✓" : ""}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => applyStyle("grey")} aria-label="Grey style">
                      <Palette className="mr-2 h-4 w-4" />
                      Grey {styleMode === "grey" ? "✓" : ""}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
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
              <Label>Profile tools</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start"
                  onClick={() => runProfileAction(onShowActivityScores)}
                  disabled={!onShowActivityScores}
                >
                  <BarChart3 className="h-4 w-4" />
                  Activity scores
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start"
                  onClick={() => runProfileAction(onShowTaskHistory)}
                  disabled={!onShowTaskHistory}
                >
                  <History className="h-4 w-4" />
                  Task history
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start"
                  onClick={() => runProfileAction(onShowRoutineProfiles)}
                  disabled={!onShowRoutineProfiles}
                >
                  <Repeat className="h-4 w-4" />
                  Routines
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start"
                  onClick={() => runProfileAction(onImportCalendar)}
                  disabled={!onImportCalendar}
                >
                  <UploadCloud className="h-4 w-4" />
                  Import calendar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start text-destructive hover:text-destructive"
                  onClick={() => runProfileAction(handleDeleteCalendar)}
                  disabled={!onDeleteCalendar}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete calendar
                </Button>
              </div>
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
