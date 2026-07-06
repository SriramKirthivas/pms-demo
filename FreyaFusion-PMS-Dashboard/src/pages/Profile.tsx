import AppLayout from "@/components/AppLayout";
import { useEffect, useState } from "react";
import { Mail, Phone, MapPin, Building2, Calendar, Save, Target, Star, TrendingUp, Bell } from "lucide-react";
import { toast } from "sonner";
import { FALLBACK_AVATAR } from "@/lib/avatar";
import { useAuth } from "@/context/AuthContext";
import { pmNotify } from "@/lib/pmApi";

// pm-notify GET/PUT /preferences — { eventType: emailEnabled }, defaulting to
// enabled for any event type without an explicit row.
const EVENT_LABELS: Record<string, string> = {
  GOAL_CASCADED: "A goal is cascaded to me",
  CHANGE_REQUESTED: "A change is requested on a goal I set/review",
  ASSIGNMENT_ACCEPTED: "A goal assignment is accepted",
  ASSIGNMENT_ACTIVE: "A goal assignment becomes active",
  PERIOD_LOCKED: "A review period is locked",
  UNLOCK_REQUESTED: "An unlock is requested (admin)",
  UNLOCK_DECISION: "My unlock request is decided",
  RATING_SUBMITTED: "A new rating is submitted about me",
  FEEDBACK_RECEIVED: "I receive continuous feedback",
  SCORECARD_PUBLISHED: "My scorecard is published",
  SCORECARD_ACKNOWLEDGED: "A scorecard is acknowledged",
  SCORECARD_SIGNED_OFF: "My scorecard is signed off",
};

const stats = [
  { label: "Goals Completed", value: "12 / 15", icon: Target, color: "#16a34a" },
  { label: "Avg Competency", value: "4.2 / 5", icon: Star, color: "#ca8a04" },
  { label: "Performance", value: "87.4%", icon: TrendingUp, color: "#0052cc" },
];

const bioByRole: Record<string, string> = {
  employee: "Backend engineer focused on distributed systems and platform reliability. Currently leveling up on technical leadership and cloud architecture.",
  manager: "Product leader focused on platform strategy and data-driven roadmaps. Currently driving the Next-Gen Platform launch and enterprise ARR growth.",
  admin: "HR business partner owning the performance cycle, calibration, and people analytics across the organization.",
};

export default function Profile() {
  const { user } = useAuth();
  const AVATAR = user.avatar;

  const fields = [
    { key: "name", label: "Full Name", value: user.name, icon: null },
    { key: "title", label: "Job Title", value: user.title, icon: null },
    { key: "email", label: "Email", value: user.email, icon: Mail },
    { key: "phone", label: "Phone", value: "+1 (415) 555-0142", icon: Phone },
    { key: "department", label: "Department", value: user.department, icon: Building2 },
    { key: "location", label: "Location", value: "San Francisco, CA", icon: MapPin },
  ];

  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.value]))
  );
  const [bio, setBio] = useState(bioByRole[user.role]);

  // Notification preferences (pm-notify) — which event types deliver email;
  // in-app notifications always fire regardless of this setting.
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsSaving, setPrefsSaving] = useState(false);

  useEffect(() => {
    pmNotify.get<Record<string, boolean>>("/preferences")
      .then(setPrefs)
      .catch(() => setPrefs({}))
      .finally(() => setPrefsLoading(false));
  }, []);

  const togglePref = (eventType: string) =>
    setPrefs((prev) => ({ ...prev, [eventType]: !(prev[eventType] ?? true) }));

  const savePrefs = async () => {
    setPrefsSaving(true);
    try {
      // pm-notify expects a list of {eventType, emailEnabled}, not a map.
      const preferences = Object.entries(prefs).map(([eventType, emailEnabled]) => ({ eventType, emailEnabled }));
      await pmNotify.put("/preferences", { preferences });
      toast.success("Notification preferences saved");
    } catch (err) {
      toast.error("Could not save preferences", { description: (err as Error).message });
    } finally {
      setPrefsSaving(false);
    }
  };

  return (
    <AppLayout pageTitle="My Profile" breadcrumb="Account">
      <div className="max-w-4xl space-y-4">
        {/* Header card */}
        <div className="ff-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <img
              src={AVATAR}
              alt={user.name}
              className="w-20 h-20 rounded-full object-cover border-2 border-white shadow-sm"
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_AVATAR; }}
            />
            <div className="flex-1">
              <h2 className="text-[18px] font-bold text-[#0f1b3d]">{values.name}</h2>
              <p className="text-[13px] text-gray-500">{values.title} · {values.department}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[12px] text-gray-400">
                <span className="flex items-center gap-1.5"><Mail size={12} /> {values.email}</span>
                <span className="flex items-center gap-1.5"><MapPin size={12} /> {values.location}</span>
                <span className="flex items-center gap-1.5"><Calendar size={12} /> Joined Mar 2022</span>
              </div>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#0052cc]/10 text-[#0052cc] h-fit">
              {user.access} Access
            </span>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="ff-card p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-[6px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: s.color + "18" }}>
                <s.icon size={16} style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">{s.label}</p>
                <p className="text-[18px] font-bold text-[#0f1b3d] leading-tight">{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Editable details */}
        <div className="ff-card p-5">
          <h3 className="text-[13px] font-semibold text-[#0f1b3d] mb-4 pb-3 border-b border-[#e5e7eb]">Personal Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.map((f) => (
              <div key={f.key}>
                <label className="block text-[11px] text-gray-400 uppercase tracking-wider font-medium mb-1">{f.label}</label>
                <div className="relative">
                  {f.icon && <f.icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />}
                  <input
                    value={values[f.key]}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    className={`w-full ${f.icon ? "pl-9" : "pl-3"} pr-3 py-2 text-[13px] bg-[#f3f4f6] border border-[#e5e7eb] rounded-[5px] text-[#0f1b3d] focus:outline-none focus:border-[#0052cc] focus:ring-1 focus:ring-[#0052cc]/20`}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <label className="block text-[11px] text-gray-400 uppercase tracking-wider font-medium mb-1">About</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-[13px] bg-[#f3f4f6] border border-[#e5e7eb] rounded-[5px] text-[#0f1b3d] focus:outline-none focus:border-[#0052cc] focus:ring-1 focus:ring-[#0052cc]/20 resize-none"
            />
          </div>

          <button
            onClick={() => toast.success("Profile updated", { description: "Your changes have been saved." })}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-[#0052cc] text-white text-[12px] font-medium rounded-[5px] hover:bg-[#003d99] transition-colors"
          >
            <Save size={12} />
            Save Profile
          </button>
        </div>

        {/* Notification preferences (pm-notify) */}
        <div className="ff-card p-5">
          <h3 className="text-[13px] font-semibold text-[#0f1b3d] mb-1 pb-3 border-b border-[#e5e7eb] flex items-center gap-2">
            <Bell size={14} className="text-[#0052cc]" /> Notification Preferences
          </h3>
          <p className="text-[12px] text-gray-400 mt-3 mb-3">
            In-app notifications always arrive. Turn email off for events you don't need in your inbox.
          </p>
          {prefsLoading ? (
            <p className="text-[12px] text-gray-400">Loading…</p>
          ) : (
            <div className="space-y-1">
              {Object.keys(prefs).sort().map((eventType) => (
                <label key={eventType} className="flex items-center justify-between gap-3 py-2 border-b border-[#f3f4f6] last:border-b-0 cursor-pointer">
                  <span className="text-[13px] text-[#16203b]">{EVENT_LABELS[eventType] ?? eventType}</span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] text-gray-400">Email</span>
                    <input
                      type="checkbox"
                      checked={prefs[eventType] ?? true}
                      onChange={() => togglePref(eventType)}
                      className="accent-[#0052cc] w-4 h-4"
                    />
                  </span>
                </label>
              ))}
            </div>
          )}
          <button
            onClick={savePrefs}
            disabled={prefsLoading || prefsSaving}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-[#0052cc] text-white text-[12px] font-medium rounded-[5px] hover:bg-[#003d99] transition-colors disabled:opacity-60"
          >
            <Save size={12} />
            {prefsSaving ? "Saving…" : "Save Preferences"}
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
