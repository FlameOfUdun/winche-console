/** GET api/data-location: where the project's data is kept (server admins). */
export interface DataLocationInfo {
  host: string | null;
  port: number | null;
  database: string;
  username: string | null;
  sslMode: string | null;
  sizeBytes: number | null;
  version: string | null;
  maxConnections: number | null;
  commandTimeoutSeconds: number | null;
  previous: { host: string | null; database: string; movedAt: string } | null;
  lastMoveFailed: { error: string; at: string } | null;
  suggestedDatabase: string;
}

export interface DataMoveTarget { database: string; host?: string | null; port?: number | null; username?: string | null; password?: string | null; sslMode?: string | null }

export interface DataMoveCheck { ok: boolean; problem: string | null; version: string | null; exists: boolean; rowsToCopy: number }

/** While a move runs the project answers 503 with this. */
export interface MoveProgress { stage: string; table: string | null; tablesDone: number; tablesTotal: number; rows: number; startedAt: string }
