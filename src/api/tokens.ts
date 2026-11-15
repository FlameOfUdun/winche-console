/** A console API token: a CLI sign-in (winche login) or a CI token. Never its secret. */
export interface ConsoleToken {
  id: string; kind: "cli" | "ci"; name: string; user: string; role: string; scopes: string[];
  createdAt: string; expiresAt: string; lastUsedAt: string | null;
}

export interface TokensResponse { available: boolean; scopes: string[]; tokens: ConsoleToken[] }
