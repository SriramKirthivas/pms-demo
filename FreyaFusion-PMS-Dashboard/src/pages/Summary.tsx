import AppLayout from "@/components/AppLayout";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Award, Target, Star, MessageSquare, Grid3x3, TrendingUp, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { pmGoal, pmScore, pmEval, NotFoundError } from "@/lib/pmApi";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// P3 — one-page performance summary: rolls up an employee's goals, ratings,
// IPF, talent placement and recent feedback from the real services into a
// single read-only overview, with links out to the detail pages.

interface Assignment {
  id: string; fiscalYear: string; ownerId: string; pillar: string;
  goalType: string; measure: string; weight: number; status: string;
}
interface IPFScorecardRsp {
  selfFinalIPF?: number | null; managerFinalIPF?: number | null;
  bandSelf?: string | null; bandManager?: string | null;
  state?: string; partialYear?: boolean;
}
interface CurrentRating { self: { rating: number } | null; reviewer: { rating: number } | null; }
interface NineBoxRsp { employeeId: string; performanceLevel: string; potentialLevel: string; boxLabel: string; }
interface FeedbackItem { id: string; aboutEmployeeId: string; from: string; category: string; text: string; at: string; }
interface Person { id: string; }

const FISCAL_YEARS = ["FY24-25", "FY25-26", "FY26-27", "FY27-28", "FY28-29", "FY29-30"];

const PILLARS = [
  { key: "TEAM_GOAL", label: "Team Goals", pct: "60%" },
  { key: "INDIVIDUAL_CONTRIBUTION", label: "Individual Contribution", pct: "40%" },
  { key: "TRAININGS_AND_CERTS", label: "Trainings & Certifications", pct: "—" },
];

const STATUS_STYLE: Record<string, string> = {
  PENDING_ACCEPTANCE: "bg-amber-100 text-amber-700",
  CHANGE_REQUESTED: "bg-purple-100 text-purple-700",
  ACTIVE: "bg-green-100 text-green-700",
  COMPLETION_REQUESTED: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-teal-100 text-teal-700",
  LOCKED: "bg-gray-200 text-gray-600",
  CLOSED: "bg-gray-100 text-gray-500",
};
const STATE_STYLE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  ACKNOWLEDGED: "bg-amber-100 text-amber-700",
  SIGNED_OFF: "bg-green-100 text-green-700",
};
const bandColor = (label: string | null | undefined) =>
  !label || label === "—" ? "bg-gray-100 text-gray-400"
  : label === "Exceptional" ? "bg-green-100 text-green-700"
  : label === "Exceeds Expectations" ? "bg-[#e6eefa] text-[#0052cc]"
  : label === "Meets Expectations" ? "bg-amber-100 text-amber-700"
  : label === "Needs Improvement" ? "bg-orange-100 text-orange-700"
  : "bg-red-100 text-red-700";

const scoreColor = (v: number | null) =>
  v == null ? "#e5e7eb" : v >= 3.8 ? "#16a34a" : v >= 2.9 ? "#0052cc" : v >= 2.1 ? "#f59e0b" : "#dc2626";

function RatingBar({ value }: { value: number | null }) {
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value == null ? 0 : (value / 5) * 100}%`, background: scoreColor(value) }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums w-7 text-right" style={{ color: scoreColor(value) }}>
        {value == null ? "—" : value.toFixed(1)}
      </span>
    </div>
  );
}

const avg = (nums: (number | null | undefined)[]) => {
  const v = nums.filter((n): n is number => n != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export default function Summary() {
  const { user, role } = useAuth();
  const canManage = role === "manager" || role === "admin";
  const [fy, setFy] = useState("FY26-27");
  const [viewed, setViewed] = useState(user.name);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);

  const [score, setScore] = useState<IPFScorecardRsp | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [ratings, setRatings] = useState<Record<string, CurrentRating>>({});
  const [box, setBox] = useState<NineBoxRsp | null>(null);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);

  const load = useCallback(async (employeeId: string, year: string) => {
    setLoading(true);
    try {
      const [sc, asgAll, fb, nb] = await Promise.all([
        pmScore.get<IPFScorecardRsp>(`/scorecards?employeeId=${encodeURIComponent(employeeId)}&fiscalYear=${encodeURIComponent(year)}`).catch(() => null),
        pmGoal.get<Assignment[]>(`/assignments?employeeId=${encodeURIComponent(employeeId)}`).catch(() => [] as Assignment[]),
        pmEval.get<{ list: FeedbackItem[] } | FeedbackItem[]>(`/feedback?aboutEmployeeId=${encodeURIComponent(employeeId)}&pageSize=5`).catch(() => [] as FeedbackItem[]),
        // 9-box needs manager/admin privilege — skip for an employee viewing self.
        canManage
          ? pmScore.get<NineBoxRsp[]>(`/nine-box?fiscalYear=${encodeURIComponent(year)}`).catch(() => [] as NineBoxRsp[])
          : Promise.resolve([] as NineBoxRsp[]),
      ]);
      setScore(sc);
      const mine = (asgAll || []).filter((a) => a.fiscalYear === year);
      setAssignments(mine);
      setBox((Array.isArray(nb) ? nb : []).find((b) => b.employeeId === employeeId) ?? null);
      const fbList = Array.isArray(fb) ? fb : (fb?.list ?? []);
      setFeedback(fbList);
      // Ratings per assignment (pm-eval is source of truth).
      const pairs = await Promise.all(mine.map((a) =>
        pmEval.get<CurrentRating>(`/evaluations/current?assignmentId=${encodeURIComponent(a.id)}`)
          .then((c) => [a.id, { self: c.self, reviewer: c.reviewer }] as const)
          .catch(() => [a.id, { self: null, reviewer: null }] as const),
      ));
      setRatings(Object.fromEntries(pairs));
    } catch (err) {
      if (!(err instanceof NotFoundError)) toast.error("Could not load summary", { description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => { load(viewed, fy); }, [viewed, fy, load]);
  useEffect(() => {
    if (canManage) pmGoal.get<Person[]>("/people").then(setPeople).catch(() => setPeople([]));
  }, [canManage]);

  const selfRatings = assignments.map((a) => ratings[a.id]?.self?.rating ?? null);
  const mgrRatings = assignments.map((a) => ratings[a.id]?.reviewer?.rating ?? null);
  const activeCount = assignments.filter((a) => a.status === "ACTIVE").length;

  const tiles = [
    {
      label: "Final IPF (manager)", icon: Award, tint: "#0052cc",
      value: score?.managerFinalIPF != null ? score.managerFinalIPF.toFixed(2) : "—",
      sub: score?.bandManager ?? "not computed",
    },
    { label: "Goals", icon: Target, tint: "#7c3aed", value: `${activeCount}/${assignments.length}`, sub: "active / total" },
    { label: "Avg self rating", icon: Star, tint: "#f59e0b", value: avg(selfRatings) == null ? "—" : (avg(selfRatings) as number).toFixed(1), sub: "reference" },
    { label: "Avg manager rating", icon: TrendingUp, tint: "#16a34a", value: avg(mgrRatings) == null ? "—" : (avg(mgrRatings) as number).toFixed(1), sub: "official" },
  ];

  return (
    <AppLayout pageTitle="Performance Summary" breadcrumb="Performance">
      {/* Controls */}
      <div className="ff-card px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
        {canManage && (
          <Select value={viewed} onValueChange={setViewed}>
            <SelectTrigger className="w-52 h-8 text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[user.name, ...people.map((p) => p.id).filter((id) => id !== user.name)].map((id) => (
                <SelectItem key={id} value={id}>{id}{id === user.name ? " (me)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="w-32 h-8 text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>{FISCAL_YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
        </Select>
        {score?.state && (
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATE_STYLE[score.state] ?? "bg-gray-100 text-gray-600"}`}>
            {score.state.replace("_", " ")}
          </span>
        )}
        {score?.partialYear && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-100 text-purple-700">Partial year</span>}
        <span className="ml-auto text-[12px] text-gray-500">{viewed}{viewed === user.name ? " (you)" : ""} · {fy}</span>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {tiles.map((t) => (
          <div key={t.label} className="ff-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ background: `${t.tint}1a` }}>
              <t.icon size={18} style={{ color: t.tint }} />
            </div>
            <div className="min-w-0">
              <p className="text-[20px] font-bold text-[#16203b] leading-none">{t.value}</p>
              <p className="text-[10.5px] text-gray-400 mt-1 leading-none truncate">{t.label}</p>
              <p className="text-[10px] text-gray-400 mt-0.5 truncate">{t.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: pillars + goals */}
        <div className="lg:col-span-2 space-y-4">
          {/* Per-pillar rollup */}
          <div className="ff-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-bold text-[#16203b]">By pillar</h3>
              <Link to="/goals" className="text-[11.5px] font-medium text-[#0052cc] hover:underline inline-flex items-center gap-1">
                Goals &amp; Cascade <ArrowRight size={12} />
              </Link>
            </div>
            <div className="space-y-2.5">
              {PILLARS.map((pl) => {
                const rows = assignments.filter((a) => a.pillar === pl.key);
                if (!rows.length) return null;
                const weight = rows.reduce((s, a) => s + a.weight, 0);
                const pillarAvg = avg(rows.map((a) => ratings[a.id]?.reviewer?.rating ?? null));
                return (
                  <div key={pl.key} className="flex items-center gap-3 rounded-[9px] border border-[#eef0f4] px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-semibold text-[#16203b]">{pl.label}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#eef4fa] text-[#0052cc] font-semibold">{pl.pct}</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5">{rows.length} goal{rows.length === 1 ? "" : "s"} · weight {weight}</p>
                    </div>
                    <RatingBar value={pillarAvg} />
                  </div>
                );
              })}
              {assignments.length === 0 && (
                <p className="text-[12.5px] text-gray-400">No goals for {fy} yet.</p>
              )}
            </div>
          </div>

          {/* Goal list */}
          {assignments.length > 0 && (
            <div className="ff-card p-5">
              <h3 className="text-[14px] font-bold text-[#16203b] mb-3">Goals ({assignments.length})</h3>
              <div className="space-y-1.5">
                {assignments.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 flex-wrap rounded-[8px] border border-[#eef0f4] px-3 py-2">
                    <Target size={12} className="text-gray-400 flex-shrink-0" />
                    <span className="text-[12.5px] text-[#16203b] truncate max-w-[260px]">{a.measure}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eef4fa] text-[#0052cc] font-semibold">{a.goalType}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_STYLE[a.status] ?? "bg-gray-100 text-gray-500"}`}>{a.status.replace("_", " ")}</span>
                    <span className="ml-auto text-[11px] text-gray-400">
                      self <b className="text-[#16203b]">{ratings[a.id]?.self?.rating ?? "—"}</b> · mgr <b className="text-[#16203b]">{ratings[a.id]?.reviewer?.rating ?? "—"}</b>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: IPF + talent + feedback */}
        <div className="space-y-4">
          {/* IPF card */}
          <div className="ff-card p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-bold text-[#16203b]">IPF Scorecard</h3>
              <Link to="/scorecard" className="text-[11.5px] font-medium text-[#0052cc] hover:underline inline-flex items-center gap-1">
                Detail <ArrowRight size={12} />
              </Link>
            </div>
            {score?.managerFinalIPF != null ? (
              <div className="text-center py-2">
                <p className="text-[34px] font-bold text-[#0052cc] leading-none">{score.managerFinalIPF.toFixed(2)}<span className="text-[14px] text-gray-400"> / 5</span></p>
                <span className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${bandColor(score.bandManager)}`}>{score.bandManager}</span>
                <p className="text-[11px] text-gray-400 mt-2">Self reference: {score.selfFinalIPF != null ? score.selfFinalIPF.toFixed(2) : "—"} ({score.bandSelf ?? "—"})</p>
              </div>
            ) : (
              <p className="text-[12.5px] text-gray-400 py-2">Not computed yet — compute it on the Scorecard page after ratings are in.</p>
            )}
          </div>

          {/* Talent placement */}
          {canManage && (
            <div className="ff-card p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[13px] font-bold text-[#16203b] flex items-center gap-1.5"><Grid3x3 size={14} className="text-[#0052cc]" /> Talent box</h3>
                <Link to="/talent" className="text-[11.5px] font-medium text-[#0052cc] hover:underline inline-flex items-center gap-1">
                  Matrix <ArrowRight size={12} />
                </Link>
              </div>
              {box ? (
                <div>
                  <p className="text-[15px] font-bold text-[#16203b]">{box.boxLabel}</p>
                  <p className="text-[11.5px] text-gray-500 mt-1">Performance <b>{box.performanceLevel}</b> · Potential <b>{box.potentialLevel}</b></p>
                </div>
              ) : (
                <p className="text-[12.5px] text-gray-400">Not placed on the 9-box yet.</p>
              )}
            </div>
          )}

          {/* Recent feedback */}
          <div className="ff-card p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-bold text-[#16203b] flex items-center gap-1.5"><MessageSquare size={14} className="text-[#0052cc]" /> Recent feedback</h3>
              <Link to="/feedback" className="text-[11.5px] font-medium text-[#0052cc] hover:underline inline-flex items-center gap-1">
                All <ArrowRight size={12} />
              </Link>
            </div>
            {feedback.length === 0 ? (
              <p className="text-[12.5px] text-gray-400">No feedback recorded.</p>
            ) : (
              <div className="space-y-2">
                {feedback.slice(0, 4).map((f) => (
                  <div key={f.id} className="rounded-[8px] border border-[#eef0f4] px-3 py-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">{f.category}</span>
                      <span className="text-[10.5px] text-gray-400">{f.from} · {new Date(f.at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-[12px] text-[#16203b] leading-snug">{f.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && <p className="text-[12px] text-gray-400 mt-3">Loading…</p>}
    </AppLayout>
  );
}
