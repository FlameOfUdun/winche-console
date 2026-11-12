/** The app's users (Winche Auth), for the Authentication tab. */
export interface AppUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoUrl: string | null;
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
  /** Keycloak: the user's groups and username. */
  groups?: string[] | null;
  username?: string | null;
}

export interface DirectoryCapabilities {
  create: boolean; claims: boolean; claimsLabel: string; sessions: boolean; unlock: boolean; resetMfa: boolean; unlinkProviders: boolean;
  passwordReset: boolean; verify: boolean; delete: boolean; disable: boolean; groups: boolean;
}

export interface UserDirectorySettings {
  kind: "auto" | "wincheAuth" | "keycloak" | "none";
  keycloak: { serverUrl: string; realm: string; clientId: string; signInEvents: boolean } | null;
}

export interface DirectoryResponse {
  settings: UserDirectorySettings;
  source: "code" | "console";
  version: SettingsVersionInfo | null;
  editable: boolean;
  whyReadOnly: string | null;
  effectiveKind: "wincheAuth" | "keycloak" | "none";
  wincheAuthInstalled: boolean;
  secret: { setAt: string; setBy: string | null } | null;
  secretsAvailable: boolean;
}

export interface SignInProviderSettings {
  name: string; kind: "google" | "apple" | "oidc"; displayName: string | null; authority: string | null; audiences: string[];
  useSubjectAsUid: boolean; copiedClaims: string[];
}

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
  };
}

export type SignInSettingsResponse =
  | { available: false; whyReadOnly: string }
  | {
      available: true; settings: WincheAuthSettings; codeDefault: WincheAuthSettings; source: "code" | "console"; version: SettingsVersionInfo | null;
      editable: boolean; whyReadOnly: string | null; smtpPassword: { setAt: string; setBy: string | null } | null; secretsAvailable: boolean; appSender: boolean;
    };

export interface DirectoryTestResult {
  connected: boolean; error: string | null; users: number | null; permissions: { role: string; granted: boolean; for: string }[];
}

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
  /** Where the Users tab's users live, and what it can do there; null when there's no directory. */
  /** The app checks tokens with AddWincheTokens (identity providers and token mapping can be set). */
  trustedProviders?: boolean;
  /** Winche Auth's settings can be changed in Settings (o.UseSettings()). */
  signInSettings?: boolean;
  directory?: { kind: "wincheAuth" | "keycloak"; label: string; capabilities: DirectoryCapabilities } | null;
  emailPassword: { minLength: number; requireVerifiedEmail: boolean } | null;
  email: { appName: string; actionUrl: string; sendVerificationOnSignUp: boolean; maxPerAddressPerHour: number; logLinksOnly: boolean; sender: string | null } | null;
  emailLink: { linkUrl: string } | null;
  mfa?: { issuer: string; recoveryCodes: number; pendingMinutes: number } | null;
  identityProviders: {
    name: string; kind: "google" | "apple" | "oidc"; displayName: string; authority: string; audiences: string[];
    useSubjectAsUid: boolean; copiedClaims: string[]; testingOnly: boolean;
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
  kind: "verifyEmail" | "resetPassword" | "signIn" | "emailChanged";
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

export const PLACEHOLDERS = ["%LINK%", "%EMAIL%", "%APP_NAME%", "%DISPLAY_NAME%", "%NEW_EMAIL%"];

/** The template with sample values, as the reader would see it (the link is shown as a button by the preview). */
export function fillTemplate(text: string, appName: string, kind: string): string {
  return text
    .replace(/%APP_NAME%/g, appName)
    .replace(/%EMAIL%/g, "anna.k@example.com")
    .replace(/%NEW_EMAIL%/g, kind === "emailChanged" ? "anna.new@example.com" : "")
    .replace(/%DISPLAY_NAME%/g, "Anna")
    .replace(/ ,/g, ",");
}

/** "google" → "Google", from the configured providers; built-in methods by name. */
export function providerLabel(name: string, config?: AppAuthConfig | null): string {
  const builtIn: Record<string, string> = { password: "Password", anonymous: "Anonymous", google: "Google", apple: "Apple" };
  return config?.identityProviders.find((p) => p.name === name)?.displayName ?? builtIn[name] ?? name;
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
    const list: string[] = body?.error?.errors ?? [];
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
