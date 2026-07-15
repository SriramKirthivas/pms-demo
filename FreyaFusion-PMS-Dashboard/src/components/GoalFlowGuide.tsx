import { useState } from "react";
import {
  Settings2, Target, GitBranch, Check, Star, Lock, Award, ChevronDown, ChevronRight, X,
} from "lucide-react";

// Explains the real pm-goal → pm-eval → pm-score performance cycle as a visible,
// step-to-step flow, and — per the meeting ask — spells out WHO can act at each
// stage. Collapsible; remembers its state so it doesn't nag on every visit.

type Actor = "Admin" | "Manager" | "Employee" | "System";

const ACTOR_STYLE: Record<Actor, string> = {
  Admin: "bg-[#f3effd] text-[#7c3aed]",
  Manager: "bg-[#e6eefa] text-[#0052cc]",
  Employee: "bg-[#eafaf1] text-[#0f9d58]",
  System: "bg-gray-100 text-gray-500",
};

interface Stage {
  icon: typeof Target;
  tint: string;
  title: string;
  body: string;
  actors: Actor[];
}

const STAGES: Stage[] = [
  {
    icon: Settings2, tint: "#7c3aed", title: "Configure framework",
    body: "Open the fiscal year: pick cadences (quarterly/annual) and the Team vs Individual split. Review periods are derived automatically.",
    actors: ["Admin"],
  },
  {
    icon: Target, tint: "#0052cc", title: "Author goals",
    body: "Create goals under each pillar with a measure, description and 1/3/5 scoring rubric. Each pillar's weights must total 10 before cascade.",
    actors: ["Manager", "Admin"],
  },
  {
    icon: GitBranch, tint: "#0052cc", title: "Cascade",
    body: "Assign goals to employees — one assignment each, starting at Pending Acceptance.",
    actors: ["Manager", "Admin"],
  },
  {
    icon: Check, tint: "#0f9d58", title: "Accept (both sides)",
    body: "Employee and manager both accept → the goal goes Active. The employee can request a weight/criteria change first, sending it back to re-accept.",
    actors: ["Employee", "Manager"],
  },
  {
    icon: Star, tint: "#f59e0b", title: "Rate & check in",
    body: "Through the period: the employee self-rates (reference) and the manager rates (official IPF), plus quarterly check-in notes and the mid-year review.",
    actors: ["Employee", "Manager"],
  },
  {
    icon: Lock, tint: "#64748b", title: "Complete & lock",
    body: "An employee can request early completion for the manager to approve. At period end the admin locks the period; a manager may request an unlock.",
    actors: ["Employee", "Manager", "Admin"],
  },
  {
    icon: Award, tint: "#16a34a", title: "Score (IPF)",
    body: "The manager's ratings roll up into the IPF scorecard (Team 60% + Individual 40%). The employee acknowledges; HR signs off.",
    actors: ["System", "Employee", "Admin"],
  },
];

const HELP_KEY = "ff-goal-flow-open";

export default function GoalFlowGuide() {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(HELP_KEY) !== "0"; } catch { return true; }
  });
  const toggle = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(HELP_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };

  if (!open) {
    return (
      <button onClick={() => toggle(true)}
        className="ff-card w-full px-4 py-2.5 mb-4 flex items-center gap-2 text-[12.5px] font-medium text-[#0052cc] hover:bg-[#f4f8fd] transition-colors">
        <ChevronDown size={15} /> How the performance cycle works
      </button>
    );
  }

  return (
    <div className="ff-card p-5 mb-4 bg-gradient-to-br from-[#f4f8fd] to-white">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-[14px] font-bold text-[#16203b]">How the performance cycle works</h3>
          <p className="text-[12px] text-gray-500 mt-0.5">
            Each goal moves through these stages. The coloured chips show{" "}
            <span className="font-medium text-[#16203b]">who can act</span> at each step.
          </p>
        </div>
        <button onClick={() => toggle(false)} title="Hide"
          className="p-1 rounded hover:bg-white text-gray-400 flex-shrink-0"><X size={15} /></button>
      </div>

      {/* Actor legend */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[11px] text-gray-400">Who acts:</span>
        {(Object.keys(ACTOR_STYLE) as Actor[]).map((a) => (
          <span key={a} className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${ACTOR_STYLE[a]}`}>{a}</span>
        ))}
      </div>

      {/* Stage flow */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
        {STAGES.map((s, i) => (
          <div key={s.title} className="relative rounded-[10px] border border-[#e7ecf3] bg-white px-3 py-3 flex flex-col">
            {/* Arrow to next stage (hidden on the last, and on stacked/narrow layouts) */}
            {i < STAGES.length - 1 && (
              <ChevronRight size={16} className="hidden xl:block absolute -right-[11px] top-1/2 -translate-y-1/2 text-gray-300 z-10 bg-white rounded-full" />
            )}
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ background: `${s.tint}1a` }}>
                <s.icon size={14} style={{ color: s.tint }} />
              </div>
              <span className="text-[11px] font-bold text-gray-300">{i + 1}</span>
            </div>
            <p className="text-[12.5px] font-semibold text-[#16203b] leading-tight">{s.title}</p>
            <p className="text-[11px] text-gray-500 leading-snug mt-1 flex-1">{s.body}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {s.actors.map((a) => (
                <span key={a} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${ACTOR_STYLE[a]}`}>{a}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
