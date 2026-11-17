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
  /** Its instances' limits in force, and where each comes from ("setting", "code", "default"); null for before-functions. */
  limits?: (FunctionLimits & { from: Record<string, string> }) | null;
  /** What its code says about them (null where it doesn't). */
  codeLimits?: Partial<Record<keyof FunctionLimits, number | boolean | null>>;
}

/** How a function's instances may run: memory per instance (MB), how many kept loaded, at most at once, reserved; its own process. */
export interface FunctionLimits { memoryMb: number; minInstances: number; maxInstances: number; reservedInstances: number; isolate: boolean }

/** A function secret: never its value. */
export interface FunctionSecret {
  name: string; isSet: boolean; setAt: string | null; setBy: string | null; usedBy: string[];
  /** Where it's read from (aws-ssm:…); null for a value kept here. */
  reference?: string | null;
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
  /** The most memory a function may ask for (MB), and the most runs at once on the server. */
  maxMemoryMb?: number;
  maxConcurrency?: number;
}

export interface FunctionRun {
  ok: boolean; result: unknown; error: { code: string; message: string } | null; durationMs: number;
  logs: { level: string; message: string; at: string }[];
}

/** A page of the project's own (consolePage in its functions), for the sidebar. */
export interface ConsolePageEntry { name: string; title: string; icon: string | null; order: number }
