import AppLayout from "@/components/AppLayout";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Target, Radar, MoreHorizontal } from "lucide-react";
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

interface Competency {
  id: string; category: string; name: string; description: string;
  selfRating: number; managerRating: number; weight: number; inRadar: boolean; sortOrder: number;
}

const scoreColor = (v: number) => v >= 4 ? "#16a34a" : v >= 3 ? "#0052cc" : v >= 2 ? "#f59e0b" : "#dc2626";

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5"><span className="text-gray-400">{label}</span><span className="font-semibold tabular-nums" style={{ color: scoreColor(value) }}>{value.toFixed(1)}</span></div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(value / 5) * 100}%`, background: scoreColor(value) }} /></div>
    </div>
  );
}

const blankForm = { category: "", name: "", description: "", selfRating: "3", managerRating: "3", weight: "10", inRadar: true };

export default function Competencies() {
  const { role } = useAuth();
  const canManage = role === "admin";

  const [items, setItems] = useState<Competency[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);
  const [deleteTarget, setDeleteTarget] = useState<Competency | null>(null);

  const load = () => api.get<Competency[]>("/competencies").then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const categories = Array.from(new Set(items.map((c) => c.category)));

  const openAdd = () => { setEditingId(null); setForm(blankForm); setOpen(true); };
  const openEdit = (c: Competency) => {
    setEditingId(c.id);
    setForm({ category: c.category, name: c.name, description: c.description,
      selfRating: String(c.selfRating), managerRating: String(c.managerRating), weight: String(c.weight), inRadar: c.inRadar });
    setOpen(true);
  };

  const save = async () => {
    if (!form.category.trim() || !form.name.trim()) { toast.error("Category and name are required"); return; }
    const body = {
      category: form.category.trim(), name: form.name.trim(), description: form.description.trim(),
      selfRating: parseFloat(form.selfRating) || 0, managerRating: parseFloat(form.managerRating) || 0,
      weight: parseInt(form.weight, 10) || 0, inRadar: form.inRadar,
    };
    try {
      if (editingId) { await api.patch(`/competencies/${editingId}`, body); toast.success("Competency updated"); }
      else { await api.post("/competencies", body); toast.success("Competency added"); }
      setOpen(false); load();
    } catch (err) { toast.error("Could not save", { description: (err as Error).message }); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id; setDeleteTarget(null);
    try { await api.del(`/competencies/${id}`); toast.success("Competency removed"); load(); }
    catch (err) { toast.error("Could not remove", { description: (err as Error).message }); }
  };

  return (
    <AppLayout pageTitle="Competency Mapping" breadcrumb="Talent">
      <div className="ff-card px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-[#0052cc]" />
          <span className="text-[13px] font-semibold text-[#0f1b3d]">Skill & Competency Framework</span>
          <span className="text-[12px] text-gray-400 hidden sm:inline">· {items.length} competencies across {categories.length} areas</span>
        </div>
        {canManage ? (
          <Button onClick={openAdd} className="bg-[#0052cc] hover:bg-[#003d99] gap-1.5 h-8"><Plus size={14} /> Add competency</Button>
        ) : (
          <span className="text-[11px] text-gray-400">Read-only · maintained by Admin</span>
        )}
      </div>

      {categories.map((cat) => (
        <div key={cat} className="mb-5">
          <p className="ff-label px-1 mb-2">{cat}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {items.filter((c) => c.category === cat).map((c) => (
              <div key={c.id} className="ff-card p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-[13px] font-semibold text-[#16203b] leading-tight">{c.name}</h3>
                      {c.inRadar && <Radar size={12} className="text-[#0052cc] flex-shrink-0" />}
                    </div>
                    {c.description && <p className="text-[11px] text-gray-400 leading-snug mt-1">{c.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold text-gray-500 bg-gray-100" title="Weight">wt {c.weight}</span>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><button className="p-1 rounded hover:bg-[#eef0f4] text-gray-400"><MoreHorizontal size={14} /></button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem onClick={() => openEdit(c)}><Pencil size={13} className="mr-2" /> Edit</DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteTarget(c)}><Trash2 size={13} className="mr-2" /> Remove</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
                <div className="space-y-2 mt-3">
                  <Bar value={c.selfRating} label="Self" />
                  <Bar value={c.managerRating} label="Manager" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {items.length === 0 && (
        <div className="ff-card px-5 py-10 text-center text-[13px] text-gray-400">No competencies defined yet.</div>
      )}

      {/* Add / Edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit competency" : "Add competency"}</DialogTitle>
            <DialogDescription>Part of the org-wide skill framework.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="c-cat">Category</Label>
                <Input id="c-cat" list="cat-list" placeholder="e.g. Execution" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                <datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist></div>
              <div className="space-y-1.5"><Label htmlFor="c-name">Name</Label>
                <Input id="c-name" placeholder="e.g. Problem Solving" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="c-desc">Description <span className="text-gray-400 font-normal">· optional</span></Label>
              <Input id="c-desc" placeholder="What's expected at a strong level" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label htmlFor="c-self">Self (0–5)</Label>
                <Input id="c-self" type="number" min={0} max={5} step={0.1} value={form.selfRating} onChange={(e) => setForm({ ...form, selfRating: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="c-mgr">Manager (0–5)</Label>
                <Input id="c-mgr" type="number" min={0} max={5} step={0.1} value={form.managerRating} onChange={(e) => setForm({ ...form, managerRating: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="c-wt">Weight</Label>
                <Input id="c-wt" type="number" min={0} max={100} value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-[#16203b] cursor-pointer">
              <input type="checkbox" checked={form.inRadar} onChange={(e) => setForm({ ...form, inRadar: e.target.checked })} className="accent-[#0052cc]" />
              Show on the scorecard radar
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} className="bg-[#0052cc] hover:bg-[#003d99]">{editingId ? "Save changes" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Remove competency?</DialogTitle>
            <DialogDescription>Remove <span className="font-medium text-[#16203b]">"{deleteTarget?.name}"</span> from the framework.</DialogDescription>
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
