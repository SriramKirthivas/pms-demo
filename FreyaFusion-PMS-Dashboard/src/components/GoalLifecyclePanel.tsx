import { useEffect, useState } from "react";
import {
  Settings2, Plus, GitBranch, Check, X, Pencil, Clock, History, Lock, Target, Crosshair,
  NotebookPen, CalendarClock, Upload, Download, Star, MessageSquare, Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { pmGoal, pmEval, pmGoalUploadFile, pmGoalDownloadFile } from "@/lib/pmApi";
import GoalFlowGuide from "@/components/GoalFlowGuide";

interface Period { id: string; code: string; cadence: string; label: string; window: string; locked: boolean; }
interface Framework {
  id: string; fiscalYear: string; activeCadences: string[];
  teamWeightPct: number; individualWeightPct: number;
  startMonth?: number; fyWindow?: string; periods: Period[];
}
interface Goal {
  id: string; fiscalYear: string; pillar: string; cadence: string; goalType: string;
  measure: string; description: string; baseCriteria: string; defaultWeight: number;
  competencies: string[]; status: string; setterId: string;
}
interface Assignment {
  id: string; goalId: string; fiscalYear: string; ownerId: string; setterId: string; reviewerId: string;
  pillar: string; goalType: string; measure: string; criteria: string; weight: number;
  status: string; employeeAcceptance: string; managerAcceptance: string; isActive: boolean;
}
interface AuditRow { id: string; actor: string; action: string; detail: string; at: string; }
interface Person { id: string; role: string; title: string; department: string; managerId: string; }
interface CheckInNote { id: string; employeeId: string; periodId: string; authorId: string; note: string; at: string; }
interface MidYearEval { assignmentId: string; self: { rating: number } | null; reviewer: { rating: number } | null; }
interface MidYearSummary {
  employeeId: string; fiscalYear: string; half: string; isFinal: boolean;
  evaluations: MidYearEval[]; checkInNotes: CheckInNote[];
}

const PILLARS = [
  { value: "TEAM_GOAL", label: "Team Goal" },
  { value: "INDIVIDUAL_CONTRIBUTION", label: "Individual Contribution" },
  { value: "TRAININGS_AND_CERTS", label: "Trainings & Certifications" },
];
const pillarLabel = (v: string) => PILLARS.find((p) => p.value === v)?.label ?? v;

const STATUS_STYLE: Record<string, string> = {
  PENDING_ACCEPTANCE: "bg-amber-100 text-amber-700",
  CHANGE_REQUESTED: "bg-purple-100 text-purple-700",
  ACTIVE: "bg-green-100 text-green-700",
  COMPLETION_REQUESTED: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-teal-100 text-teal-700",
  LOCKED: "bg-gray-200 text-gray-600",
  CLOSED: "bg-gray-100 text-gray-500",
};
const accColor = (s: string) =>
  s === "ACCEPTED" ? "text-green-600" : s === "REJECTED" ? "text-red-600" : "text-gray-400";

// Numeric ratings entered against an ACTIVE assignment (pm-eval). The self
// stream is the owner's, the reviewer stream is the manager's; these roll up
// into the IPF scorecard when the period is locked.
const RATING_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
interface CurrentRating {
  self: { rating: number; comment?: string } | null;
  reviewer: { rating: number; comment?: string } | null;
}

// Selectable fiscal years (Apr–Mar). Kept as a fixed list since there's no
// "list all fiscal years" endpoint; covers recent past through near future.
const FISCAL_YEARS = ["FY24-25", "FY25-26", "FY26-27", "FY27-28", "FY28-29", "FY29-30"];

// Goal-scoped feedback categories (pm-eval vocabulary). STRETCH feeds the
// 9-box potential axis; kept identical to the continuous-feedback page.
const FEEDBACK_CATEGORIES = [
  { key: "MOTIVATION", label: "Motivation / Praise" },
  { key: "STRETCH", label: "Stretch / Growth" },
  { key: "ATTITUDE", label: "Attitude" },
  { key: "COMMUNICATION", label: "Communication" },
  { key: "IMPROVEMENT", label: "Area to improve" },
  { key: "GENERAL", label: "General" },
];
interface GoalFeedback { id: string; from: string; category: string; text: string; at: string; assignmentId: string; }

// Fiscal-year start month options (1=Jan … 12=Dec). Lets an admin structure the
// year flexibly instead of a hardcoded April start.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function GoalLifecyclePanel() {
  const { role, user } = useAuth();
  const isSetter = role === "manager" || role === "admin";
  const isAdmin = role === "admin";

  const [fy, setFy] = useState("FY26-27");
  // Split the panel into tabs so goal setup/cascade and rating entry aren't one
  // long page (meeting ask).
  const [tab, setTab] = useState<"goals" | "ratings">("goals");
  const [framework, setFramework] = useState<Framework | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  // Directory (UAM stub, pm-goal /people) — defaults to "my team" server-side
  // for managers, everyone for admins. Replaces free-text cascade targets.
  const [people, setPeople] = useState<Person[]>([]);

  const [fwOpen, setFwOpen] = useState(false);
  const [fwForm, setFwForm] = useState({ cadences: ["QUARTERLY", "ANNUAL"], team: 60, startMonth: 4, announce: true });

  const [goalOpen, setGoalOpen] = useState(false);
  const [goalForm, setGoalForm] = useState({
    pillar: "TEAM_GOAL", goalType: "OKR", measure: "", description: "",
    baseCriteria: "", defaultWeight: "5", competencies: "",
  });

  const [cascadeGoal, setCascadeGoal] = useState<Goal | null>(null);
  const [cascadeTo, setCascadeTo] = useState<Set<string>>(new Set());

  const [changeFor, setChangeFor] = useState<Assignment | null>(null);
  const [changeForm, setChangeForm] = useState({ weight: "", criteria: "" });

  const [auditFor, setAuditFor] = useState<Assignment | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);

  // Goal-scoped feedback (feedback tied to one in-progress goal), distinct
  // from the general continuous feedback on the Feedback page.
  const [feedbackFor, setFeedbackFor] = useState<Assignment | null>(null);
  const [goalFeedback, setGoalFeedback] = useState<GoalFeedback[]>([]);
  const [fbCategory, setFbCategory] = useState("MOTIVATION");
  const [fbText, setFbText] = useState("");
  const [fbLoading, setFbLoading] = useState(false);

  // Latest self/reviewer rating per assignment (pm-eval GET /evaluations/current).
  const [ratings, setRatings] = useState<Record<string, CurrentRating>>({});
  // Per-assignment draft (rating + free-text comment) captured in the Ratings
  // tab before Save — lets employee/manager add their view alongside the score.
  const [ratingDraft, setRatingDraft] = useState<Record<string, { rating: string; comment: string }>>({});
  const draftFor = (id: string) => ratingDraft[id] ?? { rating: "", comment: "" };
  const setDraft = (id: string, patch: Partial<{ rating: string; comment: string }>) =>
    setRatingDraft((prev) => ({ ...prev, [id]: { ...draftFor(id), ...patch } }));

  // Quarterly check-in notes (pm-eval) — free-text progress notes per
  // employee/period, separate from numeric ratings.
  const [checkinEmployee, setCheckinEmployee] = useState("");
  const [checkinPeriodId, setCheckinPeriodId] = useState("");
  const [checkinText, setCheckinText] = useState("");
  const [checkinNotes, setCheckinNotes] = useState<CheckInNote[]>([]);
  const [checkinLoading, setCheckinLoading] = useState(false);

  // Mid-year review checkpoint (pm-eval) — read-only consolidated H1 summary.
  const [midYearEmployee, setMidYearEmployee] = useState("");
  const [midYear, setMidYear] = useState<MidYearSummary | null>(null);
  const [midYearLoading, setMidYearLoading] = useState(false);

  // Goal sheet import/export (pm-goal, .xlsx)
  const [importFile, setImportFile] = useState<File | null>(null);
  const [exportEmployee, setExportEmployee] = useState("");

  const loadAll = async (year: string) => {
    try {
      // GET /goals returns a paginated PageRspVO ({list, total, pageNum,
      // pageSize}), not a bare array — unlike /framework and /assignments.
      const [fw, gsPage, asg] = await Promise.all([
        pmGoal.get<Framework | null>(`/framework?fiscalYear=${encodeURIComponent(year)}`),
        pmGoal.get<{ list: Goal[]; total: number }>(`/goals?fiscalYear=${encodeURIComponent(year)}&pageSize=200`),
        pmGoal.get<Assignment[]>(`/assignments`),
      ]);
      setFramework(fw);
      setGoals(gsPage.list ?? []);
      const mine = asg.filter((a) => a.fiscalYear === year);
      setAssignments(mine);
      // Pull the latest self/reviewer rating for each assignment so the row can
      // show current values (pm-eval is the source of truth for ratings).
      const pairs = await Promise.all(mine.map((a) =>
        pmEval.get<CurrentRating>(`/evaluations/current?assignmentId=${encodeURIComponent(a.id)}`)
          .then((c) => [a.id, { self: c.self, reviewer: c.reviewer }] as const)
          .catch(() => [a.id, { self: null, reviewer: null }] as const),
      ));
      setRatings(Object.fromEntries(pairs));
    } catch (err) {
      toast.error("Could not load pm-goal data", { description: (err as Error).message });
    }
  };

  const submitRating = async (a: Assignment, source: "self" | "reviewer", rating: number, comment = "") => {
    const path = source === "self" ? "/evaluations/self" : "/evaluations/reviewer";
    try {
      await pmEval.post(path, { assignmentId: a.id, employeeId: a.ownerId, rating, comment });
      toast.success(`${source === "self" ? "Self" : "Reviewer"} rating saved (${rating.toFixed(1)})`);
      loadAll(fy);
    } catch (err) {
      toast.error("Could not save rating", { description: (err as Error).message });
    }
  };
  useEffect(() => {
    loadAll(fy);
    // Admins see the whole directory; managers get their own team by default
    // (server-side scoping in pm-goal — see GET /people).
    pmGoal.get<Person[]>("/people").then(setPeople).catch(() => setPeople([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- framework ----
  const saveFramework = async () => {
    const firstOpen = !framework;
    try {
      await pmGoal.post("/framework", {
        fiscalYear: fy, activeCadences: fwForm.cadences,
        teamWeightPct: fwForm.team, individualWeightPct: 100 - fwForm.team,
        startMonth: fwForm.startMonth, announce: fwForm.announce,
      });
      const notified = firstOpen || fwForm.announce;
      toast.success(firstOpen ? "Cycle opened" : "Framework saved",
        notified ? { description: "Everyone was notified the cycle is open." } : undefined);
      setFwOpen(false);
      loadAll(fy);
    } catch (err) { toast.error("Could not save", { description: (err as Error).message }); }
  };
  const toggleCadence = (c: string) =>
    setFwForm((f) => ({
      ...f,
      cadences: f.cadences.includes(c) ? f.cadences.filter((x) => x !== c) : [...f.cadences, c],
    }));

  // ---- goals ----
  const createGoal = async () => {
    if (!goalForm.measure.trim()) { toast.error("Measure is required"); return; }
    try {
      await pmGoal.post("/goals", {
        fiscalYear: fy, pillar: goalForm.pillar, goalType: goalForm.goalType,
        measure: goalForm.measure, description: goalForm.description,
        baseCriteria: goalForm.baseCriteria,
        defaultWeight: parseInt(goalForm.defaultWeight, 10) || 0,
        competencies: goalForm.competencies.split(",").map((s) => s.trim()).filter(Boolean),
      });
      toast.success("Goal created (DRAFT)");
      setGoalOpen(false);
      setGoalForm({ ...goalForm, measure: "", description: "", baseCriteria: "", competencies: "" });
      loadAll(fy);
    } catch (err) { toast.error("Could not create goal", { description: (err as Error).message }); }
  };

  const toggleCascadeTarget = (id: string) =>
    setCascadeTo((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const doCascade = async () => {
    if (!cascadeGoal) return;
    const ids = Array.from(cascadeTo);
    if (!ids.length) { toast.error("Pick at least one employee"); return; }
    try {
      const result = await pmGoal.post<{ created: string[]; failed: { employeeId: string; reason: string }[] }>(
        `/goals/${cascadeGoal.id}/cascade`, { employeeIds: ids },
      );
      if (result.failed?.length) {
        toast.warning(`${result.created.length} cascaded, ${result.failed.length} failed`,
          { description: result.failed.map((f) => `${f.employeeId}: ${f.reason}`).join("; ") });
      } else {
        toast.success("Cascaded", { description: `${result.created.length} assignment(s) created` });
      }
      setCascadeGoal(null);
      loadAll(fy);
    } catch (err) { toast.error("Could not cascade", { description: (err as Error).message }); }
  };

  // ---- assignment actions ----
  const act = async (path: string, body?: unknown, ok = "Done") => {
    try {
      await pmGoal.post(path, body);
      toast.success(ok);
      loadAll(fy);
    } catch (err) { toast.error("Action failed", { description: (err as Error).message }); }
  };
  const submitChange = async () => {
    if (!changeFor) return;
    await act(`/assignments/${changeFor.id}/request-change`, {
      weight: changeForm.weight ? parseInt(changeForm.weight, 10) : null,
      tweakedCriteria: changeForm.criteria || null,
    }, "Change requested");
    setChangeFor(null);
  };
  const openAudit = async (a: Assignment) => {
    setAuditFor(a);
    try { setAuditRows(await pmGoal.get<AuditRow[]>(`/assignments/${a.id}/audit`)); }
    catch { setAuditRows([]); }
  };

  // ---- assignment detail pop-out helpers ----
  const goalDescription = (goalId: string) => goals.find((g) => g.id === goalId)?.description || "";
  // Sibling assignments derived from the same goal — for a team goal these are
  // the individual owners whose ratings roll up as their contribution.
  const siblingsOf = (a: Assignment) => assignments.filter((x) => x.goalId === a.goalId);

  // ---- goal-scoped feedback (pm-eval, assignmentId set) ----
  const loadGoalFeedback = async (a: Assignment) => {
    setFbLoading(true);
    try {
      const res = await pmEval.get<{ list: GoalFeedback[] }>(
        `/feedback?aboutEmployeeId=${encodeURIComponent(a.ownerId)}&assignmentId=${encodeURIComponent(a.id)}&pageSize=100`,
      );
      setGoalFeedback(res.list ?? []);
    } catch { setGoalFeedback([]); }
    finally { setFbLoading(false); }
  };
  const openFeedback = (a: Assignment) => {
    setFeedbackFor(a); setFbText(""); setFbCategory("MOTIVATION"); setGoalFeedback([]);
    loadGoalFeedback(a);
  };
  const submitGoalFeedback = async () => {
    if (!feedbackFor || !fbText.trim()) { toast.error("Write some feedback first"); return; }
    try {
      await pmEval.post("/feedback", {
        aboutEmployeeId: feedbackFor.ownerId, assignmentId: feedbackFor.id,
        category: fbCategory, text: fbText.trim(), fiscalYear: fy,
      });
      toast.success("Feedback added to goal", { description: `${feedbackFor.ownerId} will be notified.` });
      setFbText("");
      loadGoalFeedback(feedbackFor);
    } catch (err) { toast.error("Could not send", { description: (err as Error).message }); }
  };

  // ---- quarterly check-in notes (pm-eval) ----
  const submitCheckinNote = async () => {
    if (!checkinEmployee || !checkinPeriodId || !checkinText.trim()) {
      toast.error("Pick an employee, a period, and enter a note"); return;
    }
    try {
      await pmEval.post("/check-in-notes", {
        employeeId: checkinEmployee, periodId: checkinPeriodId, note: checkinText.trim(),
        fiscalYear: fy,
      });
      toast.success("Check-in note recorded");
      setCheckinText("");
      loadCheckinNotes(checkinEmployee, checkinPeriodId);
    } catch (err) { toast.error("Could not record note", { description: (err as Error).message }); }
  };
  const loadCheckinNotes = async (employeeId: string, periodId: string) => {
    if (!employeeId || !periodId) { setCheckinNotes([]); return; }
    setCheckinLoading(true);
    try {
      setCheckinNotes(await pmEval.get<CheckInNote[]>(
        `/check-in-notes?employeeId=${encodeURIComponent(employeeId)}&periodId=${encodeURIComponent(periodId)}`,
      ));
    } catch { setCheckinNotes([]); }
    finally { setCheckinLoading(false); }
  };
  useEffect(() => { loadCheckinNotes(checkinEmployee, checkinPeriodId); }, [checkinEmployee, checkinPeriodId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- mid-year review checkpoint (pm-eval, read-only) ----
  const loadMidYear = async () => {
    if (!midYearEmployee) { toast.error("Pick an employee"); return; }
    setMidYearLoading(true);
    try {
      setMidYear(await pmEval.get<MidYearSummary>(
        `/mid-year?employeeId=${encodeURIComponent(midYearEmployee)}&fiscalYear=${encodeURIComponent(fy)}`,
      ));
    } catch (err) {
      setMidYear(null);
      toast.error("Could not load mid-year summary", { description: (err as Error).message });
    } finally { setMidYearLoading(false); }
  };

  // ---- goal sheet import / export (pm-goal, .xlsx) ----
  const doImport = async () => {
    if (!importFile) { toast.error("Choose an .xlsx file first"); return; }
    try {
      const result = await pmGoalUploadFile<{ created: number; goals: number }>(
        `/goals/import?fiscalYear=${encodeURIComponent(fy)}`, importFile,
      );
      toast.success("Goal sheet imported", { description: JSON.stringify(result) });
      setImportFile(null);
      loadAll(fy);
    } catch (err) { toast.error("Import failed", { description: (err as Error).message }); }
  };
  const doExport = async () => {
    if (!exportEmployee) { toast.error("Pick an employee to export"); return; }
    try {
      const { blob, filename } = await pmGoalDownloadFile(
        `/goals/export?employeeId=${encodeURIComponent(exportEmployee)}&fiscalYear=${encodeURIComponent(fy)}`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { toast.error("Export failed", { description: (err as Error).message }); }
  };

  // section weight totals per pillar (must be 10 to cascade)
  const sectionTotals: Record<string, number> = {};
  for (const g of goals) sectionTotals[g.pillar] = (sectionTotals[g.pillar] ?? 0) + g.defaultWeight;

  // Assignments that can carry ratings (past the acceptance stage) — the
  // Ratings tab works from this list.
  const rateable = assignments.filter(
    (a) => a.status !== "PENDING_ACCEPTANCE" && a.status !== "CHANGE_REQUESTED",
  );

  return (
    <div className="space-y-4">
      {/* FY selector */}
      <div className="ff-card p-4 mb-4 flex flex-wrap items-center gap-3">
        <span className="text-[12px] font-medium text-gray-500">Fiscal year</span>
        <Select value={fy} onValueChange={(v) => { setFy(v); loadAll(v); }}>
          <SelectTrigger className="w-32 h-8 text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FISCAL_YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => loadAll(fy)}>Reload</Button>
        <span className="ml-auto text-[11px] text-gray-400">
          Signed in as <b className="text-[#16203b]">{user.name}</b> · {role}
        </span>
      </div>

      {/* Step-to-step flow + who-acts-when (meeting ask) */}
      <GoalFlowGuide />

      {/* Tabs: goal setup/cascade vs rating entry */}
      <div className="flex gap-1 mb-4 bg-white border border-[#ebedf2] rounded-[8px] p-1 w-fit">
        {([["goals", "Goals & Cascade", GitBranch], ["ratings", "Ratings & Reviews", Star]] as const).map(([k, lbl, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-[5px] text-[12.5px] font-medium transition-colors ${tab === k ? "bg-[#0052cc] text-white" : "text-gray-500 hover:text-[#16203b]"}`}>
            <Icon size={13} /> {lbl}
          </button>
        ))}
      </div>

      {/* 1. Framework */}
      {tab === "goals" && (
      <div className="ff-card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2">
              <Settings2 size={15} className="text-[#0052cc]" /> Performance Framework
            </h3>
            <p className="text-[12px] text-gray-500 mt-0.5">Step 1 — the fiscal-year setup: cadences and the Team/Individual weight split. <b>Admin</b> configures it; review periods are derived automatically.</p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => {
              setFwForm({
                cadences: framework?.activeCadences ?? ["QUARTERLY", "ANNUAL"],
                team: framework?.teamWeightPct ?? 60,
                startMonth: framework?.startMonth ?? 4,
                announce: !framework, // first open announces by default
              });
              setFwOpen(true);
            }} className="bg-[#0052cc] hover:bg-[#003d99]">
              {framework ? "Reconfigure" : "Configure"}
            </Button>
          )}
        </div>
        {framework ? (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3 text-[12px]">
              <span className="px-2 py-0.5 rounded-full bg-[#eef4fa] text-[#0052cc] font-medium">
                Team {framework.teamWeightPct}% · Individual {framework.individualWeightPct}%
              </span>
              {framework.fyWindow && (
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600" title="Fiscal-year window">
                  {framework.fyWindow}
                </span>
              )}
              {framework.activeCadences.map((c) => (
                <span key={c} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{c}</span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {framework.periods.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[7px] border border-[#eef0f4] text-[12px] text-[#16203b]">
                  {p.locked && <Lock size={10} className="text-gray-400" />}
                  <b>{p.code}</b> <span className="text-gray-400">· {p.window}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[12.5px] text-gray-400">
            No framework for {fy} yet.{isAdmin ? " Configure one to derive review periods." : " Ask an admin to configure it."}
          </p>
        )}
      </div>
      )}

      {/* 2. Goal authoring (setters) */}
      {isSetter && tab === "goals" && (
        <div className="ff-card p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2">
                <Target size={15} className="text-[#0052cc]" /> Goal Authoring
              </h3>
              <p className="text-[12px] text-gray-500 mt-0.5">Step 2 — <b>Manager/Admin</b> create goals per pillar with a measure, description and 1/3/5 rubric. Each pillar's weights must total 10 before cascade.</p>
            </div>
            <Button size="sm" onClick={() => setGoalOpen(true)} className="bg-[#0052cc] hover:bg-[#003d99]">
              <Plus size={13} className="mr-1" /> New goal
            </Button>
          </div>
          {goals.length === 0 ? (
            <p className="text-[12.5px] text-gray-400">No goals yet. Create goals so each pillar section totals weight 10, then cascade.</p>
          ) : (
            <div className="space-y-4">
              {PILLARS.map((pl) => {
                const rows = goals.filter((g) => g.pillar === pl.value);
                if (!rows.length) return null;
                const total = sectionTotals[pl.value] ?? 0;
                return (
                  <div key={pl.value}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-[12px] font-semibold text-[#16203b]">{pl.label}</p>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${total === 10 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                        weight {total}/10
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {rows.map((g) => (
                        <div key={g.id} className="flex items-center gap-2 rounded-[8px] border border-[#eef0f4] px-3 py-2">
                          <Crosshair size={12} className="text-gray-400 flex-shrink-0" />
                          <span className="text-[13px] text-[#16203b] truncate">{g.measure}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eef4fa] text-[#0052cc] font-semibold">{g.goalType}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">wt {g.defaultWeight}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{g.status}</span>
                          <button onClick={() => { setCascadeGoal(g); setCascadeTo(new Set()); }}
                            className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-[#0052cc] hover:underline">
                            <GitBranch size={12} /> Cascade
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. Assignments + bilateral acceptance */}
      {tab === "goals" && (
      <div className="ff-card p-5">
        <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2 mb-1">
          <GitBranch size={15} className="text-[#0052cc]" /> Assignments &amp; Acceptance
        </h3>
        <p className="text-[12px] text-gray-500 mb-3">Steps 3–6 — cascaded goals appear here. <b>Employee</b> and <b>Manager</b> both accept to make a goal Active, then rate it. Early completion needs manager approval.</p>
        {assignments.length === 0 ? (
          <p className="text-[12.5px] text-gray-400">No assignments yet. {isSetter ? "Cascade a goal to create them." : "Wait for your manager to cascade goals to you."}</p>
        ) : (
          <div className="space-y-4">
            {PILLARS.map((pl) => {
              const pillarRows = assignments.filter((a) => a.pillar === pl.value);
              if (!pillarRows.length) return null;
              return (
                <div key={pl.value}>
                  <p className="text-[12px] font-semibold text-[#16203b] mb-2 flex items-center gap-2">
                    {pl.label}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{pillarRows.length}</span>
                  </p>
                  <div className="space-y-2">
                    {pillarRows.map((a) => {
                      const own = a.ownerId === user.name;
                      const desc = goalDescription(a.goalId);
                      const siblings = siblingsOf(a);
                      return (
                <div key={a.id} className="rounded-[9px] border border-[#eef0f4] p-3">
                  <div className="flex items-start gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-[#16203b]">{a.measure}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_STYLE[a.status] ?? "bg-gray-100 text-gray-500"}`}>{a.status.replace("_", " ")}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">wt {a.weight}</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1">
                        Owner <b className="text-[#16203b]">{a.ownerId}</b>{own && " (you)"} · {pillarLabel(a.pillar)} ·
                        <span className={`ml-1 ${accColor(a.employeeAcceptance)}`}>self {a.employeeAcceptance}</span> ·
                        <span className={`ml-1 ${accColor(a.managerAcceptance)}`}>mgr {a.managerAcceptance}</span>
                      </p>
                      {desc && (
                        <p className="text-[11px] text-gray-500 mt-1"><span className="text-gray-400">Description:</span> {desc}</p>
                      )}
                      {a.criteria && (
                        <p className="text-[11px] text-gray-500 mt-1"><span className="text-gray-400">Measurement criteria:</span> {a.criteria}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {a.status !== "ACTIVE" && (own ? a.employeeAcceptance !== "ACCEPTED" : isSetter && a.managerAcceptance !== "ACCEPTED") && (
                        <button onClick={() => act(`/assignments/${a.id}/accept`, undefined, "Accepted")}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-semibold bg-green-600 text-white hover:bg-green-700">
                          <Check size={11} /> Accept
                        </button>
                      )}
                      {own && a.status !== "ACTIVE" && (
                        <button onClick={() => { setChangeFor(a); setChangeForm({ weight: String(a.weight), criteria: a.criteria }); }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-medium text-[#0052cc] border border-[#0052cc]/30 hover:bg-[#e6eefa]">
                          <Pencil size={11} /> Request change
                        </button>
                      )}
                      {(own || isSetter) && a.status !== "ACTIVE" && a.status !== "COMPLETION_REQUESTED" && a.status !== "COMPLETED" && (
                        <button onClick={() => act(`/assignments/${a.id}/reject`, undefined, "Rejected")}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-medium text-red-600 border border-red-200 hover:bg-red-50">
                          <X size={11} /> Reject
                        </button>
                      )}
                      {own && a.status === "ACTIVE" && (
                        <button onClick={() => act(`/assignments/${a.id}/request-completion`, {}, "Completion requested")}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-medium text-teal-700 border border-teal-300 hover:bg-teal-50">
                          <Check size={11} /> Mark done early
                        </button>
                      )}
                      {isSetter && a.status === "COMPLETION_REQUESTED" && (
                        <>
                          <button onClick={() => act(`/assignments/${a.id}/completion-decision`, { decision: "APPROVE" }, "Completion approved")}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-semibold bg-teal-600 text-white hover:bg-teal-700">
                            <Check size={11} /> Approve completion
                          </button>
                          <button onClick={() => act(`/assignments/${a.id}/completion-decision`, { decision: "REJECT" }, "Completion rejected")}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-medium text-red-600 border border-red-200 hover:bg-red-50">
                            <X size={11} /> Reject
                          </button>
                        </>
                      )}
                      {a.status !== "PENDING_ACCEPTANCE" && a.status !== "CHANGE_REQUESTED" && (
                        <button onClick={() => openFeedback(a)} title="Feedback on this goal"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-medium text-[#0052cc] border border-[#0052cc]/30 hover:bg-[#e6eefa]">
                          <MessageSquare size={11} /> Feedback
                        </button>
                      )}
                      <button onClick={() => openAudit(a)} title="Audit trail"
                        className="p-1 rounded hover:bg-[#eef0f4] text-gray-400"><History size={14} /></button>
                    </div>
                  </div>

                  {/* Individual contributions to a team goal (inline) */}
                  {a.pillar === "TEAM_GOAL" && siblings.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#f3f4f6]">
                      <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1 flex items-center gap-1.5">
                        <Users size={11} className="text-[#0052cc]" /> Individual contributions
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {siblings.map((s) => (
                          <span key={s.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-50 border border-[#eef0f4] text-gray-600">
                            {s.ownerId}{s.ownerId === user.name && " (you)"} · mgr <b className="text-[#16203b]">{ratings[s.id]?.reviewer?.rating ?? "—"}</b>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-[10.5px] text-gray-400 mt-2 pt-2 border-t border-[#f3f4f6]">
                    Rate this goal &amp; add your view in the <b className="text-[#0052cc]">Ratings &amp; Reviews</b> tab once it's Active.
                  </p>
                </div>
              );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Ratings tab: self (owner) + reviewer (manager) rating entry */}
      {tab === "ratings" && (
      <div className="ff-card p-5 mb-4">
        <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2 mb-1">
          <Star size={15} className="text-[#0052cc]" /> Ratings
        </h3>
        <p className="text-[12px] text-gray-500 mb-3">Step 5 — the <b>Employee</b> self-rates (reference) and the <b>Manager</b> sets the official rating. Editable while a goal is Active; these roll up into the IPF scorecard.</p>
        {rateable.length === 0 ? (
          <p className="text-[12.5px] text-gray-400">No goals to rate yet — goals become rateable once both sides accept them (see the Goals &amp; Cascade tab).</p>
        ) : (
          <div className="space-y-2">
            {rateable.map((a) => {
              const own = a.ownerId === user.name;
              return (
                <div key={a.id} className="rounded-[9px] border border-[#eef0f4] p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium text-[#16203b]">{a.measure}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_STYLE[a.status] ?? "bg-gray-100 text-gray-500"}`}>{a.status.replace("_", " ")}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">wt {a.weight}</span>
                    <span className="text-[11px] text-gray-400 ml-auto">Owner <b className="text-[#16203b]">{a.ownerId}</b>{own && " (you)"}</span>
                  </div>

                  {/* Employee's view + Manager's view (rating + free-text) */}
                  <div className="grid sm:grid-cols-2 gap-2 mt-2">
                    <div className="rounded-[7px] border border-[#eef0f4] px-2.5 py-1.5">
                      <p className="text-[10px] text-gray-400">Employee's view · self <b className="text-[#16203b]">{ratings[a.id]?.self?.rating ?? "—"}</b></p>
                      <p className="text-[12px] text-[#16203b] leading-snug mt-0.5">{ratings[a.id]?.self?.comment || <span className="text-gray-300">—</span>}</p>
                    </div>
                    <div className="rounded-[7px] border border-[#eef0f4] px-2.5 py-1.5">
                      <p className="text-[10px] text-gray-400">Manager's view · mgr <b className="text-[#16203b]">{ratings[a.id]?.reviewer?.rating ?? "—"}</b></p>
                      <p className="text-[12px] text-[#16203b] leading-snug mt-0.5">{ratings[a.id]?.reviewer?.comment || <span className="text-gray-300">—</span>}</p>
                    </div>
                  </div>

                  {/* Editor for whichever stream the current user owns, while ACTIVE */}
                  {a.status === "ACTIVE" && (own || (isSetter && !own)) && (() => {
                    const source: "self" | "reviewer" = own ? "self" : "reviewer";
                    const d = draftFor(a.id);
                    return (
                      <div className="mt-2 pt-2 border-t border-[#f3f4f6] space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-gray-400">{own ? "Your rating" : "Reviewer rating"}</span>
                          <select value={d.rating} onChange={(e) => setDraft(a.id, { rating: e.target.value })}
                            className="h-7 rounded-[5px] border border-input bg-background text-[12px] px-1.5">
                            <option value="">—</option>
                            {RATING_OPTIONS.map((o) => <option key={o} value={o}>{o.toFixed(1)}</option>)}
                          </select>
                        </div>
                        <textarea rows={2} value={d.comment} onChange={(e) => setDraft(a.id, { comment: e.target.value.slice(0, 2000) })}
                          placeholder={own ? "Your view on this goal (optional)" : "Manager's point of view (optional)"}
                          className="w-full px-2.5 py-1.5 text-[12px] border border-input rounded-[4px] bg-background text-[#16203b] focus:outline-none focus:border-[#0052cc] resize-none" />
                        <Button size="sm" className="bg-[#0052cc] hover:bg-[#003d99]"
                          onClick={() => {
                            const cur = ratings[a.id]?.[source]?.rating ?? null;
                            const r = d.rating ? parseFloat(d.rating) : cur;
                            if (r == null) { toast.error("Pick a rating first"); return; }
                            submitRating(a, source, r, d.comment.trim());
                          }}>
                          Save rating &amp; comment
                        </Button>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* 4. Quarterly check-in notes + mid-year review (reviewers) — Ratings tab */}
      {isSetter && tab === "ratings" && (
        <div className="ff-card p-5">
          <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2 mb-1">
            <NotebookPen size={15} className="text-[#0052cc]" /> Check-in Notes &amp; Mid-Year Review
          </h3>
          <p className="text-[12px] text-gray-500 mb-3">Step 5 support — <b>Manager</b> records quarterly progress notes and reviews the read-only mid-year (H1) summary.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Check-in notes */}
            <div>
              <p className="text-[12px] font-semibold text-[#16203b] mb-2">Quarterly check-in note</p>
              <div className="space-y-2">
                <Select value={checkinEmployee} onValueChange={setCheckinEmployee}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue placeholder="Employee" /></SelectTrigger>
                  <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.id}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={checkinPeriodId} onValueChange={setCheckinPeriodId}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue placeholder="Period" /></SelectTrigger>
                  <SelectContent>
                    {(framework?.periods ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>)}
                  </SelectContent>
                </Select>
                <textarea rows={2} value={checkinText} onChange={(e) => setCheckinText(e.target.value)}
                  placeholder="Qualitative progress note…"
                  className="w-full px-3 py-2 text-[12.5px] border border-input rounded-[4px] bg-background text-[#16203b] focus:outline-none focus:border-[#0052cc] resize-none" />
                <Button size="sm" onClick={submitCheckinNote} className="bg-[#0052cc] hover:bg-[#003d99]">Record note</Button>
              </div>
              <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto">
                {checkinLoading ? (
                  <p className="text-[11.5px] text-gray-400">Loading…</p>
                ) : checkinNotes.length === 0 ? (
                  <p className="text-[11.5px] text-gray-400">No notes for this employee/period yet.</p>
                ) : checkinNotes.map((n) => (
                  <div key={n.id} className="text-[12px] rounded border border-[#eef0f4] px-2.5 py-1.5">
                    <p className="text-[#16203b]">{n.note}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{n.authorId} · {new Date(n.at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Mid-year review */}
            <div>
              <p className="text-[12px] font-semibold text-[#16203b] mb-2 flex items-center gap-1.5">
                <CalendarClock size={13} className="text-[#0052cc]" /> Mid-year summary ({fy})
              </p>
              <div className="flex gap-2">
                <Select value={midYearEmployee} onValueChange={setMidYearEmployee}>
                  <SelectTrigger className="h-8 text-[12.5px] flex-1"><SelectValue placeholder="Employee" /></SelectTrigger>
                  <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.id}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={loadMidYear} disabled={midYearLoading}>View</Button>
              </div>
              {midYear && (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] text-gray-400">
                    H1 consolidation, read-only — {midYear.isFinal ? "finalized" : "not final; further check-ins still permitted"}
                  </p>
                  {midYear.evaluations.length === 0 ? (
                    <p className="text-[11.5px] text-gray-400">No H1 evaluations yet.</p>
                  ) : midYear.evaluations.map((e) => (
                    <div key={e.assignmentId} className="text-[12px] rounded border border-[#eef0f4] px-2.5 py-1.5 flex items-center justify-between">
                      <span className="text-gray-400 text-[11px]">{e.assignmentId}</span>
                      <span>self {e.self?.rating ?? "—"} · mgr {e.reviewer?.rating ?? "—"}</span>
                    </div>
                  ))}
                  {midYear.checkInNotes.length > 0 && (
                    <div className="pt-1">
                      <p className="text-[11px] text-gray-400 mb-1">Check-in notes</p>
                      {midYear.checkInNotes.map((n) => (
                        <p key={n.id} className="text-[12px] text-[#16203b]">{n.note}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. Goal sheet import / export (.xlsx) — Goals tab */}
      {isSetter && tab === "goals" && (
        <div className="ff-card p-5">
          <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2 mb-1">
            <Upload size={15} className="text-[#0052cc]" /> Goal Sheet Import / Export
          </h3>
          <p className="text-[12px] text-gray-500 mb-3">Optional — <b>Manager/Admin</b> bulk-load goals from the standard .xlsx template, or export an employee's goal sheet.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-[#16203b]">Import ({fy})</p>
              <input type="file" accept=".xlsx"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                className="block w-full text-[12px] text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-[4px] file:border-0 file:text-[12px] file:font-medium file:bg-[#eef4fa] file:text-[#0052cc] hover:file:bg-[#e0eafc]" />
              <Button size="sm" onClick={doImport} disabled={!importFile} className="bg-[#0052cc] hover:bg-[#003d99]">
                <Upload size={12} className="mr-1.5" /> Import
              </Button>
              <p className="text-[11px] text-gray-400">Standard template: Quarterly Team Goals + Individual Annual Goals. Section weights must total 10; re-import is idempotent.</p>
            </div>
            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-[#16203b]">Export ({fy})</p>
              <Select value={exportEmployee} onValueChange={setExportEmployee}>
                <SelectTrigger className="h-8 text-[12.5px]"><SelectValue placeholder="Employee" /></SelectTrigger>
                <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.id}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={doExport} disabled={!exportEmployee}>
                <Download size={12} className="mr-1.5" /> Download .xlsx
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Framework dialog */}
      <Dialog open={fwOpen} onOpenChange={setFwOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Configure framework — {fy}</DialogTitle>
            <DialogDescription>Pick cadences and the team/individual split (must total 100). Periods are derived automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label className="mb-1.5 block">Active cadences</Label>
              <div className="flex flex-wrap gap-2">
                {["QUARTERLY", "ANNUAL", "MONTHLY"].map((c) => (
                  <button key={c} onClick={() => toggleCadence(c)}
                    className={`px-3 py-1 rounded-full text-[12px] font-medium border ${fwForm.cadences.includes(c) ? "bg-[#0052cc] text-white border-[#0052cc]" : "border-gray-300 text-gray-500"}`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tw">Team weight %</Label>
                <Input id="tw" type="number" min={0} max={100} value={fwForm.team}
                  onChange={(e) => setFwForm({ ...fwForm, team: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Individual weight %</Label>
                <Input value={100 - fwForm.team} disabled />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Fiscal year starts in</Label>
              <Select value={String(fwForm.startMonth)} onValueChange={(v) => setFwForm({ ...fwForm, startMonth: parseInt(v, 10) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-400">Quarter windows are derived from this — e.g. an April start gives Q1 Apr–Jun.</p>
            </div>
            <label className="flex items-center gap-2 pt-1 cursor-pointer">
              <input type="checkbox" checked={fwForm.announce}
                onChange={(e) => setFwForm({ ...fwForm, announce: e.target.checked })}
                className="accent-[#0052cc]" />
              <span className="text-[12.5px] text-[#16203b]">Notify everyone the cycle is open</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFwOpen(false)}>Cancel</Button>
            <Button onClick={saveFramework} className="bg-[#0052cc] hover:bg-[#003d99]">
              {framework ? "Save" : "Open cycle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New goal dialog */}
      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>New goal (DRAFT)</DialogTitle>
            <DialogDescription>Authored as DRAFT. Section weights must total 10 before cascade.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-[1.4fr_1fr_auto] gap-3">
              <div className="space-y-1.5">
                <Label>Pillar</Label>
                <Select value={goalForm.pillar} onValueChange={(v) => setGoalForm({ ...goalForm, pillar: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PILLARS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={goalForm.goalType} onValueChange={(v) => setGoalForm({ ...goalForm, goalType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="OKR">OKR</SelectItem><SelectItem value="KPI">KPI</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 w-20">
                <Label>Weight</Label>
                <Input type="number" min={0} max={10} value={goalForm.defaultWeight}
                  onChange={(e) => setGoalForm({ ...goalForm, defaultWeight: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Measure / Key result</Label>
              <Input placeholder="e.g. Roadmap Adherence (Release A)" value={goalForm.measure}
                onChange={(e) => setGoalForm({ ...goalForm, measure: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={goalForm.description} onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Scoring rubric (1/3/5)</Label>
              <Input placeholder="5 = on-time, zero defects · 3 = minor slip · 1 = major slip"
                value={goalForm.baseCriteria} onChange={(e) => setGoalForm({ ...goalForm, baseCriteria: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Competencies <span className="text-gray-400 font-normal">· comma-separated</span></Label>
              <Input placeholder="Technical Excellence, Collaboration" value={goalForm.competencies}
                onChange={(e) => setGoalForm({ ...goalForm, competencies: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalOpen(false)}>Cancel</Button>
            <Button onClick={createGoal} className="bg-[#0052cc] hover:bg-[#003d99]">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cascade dialog */}
      <Dialog open={!!cascadeGoal} onOpenChange={(o) => { if (!o) setCascadeGoal(null); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Cascade goal</DialogTitle>
            <DialogDescription>"{cascadeGoal?.measure}" → one assignment per employee (PENDING_ACCEPTANCE). The pillar's weights must total 10.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label>Employees <span className="text-gray-400 font-normal">· from your team directory</span></Label>
            {people.length === 0 ? (
              <p className="text-[12px] text-gray-400 py-2">
                No one in your directory yet. An admin can add employees via <code>POST /people</code>.
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1 border border-[#eef0f4] rounded-[6px] p-2">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-[5px] hover:bg-[#f3f4f6] cursor-pointer text-[13px]">
                    <input type="checkbox" checked={cascadeTo.has(p.id)} onChange={() => toggleCascadeTarget(p.id)}
                      className="accent-[#0052cc]" />
                    <span className="text-[#16203b] font-medium">{p.id}</span>
                    <span className="text-gray-400 text-[11px]">{p.title || p.role}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCascadeGoal(null)}>Cancel</Button>
            <Button onClick={doCascade} className="bg-[#0052cc] hover:bg-[#003d99]">Cascade</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request-change dialog */}
      <Dialog open={!!changeFor} onOpenChange={(o) => { if (!o) setChangeFor(null); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Request change</DialogTitle>
            <DialogDescription>Tweak your weight/criteria. Your section weights must still total 10. Sends back to your manager to re-accept.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Weight</Label>
              <Input type="number" min={0} max={10} value={changeForm.weight}
                onChange={(e) => setChangeForm({ ...changeForm, weight: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Tweaked criteria</Label>
              <Input value={changeForm.criteria} onChange={(e) => setChangeForm({ ...changeForm, criteria: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeFor(null)}>Cancel</Button>
            <Button onClick={submitChange} className="bg-[#0052cc] hover:bg-[#003d99]">Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit dialog */}
      <Dialog open={!!auditFor} onOpenChange={(o) => { if (!o) setAuditFor(null); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Audit trail</DialogTitle>
            <DialogDescription>{auditFor?.measure}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1 max-h-80 overflow-y-auto">
            {auditRows.length === 0 ? (
              <p className="text-[12px] text-gray-400">No entries.</p>
            ) : auditRows.map((e) => (
              <div key={e.id} className="flex items-start gap-2.5">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#eef4fa] text-[#0052cc] flex-shrink-0">{e.action}</span>
                <div className="min-w-0">
                  <p className="text-[12px] text-[#16203b]">{e.detail}</p>
                  <p className="text-[10px] text-gray-400 flex items-center gap-1"><Clock size={9} /> {e.actor} · {new Date(e.at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Goal-scoped feedback dialog */}
      <Dialog open={!!feedbackFor} onOpenChange={(o) => { if (!o) setFeedbackFor(null); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Feedback on this goal</DialogTitle>
            <DialogDescription>
              {feedbackFor?.measure} · for <b className="text-[#16203b]">{feedbackFor?.ownerId}</b>. Scoped to this goal — separate from general continuous feedback.
            </DialogDescription>
          </DialogHeader>
          {/* Composer */}
          <div className="space-y-2 py-1">
            <div className="flex gap-2">
              <Select value={fbCategory} onValueChange={setFbCategory}>
                <SelectTrigger className="h-8 w-44 text-[12.5px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FEEDBACK_CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {fbCategory === "STRETCH" && <span className="self-center text-[10.5px] text-[#0f9d58]">raises 9-box potential</span>}
            </div>
            <textarea rows={2} value={fbText} onChange={(e) => setFbText(e.target.value.slice(0, 2000))}
              placeholder="Specific, helpful feedback on this goal…"
              className="w-full px-3 py-2 text-[12.5px] border border-input rounded-[4px] bg-background text-[#16203b] focus:outline-none focus:border-[#0052cc] resize-none" />
            <div className="flex justify-end">
              <Button size="sm" onClick={submitGoalFeedback} className="bg-[#0052cc] hover:bg-[#003d99]">
                <MessageSquare size={12} className="mr-1.5" /> Add feedback
              </Button>
            </div>
          </div>
          {/* Existing goal feedback */}
          <div className="space-y-1.5 py-1 max-h-64 overflow-y-auto border-t border-[#f3f4f6] pt-2">
            {fbLoading ? (
              <p className="text-[12px] text-gray-400">Loading…</p>
            ) : goalFeedback.length === 0 ? (
              <p className="text-[12px] text-gray-400">No feedback on this goal yet.</p>
            ) : goalFeedback.map((f) => (
              <div key={f.id} className="rounded-[8px] border border-[#eef0f4] px-3 py-2">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
                    {FEEDBACK_CATEGORIES.find((c) => c.key === f.category)?.label ?? f.category}
                  </span>
                  <span className="text-[10.5px] text-gray-400">{f.from} · {new Date(f.at).toLocaleDateString()}</span>
                </div>
                <p className="text-[12px] text-[#16203b] leading-snug">{f.text}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
