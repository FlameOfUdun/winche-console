export interface FunctionInfo {
  name: string; kind: "documents" | "files" | "users" | "schedule" | "callable"; events: string[] | null; path: string | null;
  cron: string | null; timeZone: string | null; description: string; timeoutSeconds: number;
}

export interface FunctionVersion {
  version: number; note: string | null; by: string | null; at: string; rolledBackFrom: number | null; functions: FunctionInfo[];
}

export interface FunctionsPageData {
  current: FunctionVersion | null;
  files: Record<string, string>;
  runtimeProblem: string | null;
  deployKey: { setAt: string; setBy: string | null } | null;
  secretsAvailable: boolean;
}

export interface FunctionRun {
  ok: boolean; result: unknown; error: { code: string; message: string } | null; durationMs: number;
  logs: { level: string; message: string; at: string }[];
}

/** What a new project starts with. */
export const STARTER: Record<string, string> = {
  "index.ts": `import { callable, documents, HttpsError } from "@winche/functions";

// Called by apps: functions.call("hello", { name: "Ann" })
export const hello = callable(async (data: { name?: string }, ctx) => {
  if (!data?.name) throw new HttpsError("invalid-argument", "Send a name.");
  ctx.log("Saying hello to", data.name);
  return { greeting: \`Hello \${data.name}\`, by: ctx.auth?.uid ?? null };
});

// When a document is created: {name} parts of the path are in e.params
// export const onVisit = documents.onCreated("patients/{patientId}/visits/{visitId}", async (e, ctx) => {
//   await ctx.db.update(\`patients/\${e.params.patientId}\`, { lastVisit: new Date() });
// });
`,
};
