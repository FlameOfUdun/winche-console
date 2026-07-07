import { createContext, useContext } from "react";
import type { CommandSpec, TableRow } from "../api/tabs";

export type RoleName = "viewer" | "member" | "admin";
const RANK: Record<RoleName, number> = { viewer: 0, member: 1, admin: 2 };

export interface RunOptions { rowKey: string | null; prefillRow?: TableRow }

export interface TabRuntime {
  commands: Record<string, CommandSpec>;
  userRole: RoleName;
  canRun: (c: CommandSpec) => boolean;
  runCommand: (c: CommandSpec, opts: RunOptions) => void;
  refresh: () => void;
  commit: () => void;
}

const Ctx = createContext<TabRuntime | null>(null);
export const TabRuntimeProvider = Ctx.Provider;

export function useTabRuntime(): TabRuntime {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTabRuntime used outside a tab");
  return v;
}

export function canRunFor(userRole: RoleName, c: CommandSpec): boolean {
  return RANK[userRole] >= RANK[c.minRole];
}
