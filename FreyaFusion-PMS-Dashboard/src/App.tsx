import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { canAccess } from "@/lib/roles";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Scorecard from "./pages/Scorecard";
import Goals from "./pages/Goals";
import Team from "./pages/Team";
import Summary from "./pages/Summary";
import CompanyGoals from "./pages/CompanyGoals";
import FeedbackPage from "./pages/Feedback";
import Talent from "./pages/Talent";
import Competencies from "./pages/Competencies";
import Settings from "./pages/Settings";
import Config from "./pages/Config";
import Profile from "./pages/Profile";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Requires sign-in, then blocks direct URL access to routes the role can't see.
function RoleGuard({ children }: { children: ReactNode }) {
  const { role, authed } = useAuth();
  const { pathname } = useLocation();
  if (!authed) {
    return <Navigate to="/login" replace />;
  }
  if (!canAccess(pathname, role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<RoleGuard><Dashboard /></RoleGuard>} />
            <Route path="/scorecard" element={<RoleGuard><Scorecard /></RoleGuard>} />
            <Route path="/goals" element={<RoleGuard><Goals /></RoleGuard>} />
            <Route path="/team" element={<RoleGuard><Team /></RoleGuard>} />
            <Route path="/summary" element={<RoleGuard><Summary /></RoleGuard>} />
            <Route path="/company-goals" element={<RoleGuard><CompanyGoals /></RoleGuard>} />
            <Route path="/feedback" element={<RoleGuard><FeedbackPage /></RoleGuard>} />
            <Route path="/talent" element={<RoleGuard><Talent /></RoleGuard>} />
            <Route path="/competencies" element={<RoleGuard><Competencies /></RoleGuard>} />
            {/* Development merged into the Talent matrix — redirect old links */}
            <Route path="/development" element={<Navigate to="/talent" replace />} />
            <Route path="/settings" element={<RoleGuard><Settings /></RoleGuard>} />
            <Route path="/config" element={<RoleGuard><Config /></RoleGuard>} />
            <Route path="/profile" element={<RoleGuard><Profile /></RoleGuard>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
