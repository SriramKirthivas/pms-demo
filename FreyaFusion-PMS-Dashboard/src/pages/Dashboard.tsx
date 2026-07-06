import AppLayout from "@/components/AppLayout";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  Target, Star, Users, TrendingUp, CheckCircle2, Trash2, UserPlus,
  Settings as SettingsIcon, ShieldAlert, Activity as ActivityIcon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { pmGoal, pmEval, pmScore, NotFoundError } from "@/lib/pmApi";
import type { Role } from "@/lib/roles";

interface DashGoal { id: string; measure: string; period: string; part: string; weight: number; managerRating: number | null; }
interface DashActivity { action: string; actor: string; isMe: boolean; target: string; allowed: boolean; at: string; }
interface DashboardData {
  metrics: { ipf: string; goalsSet: string; selfAvg: string; engagement: string };
  goals: DashGoal[];
  activity: DashActivity[];
}

// ---- Real-service shapes (pm-goal / pm-eval / pm-score) ----
interface Assignment {
  id: string; measure: string; pillar: string; weight: number; status: string;
  employeeAcceptance: string; managerAcceptance: string;
}
interface IPFScorecard { managerFinalIPF: number | null; selfFinalIPF: number | null; }
interface FeedbackItem { id: string; category: string; text: string; from: string; date: string }

const CURRENT_FY = "FY26-27";

// pm-goal pillar -> the Dashboard's legacy "part" label bucket.
const pillarToPart: Record<string, string> = {
  TEAM_GOAL: "team",
  INDIVIDUAL_CONTRIBUTION: "contribution",
  TRAININGS_AND_CERTS: "training",
};

const partLabel: Record<string, string> = {
  team: "Team", individual: "Individual", training: "Training", contribution: "Contribution",
};

const greetingByRole: Record<Role, string> = {
  employee: "Here's your personal performance snapshot.",
  manager: "Here's how you and your team are tracking.",
  admin: "Here's the organization-wide performance overview.",
};

const engagementLabel: Record<Role, string> = {
  employee: "My Engagement",
  manager: "Team Engagement",
  admin: "Org Engagement",
};

const actionText: Record<string, string> = {
  "goal:create": "created goal",
  "goal:delete": "deleted goal",
  "member:invite": "invited member",
  "team:update": "updated team config",
  "people:update": "updated talent rating for",
  "people:read": "viewed talent",
  "team:read": "viewed team",
  "audit:read": "viewed audit log",
};

function activityIcon(action: string, allowed: boolean) {
  if (!allowed) return { Icon: ShieldAlert, color: "text-red-500", bg: "bg-red-50" };
  if (action === "goal:create") return { Icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" };
  if (action === "goal:delete") return { Icon: Trash2, color: "text-red-500", bg: "bg-red-50" };
  if (action === "member:invite") return { Icon: UserPlus, color: "text-[#0052cc]", bg: "bg-blue-50" };
  if (action === "team:update") return { Icon: SettingsIcon, color: "text-amber-600", bg: "bg-amber-50" };
  return { Icon: ActivityIcon, color: "text-gray-500", bg: "bg-gray-100" };
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Dashboard() {
  const { user, role } = useAuth();
  const firstName = user.name.split(" ")[0];
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const employeeId = user.name;

    Promise.allSettled([
      pmScore.get<IPFScorecard>(`/scorecards?employeeId=${encodeURIComponent(employeeId)}&fiscalYear=${encodeURIComponent(CURRENT_FY)}`),
      pmGoal.get<Assignment[]>(`/assignments?employeeId=${encodeURIComponent(employeeId)}&fiscalYear=${encodeURIComponent(CURRENT_FY)}`),
      pmEval.get<FeedbackItem[]>("/feedback/mine"),
    ]).then(([scoreRes, goalsRes, feedbackRes]) => {
      if (cancelled) return;

      // Personal IPF — gracefully render "not available" instead of failing the
      // whole screen when the scorecard hasn't been computed yet (404) or the
      // pm-score call fails for any other reason.
      if (scoreRes.status === "rejected" && !(scoreRes.reason instanceof NotFoundError)) {
        toast.error("Could not load your IPF", { description: (scoreRes.reason as Error).message });
      }
      const scorecard = scoreRes.status === "fulfilled" ? scoreRes.value : null;
      const ipf = scorecard?.managerFinalIPF != null ? scorecard.managerFinalIPF.toFixed(2) : "—";

      // Active/pending goals with acceptance + rating status.
      const assignments = goalsRes.status === "fulfilled" ? goalsRes.value : [];
      const goals: DashGoal[] = assignments.map((a) => ({
        id: a.id,
        measure: a.measure,
        period: CURRENT_FY,
        part: pillarToPart[a.pillar] ?? a.pillar.toLowerCase(),
        weight: a.weight,
        managerRating: null, // ratings live in pm-eval per-assignment history; not fetched in this summary
      }));
      const goalsSet = String(assignments.length);

      // Engagement summary — feedback authored by / about the current user.
      const feedback = feedbackRes.status === "fulfilled" ? feedbackRes.value : [];
      const engagement = feedbackRes.status === "fulfilled" ? String(feedback.length) : "—";

      setData({
        metrics: { ipf, goalsSet, selfAvg: "—", engagement },
        goals,
        activity: [],
      });
    });

    return () => { cancelled = true; };
  }, [user.name]);

  const metricCards = [
    { key: "ipf" as const, label: "Final IPF (Manager)", sub: "out of 5.0", icon: Star, color: "#0052cc" },
    { key: "goalsSet" as const, label: "Goals Set", sub: "this FY", icon: Target, color: "#16a34a" },
    { key: "selfAvg" as const, label: "Avg Self Rating", sub: "out of 5.0", icon: TrendingUp, color: "#ca8a04" },
    { key: "engagement" as const, label: engagementLabel[role], sub: "pulse survey", icon: Users, color: "#7c3aed" },
  ];

  const goals = data?.goals ?? [];
  const activity = data?.activity ?? [];

  return (
    <AppLayout pageTitle="Dashboard" breadcrumb="Overview">
      {/* Greeting */}
      <div className="mb-5">
        <h2 className="text-[18px] font-bold text-[#0f1b3d]">Welcome back, {firstName}</h2>
        <p className="text-[13px] text-gray-500">{greetingByRole[role]}</p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {metricCards.map((m) => (
          <div key={m.label} className="ff-card ff-card-hover p-4">
            <div className="flex items-start justify-between mb-3">
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">{m.label}</p>
              <div
                className="w-9 h-9 rounded-[9px] flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: m.color + "14" }}
              >
                <m.icon size={16} style={{ color: m.color }} />
              </div>
            </div>
            <p className="text-[24px] font-bold text-[#0f1b3d] leading-none mb-1.5 tracking-tight">
              {data ? data.metrics[m.key] : "—"}
            </p>
            <span className="text-[11px] text-gray-400">{m.sub}</span>
          </div>
        ))}
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* My Goals — left col (wider) */}
        <div className="lg:col-span-3 ff-card">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e5e7eb]">
            <h2 className="text-[13px] font-semibold text-[#0f1b3d]">{role === "employee" ? "My Goals" : "Goals"}</h2>
            <Link to="/goals" className="text-[11px] text-[#0052cc] font-medium cursor-pointer hover:underline">View all</Link>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[1fr_110px_50px_60px] gap-2 px-5 py-2 border-b border-[#e5e7eb]">
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Goal Measure</p>
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Section</p>
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider text-center">Wt</p>
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider text-right">Mgr</p>
          </div>

          {goals.length === 0 ? (
            <div className="px-5 py-10 text-center text-[12px] text-gray-400">No goals to show.</div>
          ) : (
            <ul className="divide-y divide-[#f3f4f6]">
              {goals.map((g) => (
                <li key={g.id} className="grid grid-cols-[1fr_110px_50px_60px] gap-2 px-5 py-3 items-center table-row-hover">
                  <p className="text-[13px] font-medium text-[#0f1b3d] leading-snug truncate pr-2">{g.measure}</p>
                  <span className="text-[11px] text-gray-500">{g.period} · {partLabel[g.part] ?? g.part}</span>
                  <span className="text-[12px] font-semibold text-[#0f1b3d] text-center">{g.weight}</span>
                  <span className="text-[12px] font-semibold text-[#0052cc] text-right">{g.managerRating != null ? g.managerRating.toFixed(2) : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Activity Feed — right col (from the audit log) */}
        <div className="lg:col-span-2 ff-card flex flex-col">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e5e7eb] flex-shrink-0">
            <h2 className="text-[13px] font-semibold text-[#0f1b3d]">Activity Feed</h2>
            <button onClick={() => toast.success("All activity marked as read")} className="text-[11px] text-[#0052cc] font-medium cursor-pointer hover:underline">Mark all read</button>
          </div>

          {activity.length === 0 ? (
            <div className="px-5 py-10 text-center text-[12px] text-gray-400 flex-1">
              No recent activity yet.<br />Actions you take (creating goals, inviting members…) appear here.
            </div>
          ) : (
            <ul className="divide-y divide-[#f3f4f6] flex-1 overflow-y-auto">
              {activity.map((a, i) => {
                const { Icon, color, bg } = activityIcon(a.action, a.allowed);
                return (
                  <li key={i} className="flex gap-3 px-5 py-3.5 table-row-hover">
                    <div className="flex-shrink-0 mt-0.5">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center ${bg}`}>
                        <Icon size={13} className={color} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-[#0f1b3d] leading-snug">
                        <span className="font-semibold">{a.isMe ? "You" : a.actor}</span>
                        {" "}{a.allowed ? "" : "were denied: "}{actionText[a.action] ?? a.action}
                        {a.target && a.target !== "-" && (
                          <> {" "}<span className="font-medium text-[#0052cc]">{a.target}</span></>
                        )}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(a.at)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
