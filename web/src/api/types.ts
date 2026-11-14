export interface WincheDocument {
  path: string;
  id: string;
  collection: string;
  fields: Record<string, unknown>;
  createTime: string;
  updateTime: string;
  version: number;
}

export interface QueryResult {
  documents: WincheDocument[];
  hasMore: boolean;
}

export type ConsoleRole = "Admin" | "Member" | "Viewer";

export interface SessionUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: ConsoleRole;
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
  mustSetupTwoFactor: boolean;
}

export type AuthProvider = "identity" | "keycloak";

export interface Capabilities {
  manageUsers: boolean;
  database: boolean;
  storage: boolean;
  /** Which log views the user may open (Admins only). */
  logs?: { app: boolean; database: boolean; storage: boolean };
  /** The Database tab's History sub-tab (who changed which document). */
  history?: boolean;
  /** Database / Storage → Settings (admins, when the packages use settings). */
  settings?: { database?: boolean; storage?: boolean };
  /** The Hooks page (admins, when the app uses Winche.Webhooks). */
  hooks?: boolean;
  /** The Functions page (admins, when the app uses Winche.Functions). */
  functions?: boolean;
  /** The Authentication tab: the app's users (Winche Auth). Admins only. */
  authentication?: boolean;
  invites: boolean;
  twoFactor: boolean;
  changePassword: boolean;
  editProfile: boolean;
}

export type AuthConfig = (
  | { provider: "identity" }
  | { provider: "keycloak"; authority: string; clientId: string; scopes: string }
) & { project?: { id: string; name: string } };

export interface AuthState {
  provider: AuthProvider;
  initialized: boolean;
  selfServiceResetEnabled: boolean;
  capabilities: Capabilities;
  user: SessionUser | null;
  /** Keycloak mode: authenticated but holding none of the console roles. Show the "no access" screen. */
  accessDenied?: boolean;
}

export interface ConsoleUserItem {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: ConsoleRole;
  active: boolean;
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
  lockedOut: boolean;
}

export interface BrowseResult {
  folders: string[];
  files: FileRecord[];
}

export interface FileRecord {
  id: string;
  path: string;
  directory: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: string;
  uploadId: string | null;
  metadata: Record<string, unknown> | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type InviteStatus = "pending" | "expired" | "revoked";

export interface ConsoleInvite {
  id: string;
  email: string;
  role: ConsoleRole;
  firstName: string | null;
  lastName: string | null;
  requireName: boolean;
  requireTwoFactor: boolean;
  createdAt: string;
  expiresAt: string;
  status: InviteStatus;
}

export interface InvitePreview {
  email: string;
  firstName: string | null;
  lastName: string | null;
  requireName: boolean;
  requireTwoFactor: boolean;
  role?: string;
  invitedBy?: string | null;
  expiresAt?: string;
}
