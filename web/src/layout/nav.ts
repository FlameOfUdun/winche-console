import type { AuthState, SessionUser } from "../api/types";
import type { TabNav } from "../api/tabs";

export interface BuiltinNav { to: string; label: string; icon: "database" | "folder" | "shield" }

// Ordered built-in tabs the user may see, given capabilities + role. Single source for the nav AND the home redirect.
export function builtinNav(state: AuthState | null, user: SessionUser | null): BuiltinNav[] {
  const c = state?.capabilities;
  const out: BuiltinNav[] = [];
  if (c?.database) out.push({ to: "/database", label: "Database", icon: "database" });
  if (c?.storage) out.push({ to: "/storage", label: "Storage", icon: "folder" });
  if (c?.manageUsers && user?.role === "Admin") out.push({ to: "/access", label: "Access", icon: "shield" });
  return out;
}

// First place to land: first visible built-in tab, else the first custom tab, else null (nothing to show).
export function homePath(state: AuthState | null, user: SessionUser | null, tabs: TabNav[] | undefined): string | null {
  const b = builtinNav(state, user);
  if (b.length) return b[0].to;
  if (tabs && tabs.length) return `/${tabs[0].id}`;
  return null;
}
