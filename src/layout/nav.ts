import type { AuthState, SessionUser } from "../api/types";
import { CONSOLE } from "../api/scope";

export type NavIcon = "home" | "database" | "folder" | "shield" | "logs" | "users" | "hooks" | "functions" | "plugins" | "assets" | "settings" | "page" | "key" | "integrity";

/** One of a product's pages (Database → Rules), under it in the sidebar. */
export interface NavPage { to: string; label: string }

/** A sidebar entry: a product (or Logs) and, when it has more than one, its pages. */
export interface NavItem {
  to: string; label: string; icon: NavIcon; group: "top" | "build" | "monitor" | "pages" | "bottom"; pages: NavPage[];
  /** The project's own pages: a Tabler icon name of theirs. */
  tablerIcon?: string | null;
}

/** What the session can't tell on its own, from the server: who may edit rules, what auth runs. */
export interface NavFacts {
  /** The products whose rules the user may edit (admins). */
  rules?: string[];
  /** Winche Auth runs here (email templates); false when another identity provider does. */
  wincheAuth?: boolean;
  /** Authentication keeps users here (the Users page). */
  authUsers?: boolean;
  /** Tokens from other issuers can be trusted here (the Trusted issuers page). */
  trustedIssuers?: boolean;
  /** The project's own console pages. */
  consolePages?: { name: string; title: string; icon: string | null }[];
}

/**
 * The project's sidebar, given capabilities and role: Overview, the products and their pages, Logs, and Project
 * settings. Single source for the sidebar, each page's guard (a page not listed sends you to its product's first), and
 * the home redirect.
 */
export function projectNav(state: AuthState | null, user: SessionUser | null, facts: NavFacts = {}): NavItem[] {
  const c = state?.capabilities;
  const admin = user?.role === "Admin";
  const out: NavItem[] = [{ to: "/overview", label: "Overview", icon: "home", group: "top", pages: [] }];
  const productPages = (base: string, product: "database" | "storage" | "assets", primary: string): NavPage[] => [
    { to: base, label: primary },
    ...(product === "assets" ? [{ to: `${base}/releases`, label: "Releases" }] : []),
    ...(facts.rules?.includes(product) ? [{ to: `${base}/rules`, label: "Rules" }] : []),
    ...(product === "database" && c?.settings?.database ? [{ to: `${base}/indexes`, label: "Indexes" }] : []),
    ...(product === "database" && c?.history ? [{ to: `${base}/history`, label: "History" }] : []),
    ...(c?.hooks ? [{ to: `${base}/webhooks`, label: "Webhooks" }] : []),
    ...(product !== "assets" && c?.logs?.[product] ? [{ to: `${base}/logs`, label: "Logs" }] : []),
    ...(c?.settings?.[product] ? [{ to: `${base}/settings`, label: "Settings" }] : []),
  ];
  // Webhooks are each product's own page (Authentication, Database, Storage → Webhooks); triggered functions are Functions'.
  if (c?.authentication) {
    out.push({
      to: "/authentication", label: "Authentication", icon: "users", group: "build", pages: [
        ...(facts.authUsers !== false ? [{ to: "/authentication/users", label: "Users" }] : []),
        ...(facts.wincheAuth !== false ? [{ to: "/authentication/methods", label: "Sign-in method" }] : []),
        ...(facts.trustedIssuers !== false ? [{ to: "/authentication/issuers", label: "Trusted issuers" }] : []),
        ...(facts.wincheAuth !== false ? [{ to: "/authentication/emails", label: "Templates" }] : []),
        ...(c.hooks ? [{ to: "/authentication/webhooks", label: "Webhooks" }] : []),
        { to: "/authentication/settings", label: "Settings" },
      ],
    });
  }
  if (c?.database) out.push({ to: "/database", label: "Database", icon: "database", group: "build", pages: productPages("/database", "database", "Data") });
  if (c?.storage) out.push({ to: "/storage", label: "Storage", icon: "folder", group: "build", pages: productPages("/storage", "storage", "Files") });
  if (c?.assets) out.push({ to: "/assets", label: "Assets", icon: "assets", group: "build", pages: productPages("/assets", "assets", "Files") });
  if (c?.functions) out.push({ to: "/functions", label: "Functions", icon: "functions", group: "build", pages: [] });
  // Plugins: ready-made functions (installed copies, browsing, a page each); they need functions.
  if (c?.functions) out.push({ to: "/plugins", label: "Plugins", icon: "plugins", group: "build", pages: [] });
  // The project's API keys and passwords: its own, the products', and where they can be read from (admins).
  if (admin) out.push({ to: "/secrets", label: "Secrets", icon: "key", group: "build", pages: [] });
  // The project's apps, and proof that requests come from them (with project setup).
  if (c?.integrity) out.push({ to: "/integrity", label: "Integrity", icon: "integrity", group: "build", pages: [] });
  for (const p of facts.consolePages ?? []) out.push({ to: `/pages/${p.name}`, label: p.title, icon: "page", tablerIcon: p.icon, group: "pages", pages: [] });
  if (c?.logs?.app) {
    out.push({ to: "/logs", label: "Logs", icon: "logs", group: "monitor", pages: [
      { to: "/logs", label: "Explorer" }, { to: "/logs/saved", label: "Saved queries" },
    ] });
  }
  out.push({
    to: "/settings", label: "Project settings", icon: "settings", group: "bottom", pages: [
      { to: "/settings/general", label: "General" },
      ...(admin ? [{ to: "/settings/members", label: "Members" }, { to: "/settings/service-accounts", label: "Service accounts" }] : []),
      ...(user?.serverAdmin ? [{ to: "/settings/data", label: "Data" }] : []),
    ],
  });
  // A product with one page is just that page.
  return out.map((n) => (n.pages.length > 1 ? n : { ...n, pages: [] }));
}

/** The products' entries alone (Build and Monitor), for places that list them. */
export function builtinNav(state: AuthState | null, user: SessionUser | null, facts: NavFacts = {}): NavItem[] {
  return projectNav(state, user, facts).filter((n) => n.group === "build" || n.group === "monitor");
}

/** The entry a path is in, and whether it's one of its pages. */
export function navItemFor(items: NavItem[], pathname: string): NavItem | undefined {
  return items.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"));
}

/** Is this page the one at `pathname`? A product's first page is only itself, not its siblings. */
export function isPageActive(page: NavPage, item: NavItem, pathname: string): boolean {
  if (page.to === item.to) return pathname === item.to;
  return pathname === page.to || pathname.startsWith(page.to + "/");
}

/** The project's home: the overview once signed in. */
export function homePath(state: AuthState | null, _user: SessionUser | null): string | null {
  return state ? "/overview" : null;
}

/** An address among the server's pages (its projects and settings), from anywhere: e.g. serverConsoleUrl("projects"). */
export function serverConsoleUrl(path = ""): string {
  return `${window.location.origin}${CONSOLE}/${path}`;
}
