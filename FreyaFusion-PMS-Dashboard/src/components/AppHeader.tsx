import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, HelpCircle, Search, Menu, Command, MessageSquare, CheckCircle2, Lock, LayoutDashboard, Target, User, FileText, BookOpen, LifeBuoy, Mail } from "lucide-react";
import { toast } from "sonner";
import { pmNotify } from "@/lib/pmApi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AppHeaderProps {
  onMenuToggle: () => void;
  pageTitle: string;
  breadcrumb?: string;
}

interface Notification {
  id: string;
  type: "unlock" | "approval" | "feedback";
  title: string;
  body: string;
  href: string;
  at: string | null;
}

// type → icon + colour for the notification row
const NOTIF_STYLE: Record<Notification["type"], { icon: typeof Bell; color: string; bg: string }> = {
  unlock: { icon: Lock, color: "text-amber-600", bg: "bg-amber-50" },
  approval: { icon: CheckCircle2, color: "text-[#0052cc]", bg: "bg-blue-50" },
  feedback: { icon: MessageSquare, color: "text-green-600", bg: "bg-green-50" },
};

// pm-notify GET /notifications row — field names read defensively since the
// exact FastAPI schema isn't pinned down beyond the event catalog.
interface NotificationRsp {
  id: string;
  eventType?: string;
  type?: string;
  title?: string;
  summary?: string;
  body?: string;
  message?: string;
  href?: string;
  link?: string;
  createdAt?: string | null;
  at?: string | null;
  read?: boolean;
  readState?: string;
}

// pm-notify's event catalog -> the header's existing 3-way icon grouping.
const EVENT_TO_TYPE: Record<string, Notification["type"]> = {
  UNLOCK_REQUESTED: "unlock",
  UNLOCK_DECISION: "unlock",
  PERIOD_LOCKED: "unlock",
  GOAL_CASCADED: "approval",
  CHANGE_REQUESTED: "approval",
  ASSIGNMENT_ACCEPTED: "approval",
  ASSIGNMENT_ACTIVE: "approval",
  SCORECARD_PUBLISHED: "approval",
  SCORECARD_ACKNOWLEDGED: "approval",
  SCORECARD_SIGNED_OFF: "approval",
  RATING_SUBMITTED: "approval",
  FEEDBACK_RECEIVED: "feedback",
};

function mapNotification(n: NotificationRsp): Notification {
  return {
    id: n.id,
    type: EVENT_TO_TYPE[n.eventType ?? n.type ?? ""] ?? "approval",
    title: n.title ?? n.eventType ?? n.type ?? "Notification",
    body: n.summary ?? n.body ?? n.message ?? "",
    href: n.href ?? n.link ?? "/dashboard",
    at: n.createdAt ?? n.at ?? null,
  };
}

// "2h ago" style relative time; empty for items without a timestamp.
function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

type ResultType = "Page" | "Person" | "Goal";

interface SearchItem {
  label: string;
  sub: string;
  path: string;
  type: ResultType;
}

const SEARCH_INDEX: SearchItem[] = [
  { label: "Dashboard", sub: "Overview", path: "/dashboard", type: "Page" },
  { label: "Performance Scorecard", sub: "Self vs. manager ratings", path: "/scorecard", type: "Page" },
  { label: "Goals & Cascade", sub: "Objective tree", path: "/goals", type: "Page" },
  { label: "Talent Matrix", sub: "9-box review", path: "/talent", type: "Page" },
  { label: "Development Plans", sub: "Growth & courses", path: "/development", type: "Page" },
  { label: "Team Settings", sub: "Members & access", path: "/settings", type: "Page" },
  { label: "Configuration", sub: "System admin", path: "/config", type: "Page" },
  { label: "My Profile", sub: "Account", path: "/profile", type: "Page" },
  { label: "Sarah Mitchell", sub: "Sr. Product Manager", path: "/talent", type: "Person" },
  { label: "James Okoro", sub: "Sales Lead", path: "/talent", type: "Person" },
  { label: "David Chen", sub: "Backend Engineer", path: "/talent", type: "Person" },
  { label: "Maria Tanaka", sub: "Customer Success", path: "/talent", type: "Person" },
  { label: "Achieve $12M ARR by End of FY2026", sub: "Company objective", path: "/goals", type: "Goal" },
  { label: "Launch Next-Gen Platform by Q4", sub: "Company objective", path: "/goals", type: "Goal" },
  { label: "Achieve NPS Score of 45+", sub: "Company objective", path: "/goals", type: "Goal" },
];

const resultIcon: Record<ResultType, typeof User> = {
  Page: LayoutDashboard,
  Person: User,
  Goal: Target,
};

export default function AppHeader({ onMenuToggle, pageTitle, breadcrumb }: AppHeaderProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [cleared, setCleared] = useState(false); // local "mark all read" dismissal

  useEffect(() => {
    // GET /notifications returns a paginated PageRspVO ({list, total, ...}),
    // not a bare array.
    pmNotify.get<{ list: NotificationRsp[] }>("/notifications?pageSize=50")
      .then((res) => setNotifs(res.list.map(mapNotification)))
      .catch(() => setNotifs([]));
  }, []);

  const markRead = (id: string) => {
    pmNotify.post(`/notifications/${id}/read`, {}).catch(() => { /* best-effort */ });
    setNotifs((prev) => prev.filter((n) => n.id !== id));
  };
  const markAllRead = () => {
    pmNotify.post("/notifications/read-all", {}).catch(() => { /* best-effort */ });
    setCleared(true);
    toast.success("All notifications marked as read");
  };

  const shown = cleared ? [] : notifs;

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return SEARCH_INDEX.filter((i) => i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q)).slice(0, 6);
  }, [search]);

  const showResults = focused && search.trim().length > 0;

  const go = (path: string) => {
    navigate(path);
    setSearch("");
    setFocused(false);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (results.length) go(results[0].path);
  };

  return (
    <header className="h-16 bg-white/90 backdrop-blur-sm border-b border-[#ebedf2] flex items-center px-4 md:px-6 gap-4 flex-shrink-0 sticky top-0 z-10">
      {/* Mobile hamburger */}
      <button
        onClick={onMenuToggle}
        className="lg:hidden p-1.5 rounded hover:bg-[#f3f4f6] transition-colors text-[#0f1b3d]"
      >
        <Menu size={18} />
      </button>

      {/* Page title area */}
      <div className="hidden md:flex flex-col justify-center min-w-0">
        {breadcrumb && (
          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider leading-none mb-0.5">
            {breadcrumb}
          </p>
        )}
        <h1 className="text-[15px] font-semibold text-[#0f1b3d] leading-tight truncate">{pageTitle}</h1>
      </div>

      {/* Global search */}
      <form onSubmit={onSubmit} className="flex-1 max-w-sm ml-0 md:ml-6">
        <div className="relative flex items-center">
          <Search size={13} className="absolute left-3 text-gray-400 pointer-events-none z-10" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            placeholder="Search pages, people, goals..."
            className="w-full pl-8 pr-16 py-2 text-[13px] bg-[#f5f6f8] border border-[#ebedf2] rounded-[9px] text-[#0f1b3d] placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-[#0052cc] focus:ring-2 focus:ring-[#0052cc]/15 transition-all"
          />
          <div className="absolute right-2.5 flex items-center gap-0.5 pointer-events-none">
            <kbd className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-white border border-[#e5e7eb] rounded">
              <Command size={9} />K
            </kbd>
          </div>

          {/* Results dropdown */}
          {showResults && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-[#e5e7eb] rounded-[8px] shadow-lg overflow-hidden z-20">
              {results.length ? (
                <ul className="py-1 max-h-80 overflow-y-auto">
                  {results.map((r) => {
                    const Icon = resultIcon[r.type];
                    return (
                      <li key={`${r.type}-${r.label}`}>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); go(r.path); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#f3f4f6] transition-colors"
                        >
                          <div className="w-6 h-6 rounded-[5px] bg-[#e6eefa] flex items-center justify-center flex-shrink-0">
                            <Icon size={12} className="text-[#0052cc]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-medium text-[#0f1b3d] truncate">{r.label}</p>
                            <p className="text-[11px] text-gray-400 truncate">{r.sub}</p>
                          </div>
                          <span className="text-[10px] text-gray-400 uppercase tracking-wide flex-shrink-0">{r.type}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="px-3 py-4 text-center text-[12px] text-gray-400">No results for "{search.trim()}"</div>
              )}
            </div>
          )}
        </div>
      </form>

      {/* Right utility icons */}
      <div className="flex items-center gap-1 ml-auto">
        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="relative p-2 rounded-[6px] hover:bg-[#f3f4f6] transition-colors text-gray-500 hover:text-[#0f1b3d]">
              <Bell size={16} />
              {shown.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#0052cc] text-white text-[9px] font-bold flex items-center justify-center">
                  {shown.length > 9 ? "9+" : shown.length}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications</span>
              {shown.length > 0 && <span className="text-[11px] font-normal text-gray-400">{shown.length} pending</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {shown.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <CheckCircle2 size={20} className="mx-auto text-green-500 mb-1.5" />
                <p className="text-[12px] text-gray-500">You're all caught up</p>
              </div>
            ) : (
              shown.map((n) => {
                const st = NOTIF_STYLE[n.type];
                return (
                  <DropdownMenuItem key={n.id} className="gap-2.5 py-2 items-start cursor-pointer" onClick={() => { markRead(n.id); navigate(n.href); }}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${st.bg}`}>
                      <st.icon size={12} className={st.color} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-[#0f1b3d] leading-snug whitespace-normal">{n.title}</p>
                      <p className="text-[11px] text-gray-500 leading-snug whitespace-normal truncate">{n.body}</p>
                      {n.at && <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(n.at)}</p>}
                    </div>
                  </DropdownMenuItem>
                );
              })
            )}
            {shown.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="justify-center text-[#0052cc] text-[12px] font-medium"
                  onClick={markAllRead}
                >
                  Mark all read
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Help */}
        <button
          onClick={() => setHelpOpen(true)}
          className="p-2 rounded-[6px] hover:bg-[#f3f4f6] transition-colors text-gray-500 hover:text-[#0f1b3d]"
        >
          <HelpCircle size={16} />
        </button>
      </div>

      {/* Help dialog */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Help &amp; Support</DialogTitle>
            <DialogDescription>Quick links, shortcuts, and how to reach us.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div>
              <p className="text-[11px] text-gray-400 uppercase tracking-wider font-medium mb-2">Quick links</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Getting started", icon: BookOpen, path: "/dashboard" },
                  { label: "Manage goals", icon: Target, path: "/goals" },
                  { label: "Talent reviews", icon: User, path: "/talent" },
                  { label: "Documentation", icon: FileText, path: "/config" },
                ].map((l) => (
                  <button
                    key={l.label}
                    onClick={() => { setHelpOpen(false); navigate(l.path); }}
                    className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-[#0f1b3d] border border-[#e5e7eb] rounded-[6px] hover:bg-[#f3f4f6] transition-colors text-left"
                  >
                    <l.icon size={13} className="text-[#0052cc] flex-shrink-0" />
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] text-gray-400 uppercase tracking-wider font-medium mb-2">Keyboard shortcuts</p>
              <ul className="space-y-1.5 text-[12.5px] text-[#0f1b3d]">
                {[
                  { keys: "⌘ K", desc: "Open search" },
                  { keys: "G then D", desc: "Go to Dashboard" },
                  { keys: "G then G", desc: "Go to Goals" },
                  { keys: "?", desc: "Open this help" },
                ].map((s) => (
                  <li key={s.desc} className="flex items-center justify-between">
                    <span className="text-gray-500">{s.desc}</span>
                    <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-gray-500 bg-[#f3f4f6] border border-[#e5e7eb] rounded">{s.keys}</kbd>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center gap-3 pt-3 border-t border-[#e5e7eb]">
              <button
                onClick={() => { window.location.href = "mailto:support@freyafusion.com"; }}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium bg-[#0052cc] text-white rounded-[5px] hover:bg-[#003d99] transition-colors"
              >
                <Mail size={12} /> Email support
              </button>
              <button
                onClick={() => toast.success("Connecting you to live chat…")}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-[#0f1b3d] border border-[#e5e7eb] rounded-[5px] hover:bg-[#f3f4f6] transition-colors"
              >
                <LifeBuoy size={12} /> Live chat
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
