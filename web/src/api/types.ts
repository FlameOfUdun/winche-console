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

export interface UsageStats {
  documentCount: number;
  fileCount: number;
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

export interface AuthState {
  initialized: boolean;
  selfServiceResetEnabled: boolean;
  user: SessionUser | null;
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
}
