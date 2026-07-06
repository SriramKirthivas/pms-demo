import AppLayout from "@/components/AppLayout";
import { useEffect, useState } from "react";
import { Shield, Users, Save, Pencil } from "lucide-react";
import { toast } from "sonner";
import { pmGoal } from "@/lib/pmApi";
import { useAuth } from "@/context/AuthContext";
import type { Role } from "@/lib/roles";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FALLBACK_AVATAR } from "@/lib/avatar";

// pm-goal employee directory entry (UAM stand-in). `id` IS the display name
// (e.g. "David Chen") — this codebase's identity convention.
interface Person {
  id: string;
  employeeId: string;
  email: string;
  role: Role;
  managerId: string;
  department: string;
  country: string;
  title: string;
}

const roleColors: Record<Role, string> = {
  admin: "bg-[#0052cc]/10 text-[#0052cc]",
  manager: "bg-green-100 text-green-700",
  employee: "bg-gray-100 text-gray-500",
};

const teamFields = [
  { key: "teamName", label: "Team Name" },
  { key: "department", label: "Department" },
  { key: "reviewCycle", label: "Review Cycle" },
  { key: "calibration", label: "Calibration Method" },
];

// The legacy /team backend that used to persist this configuration no longer
// exists; keep the card functional by storing the values locally.
const CONFIG_KEY = "pms_team_config";
const emptyConfig: Record<string, string> = {
  teamName: "", department: "", reviewCycle: "", calibration: "",
};

const readConfig = (): Record<string, string> => {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CONFIG_KEY) : null;
    return raw ? { ...emptyConfig, ...(JSON.parse(raw) as Record<string, string>) } : emptyConfig;
  } catch {
    return emptyConfig;
  }
};

interface PersonForm {
  id: string;
  email: string;
  title: string;
  department: string;
  role: Role;
  managerId: string;
  country: string;
}

const emptyForm: PersonForm = {
  id: "", email: "", title: "", department: "", role: "employee", managerId: "", country: "IE",
};

// Radix Select items can't have an empty-string value — sentinel for "no manager".
const NO_MANAGER = "__none__";

export default function Settings() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  // Directory (pm-goal /people, UAM stand-in). Server-side scoping: admins get
  // everyone; managers get their own team + themselves.
  const [people, setPeople] = useState<Person[]>([]);
  const [config, setConfig] = useState<Record<string, string>>(readConfig);

  const [editorOpen, setEditorOpen] = useState(false);
  // Non-null while editing an existing person — `id` is the upsert key, so it
  // stays locked in the dialog.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PersonForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadPeople = () => {
    pmGoal
      .get<Person[]>("/people")
      .then(setPeople)
      .catch((err) => toast.error("Could not load directory", { description: (err as Error).message }));
  };

  useEffect(() => {
    loadPeople();
  }, []);

  const handleSaveConfig = () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    toast.success("Changes saved", { description: "Team configuration saved on this device" });
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setEditorOpen(true);
  };

  const openEdit = (p: Person) => {
    setEditingId(p.id);
    setForm({
      id: p.id,
      email: p.email ?? "",
      title: p.title ?? "",
      department: p.department ?? "",
      role: p.role,
      managerId: p.managerId ?? "",
      country: p.country || "IE",
    });
    setEditorOpen(true);
  };

  const handleSavePerson = async () => {
    if (!form.id.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      // POST /people upserts (keyed on id) — same call for create and update.
      await pmGoal.post("/people", {
        id: form.id.trim(),
        email: form.email.trim(),
        title: form.title.trim(),
        department: form.department.trim(),
        role: form.role,
        managerId: form.managerId,
        country: form.country.trim() || "IE",
      });
      toast.success(editingId ? "Employee updated" : "Employee added", { description: form.id.trim() });
      setEditorOpen(false);
      loadPeople();
    } catch (err) {
      toast.error("Could not save employee", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout pageTitle="Team Settings" breadcrumb="Admin">
      <div className="max-w-3xl space-y-4">
        {/* Team info */}
        <div className="ff-card p-5">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#e5e7eb]">
            <Shield size={14} className="text-[#0052cc]" />
            <h2 className="text-[13px] font-semibold text-[#0f1b3d]">Team Configuration</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {teamFields.map((f) => (
              <div key={f.key}>
                <label className="block text-[11px] text-gray-400 uppercase tracking-wider font-medium mb-1">{f.label}</label>
                <input
                  value={config[f.key]}
                  onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                  className="w-full px-3 py-2 text-[13px] bg-[#f3f4f6] border border-[#e5e7eb] rounded-[5px] text-[#0f1b3d] focus:outline-none focus:border-[#0052cc] focus:ring-1 focus:ring-[#0052cc]/20"
                />
              </div>
            ))}
          </div>
          <button
            onClick={handleSaveConfig}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-[#0052cc] text-white text-[12px] font-medium rounded-[5px] hover:bg-[#003d99] transition-colors"
          >
            <Save size={12} />
            Save Changes
          </button>
        </div>

        {/* Employee directory (pm-goal /people) */}
        <div className="ff-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e5e7eb]">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-[#0052cc]" />
              <h2 className="text-[13px] font-semibold text-[#0f1b3d]">Team Members ({people.length})</h2>
            </div>
            {isAdmin && (
              <button
                onClick={openAdd}
                className="px-3 py-1.5 text-[12px] font-medium bg-[#0f1b3d] text-white rounded-[5px] hover:bg-[#1a2f5a] transition-colors"
              >
                Add Employee
              </button>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-[#f8fafc] border-b border-[#e5e7eb]">
                <th className="text-left px-5 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Member</th>
                <th className="text-left px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">Email</th>
                <th className="text-left px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Department</th>
                <th className="text-left px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Manager</th>
                {isAdmin && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f3f4f6]">
              {people.map((p) => (
                <tr key={p.id} className="table-row-hover">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={FALLBACK_AVATAR}
                        alt={p.id}
                        className="w-7 h-7 rounded-full object-cover"
                      />
                      <div>
                        <p className="text-[12.5px] font-medium text-[#0f1b3d]">{p.id}</p>
                        <p className="text-[11px] text-gray-400">{p.title || "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-gray-500 hidden sm:table-cell">{p.email}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${roleColors[p.role] ?? roleColors.employee}`}>
                      {p.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-gray-500 hidden md:table-cell">{p.department || "—"}</td>
                  <td className="px-4 py-3 text-[12px] text-gray-500 hidden md:table-cell">{p.managerId || "—"}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEdit(p)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] font-medium text-[#0052cc] hover:bg-[#0052cc]/5 rounded-[5px] transition-colors"
                      >
                        <Pencil size={11} />
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {people.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="px-5 py-6 text-center text-[12px] text-gray-400">
                    No one in your directory yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit employee dialog (POST /people upsert, admin only) */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Employee" : "Add Employee"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? `Update ${editingId}'s directory entry.`
                : "Add a new employee to the directory."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Full name</Label>
              <Input
                id="p-name"
                placeholder="Jane Doe"
                value={form.id}
                disabled={!!editingId}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-email">Email</Label>
              <Input id="p-email" type="email" placeholder="j.doe@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-title">Title</Label>
                <Input id="p-title" placeholder="Product Designer" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-dept">Department</Label>
                <Input id="p-dept" placeholder="Product & Strategy" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Manager</Label>
                <Select
                  value={form.managerId || NO_MANAGER}
                  onValueChange={(v) => setForm({ ...form, managerId: v === NO_MANAGER ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_MANAGER}>None</SelectItem>
                    {people
                      .filter((p) => p.id !== form.id)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.id}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-country">Country</Label>
              <Input id="p-country" placeholder="IE" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button onClick={handleSavePerson} disabled={saving} className="bg-[#0f1b3d] hover:bg-[#1a2f5a]">
              {saving ? "Saving…" : editingId ? "Save Changes" : "Add Employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
