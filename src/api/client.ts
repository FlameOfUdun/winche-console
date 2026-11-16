import type { AuthState, BrowseResult, ConsoleInvite, ConsoleRole, ConsoleUserItem, FileRecord, InvitePreview, QueryResult, WincheDocument } from "./types";
import type { ParseRulesTextResult, RuleOperation, RuleSubsystem, RuleSubsystemStatus, RuleValidationResult, RuleVersionDetail, RuleVersionSummary, SimulateResult } from "./rules";
import type { Hook, HookDelivery, HooksPageData, HookTestResult } from "./hooks";
import type { ConsolePageEntry, FunctionsPageData, FunctionRun, FunctionSecret, FunctionVersion } from "./functions";
import { secretBody, type SecretSources, type SecretTest } from "./secrets";

/** The typed secrets that are values (or references), by name; undefined when there are none. */
const pick = (typed: Record<string, string> | undefined, kind: "value" | "reference") => {
  const found = Object.entries(typed ?? {}).flatMap(([k, v]) => { const b = secretBody(v)[kind]; return b ? [[k, b] as const] : []; });
  return found.length ? Object.fromEntries(found) : undefined;
};
import type { AppsPageData, AppFields, RegisteredAppsData } from "./apps";
import type { ArchiveLocation, AreaSettings, DataArea, IndexSuggestion, LocationTest, StorageLocationState } from "./dataSettings";
import type { SignInSettingsResponse, WincheAuthSettings } from "./appAuth";
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


async function http<T>(method: string, rel: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Winche-Console": "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
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
  const res = await fetch(apiUrl(rel), { method, headers, body, credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  return res;
}

/**
 * Authentication's calls, against one Winche Auth: a project's app users (api/app-auth) or the console's own accounts
 * (api/server/auth, Server settings → Authentication). Same pages, same calls.
 */
export function authApi(base: string) {
  return {
    appUsers: (search: string, offset = 0, limit = 50) =>
      http<{ users: AppUser[]; total: number }>("GET", `${base}/users?${new URLSearchParams({ search, offset: String(offset), limit: String(limit) })}`),
    appUser: (uid: string) => http<{ user: AppUser; sessions: AppSession[]; mfa?: { recoveryCodesLeft: number } | null }>("GET", `${base}/users/${encodeURIComponent(uid)}`),
    createAppUser: (body: { email?: string; password?: string; displayName?: string }) => http<AppUser>("POST", `${base}/users`, body),
    setAppUserDisabled: (uid: string, disabled: boolean) => http<AppUser>("POST", `${base}/users/${encodeURIComponent(uid)}/disabled`, { disabled }),
    setAppUserClaims: (uid: string, claims: Record<string, unknown> | null) => http<AppUser>("PUT", `${base}/users/${encodeURIComponent(uid)}/claims`, { claims }),
    signOutAppUser: (uid: string) => http<{ sessions: number }>("POST", `${base}/users/${encodeURIComponent(uid)}/signOut`),
    revokeAppSession: (uid: string, id: string) => http<void>("DELETE", `${base}/users/${encodeURIComponent(uid)}/sessions/${id}`),
    unlinkAppUserProvider: (uid: string, provider: string) =>
      http<AppUser>("DELETE", `${base}/users/${encodeURIComponent(uid)}/providers/${encodeURIComponent(provider)}`),
    resetAppUserMfa: (uid: string) => http<AppUser>("DELETE", `${base}/users/${encodeURIComponent(uid)}/mfa`),
    unlockAppUser: (uid: string) => http<AppUser>("POST", `${base}/users/${encodeURIComponent(uid)}/unlock`),
    deleteAppUser: (uid: string) => http<void>("DELETE", `${base}/users/${encodeURIComponent(uid)}`),
    sendAppUserPasswordReset: (uid: string) => http<void>("POST", `${base}/users/${encodeURIComponent(uid)}/sendPasswordReset`),
    sendAppUserVerification: (uid: string) => http<void>("POST", `${base}/users/${encodeURIComponent(uid)}/sendVerification`),
    setAppUserVerified: (uid: string, verified: boolean) => http<AppUser>("POST", `${base}/users/${encodeURIComponent(uid)}/verified`, { verified }),
    appEmailTemplates: () => http<{ templates: EmailTemplateInfo[] }>("GET", `${base}/email-templates`),
    saveAppEmailTemplate: (kind: string, subject: string, body: string) => http<void>("PUT", `${base}/email-templates/${kind}`, { subject, body }),
    resetAppEmailTemplate: (kind: string) => http<void>("DELETE", `${base}/email-templates/${kind}`),
    testAppEmailTemplate: (kind: string) => http<{ sentTo: string }>("POST", `${base}/email-templates/${kind}/test`),
    authProviders: () => http<ProvidersResponse>("GET", `${base}/settings/providers`),
    saveAuthProviders: (settings: ProvidersSettings, reason: string, basedOn?: number) => http<SettingsVersionInfo>("PUT", `${base}/settings/providers`, { settings, reason, basedOn }),
    checkAuthProvider: (issuer: string, authority: string | null, requireHttps: boolean) =>
      http<ProviderCheckResult>("POST", `${base}/settings/providers/check`, { issuer, authority, requireHttps }),
    testAuthToken: (token: string, settings?: ProvidersSettings) => http<TokenTestResult>("POST", `${base}/settings/providers/test`, { token, settings }),
    settingsHistory: (area?: string) =>
      http<{ versions: SettingsVersionInfo[]; editable?: boolean }>("GET", `${base}/settings/history${area ? `?area=${encodeURIComponent(area)}` : ""}`),
    restoreSettings: (id: number, reason: string) => http<SettingsVersionInfo>("POST", `${base}/settings/history/${id}/restore`, { reason }),
    resetSettings: (area: string, reason: string) => http<SettingsVersionInfo>("POST", `${base}/settings/${encodeURIComponent(area)}/reset`, { reason }),
    signInSettings: () => http<SignInSettingsResponse>("GET", `${base}/settings/signin`),
    saveSignInSettings: (settings: WincheAuthSettings, smtpPassword: string | null, reason: string, syncSecrets?: Record<string, string>, basedOn?: number) =>
      http<SettingsVersionInfo>("PUT", `${base}/settings/signin`, {
        settings, reason, basedOn,
        // Each secret typed is a value or a reference (aws-ssm:…): they go in their own fields.
        smtpPassword: secretBody(smtpPassword).value ?? null, smtpPasswordReference: secretBody(smtpPassword).reference ?? null,
        syncSecrets: pick(syncSecrets, "value"), syncSecretReferences: pick(syncSecrets, "reference"),
      }),
    testSignInEmail: (settings: WincheAuthSettings, smtpPassword: string | null, to: string | null) =>
      http<{ sentTo: string }>("POST", `${base}/settings/signin/testEmail`, { settings, smtpPassword: secretBody(smtpPassword).value ?? null, to }),
    appAuthConfig: () => http<AppAuthConfig>("GET", `${base}/config`),
    rotateAppAuthKeys: () => http<void>("POST", `${base}/keys/rotate`),
    keycloakSyncs: () => http<{ syncs: import("./appAuth").KeycloakSync[] }>("GET", `${base}/providers/sync`),
    syncKeycloakNow: (provider: string) => http<void>("POST", `${base}/providers/${encodeURIComponent(provider)}/sync`),
  };
}
export type AuthApi = ReturnType<typeof authApi>;

/** The console's accounts (Server settings → Authentication). */
export const serverAuthApi = authApi("api/server/auth");

export const api = {
  overview: () => http<import("./overview").Overview>("GET", "api/overview"),
  project: () => http<import("./project").ProjectState>("GET", "api/project"),
  createProject: (body: { name: string; id: string; products: string[]; database?: import("./dataLocation").DataMoveTarget | null }) => http<import("./project").ProjectState>("POST", "api/project", body),
  /** The projects on this server (Winche Server); `available` false where the console runs one project only. */
  projects: () => http<import("./project").ServerProjects>("GET", "api/projects"),
  archiveProject: (id: string) => http<void>("POST", `api/projects/${encodeURIComponent(id)}/archive`),
  restoreProject: (id: string) => http<void>("POST", `api/projects/${encodeURIComponent(id)}/restore`),
  deleteProject: (id: string) => http<void>("DELETE", `api/projects/${encodeURIComponent(id)}`),
  /** A new project; <database>: where its data goes (none: a database of its own on the server's PostgreSQL). */
  createServerProject: (name: string, id: string, database?: import("./dataLocation").DataMoveTarget | null) =>
    http<{ id: string; name: string; consoleUrl: string }>("POST", "api/projects", { name, id, database: database ?? null }),
  checkProjectDatabase: (id: string, database: import("./dataLocation").DataMoveTarget | null) =>
    http<import("./dataLocation").DataMoveCheck>("POST", "api/projects/check-database", { id, database }),
  /** The project's thumbnail, as a blob (fetched with the session's token, which an <img> can't send). */
  /** A project's thumbnail: this console's, or another project's at its [consoleUrl]. */
  projectImage: async (version: string, consoleUrl?: string) =>
    (await raw("GET", `${consoleUrl ? `${consoleUrl}/` : ""}api/project/image?v=${encodeURIComponent(version)}`)).blob(),
  setProjectImage: async (image: Blob) => (await raw("PUT", "api/project/image", image)).json() as Promise<{ imageVersion: string }>,
  removeProjectImage: () => http<void>("DELETE", "api/project/image"),
  renameProject: (name: string, id: string) => http<import("./project").ProjectState>("PUT", "api/project", { name, id }),
  members: () => http<import("./members").MembersData>("GET", "api/members"),
  addMember: (email: string, role: import("./types").ConsoleRole) =>
    http<{ userId: string; newAccount: boolean; emailed: boolean; link: string | null }>("POST", "api/members", { email, role }),
  setMemberRole: (userId: string, role: import("./types").ConsoleRole) => http<void>("PUT", `api/members/${encodeURIComponent(userId)}`, { role }),
  removeMember: (userId: string) => http<void>("DELETE", `api/members/${encodeURIComponent(userId)}`),
  serverSettings: () => http<import("./server").ServerSettingsPage>("GET", "api/server/settings"),
  /** basedOn: the version the change was made from; someone else's save since makes it fail (409) instead of being undone. */
  saveServerSettings: (settings: import("./server").ServerSettings, reason: string, basedOn?: number) => http<unknown>("PUT", "api/server/settings", { settings, reason, basedOn }),
  serverSettingsHistory: () => http<{ versions: import("./server").ServerSettingsVersion[] }>("GET", "api/server/settings/history"),
  sendServerTestEmail: (to: string) => http<{ sentTo: string }>("POST", "api/server/console-email/test", { to }),
  testConsoleSignIn: (settings: import("./server").ConsoleSignIn, clientSecret: string | null) =>
    http<{ url: string; callbackUrl: string }>("POST", "api/server/console-sign-in/test", { settings, clientSecret: secretBody(clientSecret).value ?? null }),
  dataLocation: () => http<import("./dataLocation").DataLocationInfo>("GET", "api/data-location"),
  checkDataTarget: (t: import("./dataLocation").DataMoveTarget) => http<import("./dataLocation").DataMoveCheck>("POST", "api/data-location/check", t),
  moveData: (t: import("./dataLocation").DataMoveTarget) => http<void>("POST", "api/data-location/move", t),
  finishDataMove: (deleteOld: boolean) => http<void>("POST", "api/data-location/finish", { deleteOld }),
  setDataPool: (maxConnections: number | null, commandTimeoutSeconds: number | null) =>
    http<void>("PUT", "api/data-location/pool", { maxConnections, commandTimeoutSeconds }),
  setServerSecret: (name: string, value: string | null) => http<void>("PUT", `api/server/secrets/${encodeURIComponent(name)}`, value ? secretBody(value) : { value: null }),
  startProduct: (product: string) => http<import("./project").ProductSetupRun>("POST", `api/project/products/${encodeURIComponent(product)}/start`),
  productSetup: (product: string) => http<import("./project").ProductSetupRun>("GET", `api/project/products/${encodeURIComponent(product)}/setup`),
  authState: () => http<AuthState>("GET", "api/auth/state"),
  authConfig: () => http<import("./types").AuthConfig>("GET", "api/auth/config"),
  setup: (body: { email: string; firstName?: string; lastName?: string; password: string; setupCode?: string | null }) =>
    http<{ email: string }>("POST", "api/auth/setup", body),
  /** First run: checks the setup code from the server's log. */
  checkSetupCode: (setupCode: string) => http<void>("POST", "api/auth/setup/code", { setupCode }),
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
  resetPassword: (code: string, newPassword: string) =>
    http<void>("POST", "api/auth/reset-password", { code, newPassword }),
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
    http<ConsoleInvite & { link: string; emailed?: boolean }>("POST", "api/invites", body),
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
  dataSettings: <T,>(area: DataArea) => http<AreaSettings<T>>("GET", `api/settings/${area}`),
  saveDataSettings: <T,>(area: DataArea, settings: T, reason: string, basedOn?: number) =>
    http<SettingsVersionInfo>("PUT", `api/settings/${area}`, { settings, reason, basedOn }),
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
  setBrowserOrigins: (origins: string[], reason: string) => http<{ browserOrigins: string[] }>("PUT", "api/apps/browser-origins", { origins, reason }),
  functions: () => http<FunctionsPageData>("GET", "api/functions"),
  functionVersions: () => http<{ versions: FunctionVersion[] }>("GET", "api/functions/versions"),
  rollBackFunctions: (v: number, note: string | null) => http<FunctionVersion>("POST", `api/functions/versions/${v}/rollback`, { note }),
  runFunction: (name: string, data: unknown, asUid: string | null) => http<FunctionRun>("POST", "api/functions/run", { name, data, asUid }),
  consolePages: () => http<{ pages: ConsolePageEntry[] }>("GET", "api/console-pages"),
  openConsolePage: (name: string) => http<{ url: string; user: { email: string | null; role: "viewer" | "member" | "admin" } }>("POST", `api/console-pages/${encodeURIComponent(name)}/open`),
  runConsoleAction: (name: string, data: unknown) => http<{ data: unknown }>("POST", `api/console-pages/actions/${encodeURIComponent(name)}`, { data: data ?? null }),
  functionSecrets: () => http<{ available: boolean; secrets: FunctionSecret[] }>("GET", "api/functions/secrets"),
  setFunctionSecret: (name: string, value: string) => http<void>("PUT", `api/functions/secrets/${encodeURIComponent(name)}`, secretBody(value)),
  testFunctionSecret: (name: string) => http<SecretTest>("POST", `api/functions/secrets/${encodeURIComponent(name)}/test`),
  secretSources: () => http<SecretSources>("GET", "api/secrets/sources"),
  testSecretReference: (reference: string) => http<SecretTest>("POST", "api/secrets/test", { reference }),
  setSourceKey: (name: string, values: Record<string, string>) => http<void>("PUT", `api/secrets/keys/${encodeURIComponent(name)}`, { values }),
  removeSourceKey: (name: string) => http<void>("DELETE", `api/secrets/keys/${encodeURIComponent(name)}`),
  removeFunctionSecret: (name: string) => http<void>("DELETE", `api/functions/secrets/${encodeURIComponent(name)}`),
  hooks: () => http<HooksPageData>("GET", "api/hooks"),
  saveHooks: (hooks: Hook[], reason: string, basedOn?: number) => http<SettingsVersionInfo>("PUT", "api/hooks", { settings: { hooks }, reason, basedOn }),
  testHook: (hook: Hook) => http<HookTestResult>("POST", "api/hooks/test", { hook }),
  hookSecret: (id: string) => http<{ secret: string }>("GET", `api/hooks/${encodeURIComponent(id)}/secret`),
  rotateHookSecret: (id: string) => http<{ secret: string }>("POST", `api/hooks/${encodeURIComponent(id)}/secret/rotate`),
  hookDeliveries: (hookId?: string, status?: string) =>
    http<{ deliveries: HookDelivery[] }>("GET", `api/hooks/deliveries?${new URLSearchParams({ ...(hookId ? { hookId } : {}), ...(status ? { status } : {}) })}`),
  retryHookDelivery: (id: string) => http<void>("POST", `api/hooks/deliveries/${id}/retry`),
  assets: () => http<import("./assets").AssetsPageData>("GET", "api/assets"),
  assetReleases: (limit = 100) => http<{ releases: import("./assets").AssetReleaseSummary[] }>("GET", `api/assets/releases?limit=${limit}`),
  assetRelease: (n: number) => http<import("./assets").AssetRelease>("GET", `api/assets/releases/${n}`),
  assetDiff: (from: number, to: number) => http<import("./assets").AssetDiff>("GET", `api/assets/releases/${from}/diff/${to}`),
  assetChannelHistory: (name: string) => http<{ moves: import("./assets").AssetChannelMove[] }>("GET", `api/assets/channels/${encodeURIComponent(name)}/history`),
  moveAssetChannel: (name: string, release: number) => http<import("./assets").AssetChannel>("POST", `api/assets/channels/${encodeURIComponent(name)}`, { release }),
  removeAssetChannel: (name: string) => http<void>("DELETE", `api/assets/channels/${encodeURIComponent(name)}`),
  assetLocation: () => http<import("./assets").AssetLocationState>("GET", "api/assets/location"),
  testAssetLocation: (location: ArchiveLocation, secretKey: string | null) => http<LocationTest>("POST", "api/assets/location/test", { location, secretKey }),
  startAssetMove: (location: ArchiveLocation, secretKey: string | null, reason: string) =>
    http<void>("POST", "api/assets/location/move", { location, secretKey, reason }),
  cancelAssetMove: () => http<void>("POST", "api/assets/location/move/cancel"),
  storageLocation: () => http<StorageLocationState>("GET", "api/settings/storage/location"),
  testStorageLocation: (location: ArchiveLocation, secretKey: string | null) =>
    http<LocationTest>("POST", "api/settings/storage/location/test", { location, secretKey }),
  startStorageMove: (location: ArchiveLocation, secretKey: string | null, reason: string) =>
    http<unknown>("POST", "api/settings/storage/location/move", { location, secretKey, reason }),
  storageMoveStep: (step: "switch" | "finish" | "cancel", reason: string) =>
    http<void>("POST", `api/settings/storage/location/move/${step}`, { reason }),
  parseIndexText: (text: string) => http<import("./indexText").IndexTextParse>("POST", "api/settings/database/indexes/parse", { text }),
  indexSuggestions: () => http<{ suggestions: IndexSuggestion[] }>("GET", "api/settings/database/suggestions"),
  consoleTokens: () => http<import("./tokens").TokensResponse>("GET", "api/tokens"),
  createCiToken: (name: string, scopes: string[], days: number) =>
    http<{ token: import("./tokens").ConsoleToken; secret: string }>("POST", "api/tokens", { name, scopes, days }),
  revokeConsoleToken: (id: string) => http<void>("DELETE", `api/tokens/${encodeURIComponent(id)}`),
  approveCliLogin: (body: { challenge: string; port: number; state: string; name: string }) =>
    http<{ redirect: string }>("POST", "api/cli-login/approve", body),
  cliDevice: (userCode: string) => http<{ name: string; userCode: string }>("GET", `api/cli-login/device/${encodeURIComponent(userCode)}`),
  approveCliDevice: (userCode: string) => http<{ approved: boolean }>("POST", "api/cli-login/approve", { userCode, port: 0 }),
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

  ...authApi("api/app-auth"),
};
