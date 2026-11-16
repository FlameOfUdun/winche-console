export interface FunctionInfo {
  name: string; kind: "documents" | "files" | "users" | "schedule" | "callable"; events: string[] | null; path: string | null;
  cron: string | null; timeZone: string | null; description: string; timeoutSeconds: number;
  /** The secrets it declared (options.secrets). */
  secrets?: string[];
}

/** A function secret: never its value. */
export interface FunctionSecret {
  name: string; isSet: boolean; setAt: string | null; setBy: string | null; usedBy: string[];
}

export interface FunctionVersion {
  version: number; note: string | null; by: string | null; at: string; rolledBackFrom: number | null; functions: FunctionInfo[];
}

export interface FunctionsPageData {
  current: FunctionVersion | null;
  /** The deployed files' names (the code lives in the app's repository). */
  files: string[];
  runtimeProblem: string | null;
}

export interface FunctionRun {
  ok: boolean; result: unknown; error: { code: string; message: string } | null; durationMs: number;
  logs: { level: string; message: string; at: string }[];
}

/** A page of the project's own (consolePage in its functions), for the sidebar. */
export interface ConsolePageEntry { name: string; title: string; icon: string | null; order: number }
