import type { AuthState, BrowseResult, ConsoleInvite, ConsoleRole, ConsoleUserItem, FileRecord, InvitePreview, QueryResult, WincheDocument } from "./types";
import type { RuleOperation, RuleSubsystem, RuleSubsystemStatus, RuleValidationResult, RuleVersionDetail, RuleVersionSummary, SimulateResult } from "./rules";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Standard base64 of a UTF-8 path, matching the .NET Convert.FromBase64String decode. */
export function b64Path(path: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(path)));
}

// All API URLs resolve relative to <base href> (the console prefix injected by the host).
const apiUrl = (rel: string) => new URL(rel, document.baseURI).toString();

// Set by the session bootstrap when the provider is Keycloak; returns the current access token (or null).
let bearerTokenProvider: (() => Promise<string | null>) | null = null;
export function setBearerTokenProvider(fn: (() => Promise<string | null>) | null) {
  bearerTokenProvider = fn;
}

async function http<T>(method: string, rel: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (bearerTokenProvider) {
    const token = await bearerTokenProvider();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(apiUrl(rel), {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  authState: () => http<AuthState>("GET", "api/auth/state"),
  authConfig: () => http<import("./types").AuthConfig>("GET", "api/auth/config"),
  setup: (body: { email: string; firstName?: string; lastName?: string; password: string }) =>
    http<{ email: string }>("POST", "api/auth/setup", body),
  login: (email: string, password: string) =>
    http<{ user?: { id: string; email: string; role: string }; requiresTwoFactor?: boolean }>("POST", "api/auth/login", { email, password }),
  loginTwoFactor: (code: string, rememberMachine?: boolean) =>
    http<{ user: { id: string; email: string; role: string } }>("POST", "api/auth/login/2fa", { code, rememberMachine }),
  loginRecovery: (recoveryCode: string) =>
    http<{ user: { id: string; email: string; role: string } }>("POST", "api/auth/login/recovery", { recoveryCode }),
  logout: () => http<void>("POST", "api/auth/logout"),
  twoFactorSetup: () => http<{ sharedKey: string; authenticatorUri: string }>("POST", "api/auth/2fa/setup"),
  twoFactorEnable: (code: string) => http<{ recoveryCodes: string[] }>("POST", "api/auth/2fa/enable", { code }),
  twoFactorDisable: () => http<void>("POST", "api/auth/2fa/disable"),
  forgotPassword: (email: string) => http<void>("POST", "api/auth/forgot-password", { email }),
  resetPassword: (email: string, token: string, newPassword: string) =>
    http<void>("POST", "api/auth/reset-password", { email, token, newPassword }),
  updateProfile: (body: { firstName?: string; lastName?: string }) => http<void>("PUT", "api/auth/profile", body),
  changePassword: (currentPassword: string, newPassword: string) =>
    http<void>("POST", "api/auth/password", { currentPassword, newPassword }),

  listUsers: () => http<ConsoleUserItem[]>("GET", "api/users"),
  createUser: (body: { email: string; firstName?: string; lastName?: string; role: ConsoleRole; password: string }) =>
    http<{ id: string; email: string }>("POST", "api/users", body),
  updateUser: (id: string, body: Partial<{ firstName: string; lastName: string; email: string; role: ConsoleRole; active: boolean; twoFactorRequired: boolean }>) =>
    http<void>("PUT", `api/users/${id}`, body),
  resetUserPassword: (id: string, newPassword: string) =>
    http<void>("POST", `api/users/${id}/reset-password`, { newPassword }),
  unlockUser: (id: string) => http<void>("POST", `api/users/${id}/unlock`),
  deleteUser: (id: string) => http<void>("DELETE", `api/users/${id}`),
  listInvites: () => http<ConsoleInvite[]>("GET", "api/invites"),
  createInvite: (body: { email: string; role: ConsoleRole; firstName?: string; lastName?: string; requireName: boolean; requireTwoFactor: boolean; expiresInHours: number }) =>
    http<ConsoleInvite & { link: string }>("POST", "api/invites", body),
  inviteLink: (id: string) => http<{ link: string }>("GET", `api/invites/${id}/link`),
  resendInvite: (id: string) => http<{ link: string }>("POST", `api/invites/${id}/resend`, {}),
  revokeInvite: (id: string) => http<void>("DELETE", `api/invites/${id}`),
  invitePreview: (token: string) => http<InvitePreview>("GET", `api/invites/accept?token=${encodeURIComponent(token)}`),
  acceptInvite: (body: { token: string; password: string; firstName?: string; lastName?: string }) =>
    http<void>("POST", "api/invites/accept", body),

  listCollections: (parent?: string) =>
    http<string[]>("GET", `api/data/collections${parent ? `?parent=${encodeURIComponent(parent)}` : ""}`),
  deleteCollection: (collection: string) => http<void>("DELETE", `api/data/collections/${b64Path(collection)}`),
  queryDocuments: (collection: string, limit?: number) =>
    http<QueryResult>("POST", "api/data/query", { collection, limit }),
  getDocument: (path: string) => http<WincheDocument>("GET", `api/data/documents/${b64Path(path)}`),
  putDocument: (path: string, fields: Record<string, unknown>) =>
    http<WincheDocument>("PUT", `api/data/documents/${b64Path(path)}`, { fields }),
  deleteDocument: (path: string) => http<void>("DELETE", `api/data/documents/${b64Path(path)}`),

  browseStorage: (path: string) =>
    http<BrowseResult>("GET", `api/storage/browse?path=${encodeURIComponent(path)}`),
  deleteFile: (path: string) => http<void>("DELETE", `api/storage/files/${b64Path(path)}`),
  deleteDirectory: (path: string) => http<void>("DELETE", `api/storage/directories/${b64Path(path)}`),
  uploadUrl: (path: string, mimeType: string, sizeBytes: number, metadata: Record<string, unknown>) =>
    http<{ uploadUrl: string; expiresAt: string }>("POST", "api/storage/upload-url", { path, mimeType, sizeBytes, metadata }),
  confirmUpload: (path: string) => http<FileRecord>("POST", "api/storage/confirm", { path }),
  downloadUrl: (path: string) =>
    http<{ downloadUrl: string; expiresAt: string }>("GET", `api/storage/download-url?path=${encodeURIComponent(path)}`),
  updateFileMetadata: (path: string, metadata: Record<string, unknown>) =>
    http<FileRecord>("POST", "api/storage/metadata", { path, metadata }),

  rulesSubsystems: () => http<RuleSubsystemStatus[]>("GET", "api/rules/subsystems"),
  rulesLive: (sys: RuleSubsystem) => http<{ rulesJson: string }>("GET", `api/rules/${sys}/live`),
  rulesVersions: (sys: RuleSubsystem) => http<RuleVersionSummary[]>("GET", `api/rules/${sys}/versions`),
  rulesVersion: (sys: RuleSubsystem, version: number) => http<RuleVersionDetail>("GET", `api/rules/${sys}/versions/${version}`),
  rulesSave: (sys: RuleSubsystem, body: { rulesJson: string; note?: string; expectedHeadVersion?: number }) =>
    http<RuleVersionDetail>("POST", `api/rules/${sys}`, body),
  rulesRevert: (sys: RuleSubsystem, version: number) => http<RuleVersionDetail>("POST", `api/rules/${sys}/revert/${version}`),
  rulesApplyHead: (sys: RuleSubsystem) => http<{ appliedVersion: number | null }>("POST", `api/rules/${sys}/apply-head`),
  rulesValidate: (sys: RuleSubsystem, rulesJson: string) =>
    http<RuleValidationResult>("POST", `api/rules/${sys}/validate`, { rulesJson }),
  rulesSimulate: (
    sys: RuleSubsystem,
    body: { rulesJson: string; operation: RuleOperation; documentPath: string; resourceJson?: string; requestJson?: string; params?: Record<string, string> },
  ) => http<SimulateResult>("POST", `api/rules/${sys}/simulate`, body),
};
