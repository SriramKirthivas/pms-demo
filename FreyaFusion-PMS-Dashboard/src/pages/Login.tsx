import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Lock, Eye, EyeOff, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { ROLE_ORDER, ROLE_USERS, type Role } from "@/lib/roles";
import { FALLBACK_AVATAR } from "@/lib/avatar";

const DEMO_PASSWORD = "demo1234";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [selected, setSelected] = useState<Role>("manager");
  const [email, setEmail] = useState(ROLE_USERS.manager.email);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const pickPersona = (r: Role) => {
    setSelected(r);
    setEmail(ROLE_USERS[r].email);
    setPassword(DEMO_PASSWORD);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Enter your email and password");
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      toast.success("Signed in", { description: email.trim() });
      navigate("/dashboard");
    } catch (err) {
      toast.error("Sign in failed", { description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-gradient-to-br from-[#0f1b3d] via-[#142a52] to-[#0f1b3d] p-12 text-white relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-[#0052cc]/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-16 w-96 h-96 rounded-full bg-[#0052cc]/10 blur-3xl pointer-events-none" />
        <div className="flex items-center gap-2.5 relative">
          <div className="w-8 h-8 rounded-[8px] bg-gradient-to-br from-[#0052cc] to-[#003d99] flex items-center justify-center shadow-lg">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <span className="font-semibold text-[16px] tracking-tight">Freya Fusion</span>
            <span className="block text-white/40 text-[10px] font-medium tracking-wide uppercase">PMS v2.1</span>
          </div>
        </div>

        <div className="relative">
          <h1 className="text-[28px] font-bold leading-tight mb-3">Performance management,<br />reimagined.</h1>
          <p className="text-white/60 text-[14px] leading-relaxed max-w-md">
            Goals cascade, calibrated scorecards, and 9-box talent reviews — all in one place. Sign in to pick up where you left off.
          </p>
        </div>

        <p className="text-white/30 text-[11px] relative">© 2026 Freya Fusion. All rights reserved.</p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-[#f8fafc]">
        <div className="w-full max-w-sm">
          {/* Brand on mobile */}
          <div className="flex lg:hidden items-center gap-2.5 mb-8 justify-center">
            <div className="w-8 h-8 rounded bg-[#0052cc] flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            <span className="font-semibold text-[16px] tracking-tight text-[#0f1b3d]">Freya Fusion</span>
          </div>

          <h2 className="text-[20px] font-bold text-[#0f1b3d] mb-1">Sign in</h2>
          <p className="text-[13px] text-gray-500 mb-5">Pick a demo account, or enter credentials.</p>

          {/* Persona quick-pick — fills real credentials */}
          <div className="space-y-2 mb-5">
            <label className="block text-[11px] text-gray-400 uppercase tracking-wider font-medium">Demo accounts</label>
            {ROLE_ORDER.map((r) => {
              const u = ROLE_USERS[r];
              const active = selected === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => pickPersona(r)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] border text-left transition-colors ${
                    active ? "border-[#0052cc] bg-[#0052cc]/5 ring-1 ring-[#0052cc]/20" : "border-[#e5e7eb] bg-white hover:bg-[#f3f4f6]"
                  }`}
                >
                  <img
                    src={u.avatar}
                    alt={u.name}
                    className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_AVATAR; }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-[#0f1b3d] truncate">{u.name}</p>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#0f1b3d]/8 text-[#0f1b3d] flex-shrink-0">{u.access}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 truncate">{u.tagline}</p>
                  </div>
                  {active && <Check size={16} className="text-[#0052cc] flex-shrink-0" />}
                </button>
              );
            })}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-[#0f1b3d]">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-3 py-2.5 text-[13px] bg-white border border-[#e5e7eb] rounded-[6px] text-[#0f1b3d] focus:outline-none focus:border-[#0052cc] focus:ring-1 focus:ring-[#0052cc]/20"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-[12px] font-medium text-[#0f1b3d]">Password</label>
                <button
                  type="button"
                  onClick={() => toast.info("Password reset link sent to your email")}
                  className="text-[11px] text-[#0052cc] font-medium hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-9 py-2.5 text-[13px] bg-white border border-[#e5e7eb] rounded-[6px] text-[#0f1b3d] focus:outline-none focus:border-[#0052cc] focus:ring-1 focus:ring-[#0052cc]/20"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#0f1b3d]"
                >
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">Demo password: <span className="font-mono font-medium text-gray-500">{DEMO_PASSWORD}</span></p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#0052cc] text-white text-[13px] font-semibold rounded-[6px] hover:bg-[#003d99] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="text-[12px] text-gray-500 text-center mt-6">
            Don't have an account?{" "}
            <button
              onClick={() => toast.info("Contact your workspace admin to request access")}
              className="text-[#0052cc] font-medium hover:underline"
            >
              Request access
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
