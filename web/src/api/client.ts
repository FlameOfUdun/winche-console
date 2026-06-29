import type { AuthState, BrowseResult, ConsoleInvite, ConsoleRole, ConsoleUserItem, FileRecord, InvitePreview, QueryResult, UsageStats, WincheDocument } from "./types";

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

async function http<T>(method: string, rel: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(rel), {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  authState: () => http<AuthState>("GET", "api/auth/state"),
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

  usage: () => http<UsageStats>("GET", "api/usage"),

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
};
