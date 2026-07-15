// Role-based access model for the PMS prototype.
export type Role = "employee" | "manager" | "admin";

export interface RoleUser {
  role: Role;
  name: string;
  title: string;
  email: string;
  department: string;
  avatar: string;
  access: string; // badge label
  tagline: string; // shown on the login persona card
}

export const ROLE_USERS: Record<Role, RoleUser> = {
  employee: {
    role: "employee",
    name: "David Chen",
    title: "Backend Engineer",
    email: "d.chen@company.com",
    department: "Engineering",
    avatar: "https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-3.jpg",
    access: "Employee",
    tagline: "Track my goals, self-review & growth",
  },
  manager: {
    role: "manager",
    name: "Sarah Mitchell",
    title: "Sr. Product Manager",
    email: "s.mitchell@company.com",
    department: "Product & Strategy",
    avatar: "https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-1.jpg",
    access: "Manager",
    tagline: "Manage my team, ratings & talent",
  },
  admin: {
    role: "admin",
    name: "Nina Patel",
    title: "HR Business Partner",
    email: "n.patel@company.com",
    department: "People Operations",
    avatar: "https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-7.jpg",
    access: "Admin",
    tagline: "Configure cycles & full org access",
  },
};

export const ROLE_ORDER: Role[] = ["employee", "manager", "admin"];

// Which roles may access each route. Used by the sidebar (to hide nav) and the
// route guard (to block direct URL access).
export const ROUTE_ACCESS: Record<string, Role[]> = {
  "/dashboard": ["employee", "manager", "admin"],
  "/summary": ["employee", "manager", "admin"],
  "/scorecard": ["employee", "manager", "admin"],
  "/goals": ["employee", "manager", "admin"],
  "/team": ["manager", "admin"],
  "/company-goals": ["employee", "manager", "admin"],
  "/feedback": ["employee", "manager", "admin"],
  "/talent": ["manager", "admin"],
  "/competencies": ["employee", "manager", "admin"],
  "/development": ["employee", "manager", "admin"],
  "/settings": ["manager", "admin"],
  "/config": ["admin"],
  "/profile": ["employee", "manager", "admin"],
};

export const canAccess = (path: string, role: Role): boolean =>
  (ROUTE_ACCESS[path] ?? ["employee", "manager", "admin"]).includes(role);
