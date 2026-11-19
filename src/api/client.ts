import type { AuthState, BrowseResult, ConsoleInvite, ConsoleRole, ConsoleUserItem, FileRecord, InvitePreview, QueryResult, WincheDocument } from "./types";
import type { ParseRulesTextResult, RuleOperation, RuleSubsystem, RuleSubsystemStatus, RuleValidationResult, RuleVersionDetail, RuleVersionSummary, SimulateResult } from "./rules";
import type { Hook, HookDelivery, HooksPageData, HookTestResult } from "./hooks";
import type { ConsolePageEntry, FunctionsPageData, FunctionRun, FunctionSecret, FunctionVersion } from "./functions";
import { secretBody, type KeptSecret, type SecretSources, type SecretTest } from "./secrets";
import { apiPath, projectApi } from "./scope";

/** A bucket's secret key as typed: { secretKey } or { secretKeyReference }. */
const keyBody = (typed: string | null) => { const b = secretBody(typed); return { secretKey: b.value ?? null, secretKeyReference: b.reference ?? null }; };

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

// An area's address: the server's at /console/v1/…, the open project's at /console/v1/projects/<id>/… (see scope.ts).
// (A path from the host's root, "/console/v1/…", is used as it is.)
const apiUrl = (rel: string) => new URL(rel.startsWith("/") ? rel : apiPath(rel), window.location.origin).toString();


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
 * Authentication's calls, against one Winche Auth: a project's app users (auth) or the console's own accounts
 * (server/auth, Server settings → Authentication). Same pages, same calls.
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
export const serverAuthApi = authApi("server/auth");

export const api = {
  overview: () => http<import("./overview").Overview>("GET", "overview"),
  project: () => http<import("./project").ProjectState>("GET", "project"),
  createProject: (body: { name: string; id: string; products: string[]; database?: import("./dataLocation").DataMoveTarget | null }) => http<import("./project").ProjectState>("POST", "project", body),
  /** The projects on this server (Winche Server); `available` false where the console runs one project only. */
  projects: () => http<import("./project").ServerProjects>("GET", "projects"),
  archiveProject: (id: string) => http<void>("POST", `projects/${encodeURIComponent(id)}/archive`),
  restoreProject: (id: string) => http<void>("POST", `projects/${encodeURIComponent(id)}/restore`),
  deleteProject: (id: string) => http<void>("DELETE", `projects/${encodeURIComponent(id)}`),
  /** A new project; <database>: where its data goes (none: a database of its own on the server's PostgreSQL). */
  createServerProject: (name: string, id: string, database?: import("./dataLocation").DataMoveTarget | null) =>
    http<{ id: string; name: string; consoleUrl: string }>("POST", "projects", { name, id, database: database ?? null }),
  checkProjectDatabase: (id: string, database: import("./dataLocation").DataMoveTarget | null) =>
    http<import("./dataLocation").DataMoveCheck>("POST", "projects/check-database", { id, database }),
  /** The project's thumbnail, as a blob (fetched with the session's token, which an <img> can't send). */
  /** A project's thumbnail: the open project's, or another's (its console's address, /console/projects/<id>). */
  projectImage: async (version: string, consoleUrl?: string) => {
    const other = consoleUrl ? /\/projects\/([^/]+)/.exec(consoleUrl)?.[1] : undefined;
    const path = other ? `${projectApi(decodeURIComponent(other))}/project/image` : "project/image";
    return (await raw("GET", `${path}?v=${encodeURIComponent(version)}`)).blob();
  },
  setProjectImage: async (image: Blob) => (await raw("PUT", "project/image", image)).json() as Promise<{ imageVersion: string }>,
  removeProjectImage: () => http<void>("DELETE", "project/image"),
  renameProject: (name: string, id: string) => http<import("./project").ProjectState>("PUT", "project", { name, id }),
  members: () => http<import("./members").MembersData>("GET", "members"),
  addMember: (email: string, role: import("./types").ConsoleRole) =>
    http<{ userId: string; newAccount: boolean; emailed: boolean; link: string | null }>("POST", "members", { email, role }),
  setMemberRole: (userId: string, role: import("./types").ConsoleRole) => http<void>("PUT", `members/${encodeURIComponent(userId)}`, { role }),
  removeMember: (userId: string) => http<void>("DELETE", `members/${encodeURIComponent(userId)}`),
  serverSettings: () => http<import("./server").ServerSettingsPage>("GET", "server/settings"),
  /** basedOn: the version the change was made from; someone else's save since makes it fail (409) instead of being undone. */
  saveServerSettings: (settings: import("./server").ServerSettings, reason: string, basedOn?: number) => http<unknown>("PUT", "server/settings", { settings, reason, basedOn }),
  serverSettingsHistory: () => http<{ versions: import("./server").ServerSettingsVersion[] }>("GET", "server/settings/history"),
  sendServerTestEmail: (to: string) => http<{ sentTo: string }>("POST", "server/console-email/test", { to }),
  testConsoleSignIn: (settings: import("./server").ConsoleSignIn, clientSecret: string | null) =>
    http<{ url: string; callbackUrl: string }>("POST", "server/console-sign-in/test", { settings, clientSecret: secretBody(clientSecret).value ?? null }),
  dataLocation: () => http<import("./dataLocation").DataLocationInfo>("GET", "settings/location/database"),
  checkDataTarget: (t: import("./dataLocation").DataMoveTarget) => http<import("./dataLocation").DataMoveCheck>("POST", "settings/location/database/check", t),
  moveData: (t: import("./dataLocation").DataMoveTarget) => http<void>("POST", "settings/location/database/move", t),
  finishDataMove: (deleteOld: boolean) => http<void>("POST", "settings/location/database/finish", { deleteOld }),
  setDataPool: (maxConnections: number | null, commandTimeoutSeconds: number | null) =>
    http<void>("PUT", "settings/location/database/pool", { maxConnections, commandTimeoutSeconds }),
  setServerSecret: (name: string, value: string | null) => http<void>("PUT", `server/secrets/${encodeURIComponent(name)}`, value ? secretBody(value) : { value: null }),
  startProduct: (product: string) => http<import("./project").ProductSetupRun>("POST", `project/products/${encodeURIComponent(product)}/start`),
  productSetup: (product: string) => http<import("./project").ProductSetupRun>("GET", `project/products/${encodeURIComponent(product)}/setup`),
  authState: () => http<AuthState>("GET", "session/state"),
  /** On a project's pages: the signed-in person's role there and what its console has. */
  projectAccess: () => http<{ role: string | null; member: boolean; capabilities: AuthState["capabilities"] }>("GET", "access"),
  authConfig: () => http<import("./types").AuthConfig>("GET", "session/config"),
  setup: (body: { email: string; firstName?: string; lastName?: string; password: string; setupCode?: string | null }) =>
    http<{ email: string }>("POST", "session/setup", body),
  /** First run: checks the setup code from the server's log. */
  checkSetupCode: (setupCode: string) => http<void>("POST", "session/setup/code", { setupCode }),
  login: (email: string, password: string) =>
    http<{ user?: { id: string; email: string; role: string }; requiresTwoFactor?: boolean }>("POST", "session/login", { email, password }),
  loginTwoFactor: (code: string, rememberMachine?: boolean) =>
    http<{ user: { id: string; email: string; role: string } }>("POST", "session/login/2fa", { code, rememberMachine }),
  loginRecovery: (recoveryCode: string) =>
    http<{ user: { id: string; email: string; role: string } }>("POST", "session/login/recovery", { recoveryCode }),
  logout: () => http<void>("POST", "session/logout"),
  twoFactorSetup: () => http<{ sharedKey: string; authenticatorUri: string }>("POST", "session/2fa/setup"),
  twoFactorEnable: (code: string) => http<{ recoveryCodes: string[] }>("POST", "session/2fa/enable", { code }),
  twoFactorDisable: () => http<void>("POST", "session/2fa/disable"),
  forgotPassword: (email: string) => http<void>("POST", "session/forgot-password", { email }),
  resetPassword: (code: string, newPassword: string) =>
    http<void>("POST", "session/reset-password", { code, newPassword }),
  updateProfile: (body: { firstName?: string; lastName?: string }) => http<void>("PUT", "session/profile", body),
  changePassword: (currentPassword: string, newPassword: string) =>
    http<void>("POST", "session/password", { currentPassword, newPassword }),

  listUsers: () => http<ConsoleUserItem[]>("GET", "accounts"),
  createUser: (body: { email: string; firstName?: string; lastName?: string; role: ConsoleRole; password: string }) =>
    http<{ id: string; email: string }>("POST", "accounts", body),
  updateUser: (id: string, body: Partial<{ firstName: string; lastName: string; email: string; role: ConsoleRole; active: boolean; twoFactorRequired: boolean }>) =>
    http<void>("PUT", `accounts/${id}`, body),
  resetUserPassword: (id: string, newPassword: string) =>
    http<void>("POST", `accounts/${id}/reset-password`, { newPassword }),
  unlockUser: (id: string) => http<void>("POST", `accounts/${id}/unlock`),
  deleteUser: (id: string) => http<void>("DELETE", `accounts/${id}`),
  listInvites: () => http<ConsoleInvite[]>("GET", "invites"),
  createInvite: (body: { email: string; role: ConsoleRole; firstName?: string; lastName?: string; requireName: boolean; requireTwoFactor: boolean; expiresInHours: number }) =>
    http<ConsoleInvite & { link: string; emailed?: boolean }>("POST", "invites", body),
  inviteLink: (id: string) => http<{ link: string }>("GET", `invites/${id}/link`),
  resendInvite: (id: string) => http<{ link: string }>("POST", `invites/${id}/resend`, {}),
  revokeInvite: (id: string) => http<void>("DELETE", `invites/${id}`),
  invitePreview: (token: string) => http<InvitePreview>("GET", `invites/accept?token=${encodeURIComponent(token)}`),
  acceptInvite: (body: { token: string; password: string; firstName?: string; lastName?: string }) =>
    http<void>("POST", "invites/accept", body),

  listCollections: (parent?: string) =>
    http<string[]>("GET", `documents/collections${parent ? `?parent=${encodeURIComponent(parent)}` : ""}`),
  deleteCollection: (collection: string) => http<void>("DELETE", `documents/collections/${b64Path(collection)}`),
  queryDocuments: (collection: string, limit?: number) =>
    http<QueryResult>("POST", "documents/query", { collection, limit }),
  getDocument: (path: string) => http<WincheDocument>("GET", `documents/documents/${b64Path(path)}`),
  putDocument: (path: string, fields: Record<string, unknown>) =>
    http<WincheDocument>("PUT", `documents/documents/${b64Path(path)}`, { fields }),
  deleteDocument: (path: string) => http<void>("DELETE", `documents/documents/${b64Path(path)}`),

  browseStorage: (path: string) =>
    http<BrowseResult>("GET", `files/browse?path=${encodeURIComponent(path)}`),
  deleteFile: (path: string) => http<void>("DELETE", `files/files/${b64Path(path)}`),
  deleteDirectory: (path: string) => http<void>("DELETE", `files/directories/${b64Path(path)}`),
  uploadUrl: (path: string, mimeType: string, sizeBytes: number, metadata: Record<string, unknown>) =>
    http<{ uploadUrl: string; expiresAt: string }>("POST", "files/upload-url", { path, mimeType, sizeBytes, metadata }),
  confirmUpload: (path: string) => http<FileRecord>("POST", "files/confirm", { path }),
  downloadUrl: (path: string) =>
    http<{ downloadUrl: string; expiresAt: string }>("GET", `files/download-url?path=${encodeURIComponent(path)}`),
  updateFileMetadata: (path: string, metadata: Record<string, unknown>) =>
    http<FileRecord>("POST", "files/metadata", { path, metadata }),

  logs: (scope: LogScope, filter: LogFilter) => http<LogPage>("GET", `logs/${scope}${logQuery(filter)}`),
  logCategories: (scope: LogScope) => http<string[]>("GET", `logs/${scope}/categories`),
  logHistogram: (scope: LogScope, filter: LogFilter) => http<Histogram>("GET", `logs/${scope}/histogram${logQuery(filter)}`),
  logQueries: () => http<{ queries: SavedQuery[] }>("GET", "logs/queries"),
  saveLogQuery: (name: string, query: SavedQuerySpec) => http<SavedQuery>("POST", "logs/queries", { name, query }),
  deleteLogQuery: (id: string) => http<void>("DELETE", `logs/queries/${encodeURIComponent(id)}`),
  dataSettings: <T,>(area: DataArea) => http<AreaSettings<T>>("GET", `settings/${area}`),
  saveDataSettings: <T,>(area: DataArea, settings: T, reason: string, basedOn?: number) =>
    http<SettingsVersionInfo>("PUT", `settings/${area}`, { settings, reason, basedOn }),
  dataSettingsHistory: (area: DataArea) =>
    http<{ versions: SettingsVersionInfo[]; editable?: boolean }>("GET", `settings/history?area=${area}`),
  restoreDataSettings: (id: number, reason: string) => http<SettingsVersionInfo>("POST", `settings/history/${id}/restore`, { reason }),
  apps: (platforms: string[], app?: string) =>
    http<AppsPageData>("GET", `apps?platforms=${encodeURIComponent(platforms.join(","))}${app ? `&app=${encodeURIComponent(app)}` : ""}`),
  registeredApps: () => http<RegisteredAppsData>("GET", "apps/registered"),
  registerApp: (app: AppFields) => http<{ id: string }>("POST", "apps/registered", app),
  updateApp: (id: string, app: AppFields) => http<{ id: string }>("PUT", `apps/registered/${encodeURIComponent(id)}`, app),
  removeApp: (id: string) => http<void>("DELETE", `apps/registered/${encodeURIComponent(id)}`),
  setAppsPolicy: (registeredOnly: boolean) => http<{ registeredOnly: boolean }>("PUT", "apps/policy", { registeredOnly }),
  setBrowserOrigins: (origins: string[], reason: string) => http<{ browserOrigins: string[] }>("PUT", "apps/browser-origins", { origins, reason }),
  functions: () => http<FunctionsPageData>("GET", "functions"),
  functionVersions: () => http<{ versions: FunctionVersion[] }>("GET", "functions/versions"),
  functionInstances: (name: string) => http<import("./functions").FunctionInstancesData>("GET", `functions/${encodeURIComponent(name)}/instances`),
  rollBackFunctions: (v: number, note: string | null) => http<FunctionVersion>("POST", `functions/versions/${v}/rollback`, { note }),
  runFunction: (name: string, data: unknown, asUid: string | null) => http<FunctionRun>("POST", "functions/run", { name, data, asUid }),
  consolePages: () => http<{ pages: ConsolePageEntry[] }>("GET", "pages"),
  openConsolePage: (name: string) => http<{ url: string; user: { email: string | null; role: "viewer" | "member" | "admin" } }>("POST", `pages/${encodeURIComponent(name)}/open`),
  /** A @winche-technologies/winche-admin call from a console page, as the signed-in person (the page's name goes with it: pages can't call functions). */
  runAdmin: async (page: string, op: string, args: unknown, protocol?: number) => {
    const headers: Record<string, string> = { "X-Winche-Console": "1", "Content-Type": "application/json", "X-Winche-Page": page };
    if (typeof protocol === "number") headers["X-Winche-Protocol"] = String(protocol);   // the page's SDK's (the server checks it)
    const res = await fetch(apiUrl("admin"), {
      method: "POST",
      headers,
      body: JSON.stringify({ op, args }),
      credentials: "same-origin",
    });
    if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
    return (await res.json()) as { result: unknown };
  },
  functionSecrets: () => http<{ available: boolean; secrets: FunctionSecret[] }>("GET", "functions/secrets"),
  setFunctionSecret: (name: string, value: string) => http<void>("PUT", `functions/secrets/${encodeURIComponent(name)}`, secretBody(value)),
  testFunctionSecret: (name: string) => http<SecretTest>("POST", `functions/secrets/${encodeURIComponent(name)}/test`),
  secretSources: () => http<SecretSources>("GET", "secrets/sources"),
  keptSecrets: () => http<{ available: boolean; secrets: KeptSecret[] }>("GET", "secrets"),
  testSecretReference: (reference: string) => http<SecretTest>("POST", "secrets/test", { reference }),
  setSourceKey: (name: string, values: Record<string, string>) => http<void>("PUT", `secrets/keys/${encodeURIComponent(name)}`, { values }),
  removeSourceKey: (name: string) => http<void>("DELETE", `secrets/keys/${encodeURIComponent(name)}`),
  removeFunctionSecret: (name: string) => http<void>("DELETE", `functions/secrets/${encodeURIComponent(name)}`),
  hooks: () => http<HooksPageData>("GET", "hooks"),
  saveHooks: (hooks: Hook[], reason: string, basedOn?: number) => http<SettingsVersionInfo>("PUT", "hooks", { settings: { hooks }, reason, basedOn }),
  testHook: (hook: Hook) => http<HookTestResult>("POST", "hooks/test", { hook }),
  hookSecret: (id: string) => http<{ secret: string }>("GET", `hooks/${encodeURIComponent(id)}/secret`),
  rotateHookSecret: (id: string) => http<{ secret: string }>("POST", `hooks/${encodeURIComponent(id)}/secret/rotate`),
  hookDeliveries: (hookId?: string, status?: string) =>
    http<{ deliveries: HookDelivery[] }>("GET", `hooks/deliveries?${new URLSearchParams({ ...(hookId ? { hookId } : {}), ...(status ? { status } : {}) })}`),
  retryHookDelivery: (id: string) => http<void>("POST", `hooks/deliveries/${id}/retry`),
  assets: () => http<import("./assets").AssetsPageData>("GET", "assets"),
  assetReleases: (limit = 100) => http<{ releases: import("./assets").AssetReleaseSummary[] }>("GET", `assets/releases?limit=${limit}`),
  assetRelease: (n: number) => http<import("./assets").AssetRelease>("GET", `assets/releases/${n}`),
  assetDiff: (from: number, to: number) => http<import("./assets").AssetDiff>("GET", `assets/releases/${from}/diff/${to}`),
  assetChannelHistory: (name: string) => http<{ moves: import("./assets").AssetChannelMove[] }>("GET", `assets/channels/${encodeURIComponent(name)}/history`),
  moveAssetChannel: (name: string, release: number) => http<import("./assets").AssetChannel>("POST", `assets/channels/${encodeURIComponent(name)}`, { release }),
  removeAssetChannel: (name: string) => http<void>("DELETE", `assets/channels/${encodeURIComponent(name)}`),
  assetLocation: () => http<import("./assets").AssetLocationState>("GET", "assets/location"),
  testAssetLocation: (location: ArchiveLocation, secretKey: string | null) => http<LocationTest>("POST", "assets/location/test", { location, ...keyBody(secretKey) }),
  startAssetMove: (location: ArchiveLocation, secretKey: string | null, reason: string) =>
    http<void>("POST", "assets/location/move", { location, ...keyBody(secretKey), reason }),
  cancelAssetMove: () => http<void>("POST", "assets/location/move/cancel"),
  assetCdns: () => http<import("./assets").AssetCdnsState>("GET", "assets/cdns"),
  saveAssetCdn: (id: string, cdn: { baseUrl: string; keyPairId: string; linkMinutes: number }, privateKey: string | null, reason: string) => {
    const b = secretBody(privateKey);
    return http<void>("PUT", `assets/cdns/${encodeURIComponent(id)}`, { ...cdn, privateKey: b.value ?? null, privateKeyReference: b.reference ?? null, reason });
  },
  removeAssetCdn: (id: string, reason: string) => http<void>("DELETE", `assets/cdns/${encodeURIComponent(id)}?reason=${encodeURIComponent(reason)}`),
  testAssetCdn: (id: string, url: string) => http<import("./assets").AssetCdnTest>("POST", `assets/cdns/${encodeURIComponent(id)}/test`, { url }),
  storageLocation: () => http<StorageLocationState>("GET", "settings/location/files"),
  testStorageLocation: (location: ArchiveLocation, secretKey: string | null) =>
    http<LocationTest>("POST", "settings/location/files/test", { location, ...keyBody(secretKey) }),
  startStorageMove: (location: ArchiveLocation, secretKey: string | null, reason: string) =>
    http<unknown>("POST", "settings/location/files/move", { location, ...keyBody(secretKey), reason }),
  storageMoveStep: (step: "switch" | "finish" | "cancel", reason: string) =>
    http<void>("POST", `settings/location/files/move/${step}`, { reason }),
  parseIndexText: (text: string) => http<import("./indexText").IndexTextParse>("POST", "settings/database/indexes/parse", { text }),
  indexSuggestions: () => http<{ suggestions: IndexSuggestion[] }>("GET", "settings/database/suggestions"),
  serviceAccounts: () => http<import("./serviceAccounts").ServiceAccountsResponse>("GET", "service-accounts"),
  createServiceAccount: (name: string, role: string | null, scopes: string[]) =>
    http<{ id: string; name: string }>("POST", "service-accounts", { name, role, scopes }),
  updateServiceAccount: (id: string, role: string | null, scopes: string[], disabled: boolean) =>
    http<void>("PUT", `service-accounts/${encodeURIComponent(id)}`, { role, scopes, disabled }),
  deleteServiceAccount: (id: string) => http<void>("DELETE", `service-accounts/${encodeURIComponent(id)}`),
  addServiceAccountKey: (id: string, days: number) =>
    http<{ key: { id: string; createdAt: string; expiresAt: string }; secret: string }>("POST", `service-accounts/${encodeURIComponent(id)}/keys`, { days }),
  revokeServiceAccountKey: (id: string, keyId: string) =>
    http<void>("DELETE", `service-accounts/${encodeURIComponent(id)}/keys/${encodeURIComponent(keyId)}`),
  trustIdentity: (id: string, issuer: string, subject: string, audience: string) =>
    http<{ id: string }>("POST", `service-accounts/${encodeURIComponent(id)}/identities`, { issuer, subject, audience }),
  removeIdentity: (id: string, identityId: string) =>
    http<void>("DELETE", `service-accounts/${encodeURIComponent(id)}/identities/${encodeURIComponent(identityId)}`),
  approveCliLogin: (body: { challenge: string; port: number; state: string; name: string }) =>
    http<{ redirect: string }>("POST", "cli/approve", body),
  cliDevice: (userCode: string) => http<{ name: string; userCode: string }>("GET", `cli/device/${encodeURIComponent(userCode)}`),
  approveCliDevice: (userCode: string) => http<{ approved: boolean }>("POST", "cli/approve", { userCode, port: 0 }),
  history: (filter: HistoryFilter) => http<{ entries: HistoryEntry[] }>("GET", `documents/history${historyQuery(filter)}`),
  logLevels: () => http<LogLevels>("GET", "logs/levels"),
  saveLogLevels: (defaultLevel: LogLevel, overrides: LogLevelOverride[]) =>
    http<{ updatedAt: string; updatedBy: string | null }>("PUT", "logs/levels", { defaultLevel, overrides }),
  resetLogLevels: () => http<void>("DELETE", "logs/levels"),
  rulesSubsystems: () => http<RuleSubsystemStatus[]>("GET", "rules/subsystems"),
  rulesLive: (sys: RuleSubsystem) => http<{ rulesJson: string }>("GET", `rules/${sys}/live`),
  rulesVersions: (sys: RuleSubsystem) => http<RuleVersionSummary[]>("GET", `rules/${sys}/versions`),
  rulesVersion: (sys: RuleSubsystem, version: number) => http<RuleVersionDetail>("GET", `rules/${sys}/versions/${version}`),
  rulesSave: (sys: RuleSubsystem, body: { rulesJson: string; note?: string; expectedHeadVersion?: number }) =>
    http<RuleVersionDetail>("POST", `rules/${sys}`, body),
  rulesRevert: (sys: RuleSubsystem, version: number) => http<RuleVersionDetail>("POST", `rules/${sys}/revert/${version}`),
  rulesApplyHead: (sys: RuleSubsystem) => http<{ appliedVersion: number | null }>("POST", `rules/${sys}/apply-head`),
  rulesValidate: (sys: RuleSubsystem, rulesJson: string) =>
    http<RuleValidationResult>("POST", `rules/${sys}/validate`, { rulesJson }),
  rulesParseText: (text: string) => http<ParseRulesTextResult>("POST", "rules/text/parse", { text }),
  rulesFormatText: (rulesJson: string) => http<{ text: string }>("POST", "rules/text/format", { rulesJson }),
  rulesFields: (sys: RuleSubsystem, pattern: string) =>
    http<{ fields: { path: string; types: string[] }[] }>("GET", `rules/${sys}/fields?pattern=${encodeURIComponent(pattern)}`),
  rulesSimulate: (
    sys: RuleSubsystem,
    body: {
      rulesJson: string; operation: RuleOperation; documentPath: string; resourceJson?: string; requestJson?: string; params?: Record<string, string>;
      /** Built by the server as a real call would: who's asking, the document or file now, and what's being written. */
      structured?: boolean; auth?: { uid: string; claims: Record<string, unknown> } | null;
      existing?: Record<string, unknown> | null; incoming?: Record<string, unknown> | null;
    },
  ) => http<SimulateResult>("POST", `rules/${sys}/simulate`, body),

  ...authApi("auth"),
};
