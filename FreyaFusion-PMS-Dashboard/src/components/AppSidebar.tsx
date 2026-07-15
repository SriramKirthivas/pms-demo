import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FALLBACK_AVATAR } from "@/lib/avatar";
import { useAuth } from "@/context/AuthContext";
import { canAccess } from "@/lib/roles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  Users,
  UsersRound,
  BarChart3,
  Settings,
  ChevronRight,
  Zap,
  Shield,
  TrendingUp,
  GitBranch,
  MessageSquare,
  User,
  LogOut,
} from "lucide-react";

const navGroups = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
    ],
  },
  {
    label: "Performance",
    items: [
      { label: "Summary", icon: TrendingUp, path: "/summary" },
      { label: "Scorecard", icon: BarChart3, path: "/scorecard" },
      { label: "Goals & Cascade", icon: GitBranch, path: "/goals" },
      // Manager/admin only (canAccess filters it out for employees) — a
      // per-report team rollup, distinct from the flat Goals list.
      { label: "My Team", icon: UsersRound, path: "/team" },
      // "Company Goals" hidden: its data lived on the retired ad-hoc backend
      // and no pm-* service owns that concept yet. Route still exists.
      { label: "Feedback", icon: MessageSquare, path: "/feedback" },
    ],
  },
  {
    label: "Talent",
    items: [
      { label: "Talent Matrix", icon: Users, path: "/talent" },
      // "Competencies" hidden: same reason — no owning pm-* service yet.
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Team Settings", icon: Shield, path: "/settings" },
      { label: "Configuration", icon: Settings, path: "/config" },
    ],
  },
];

interface AppSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AppSidebar({ isOpen, onClose }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { role, user, logout } = useAuth();

  // Only show nav items this role can access; drop groups left empty.
  const visibleGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canAccess(i.path, role)) }))
    .filter((g) => g.items.length > 0);

  const handleSignOut = () => {
    logout();
    toast.success("Signed out");
    navigate("/login");
    onClose();
  };

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-30 h-full w-64 flex flex-col
          bg-white border-r border-[#ebedf2]
          transition-transform duration-200 ease-in-out
          lg:static lg:translate-x-0 lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-[#f0f1f4] flex-shrink-0">
          <div className="w-8 h-8 rounded-[8px] bg-gradient-to-br from-[#0052cc] to-[#003d99] flex items-center justify-center flex-shrink-0 shadow-sm">
            <Zap size={15} className="text-white" />
          </div>
          <div>
            <span className="text-[#16203b] font-semibold text-[14px] tracking-tight">Freya Fusion</span>
            <span className="block text-gray-400 text-[10px] font-medium tracking-wide uppercase">PMS v2.1</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="ff-label px-3 mb-1.5">{group.label}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        onClick={onClose}
                        className={`ff-nav-item ${isActive ? "active" : ""}`}
                      >
                        <item.icon size={14} className="flex-shrink-0" />
                        <span>{item.label}</span>
                        {isActive && <ChevronRight size={12} className="ml-auto opacity-60" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Bottom user account menu */}
        <div className="px-3 pb-4 border-t border-[#f0f1f4] pt-3 flex-shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[8px] border border-transparent hover:border-[#ebedf2] hover:bg-[#f7f9fc] cursor-pointer transition-colors text-left">
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-2 ring-[#eef0f4]"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_AVATAR; }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[#16203b] text-[12px] font-semibold leading-tight truncate">{user.name}</p>
                  <p className="text-gray-400 text-[11px] leading-tight truncate">{user.title}</p>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-[#eef4fa] text-[#0052cc] flex-shrink-0">
                  {user.access}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-48">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { navigate("/profile"); onClose(); }}>
                <User size={13} className="mr-2" /> Profile
              </DropdownMenuItem>
              {canAccess("/settings", role) && (
                <DropdownMenuItem onClick={() => { navigate("/settings"); onClose(); }}>
                  <Settings size={13} className="mr-2" /> Team Settings
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleSignOut}>
                <LogOut size={13} className="mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
