import { useEffect, useState } from "react";
import {
  Settings2, Plus, GitBranch, Check, X, Pencil, Clock, History, Lock, Target, Crosshair,
  NotebookPen, CalendarClock, Upload, Download,
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

interface Period { id: string; code: string; cadence: string; label: string; window: string; locked: boolean; }
interface Framework {
  id: string; fiscalYear: string; activeCadences: string[];
  teamWeightPct: number; individualWeightPct: number; periods: Period[];
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
const acceptColor = (s: string) =>
  s === "ACCEPTED" ? "text-green-600" : s === "REJECTED" ? "text-red-600" : "text-gray-400";

export default function GoalLifecyclePanel() {
  const { role, user } = useAuth();
  const isSetter = role === "manager" || role === "admin";
  const isAdmin = role === "admin";

  const [fy, setFy] = useState("FY26-27");
  const [framework, setFramework] = useState<Framework | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  // Directory (UAM stub, pm-goal /people) — defaults to "my team" server-side
  // for managers, everyone for admins. Replaces free-text cascade targets.
  const [people, setPeople] = useState<Person[]>([]);

  const [fwOpen, setFwOpen] = useState(false);
  const [fwForm, setFwForm] = useState({ cadences: ["QUARTERLY", "ANNUAL"], team: 60 });

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
      setAssignments(asg.filter((a) => a.fiscalYear === year));
    } catch (err) {
      toast.error("Could not load pm-goal data", { description: (err as Error).message });
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
    try {
      await pmGoal.post("/framework", {
        fiscalYear: fy, activeCadences: fwForm.cadences,
        teamWeightPct: fwForm.team, individualWeightPct: 100 - fwForm.team,
      });
      toast.success("Framework saved");
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

  return (
    <div className="space-y-4">
      {/* FY selector */}
      <div className="ff-card p-4 mb-4 flex flex-wrap items-center gap-3">
        <span className="text-[12px] font-medium text-gray-500">Fiscal year</span>
        <Input value={fy} onChange={(e) => setFy(e.target.value)} className="w-32 h-8 text-[13px]" />
        <Button size="sm" variant="outline" onClick={() => loadAll(fy)}>Load</Button>
        <span className="ml-auto text-[11px] text-gray-400">
          Signed in as <b className="text-[#16203b]">{user.name}</b> · {role}
        </span>
      </div>

      {/* 1. Framework */}
      <div className="ff-card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2">
            <Settings2 size={15} className="text-[#0052cc]" /> Performance Framework
          </h3>
          {isAdmin && (
            <Button size="sm" onClick={() => {
              setFwForm({
                cadences: framework?.activeCadences ?? ["QUARTERLY", "ANNUAL"],
                team: framework?.teamWeightPct ?? 60,
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

      {/* 2. Goal authoring (setters) */}
      {isSetter && (
        <div className="ff-card p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2">
              <Target size={15} className="text-[#0052cc]" /> Goal Authoring
            </h3>
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
      <div className="ff-card p-5">
        <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2 mb-3">
          <GitBranch size={15} className="text-[#0052cc]" /> Assignments &amp; Acceptance
        </h3>
        {assignments.length === 0 ? (
          <p className="text-[12.5px] text-gray-400">No assignments yet. {isSetter ? "Cascade a goal to create them." : "Wait for your manager to cascade goals to you."}</p>
        ) : (
          <div className="space-y-2">
            {assignments.map((a) => {
              const own = a.ownerId === user.name;
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
                        <span className={`ml-1 ${acceptColor(a.employeeAcceptance)}`}>self {a.employeeAcceptance}</span> ·
                        <span className={`ml-1 ${acceptColor(a.managerAcceptance)}`}>mgr {a.managerAcceptance}</span>
                      </p>
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
                      {/* Early completion: owner requests on an ACTIVE goal */}
                      {own && a.status === "ACTIVE" && (
                        <button onClick={() => act(`/assignments/${a.id}/request-completion`, {}, "Completion requested")}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-medium text-teal-700 border border-teal-300 hover:bg-teal-50">
                          <Check size={11} /> Mark done early
                        </button>
                      )}
                      {/* Manager approves/rejects a pending completion request */}
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
                      <button onClick={() => openAudit(a)} title="Audit trail"
                        className="p-1 rounded hover:bg-[#eef0f4] text-gray-400"><History size={14} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Quarterly check-in notes + mid-year review (reviewers) */}
      {isSetter && (
        <div className="ff-card p-5">
          <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2 mb-3">
            <NotebookPen size={15} className="text-[#0052cc]" /> Check-in Notes &amp; Mid-Year Review
          </h3>
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

      {/* 5. Goal sheet import / export (.xlsx) */}
      {isSetter && (
        <div className="ff-card p-5">
          <h3 className="text-[14px] font-bold text-[#16203b] flex items-center gap-2 mb-3">
            <Upload size={15} className="text-[#0052cc]" /> Goal Sheet Import / Export
          </h3>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFwOpen(false)}>Cancel</Button>
            <Button onClick={saveFramework} className="bg-[#0052cc] hover:bg-[#003d99]">Save</Button>
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
    </div>
  );
}
