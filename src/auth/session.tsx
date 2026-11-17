import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { AuthState, ConsoleRole, SessionUser } from "../api/types";
import { currentProject } from "../api/scope";

interface SessionCtx {
  state: AuthState | null;
  user: SessionUser | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>({ state: null, user: null, refresh: async () => {} });
export const SessionContext = Ctx;
export const useSession = () => useContext(Ctx);

const SIGNED_OUT: AuthState = {
  provider: "identity",
  initialized: true,
  selfServiceResetEnabled: false,
  capabilities: { manageUsers: false, invites: false, twoFactor: false, changePassword: false, editProfile: false },
  user: null,
} as AuthState;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);

  const refresh = async () => {
    const state = await api.authState().catch(() => SIGNED_OUT);
    // On a project's pages: the person's role there and what it has (the project's part; the rest is the server's).
    if (currentProject() && state.user) {
      const access = await api.projectAccess().catch(() => null);
      if (access) {
        setState({ ...state, server: false, capabilities: access.capabilities, user: { ...state.user, role: access.role as ConsoleRole, member: access.member } });
        return;
      }
    }
    setState(state);
  };

  useEffect(() => { void refresh(); }, []);
  return <Ctx.Provider value={{ state, user: state?.user ?? null, refresh }}>{children}</Ctx.Provider>;
}
