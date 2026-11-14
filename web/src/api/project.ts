/** GET api/project: the project as setup made it. `setup` false: no setup on this console (every product is on). */
export interface ProjectState {
  setup: boolean;
  created: boolean;
  id: string;
  name: string;
  products: { id: ProductId; started: boolean }[];
}

export type ProductId = "database" | "storage" | "authentication" | "functions" | "hooks";
export type RulesMode = "locked" | "test";

/** A project id from a name: lower case, dashes, starting with a letter, 3–40 characters. */
export function projectIdFrom(name: string): string {
  let id = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(id)) id = "p-" + id;
  id = id.slice(0, 40).replace(/-+$/g, "");
  return id.length >= 3 ? id : (id + "-app").slice(0, 40);
}

export function isProjectId(id: string): boolean {
  return /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(id);
}

/** Firebase-style test mode: everything allowed until a date 30 days away, then locked. */
export function testModeRules(subsystem: "database" | "storage", until: Date): string {
  const pattern = subsystem === "database" ? "{document=**}" : "{path=**}";
  return `match ${pattern} {\n  allow read, write: if request.time < timestamp('${until.toISOString()}');\n}\n`;
}
