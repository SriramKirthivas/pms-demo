import AppLayout from "@/components/AppLayout";
import { Settings, ToggleLeft, ToggleRight, ScrollText, ShieldAlert, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface AuditEntry {
  actor: string;
  role: string;
  action: string;
  target: string;
  reason: string;
  allowed: boolean;
  at: string;
}

const actionLabel: Record<string, string> = {
  "goal:create": "Created goal",
  "goal:delete": "Deleted goal",
  "member:invite": "Invited member",
  "team:update": "Updated team config",
  "people:update": "Updated talent rating",
  "people:read": "Viewed talent",
  "team:read": "Viewed team",
  "audit:read": "Viewed audit log",
};

const configSections = [
  {
    section: "Review Cycles",
    items: [
      { key: "auto_remind", label: "Auto-send reminders", desc: "Automatically remind employees 7 days before due dates", default: true },
      { key: "cascade_lock", label: "Lock cascaded goals", desc: "Prevent employees from editing cascaded company goals", default: false },
      { key: "manager_override", label: "Allow manager override", desc: "Managers can adjust self-review scores before submission", default: true },
    ],
  },
  {
    section: "Visibility & Privacy",
    items: [
      { key: "show_peer", label: "Show peer feedback to employees", desc: "Employees can see anonymous peer feedback in their review", default: true },
      { key: "calibration_visible", label: "Calibration scores visible", desc: "Show calibrated scores to employees after cycle close", default: false },
      { key: "nine_box_share", label: "Share 9-box position", desc: "Allow employees to see their talent matrix placement", default: false },
    ],
  },
  {
    section: "Integrations",
    items: [
      { key: "slack_notify", label: "Slack notifications", desc: "Send performance milestones and reminders to Slack", default: true },
      { key: "hris_sync", label: "HRIS auto-sync", desc: "Sync employee data daily from connected HRIS", default: true },
    ],
  },
];

export default function Config() {
  const [states, setStates] = useState<Record<string, boolean>>(
    Object.fromEntries(configSections.flatMap((s) => s.items.map((i) => [i.key, i.default])))
  );
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  useEffect(() => {
    api.get<AuditEntry[]>("/audit").then(setAudit).catch(() => setAudit([]));
  }, []);

  const toggle = (key: string) => setStates((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <AppLayout pageTitle="System Configuration" breadcrumb="Admin">
      <div className="max-w-3xl space-y-4">
        {/* Audit log — who did what (and denied attempts) */}
        <div className="ff-card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[#e5e7eb] bg-[#f8fafc]">
            <ScrollText size={13} className="text-[#0052cc]" />
            <h2 className="text-[12px] font-semibold text-[#0f1b3d] uppercase tracking-wider">Audit Log</h2>
            <span className="ml-auto text-[11px] text-gray-400">{audit.length} recent events</span>
          </div>
          {audit.length === 0 ? (
            <div className="px-5 py-8 text-center text-[12px] text-gray-400">No audit events recorded yet.</div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-[#e5e7eb]">
                    <th className="text-left px-5 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Action</th>
                    <th className="text-left px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Actor</th>
                    <th className="text-left px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">Target</th>
                    <th className="text-left px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Result</th>
                    <th className="text-right px-5 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3f4f6]">
                  {audit.map((e, i) => (
                    <tr key={i} className="table-row-hover">
                      <td className="px-5 py-2.5 text-[12.5px] font-medium text-[#0f1b3d]">{actionLabel[e.action] ?? e.action}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-[12px] text-[#0f1b3d]">{e.actor}</span>
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-[#eef4fa] text-[#0052cc]">{e.role}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-gray-500 hidden sm:table-cell max-w-[200px]">
                        <span className="block truncate">{e.target}</span>
                        {e.reason && <span className="block truncate text-[11px] text-gray-400 italic">"{e.reason}"</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {e.allowed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
                            <CheckCircle2 size={10} /> Allowed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">
                            <ShieldAlert size={10} /> Denied
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-[11px] text-gray-400 text-right hidden md:table-cell whitespace-nowrap">
                        {new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {configSections.map((sec) => (
          <div key={sec.section} className="ff-card overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[#e5e7eb] bg-[#f8fafc]">
              <Settings size={13} className="text-[#0052cc]" />
              <h2 className="text-[12px] font-semibold text-[#0f1b3d] uppercase tracking-wider">{sec.section}</h2>
            </div>
            <div className="divide-y divide-[#f3f4f6]">
              {sec.items.map((item) => (
                <div key={item.key} className="flex items-center justify-between px-5 py-3.5 table-row-hover">
                  <div className="flex-1 pr-4">
                    <p className="text-[13px] font-medium text-[#0f1b3d]">{item.label}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{item.desc}</p>
                  </div>
                  <button
                    onClick={() => toggle(item.key)}
                    className="flex-shrink-0 transition-colors"
                    aria-label={`Toggle ${item.label}`}
                  >
                    {states[item.key] ? (
                      <ToggleRight size={24} className="text-[#0052cc]" />
                    ) : (
                      <ToggleLeft size={24} className="text-gray-300" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  );
}