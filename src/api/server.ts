/** The server's own settings (Server settings, for server admins). */
export interface ServerSettings {
  publicUrl: string;
  requireTwoFactorForSettings: boolean;
  /** The longest any project's function may run, in minutes (1–60). */
  functionsMaxMinutes: number;
  /** The identity providers people can sign in to the console with, beside email and password (always there). */
  consoleProviders: ConsoleSignIn[];
  /** With a provider on: passwords only for server admins (the way in when it's down). */
  consolePasswordsOnlyForAdmins: boolean;
}

/** One identity provider for console sign-in. */
export interface ConsoleSignIn {
  /** Its id among the console's providers (names its client secret, and its sign-in address). */
  id: string;
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  scopes: string;
  buttonLabel: string | null;
  roleClaim: string | null;
  adminValues: string[];
  memberValues: string[];
  viewerValues: string[];
  createAccounts: boolean;
  trustProviderTwoStep: boolean;
  /** A Keycloak realm's: console accounts follow its users (its client secret is a server secret). */
  keycloakSync?: import("./appAuth").KeycloakSyncSettings | null;
}

/** A provider being added. */
export const NEW_PROVIDER: ConsoleSignIn = {
  id: "", enabled: true, issuer: null, clientId: null, scopes: "openid profile email", buttonLabel: null, roleClaim: null,
  adminValues: [], memberValues: [], viewerValues: [], createAccounts: true, trustProviderTwoStep: true,
};

/** A provider's client secret's name with the server's secrets. */
export const providerSecretName = (id: string) => `server.consoleSignIn.${id}.clientSecret`;

/** Its Keycloak sync's client secret's name with the server's secrets. */
export const syncSecretName = (id: string) => `server.consoleSignIn.${id}.keycloakSync.clientSecret`;

/** What a provider's sign-in button says. */
export const providerLabel = (p: ConsoleSignIn) => p.buttonLabel?.trim() || "Sign in with your organization";

/** An id for a new provider, from its button or issuer, not taken by another. */
export function newProviderId(p: ConsoleSignIn, taken: string[]): string {
  let host = "";
  try { host = p.issuer ? new URL(p.issuer).hostname.split(".")[0] : ""; } catch { /* not an address yet */ }
  const base = ((p.buttonLabel ?? "").replace(/^sign in with\s+/i, "") || host || "provider")
    .toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "provider";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** What a test sign-in brought back (posted by its window). */
export interface SignInTestResult {
  ok: boolean; error: string | null; email: string | null; name: string | null; subject: string | null;
  roleValues: string[] | null; role: string | null; claims: Record<string, unknown> | null;
}

export interface ServerSettingsPage {
  settings: ServerSettings;
  /** What the deployment set (Winche__…): where the settings start. */
  deployment: ServerSettings;
  source: "deployment" | "console";
  version: { number: number; at: string; by: string | null; reason: string | null } | null;
  secrets: { name: string; about: string; setAt: string | null; setBy: string | null }[];
  /** The addresses to register at an identity provider: where it sends people back, and where it says they signed out. */
  consoleSignIn?: { callbackUrl: string; logoutUrl: string };
}


export interface ServerSettingsVersion { id: number; number: number; at: string; by: string | null; reason: string | null; current: boolean }
