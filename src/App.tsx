import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import Login from "./pages/Login.tsx";
import Register from "./pages/Register.tsx";
import Index from "./pages/Index.tsx";
import SmartStatistics from "./pages/SmartStatistics.tsx";
import SmartRoutine from "./pages/SmartRoutine.tsx";
import SmartVacation from "./pages/SmartVacation.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <AppErrorBoundary>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/" element={<ProtectedRoute element={<Index />} />} />
                <Route path="/smart-routine" element={<ProtectedRoute element={<SmartRoutine />} />} />
                <Route path="/smart-vacation" element={<ProtectedRoute element={<SmartVacation />} />} />
                <Route path="/smart-statistics" element={<ProtectedRoute element={<SmartStatistics />} />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </AppErrorBoundary>
);

export default App;
