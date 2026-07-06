import AppLayout from "@/components/AppLayout";
import { useEffect, useState } from "react";
import { Info, Users, Globe, BookOpen, Award, Scale, Pencil } from "lucide-react";
import { toast } from "sonner";
import { FALLBACK_AVATAR } from "@/lib/avatar";
import { api } from "@/lib/api";
import { pmScore } from "@/lib/pmApi";
import { useAuth } from "@/context/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PerformanceLevel = 1 | 2 | 3;
type PotentialLevel = 1 | 2 | 3;

interface Employee {
  id: string;
  name: string;
  role: string;
  avatar: string;
  performance: PerformanceLevel;
  potential: PotentialLevel;
  dept: string;
  country: string;
  ipf: number | null;       // manager Final IPF (drives performance)
  ipfBand: string | null;
}

interface Scope {
  zone: string | null;
  isGlobal: boolean;
  allowedCountries: string[] | null;
  countryLabels: Record<string, string>;
}

// Real pm-score DevelopmentPlan (GET/POST/PUT /dev-plans) — MID_YEAR or EOY
// stage, pre-populated strengths/improvement areas from continuous feedback,
// manager-authored next-FY plan fields.
interface DevPlan {
  id: string;
  employeeId: string;
  fiscalYear: string;
  reviewStage: "MID_YEAR" | "EOY";
  keyStrengths: string;
  improvementAreas: string;
  nextFYPlan: string;
  recommendedTrainings: string;
  stretchAssignments: string;
  mentorshipPlan: string;
  careerMilestones: string;
}
const emptyDevForm = {
  nextFYPlan: "", recommendedTrainings: "", stretchAssignments: "", mentorshipPlan: "", careerMilestones: "",
};

// Real pm-score calibration cohort row (GET /calibration?fiscalYear=&department=).
interface CalibrationRow {
  scorecardId?: string;
  id?: string;
  employeeId: string;
  managerFinalIPF: number | null;
  bandManager?: string | null;
  band?: string | null;
  nineBox?: { boxLabel?: string | null } | null;
  boxLabel?: string | null;
  state?: string;
}

type BoxConfig = {
  label: string;
  sublabel: string;
  bg: string;
  border: string;
  textColor: string;
  dot: string;
};

// 9-box: [potential 1-3][performance 1-3]
// We render rows top-to-bottom as potential 3,2,1 and cols left-to-right as perf 1,2,3
const boxConfigs: Record<number, Record<number, BoxConfig>> = {
  3: {
    1: { label: "Rough Diamond", sublabel: "High Potential / Low Perf", bg: "bg-blue-50/60", border: "border-blue-200", textColor: "text-blue-700", dot: "bg-blue-400" },
    2: { label: "High Potential", sublabel: "High Potential / Med Perf", bg: "bg-indigo-50/60", border: "border-indigo-200", textColor: "text-indigo-700", dot: "bg-indigo-400" },
    3: { label: "Star Performer", sublabel: "High Potential / High Perf", bg: "bg-green-50/60", border: "border-green-200", textColor: "text-green-700", dot: "bg-green-500" },
  },
  2: {
    1: { label: "Inconsistent Player", sublabel: "Med Potential / Low Perf", bg: "bg-amber-50/40", border: "border-amber-200", textColor: "text-amber-700", dot: "bg-amber-400" },
    2: { label: "Core Performer", sublabel: "Med Potential / Med Perf", bg: "bg-yellow-50/40", border: "border-yellow-200", textColor: "text-yellow-700", dot: "bg-yellow-400" },
    3: { label: "Strong Performer", sublabel: "Med Potential / High Perf", bg: "bg-teal-50/40", border: "border-teal-200", textColor: "text-teal-700", dot: "bg-teal-400" },
  },
  1: {
    1: { label: "Underperformer", sublabel: "Low Potential / Low Perf", bg: "bg-red-50/40", border: "border-red-200", textColor: "text-red-700", dot: "bg-red-400" },
    2: { label: "Solid Contributor", sublabel: "Low Potential / Med Perf", bg: "bg-orange-50/40", border: "border-orange-200", textColor: "text-orange-700", dot: "bg-orange-400" },
    3: { label: "Highly Valued Expert", sublabel: "Low Potential / High Perf", bg: "bg-lime-50/40", border: "border-lime-200", textColor: "text-lime-700", dot: "bg-lime-500" },
  },
};

const perfLabels: Record<PerformanceLevel, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
};
const potLabels: Record<PotentialLevel, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
};

const CURRENT_FY = "FY26-27";

// pm-score GET /nine-box row — field names are read defensively since the
// service may key employee identity/display fields slightly differently.
interface NineBoxRow {
  employeeId: string;
  name?: string;
  employeeName?: string;
  role?: string;
  title?: string;
  avatar?: string;
  department?: string;
  dept?: string;
  country?: string;
  performanceLevel?: PerformanceLevel;
  performance?: PerformanceLevel;
  potentialLevel?: PotentialLevel;
  potential?: PotentialLevel;
  boxLabel?: string;
  ipf?: number | null;
  managerFinalIPF?: number | null;
  ipfBand?: string | null;
  band?: string | null;
}

function mapNineBoxRow(r: NineBoxRow): Employee {
  return {
    id: r.employeeId,
    name: r.name ?? r.employeeName ?? r.employeeId,
    role: r.role ?? r.title ?? "",
    avatar: r.avatar ?? FALLBACK_AVATAR,
    performance: (r.performanceLevel ?? r.performance ?? 2) as PerformanceLevel,
    potential: (r.potentialLevel ?? r.potential ?? 2) as PotentialLevel,
    dept: r.department ?? r.dept ?? "General",
    country: r.country ?? "",
    ipf: r.ipf ?? r.managerFinalIPF ?? null,
    ipfBand: r.ipfBand ?? r.band ?? null,
  };
}

export default function Talent() {
  const { role } = useAuth();
  const canEdit = role === "manager" || role === "admin";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scope, setScope] = useState<Scope | null>(null);
  const [selectedDept, setSelectedDept] = useState<string>("All");
  const [hoveredEmployee, setHoveredEmployee] = useState<string | null>(null);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [editPotential, setEditPotential] = useState<number | null>(null);

  // Development plan (real pm-score data, loaded per-employee on open).
  const [devPlans, setDevPlans] = useState<DevPlan[]>([]);
  const [devLoading, setDevLoading] = useState(false);
  const [devEditing, setDevEditing] = useState<DevPlan | null>(null);
  const [devForm, setDevForm] = useState(emptyDevForm);

  // Calibration cohort (admin/HR only).
  const [calibOpen, setCalibOpen] = useState(false);
  const [calibRows, setCalibRows] = useState<CalibrationRow[]>([]);
  const [calibTarget, setCalibTarget] = useState<CalibrationRow | null>(null);
  const [calibForm, setCalibForm] = useState({ value: "", reason: "" });

  const isAdmin = role === "admin";

  const loadNineBox = () =>
    pmScore
      .get<NineBoxRow[]>(`/nine-box?fiscalYear=${encodeURIComponent(CURRENT_FY)}`)
      .then((rows) => setEmployees(rows.map(mapNineBoxRow)))
      .catch(() => setEmployees([]));

  useEffect(() => {
    loadNineBox();
    // No owning pm-* service for region/country access scope — left on the ad-hoc endpoint.
    api.get<Scope>("/me").then(setScope).catch(() => setScope(null));
  }, []);

  // Only potential is editable — performance is derived from the manager IPF.
  useEffect(() => {
    setEditPotential(selected ? selected.potential : null);
    setDevPlans([]);
    if (!selected) return;
    setDevLoading(true);
    pmScore
      .get<DevPlan[]>(`/dev-plans?employeeId=${encodeURIComponent(selected.id)}&fiscalYear=${encodeURIComponent(CURRENT_FY)}`)
      .then(setDevPlans)
      .catch(() => setDevPlans([]))
      .finally(() => setDevLoading(false));
  }, [selected]);

  const buildDevPlan = async (stage: "MID_YEAR" | "EOY") => {
    if (!selected) return;
    try {
      const plan = await pmScore.post<DevPlan>("/dev-plans/build", {
        employeeId: selected.id, fiscalYear: CURRENT_FY, reviewStage: stage,
      });
      setDevPlans((prev) => [...prev.filter((p) => p.reviewStage !== stage), plan]);
      toast.success(`${stage === "MID_YEAR" ? "Mid-year" : "End-of-year"} plan built`,
        { description: "Pre-populated from continuous feedback." });
    } catch (err) { toast.error("Could not build plan", { description: (err as Error).message }); }
  };

  const openEditDevPlan = (p: DevPlan) => {
    setDevEditing(p);
    setDevForm({
      nextFYPlan: p.nextFYPlan || "", recommendedTrainings: p.recommendedTrainings || "",
      stretchAssignments: p.stretchAssignments || "", mentorshipPlan: p.mentorshipPlan || "",
      careerMilestones: p.careerMilestones || "",
    });
  };

  const saveDevPlan = async () => {
    if (!devEditing) return;
    try {
      const updated = await pmScore.put<DevPlan>(`/dev-plans/${devEditing.id}`, devForm);
      setDevPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success("Development plan saved");
      setDevEditing(null);
    } catch (err) { toast.error("Could not save", { description: (err as Error).message }); }
  };

  const loadCalibration = () => {
    pmScore
      .get<CalibrationRow[]>(`/calibration?fiscalYear=${encodeURIComponent(CURRENT_FY)}${selectedDept !== "All" ? `&department=${encodeURIComponent(selectedDept)}` : ""}`)
      .then(setCalibRows)
      .catch(() => setCalibRows([]));
  };
  useEffect(() => { if (calibOpen) loadCalibration(); }, [calibOpen, selectedDept]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCalibAdjust = (row: CalibrationRow) => {
    setCalibTarget(row);
    setCalibForm({ value: row.managerFinalIPF != null ? String(row.managerFinalIPF) : "", reason: "" });
  };

  const submitCalibAdjust = async () => {
    if (!calibTarget) return;
    const value = parseFloat(calibForm.value);
    if (Number.isNaN(value) || !calibForm.reason.trim()) {
      toast.error("Enter a valid score and a reason"); return;
    }
    try {
      await pmScore.post("/calibration/adjust", {
        employeeId: calibTarget.employeeId, fiscalYear: CURRENT_FY,
        adjustedManagerFinalIPF: value, reason: calibForm.reason.trim(),
      });
      toast.success("Calibration adjustment recorded");
      setCalibTarget(null);
      loadCalibration();
      loadNineBox();
    } catch (err) { toast.error("Could not adjust", { description: (err as Error).message }); }
  };

  const countryName = (code: string) => scope?.countryLabels?.[code] ?? code;

  const handleSavePerson = async () => {
    if (!selected || editPotential === null) return;
    try {
      await pmScore.post<NineBoxRow>("/nine-box/place", {
        employeeId: selected.id,
        fiscalYear: CURRENT_FY,
        potentialLevel: editPotential,
      });
      const updated: Employee = { ...selected, potential: editPotential as PotentialLevel };
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setSelected(updated);
      toast.success("Potential updated", {
        description: `${updated.name} → ${potLabels[updated.potential]} potential`,
      });
    } catch (err) {
      toast.error("Could not update", { description: (err as Error).message });
    }
  };

  const depts = ["All", ...Array.from(new Set(employees.map((e) => e.dept)))];
  const filtered = selectedDept === "All" ? employees : employees.filter((e) => e.dept === selectedDept);

  const getEmployeesInBox = (potential: PotentialLevel, perf: PerformanceLevel) =>
    filtered.filter((e) => e.performance === perf && e.potential === potential);

  return (
    <AppLayout pageTitle="Talent Matrix" breadcrumb="Talent">
      {/* Toolbar */}
      <div className="ff-card px-4 py-3 mb-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Users size={14} className="text-[#0052cc]" />
          <span className="text-[13px] font-semibold text-[#0f1b3d]">9-Box Talent Matrix</span>
          <div className="w-px h-4 bg-[#e5e7eb] hidden sm:block" />
          <span className="text-[12px] text-gray-400">Performance vs. Potential</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">Dept:</span>
          <div className="flex gap-1 flex-wrap">
            {depts.map((d) => (
              <button
                key={d}
                onClick={() => setSelectedDept(d)}
                className={`px-2.5 py-1 rounded-[4px] text-[11px] font-medium transition-colors ${
                  selectedDept === d
                    ? "bg-[#0f1b3d] text-white"
                    : "bg-[#f3f4f6] text-gray-500 hover:bg-[#e5e7eb]"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setCalibOpen(true)} className="ml-1">
              <Scale size={13} className="mr-1.5" /> Calibration
            </Button>
          )}
        </div>
      </div>

      {/* Region access scope (country-based control) */}
      {scope && (
        <div className="ff-card px-4 py-2.5 mb-4 flex items-center gap-2 text-[12px]">
          <Globe size={13} className="text-[#0052cc] flex-shrink-0" />
          {scope.isGlobal ? (
            <span className="text-gray-600">
              <span className="font-semibold text-[#0f1b3d]">Global access</span> — showing employees across all regions.
            </span>
          ) : (
            <span className="text-gray-600">
              <span className="font-semibold text-[#0f1b3d]">{scope.zone} region</span> — you can view employees in{" "}
              {(scope.allowedCountries ?? []).map((c) => countryName(c)).join(", ")}.
            </span>
          )}
        </div>
      )}

      <div className="ff-card overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Axis labels */}
          <div className="flex">
            {/* Y-axis label */}
            <div className="w-14 flex-shrink-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-1" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">Potential</span>
              </div>
            </div>
            {/* X-axis top blank */}
            <div className="flex-1">
              {/* Performance axis header */}
              <div className="flex border-b border-[#e5e7eb] mb-0">
                <div className="flex-1 py-2 text-center">
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Performance</span>
                </div>
              </div>
              <div className="grid grid-cols-3 border-b border-[#e5e7eb]">
                {([1, 2, 3] as PerformanceLevel[]).map((p) => (
                  <div key={p} className="py-1.5 text-center border-r border-[#e5e7eb] last:border-r-0">
                    <span className="text-[11px] font-medium text-gray-500">{perfLabels[p]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Matrix rows: potential high → low */}
          {([3, 2, 1] as PotentialLevel[]).map((potential) => (
            <div key={potential} className="flex border-b border-[#e5e7eb] last:border-b-0">
              {/* Y label */}
              <div className="w-14 flex-shrink-0 flex items-center justify-center border-r border-[#e5e7eb]">
                <span className="text-[11px] font-medium text-gray-500">{potLabels[potential]}</span>
              </div>
              {/* 3 cells */}
              <div className="flex-1 grid grid-cols-3">
                {([1, 2, 3] as PerformanceLevel[]).map((perf) => {
                  const cfg = boxConfigs[potential][perf];
                  const boxEmployees = getEmployeesInBox(potential, perf);
                  return (
                    <div
                      key={perf}
                      className={`border-r border-[#e5e7eb] last:border-r-0 ${cfg.bg} p-3 min-h-[120px] flex flex-col gap-2 transition-colors`}
                    >
                      {/* Box label */}
                      <div className="flex items-start gap-1.5">
                        <div className={`w-2 h-2 rounded-full mt-0.5 flex-shrink-0 ${cfg.dot}`} />
                        <div>
                          <p className={`text-[11px] font-semibold ${cfg.textColor} leading-tight`}>{cfg.label}</p>
                          <p className="text-[10px] text-gray-400 leading-tight">{cfg.sublabel}</p>
                        </div>
                      </div>

                      {/* Employee chips */}
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {boxEmployees.map((emp) => (
                          <div
                            key={emp.id}
                            onMouseEnter={() => setHoveredEmployee(emp.id)}
                            onMouseLeave={() => setHoveredEmployee(null)}
                            onClick={() => setSelected(emp)}
                            className={`relative flex items-center gap-1 px-1.5 py-1 bg-white border border-[#e5e7eb] rounded-[5px] cursor-pointer transition-shadow ${
                              hoveredEmployee === emp.id ? "shadow-md ring-1 ring-[#0052cc]/40" : "shadow-sm"
                            }`}
                          >
                            <img
                              src={emp.avatar}
                              alt={emp.name}
                              className="w-5 h-5 rounded-full object-cover"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_AVATAR; }}
                            />
                            <div className="hidden sm:block">
                              <p className="text-[10px] font-semibold text-[#0f1b3d] leading-none whitespace-nowrap">{emp.name}</p>
                              <p className="text-[9px] text-gray-400 leading-none whitespace-nowrap">{emp.role}</p>
                            </div>
                            {/* Tooltip on hover — mobile only shows name */}
                            {hoveredEmployee === emp.id && (
                              <div className="sm:hidden absolute bottom-full left-0 mb-1 bg-[#0f1b3d] text-white rounded px-2 py-1 text-[11px] whitespace-nowrap z-10">
                                {emp.name} · {emp.role}
                              </div>
                            )}
                          </div>
                        ))}
                        {boxEmployees.length === 0 && (
                          <p className="text-[10px] text-gray-300 italic">No employees</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="ff-card px-5 py-3 mt-4">
        <div className="flex items-center gap-2 mb-2">
          <Info size={12} className="text-gray-400" />
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Box Legend</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-9 gap-2">
          {([3, 2, 1] as PotentialLevel[]).flatMap((pot) =>
            ([1, 2, 3] as PerformanceLevel[]).map((perf) => {
              const cfg = boxConfigs[pot][perf];
              return (
                <div key={`${pot}-${perf}`} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  <span className="text-[11px] text-gray-500">{cfg.label}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Employee detail dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-[460px] max-h-[88vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <img
                    src={selected.avatar}
                    alt={selected.name}
                    className="w-10 h-10 rounded-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_AVATAR; }}
                  />
                  <div>
                    <DialogTitle>{selected.name}</DialogTitle>
                    <DialogDescription>{selected.role} · {selected.dept} · {countryName(selected.country)}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="py-1 space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${boxConfigs[selected.potential][selected.performance].dot}`} />
                  <span className={`text-[13px] font-semibold ${boxConfigs[selected.potential][selected.performance].textColor}`}>
                    {boxConfigs[selected.potential][selected.performance].label}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="ff-card px-3 py-2.5">
                    <p className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">Performance</p>
                    <p className="text-[15px] font-bold text-[#0f1b3d] mt-0.5">{perfLabels[selected.performance]}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {selected.ipf != null ? `from IPF ${selected.ipf.toFixed(2)} · ${selected.ipfBand}` : "no IPF yet"}
                    </p>
                  </div>
                  <div className="ff-card px-3 py-2.5">
                    <p className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">Potential</p>
                    {canEdit && editPotential !== null ? (
                      <Select value={String(editPotential)} onValueChange={(v) => setEditPotential(Number(v))}>
                        <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Low</SelectItem>
                          <SelectItem value="2">Medium</SelectItem>
                          <SelectItem value="3">High</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-[15px] font-bold text-[#0f1b3d] mt-0.5">{potLabels[selected.potential]}</p>
                    )}
                  </div>
                </div>
                <p className="text-[12px] text-gray-500">
                  {boxConfigs[selected.potential][selected.performance].sublabel} — performance is derived from the manager IPF; potential is a manager assessment.
                </p>
                {canEdit && (
                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
                    <Button
                      className="bg-[#0052cc] hover:bg-[#003d99]"
                      disabled={editPotential === selected.potential}
                      onClick={handleSavePerson}
                    >
                      Save potential
                    </Button>
                  </div>
                )}

                {/* Development plan — real pm-score data (MID_YEAR / EOY stages) */}
                <div className="pt-3 border-t border-[#ebedf2]">
                  <div className="flex items-center gap-1.5 mb-2">
                    <BookOpen size={13} className="text-[#0052cc]" />
                    <p className="text-[12px] font-semibold text-[#16203b]">Development Plan</p>
                  </div>
                  {devLoading ? (
                    <p className="text-[12px] text-gray-400">Loading…</p>
                  ) : (
                    <div className="space-y-3">
                      {(["MID_YEAR", "EOY"] as const).map((stage) => {
                        const p = devPlans.find((d) => d.reviewStage === stage);
                        return (
                          <div key={stage} className="rounded-[8px] border border-[#eef0f4] p-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[11px] font-semibold text-[#16203b]">
                                {stage === "MID_YEAR" ? "Mid-Year" : "End-of-Year"}
                              </span>
                              {canEdit && (
                                p ? (
                                  <button onClick={() => openEditDevPlan(p)}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0052cc] hover:underline">
                                    <Pencil size={11} /> Edit
                                  </button>
                                ) : (
                                  <button onClick={() => buildDevPlan(stage)}
                                    className="text-[11px] font-medium text-[#0052cc] hover:underline">
                                    Build
                                  </button>
                                )
                              )}
                            </div>
                            {p ? (
                              <div className="space-y-1.5 text-[12px]">
                                <p><span className="text-gray-400">Key strengths:</span> {p.keyStrengths || "—"}</p>
                                <p><span className="text-gray-400">Improvement areas:</span> {p.improvementAreas || "—"}</p>
                                <p><span className="text-gray-400">Next-FY plan:</span> {p.nextFYPlan || "—"}</p>
                                <p><span className="text-gray-400">Recommended trainings:</span> {p.recommendedTrainings || "—"}</p>
                                <p><span className="text-gray-400">Stretch assignments:</span> {p.stretchAssignments || "—"}</p>
                                <p><span className="text-gray-400">Mentorship plan:</span> {p.mentorshipPlan || "—"}</p>
                                <p className="flex items-center gap-1"><Award size={11} className="text-gray-400" />
                                  <span className="text-gray-400">Career milestones:</span> {p.careerMilestones || "—"}
                                </p>
                              </div>
                            ) : (
                              <p className="text-[11.5px] text-gray-400">
                                No {stage === "MID_YEAR" ? "mid-year" : "end-of-year"} plan yet.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit development plan (manager) */}
      <Dialog open={!!devEditing} onOpenChange={(o) => { if (!o) setDevEditing(null); }}>
        <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {devEditing?.reviewStage === "MID_YEAR" ? "mid-year" : "end-of-year"} plan</DialogTitle>
            <DialogDescription>Key strengths and improvement areas are pre-populated from continuous feedback — edit the next-FY sections below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Next-FY plan</Label>
              <textarea rows={2} value={devForm.nextFYPlan} onChange={(e) => setDevForm({ ...devForm, nextFYPlan: e.target.value })}
                className="w-full px-3 py-2 text-[13px] border border-input rounded-[4px] bg-background text-[#16203b] focus:outline-none focus:border-[#0052cc] resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label>Recommended trainings &amp; certifications</Label>
              <Input value={devForm.recommendedTrainings} onChange={(e) => setDevForm({ ...devForm, recommendedTrainings: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Stretch assignments</Label>
              <Input value={devForm.stretchAssignments} onChange={(e) => setDevForm({ ...devForm, stretchAssignments: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Mentorship &amp; coaching plan</Label>
              <Input value={devForm.mentorshipPlan} onChange={(e) => setDevForm({ ...devForm, mentorshipPlan: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Career-path milestones</Label>
              <Input value={devForm.careerMilestones} onChange={(e) => setDevForm({ ...devForm, careerMilestones: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDevEditing(null)}>Cancel</Button>
            <Button onClick={saveDevPlan} className="bg-[#0052cc] hover:bg-[#003d99]">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Calibration cohort view (admin/HR) */}
      <Dialog open={calibOpen} onOpenChange={setCalibOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Scale size={16} className="text-[#0052cc]" /> Calibration — {selectedDept === "All" ? "All departments" : selectedDept}</DialogTitle>
            <DialogDescription>Review and moderate Final IPF scores and 9-box placements before HRBP sign-off. Adjustments are audited (original, adjusted, adjuster, reason).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            {calibRows.length === 0 ? (
              <p className="text-[12.5px] text-gray-400">No scorecards for this cohort yet.</p>
            ) : calibRows.map((r) => {
              const band = r.bandManager ?? r.band;
              const box = r.nineBox?.boxLabel ?? r.boxLabel;
              return (
                <div key={r.employeeId} className="flex items-center justify-between gap-3 rounded-[8px] border border-[#eef0f4] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#16203b]">{r.employeeId}</p>
                    <p className="text-[11px] text-gray-400">
                      {r.managerFinalIPF != null ? `IPF ${r.managerFinalIPF.toFixed(2)}` : "no IPF"}
                      {band ? ` · ${band}` : ""}{box ? ` · ${box}` : ""}
                      {r.state === "SIGNED_OFF" && " · signed off"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" disabled={r.state === "SIGNED_OFF"} onClick={() => openCalibAdjust(r)}>
                    Adjust
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Calibration adjustment */}
      <Dialog open={!!calibTarget} onOpenChange={(o) => { if (!o) setCalibTarget(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Adjust — {calibTarget?.employeeId}</DialogTitle>
            <DialogDescription>Recorded as a calibration adjustment (original value, adjusted value, adjuster, reason) and re-resolves the performance band.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Adjusted Final IPF (1.00–5.00)</Label>
              <Input type="number" min={1} max={5} step={0.01} value={calibForm.value}
                onChange={(e) => setCalibForm({ ...calibForm, value: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Reason <span className="text-red-500">*</span></Label>
              <textarea rows={2} value={calibForm.reason} onChange={(e) => setCalibForm({ ...calibForm, reason: e.target.value })}
                className="w-full px-3 py-2 text-[13px] border border-input rounded-[4px] bg-background text-[#16203b] focus:outline-none focus:border-[#0052cc] resize-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCalibTarget(null)}>Cancel</Button>
            <Button onClick={submitCalibAdjust} className="bg-[#0052cc] hover:bg-[#003d99]">Save adjustment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}