/**
 * The server's settings, as a project's console is laid out: sections in the sidebar (/server/<section>), each with its
 * pages as tabs (/server/<section>/<tab>).
 */
export interface ServerSection { id: string; label: string; icon: "users"; tabs: { id: string; label: string }[] }

export const SERVER_SECTIONS: ServerSection[] = [
  { id: "authentication", label: "Authentication", icon: "users",
    tabs: [{ id: "users", label: "Users" }, { id: "sign-in", label: "Sign-in method" }, { id: "templates", label: "Templates" }, { id: "settings", label: "Settings" }] },
];

/** Where a section opens: its first tab. */
export const sectionPath = (s: ServerSection) => (s.tabs.length ? `/server/${s.id}/${s.tabs[0].id}` : `/server/${s.id}`);
