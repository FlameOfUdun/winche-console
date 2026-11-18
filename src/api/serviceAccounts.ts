/** A key of a service account (never its secret): exchanged for access tokens; at most two at once. */
export interface ServiceAccountKey {
  id: string; createdBy: string; createdAt: string; expiresAt: string; lastUsedAt: string | null; lastUsedFrom: string | null;
  /** No use for 90 days. */
  unused: boolean;
}

/** An identity a service account trusts instead of a key: tokens of this issuer, for this subject and audience. */
export interface ServiceAccountIdentity {
  id: string; issuer: string; subject: string; audience: string | null; createdAt: string; lastUsedAt: string | null;
}

/** A project's service account: a role, or deploy scopes. */
export interface ServiceAccount {
  id: string; name: string; role: string | null; scopes: string[]; disabled: boolean;
  createdBy: string; createdAt: string; lastUsedAt: string | null;
  /** False when whoever made it is no longer an admin here: worth a look. */
  makerIsAdmin: boolean;
  keys: ServiceAccountKey[];
  identities: ServiceAccountIdentity[];
}

export interface ServiceAccountsResponse {
  available: boolean; roles: string[]; scopes: string[]; maxKeys: number; maxKeyDays: number; keysAllowed: boolean;
  accounts: ServiceAccount[];
}
