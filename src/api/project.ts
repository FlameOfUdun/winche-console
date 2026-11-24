/** GET api/project: the project as setup made it. `setup` false: no setup on this console (every product is on). */
export interface ProjectState {
  setup: boolean;
  created: boolean;
  id: string;
  name: string;
  products: { id: ProductId; started: boolean; ready?: boolean; setup?: ProductSetupRun | null }[];
  /** When the thumbnail last changed; null or missing: no thumbnail. */
  imageVersion?: string | null;
}

/** GET api/projects: the server's projects, for the switcher. */
export interface ServerProjects {
  available: boolean;
  canCreate: boolean;
  /** This console's project. */
  /** This console's project; null in the server's own console. */
  current: string | null;
  projects: { id: string; name: string; consoleUrl: string; imageVersion: string | null;
    /** The products started in it; missing on hosts that don't say. */
    products?: ProductId[] }[];
  /** Archived projects (server admins only). */
  archived?: { id: string; name: string; archivedAt: string }[];
}

export type ProductId = "database" | "storage" | "authentication" | "functions" | "assets" | "realtime";

/** A product's setup on the server, step by step (POST …/start begins it, GET …/setup follows it). */
export interface ProductSetupRun {
  product: ProductId;
  state: "running" | "done" | "failed" | "not-started";
  steps: { title: string; state: "waiting" | "running" | "done" | "failed"; error?: string | null }[];
  startedAt: string;
  finishedAt: string | null;
}
export type RulesMode = "locked" | "test";

/** A project id from a name: lower case, dashes, starting with a letter, 3–40 characters. */
export function projectIdFrom(name: string): string {
  if (!name.trim()) return "";   // nothing typed yet: no id to suggest
  let id = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(id)) id = "p-" + id;
  id = id.slice(0, 40).replace(/-+$/g, "");
  return id.length >= 3 ? id : (id + "-app").slice(0, 40);
}

export function isProjectId(id: string): boolean {
  return /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(id);
}

/** Test mode: everything allowed until a date 30 days away, then locked. */
export function testModeRules(subsystem: "database" | "storage" | "assets" | "realtime", until: Date): string {
  const pattern = subsystem === "database" ? "{document=**}" : "{path=**}";
  const what = subsystem === "assets" ? "read" : "read, write";   // apps only read assets
  return `match ${pattern} {\n  allow ${what}: if request.time < timestamp('${until.toISOString()}');\n}\n`;
}
