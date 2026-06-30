import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

let mgr: UserManager | null = null;
let authority: string | null = null;
let clientId: string | null = null;

/** Initialize the OIDC client from the discovery response. Idempotent. */
export function initKeycloak(cfg: { authority: string; clientId: string; scopes: string }): UserManager {
  if (mgr) return mgr;
  authority = cfg.authority;
  clientId = cfg.clientId;
  mgr = new UserManager({
    authority: cfg.authority,
    client_id: cfg.clientId,
    redirect_uri: new URL("auth/callback", document.baseURI).toString(),
    post_logout_redirect_uri: document.baseURI,
    response_type: "code",
    scope: cfg.scopes,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    stateStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
  });
  return mgr;
}

function requireMgr(): UserManager {
  if (!mgr) throw new Error("Keycloak not initialized");
  return mgr;
}

export const keycloakLogin = () => requireMgr().signinRedirect();
export const keycloakLogout = () => requireMgr().signoutRedirect();
export const keycloakCallback = (): Promise<User> => requireMgr().signinRedirectCallback();

/** Current access token, refreshing if the stored user is expired. Null when signed out. */
export async function keycloakAccessToken(): Promise<string | null> {
  const m = requireMgr();
  let user = await m.getUser();
  if (user?.expired) {
    try { user = await m.signinSilent(); } catch { return null; }
  }
  return user?.access_token ?? null;
}

export async function keycloakIsAuthenticated(): Promise<boolean> {
  const user = await requireMgr().getUser();
  return !!user && !user.expired;
}

/**
 * URL of the Keycloak account-management console for the signed-in realm, with a referrer back to the
 * console so Keycloak shows a "Back to Winche Console" link.
 */
export function keycloakAccountUrl(): string {
  const base = (authority ?? "").replace(/\/$/, "");
  const params = new URLSearchParams();
  if (clientId) {
    params.set("referrer", clientId);
    params.set("referrer_uri", document.baseURI);
  }
  const qs = params.toString();
  return `${base}/account${qs ? `?${qs}` : ""}`;
}
