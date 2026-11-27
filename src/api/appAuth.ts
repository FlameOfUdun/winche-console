/** The app's users (Winche Auth), for the Authentication tab. */
export interface AppUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoUrl: string | null;
  /** Where photoUrl came from: upload (kept by Winche Auth), link, provider:<name> (refreshed at sign-in), or null. */
  photoSource?: string | null;
  isAnonymous: boolean;
  disabled: boolean;
  /** Two-step sign-in (an authenticator app) is on. */
  mfaEnabled?: boolean;
  /** password, anonymous, … */
  providers: string[];
  customClaims: Record<string, unknown>;
  createdAt: string;
  lastSignInAt: string | null;
  /** Set while locked out after failed sign-ins. */
  lockedOutUntil: string | null;
}

export interface DirectoryCapabilities {
  create: boolean; claims: boolean; claimsLabel: string; sessions: boolean; unlock: boolean; resetMfa: boolean; unlinkProviders: boolean;
  passwordReset: boolean; verify: boolean; delete: boolean; disable: boolean;
  /** Edit the name and photo, the email, the password (absent from older servers: no). */
  profile?: boolean; email?: boolean; password?: boolean; photo?: boolean;
}


export interface SignInProviderSettings {
  name: string; kind: "google" | "apple" | "oidc"; displayName: string | null; authority: string | null; audiences: string[];
  useSubjectAsUid: boolean; copiedClaims: string[];
  /** Keeps its users in step with Keycloak (a Keycloak realm); its client secret is kept apart. */
  keycloakSync?: KeycloakSyncSettings | null;
  /** Every sign-in with it needs a second step: the provider's own, or Winche's code. */
  requireSecondStep?: boolean;
  /** acr values that mean the provider checked a second step (an amr like otp counts anyway). */
  secondStepAcrValues?: string[];
}

export interface KeycloakSyncSettings {
  /** A confidential client whose service account holds view-users and view-events. */
  clientId: string;
  /** Where the server reaches Keycloak, when not at the provider's address. */
  adminServer: string | null;
  pollSeconds: number;
  reconcileHours: number;
  attributes: Record<string, string>;
}

export const NEW_KEYCLOAK_SYNC: KeycloakSyncSettings = { clientId: "", adminServer: null, pollSeconds: 10, reconcileHours: 24, attributes: {} };

export interface SmtpSettings {
  host: string; port: number; security: "startTls" | "tls" | "none"; username: string | null; fromAddress: string; fromName: string | null;
}

/** Winche Auth's settings area auth.signIn. */
export interface WincheAuthSettings {
  emailPassword: { enabled: boolean; minLength: number; requireVerifiedEmail: boolean };
  anonymous: boolean;
  emailLink: { enabled: boolean; linkUrl: string };
  twoStep: { enabled: boolean; issuer: string | null; recoveryCodes: number };
  providers: SignInProviderSettings[];
  sessions: { accessTokenMinutes: number; refreshTokenDays: number };
  lockout: { maxFailedSignIns: number; lockoutMinutes: number };
  email: {
    enabled: boolean; appName: string; actionUrl: string | null; sendVerificationOnSignUp: boolean; maxPerAddressPerHour: number;
    verifyLinkHours: number; resetLinkHours: number; sender: "app" | "smtp" | "logLinks"; smtp: SmtpSettings | null;
    /** Sign-in-link and password-reset emails sent after answering (absent from older servers: on). */
    sendInBackground?: boolean;
  };
}

export type SignInSettingsResponse =
  | { available: false; whyReadOnly: string }
  | {
      available: true; settings: WincheAuthSettings; codeDefault: WincheAuthSettings; source: "code" | "console"; version: SettingsVersionInfo | null;
      editable: boolean; whyReadOnly: string | null; smtpPassword: { setAt: string; setBy: string | null; reference?: string | null } | null; secretsAvailable: boolean; appSender: boolean;
      /** Which providers' Keycloak sync has its client secret set. */
      syncSecrets?: Record<string, { setAt: string; setBy: string | null; reference?: string | null } | null>;
    };

export interface AppSession {
  id: string;
  provider: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface TrustedIssuerInfo {
  name: string;
  issuer: string | null;
  authority: string | null;
  audience: string | null;
  uidClaim: string;
  claims: string[] | null;
}

export interface AppAuthConfig {
  /** Winche Auth is installed (its users, sign-in methods, email): false when the app only trusts other providers. */
  wincheAuth?: boolean;
  /** The app checks tokens with AddWincheTokens (identity providers and token mapping can be set). */
  trustedProviders?: boolean;
  /** Winche Auth's settings can be changed in Settings (o.UseSettings()). */
  signInSettings?: boolean;
  /** Winche Auth's users (the Users tab) and what it can do with them; null without Winche Auth. */
  directory?: { kind: "wincheAuth"; label: string; capabilities: DirectoryCapabilities } | null;
  emailPassword: { minLength: number; requireVerifiedEmail: boolean } | null;
  email: { appName: string; actionUrl: string; sendVerificationOnSignUp: boolean; maxPerAddressPerHour: number; logLinksOnly: boolean; sender: string | null } | null;
  /** The server's own email (its email service, with the credentials of its environment), offered besides SMTP. */
  serverEmail?: string | null;
  emailLink: { linkUrl: string } | null;
  mfa?: { issuer: string; recoveryCodes: number; pendingMinutes: number } | null;
  identityProviders: {
    name: string; kind: "google" | "apple" | "oidc"; displayName: string; authority: string; audiences: string[];
    useSubjectAsUid: boolean; copiedClaims: string[]; testingOnly: boolean;
    requireSecondStep?: boolean; secondStepAcrValues?: string[];
    /** Keycloak sync is on: its users are managed in Keycloak, and Winche follows. */
    keycloakSync?: boolean;
  }[];
  anonymous: boolean;
  trustsWincheTokens: boolean;
  trustedIssuers: TrustedIssuerInfo[];
  tokens: null | { issuer: string; audience: string; accessTokenMinutes: number; refreshTokenDays: number; keyRotationDays: number; keysEncrypted: boolean };
  keys: { kid: string; createdAt: string; retiredAt: string | null }[];
  protection: null | { maxFailedSignIns: number; lockoutMinutes: number };
  hooks: null | { beforeCreate: boolean; afterCreate: boolean; beforeSignIn: boolean };
}

export interface EmailTemplateInfo {
  kind: "verifyEmail" | "resetPassword" | "signIn" | "emailChanged" | "providerLinked";
  name: string;
  subject: string;
  body: string;
  isCustom: boolean;
  defaultSubject: string;
  defaultBody: string;
  linkLifetime: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const PLACEHOLDERS = ["%LINK%", "%EMAIL%", "%APP_NAME%", "%DISPLAY_NAME%", "%NEW_EMAIL%", "%PROVIDER%"];

/** The placeholders an email of <kind> fills: the new address only when it changed, the provider only when one was added. */
export const placeholdersFor = (kind: string) =>
  PLACEHOLDERS.filter((p) => (p !== "%NEW_EMAIL%" || kind === "emailChanged") && (p !== "%PROVIDER%" || kind === "providerLinked"));

/** The template with sample values, as the reader would see it (the link is shown as a button by the preview). */
export function fillTemplate(text: string, appName: string, kind: string): string {
  return text
    .replace(/%APP_NAME%/g, appName)
    .replace(/%EMAIL%/g, "anna.k@example.com")
    .replace(/%NEW_EMAIL%/g, kind === "emailChanged" ? "anna.new@example.com" : "")
    .replace(/%PROVIDER%/g, kind === "providerLinked" ? "Google" : "")
    .replace(/%DISPLAY_NAME%/g, "Anna")
    .replace(/ ,/g, ",");
}

/** "google" → "Google", from the configured providers; built-in methods by name. */
export function providerLabel(name: string, config?: AppAuthConfig | null): string {
  const builtIn: Record<string, string> = { password: "Password", anonymous: "Anonymous", google: "Google", apple: "Apple" };
  return config?.identityProviders.find((p) => p.name === name)?.displayName ?? builtIn[name] ?? name;
}

/** A provider's Keycloak sync (o.…SyncFromKeycloak): its settings and how it's doing. */
export interface KeycloakSync {
  provider: string; displayName: string; clientId: string; server: string;
  pollSeconds: number; reconcileHours: number; claims: string[]; attributes: Record<string, string>;
  /** Where a Keycloak webhook plugin posts, when a webhook secret is set. */
  webhookUrl: string | null;
  lastRunAt: string | null; eventsAfter: string | null; reconciledAt: string | null; lastChangeAt: string | null; lastError: string | null;
}

/** Failing (its last run failed), behind (no run for 3 polls, at least a minute), not run yet, or running. */
export function syncHealth(s: KeycloakSync, now = Date.now()): "Failing" | "Behind" | "Not run yet" | "Running" {
  if (s.lastError) return "Failing";
  if (!s.lastRunAt) return "Not run yet";
  return now - new Date(s.lastRunAt).getTime() > Math.max(3 * s.pollSeconds, 60) * 1000 ? "Behind" : "Running";
}

export type UserStatus = "Active" | "Disabled" | "Locked out" | "Not verified" | "Guest";

export function statusOf(u: AppUser, now = Date.now()): UserStatus {
  if (u.disabled) return "Disabled";
  if (u.lockedOutUntil && new Date(u.lockedOutUntil).getTime() > now) return "Locked out";
  if (u.isAnonymous) return "Guest";
  if (u.email && !u.emailVerified) return "Not verified";
  return "Active";
}

/** "Couldn't …: <the server's message>" from an ApiError's JSON body, else its text. */
/** The message and, on separate lines, each reason the server listed. */
export function errorWithList(e: unknown): string {
  const text = (e as Error)?.message ?? String(e);
  try {
    const body = JSON.parse(text);
    const list: string[] = body?.error?.details?.errors ?? body?.error?.errors ?? [];
    return [body?.error?.message ?? text, ...list.map((x) => `• ${x}`)].join("\n");
  } catch {
    return text;
  }
}

export function errorMessage(e: unknown): string {
  const text = (e as Error)?.message ?? String(e);
  try {
    const body = JSON.parse(text);
    return body?.error?.message ?? (typeof body?.error === "string" ? body.error : text);
  } catch {
    return text;
  }
}

// ── Settings: trusted identity providers and token mapping ──────────────────────

export interface ClaimMapping { from: string; to: string }

export interface TrustedProvider {
  name: string;
  displayName?: string | null;
  kind: "keycloak" | "auth0" | "entra" | "google" | "oidc" | string;
  issuer: string;
  authority?: string | null;
  audiences: string[];
  validateAudience: boolean;
  uidClaim: string;
  /** null: every field passes to the rules as it is. */
  claims: ClaimMapping[] | null;
  requireHttps: boolean;
}

export interface ProvidersSettings { trustWincheAuth: boolean; providers: TrustedProvider[] }

export interface SettingsVersionInfo {
  id: number; area: string; areaTitle: string; number: number; at: string; by: string | null; reason: string | null;
  restoredFrom: number | null; reset: boolean; current?: boolean;
  /** Integrity apps the restore or reset took away whose web check secret couldn't be deleted where it's kept. */
  secretsLeft?: string[];
}

export interface ProvidersResponse {
  settings: ProvidersSettings;
  codeDefault: ProvidersSettings;
  source: "code" | "console";
  version: SettingsVersionInfo | null;
  editable: boolean;
  whyReadOnly: string | null;
}

export interface ProviderCheckResult { found: boolean; issuer: string | null; keys: number; algorithms: string[]; error: string | null }

export interface TokenTestResult {
  wouldSignIn: boolean;
  provider: string | null;
  checks: { outcome: "ok" | "warning" | "error"; text: string }[];
  auth: { uid: string; token: Record<string, unknown> } | null;
  notPassed: string[];
}

export const PROVIDER_KINDS: { value: string; label: string }[] = [
  { value: "keycloak", label: "Keycloak" }, { value: "auth0", label: "Auth0" }, { value: "entra", label: "Microsoft Entra ID" },
  { value: "google", label: "Google Workspace" }, { value: "oidc", label: "Other OpenID Connect" },
];

export function newProvider(): TrustedProvider {
  return { name: "", displayName: "", kind: "keycloak", issuer: "", authority: null, audiences: [], validateAudience: true, uidClaim: "sub", claims: [], requireHttps: true };
}

/** Problems the server would also refuse, shown before saving. */
export function providerProblems(p: TrustedProvider, others: TrustedProvider[]): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(p.name) || p.name === "winche") problems.push("The short name is lower-case letters, digits, - and _.");
  else if (others.some((o) => o.name === p.name)) problems.push("Another provider has that short name.");
  try {
    const u = new URL(p.issuer);
    if (u.protocol !== "https:" && p.requireHttps) problems.push("The address must use https (or untick \"require https\" for local testing).");
  } catch {
    problems.push("The address must be a full address, like https://auth.example.com/realms/app.");
  }
  if (p.validateAudience && p.audiences.filter((a) => a.trim()).length === 0) problems.push("Give the audience: the app's client id at the provider.");
  return problems;
}
