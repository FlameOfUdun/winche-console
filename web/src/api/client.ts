import type { AuthState, BrowseResult, ConsoleInvite, ConsoleRole, ConsoleUserItem, FileRecord, InvitePreview, QueryResult, WincheDocument } from "./types";
import type { ParseRulesTextResult, RuleOperation, RuleSubsystem, RuleSubsystemStatus, RuleValidationResult, RuleVersionDetail, RuleVersionSummary, SimulateResult } from "./rules";
import type { TabNav, TabLayout, TabDataResponse } from "./tabs";
import type { FeedDeadLetter, FeedInfo, Hook, HookDelivery, HooksPageData, HookTestResult } from "./hooks";
import type { FunctionsPageData, FunctionRun, FunctionVersion } from "./functions";
import type { AppsPageData, AppFields, RegisteredAppsData } from "./apps";
import type { ArchiveLocation, AreaSettings, DataArea, IndexSuggestion, LocationTest, StorageLocationState } from "./dataSettings";
import type { DirectoryResponse, DirectoryTestResult, SignInSettingsResponse, UserDirectorySettings, WincheAuthSettings } from "./appAuth";
import type { AppAuthConfig, AppSession, AppUser, EmailTemplateInfo, ProviderCheckResult, ProvidersResponse, ProvidersSettings, SettingsVersionInfo, TokenTestResult } from "./appAuth";
import { historyQuery, type HistoryEntry, type HistoryFilter } from "./history";
import { logQuery, type Histogram, type LogFilter, type LogLevel, type LogLevelOverride, type LogLevels, type LogPage, type LogScope, type SavedQuery, type SavedQuerySpec } from "./logs";

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
  const headers: Record<string, string> = { "X-Winche-Console": "1" };
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

/** A request whose body or answer isn't JSON (images): same headers and errors as http(). */
async function raw(method: string, rel: string, body?: Blob): Promise<Response> {
  const headers: Record<string, string> = { "X-Winche-Console": "1" };
  if (body) headers["Content-Type"] = body.type || "application/octet-stream";
  if (bearerTokenProvider) {
    const token = await bearerTokenProvider();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(apiUrl(rel), { method, headers, body, credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  return res;
}

export const api = {
  overview: () => http<import("./overview").Overview>("GET", "api/overview"),
  project: () => http<import("./project").ProjectState>("GET", "api/project"),
  createProject: (body: { name: string; id: string; products: string[] }) => http<import("./project").ProjectState>("POST", "api/project", body),
  /** The projects on this server (Winche Server); `available` false where the console runs one project only. */
  projects: () => http<import("./project").ServerProjects>("GET", "api/projects"),
  createServerProject: (name: string, id: string) => http<{ id: string; name: string; consoleUrl: string }>("POST", "api/projects", { name, id }),
  /** The project's thumbnail, as a blob (fetched with the session's token, which an <img> can't send). */
  /** A project's thumbnail: this console's, or another project's at its [consoleUrl]. */
  projectImage: async (version: string, consoleUrl?: string) =>
    (await raw("GET", `${consoleUrl ? `${consoleUrl}/` : ""}api/project/image?v=${encodeURIComponent(version)}`)).blob(),
  setProjectImage: async (image: Blob) => (await raw("PUT", "api/project/image", image)).json() as Promise<{ imageVersion: string }>,
  removeProjectImage: () => http<void>("DELETE", "api/project/image"),
  renameProject: (name: string, id: string) => http<import("./project").ProjectState>("PUT", "api/project", { name, id }),
  startProduct: (product: string) => http<import("./project").ProjectState>("POST", `api/project/products/${encodeURIComponent(product)}/start`),
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
    http<string[]>("GET", `api/database/collections${parent ? `?parent=${encodeURIComponent(parent)}` : ""}`),
  deleteCollection: (collection: string) => http<void>("DELETE", `api/database/collections/${b64Path(collection)}`),
  queryDocuments: (collection: string, limit?: number) =>
    http<QueryResult>("POST", "api/database/query", { collection, limit }),
  getDocument: (path: string) => http<WincheDocument>("GET", `api/database/documents/${b64Path(path)}`),
  putDocument: (path: string, fields: Record<string, unknown>) =>
    http<WincheDocument>("PUT", `api/database/documents/${b64Path(path)}`, { fields }),
  deleteDocument: (path: string) => http<void>("DELETE", `api/database/documents/${b64Path(path)}`),

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

  logs: (scope: LogScope, filter: LogFilter) => http<LogPage>("GET", `api/logs/${scope}${logQuery(filter)}`),
  logCategories: (scope: LogScope) => http<string[]>("GET", `api/logs/${scope}/categories`),
  logHistogram: (scope: LogScope, filter: LogFilter) => http<Histogram>("GET", `api/logs/${scope}/histogram${logQuery(filter)}`),
  logQueries: () => http<{ queries: SavedQuery[] }>("GET", "api/logs/queries"),
  saveLogQuery: (name: string, query: SavedQuerySpec) => http<SavedQuery>("POST", "api/logs/queries", { name, query }),
  deleteLogQuery: (id: string) => http<void>("DELETE", `api/logs/queries/${encodeURIComponent(id)}`),
  appUsers: (search: string, offset = 0, limit = 50) =>
    http<{ users: AppUser[]; total: number }>("GET", `api/app-auth/users?${new URLSearchParams({ search, offset: String(offset), limit: String(limit) })}`),
  appUser: (uid: string) => http<{ user: AppUser; sessions: AppSession[]; mfa?: { recoveryCodesLeft: number } | null }>("GET", `api/app-auth/users/${encodeURIComponent(uid)}`),
  createAppUser: (body: { email?: string; password?: string; displayName?: string }) => http<AppUser>("POST", "api/app-auth/users", body),
  setAppUserDisabled: (uid: string, disabled: boolean) => http<AppUser>("POST", `api/app-auth/users/${encodeURIComponent(uid)}/disabled`, { disabled }),
  setAppUserClaims: (uid: string, claims: Record<string, unknown> | null) => http<AppUser>("PUT", `api/app-auth/users/${encodeURIComponent(uid)}/claims`, { claims }),
  signOutAppUser: (uid: string) => http<{ sessions: number }>("POST", `api/app-auth/users/${encodeURIComponent(uid)}/signOut`),
  revokeAppSession: (uid: string, id: string) => http<void>("DELETE", `api/app-auth/users/${encodeURIComponent(uid)}/sessions/${id}`),
  unlinkAppUserProvider: (uid: string, provider: string) =>
    http<AppUser>("DELETE", `api/app-auth/users/${encodeURIComponent(uid)}/providers/${encodeURIComponent(provider)}`),
  resetAppUserMfa: (uid: string) => http<AppUser>("DELETE", `api/app-auth/users/${encodeURIComponent(uid)}/mfa`),
  unlockAppUser: (uid: string) => http<AppUser>("POST", `api/app-auth/users/${encodeURIComponent(uid)}/unlock`),
  deleteAppUser: (uid: string) => http<void>("DELETE", `api/app-auth/users/${encodeURIComponent(uid)}`),
  sendAppUserPasswordReset: (uid: string) => http<void>("POST", `api/app-auth/users/${encodeURIComponent(uid)}/sendPasswordReset`),
  sendAppUserVerification: (uid: string) => http<void>("POST", `api/app-auth/users/${encodeURIComponent(uid)}/sendVerification`),
  setAppUserVerified: (uid: string, verified: boolean) => http<AppUser>("POST", `api/app-auth/users/${encodeURIComponent(uid)}/verified`, { verified }),
  appEmailTemplates: () => http<{ templates: EmailTemplateInfo[] }>("GET", "api/app-auth/email-templates"),
  saveAppEmailTemplate: (kind: string, subject: string, body: string) => http<void>("PUT", `api/app-auth/email-templates/${kind}`, { subject, body }),
  resetAppEmailTemplate: (kind: string) => http<void>("DELETE", `api/app-auth/email-templates/${kind}`),
  testAppEmailTemplate: (kind: string) => http<{ sentTo: string }>("POST", `api/app-auth/email-templates/${kind}/test`),
  authProviders: () => http<ProvidersResponse>("GET", "api/app-auth/settings/providers"),
  saveAuthProviders: (settings: ProvidersSettings, reason: string) => http<SettingsVersionInfo>("PUT", "api/app-auth/settings/providers", { settings, reason }),
  checkAuthProvider: (issuer: string, authority: string | null, requireHttps: boolean) =>
    http<ProviderCheckResult>("POST", "api/app-auth/settings/providers/check", { issuer, authority, requireHttps }),
  testAuthToken: (token: string, settings?: ProvidersSettings) => http<TokenTestResult>("POST", "api/app-auth/settings/providers/test", { token, settings }),
  dataSettings: <T,>(area: DataArea) => http<AreaSettings<T>>("GET", `api/settings/${area}`),
  saveDataSettings: <T,>(area: DataArea, settings: T, reason: string) =>
    http<SettingsVersionInfo>("PUT", `api/settings/${area}`, { settings, reason }),
  dataSettingsHistory: (area: DataArea) =>
    http<{ versions: SettingsVersionInfo[]; editable?: boolean }>("GET", `api/settings/history?area=${area}`),
  restoreDataSettings: (id: number, reason: string) => http<SettingsVersionInfo>("POST", `api/settings/history/${id}/restore`, { reason }),
  apps: (platforms: string[], app?: string) =>
    http<AppsPageData>("GET", `api/apps?platforms=${encodeURIComponent(platforms.join(","))}${app ? `&app=${encodeURIComponent(app)}` : ""}`),
  registeredApps: () => http<RegisteredAppsData>("GET", "api/apps/registered"),
  registerApp: (app: AppFields) => http<{ id: string }>("POST", "api/apps/registered", app),
  updateApp: (id: string, app: AppFields) => http<{ id: string }>("PUT", `api/apps/registered/${encodeURIComponent(id)}`, app),
  removeApp: (id: string) => http<void>("DELETE", `api/apps/registered/${encodeURIComponent(id)}`),
  setAppsPolicy: (registeredOnly: boolean) => http<{ registeredOnly: boolean }>("PUT", "api/apps/policy", { registeredOnly }),
  functions: () => http<FunctionsPageData>("GET", "api/functions"),
  functionVersions: () => http<{ versions: FunctionVersion[] }>("GET", "api/functions/versions"),
  rollBackFunctions: (v: number, note: string | null) => http<FunctionVersion>("POST", `api/functions/versions/${v}/rollback`, { note }),
  runFunction: (name: string, data: unknown, asUid: string | null) => http<FunctionRun>("POST", "api/functions/run", { name, data, asUid }),
  hooks: () => http<HooksPageData>("GET", "api/hooks"),
  saveHooks: (hooks: Hook[], reason: string) => http<SettingsVersionInfo>("PUT", "api/hooks", { settings: { hooks }, reason }),
  testHook: (hook: Hook) => http<HookTestResult>("POST", "api/hooks/test", { hook }),
  hookSecret: (id: string) => http<{ secret: string }>("GET", `api/hooks/${encodeURIComponent(id)}/secret`),
  rotateHookSecret: (id: string) => http<{ secret: string }>("POST", `api/hooks/${encodeURIComponent(id)}/secret/rotate`),
  hookDeliveries: (hookId?: string, status?: string) =>
    http<{ deliveries: HookDelivery[] }>("GET", `api/hooks/deliveries?${new URLSearchParams({ ...(hookId ? { hookId } : {}), ...(status ? { status } : {}) })}`),
  retryHookDelivery: (id: string) => http<void>("POST", `api/hooks/deliveries/${id}/retry`),
  feeds: () => http<{ feeds: FeedInfo[] }>("GET", "api/feeds"),
  feedDeadLetters: (feed: string, consumer?: string) =>
    http<{ deadLetters: FeedDeadLetter[] }>("GET", `api/feeds/${encodeURIComponent(feed)}/dead-letters${consumer ? `?consumer=${encodeURIComponent(consumer)}` : ""}`),
  retryFeedDeadLetters: (feed: string, consumer: string) =>
    http<{ replayed: number; failed: number }>("POST", `api/feeds/${encodeURIComponent(feed)}/retry`, { consumer }),
  discardFeedDeadLetter: (feed: string, id: number) => http<void>("DELETE", `api/feeds/${encodeURIComponent(feed)}/dead-letters/${id}`),
  storageLocation: () => http<StorageLocationState>("GET", "api/settings/storage/location"),
  testStorageLocation: (location: ArchiveLocation, secretKey: string | null) =>
    http<LocationTest>("POST", "api/settings/storage/location/test", { location, secretKey }),
  startStorageMove: (location: ArchiveLocation, secretKey: string | null, reason: string) =>
    http<unknown>("POST", "api/settings/storage/location/move", { location, secretKey, reason }),
  storageMoveStep: (step: "switch" | "finish" | "cancel", reason: string) =>
    http<void>("POST", `api/settings/storage/location/move/${step}`, { reason }),
  indexSuggestions: () => http<{ suggestions: IndexSuggestion[] }>("GET", "api/settings/database/suggestions"),
  settingsHistory: (area?: string) =>
    http<{ versions: SettingsVersionInfo[]; editable?: boolean }>("GET", `api/app-auth/settings/history${area ? `?area=${encodeURIComponent(area)}` : ""}`),
  restoreSettings: (id: number, reason: string) => http<SettingsVersionInfo>("POST", `api/app-auth/settings/history/${id}/restore`, { reason }),
  resetSettings: (area: string, reason: string) => http<SettingsVersionInfo>("POST", `api/app-auth/settings/${encodeURIComponent(area)}/reset`, { reason }),
  signInSettings: () => http<SignInSettingsResponse>("GET", "api/app-auth/settings/signin"),
  saveSignInSettings: (settings: WincheAuthSettings, smtpPassword: string | null, reason: string) =>
    http<SettingsVersionInfo>("PUT", "api/app-auth/settings/signin", { settings, smtpPassword, reason }),
  testSignInEmail: (settings: WincheAuthSettings, smtpPassword: string | null, to: string | null) =>
    http<{ sentTo: string }>("POST", "api/app-auth/settings/signin/testEmail", { settings, smtpPassword, to }),
  userDirectory: () => http<DirectoryResponse>("GET", "api/app-auth/settings/directory"),
  saveUserDirectory: (settings: UserDirectorySettings, clientSecret: string | null, reason: string) =>
    http<SettingsVersionInfo>("PUT", "api/app-auth/settings/directory", { settings, clientSecret, reason }),
  testUserDirectory: (settings: UserDirectorySettings, clientSecret: string | null) =>
    http<DirectoryTestResult>("POST", "api/app-auth/settings/directory/test", { settings, clientSecret }),
  appAuthConfig: () => http<AppAuthConfig>("GET", "api/app-auth/config"),
  rotateAppAuthKeys: () => http<void>("POST", "api/app-auth/keys/rotate"),
  consoleTokens: () => http<import("./tokens").TokensResponse>("GET", "api/tokens"),
  createCiToken: (name: string, scopes: string[], days: number) =>
    http<{ token: import("./tokens").ConsoleToken; secret: string }>("POST", "api/tokens", { name, scopes, days }),
  revokeConsoleToken: (id: string) => http<void>("DELETE", `api/tokens/${encodeURIComponent(id)}`),
  approveCliLogin: (body: { challenge: string; port: number; state: string; name: string }) =>
    http<{ redirect: string }>("POST", "api/cli-login/approve", body),
  keycloakSyncs: () => http<{ syncs: import("./appAuth").KeycloakSync[] }>("GET", "api/app-auth/providers/sync"),
  syncKeycloakNow: (provider: string) => http<void>("POST", `api/app-auth/providers/${encodeURIComponent(provider)}/sync`),
  history: (filter: HistoryFilter) => http<{ entries: HistoryEntry[] }>("GET", `api/database/history${historyQuery(filter)}`),
  logLevels: () => http<LogLevels>("GET", "api/logs/levels"),
  saveLogLevels: (defaultLevel: LogLevel, overrides: LogLevelOverride[]) =>
    http<{ updatedAt: string; updatedBy: string | null }>("PUT", "api/logs/levels", { defaultLevel, overrides }),
  resetLogLevels: () => http<void>("DELETE", "api/logs/levels"),
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
  rulesParseText: (text: string) => http<ParseRulesTextResult>("POST", "api/rules/text/parse", { text }),
  rulesFormatText: (rulesJson: string) => http<{ text: string }>("POST", "api/rules/text/format", { rulesJson }),
  rulesFields: (sys: RuleSubsystem, pattern: string) =>
    http<{ fields: { path: string; types: string[] }[] }>("GET", `api/rules/${sys}/fields?pattern=${encodeURIComponent(pattern)}`),
  rulesSimulate: (
    sys: RuleSubsystem,
    body: {
      rulesJson: string; operation: RuleOperation; documentPath: string; resourceJson?: string; requestJson?: string; params?: Record<string, string>;
      /** Built by the server as a real call would: who's asking, the document or file now, and what's being written. */
      structured?: boolean; auth?: { uid: string; claims: Record<string, unknown> } | null;
      existing?: Record<string, unknown> | null; incoming?: Record<string, unknown> | null;
    },
  ) => http<SimulateResult>("POST", `api/rules/${sys}/simulate`, body),

  consoleTabs: () => http<{ tabs: TabNav[] }>("GET", "api/tabs"),
  consoleTabLayout: (tabId: string) => http<TabLayout>("GET", `api/tabs/${tabId}`),
  consoleTabData: (tabId: string, widgetIds: string[], filters: Record<string, string>) =>
    http<TabDataResponse>("POST", `api/tabs/${tabId}/data`, { widgetIds, filters }),
  consoleTabCommand: (
    tabId: string, commandId: string,
    body: { rowKey?: string | null; input?: Record<string, unknown> | null; inputs: Record<string, string> },
  ) => http<import("./tabs").CommandOutcome>("POST", `api/tabs/${tabId}/commands/${commandId}`, body),
};
