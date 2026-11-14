import type { AuthState, SessionUser } from "../api/types";
import type { TabNav } from "../api/tabs";

export type NavIcon = "database" | "folder" | "shield" | "logs" | "users" | "hooks" | "functions";
export interface BuiltinNav { to: string; label: string; icon: NavIcon; group: "build" | "monitor" }

// Ordered built-in tabs the user may see, given capabilities + role. Single source for the nav AND the home redirect.
// Apps, the console's users and CI tokens are in Project settings (the gear), like Firebase's.
export function builtinNav(state: AuthState | null, _user: SessionUser | null): BuiltinNav[] {
  const c = state?.capabilities;
  const out: BuiltinNav[] = [];
  if (c?.database) out.push({ to: "/database", label: "Database", icon: "database", group: "build" });
  if (c?.storage) out.push({ to: "/storage", label: "Storage", icon: "folder", group: "build" });
  if (c?.authentication) out.push({ to: "/authentication", label: "Authentication", icon: "users", group: "build" });
  if (c?.functions) out.push({ to: "/functions", label: "Functions", icon: "functions", group: "build" });
  if (c?.hooks) out.push({ to: "/hooks", label: "Hooks", icon: "hooks", group: "build" });
  if (c?.logs?.app) out.push({ to: "/logs", label: "Logs", icon: "logs", group: "monitor" });
  return out;
}

// First place to land: the project overview once signed in (it shows whatever the user may see).
export function homePath(state: AuthState | null, user: SessionUser | null, tabs: TabNav[] | undefined): string | null {
  if (state) return "/overview";
  const b = builtinNav(state, user);
  if (b.length) return b[0].to;
  if (tabs && tabs.length) return `/${tabs[0].id}`;
  return null;
}
