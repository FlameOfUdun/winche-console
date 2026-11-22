export interface Hook {
  id: string;
  name: string;
  enabled: boolean;
  when: { source: string; events: string[]; path: string | null };
  do: { kind: string; url?: string | null; options: Record<string, string> };
}

export interface HookSource { name: string; title: string; events: string[]; hasPaths: boolean; variables: string[] }

export interface HooksPageData {
  settings: { hooks: Hook[] };
  source: "code" | "console";
  version: { number: number; at: string; by: string | null; reason: string | null } | null;
  editable: boolean;
  whyReadOnly: string | null;
  sources: HookSource[];
  counts: Record<string, Record<string, number>>;
}

export interface HookTestResult {
  ok: boolean; ran: boolean; status?: number | null; result?: string; durationMs?: number; options?: Record<string, string>; sample: unknown;
}

export interface HookDelivery {
  id: string; hookId: string; hookName: string; source: string; type: string; path: string | null;
  status: "pending" | "delivered" | "failed"; attempts: number; createdAt: string; nextAttemptAt: string | null; finishedAt: string | null;
  lastStatus: number | null; lastResult: string | null; durationMs: number | null; event: unknown;
}


/** The {names} a webhook's event carries in vars: the path pattern's captures, plus the source's own. */
export function variablesFor(hook: Hook, sources: HookSource[]): string[] {
  const source = sources.find((s) => s.name === hook.when.source);
  const captures = [...(hook.when.path ?? "").matchAll(/\{([A-Za-z0-9_]+)(=\*\*)?\}/g)].map((m) => m[1]);
  return [...new Set([...captures, ...(source?.variables ?? [])])];
}
