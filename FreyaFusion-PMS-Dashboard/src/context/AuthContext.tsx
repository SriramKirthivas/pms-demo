// Auth is deliberately not owned by any pm-* service (see pm-architecture
// spec: PM SHALL use URF Auth, not reimplement it). By default this app
// mints a local dev token (src/lib/devAuth.ts) so the persona-picker login
// works against the real backends without a live URF Auth service. Set
// VITE_DEV_LOGIN=0 once a real login endpoint / platform session hookup
// exists, which restores the POST /login path below.
import { createContext, useContext, useState, type ReactNode } from "react";
import { ROLE_USERS, type Role, type RoleUser } from "@/lib/roles";
import { api, TOKEN_KEY } from "@/lib/api";
import { DEV_LOGIN_ENABLED, mintDevToken } from "@/lib/devAuth";

interface LoginResponse {
  token: string;
  user: { name: string; email: string; role: Role; country: string };
}

interface AuthValue {
  role: Role;
  user: RoleUser;
  /** True only while a (non-expired) token is held. */
  authed: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const ROLE_KEY = "pms_role";

const AuthContext = createContext<AuthValue | undefined>(undefined);

const readRole = (): Role => {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(ROLE_KEY) : null;
  return stored === "employee" || stored === "manager" || stored === "admin" ? stored : "manager";
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(
    () => (typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null),
  );
  const [role, setRoleState] = useState<Role>(readRole);

  const login = async (email: string, password: string) => {
    if (!password) throw new Error("Enter a password");

    if (DEV_LOGIN_ENABLED) {
      // DEV ONLY (src/lib/devAuth.ts) — no real backend exists to check the
      // password against (auth is intentionally not a PM-service
      // responsibility; see AuthContext module comment / pm-architecture
      // spec). Any non-empty password for a known demo persona works.
      const persona = Object.values(ROLE_USERS).find((u) => u.email === email);
      if (!persona) throw new Error("Unknown demo account — pick one from the list");
      const devToken = await mintDevToken({ email: persona.email, name: persona.name, role: persona.role });
      localStorage.setItem(TOKEN_KEY, devToken);
      localStorage.setItem(ROLE_KEY, persona.role);
      setToken(devToken);
      setRoleState(persona.role);
      return;
    }

    const res = await api.post<LoginResponse>("/login", { email, password });
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(ROLE_KEY, res.user.role);
    setToken(res.token);
    setRoleState(res.user.role);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ role, user: ROLE_USERS[role], authed: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
