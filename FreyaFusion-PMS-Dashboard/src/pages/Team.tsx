import AppLayout from "@/components/AppLayout";
import { useCallback, useEffect, useState } from "react";
import {
  Users, ChevronDown, ChevronRight, Target, Award, CheckCircle2,
  Clock, Lock, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { pmGoal, pmScore, NotFoundError } from "@/lib/pmApi";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// A manager's team view: reports grouped by person (not the flat, mixed
// assignment list on the Goals page). Each report rolls up their goal
// assignments + IPF band so a manager sees the whole team's cycle state at a
// glance, then drills into any one report. Data comes straight from the real
// services — pm-goal (/people, /assignments) and pm-score (/scorecards).

interface Person { id: string; role: string; title: string; department: string; managerId: string; }
interface Assignment {
  id: string; goalId: string; fiscalYear: string; ownerId: string; setterId: string; reviewerId: string;
  pillar: string; goalType: string; measure: string; criteria: string; weight: number;
  status: string; employeeAcceptance: string; managerAcceptance: string; isActive: boolean;
}
interface IPFScorecardRsp {
  managerFinalIPF?: number | null;
  bandManager?: string | null;
  state?: string;
}
// Per-report rollup assembled client-side from the calls above.
interface ReportRollup {
  person: Person;
  assignments: Assignment[];
  ipf: number | null;
  band: string | null;
  scorecardState: string | null;
}

const FISCAL_YEARS = ["FY24-25", "FY25-26", "FY26-27", "FY27-28", "FY28-29", "FY29-30"];

const PILLAR_LABEL: Record<string, string> = {
  TEAM_GOAL: "Team Goal",
  INDIVIDUAL_CONTRIBUTION: "Individual Contribution",
  TRAININGS_AND_CERTS: "Trainings & Certs",
};

const STATUS_STYLE: Record<string, string> = {
  PENDING_ACCEPTANCE: "bg-amber-100 text-amber-700",
  CHANGE_REQUESTED: "bg-purple-100 text-purple-700",
  ACTIVE: "bg-green-100 text-green-700",
  COMPLETION_REQUESTED: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-teal-100 text-teal-700",
  LOCKED: "bg-gray-200 text-gray-600",
  CLOSED: "bg-gray-100 text-gray-500",
};

const bandColor = (label: string | null) =>
  !label ? "bg-gray-100 text-gray-400"
  : label === "Exceptional" ? "bg-green-100 text-green-700"
  : label === "Exceeds Expectations" ? "bg-[#e6eefa] text-[#0052cc]"
  : label === "Meets Expectations" ? "bg-amber-100 text-amber-700"
  : label === "Needs Improvement" ? "bg-orange-100 text-orange-700"
  : "bg-red-100 text-red-700";

const acceptColor = (s: string) =>
  s === "ACCEPTED" ? "text-green-600" : s === "REJECTED" ? "text-red-600" : "text-gray-400";

export default function Team() {
  const { user, role } = useAuth();
  const [fy, setFy] = useState("FY26-27");
  const [rollups, setRollups] = useState<ReportRollup[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (year: string) => {
    setLoading(true);
    try {
      // Default /people is "my team" for a manager, the whole directory for an
      // admin — exactly the set of people this view should cover.
      const people = await pmGoal.get<Person[]>("/people");
      const reports = people.filter((p) => p.id !== user.name);
      const built = await Promise.all(
        reports.map(async (person) => {
          const [assignments, ipf] = await Promise.all([
            pmGoal
              .get<Assignment[]>(`/assignments?employeeId=${encodeURIComponent(person.id)}`)
              .then((rows) => rows.filter((a) => a.fiscalYear === year))
              .catch(() => [] as Assignment[]),
            pmScore
              .get<IPFScorecardRsp>(
                `/scorecards?employeeId=${encodeURIComponent(person.id)}&fiscalYear=${encodeURIComponent(year)}`,
              )
              .catch((err) => {
                if (!(err instanceof NotFoundError)) console.error("scorecard load", err);
                return null;
              }),
          ]);
          return {
            person,
            assignments,
            ipf: ipf?.managerFinalIPF ?? null,
            band: ipf?.bandManager ?? null,
            scorecardState: ipf?.state ?? null,
          } as ReportRollup;
        }),
      );
      setRollups(built);
    } catch (err) {
      toast.error("Could not load team", { description: (err as Error).message });
      setRollups([]);
    } finally {
      setLoading(false);
    }
  }, [user.name]);

  useEffect(() => { load(fy); }, [fy, load]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Team-wide rollup across every report.
  const allAssignments = rollups.flatMap((r) => r.assignments);
  const countBy = (status: string) => allAssignments.filter((a) => a.status === status).length;
  const pendingCount = countBy("PENDING_ACCEPTANCE") + countBy("CHANGE_REQUESTED");
  const activeCount = countBy("ACTIVE");
  const completedCount = countBy("COMPLETED") + countBy("COMPLETION_REQUESTED");
  const lockedCount = countBy("LOCKED");
  const scored = rollups.filter((r) => r.ipf !== null);
  const avgIpf = scored.length
    ? scored.reduce((s, r) => s + (r.ipf ?? 0), 0) / scored.length
    : null;

  const summaryCards = [
    { label: "Reports", value: rollups.length, icon: Users, tint: "text-[#0052cc] bg-[#e6eefa]" },
    { label: "Pending acceptance", value: pendingCount, icon: Clock, tint: "text-amber-700 bg-amber-100" },
    { label: "Active goals", value: activeCount, icon: Target, tint: "text-green-700 bg-green-100" },
    { label: "Completed", value: completedCount, icon: CheckCircle2, tint: "text-teal-700 bg-teal-100" },
    { label: "Locked periods", value: lockedCount, icon: Lock, tint: "text-gray-600 bg-gray-200" },
    { label: "Avg IPF", value: avgIpf !== null ? avgIpf.toFixed(2) : "—", icon: Award, tint: "text-[#0052cc] bg-[#e6eefa]" },
  ];

  return (
    <AppLayout pageTitle="My Team" breadcrumb="Performance">
      {/* Controls */}
      <div className="ff-card px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
        <span className="text-[12px] font-medium text-gray-500">Fiscal year</span>
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="w-32 h-8 text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FISCAL_YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => load(fy)} disabled={loading}>
          <RefreshCw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} /> Reload
        </Button>
        <span className="ml-auto text-[11px] text-gray-400">
          {role === "admin" ? "All employees" : "Your direct reports"} · {user.name}
        </span>
      </div>

      {/* Team summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        {summaryCards.map((c) => (
          <div key={c.label} className="ff-card p-3.5 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-[9px] flex items-center justify-center flex-shrink-0 ${c.tint}`}>
              <c.icon size={17} />
            </div>
            <div className="min-w-0">
              <p className="text-[18px] font-bold text-[#16203b] leading-tight">{c.value}</p>
              <p className="text-[10.5px] text-gray-400 truncate">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Per-report rollup */}
      {loading ? (
        <div className="ff-card p-8 text-center text-[13px] text-gray-400">Loading team…</div>
      ) : rollups.length === 0 ? (
        <div className="ff-card p-8 text-center text-[13px] text-gray-400">
          No direct reports found in your directory for {fy}.
        </div>
      ) : (
        <div className="space-y-2.5">
          {rollups.map((r) => {
            const open = expanded.has(r.person.id);
            const total = r.assignments.length;
            const accepted = r.assignments.filter(
              (a) => a.status === "ACTIVE" || a.status === "COMPLETED"
              || a.status === "COMPLETION_REQUESTED" || a.status === "LOCKED",
            ).length;
            return (
              <div key={r.person.id} className="ff-card overflow-hidden">
                {/* Report header row */}
                <button
                  onClick={() => toggle(r.person.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#f8f9fa] transition-colors"
                >
                  {open ? <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
                        : <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />}
                  <div className="w-9 h-9 rounded-full bg-[#eef4fa] flex items-center justify-center text-[12px] font-bold text-[#0052cc] flex-shrink-0">
                    {r.person.id.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-[#16203b] truncate">{r.person.id}</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {r.person.title || r.person.role}{r.person.department ? ` · ${r.person.department}` : ""}
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 text-[11px] text-gray-500">
                    <span className="px-2 py-0.5 rounded-full bg-gray-100">{total} goal{total === 1 ? "" : "s"}</span>
                    <span className="px-2 py-0.5 rounded-full bg-gray-100">{accepted}/{total} accepted</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${bandColor(r.band)}`}>
                      {r.ipf !== null ? `IPF ${r.ipf.toFixed(2)}` : "IPF —"}
                    </span>
                  </div>
                </button>

                {/* Expanded: this report's assignments */}
                {open && (
                  <div className="border-t border-[#f0f1f4] px-4 py-3 bg-[#fcfcfd]">
                    {r.band && (
                      <p className="text-[11.5px] text-gray-500 mb-2">
                        Scorecard: <span className={`px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold ${bandColor(r.band)}`}>{r.band}</span>
                        {r.scorecardState ? <span className="ml-2 text-gray-400">· {r.scorecardState.replace("_", " ")}</span> : null}
                      </p>
                    )}
                    {total === 0 ? (
                      <p className="text-[12px] text-gray-400 py-2">No goals assigned for {fy} yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {r.assignments.map((a) => (
                          <div key={a.id} className="flex items-center gap-2 flex-wrap rounded-[8px] border border-[#eef0f4] px-3 py-2 bg-white">
                            <Target size={12} className="text-gray-400 flex-shrink-0" />
                            <span className="text-[12.5px] text-[#16203b] truncate max-w-[240px]">{a.measure}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eef4fa] text-[#0052cc] font-semibold">{a.goalType}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{PILLAR_LABEL[a.pillar] ?? a.pillar}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">wt {a.weight}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_STYLE[a.status] ?? "bg-gray-100 text-gray-500"}`}>
                              {a.status.replace("_", " ")}
                            </span>
                            <span className="ml-auto text-[10.5px] text-gray-400">
                              <span className={acceptColor(a.employeeAcceptance)}>self {a.employeeAcceptance}</span>
                              {" · "}
                              <span className={acceptColor(a.managerAcceptance)}>mgr {a.managerAcceptance}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
