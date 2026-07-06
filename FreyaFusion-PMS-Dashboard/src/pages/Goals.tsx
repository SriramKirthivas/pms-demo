import AppLayout from "@/components/AppLayout";
import GoalLifecyclePanel from "@/components/GoalLifecyclePanel";
import { useEffect, useState } from "react";
import { Plus, MoreHorizontal, Pencil, Trash2, Target, GraduationCap, Check, Clock, Crosshair, ListChecks, TrendingUp, GitBranch, ChevronDown, X, Star, Lock, Unlock, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { pmGoal, pmEval } from "@/lib/pmApi";
import { FALLBACK_AVATAR } from "@/lib/avatar";

const CURRENT_FY = "FY26-27";

// pm-goal GET /periods?fiscalYear= row — used to resolve the ad-hoc LockState's
// `period` code (e.g. "Q1") to the real periodId the lock/unlock-request
// endpoints require.
interface RealPeriod { id: string; code: string; locked?: boolean; }

const RATING_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

interface SheetGoal {
  id: string; objective: string; measure: string; target: string; description: string; criteria: string; weight: number;
  selfRating: number | null; managerRating: number | null; period: string; part: string;
  proposedBy: string; approvalStatus: string; companyGoalId: string | null;
}
interface CompanyGoalLite { id: string; objective: string; owner: string; }
interface Section {
  key: string; period: string; part: string; pillar: "quarterly" | "annual";
  label: string; window: string; ipfWeight: number; totalWeight: number; goals: SheetGoal[];
}
interface Sheet {
  owner: string; ownerAvatar: string; ownerTitle: string; ownerCountry: string;
  viewer: string; viewerRole: string; fy: string; sections: Section[];
}
interface PersonLite { id: string; }
interface LockState {
  period: string; locked: boolean; lockedBy: string;
  unlockRequested: boolean; unlockRequestedBy: string; unlockReason: string;
  reqId: string | null; // real pm-goal unlock-request id, needed to decide it
}
interface UnlockRequestRow {
  id: string; periodId: string; requestedBy: string; reason: string; status: string;
}

// IPF band colour for a 1–5 score (greener = stronger).
const scoreColor = (v: number | null) =>
  v == null ? "#e5e7eb" : v >= 3.8 ? "#16a34a" : v >= 2.9 ? "#0052cc" : v >= 2.1 ? "#f59e0b" : "#dc2626";

function ScoreBar({ value }: { value: number | null }) {
  const pct = value == null ? 0 : (value / 5) * 100;
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: scoreColor(value) }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums w-8 text-right" style={{ color: scoreColor(value) }}>
        {value == null ? "—" : value.toFixed(1)}
      </span>
    </div>
  );
}

// A rating slot: editable dropdown (half-steps) when permitted, else a read-only bar.
function RatingControl({ value, editable, onChange }: {
  value: number | null; editable: boolean; onChange: (v: number) => void;
}) {
  if (!editable) return <ScoreBar value={value} />;
  return (
    <div className="flex items-center gap-2">
      <Select value={value != null ? String(value) : ""} onValueChange={(v) => onChange(parseFloat(v))}>
        <SelectTrigger className="h-7 w-[78px] text-[12px] px-2"><SelectValue placeholder="Rate…" /></SelectTrigger>
        <SelectContent>
          {RATING_OPTIONS.map((o) => <SelectItem key={o} value={String(o)} className="text-[12px]">{o.toFixed(1)}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${value == null ? 0 : (value / 5) * 100}%`, background: scoreColor(value) }} />
      </div>
    </div>
  );
}

// Average of the available manager ratings (the official IPF input).
const avgOf = (goals: { managerRating: number | null }[]) => {
  const r = goals.map((g) => g.managerRating).filter((v): v is number => v != null);
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
};

// Group a section's goals by their Objective, preserving first-seen order.
function groupByObjective(goals: SheetGoal[]): { objective: string; goals: SheetGoal[] }[] {
  const order: string[] = [];
  const map = new Map<string, SheetGoal[]>();
  for (const g of goals) {
    const key = g.objective?.trim() || "Other goals";
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key)!.push(g);
  }
  return order.map((objective) => ({ objective, goals: map.get(objective)! }));
}

function StatTile({ icon: Icon, label, value, tint }: { icon: typeof Target; label: string; value: string; tint: string }) {
  return (
    <div className="ff-card px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-[9px] flex items-center justify-center flex-shrink-0" style={{ background: `${tint}1a` }}>
        <Icon size={16} style={{ color: tint }} />
      </div>
      <div className="min-w-0">
        <p className="text-[18px] font-bold text-[#16203b] leading-none">{value}</p>
        <p className="text-[11px] text-gray-400 mt-1 leading-none truncate">{label}</p>
      </div>
    </div>
  );
}

// Where a goal is in its lifecycle — drives the small stage chip on each card.
function goalStage(g: SheetGoal): { label: string; tint: string; bg: string } {
  if (g.approvalStatus === "pending") return { label: "Awaiting approval", tint: "#b45309", bg: "#fef3c7" };
  if (g.managerRating == null) return { label: "To be rated", tint: "#0052cc", bg: "#e6eefa" };
  return { label: "Scored", tint: "#15803d", bg: "#dcfce7" };
}

// Collapsible "How it works" guide — the OKR → KPI → propose → approve → rate flow.
// Remembers if the user dismisses it so it doesn't nag on every visit.
const HELP_KEY = "ff-goals-help-open";
function HowItWorks() {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(HELP_KEY) !== "0"; } catch { return true; }
  });
  const toggle = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(HELP_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };

  const steps = [
    { icon: Target, tint: "#0052cc", title: "Set an Objective", body: "The qualitative aim for the quarter or year — what you want to achieve." },
    { icon: Crosshair, tint: "#7c3aed", title: "Add Key Results (KPIs)", body: "Each objective gets measurable key results, each with a Target and a weight." },
    { icon: Check, tint: "#0f9d58", title: "Propose & approve", body: "You or your manager proposes a goal; the other approves it before it counts." },
    { icon: Star, tint: "#f59e0b", title: "Rate at review", body: "You self-rate (reference); your manager's 1–5 is the official IPF score." },
  ];

  if (!open) {
    return (
      <button onClick={() => toggle(true)}
        className="ff-card w-full px-4 py-2.5 mb-4 flex items-center gap-2 text-[12.5px] font-medium text-[#0052cc] hover:bg-[#f4f8fd] transition-colors">
        <ChevronDown size={15} /> How goal-setting works
      </button>
    );
  }
  return (
    <div className="ff-card p-5 mb-4 bg-gradient-to-br from-[#f4f8fd] to-white">
      <div className="flex items-start justify-between gap-3 mb-3.5">
        <div>
          <h3 className="text-[14px] font-bold text-[#16203b]">How goal-setting works</h3>
          <p className="text-[12px] text-gray-500 mt-0.5">
            Goals combine <span className="font-medium text-[#16203b]">OKRs</span> (the aim) with <span className="font-medium text-[#16203b]">KPIs</span> (the measure). Team Goals are 60% of your score, Individual Goals 40% — together they form your <span className="font-medium text-[#16203b]">IPF</span>, which places you on the talent matrix.
          </p>
        </div>
        <button onClick={() => toggle(false)} title="Hide" className="p-1 rounded hover:bg-white text-gray-400 flex-shrink-0"><X size={15} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s, i) => (
          <div key={s.title} className="relative rounded-[10px] border border-[#e7ecf3] bg-white px-3.5 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ background: `${s.tint}1a` }}>
                <s.icon size={14} style={{ color: s.tint }} />
              </div>
              <span className="text-[11px] font-bold text-gray-300">{i + 1}</span>
              <p className="text-[12.5px] font-semibold text-[#16203b] leading-tight">{s.title}</p>
            </div>
            <p className="text-[11.5px] text-gray-500 leading-snug">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Goals() {
  const { user, role } = useAuth();
  const canManage = role === "manager" || role === "admin";
  // Lifecycle (the real pm-goal cascade/acceptance flow) is the default view;
  // the legacy Goal Sheet tab still reads from the retired ad-hoc backend.
  const [topView, setTopView] = useState<"sheet" | "lifecycle">("lifecycle");

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [locks, setLocks] = useState<LockState[]>([]);
  const [companyGoals, setCompanyGoals] = useState<CompanyGoalLite[]>([]);
  const [owner, setOwner] = useState<string>(user.name); // whose sheet (managers can switch)
  const [tab, setTab] = useState<"quarterly" | "annual">("quarterly");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [target, setTarget] = useState<{ period: string; part: string; label: string } | null>(null);
  const [form, setForm] = useState({ objective: "", measure: "", target: "", description: "", criteria: "", weight: "5", companyGoalId: "" });

  const [deleteTarget, setDeleteTarget] = useState<SheetGoal | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const [unlockPeriod, setUnlockPeriod] = useState<string | null>(null);
  const [unlockReason, setUnlockReason] = useState("");
  // Real pm-goal periods for the fiscal year, keyed by code (e.g. "Q1") so the
  // lock/unlock actions below can resolve the periodId the API expects.
  const [realPeriods, setRealPeriods] = useState<RealPeriod[]>([]);

  const periodIdFor = (code: string) => realPeriods.find((p) => p.code === code)?.id;

  const loadLocks = () =>
    pmGoal.get<RealPeriod[]>(`/periods?fiscalYear=${encodeURIComponent(CURRENT_FY)}`)
      .then(async (periods) => {
        setRealPeriods(periods);
        // For each locked period, look up its pending unlock request (if
        // any) so admins can see and decide on it — pm-goal has no
        // "pending requests across periods" endpoint, so this is per-period.
        const pending = await Promise.all(
          periods.map((p) =>
            p.locked
              ? pmGoal.get<UnlockRequestRow[]>(`/periods/${p.id}/unlock-requests?status=PENDING`).catch(() => [])
              : Promise.resolve([] as UnlockRequestRow[]),
          ),
        );
        setLocks(periods.map((p, i): LockState => {
          const req = pending[i][0]; // most recent pending request, if any
          return {
            period: p.code,
            locked: !!p.locked,
            lockedBy: "",
            unlockRequested: !!req,
            unlockRequestedBy: req?.requestedBy ?? "",
            unlockReason: req?.reason ?? "",
            reqId: req?.id ?? null,
          };
        }));
      })
      .catch(() => { setRealPeriods([]); setLocks([]); });

  const load = (who?: string) => {
    const q = canManage && who && who !== user.name ? `?owner=${encodeURIComponent(who)}` : "";
    setLoading(true);
    return api.get<Sheet>(`/goals${q}`)
      .then(setSheet)
      .catch(() => setSheet(null))
      .finally(() => setLoading(false));
  };
  // The legacy Goal Sheet view is no longer rendered (see the render block),
  // so its data no longer loads on mount — this avoids failed requests to the
  // retired :8000 backend. The pm-goal Lifecycle flow loads its own data
  // inside GoalLifecyclePanel. The load()/loadLocks() helpers remain defined
  // for the dormant sheet JSX below but are never invoked.

  const lockOf = (period: string) => locks.find((l) => l.period === period);

  const lockPeriod = async (period: string) => {
    const periodId = periodIdFor(period);
    if (!periodId) { toast.error("Could not lock", { description: `Unknown period ${period}` }); return; }
    try { await pmGoal.post(`/periods/${periodId}/lock`, {}); toast.success(`${period} locked`); await loadLocks(); }
    catch (err) { toast.error("Could not lock", { description: (err as Error).message }); }
  };
  // Reopen = an admin approving the pending unlock request. Needs the real
  // request id (from loadLocks' /unlock-requests?status=PENDING lookup) and
  // the {decision: "APPROVE"|"REJECT"} payload pm-goal's decision endpoint
  // actually expects.
  const reopenPeriod = async (period: string) => {
    const periodId = periodIdFor(period);
    const reqId = lockOf(period)?.reqId;
    if (!periodId || !reqId) { toast.error("Could not reopen", { description: `No pending unlock request for ${period}` }); return; }
    try {
      await pmGoal.post(`/periods/${periodId}/unlock-request/${reqId}/decision`, { decision: "APPROVE" });
      toast.success(`${period} reopened`); await loadLocks();
    } catch (err) { toast.error("Could not reopen", { description: (err as Error).message }); }
  };
  const declineUnlock = async (period: string) => {
    const periodId = periodIdFor(period);
    const reqId = lockOf(period)?.reqId;
    if (!periodId || !reqId) { toast.error("Could not decline", { description: `No pending unlock request for ${period}` }); return; }
    try {
      await pmGoal.post(`/periods/${periodId}/unlock-request/${reqId}/decision`, { decision: "REJECT" });
      toast.success("Request declined"); await loadLocks();
    } catch (err) { toast.error("Could not decline", { description: (err as Error).message }); }
  };
  const submitUnlockRequest = async () => {
    if (!unlockPeriod || !unlockReason.trim()) return;
    const period = unlockPeriod; const reason = unlockReason.trim();
    const periodId = periodIdFor(period);
    setUnlockPeriod(null); setUnlockReason("");
    if (!periodId) { toast.error("Could not send request", { description: `Unknown period ${period}` }); return; }
    try {
      await pmGoal.post(`/periods/${periodId}/unlock-request`, { reason });
      toast.success("Unlock requested", { description: "An admin will review it." }); await loadLocks();
    } catch (err) { toast.error("Could not send request", { description: (err as Error).message }); }
  };

  const companyGoalLabel = (id: string | null) =>
    id ? companyGoals.find((c) => c.id === id)?.objective ?? null : null;

  const sections = sheet?.sections ?? [];
  const shown = sections.filter((s) => s.pillar === tab);
  const sheetOwner = sheet?.owner ?? owner;
  const viewingOwn = sheetOwner === user.name;

  // Summary stats for the active pillar.
  const shownGoals = shown.flatMap((s) => s.goals);
  const objectiveCount = new Set(shownGoals.map((g) => g.objective?.trim() || g.measure)).size;
  const pillarAvg = avgOf(shownGoals);
  const pendingCount = shownGoals.filter((g) => g.approvalStatus === "pending").length;
  const pillarPct = tab === "quarterly" ? "60%" : "40%";

  // Who may approve a given pending goal.
  const canApprove = (g: SheetGoal) =>
    g.approvalStatus === "pending" && (
      (g.proposedBy === "employee" && canManage) ||
      (g.proposedBy === "manager" && (role === "admin" || (role === "employee" && viewingOwn)))
    );

  const openAdd = (s: Section) => {
    setEditingId(null);
    setTarget({ period: s.period, part: s.part, label: s.label });
    setForm({ objective: "", measure: "", target: "", description: "", criteria: "", weight: "5", companyGoalId: "" });
    setFormOpen(true);
  };
  const openEdit = (g: SheetGoal, label: string) => {
    setEditingId(g.id);
    setTarget({ period: g.period, part: g.part, label });
    setForm({ objective: g.objective, measure: g.measure, target: g.target, description: g.description, criteria: g.criteria, weight: String(g.weight), companyGoalId: g.companyGoalId ?? "" });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.measure.trim()) { toast.error("Enter a goal measure"); return; }
    const body = {
      objective: form.objective.trim(), measure: form.measure.trim(), target: form.target.trim(),
      description: form.description.trim(),
      criteria: form.criteria.trim(), weight: Math.max(0, Math.min(10, parseInt(form.weight, 10) || 0)),
      companyGoalId: form.companyGoalId,
    };
    try {
      if (editingId) {
        await api.patch(`/goals/${editingId}`, body);
        toast.success("Goal updated");
      } else {
        await api.post("/goals", { ...body, period: target!.period, part: target!.part, owner: sheetOwner });
        toast.success("Goal proposed", { description: canManage ? "Awaiting employee approval" : "Awaiting manager approval" });
      }
      await load(owner);
      setFormOpen(false);
    } catch (err) { toast.error("Could not save", { description: (err as Error).message }); }
  };

  const approve = async (id: string) => {
    try { await api.post(`/goals/${id}/approve`, {}); toast.success("Goal approved"); await load(owner); }
    catch (err) { toast.error("Could not approve", { description: (err as Error).message }); }
  };

  // Ratings are owned by pm-eval and submitted against the goal's assignment
  // id (the Goal Sheet's goal id doubles as the pm-goal assignment id here).
  const rateSelf = async (id: string, rating: number) => {
    try { await pmEval.post("/evaluations/self", { assignmentId: id, rating }); toast.success("Self rating saved"); await load(owner); }
    catch (err) { toast.error("Could not save rating", { description: (err as Error).message }); }
  };
  const rateManager = async (id: string, rating: number) => {
    try { await pmEval.post("/evaluations/reviewer", { assignmentId: id, rating }); toast.success("Manager rating saved"); await load(owner); }
    catch (err) { toast.error("Could not save rating", { description: (err as Error).message }); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !deleteReason.trim()) return;
    const id = deleteTarget.id; const reason = deleteReason.trim();
    setDeleteTarget(null); setDeleteReason("");
    try { await api.del(`/goals/${id}`, { reason }); toast.success("Goal deleted"); await load(owner); }
    catch (err) { toast.error("Could not delete", { description: (err as Error).message }); }
  };

  return (
    <AppLayout pageTitle="Goal Setting" breadcrumb="Performance">
      {/* The Goals page is the pm-goal Lifecycle flow. The old "Goal Sheet"
          view (below, dormant) read from the retired :8000 mock backend that
          was split into the pm-* services, so it can't load here — the tab
          switcher was removed and topView stays "lifecycle". */}
      <GoalLifecyclePanel />

      {topView === "sheet" && (<>
      {/* Sheet header */}
      <div className="ff-card p-5 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3.5 min-w-0">
          <img
            src={sheet?.ownerAvatar || FALLBACK_AVATAR}
            alt={sheetOwner}
            className="w-12 h-12 rounded-full object-cover ring-2 ring-[#eef0f4] flex-shrink-0"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_AVATAR; }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[16px] font-bold text-[#16203b] leading-tight">{sheetOwner}</h2>
              {viewingOwn && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#eef4fa] text-[#0052cc] uppercase tracking-wide">You</span>}
              {sheet?.ownerCountry && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">{sheet.ownerCountry}</span>}
            </div>
            <p className="text-[12.5px] text-gray-500 leading-tight mt-0.5">
              {sheet?.ownerTitle ? `${sheet.ownerTitle} · ` : ""}Goal Sheet {sheet?.fy ?? "FY26-27"}
            </p>
            <p className="text-[11px] text-gray-400 leading-tight mt-0.5">Either party can propose a goal; the other approves it.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {canManage && people.length > 0 && (
            <Select value={owner} onValueChange={(v) => { setOwner(v); load(v); }}>
              <SelectTrigger className="w-52"><SelectValue placeholder="View a sheet" /></SelectTrigger>
              <SelectContent>
                {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.id}{p.id === user.name ? " (me)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* How it works — explains the OKR → KPI → propose → approve → rate flow */}
      <HowItWorks />

      {/* Pillar tabs */}
      <div className="flex gap-1 mb-4 bg-white border border-[#ebedf2] rounded-[8px] p-1 w-fit">
        {([["quarterly", "Team Goals · 60%", Target], ["annual", "Individual Goals · 40%", GraduationCap]] as const).map(([k, lbl, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-[5px] text-[12.5px] font-medium transition-colors ${tab === k ? "bg-[#0052cc] text-white" : "text-gray-500 hover:text-[#16203b]"}`}>
            <Icon size={13} /> {lbl}
          </button>
        ))}
      </div>

      {/* Summary strip for the active pillar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatTile icon={Target} label={`Objectives · ${pillarPct} of IPF`} value={String(objectiveCount)} tint="#0052cc" />
        <StatTile icon={ListChecks} label="Key results / KPIs" value={String(shownGoals.length)} tint="#7c3aed" />
        <StatTile icon={TrendingUp} label="Avg manager score" value={pillarAvg == null ? "—" : `${pillarAvg.toFixed(1)}/5`} tint="#16a34a" />
        <StatTile icon={Clock} label="Pending approval" value={String(pendingCount)} tint={pendingCount ? "#f59e0b" : "#94a3b8"} />
      </div>

      {loading && !sheet ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="ff-card overflow-hidden animate-pulse">
              <div className="h-11 bg-[#f4f8fd] border-b border-[#ebedf2]" />
              <div className="px-5 py-4 space-y-3">
                <div className="h-4 w-1/3 rounded bg-gray-100" />
                <div className="h-3 w-2/3 rounded bg-gray-100" />
                <div className="h-3 w-1/2 rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div className="space-y-4">
        {shown.map((s) => {
          const lk = lockOf(s.period);
          const locked = !!lk?.locked;
          // Lock actions live on the first section of each period (avoids dup buttons).
          const isLead = s.part === "team" || s.part === "training";
          return (
          <div key={s.key} className="ff-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-[#f4f8fd] to-white border-b border-[#ebedf2]">
              <div className="flex items-center gap-2.5">
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#0052cc] text-white">{s.ipfWeight}% IPF</span>
                <h3 className="text-[13px] font-semibold text-[#16203b]">{s.label}</h3>
                <span className="text-[11px] text-gray-400">· {s.window}</span>
                {locked && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-200 text-gray-600" title={lk?.lockedBy ? `Locked by ${lk.lockedBy}` : "Locked"}>
                    <Lock size={10} /> Locked
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${s.totalWeight === 10 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>Approved wt {s.totalWeight}/10</span>
                {/* Lock controls (admin) / unlock request (manager) — shown once per period */}
                {isLead && role === "admin" && !locked && (
                  <button onClick={() => lockPeriod(s.period)} className="flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium text-gray-500 border border-gray-300 hover:bg-gray-100 transition-colors" title={`Lock ${s.period} for everyone`}>
                    <Lock size={12} /> Lock {s.period}
                  </button>
                )}
                {isLead && role === "admin" && locked && (
                  <button onClick={() => reopenPeriod(s.period)} className="flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11.5px] font-semibold text-white bg-[#0052cc] hover:bg-[#003d99] transition-colors">
                    <Unlock size={12} /> Reopen {s.period}
                  </button>
                )}
                {isLead && role === "manager" && locked && !lk?.unlockRequested && (
                  <button onClick={() => { setUnlockPeriod(s.period); setUnlockReason(""); }} className="flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium text-[#b45309] border border-amber-300 hover:bg-amber-50 transition-colors">
                    <LockKeyhole size={12} /> Request unlock
                  </button>
                )}
                {isLead && role === "manager" && locked && lk?.unlockRequested && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-medium bg-amber-100 text-amber-700"><Clock size={11} /> Unlock requested</span>
                )}
                {!locked && (
                  <button onClick={() => openAdd(s)} className="flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium text-[#0052cc] border border-[#0052cc]/30 hover:bg-[#e6eefa] transition-colors">
                    <Plus size={12} /> {viewingOwn && !canManage ? "Propose goal" : "Add goal"}
                  </button>
                )}
              </div>
            </div>

            {/* Pending unlock request — shown to the admin who must decide */}
            {isLead && role === "admin" && locked && lk?.unlockRequested && (
              <div className="flex items-center justify-between gap-3 px-5 py-2.5 bg-amber-50 border-b border-amber-100">
                <p className="text-[12px] text-amber-800 min-w-0">
                  <span className="font-semibold">{lk.unlockRequestedBy}</span> requested an unlock: <span className="italic">"{lk.unlockReason}"</span>
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => reopenPeriod(s.period)} className="flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11.5px] font-semibold text-white bg-green-600 hover:bg-green-700"><Check size={12} /> Reopen</button>
                  <button onClick={() => declineUnlock(s.period)} className="px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium text-gray-600 border border-gray-300 hover:bg-gray-100">Decline</button>
                </div>
              </div>
            )}

            {s.goals.length === 0 ? (
              <div className="px-5 py-8 text-center text-[12px] text-gray-400">No goals in this section yet.</div>
            ) : (
              <div className="divide-y divide-[#f0f1f4]">
                {groupByObjective(s.goals).map(({ objective, goals }) => {
                  const objAvg = avgOf(goals);
                  return (
                    <div key={objective} className="px-5 py-4">
                      {/* Objective header (the OKR) */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-7 h-7 rounded-[8px] bg-[#eef4fa] flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Target size={14} className="text-[#0052cc]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Objective</p>
                          <h4 className="text-[14px] font-semibold text-[#16203b] leading-snug mt-1">{objective}</h4>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                          <span className="text-[10px] text-gray-400">{goals.length} KR</span>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums"
                            style={{ background: `${scoreColor(objAvg)}1a`, color: scoreColor(objAvg) }}>
                            {objAvg == null ? "—" : `${objAvg.toFixed(1)}/5`}
                          </span>
                        </div>
                      </div>

                      {/* Key results / KPIs under the objective */}
                      <div className="space-y-2 sm:pl-10">
                        {goals.map((g) => (
                          <div key={g.id} className="rounded-[9px] border border-[#eef0f4] bg-white hover:border-[#cfe0f5] hover:shadow-[0_1px_3px_rgba(16,32,59,0.06)] transition-all p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <Crosshair size={12} className="text-gray-400 flex-shrink-0" />
                                  <p className="text-[13px] font-medium text-[#16203b] leading-snug truncate">{g.measure}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                  {g.target && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] text-[11px] font-medium text-[#0052cc] bg-[#eef4fa]">
                                      Target · {g.target}
                                    </span>
                                  )}
                                  {companyGoalLabel(g.companyGoalId) && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] text-[11px] font-medium text-[#7c3aed] bg-[#f3effd]" title="Cascades from a company objective">
                                      <GitBranch size={10} /> {companyGoalLabel(g.companyGoalId)}
                                    </span>
                                  )}
                                </div>
                                {g.description && <p className="text-[11px] text-gray-400 leading-snug mt-1.5">{g.description}</p>}
                                {g.criteria && <p className="text-[11px] text-gray-400 leading-snug mt-1"><span className="text-gray-300">Rubric:</span> {g.criteria}</p>}
                                {g.approvalStatus === "pending" && (
                                  <span className="inline-flex items-center gap-1 mt-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                                    <Clock size={9} /> Pending {g.proposedBy === "employee" ? "manager" : "employee"} approval
                                  </span>
                                )}
                              </div>

                              <div className="flex items-start gap-2 flex-shrink-0">
                                {(() => { const st = goalStage(g); return (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ background: st.bg, color: st.tint }}>{st.label}</span>
                                ); })()}
                                <span className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold text-gray-500 bg-gray-100" title="Weight within section">wt {g.weight}</span>
                                {canApprove(g) && !locked && (
                                  <button onClick={() => approve(g.id)} className="flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-semibold bg-green-600 text-white hover:bg-green-700 transition-colors">
                                    <Check size={11} /> Approve
                                  </button>
                                )}
                                {canManage && !locked && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button className="p-1 rounded hover:bg-[#eef0f4] text-gray-400"><MoreHorizontal size={13} /></button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-36">
                                      <DropdownMenuItem onClick={() => openEdit(g, s.label)}><Pencil size={13} className="mr-2" /> Edit</DropdownMenuItem>
                                      <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => { setDeleteTarget(g); setDeleteReason(""); }}><Trash2 size={13} className="mr-2" /> Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            </div>

                            {/* Score row: self (owner sets, reference) + manager (official IPF) */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-3 pt-3 border-t border-[#f3f4f6]">
                              <div>
                                <p className="text-[10px] text-gray-400 mb-1">Self <span className="text-gray-300">· reference</span></p>
                                <RatingControl value={g.selfRating} editable={viewingOwn && !locked} onChange={(v) => rateSelf(g.id, v)} />
                              </div>
                              <div>
                                <p className="text-[10px] text-[#0052cc] font-medium mb-1">Manager <span className="text-gray-300 font-normal">· {viewingOwn ? "set by your manager" : "official IPF"}</span></p>
                                <RatingControl value={g.managerRating} editable={canManage && !viewingOwn && !locked} onChange={(v) => rateManager(g.id, v)} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })}
      </div>
      )}

      <div className="ff-card px-5 py-3 mt-4 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
        <span className="font-semibold text-[#16203b]">Rating 1–5:</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#16a34a" }} /> 4–5 Exceeds</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#0052cc" }} /> 3 Meets</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} /> 2 Needs Improvement</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#dc2626" }} /> 1 Unsatisfactory</span>
        <span className="ml-auto text-gray-400">Self for reference · Manager = Final IPF · approved goals count toward the score</span>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Goal" : "Propose Goal"}</DialogTitle>
            <DialogDescription>{target?.label}{!editingId ? ` · will await ${canManage ? "employee" : "manager"} approval` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5"><Label htmlFor="g-obj">Objective <span className="text-gray-400 font-normal">· the aim (OKR)</span></Label>
              <Input id="g-obj" placeholder="e.g. Ship the committed roadmap on schedule" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></div>
            <div className="grid grid-cols-[1.4fr_1fr_auto] gap-3">
              <div className="space-y-1.5"><Label htmlFor="g-measure">KPI / Key result</Label>
                <Input id="g-measure" placeholder="e.g. Roadmap Adherence (Release A)" value={form.measure} onChange={(e) => setForm({ ...form, measure: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="g-target">Target</Label>
                <Input id="g-target" placeholder="e.g. >= 95%" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /></div>
              <div className="space-y-1.5 w-20"><Label htmlFor="g-wt">Weight /10</Label>
                <Input id="g-wt" type="number" min={0} max={10} value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="g-desc">Description <span className="text-gray-400 font-normal">· optional</span></Label>
              <Input id="g-desc" placeholder="What good looks like" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            {companyGoals.length > 0 && (
              <div className="space-y-1.5"><Label>Aligns to company objective <span className="text-gray-400 font-normal">· optional cascade</span></Label>
                <Select value={form.companyGoalId || "none"} onValueChange={(v) => setForm({ ...form, companyGoalId: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Not aligned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not aligned</SelectItem>
                    {companyGoals.map((c) => <SelectItem key={c.id} value={c.id}>{c.objective}</SelectItem>)}
                  </SelectContent>
                </Select></div>
            )}
            <div className="space-y-1.5"><Label htmlFor="g-crit">Scoring guide <span className="text-gray-400 font-normal">· optional rubric, not a score</span></Label>
              <Input id="g-crit" placeholder="5 = on-time, zero concessions · 3 = minor slip · 1 = major slip" value={form.criteria} onChange={(e) => setForm({ ...form, criteria: e.target.value })} />
              <p className="text-[11px] text-gray-400 leading-snug">Describes how a 1–5 score will be judged at review. The actual Self &amp; Manager scores are entered later on the goal card — not here.</p></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} className="bg-[#0052cc] hover:bg-[#003d99]">{editingId ? "Save changes" : "Propose"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteReason(""); } }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <div className="mx-auto mb-2 w-12 h-12 rounded-full bg-red-50 flex items-center justify-center"><Trash2 size={22} className="text-red-500" /></div>
            <DialogTitle className="text-center">Delete goal?</DialogTitle>
            <DialogDescription className="text-center">Deleting <span className="font-medium text-[#16203b]">"{deleteTarget?.measure}"</span>. Recorded in the audit trail.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="del-reason">Reason for deletion <span className="text-red-500">*</span></Label>
            <textarea id="del-reason" rows={3} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value.slice(0, 2000))}
              placeholder="e.g. Goal superseded after review" className="w-full px-3 py-2 text-[13px] border border-input rounded-[4px] bg-background text-[#16203b] focus:outline-none focus:border-[#0052cc] focus:ring-1 focus:ring-[#0052cc]/20 resize-none" />
            <p className="text-[11px] text-gray-400 text-right">{deleteReason.length}/2000</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteReason(""); }}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={!deleteReason.trim()} onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request-unlock dialog (manager → admin) */}
      <Dialog open={!!unlockPeriod} onOpenChange={(o) => { if (!o) { setUnlockPeriod(null); setUnlockReason(""); } }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <div className="mx-auto mb-2 w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center"><LockKeyhole size={22} className="text-amber-500" /></div>
            <DialogTitle className="text-center">Request unlock — {unlockPeriod}</DialogTitle>
            <DialogDescription className="text-center">An admin will review your request and reopen the period if approved.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="unlock-reason">Reason for the request <span className="text-red-500">*</span></Label>
            <textarea id="unlock-reason" rows={3} value={unlockReason} onChange={(e) => setUnlockReason(e.target.value.slice(0, 2000))}
              placeholder="e.g. A Q1 manager rating needs correcting after calibration" className="w-full px-3 py-2 text-[13px] border border-input rounded-[4px] bg-background text-[#16203b] focus:outline-none focus:border-[#0052cc] focus:ring-1 focus:ring-[#0052cc]/20 resize-none" />
            <p className="text-[11px] text-gray-400 text-right">{unlockReason.length}/2000</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUnlockPeriod(null); setUnlockReason(""); }}>Cancel</Button>
            <Button className="bg-[#0052cc] hover:bg-[#003d99]" disabled={!unlockReason.trim()} onClick={submitUnlockRequest}>Send request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>)}
    </AppLayout>
  );
}
