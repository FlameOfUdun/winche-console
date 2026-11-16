export interface FunctionInfo {
  name: string; kind: "documents" | "files" | "users" | "schedule" | "callable" | "before" | "http" | "consolePage" | "consoleAction"; events: string[] | null; path: string | null;
  cron: string | null; timeZone: string | null; description: string; timeoutSeconds: number;
  /** The secrets it declared (options.secrets). */
  secrets?: string[];
  /** The run time its code sets, if it does (timeoutSeconds is the one in force). */
  codeTimeoutSeconds?: number | null;
  /** What it does (options.description). */
  about?: string | null;
  /** What it takes and returns, as JSON Schema (options.input / output): shown, not checked. */
  input?: unknown;
  output?: unknown;
  /** The input to start a run from: its example, or one made from its input schema. */
  example?: unknown;
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
  /** The server's longest run for a function, in seconds. */
  maxTimeoutSeconds?: number;
}

export interface FunctionRun {
  ok: boolean; result: unknown; error: { code: string; message: string } | null; durationMs: number;
  logs: { level: string; message: string; at: string }[];
}

/** A page of the project's own (consolePage in its functions), for the sidebar. */
export interface ConsolePageEntry { name: string; title: string; icon: string | null; order: number }
