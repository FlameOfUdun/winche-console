export interface FunctionInfo {
  name: string; kind: "documents" | "files" | "users" | "schedule" | "callable"; events: string[] | null; path: string | null;
  cron: string | null; timeZone: string | null; description: string; timeoutSeconds: number;
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
