import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setBearerTokenProvider } from "../api/client";
import type { AuthState, SessionUser } from "../api/types";
import { initKeycloak, keycloakAccessToken, keycloakIsAuthenticated } from "./keycloak";

interface SessionCtx {
  state: AuthState | null;
  user: SessionUser | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>({ state: null, user: null, refresh: async () => {} });
export const SessionContext = Ctx;
export const useSession = () => useContext(Ctx);

const SIGNED_OUT: AuthState = {
  provider: "keycloak",
  initialized: true,
  capabilities: { manageUsers: false, invites: false, twoFactor: false, changePassword: false, editProfile: false },
  user: null,
} as AuthState;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);

  const refresh = async () => {
    const cfg = await api.authConfig().catch(() => ({ provider: "identity" as const }));
    if (cfg.provider === "keycloak") {
      initKeycloak(cfg);
      setBearerTokenProvider(keycloakAccessToken);
      if (!(await keycloakIsAuthenticated())) {
        setState(SIGNED_OUT);
        return;
      }
    }
    setState(await api.authState().catch(() =>
      cfg.provider === "keycloak"
        ? SIGNED_OUT
        : ({ provider: "identity", initialized: true, selfServiceResetEnabled: false, capabilities: SIGNED_OUT.capabilities, user: null } as AuthState)));
  };

  useEffect(() => { void refresh(); }, []);
  return <Ctx.Provider value={{ state, user: state?.user ?? null, refresh }}>{children}</Ctx.Provider>;
}
