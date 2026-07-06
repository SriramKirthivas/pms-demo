import AppLayout from "@/components/AppLayout";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Building2, GitBranch, Crosshair, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

interface CompanyGoal {
  id: string; fy: string; objective: string; description: string;
  metric: string; target: string; owner: string; sortOrder: number; alignedGoals: number;
}

const blankForm = { objective: "", description: "", metric: "", target: "", owner: "Leadership" };

export default function CompanyGoals() {
  const { role } = useAuth();
  const canManage = role === "admin";

  const [goals, setGoals] = useState<CompanyGoal[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);
  const [deleteTarget, setDeleteTarget] = useState<CompanyGoal | null>(null);

  const load = () => api.get<CompanyGoal[]>("/company-goals").then(setGoals).catch(() => setGoals([]));
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditingId(null); setForm(blankForm); setOpen(true); };
  const openEdit = (g: CompanyGoal) => {
    setEditingId(g.id);
    setForm({ objective: g.objective, description: g.description, metric: g.metric, target: g.target, owner: g.owner });
    setOpen(true);
  };

  const save = async () => {
    if (!form.objective.trim()) { toast.error("Enter an objective"); return; }
    const body = { objective: form.objective.trim(), description: form.description.trim(), metric: form.metric.trim(), target: form.target.trim(), owner: form.owner.trim() || "Leadership" };
    try {
      if (editingId) { await api.patch(`/company-goals/${editingId}`, body); toast.success("Company goal updated"); }
      else { await api.post("/company-goals", body); toast.success("Company goal added"); }
      setOpen(false); load();
    } catch (err) { toast.error("Could not save", { description: (err as Error).message }); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id; setDeleteTarget(null);
    try { await api.del(`/company-goals/${id}`); toast.success("Company goal removed"); load(); }
    catch (err) { toast.error("Could not remove", { description: (err as Error).message }); }
  };

  const totalAligned = goals.reduce((s, g) => s + g.alignedGoals, 0);

  return (
    <AppLayout pageTitle="Company Goals" breadcrumb="Performance">
      <div className="ff-card px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Building2 size={14} className="text-[#0052cc]" />
          <span className="text-[13px] font-semibold text-[#0f1b3d]">Company Objectives</span>
          <span className="text-[12px] text-gray-400 hidden sm:inline">· {goals.length} objectives · {totalAligned} goals cascaded</span>
        </div>
        {canManage ? (
          <Button onClick={openAdd} className="bg-[#0052cc] hover:bg-[#003d99] gap-1.5 h-8"><Plus size={14} /> Add objective</Button>
        ) : (
          <span className="text-[11px] text-gray-400">Read-only · set by Admin</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {goals.map((g) => (
          <div key={g.id} className="ff-card p-5">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-[9px] bg-[#eef4fa] flex items-center justify-center flex-shrink-0 mt-0.5"><Crosshair size={15} className="text-[#0052cc]" /></div>
                <div className="min-w-0">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{g.owner} · {g.fy}</span>
                  <h3 className="text-[14px] font-semibold text-[#16203b] leading-snug">{g.objective}</h3>
                </div>
              </div>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button className="p-1 rounded hover:bg-[#eef0f4] text-gray-400 flex-shrink-0"><MoreHorizontal size={14} /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuItem onClick={() => openEdit(g)}><Pencil size={13} className="mr-2" /> Edit</DropdownMenuItem>
                    <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteTarget(g)}><Trash2 size={13} className="mr-2" /> Remove</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {g.description && <p className="text-[12px] text-gray-500 leading-snug mb-3 sm:pl-[42px]">{g.description}</p>}
            <div className="flex items-center gap-2 flex-wrap sm:pl-[42px]">
              {g.metric && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] text-[11px] font-medium text-[#0052cc] bg-[#eef4fa]">{g.metric}{g.target ? ` · ${g.target}` : ""}</span>}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500"><GitBranch size={11} /> {g.alignedGoals} goals cascaded</span>
            </div>
          </div>
        ))}
      </div>

      {goals.length === 0 && (
        <div className="ff-card px-5 py-10 text-center text-[13px] text-gray-400">No company objectives set yet.</div>
      )}

      {/* Add / Edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit company objective" : "Add company objective"}</DialogTitle>
            <DialogDescription>Team goals cascade from these company-level aims.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5"><Label htmlFor="cg-obj">Objective</Label>
              <Input id="cg-obj" placeholder="e.g. Achieve $12M ARR by end of FY26-27" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="cg-desc">Description <span className="text-gray-400 font-normal">· optional</span></Label>
              <Input id="cg-desc" placeholder="What this objective means" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
              <div className="space-y-1.5"><Label htmlFor="cg-metric">Metric / KPI</Label>
                <Input id="cg-metric" placeholder="e.g. ARR" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="cg-target">Target</Label>
                <Input id="cg-target" placeholder="$12M" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="cg-owner">Owner</Label>
                <Input id="cg-owner" placeholder="CEO" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} className="bg-[#0052cc] hover:bg-[#003d99]">{editingId ? "Save changes" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Remove company objective?</DialogTitle>
            <DialogDescription>
              Remove <span className="font-medium text-[#16203b]">"{deleteTarget?.objective}"</span>.
              {deleteTarget && deleteTarget.alignedGoals > 0 && <> Its {deleteTarget.alignedGoals} cascaded goal(s) will be unlinked (not deleted).</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={confirmDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
