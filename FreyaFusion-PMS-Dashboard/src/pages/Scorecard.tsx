import AppLayout from "@/components/AppLayout";
import { useCallback, useEffect, useState } from "react";
import { Award, Calculator, CheckCircle2, Info, PenLine } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { pmGoal, pmScore, NotFoundError } from "@/lib/pmApi";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Section {
  label: string;
  window: string;
  ipfWeight: number;
  selfScore: number | null;
  mgrScore: number | null;
  selfContribution: number;
  mgrContribution: number;
}
interface Pillar {
  key: string;
  label: string;
  weightPct: number;
  maxPts: number;
  selfPts: number;
  mgrPts: number;
  sections: Section[];
}
interface Band { range: string; label: string; implication: string; action: string; }
interface ScorecardData {
  id: string | null;
  owner: string;
  fy: string;
  finalSelf: number;
  finalManager: number;
  bandSelf: string;
  bandManager: string;
  state: string; // DRAFT | ACKNOWLEDGED | SIGNED_OFF
  acknowledgedBy: string | null;
  signedOffBy: string | null;
  incompleteReason: string | null;
  partialYear: boolean;
  pillars: Pillar[];
  bands: Band[];
}

const CURRENT_FY = "FY26-27";

// pm-score GET /scorecards — matches service.scorecard_out(): bands are plain
// strings under bandSelf/bandManager, plus the acknowledge/sign-off lifecycle.
interface IPFScorecardRsp {
  id?: string;
  employeeId?: string;
  fiscalYear?: string;
  selfFinalIPF?: number | null;
  managerFinalIPF?: number | null;
  bandSelf?: string | null;
  bandManager?: string | null;
  state?: string;
  acknowledgedBy?: string | null;
  signedOffBy?: string | null;
  incompleteReason?: string | null;
  partialYear?: boolean;
}

interface Person { id: string; }

// pm-score GET /scorecards/breakdown — per-period, per-pillar contribution breakdown.
interface BreakdownSection {
  label?: string;
  period?: string;
  window?: string;
  ipfWeight?: number;
  weightPct?: number;
  selfScore?: number | null;
  mgrScore?: number | null;
  managerScore?: number | null;
  selfContribution?: number;
  mgrContribution?: number;
  managerContribution?: number;
}
interface BreakdownPillar {
  key?: string;
  pillar?: string;
  label?: string;
  weightPct?: number;
  maxPts?: number;
  selfPts?: number;
  mgrPts?: number;
  managerPts?: number;
  sections?: BreakdownSection[];
}
interface BreakdownRsp {
  pillars?: BreakdownPillar[];
}

// Reference performance bands — matches the pm-score default seed data (also
// available via GET /pm-score/bands, but the ranges are static reference info
// so we render them without an extra round-trip).
const DEFAULT_BANDS: Band[] = [
  { range: "4.5–5.0", label: "Exceptional", implication: "Top-tier performance across all pillars", action: "Recognition + Stretch Assignment" },
  { range: "3.8–4.4", label: "Exceeds Expectations", implication: "Consistently strong contribution", action: "Fast-track + Mentorship role" },
  { range: "2.9–3.7", label: "Meets Expectations", implication: "Solid, dependable performance", action: "Coaching + Skill expansion" },
  { range: "2.1–2.8", label: "Needs Improvement", implication: "Falling short of expectations", action: "PIP with 90-day review" },
  { range: "1.0–2.0", label: "Unsatisfactory", implication: "Significant performance gaps", action: "Formal PIP + HR review" },
];

const STATE_STYLE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  ACKNOWLEDGED: "bg-amber-100 text-amber-700",
  SIGNED_OFF: "bg-green-100 text-green-700",
};

const bandColor = (label: string) =>
  label === "Exceptional" ? "bg-green-100 text-green-700"
  : label === "Exceeds Expectations" ? "bg-[#e6eefa] text-[#0052cc]"
  : label === "Meets Expectations" ? "bg-amber-100 text-amber-700"
  : label === "Needs Improvement" ? "bg-orange-100 text-orange-700"
  : "bg-red-100 text-red-700";

function ScoreBar({ value }: { value: number | null }) {
  if (value === null || value === undefined)
    return <span className="text-[12px] text-gray-300">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 ff-progress min-w-[40px]">
        <div className="ff-progress-fill" style={{ width: `${(value / 5) * 100}%` }} />
      </div>
      <span className="text-[12px] font-semibold text-[#16203b] w-9 text-right">{value.toFixed(2)}</span>
    </div>
  );
}

export default function Scorecard() {
  const { user, role } = useAuth();
  const canManage = role === "manager" || role === "admin";
  const [data, setData] = useState<ScorecardData | null>(null);
  // Whose scorecard is shown — managers/admins can switch to a report's.
  const [viewed, setViewed] = useState(user.name);
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const pageTitle = role === "employee" ? "My IPF Scorecard" : role === "admin" ? "Calibration Scorecard" : "IPF Scorecard";

  const load = useCallback((employeeId: string) => {
    const qs = `employeeId=${encodeURIComponent(employeeId)}&fiscalYear=${encodeURIComponent(CURRENT_FY)}`;
    return Promise.allSettled([
      pmScore.get<IPFScorecardRsp>(`/scorecards?${qs}`),
      pmScore.get<BreakdownRsp>(`/scorecards/breakdown?${qs}`),
    ]).then(([scoreRes, breakdownRes]) => {
      // Not-computed-yet (404 / null) or any other failure on the primary
      // scorecard call degrades to the existing "—" empty state rather than
      // rendering zeroed-out numbers or blanking the whole page.
      if (scoreRes.status === "rejected" || !scoreRes.value) {
        if (scoreRes.status === "rejected" && !(scoreRes.reason instanceof NotFoundError)) {
          console.error("Could not load scorecard", scoreRes.reason);
        }
        setData(null);
        return;
      }
      const score = scoreRes.value;
      const breakdown = breakdownRes.status === "fulfilled" ? breakdownRes.value : null;

      const pillars: Pillar[] = (breakdown?.pillars ?? []).map((p) => ({
        key: p.key ?? p.pillar ?? p.label ?? "",
        label: p.label ?? p.pillar ?? "",
        weightPct: p.weightPct ?? 0,
        maxPts: p.maxPts ?? 0,
        selfPts: p.selfPts ?? 0,
        mgrPts: p.mgrPts ?? p.managerPts ?? 0,
        sections: (p.sections ?? []).map((s) => ({
          label: s.label ?? s.period ?? "",
          window: s.window ?? s.period ?? "",
          ipfWeight: s.ipfWeight ?? s.weightPct ?? 0,
          selfScore: s.selfScore ?? null,
          mgrScore: s.mgrScore ?? s.managerScore ?? null,
          selfContribution: s.selfContribution ?? 0,
          mgrContribution: s.mgrContribution ?? s.managerContribution ?? 0,
        })),
      }));

      setData({
        id: score.id ?? null,
        owner: score.employeeId ?? employeeId,
        fy: score.fiscalYear ?? CURRENT_FY,
        finalSelf: score.selfFinalIPF ?? 0,
        finalManager: score.managerFinalIPF ?? 0,
        bandSelf: score.bandSelf ?? "—",
        bandManager: score.bandManager ?? "—",
        state: score.state ?? "DRAFT",
        acknowledgedBy: score.acknowledgedBy ?? null,
        signedOffBy: score.signedOffBy ?? null,
        incompleteReason: score.incompleteReason ?? null,
        partialYear: !!score.partialYear,
        pillars,
        bands: DEFAULT_BANDS,
      });
    });
  }, []);

  useEffect(() => { load(viewed); }, [viewed, load]);
  useEffect(() => {
    if (canManage) pmGoal.get<Person[]>("/people").then(setPeople).catch(() => setPeople([]));
  }, [canManage]);

  // --- Year-end cycle actions: compute → acknowledge (employee) → sign off (HRBP/admin) ---
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await load(viewed);
    } catch (err) {
      toast.error("Action failed", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const compute = () =>
    act(() => pmScore.post("/scorecards/compute", { employeeId: viewed, fiscalYear: CURRENT_FY }),
      `IPF computed for ${viewed}`);
  const acknowledge = () =>
    act(() => pmScore.post(`/scorecards/${data?.id}/acknowledge`), "Scorecard acknowledged");
  const signoff = () =>
    act(() => pmScore.post(`/scorecards/${data?.id}/signoff`), "Scorecard signed off");

  const viewingOwn = viewed === user.name;

  return (
    <AppLayout pageTitle={pageTitle} breadcrumb="Performance">
      {/* Whose scorecard + year-end cycle actions */}
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
        {data && (
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATE_STYLE[data.state] ?? "bg-gray-100 text-gray-600"}`}>
            {data.state.replace("_", " ")}
          </span>
        )}
        {data?.partialYear && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-100 text-purple-700">Partial year</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {canManage && (!data || data.state === "DRAFT") && (
            <Button size="sm" disabled={busy} onClick={compute} className="bg-[#0052cc] hover:bg-[#003d99]">
              <Calculator size={13} className="mr-1.5" /> {data ? "Recompute IPF" : "Compute IPF"}
            </Button>
          )}
          {viewingOwn && data?.id && data.state === "DRAFT" && data.finalManager > 0 && (
            <Button size="sm" disabled={busy} onClick={acknowledge} className="bg-green-600 hover:bg-green-700">
              <CheckCircle2 size={13} className="mr-1.5" /> Acknowledge
            </Button>
          )}
          {role === "admin" && data?.id && data.state === "ACKNOWLEDGED" && (
            <Button size="sm" disabled={busy} onClick={signoff} className="bg-[#16203b] hover:bg-[#0f1b3d]">
              <PenLine size={13} className="mr-1.5" /> HRBP sign-off
            </Button>
          )}
        </div>
      </div>

      {data?.incompleteReason && (
        <div className="ff-card px-4 py-2.5 mb-4 bg-amber-50 border-amber-200 text-[12.5px] text-amber-800">
          Scorecard incomplete: {data.incompleteReason}
        </div>
      )}
      {data?.state === "SIGNED_OFF" && (
        <div className="ff-card px-4 py-2.5 mb-4 bg-green-50 border-green-200 text-[12.5px] text-green-800">
          Signed off by {data.signedOffBy} — this scorecard is final and immutable.
          {data.acknowledgedBy && ` Acknowledged by ${data.acknowledgedBy}.`}
        </div>
      )}

      {/* Final IPF summary */}
      <div className="ff-card p-5 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-[10px] bg-[#e6eefa] flex items-center justify-center">
            <Award size={22} className="text-[#0052cc]" />
          </div>
          <div>
            <p className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">Final IPF · {data?.fy ?? "FY26-27"}</p>
            <h2 className="text-[15px] font-bold text-[#16203b]">{data?.owner ?? viewed}</h2>
            <p className="text-[11px] text-gray-400">Manager score is the official IPF · self for reference</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">Self</p>
            <p className="text-[20px] font-bold text-gray-500 leading-tight">{data ? data.finalSelf.toFixed(2) : "—"}</p>
            <span className="text-[10px] text-gray-400">{data?.bandSelf}</span>
          </div>
          <div className="w-px h-12 bg-[#ebedf2]" />
          <div className="text-center">
            <p className="text-[11px] text-[#0052cc] uppercase tracking-wider font-semibold">Manager (Final)</p>
            <p className="text-[30px] font-bold text-[#0052cc] leading-tight">{data ? data.finalManager.toFixed(2) : "—"}<span className="text-[14px] text-gray-400"> / 5</span></p>
            {data && <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${bandColor(data.bandManager)}`}>{data.bandManager}</span>}
          </div>
        </div>
      </div>

      {/* Pillars */}
      <div className="space-y-4">
        {(data?.pillars ?? []).map((p) => (
          <div key={p.key} className="ff-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-[#f8f9fa] border-b border-[#ebedf2]">
              <div className="flex items-center gap-2.5">
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#0052cc] text-white">{p.weightPct}%</span>
                <h3 className="text-[13px] font-semibold text-[#16203b]">{p.label}</h3>
              </div>
              <div className="flex items-center gap-4 text-[12px]">
                <span className="text-gray-500">Self: <span className="font-semibold text-[#16203b]">{p.selfPts.toFixed(2)}</span></span>
                <span className="text-[#0052cc] font-semibold">Mgr: {p.mgrPts.toFixed(2)} / {p.maxPts.toFixed(2)}</span>
              </div>
            </div>

            <div className="grid grid-cols-[1.4fr_60px_1fr_1fr_70px] gap-3 px-5 py-2 border-b border-[#f0f1f4] text-[11px] font-medium text-gray-400 uppercase tracking-wider">
              <span>Component</span>
              <span className="text-center">IPF%</span>
              <span>Self Score</span>
              <span>Mgr Score</span>
              <span className="text-right">Mgr Pts</span>
            </div>

            <ul className="divide-y divide-[#f3f4f6]">
              {p.sections.map((s) => (
                <li key={s.label} className="grid grid-cols-[1.4fr_60px_1fr_1fr_70px] gap-3 px-5 py-3 items-center table-row-hover">
                  <div>
                    <p className="text-[13px] font-medium text-[#16203b]">{s.label}</p>
                    <p className="text-[11px] text-gray-400">{s.window}</p>
                  </div>
                  <span className="text-[12px] font-semibold text-gray-500 text-center">{s.ipfWeight}%</span>
                  <ScoreBar value={s.selfScore} />
                  <ScoreBar value={s.mgrScore} />
                  <span className="text-[12px] font-semibold text-[#0052cc] text-right">{s.mgrContribution.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Band reference */}
      <div className="ff-card overflow-hidden mt-4">
        <div className="flex items-center gap-2 px-5 py-3 bg-[#f8f9fa] border-b border-[#ebedf2]">
          <Info size={13} className="text-gray-400" />
          <h3 className="text-[12px] font-semibold text-[#16203b] uppercase tracking-wider">Performance Bands</h3>
        </div>
        <ul className="divide-y divide-[#f3f4f6]">
          {(data?.bands ?? []).map((b) => (
            <li key={b.label} className="grid grid-cols-[90px_1.2fr_1.4fr_1.4fr] gap-3 px-5 py-2.5 items-center text-[12px]">
              <span className="font-semibold text-[#16203b]">{b.range}</span>
              <span className={`inline-flex w-fit px-2 py-0.5 rounded-full text-[11px] font-semibold ${bandColor(b.label)}`}>{b.label}</span>
              <span className="text-gray-500">{b.implication}</span>
              <span className="text-gray-400">{b.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </AppLayout>
  );
}
