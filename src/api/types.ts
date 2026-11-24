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
  /** False when signed in but with no role in this project (not one of its members). */
  member?: boolean;
  /** An admin of every project on the server (the only ones who create projects). */
  serverAdmin?: boolean;
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
  mustSetupTwoFactor: boolean;
  /** Signed in through the identity provider (Server settings → Authentication → Sign-in method). */
  signedInWithProvider?: boolean;
  hasPassword?: boolean;
}

export type AuthProvider = "identity";

export interface Capabilities {
  manageUsers: boolean;
  /** This project's own member list (a project among several sharing the server's accounts). */
  members?: boolean;
  database: boolean;
  storage: boolean;
  /** Which log views the user may open (Admins only). */
  logs?: { app: boolean; database: boolean; storage: boolean };
  /** The Database tab's History sub-tab (who changed which document). */
  history?: boolean;
  /** Database / Storage → Settings (admins, when the packages use settings). */
  settings?: { database?: boolean; storage?: boolean; assets?: boolean; realtime?: boolean };
  /** The Hooks page (admins, when the app uses Winche.Webhooks). */
  hooks?: boolean;
  /** The Functions page (admins, when the app uses Winche.Functions). */
  functions?: boolean;
  /** The Assets pages: releases and channels (and their rules, webhooks, settings). */
  assets?: boolean;
  /** The Realtime pages: lists, presence (and their rules, settings). */
  realtime?: boolean;
  /** The project's own console pages (consolePage in its functions): anyone with a role here. */
  consolePages?: boolean;
  /** The Integrity page: the project's apps and proof requests come from them (with project setup). */
  integrity?: boolean;
  /** The Authentication tab: the app's users (Winche Auth). Admins only. */
  authentication?: boolean;
  invites: boolean;
  twoFactor: boolean;
  changePassword: boolean;
  editProfile: boolean;
}

export type AuthConfig = { provider: "identity"; project?: { id: string; name: string } };

export interface AuthState {
  provider: AuthProvider;
  /** The server's own console (Winche Server's root): its projects, accounts and settings, and no project of its own. */
  server?: boolean;
  initialized: boolean;
  /** Not set up yet: whether setup asks for the code (in the server's log). */
  setup?: { code: boolean } | null;
  selfServiceResetEnabled: boolean;
  capabilities: Capabilities;
  user: SessionUser | null;
  /** The identity providers on the sign-in page (a button each), when any is on. */
  oidc?: { providers: { id: string; label: string }[]; passwordsOnlyForAdmins: boolean } | null;
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
