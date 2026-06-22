import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { AuthState, SessionUser } from "../api/types";

interface SessionCtx {
  state: AuthState | null;
  user: SessionUser | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>({ state: null, user: null, refresh: async () => {} });
export const SessionContext = Ctx;
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const refresh = async () => {
    setState(await api.authState().catch(() => ({ initialized: true, selfServiceResetEnabled: false, user: null })));
  };
  useEffect(() => { void refresh(); }, []);
  return <Ctx.Provider value={{ state, user: state?.user ?? null, refresh }}>{children}</Ctx.Provider>;
}
