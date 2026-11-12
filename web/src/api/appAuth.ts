/** The app's users (Winche Auth), for the Authentication tab. */
export interface AppUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoUrl: string | null;
  isAnonymous: boolean;
  disabled: boolean;
  /** password, anonymous, … */
  providers: string[];
  customClaims: Record<string, unknown>;
  createdAt: string;
  lastSignInAt: string | null;
  /** Set while locked out after failed sign-ins. */
  lockedOutUntil: string | null;
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
  emailPassword: { minLength: number; requireVerifiedEmail: boolean } | null;
  email: { appName: string; actionUrl: string; sendVerificationOnSignUp: boolean; maxPerAddressPerHour: number; logLinksOnly: boolean; sender: string | null } | null;
  emailLink: { linkUrl: string } | null;
  anonymous: boolean;
  trustsWincheTokens: boolean;
  trustedIssuers: TrustedIssuerInfo[];
  tokens: { issuer: string; audience: string; accessTokenMinutes: number; refreshTokenDays: number; keyRotationDays: number; keysEncrypted: boolean };
  keys: { kid: string; createdAt: string; retiredAt: string | null }[];
  protection: { maxFailedSignIns: number; lockoutMinutes: number };
  hooks: { beforeCreate: boolean; afterCreate: boolean; beforeSignIn: boolean };
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

export type UserStatus = "Active" | "Disabled" | "Locked out" | "Not verified" | "Guest";

export function statusOf(u: AppUser, now = Date.now()): UserStatus {
  if (u.disabled) return "Disabled";
  if (u.lockedOutUntil && new Date(u.lockedOutUntil).getTime() > now) return "Locked out";
  if (u.isAnonymous) return "Guest";
  if (u.email && !u.emailVerified) return "Not verified";
  return "Active";
}

/** "Couldn't …: <the server's message>" from an ApiError's JSON body, else its text. */
export function errorMessage(e: unknown): string {
  const text = (e as Error)?.message ?? String(e);
  try {
    const body = JSON.parse(text);
    return body?.error?.message ?? (typeof body?.error === "string" ? body.error : text);
  } catch {
    return text;
  }
}
