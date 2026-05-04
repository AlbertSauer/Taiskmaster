import { Sparkles, ListTodo, Moon, Sun, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  onOptimize?: () => void;
  onNewTask?: () => void;
  onRecommend?: () => void;
  showActions?: boolean;
}

export const Header = ({ onOptimize, onNewTask, onRecommend, showActions = true }: Props) => {
  const { pathname } = useLocation();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState("");

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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className="hidden sm:inline-flex"
            >
              {mounted && (isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />)}
            </Button>
            <Button variant="outline" size="sm" onClick={onOptimize} className="hidden sm:inline-flex">
              <Sparkles className="h-4 w-4" />
              Optimize
            </Button>
            <Button variant="outline" size="sm" onClick={onRecommend} className="hidden lg:inline-flex">
              <Sparkles className="h-4 w-4" />
              Recommend
            </Button>
            <Button variant="hero" size="sm" onClick={onNewTask}>
              New task
            </Button>
            {user && (
              <Button variant="outline" size="sm" onClick={handleLogout} title={`Logged in as ${user.username}`}>
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
